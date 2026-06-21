import { Mastra } from '@mastra/core';
import type { Agent } from '@mastra/core/agent';
import { buildDebugAgent } from './agents/debugAgent';
import { buildWorker, buildOrchestrator, WORKER_SPECS } from './workers';
import { getVoiceflowTools } from './mcp';
import { hasVoiceflowToken } from '../config/env';

// Load the Voiceflow MCP toolset once at startup. Without a token the agents
// still boot (toolless) so Mastra Studio is usable during bring-up.
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

// Workers (debug has its own structured-output helper; the rest come from specs).
const workers: Record<string, Agent> = {
  'debug-agent': buildDebugAgent(vfTools),
};
for (const spec of WORKER_SPECS) {
  workers[spec.key] = buildWorker(spec, vfTools);
}

// Supervisor: routes to the workers (auto `agent-<key>` tools) and can also
// hit the VF MCP directly (e.g. list projects on startup).
const orchestrator = buildOrchestrator(workers, vfTools);

export const mastra = new Mastra({
  agents: { orchestrator, ...workers },
});
