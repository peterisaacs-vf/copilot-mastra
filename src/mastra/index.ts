import { Mastra } from '@mastra/core';
import type { Agent } from '@mastra/core/agent';
import { buildDebugAgent } from './agents/debugAgent';
import { buildWorker, buildOrchestrator, WORKER_SPECS } from './workers';
import { getVoiceflowTools } from './mcp';
import { getSkillWorkspace } from './workspace';
import { analyzeTranscriptsWorkflow } from './workflows/analyzeTranscripts';
import { promptOptimizerWorkflow } from './workflows/promptOptimizer';
import { VercelDeployer } from '@mastra/deployer-vercel';
import { MastraEditor } from '@mastra/editor';
import { getStorage, hasPostgres } from './storage';
import { buildMemory } from './memory';
import { hasVoiceflowToken, hasGlmKey } from '../config/env';

if (!hasGlmKey()) {
  console.warn(
    '[glm] GLM_API_KEY not set — Studio will load and you can browse agents/workflows, ' +
      'but agent/model calls will fail until you set GLM_API_KEY.',
  );
}

// Voiceflow MCP tools — graceful no-token fallback so Studio still boots.
let vfTools: Record<string, any> = {};
if (hasVoiceflowToken()) {
  try {
    vfTools = await getVoiceflowTools();
    console.info(`[voiceflow-mcp] loaded ${Object.keys(vfTools).length} tools`);
  } catch (err) {
    console.warn('[voiceflow-mcp] failed to load tools:', (err as Error).message);
  }
} else {
  console.warn(
    '[voiceflow-mcp] VF_MCP_TOKEN not set — agents boot WITHOUT Voiceflow tools. ' +
      'Set VF_MCP_TOKEN in .env to enable live transcript/KB/eval/test access.',
  );
}

// Shared skill workspace — exposes all SKILL.md under skills/ as on-demand skill
// tools. If it fails to init, agents still boot (without skill tooling).
let workspace: Awaited<ReturnType<typeof getSkillWorkspace>> | undefined;
try {
  workspace = await getSkillWorkspace();
  console.info('[workspace] skill workspace ready');
} catch (err) {
  console.warn('[workspace] failed to init skill workspace:', (err as Error).message);
}

// Shared agent memory: conversation threads + semantic recall. Durable only with
// a Postgres connection string; otherwise undefined on serverless (see buildMemory).
const memory = buildMemory();
console.info(
  memory
    ? `[memory] enabled (${hasPostgres() ? 'postgres' : 'libsql'} + semantic recall)`
    : '[memory] not enabled — set DATABASE_URL (Postgres) to turn on durable memory',
);

// Workers (debug has its own structured-output helper; the rest come from specs).
const workers: Record<string, Agent> = {
  'debug-agent': buildDebugAgent(vfTools, workspace, memory),
};
for (const spec of WORKER_SPECS) {
  workers[spec.key] = buildWorker(spec, vfTools, workspace, memory);
}

// Supervisor: delegates to the workers (auto `agent-<key>` tools).
const orchestrator = buildOrchestrator(workers, vfTools, workspace, memory);

export const mastra = new Mastra({
  agents: { orchestrator, ...workers },
  workflows: {
    'analyze-transcripts': analyzeTranscriptsWorkflow,
    'prompt-optimizer': promptOptimizerWorkflow,
  },
  // Durable store: Postgres (Neon) when DATABASE_URL is set, else LibSQL (/tmp on
  // serverless). Backs workflow runs, memory threads, and the editor.
  storage: getStorage(),
  // Editor: lets Studio manage/version agent instructions + prompt blocks (stored
  // in `storage`). Durable with Postgres; ephemeral on the /tmp fallback.
  editor: new MastraEditor(),
  // Build-time only: emits a Vercel Build Output API bundle (with the Studio SPA).
  // maxDuration is env-driven so it can be tuned to the target plan's ceiling
  // (Hobby 60s / Pro 300s) — agent runs are long, so give them as long as allowed.
  deployer: new VercelDeployer({
    studio: true,
    maxDuration: Number(process.env.VERCEL_FN_MAX_DURATION ?? 60),
  }),
});
