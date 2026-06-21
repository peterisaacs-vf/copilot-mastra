import { Agent } from '@mastra/core/agent';
import { loadMarkdownBody } from '../lib/loadPrompt';
import { mainModel, triageModel } from './models';

export type Tier = 'main' | 'triage';

export interface WorkerSpec {
  /** Mastra agents-registry key -> becomes the supervisor's `agent-<key>` tool. */
  key: string;
  id: string;
  name: string;
  /** Routing description the supervisor reads to decide when to delegate. */
  description: string;
  /** agents/<x>.md — instruction body (source of truth). */
  agentFile: string;
  /** skills/<name>/SKILL.md to inject into instructions (injection mode; Workspace upgrade later). */
  skills: string[];
  tier: Tier;
  maxTokens?: number;
}

const TIER_MODEL: Record<Tier, typeof mainModel> = {
  main: mainModel,
  triage: triageModel,
};

const DEFAULT_MAX_TOKENS = 8000;
const DEFAULT_MAX_STEPS = 12;

/**
 * Shared grounding. The plugin methodology sometimes uses older MCP op names;
 * this maps workers to the LIVE Voiceflow MCP surface and restates the hard rules.
 */
export const LIVE_TOOL_REFERENCE = [
  '# Live Voiceflow MCP tools',
  'Your tools come from the Voiceflow MCP, namespaced voiceflow_*. Each takes an `operation` parameter.',
  'Key tools/ops:',
  '- voiceflow_project (list|get|get_api_key|export), voiceflow_environment (list|get|clone|publish|merge|compile)',
  '- voiceflow_playbook (list|get|create|update), voiceflow_global_prompt (get|update), voiceflow_agent_instructions (get|update), voiceflow_routing',
  '- voiceflow_function (get|list|create|update), voiceflow_api_tool, voiceflow_tool, voiceflow_variable',
  '- voiceflow_knowledge_base (query|list_documents), voiceflow_document (create/update/delete + tables/urls)',
  '- voiceflow_evaluation (list|get|create|update|run), voiceflow_transcript (search|get|get_from_url), query_analytics',
  '- voiceflow_test_conversation (interact|get_state|update_variables|delete_state)',
  'Rules: pass the right operation; never fabricate data a tool did not return; confirm before any write;',
  'never write to Main directly (clone/use a working environment); always verify after applying.',
].join('\n');

function instructionsFor(spec: { agentFile: string; skills: string[] }): string {
  const parts: string[] = [loadMarkdownBody(spec.agentFile)];
  for (const s of spec.skills) {
    parts.push(`\n\n---\n\n# Skill: ${s}\n\n${loadMarkdownBody(`skills/${s}/SKILL.md`)}`);
  }
  parts.push(`\n\n---\n\n${LIVE_TOOL_REFERENCE}`);
  return parts.join('');
}

/** Build a synchronous worker agent from its .md + skills + model tier. */
export function buildWorker(spec: WorkerSpec, tools: Record<string, any> = {}): Agent {
  return new Agent({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    instructions: instructionsFor(spec),
    model: TIER_MODEL[spec.tier],
    tools,
    defaultOptions: {
      maxSteps: DEFAULT_MAX_STEPS,
      modelSettings: { maxOutputTokens: spec.maxTokens ?? DEFAULT_MAX_TOKENS },
    },
  });
}

/**
 * The orchestrator = Mastra supervisor. Its `agents` map auto-creates an
 * `agent-<key>` tool per worker; it routes using its instructions + each
 * worker's description. We inject ONLY orchestrator.md (routing logic) — the
 * workers carry their own skills, so we don't bloat the router with all of them.
 */
export function buildOrchestrator(
  agents: Record<string, Agent>,
  tools: Record<string, any> = {},
): Agent {
  return new Agent({
    id: 'orchestrator',
    name: 'orchestrator',
    description:
      'Voiceflow copilot supervisor. Routes requests to specialized workers (build, debug, review, audit-kb, setup-evals, test-runner).',
    instructions: loadMarkdownBody('agents/orchestrator.md'),
    model: mainModel,
    tools,
    agents,
    defaultOptions: {
      maxSteps: DEFAULT_MAX_STEPS,
      modelSettings: { maxOutputTokens: DEFAULT_MAX_TOKENS },
    },
  });
}

/**
 * Synchronous workers ported from the plugin (model tiers matched:
 * opus -> main, sonnet -> triage). The infra-heavy workers
 * (analyze-transcripts, prompt-optimizer, memory/learn) are intentionally
 * NOT here — they need workflows/durable jobs/stores and are built later.
 * debug-agent lives in ./agents/debugAgent.ts (it has a structured-output helper).
 */
export const WORKER_SPECS: WorkerSpec[] = [
  {
    key: 'build-agent',
    id: 'build-agent',
    name: 'build-agent',
    description:
      'Builds, edits, and configures Voiceflow agents — global prompt, playbooks, functions, integrations, voice, cloning. Route here for any build/edit/configure request.',
    agentFile: 'agents/build-agent.md',
    skills: ['build-agent', 'document'],
    tier: 'main',
  },
  {
    key: 'review-agent',
    id: 'review-agent',
    name: 'review-agent',
    description:
      'Static architecture review — audits prompts, tools, KB, and eval coverage and produces prioritized recommendations. Route here for a full agent audit (no transcript analysis).',
    agentFile: 'agents/review-agent.md',
    skills: ['build-agent', 'document'],
    tier: 'main',
  },
  {
    key: 'audit-kb-agent',
    id: 'audit-kb-agent',
    name: 'audit-kb-agent',
    description:
      "Audits and fixes a project knowledge base — retrieval issues, content gaps, stale/duplicate docs. Route here when the bot can't find things or KB answers are weak.",
    agentFile: 'agents/audit-kb-agent.md',
    skills: ['build-agent'],
    tier: 'triage',
  },
  {
    key: 'setup-evals-agent',
    id: 'setup-evals-agent',
    name: 'setup-evals-agent',
    description:
      'Designs, creates, and calibrates evaluations from prompt rules, then verifies them against real transcripts. Route here to create or improve eval coverage.',
    agentFile: 'agents/setup-evals-agent.md',
    skills: ['test'],
    tier: 'triage',
  },
  {
    key: 'test-runner-agent',
    id: 'test-runner-agent',
    name: 'test-runner-agent',
    description:
      'Live QA tester — runs adversarial multi-turn conversations via the Dialog Manager and reports pass/fail per rule with fixes. Route here to test or stress-test the agent.',
    agentFile: 'agents/test-runner-agent.md',
    skills: ['debug'],
    tier: 'triage',
  },
];
