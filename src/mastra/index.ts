import { Mastra } from '@mastra/core';
import { buildDebugAgent } from './agents/debugAgent';
import { getVoiceflowTools } from './mcp';
import { hasVoiceflowToken } from '../config/env';

// Load the Voiceflow MCP toolset at startup. If no token is set yet, the agent
// still boots (without VF tools) so Mastra Studio is usable during bring-up.
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
    '[voiceflow-mcp] VF_MCP_TOKEN not set — debug-agent boots WITHOUT Voiceflow tools. ' +
      'Set VF_MCP_TOKEN in .env to enable live transcript/KB/eval access.',
  );
}

export const debugAgent = buildDebugAgent(vfTools);

export const mastra = new Mastra({
  agents: { debugAgent },
});
