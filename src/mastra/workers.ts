import { Agent } from '@mastra/core/agent';
import type { Workspace } from '@mastra/core/workspace';
import type { Memory } from '@mastra/memory';
import { loadMarkdownBody } from '../lib/loadPrompt';
import { makeContextProcessors } from './memory';
import { makeStreamSlimmer } from './streamSlimmer';
import { mainModel, triageModel } from './models';
import { updatePlanTool } from '../tools/updatePlan';
import { grepTranscriptsTool } from '../tools/grepTranscripts';

/**
 * Live checklist tool (see tools/updatePlan). Attached to workers that do complex multi-step
 * work via the `tasks` spec flag. The agent calls it with the full plan; the list rides out
 * on the tool-call args (forwarded during delegation) and the /demo widget renders it.
 * No native task-store/threadState dependency — those error on sub-agents that lack a thread.
 */
const PLAN_TOOLS = { update_plan: updatePlanTool } as const;
import { loadPromptingGuideTool } from '../tools/promptingGuide';
import { diffPromptsTool } from '../tools/diffPrompts';
import { resolveToolsArg, type ToolsArg } from './dynamicTools';

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
  /** Primary skill names (skills/<name>/SKILL.md). Loaded on demand via the skill tool, named in the preamble. */
  skills: string[];
  tier: Tier;
  maxTokens?: number;
  /** Local (non-MCP) createTool tools to attach, keyed by tool name. */
  localTools?: Record<string, unknown>;
  /** Attach Mastra's native live to-do list (task tools + state processor) for multi-step work. */
  tasks?: boolean;
}

const TIER_MODEL: Record<Tier, typeof mainModel> = {
  main: mainModel,
  triage: triageModel,
};

const DEFAULT_MAX_TOKENS = 8000;
// Tool-step budget per agent run. A full one-shot build (project + global prompt + KB
// docs + playbook + functions + routing + compile, plus a few retries) needs well over
// a dozen tool calls, so 12 capped it mid-build ("reached maxSteps while tool calls were
// still pending"). 40 gives ample headroom; the 600s function timeout + per-step
// maxOutputTokens remain the real runaway backstops. Override via AGENT_MAX_STEPS.
const DEFAULT_MAX_STEPS = Number(process.env.AGENT_MAX_STEPS ?? 40);

/**
 * Shared grounding. The plugin methodology sometimes uses older MCP op names;
 * this maps workers to the LIVE Voiceflow MCP surface and restates the hard rules.
 */
