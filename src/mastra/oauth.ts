import { MCPOAuthClientProvider, InMemoryOAuthStorage, auth } from '@mastra/mcp';
import type { OAuthStorage } from '@mastra/mcp';
import { env } from '../config/env';
import { getPostgresUrl } from './storage';
import { PgOAuthStorage } from './oauthStore';

/**
 * Voiceflow MCP OAuth (authorization-code + refresh, public client + PKCE).
 *
 * Confirmed from the server's discovery docs:
 *   - resource:            https://mcp.voiceflow.com/mcp
 *   - authorization server: https://auth-api.voiceflow.com (auto-discovered)
 *   - scopes:              universal.workspace.read / .write
 *   - grant types:         authorization_code, refresh_token (NO client_credentials,
 *                          so a one-time human consent is required; we then refresh)
 *   - token auth method:   none (public client — no client secret)
 *   - DCR + discovery:     enabled (the provider self-registers and finds endpoints)
 *
 * Everything the provider needs (registered client, PKCE verifier, tokens) is kept in
 * `storage`, which MUST be persistent + shared across requests on serverless — see
 * PgOAuthStorage. The MCP server URL comes from VF_MCP_URL, so pointing that at a
 * staging server makes discovery resolve the staging auth server automatically.
 */
const SCOPE = 'universal.workspace.read universal.workspace.write';

const CLIENT_METADATA = {
  redirect_uris: [env.vf.oauthRedirectUrl],
  client_name: 'Voiceflow Copilot (Mastra)',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
  scope: SCOPE,
};

// One shared storage instance so /oauth/start, /oauth/callback, and the MCP client
// all read/write the same backing store (critical: the code verifier saved during
// start must be readable during the callback, possibly on another instance).
let storageSingleton: OAuthStorage | undefined;
function storage(): OAuthStorage {
  if (!storageSingleton) {
    const url = getPostgresUrl();
    storageSingleton = url ? new PgOAuthStorage(url) : new InMemoryOAuthStorage();
    if (!url) {
      console.warn(
        '[vf-oauth] No Postgres URL — using in-memory OAuth storage. Tokens will NOT ' +
          'survive cold starts and start/callback may land on different instances. Set DATABASE_URL.',
      );
    }
  }
  return storageSingleton;
}

/** Build a provider bound to the shared store. `onRedirect` captures the authorize URL. */
export function makeVoiceflowOAuthProvider(
  onRedirect?: (url: URL) => void,
): MCPOAuthClientProvider {
  return new MCPOAuthClientProvider({
    redirectUrl: env.vf.oauthRedirectUrl,
    clientMetadata: CLIENT_METADATA,
    storage: storage(),
    onRedirectToAuthorization:
      onRedirect ?? ((url) => console.info(`[vf-oauth] authorize at: ${url.toString()}`)),
  });
}

/**
 * Begin the one-time consent. Returns the authorization URL to send the human to,
 * or null if we already hold valid tokens (no consent needed). Discovery + dynamic
 * client registration + PKCE all happen here; the code verifier is persisted.
 */
export async function beginVoiceflowAuthorization(): Promise<URL | null> {
  let captured: URL | undefined;
  const provider = makeVoiceflowOAuthProvider((url) => {
    captured = url;
  });
  const result = await auth(provider, { serverUrl: env.vf.mcpUrl, scope: SCOPE });
  if (result === 'AUTHORIZED') return null; // already have valid tokens
  if (!captured) throw new Error('OAuth start did not produce an authorization URL');
  return captured;
}

/** Complete the flow: exchange the ?code from the callback for tokens (persisted). */
export async function completeVoiceflowAuthorization(code: string): Promise<void> {
  const provider = makeVoiceflowOAuthProvider();
  const result = await auth(provider, { serverUrl: env.vf.mcpUrl, authorizationCode: code });
  if (result !== 'AUTHORIZED') throw new Error(`OAuth callback did not authorize (got: ${result})`);
}

/** Whether we currently hold valid (non-expired) tokens. */
export async function hasVoiceflowTokens(): Promise<boolean> {
  try {
    return await makeVoiceflowOAuthProvider().hasValidTokens();
  } catch {
    return false;
  }
}
