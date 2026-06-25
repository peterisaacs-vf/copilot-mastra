import { MCPClient } from '@mastra/mcp';
import { env, useVoiceflowOAuth } from '../config/env';
import { makeVoiceflowOAuthProvider } from './oauth';

/**
 * The Voiceflow MCP is the agents' toolset (transcripts, prompts, KB, evals,
 * test conversations, analytics, ...). It's an OAuth-protected streamable-HTTP
 * server. Two auth modes:
 *   - 'token' (default): static bearer from VF_MCP_TOKEN (simplest; fine while the
 *     token is valid).
 *   - 'oauth': MCPOAuthClientProvider handles the authorization-code flow + automatic
 *     refresh. Requires a one-time consent via /oauth/start (see ./oauth.ts).
 */
export function createVoiceflowMcp(): MCPClient {
  if (useVoiceflowOAuth()) {
    return new MCPClient({
      id: 'voiceflow',
      servers: {
        voiceflow: {
          url: new URL(env.vf.mcpUrl),
          authProvider: makeVoiceflowOAuthProvider(),
          // Default connect timeout is 3s; the OAuth handshake + cold connect to the prod
          // MCP regularly exceeds it, which fails the Streamable HTTP connect, falls back
          // to SSE (405), and boots the instance with 0 tools. Raise connect + request timeouts.
          connectTimeout: 30000,
          timeout: 30000,
        },
      },
    });
  }
  if (!env.vf.mcpToken) {
    throw new Error(
      'VF_MCP_TOKEN is not set — cannot connect to the Voiceflow MCP. Set it in .env, ' +
        'or set VF_AUTH_MODE=oauth to use the OAuth flow.',
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
        connectTimeout: 30000,
        timeout: 30000,
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
