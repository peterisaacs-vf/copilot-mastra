import { Mastra } from '@mastra/core';
import type { Agent } from '@mastra/core/agent';
import { buildDebugAgent } from './agents/debugAgent';
import { buildWorker, buildOrchestrator, WORKER_SPECS } from './workers';
import { getVoiceflowTools } from './mcp';
import { getSkillWorkspace } from './workspace';
import { hasVoiceflowToken } from '../config/env';

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
});
