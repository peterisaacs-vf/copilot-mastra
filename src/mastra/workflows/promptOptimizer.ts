import { createWorkflow, createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { mainModel } from '../models';
import { generateStructured } from '../../lib/structured';
import { diffPrompts } from '../../tools/diffPrompts';
import {
  buildRubric,
  validateDefinition,
  paretoSelect,
  weightedScore,
  type AgentDefinition,
  type Candidate,
} from '../../lib/optimizer';

/**
 * Prompt optimizer (GEPA) as a durable Mastra workflow (port of prompt-optimizer-agent).
 *   prepare -> optimize (baseline score -> reflect -> score candidates -> pareto-select, per round) -> finalize (diff)
 *
 * Scoring is LOCAL SIMULATION (token-less): runner GLM produces a response for
 * each example under a candidate prompt; a judge GLM scores it against the rubric
 * built from the agent definition; the weighted 0-1 score drives pareto selection
 * (quality 80% vs brevity 20%). Reflection (main tier) proposes targeted/structural/
 * compressed candidates and must never weaken the definition's hard rules.
 *
 * Durability: the workflow run persists via the Mastra LibSQL store. Per-round
 * suspend/resume is a later upgrade; the GEPA loop runs inside the optimize step.
 */

// ---------- schemas ----------
const exampleSchema = z.object({
  input: z.string().describe('A representative user message / scenario the agent must handle'),
  context: z.string().optional().describe('Optional prior conversation context'),
});

const definitionSchema = z.record(z.string(), z.unknown());

const workflowInputSchema = z.object({
  systemPrompt: z.string(),
  definition: definitionSchema,
  examples: z.array(exampleSchema).min(1),
  maxRounds: z.number().int().default(2),
  candidatesPerRound: z.number().int().default(3),
  focus: z.string().default(''),
});

const preparedSchema = z.object({
  systemPrompt: z.string(),
  rubric: z.string(),
  definition: definitionSchema,
  examples: z.array(exampleSchema),
  maxRounds: z.number().int(),
  candidatesPerRound: z.number().int(),
  focus: z.string(),
  defWarnings: z.array(z.string()),
});

const roundSchema = z.object({
  round: z.number().int(),
  candidates: z.array(z.object({ strategy: z.string(), score: z.number(), length: z.number() })),
  winnerScore: z.number(),
  improvement: z.number(),
});

const optimizedSchema = z.object({
  systemPrompt: z.string(),
  baselineScore: z.number(),
  bestPrompt: z.string(),
  bestScore: z.number(),
  bestStrategy: z.string(),
  rounds: z.array(roundSchema),
  defWarnings: z.array(z.string()),
});

const resultSchema = z.object({
  baselineScore: z.number(),
  bestScore: z.number(),
  improvement: z.number(),
  bestStrategy: z.string(),
  rounds: z.array(roundSchema),
  diffSummary: z.string(),
  lengthChangePct: z.number(),
  bestPrompt: z.string(),
  warnings: z.array(z.string()),
});

const judgeSchema = z.object({
  accuracy: z.object({ score: z.number(), feedback: z.string() }),
  tone: z.object({ score: z.number(), feedback: z.string() }),
  completeness: z.object({ score: z.number(), feedback: z.string() }),
  safety: z.object({ score: z.number(), feedback: z.string() }),
  overall_feedback: z.string(),
});

const reflectionSchema = z.object({
  candidates: z.array(
    z.object({
      strategy: z.enum(['targeted', 'structural', 'compressed']),
      prompt: z.string(),
    }),
  ),
});

// ---------- agents (internal, main tier) ----------
const runnerAgent = new Agent({
  id: 'opt-runner',
  name: 'opt-runner',
  instructions: 'Respond to the user as instructed by the system prompt provided per request.',
  model: mainModel,
  defaultOptions: { maxSteps: 1, modelSettings: { maxOutputTokens: 700 } },
});

const judgeAgent = new Agent({
  id: 'opt-judge',
  name: 'opt-judge',
  instructions:
    'You are an impartial evaluator. You receive a scoring rubric and an agent response. Score each dimension 0-10 with specific feedback per the rubric. Output raw JSON only — no markdown fences.',
  model: mainModel,
  defaultOptions: { maxSteps: 1, modelSettings: { maxOutputTokens: 1200 } },
});

const reflectionAgent = new Agent({
  id: 'opt-reflection',
  name: 'opt-reflection',
  instructions: [
    'You are a prompt optimization specialist (GEPA reflection).',
    'Given the CURRENT system prompt, the agent definition, and failing examples with judge feedback, propose improved candidate prompts.',
    'Produce candidates using DISTINCT strategies:',
    '- targeted: minimal surgical fixes to the specific failing behaviors;',
    '- structural: reorganize/clarify sections and add any missing rules;',
    '- compressed: tighten and remove redundancy while preserving ALL behavior.',
    'NEVER weaken or remove the hard rules / blockers from the definition. Each candidate MUST be a COMPLETE, deployable system prompt.',
    'Output raw JSON only — no markdown fences.',
  ].join(' '),
  model: mainModel,
  defaultOptions: { maxSteps: 1, modelSettings: { maxOutputTokens: 7000 } },
});

interface ExampleScore {
  input: string;
  response: string;
  score: number;
  feedback: string;
}

async function scorePrompt(
  prompt: string,
  rubric: string,
  examples: z.infer<typeof exampleSchema>[],
  weights: AgentDefinition['rubric_weights'],
): Promise<{ avg: number; perExample: ExampleScore[] }> {
  const perExample = await Promise.all(
    examples.map(async (ex) => {
      const runRes = (await runnerAgent.generate(ex.input, {
        instructions: prompt,
        maxSteps: 1,
        modelSettings: { maxOutputTokens: 700 },
      })) as { text?: string };
      const response = runRes.text ?? '';
      const judgePrompt = [
        rubric,
        '',
        '--- PRIOR CONTEXT ---',
        ex.context ?? '(none)',
        '--- USER INPUT ---',
        ex.input,
        '--- AGENT RESPONSE ---',
        response,
        '',
        'Score the response now.',
      ].join('\n');
      const j = await generateStructured(judgeAgent, judgePrompt, judgeSchema, { maxSteps: 1, maxTokens: 1200 });
      const d = j.result ?? {
        accuracy: { score: 5, feedback: '' },
        tone: { score: 5, feedback: '' },
        completeness: { score: 5, feedback: '' },
        safety: { score: 5, feedback: '' },
        overall_feedback: '(judge produced no structured output)',
      };
      const score = weightedScore(
        { accuracy: d.accuracy.score, tone: d.tone.score, completeness: d.completeness.score, safety: d.safety.score },
        weights,
      );
      return { input: ex.input, response, score, feedback: d.overall_feedback };
    }),
  );
  const avg = perExample.reduce((s, r) => s + r.score, 0) / (perExample.length || 1);
  return { avg: Math.round(avg * 10000) / 10000, perExample };
}

// ---------- steps ----------
const prepareStep = createStep({
  id: 'prepare',
  inputSchema: workflowInputSchema,
  outputSchema: preparedSchema,
  execute: async ({ inputData }) => {
    const def = inputData.definition as AgentDefinition;
    const defWarnings = validateDefinition(def);
    return {
      systemPrompt: inputData.systemPrompt,
      rubric: buildRubric(def),
      definition: inputData.definition,
      examples: inputData.examples,
      maxRounds: inputData.maxRounds,
      candidatesPerRound: inputData.candidatesPerRound,
      focus: inputData.focus,
      defWarnings,
    };
  },
});

const optimizeStep = createStep({
  id: 'optimize',
  inputSchema: preparedSchema,
  outputSchema: optimizedSchema,
  execute: async ({ inputData }) => {
    const { systemPrompt, rubric, definition, examples, maxRounds, candidatesPerRound, focus } = inputData;
    const def = definition as AgentDefinition;
    const weights = def.rubric_weights;

    const baseline = await scorePrompt(systemPrompt, rubric, examples, weights);
    const lowScoring = [...baseline.perExample].sort((a, b) => a.score - b.score).slice(0, 4);

    let best = { prompt: systemPrompt, score: baseline.avg, strategy: 'baseline' };
    const rounds: z.infer<typeof roundSchema>[] = [];

    for (let r = 1; r <= maxRounds; r++) {
      const reflectionPrompt = [
        `Produce exactly ${candidatesPerRound} candidate prompts.`,
        focus ? `Optimization focus: ${focus}.` : '',
        '',
        '=== AGENT DEFINITION (do NOT weaken hard rules) ===',
        JSON.stringify(def, null, 2),
        '',
        '=== CURRENT SYSTEM PROMPT ===',
        best.prompt,
        '',
        '=== FAILING EXAMPLES (input / agent response / judge feedback) ===',
        lowScoring
          .map((e, i) => `[${i + 1}] INPUT: ${e.input}\nRESPONSE: ${e.response}\nFEEDBACK: ${e.feedback} (score ${e.score})`)
          .join('\n\n'),
      ]
        .filter(Boolean)
        .join('\n');

      const refl = await generateStructured(reflectionAgent, reflectionPrompt, reflectionSchema, {
        maxSteps: 1,
        maxTokens: 7000,
      });
      const cands = (refl.result?.candidates ?? []).slice(0, candidatesPerRound);

      const scored: Candidate[] = [];
      for (const c of cands) {
        const s = await scorePrompt(c.prompt, rubric, examples, weights);
        scored.push({ prompt: c.prompt, score: s.avg, length: c.prompt.length, strategy: c.strategy });
      }

      const pool: Candidate[] = [{ prompt: best.prompt, score: best.score, length: best.prompt.length, strategy: best.strategy }, ...scored];
      const winner = paretoSelect(pool);
      const improvement = Math.round(((winner?.score ?? best.score) - best.score) * 10000) / 10000;

      rounds.push({
        round: r,
        candidates: scored.map((s) => ({ strategy: String(s.strategy), score: s.score, length: s.length ?? 0 })),
        winnerScore: winner?.score ?? best.score,
        improvement,
      });

      if (winner && winner.score > best.score) {
        best = { prompt: String(winner.prompt), score: winner.score, strategy: String(winner.strategy ?? 'candidate') };
      }
      if (improvement < 0.02) break;
    }

    return {
      systemPrompt,
      baselineScore: baseline.avg,
      bestPrompt: best.prompt,
      bestScore: best.score,
      bestStrategy: best.strategy,
      rounds,
      defWarnings: inputData.defWarnings,
    };
  },
});

const finalizeStep = createStep({
  id: 'finalize',
  inputSchema: optimizedSchema,
  outputSchema: resultSchema,
  execute: async ({ inputData }) => {
    const diff = diffPrompts(inputData.systemPrompt, inputData.bestPrompt);
    return {
      baselineScore: inputData.baselineScore,
      bestScore: inputData.bestScore,
      improvement: Math.round((inputData.bestScore - inputData.baselineScore) * 10000) / 10000,
      bestStrategy: inputData.bestStrategy,
      rounds: inputData.rounds,
      diffSummary: diff.summary,
      lengthChangePct: diff.stats.length_change_pct,
      bestPrompt: inputData.bestPrompt,
      warnings: inputData.defWarnings,
    };
  },
});

export const promptOptimizerWorkflow = createWorkflow({
  id: 'prompt-optimizer',
  inputSchema: workflowInputSchema,
  outputSchema: resultSchema,
})
  .then(prepareStep)
  .then(optimizeStep)
  .then(finalizeStep)
  .commit();
