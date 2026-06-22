import { Mastra } from '@mastra/core';
import type { Agent } from '@mastra/core/agent';
import { buildDebugAgent } from './agents/debugAgent';
import { buildWorker, buildOrchestrator, WORKER_SPECS } from './workers';
import { getVoiceflowTools } from './mcp';
import { getSkillWorkspace } from './workspace';
import { analyzeTranscriptsWorkflow } from './workflows/analyzeTranscripts';
import { promptOptimizerWorkflow } from './workflows/promptOptimizer';
import { LibSQLStore } from '@mastra/libsql';
import { VercelDeployer } from '@mastra/deployer-vercel';
import { hasVoiceflowToken, hasGlmKey } from '../config/env';

// On a serverless target only /tmp is writable, so the workflow store lives there
// (ephemeral per-instance — fine for a demo). Locally it's a repo-root file.
const isServerless = Boolean(process.env.VERCEL);
const storageUrl = process.env.STORAGE_URL ?? (isServerless ? 'file:/tmp/copilot.db' : 'file:copilot.db');

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

// Workers (debug has its own structured-output helper; the rest come from specs).
const workers: Record<string, Agent> = {
  'debug-agent': buildDebugAgent(vfTools, workspace),
};
for (const spec of WORKER_SPECS) {
  workers[spec.key] = buildWorker(spec, vfTools, workspace);
}

// Supervisor: delegates to the workers (auto `agent-<key>` tools).
const orchestrator = buildOrchestrator(workers, vfTools, workspace);

export const mastra = new Mastra({
  agents: { orchestrator, ...workers },
  workflows: {
    'analyze-transcripts': analyzeTranscriptsWorkflow,
    'prompt-optimizer': promptOptimizerWorkflow,
  },
  // Durable store for workflow runs (and removes the in-memory warning).
  storage: new LibSQLStore({ id: 'copilot', url: storageUrl }),
  // Build-time only: emits a Vercel Build Output API bundle (with the Studio SPA).
  // maxDuration is env-driven so it can be tuned to the target plan's ceiling
  // (Hobby 60s / Pro 300s) — agent runs are long, so give them as long as allowed.
  deployer: new VercelDeployer({
    studio: true,
    maxDuration: Number(process.env.VERCEL_FN_MAX_DURATION ?? 60),
  }),
});
