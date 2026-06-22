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
 * Scoring is MULTI-TURN LOCAL SIMULATION (token-less): for each scenario, the runner
 * GLM plays the agent under a candidate prompt across the scripted user turns, producing
 * a full conversation; a judge GLM scores the WHOLE conversation against the rubric built
 * from the agent definition. Multi-turn is what surfaces loop / dead-end / no-End-on-
 * abandonment failures, so candidates that fix them actually score higher. The weighted
 * 0-1 score drives pareto selection (quality 80% vs brevity 20%).
 *
 * Reflection (main tier) proposes targeted/structural/compressed candidates and must never
 * weaken the definition's hard rules. Durability: the run persists via the LibSQL store;
 * per-round suspend/resume is a later upgrade. Live multi-turn scoring via VF
 * test_conversation (token-gated) is the higher-fidelity upgrade.
 */

// ---------- schemas ----------
const scenarioSchema = z.object({
  userTurns: z.array(z.string()).min(1).describe('Scripted user turns for a multi-turn scenario the agent must handle'),
  context: z.string().optional().describe('Optional situational context for the scenario'),
});

const definitionSchema = z.record(z.string(), z.unknown());

const workflowInputSchema = z.object({
  systemPrompt: z.string(),
  definition: definitionSchema,
  examples: z.array(scenarioSchema).min(1),
  maxRounds: z.number().int().default(2),
  candidatesPerRound: z.number().int().default(3),
  focus: z.string().default(''),
});

const preparedSchema = z.object({
  systemPrompt: z.string(),
  rubric: z.string(),
  definition: definitionSchema,
  examples: z.array(scenarioSchema),
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
  defaultOptions: { maxSteps: 1, modelSettings: { maxOutputTokens: 500 } },
});

const judgeAgent = new Agent({
  id: 'opt-judge',
  name: 'opt-judge',
  instructions:
    'You are an impartial evaluator. You receive a scoring rubric and a full multi-turn conversation. Score each dimension 0-10 with specific feedback per the rubric, watching for loops, dead-ends, and failure to end on abandonment. Output raw JSON only — no markdown fences.',
  model: mainModel,
  defaultOptions: { maxSteps: 1, modelSettings: { maxOutputTokens: 1200 } },
});

const reflectionAgent = new Agent({
  id: 'opt-reflection',
  name: 'opt-reflection',
  instructions: [
    'You are a prompt optimization specialist (GEPA reflection).',
    'Given the CURRENT system prompt, the agent definition, and failing multi-turn conversations with judge feedback, propose improved candidate prompts.',
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

type ChatMsg = { role: 'user' | 'assistant'; content: string };

/** Play the agent (under `prompt`) across the scripted user turns; return the rendered conversation. */
async function runDialogue(prompt: string, userTurns: string[], context?: string): Promise<string> {
  const messages: ChatMsg[] = [];
  const lines: string[] = [];
  for (let i = 0; i < userTurns.length; i++) {
    const content = i === 0 && context ? `[Scenario context: ${context}]\n${userTurns[i]}` : userTurns[i];
    messages.push({ role: 'user', content });
    const res = (await runnerAgent.generate(messages as Parameters<typeof runnerAgent.generate>[0], {
      instructions: prompt,
      maxSteps: 1,
      modelSettings: { maxOutputTokens: 500 },
    })) as { text?: string };
    const assistant = res.text ?? '';
    messages.push({ role: 'assistant', content: assistant });
    lines.push(`Turn ${i + 1}\nUSER: ${userTurns[i]}\nAGENT: ${assistant}`);
  }
  return lines.join('\n\n');
}

interface ScenarioScore {
  transcript: string;
  score: number;
  feedback: string;
}

async function scorePrompt(
  prompt: string,
  rubric: string,
  scenarios: z.infer<typeof scenarioSchema>[],
  weights: AgentDefinition['rubric_weights'],
): Promise<{ avg: number; per: ScenarioScore[] }> {
  const per = await Promise.all(
    scenarios.map(async (sc) => {
      const transcript = await runDialogue(prompt, sc.userTurns, sc.context);
      const judgePrompt = [
        rubric,
        '',
        'Score the ENTIRE multi-turn conversation below. Watch for: looping on a field, dead-ends, ignoring out-of-order info, and failing to end/handoff on abandonment.',
        '',
        '--- CONVERSATION ---',
        transcript,
        '',
        'Score the conversation now.',
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
      return { transcript, score, feedback: d.overall_feedback };
    }),
  );
  const avg = per.reduce((s, r) => s + r.score, 0) / (per.length || 1);
  return { avg: Math.round(avg * 10000) / 10000, per };
}

// ---------- steps ----------
const prepareStep = createStep({
  id: 'prepare',
  inputSchema: workflowInputSchema,
  outputSchema: preparedSchema,
  execute: async ({ inputData }) => {
    const def = inputData.definition as AgentDefinition;
    return {
      systemPrompt: inputData.systemPrompt,
      rubric: buildRubric(def),
      definition: inputData.definition,
      examples: inputData.examples,
      maxRounds: inputData.maxRounds,
      candidatesPerRound: inputData.candidatesPerRound,
      focus: inputData.focus,
      defWarnings: validateDefinition(def),
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
    const lowScoring = [...baseline.per].sort((a, b) => a.score - b.score).slice(0, 3);

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
        '=== FAILING CONVERSATIONS (transcript / judge feedback) ===',
        lowScoring
          .map((e, i) => `[${i + 1}] (score ${e.score})\n${e.transcript.slice(0, 1600)}\nJUDGE: ${e.feedback}`)
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
