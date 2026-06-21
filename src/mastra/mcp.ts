import { MCPClient } from '@mastra/mcp';
import { env } from '../config/env';

/**
 * The Voiceflow MCP is the agents' toolset (transcripts, prompts, KB, evals,
 * test conversations, analytics, ...). It's an OAuth-protected streamable-HTTP
 * server; we authenticate with a bearer token from env.
 */
export function createVoiceflowMcp(): MCPClient {
  if (!env.vf.mcpToken) {
    throw new Error(
      'VF_MCP_TOKEN is not set — cannot connect to the Voiceflow MCP. Set it in .env.',
    );
  }
  return new MCPClient({
    id: 'voiceflow',
    servers: {
      voiceflow: {
        url: new URL(env.vf.mcpUrl),
        requestInit: {
          headers: { Authorization: `Bearer ${env.vf.mcpToken}` },
        },
      },
    },
  });
}

export type VoiceflowToolset = Awaited<ReturnType<MCPClient['listTools']>>;

/**
 * Static toolset for the Agent constructor. Tools are namespaced
 * `voiceflow_<toolName>` by the MCP client.
 */
export async function getVoiceflowTools(): Promise<VoiceflowToolset> {
  const mcp = createVoiceflowMcp();
  return mcp.listTools();
}
