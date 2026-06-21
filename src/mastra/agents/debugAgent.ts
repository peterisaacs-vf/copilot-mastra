import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { mainModel } from '../models';
import { loadMarkdownBody } from '../../lib/loadPrompt';

/**
 * Structured result of a single-transcript debug. Core fields
 * (rootCauseCategory, problemTurn, evidence, fix) match the spec; summary /
 * confidence / needsDeeperInvestigation come straight from the debug-agent.md
 * methodology ("Needs Deeper Investigation").
 */
export const debugResultSchema = z.object({
  summary: z.string().describe('One-sentence statement of the root cause.'),
  rootCauseCategory: z
    .enum(['prompt', 'tool', 'wiring', 'context', 'edge_case', 'other'])
    .describe('Primary root-cause category (debug methodology Step 3).'),
  problemTurn: z
    .number()
    .int()
    .nullable()
    .describe('Turn number where the failure first appeared; null if not turn-specific.'),
  evidence: z
    .string()
    .describe(
      'Exact agent quote(s) plus the prompt.system / tool I/O cross-reference that proves the diagnosis.',
    ),
  fix: z
    .string()
    .describe('Concrete fix: exact text to add/change and WHERE (agent / playbook / section).'),
  confidence: z.enum(['low', 'medium', 'high']),
  needsDeeperInvestigation: z
    .array(z.string())
    .default([])
    .describe('Gaps you could not verify, each with the specific next step.'),
});

export type DebugResult = z.infer<typeof debugResultSchema>;

const LIVE_TOOL_REFERENCE = [
  '# Live Voiceflow MCP tools (current operation names)',
  'Your tools come from the Voiceflow MCP and are namespaced voiceflow_*. The methodology text',
  'above may use older operation names; on the LIVE server use these:',
  "- voiceflow_transcript: operation 'get' (projectID + transcript_id) or 'get_from_url' (a Creator",
  "  UI URL) or 'search'. Use format 'formatted' for single-transcript debug — it includes",
  "  prompt.system per agent on the first ai result, which is your Step 2 source. 'summary' is for triage.",
  "- voiceflow_evaluation: 'list' to see evals, 'get' for one eval's config, 'run' to score transcripts.",
  "- voiceflow_knowledge_base: 'query' (set synthesis false for raw chunks), 'list_documents'.",
  "- voiceflow_playbook: 'get' for a playbook's exact prompt, 'list' to enumerate. Pull the specific",
  '  playbook rather than exporting the whole agent.',
  '- voiceflow_project / voiceflow_environment: when you need project/environment IDs.',
  'Never fabricate data a tool did not return. If a transcript is already provided to you inline, debug it',
  'directly without re-fetching.',
].join('\n');

const OUTPUT_CONTRACT = [
  '# Output contract',
  'When you have finished the methodology, return ONLY the structured object you are asked for:',
  '- summary: one sentence root cause',
  '- rootCauseCategory: one of prompt | tool | wiring | context | edge_case | other',
  '- problemTurn: the turn number where it first went wrong (null if not turn-specific)',
  '- evidence: exact agent quote(s) + the prompt.system / tool cross-reference that proves it',
  '- fix: the concrete change (exact text + where it goes)',
  '- confidence: low | medium | high',
  '- needsDeeperInvestigation: gaps you could not verify, each with the next step',
].join('\n');

/** Compose instructions from the source-of-truth files + live grounding. */
function buildDebugInstructions(): string {
  const agentBody = loadMarkdownBody('agents/debug-agent.md');
  const skillBody = loadMarkdownBody('skills/debug/SKILL.md');
  return [
    agentBody,
    '\n\n---\n\n# Debug methodology (skill: debug)\n\n',
    skillBody,
    '\n\n---\n\n',
    LIVE_TOOL_REFERENCE,
    '\n\n',
    OUTPUT_CONTRACT,
  ].join('');
}

export const DEBUG_AGENT_DESCRIPTION =
  'Systematic Voiceflow transcript debugger. Diagnoses a single transcript — finds the problem turn, the root-cause category, the evidence, and the concrete fix. Pre-loaded with the full debug methodology.';

/**
 * Build the debug-agent. `tools` is the Voiceflow MCP toolset (from
 * `getVoiceflowTools()`); pass `{}` to run on an inline transcript with no tools.
 */
/**
 * Loop + output guardrails (gotcha #2). maxSteps bounds TOOL steps; it does NOT
 * bound generation length — GLM 5.2 reasons heavily and, uncapped, a single
 * generation ran ~22 minutes. The real cost/latency guardrail is the token cap,
 * which lives under modelSettings.maxTokens (Mastra's CallSettings field).
 */
export const DEBUG_MAX_STEPS = 12;
export const DEBUG_MAX_TOKENS = 8000;

export function buildDebugAgent(tools: Record<string, any> = {}): Agent {
  return new Agent({
    id: 'debug-agent',
    name: 'debug-agent',
    description: DEBUG_AGENT_DESCRIPTION,
    instructions: buildDebugInstructions(),
    model: mainModel,
    tools,
    defaultOptions: {
      maxSteps: DEBUG_MAX_STEPS,
      modelSettings: { maxOutputTokens: DEBUG_MAX_TOKENS },
    },
  });
}

/**
 * Run the debug-agent and get the validated structured result in `res.object`.
 *
 * jsonPromptInjection:true is REQUIRED for GLM over the OpenAI-compatible endpoint —
 * without it the model emits ad-hoc JSON and Mastra leaves res.object undefined.
 * modelSettings.maxTokens bounds the reasoning so the call actually terminates.
 */
export async function runDebug(agent: Agent, input: string) {
  return agent.generate(input, {
    maxSteps: DEBUG_MAX_STEPS,
    modelSettings: { maxOutputTokens: DEBUG_MAX_TOKENS },
    structuredOutput: {
      schema: debugResultSchema,
      jsonPromptInjection: true,
      errorStrategy: 'warn',
    },
  });
}
