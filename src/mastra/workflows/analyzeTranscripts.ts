import { createWorkflow, createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { mainModel, triageModel } from '../models';
import { buildDebugAgent, debugResultSchema, runDebug } from '../agents/debugAgent';
import { getSkillWorkspace } from '../workspace';
import { generateStructured } from '../../lib/structured';
import { extractLogs, parseTranscript, type ParsedTranscript } from '../../lib/vfParseTranscript';
import { loadMarkdownBody } from '../../lib/loadPrompt';

/**
 * Bulk transcript analysis as a Mastra workflow (port of analyze-transcripts-agent).
 * The agent's orchestration (Steps 1-4) becomes the workflow itself:
 *   collect -> foreach(triage, parallel) -> select -> foreach(deepRead, parallel) -> synthesize
 * Triage runs on the triage tier; deep reads reuse the debug-agent (main tier) per
 * transcript; synthesis (Steps 5-8) runs on the main tier.
 *
 * v1 takes transcripts INLINE so it runs without the VF token. Live bulk fetch by
 * projectID is gated on VF_MCP_TOKEN (see collectStep).
 */

function renderTranscript(p: ParsedTranscript): string {
  const lines: string[] = [`version: ${p.version}`, `agents: ${p.metadata.agents.join(', ') || '(none)'}`, ''];
  for (const [name, sys] of Object.entries(p.system_prompts)) {
    lines.push(`--- prompt.system for agent "${name}" ---`, sys, '');
  }
  lines.push('--- turns ---');
  for (const t of p.turns) {
    lines.push(`[Turn ${t.turn_index}] agent=${t.agent_name}`);
    lines.push(`USER: ${t.user_message}`);
    lines.push(`AGENT: ${t.agent_response}`);
    for (const c of t.tool_calls) {
      lines.push(`  TOOL ${c.name} args=${JSON.stringify(c.arguments ?? {})} result=${JSON.stringify(c.result ?? {})}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------- schemas ----------
const transcriptInputSchema = z.object({ id: z.string(), raw: z.unknown() });

const workflowInputSchema = z.object({
  projectID: z.string().optional(),
  transcripts: z.array(transcriptInputSchema).optional(),
  focus: z.string().default(''),
  maxDeepReads: z.number().int().default(5),
});

const itemSchema = z.object({ id: z.string(), rendered: z.string() });

const triageOutcome = z.enum(['resolved', 'incomplete', 'escalated', 'negative', 'unknown']);

const triageSchema = z.object({
  id: z.string(),
  rendered: z.string(),
  turnCount: z.number().int(),
  outcome: triageOutcome,
  evalFailures: z.array(z.string()),
  potentialIssues: z.array(z.string()),
  severityScore: z.number().int(),
});

const triageModelSchema = z.object({
  turnCount: z.number().int(),
  outcome: triageOutcome,
  evalFailures: z.array(z.string()).default([]),
  potentialIssues: z.array(z.string()).default([]),
  severityScore: z.number().int().describe('0 (clean) to 100 (severe failure)'),
});

const selectedSchema = z.object({ id: z.string(), rendered: z.string(), triageSummary: z.string() });

const deepReadSchema = z.object({
  id: z.string(),
  triageSummary: z.string(),
  debug: debugResultSchema.nullable(),
});

const findingSchema = z.object({
  title: z.string(),
  severity: z.enum(['safety', 'hallucination', 'core', 'ux', 'edge']),
  rootCauseCategory: z.enum(['prompt', 'tool', 'wiring', 'context', 'edge_case', 'upstream', 'other']),
  frequency: z.string().describe('"N of M transcripts (X%)"'),
  evidence: z.array(z.string()).describe('transcript ids + turn numbers + direct quotes'),
  fix: z.string(),
});

const reportSchema = z.object({
  summary: z.string(),
  transcriptsAnalyzed: z.number().int(),
  deepRead: z.number().int(),
  crossCorrelation: z.array(z.string()).describe('answers to the 5 cross-correlation questions'),
  findings: z.array(findingSchema),
  needsDeeperInvestigation: z.array(z.string()),
});

// ---------- agents ----------
const TRIAGE_INSTRUCTIONS = [
  'You triage ONE Voiceflow transcript for a bulk quality analysis.',
  'Return: turnCount; outcome (resolved|incomplete|escalated|negative|unknown);',
  'evalFailures (short labels for any failed eval/outcome signal); potentialIssues (1-4 terse suspected problems);',
  'severityScore 0-100 (0=clean, 100=severe — weigh user harm, abandonment, hallucination, loops, unhandled tool errors).',
  'Be fast and decisive. Do NOT deep-analyze — deep reading happens later for the worst transcripts.',
].join(' ');

const triageAgent = new Agent({
  id: 'analyze-triage',
  name: 'analyze-triage',
  instructions: TRIAGE_INSTRUCTIONS,
  model: triageModel,
  defaultOptions: { maxSteps: 1, modelSettings: { maxOutputTokens: 1500 } },
});

function synthInstructions(): string {
  const body = loadMarkdownBody('agents/analyze-transcripts-agent.md');
  return [
    body,
    '\n\n---\n\n# Execution note',
    'Steps 1-4 (load context, pull transcripts, parallel triage, deep reading) have ALREADY been executed by the workflow. You receive the triage table for ALL transcripts plus the structured deep-read diagnoses for the worst (and some passing) ones.',
    'Perform Steps 5-8 ONLY: cross-correlation (answer all 5 questions), prioritized findings with the evidence standards (frequency as "N of M (X%)", 3+ citations with transcript ids + turns + quotes, specific fix), and the mandatory "Needs Deeper Investigation" section.',
    'Return the structured report object. Output raw JSON only — no markdown fences.',
  ].join('\n');
}

const synthAgent = new Agent({
  id: 'analyze-synth',
  name: 'analyze-synth',
  instructions: synthInstructions(),
  model: mainModel,
  defaultOptions: { maxSteps: 1, modelSettings: { maxOutputTokens: 8000 } },
});

// Deep reads reuse the debug-agent (main tier + skill workspace), built once.
let debugAgentCache: Agent | undefined;
async function getDebugAgent(): Promise<Agent> {
  if (!debugAgentCache) {
    const ws = await getSkillWorkspace().catch(() => undefined);
    debugAgentCache = buildDebugAgent({}, ws);
  }
  return debugAgentCache;
}

// ---------- steps ----------
const collectStep = createStep({
  id: 'collect',
  inputSchema: workflowInputSchema,
  outputSchema: z.array(itemSchema),
  execute: async ({ inputData }) => {
    const transcripts = inputData.transcripts;
    if (!transcripts || transcripts.length === 0) {
      throw new Error(
        'analyze-transcripts: provide transcripts[] (inline {id, raw}). Live fetch by projectID is pending VF_MCP_TOKEN wiring.',
      );
    }
    return transcripts.map((t) => ({ id: t.id, rendered: renderTranscript(parseTranscript(extractLogs(t.raw))) }));
  },
});

const triageStep = createStep({
  id: 'triage',
  inputSchema: itemSchema,
  outputSchema: triageSchema,
  execute: async ({ inputData, getInitData }) => {
    const focus = (getInitData() as { focus?: string }).focus ?? '';
    const run = await generateStructured(
      triageAgent,
      `Triage this transcript.${focus ? ` Analysis focus: ${focus}.` : ''}\n\n=== TRANSCRIPT ${inputData.id} ===\n${inputData.rendered.slice(0, 24000)}`,
      triageModelSchema,
      { maxSteps: 1, maxTokens: 1500 },
    );
    const r = run.result;
    return {
      id: inputData.id,
      rendered: inputData.rendered,
      turnCount: r?.turnCount ?? 0,
      outcome: r?.outcome ?? 'unknown',
      evalFailures: r?.evalFailures ?? [],
      potentialIssues: r?.potentialIssues ?? [],
      severityScore: r?.severityScore ?? 0,
    };
  },
});

const selectStep = createStep({
  id: 'select',
  inputSchema: z.array(triageSchema),
  outputSchema: z.array(selectedSchema),
  execute: async ({ inputData, getInitData }) => {
    const maxDeep = (getInitData() as { maxDeepReads?: number }).maxDeepReads ?? 5;
    const sorted = [...inputData].sort((a, b) => b.severityScore - a.severityScore);
    const worst = sorted.slice(0, maxDeep);
    const contrast = sorted.filter((t) => !worst.includes(t)).slice(-2); // a couple lowest-severity for contrast
    const picked = new Map<string, (typeof sorted)[number]>();
    for (const t of [...worst, ...contrast]) picked.set(t.id, t);
    return [...picked.values()].map((t) => ({
      id: t.id,
      rendered: t.rendered,
      triageSummary: `outcome=${t.outcome} severity=${t.severityScore} issues=[${t.potentialIssues.join('; ')}]`,
    }));
  },
});

const deepReadStep = createStep({
  id: 'deep-read',
  inputSchema: selectedSchema,
  outputSchema: deepReadSchema,
  execute: async ({ inputData, getInitData }) => {
    const focus = (getInitData() as { focus?: string }).focus ?? '';
    const agent = await getDebugAgent();
    const prompt = [
      'Debug this Voiceflow transcript using your methodology.',
      `Reported focus: ${focus || '(none — identify the most significant failure)'}`,
      `Triage signal: ${inputData.triageSummary}`,
      '',
      'The transcript is provided inline; debug it directly.',
      '',
      `=== PARSED TRANSCRIPT ${inputData.id} ===`,
      inputData.rendered,
    ].join('\n');
    const run = await runDebug(agent, prompt);
    return { id: inputData.id, triageSummary: inputData.triageSummary, debug: run.result };
  },
});

const synthesizeStep = createStep({
  id: 'synthesize',
  inputSchema: z.array(deepReadSchema),
  outputSchema: reportSchema,
  execute: async ({ inputData, getInitData, getStepResult }) => {
    const focus = (getInitData() as { focus?: string }).focus ?? '';
    let triage: z.infer<typeof triageSchema>[] = [];
    try {
      triage = (getStepResult(triageStep) as unknown as z.infer<typeof triageSchema>[]) ?? [];
    } catch {
      /* triage results unavailable — synthesize from deep reads only */
    }

    const triageTable = triage
      .map(
        (t) =>
          `- ${t.id}: outcome=${t.outcome} sev=${t.severityScore} evalFails=[${t.evalFailures.join(', ')}] issues=[${t.potentialIssues.join('; ')}]`,
      )
      .join('\n');
    const deepReads = inputData
      .map((d) => `### ${d.id}\n${d.debug ? JSON.stringify(d.debug, null, 2) : '(no structured diagnosis)'}`)
      .join('\n\n');

    const prompt = [
      `Focus: ${focus || '(general health check)'}`,
      '',
      `TRIAGE TABLE (${triage.length || inputData.length} transcripts):`,
      triageTable || '(triage table unavailable)',
      '',
      `DEEP-READ DIAGNOSES (${inputData.length}):`,
      deepReads,
      '',
      'Produce the cross-correlation + prioritized findings report.',
    ].join('\n');

    const run = await generateStructured(synthAgent, prompt, reportSchema, { maxSteps: 1, maxTokens: 8000 });
    return (
      run.result ?? {
        summary: 'Synthesis did not return valid structured output.',
        transcriptsAnalyzed: triage.length || inputData.length,
        deepRead: inputData.length,
        crossCorrelation: [],
        findings: [],
        needsDeeperInvestigation: ['Synthesis step failed to produce structured output; re-run.'],
      }
    );
  },
});

export const analyzeTranscriptsWorkflow = createWorkflow({
  id: 'analyze-transcripts',
  inputSchema: workflowInputSchema,
  outputSchema: reportSchema,
})
  .then(collectStep)
  .foreach(triageStep, { concurrency: 5 })
  .then(selectStep)
  .foreach(deepReadStep, { concurrency: 3 })
  .then(synthesizeStep)
  .commit();