export const LIVE_TOOL_REFERENCE = [
  '# Live Voiceflow MCP tools',
  'Your tools come from the Voiceflow MCP, namespaced voiceflow_*. Each takes an `operation` parameter.',
  'CRITICAL — environmentID for draft-editing tools (global_prompt, agent_instructions, routing, playbook, workflow, function, variable, …): resolve it from voiceflow_project.get. v1.3 projects (have an `environments` map) → use environments[Main].draftVersionID. v1.2 projects (have devVersion/liveVersion) → use devVersion (or activeEnvironmentID). NEVER pass the environment id (environments[].id) or the alias "development" — they fail with "Version does not exist" / a 500. (voiceflow_environment.* ops are the exception: they take the real environment id.)',
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

/**
 * Shared voice + interaction style for every agent. The copilot UI shows reasoning and
 * tool calls separately, so the agent's WRITTEN messages are the product. This makes them
 * act and talk like a sharp, candid teammate — concise, ID-free, biased to action —
 * rather than an operations log. GLM honors concrete WRONG/RIGHT examples, so we give them.
 */
export const COMMS_STYLE = `# Voice — how you talk and act

Your reasoning and tool calls render separately in the UI, so your WRITTEN messages are the product. Communicate like a sharp, candid teammate walking someone through the work — not a script logging operations.

## Keep messages clean
- Lead with the point. Be concise and skimmable — a short heading, a small table, or a few bullets (the UI renders markdown). No preamble, no filler, no flattery ("Great question!", "I'd be happy to...").
- NEVER print raw IDs: projectID, environmentID, draftVersionID, playbookID, documentID, functionID, toolCallId, API keys. Name things in human terms — "the project", "the Book a Visit playbook", "the knowledge base".
- Don't narrate internal mechanics: tool/operation names, captureResponse, pathOrder, "the field expects an array", draft-vs-environment IDs, compile internals.
- Report honestly but not noisily. State what happened plainly, no hedging. A handled internal snag is one plain phrase or nothing — never a stack trace or a validation dump. Only surface a problem the user must act on.
  WRONG: "playbook.create succeeded (playbookID 6a3e2036…). Now calling tool.create with captureResponse mapping current_answer → var 6a3e…"
  RIGHT: "Booking playbook's in and wired to the question function. Next: routing, then a quick test."
  WRONG: "Function returned invalid path 'success' not in expected paths '[]'. pathOrder only sets ordering, so I must register paths…"
  RIGHT: "Hit a snag where the function's paths weren't registered — fixed it, and the test passes now."

## Act — don't ask permission for the obvious
- On a clear brief, BUILD it. Make sensible default decisions and state them in a line; don't stop to confirm each step. It's a draft — reversible.
- Give a recommendation, not a menu. End on the next step you're taking or recommend, not an open "what would you like to do?". Offer choices only when they genuinely diverge.
- Pause for confirmation ONLY when a decision is truly the user's (a real fork, no clear default) OR the action is hard to reverse / outward-facing — publishing to live, merging to Main, deleting, anything an end-user sees.
  WRONG: "Here's the full global prompt [400 words]. Should I apply it? Once you confirm I'll build the playbook."
  RIGHT: "Global prompt set — friendly local-pro persona, prices and hours locked in. Building the booking playbook next."
- Be candid. If the brief is thin, an idea is weak, or a result looks off, say so directly and recommend the fix — don't bury it or rubber-stamp.

Default to brevity and momentum: the user wants to watch an agent take shape, not approve each keystroke.`;

/** Instructions = agent .md body + a skill-loading preamble + the live tool reference.
 *  Skill BODIES are no longer injected — they're loaded on demand via the workspace skill tools. */
function instructionsFor(spec: { agentFile: string; skills: string[] }): string {
  const body = loadMarkdownBody(spec.agentFile);
  const primary = spec.skills.map((s) => `\`${s}\``).join(', ');
  const skillNote = spec.skills.length
    ? [
        '\n\n---\n\n# Skills (load on demand)',
        `Your methodology lives in skills, not in this prompt. BEFORE substantive work, load your primary skill(s) with the \`skill\` tool: ${primary}.`,
        'Use `skill_search` to discover other relevant skills (e.g. environments, wiring-architect, prompting, knowledge-base) and `skill_read` for a skill’s reference files. Do not work from memory — load the skill.',
      ].join('\n')
    : '';
  return [body, skillNote, `\n\n---\n\n${LIVE_TOOL_REFERENCE}`, `\n\n---\n\n${COMMS_STYLE}`].join('');
}

/** Build a synchronous worker agent from its .md + model tier, with the shared skill workspace. */
export function buildWorker(
  spec: WorkerSpec,
  tools: ToolsArg = {},
  workspace?: Workspace,
  memory?: Memory,
): Agent {
  // Resolve the Voiceflow MCP toolset per-request (lazy/self-healing) and merge in the
  // worker's static local tools each time.
  const vfTools = resolveToolsArg(tools);
  return new Agent({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    instructions: instructionsFor(spec),
    model: TIER_MODEL[spec.tier],
    tools: async (ctx: any) => ({
      ...(await vfTools(ctx)),
      ...(spec.localTools ?? {}),
      ...(spec.tasks ? PLAN_TOOLS : {}),
    }),
    workspace,
    memory,
    // Token-budget the assembled context (window + recall + working memory) at every step.
    inputProcessors: makeContextProcessors(),
    defaultOptions: {
      maxSteps: DEFAULT_MAX_STEPS,
      modelSettings: { maxOutputTokens: spec.maxTokens ?? DEFAULT_MAX_TOKENS },
    },
  });
}

/**
 * The orchestrator = Mastra supervisor. Its `agents` map auto-creates an
 * `agent-<key>` tool per worker; it routes using its instructions + each
 * worker's description. We inject ONLY orchestrator.md (routing logic).
 */
export function buildOrchestrator(
  agents: Record<string, Agent>,
  tools: ToolsArg = {},
  workspace?: Workspace,
  memory?: Memory,
): Agent {
  const vfTools = resolveToolsArg(tools);
  return new Agent({
    id: 'orchestrator',
    name: 'orchestrator',
    description:
      'Voiceflow copilot supervisor. Routes requests to specialized workers (build, debug, review, audit-kb, setup-evals, test-runner).',
    instructions: `${loadMarkdownBody('agents/orchestrator.md')}\n\n---\n\n${COMMS_STYLE}`,
    model: mainModel,
    // grep_transcripts exposed for ad-hoc "find every chat where X" without delegating.
    tools: async (ctx: any) => ({ ...(await vfTools(ctx)), grep_transcripts: grepTranscriptsTool }),
    agents,
    workspace,
    memory,
    inputProcessors: makeContextProcessors(),
    // Drop the heavy sub-agent lifecycle chunks forwarded during delegation (see streamSlimmer):
    // ~7x smaller stream, which keeps long mobile builds from dropping the connection mid-build.
    outputProcessors: [makeStreamSlimmer()],
    defaultOptions: {
      maxSteps: DEFAULT_MAX_STEPS,
      modelSettings: { maxOutputTokens: DEFAULT_MAX_TOKENS },
    },
  });
}

/**
 * Synchronous workers ported from the plugin (model tiers matched:
 * opus -> main, sonnet -> triage). analyze-transcripts is a sequential-batched
 * v1 (no parallel-triage infra yet — added later if bulk runs get slow). The
 * remaining infra-heavy workers (prompt-optimizer, memory/learn) are still out —
 * they need durable workflows/jobs/stores.
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
    localTools: { loadPromptingGuide: loadPromptingGuideTool, diffPrompts: diffPromptsTool },
    tasks: true,
  },
  {
    key: 'analyze-transcripts-agent',
    id: 'analyze-transcripts-agent',
    name: 'analyze-transcripts-agent',
    description:
      'Bulk transcript analysis — pulls recent transcripts, triages them, deep-reads the worst, correlates failure patterns, and returns prioritized findings with evidence and fixes. Route here for agent health checks, "what\'s going wrong across conversations", or systemic-issue hunts (not a single transcript — that\'s debug-agent).',
    agentFile: 'agents/analyze-transcripts-agent.md',
    skills: ['debug'],
    tier: 'main',
    localTools: { grep_transcripts: grepTranscriptsTool },
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
    localTools: { loadPromptingGuide: loadPromptingGuideTool, diffPrompts: diffPromptsTool },
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
