import { MCPClient } from '@mastra/mcp';
import { env, useVoiceflowOAuth } from '../config/env';
import { makeVoiceflowAuthFetch } from './oauth';

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
    // NOTE: we do NOT pass an `authProvider`. Voiceflow access tokens live ~60s and the
    // SDK's OAuth provider forces a refresh on every connect and re-runs the full
    // authorization flow on any refresh hiccup — which fails headless and boots 0 tools.
    // Instead we run in plain-bearer mode with a custom `fetch` that injects a freshly
    // minted token per request (see makeVoiceflowAuthFetch / the token manager in oauth.ts).
    return new MCPClient({
      id: 'voiceflow',
      servers: {
        voiceflow: {
          url: new URL(env.vf.mcpUrl),
          fetch: makeVoiceflowAuthFetch() as any,
          // Cold connect to the prod MCP can exceed the 3s default; give it headroom.
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
