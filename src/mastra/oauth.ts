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
  // If a client_id is configured, pass it as pre-registered client info — this makes the
  // provider SKIP dynamic client registration (needed while the server's DCR endpoint is
  // unavailable). Public client, so the secret is usually absent.
  const clientInformation = env.vf.oauthClientId
    ? {
        client_id: env.vf.oauthClientId,
        ...(env.vf.oauthClientSecret ? { client_secret: env.vf.oauthClientSecret } : {}),
      }
    : undefined;
  const provider = new MCPOAuthClientProvider({
    redirectUrl: env.vf.oauthRedirectUrl,
    clientMetadata: CLIENT_METADATA,
    clientInformation,
    storage: storage(),
    onRedirectToAuthorization:
      onRedirect ?? ((url) => console.info(`[vf-oauth] authorize at: ${url.toString()}`)),
  });
  // RFC 8707 resource indicator. The MCP SDK's selectResourceURL() OMITS `resource`
  // entirely when no Protected Resource Metadata (PRM) was fetched AND the provider has no
  // validateResourceURL() method — which is exactly our override case: we skip MCP discovery
  // (the MCP server may be down / not advertise its auth server), so PRM is never loaded.
  // Some authorization servers (e.g. the review env) then reject /authorize with HTTP 422
  // ("resource: expected string, received undefined"). Implementing validateResourceURL()
  // makes the SDK include `resource` consistently in the authorize, token-exchange, and
  // refresh requests. We prefer the server-advertised resource when PRM is present (so the
  // production discovery path is unchanged) and otherwise fall back to the canonical MCP URL.
  (
    provider as unknown as {
      validateResourceURL: (defaultResource: URL, metadataResource?: string) => Promise<URL>;
    }
  ).validateResourceURL = async (defaultResource, metadataResource) => {
    // Explicit override wins (VF_OAUTH_RESOURCE) — needed when the auth server expects a
    // registered resource that differs from the MCP URL we connect to.
    if (env.vf.oauthResource) return new URL(env.vf.oauthResource);
    // Otherwise prefer the server-advertised resource (PRM) and fall back to the canonical MCP URL.
    return metadataResource ? new URL(metadataResource) : defaultResource;
  };
  // Authorization-server override (VF_OAUTH_AUTH_SERVER). MCPOAuthClientProvider doesn't
  // implement discoveryState(), so auth() rediscovers the auth server from the MCP server on
  // every call. Supplying discoveryState() with an authorizationServerUrl makes auth() SKIP
  // that discovery and use this server instead — it still fetches the server's OAuth
  // endpoints from its RFC 8414 discovery doc. Used to authenticate against a review/staging
  // auth server whose MCP doesn't (yet) advertise it.
  if (env.vf.oauthAuthServer) {
    (provider as unknown as { discoveryState: () => { authorizationServerUrl: string } }).discoveryState =
      () => ({ authorizationServerUrl: env.vf.oauthAuthServer });
    console.info(`[vf-oauth] authorization server overridden -> ${env.vf.oauthAuthServer}`);
  }
  return provider;
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

/**
 * Clear ALL stored OAuth state (registered client, PKCE verifier, access/refresh
 * tokens) so the next /oauth/start re-registers a fresh client and requires a new
 * consent. Needed when switching auth servers/environments — otherwise the stale
 * client_id and tokens from the previous environment are reused.
 */
export async function resetVoiceflowOAuth(): Promise<void> {
  const s = storage();
  if (s instanceof PgOAuthStorage) await s.clearAll();
  storageSingleton = undefined;
}

// ---- Runtime token manager ----------------------------------------------
//
// The Voiceflow auth server issues VERY short-lived access tokens (~60s). The MCP
// SDK's built-in OAuth (authProvider) forces a token *refresh on every connect* and
// re-runs the full authorization flow on any refresh hiccup (invalidateCredentials →
// startAuthorization) — which, headless on serverless, just fails the connect and
// boots with 0 tools. Instead of handing the SDK an authProvider, we drive auth
// ourselves: a small token manager mints a fresh access token, caches it for its
// (short) lifetime, serializes concurrent refreshes in-process, and ALWAYS persists a
// rotated refresh token. The MCPClient then runs in plain bearer mode via a custom
// `fetch` that injects the current token on every request (and force-refreshes once on
// a 401). This makes both cold-start boot and long-lived tool calls resilient to the
// 60s expiry without the SDK's fragile reauthorize-on-connect behavior.

let accessCache: { token: string; expMs: number } | undefined;
let refreshInflight: Promise<string> | undefined;
let tokenEndpointCache: string | undefined;
// Back off the token ENDPOINT after a failed refresh so we don't hammer it (the auth
// server rate-limits — 429 — and a stranded/rotated refresh token would otherwise be
// retried in a tight loop). A still-valid stored access token is used regardless of this.
let refreshCooldownUntil = 0;
let lastRefreshError: Error | undefined;

async function discoverTokenEndpoint(): Promise<string> {
  if (tokenEndpointCache) return tokenEndpointCache;
  const base = env.vf.oauthAuthServer || 'https://auth-api.voiceflow.com';
  try {
    const meta: any = await fetchWithTimeout(
      `${base.replace(/\/$/, '')}/.well-known/oauth-authorization-server`,
      { headers: { accept: 'application/json' } },
      10_000,
    ).then((r) => r.json());
    if (meta?.token_endpoint) {
      tokenEndpointCache = String(meta.token_endpoint);
      return tokenEndpointCache;
    }
  } catch {
    /* fall through to the known default */
  }
  const fallback = 'https://auth-api.voiceflow.com/v1alpha1/oauth2/token';
  tokenEndpointCache = fallback;
  return fallback;
}

function accessTokenExpMs(token: string, fallbackSec = 55): number {
  const claims = decodeJwtClaims(token);
  const exp = claims && typeof (claims as any).exp === 'number' ? (claims as any).exp : undefined;
  return exp ? exp * 1000 : Date.now() + fallbackSec * 1000;
}

/** POST grant_type=refresh_token. Returns the parsed token response (or throws). */
async function postRefresh(refreshToken: string, clientId?: string): Promise<any> {
  const endpoint = await discoverTokenEndpoint();
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPE });
  if (clientId) form.set('client_id', clientId);
  // Mirror the RFC 8707 resource indicator the original code-exchange used.
  form.set('resource', env.vf.oauthResource || env.vf.mcpUrl);
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
    },
    15_000,
  );
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`refresh failed ${res.status}: ${body?.error ?? text.slice(0, 120)}`);
    (err as any).oauthError = body?.error;
    (err as any).status = res.status;
    throw err;
  }
  return body;
}

async function doRefresh(): Promise<string> {
  const provider = makeVoiceflowOAuthProvider();
  const stored: any = await (provider as any).tokens();

  // If storage already holds a still-valid access token (e.g. another instance just
  // refreshed and persisted it), use it without spending our refresh token.
  if (stored?.access_token) {
    const expMs = accessTokenExpMs(stored.access_token);
    if (expMs - Date.now() > 10_000) {
      accessCache = { token: stored.access_token, expMs };
      return stored.access_token;
    }
  }
  if (!stored?.refresh_token) {
    throw new Error('No Voiceflow refresh token in storage — visit /oauth/start to consent.');
  }
  // Don't hit a recently-failing / rate-limited token endpoint again until the cooldown
  // elapses (the fresh-stored-token fast path above still works during the cooldown).
  if (Date.now() < refreshCooldownUntil) {
    throw lastRefreshError ?? new Error('Voiceflow token refresh cooling down after a recent failure.');
  }
  const ci: any = await (provider as any).clientInformation();
  try {
    const fresh = await postRefresh(stored.refresh_token, ci?.client_id);
    // Persist (preserve the old refresh_token if the server didn't rotate it).
    const merged = { ...stored, ...fresh, refresh_token: fresh.refresh_token ?? stored.refresh_token };
    await (provider as any).saveTokens(merged);
    const expMs = accessTokenExpMs(fresh.access_token, fresh.expires_in ?? 55);
    accessCache = { token: fresh.access_token, expMs };
    refreshCooldownUntil = 0;
    lastRefreshError = undefined;
    return fresh.access_token;
  } catch (e: any) {
    // Rotation race: another serverless instance may have already consumed this refresh
    // token and saved a newer pair. The auth server returns invalid_grant (400) OR a 500
    // for a consumed/rotated refresh token, so re-read storage on ANY failure and use the
    // newer access token if one is now present and fresh.
    const again: any = await (provider as any).tokens();
    if (again?.access_token && again.access_token !== stored.access_token) {
      const expMs = accessTokenExpMs(again.access_token);
      if (expMs - Date.now() > 5_000) {
        accessCache = { token: again.access_token, expMs };
        refreshCooldownUntil = 0;
        lastRefreshError = undefined;
        return again.access_token;
      }
    }
    // Back off the endpoint for 30s (covers 429 rate-limiting and stranded refresh tokens).
    lastRefreshError = new Error(
      `Voiceflow token refresh failed (${e?.message ?? e}). If this persists, the stored ` +
        'refresh token is no longer valid — visit /oauth/start to re-consent.',
    );
    refreshCooldownUntil = Date.now() + 30_000;
    throw lastRefreshError;
  }
}

/** Drop the in-process token cache + any backoff (e.g. right after a fresh consent). */
export function resetVoiceflowTokenCache(): void {
  accessCache = undefined;
  refreshInflight = undefined;
  refreshCooldownUntil = 0;
  lastRefreshError = undefined;
}

/** Get a currently-valid Voiceflow access token, refreshing if needed. */
export async function getFreshVoiceflowAccessToken(force = false): Promise<string> {
  if (!force && accessCache && accessCache.expMs - Date.now() > 10_000) return accessCache.token;
  if (refreshInflight) return refreshInflight;
  refreshInflight = doRefresh().finally(() => {
    refreshInflight = undefined;
  });
  return refreshInflight;
}

// ---- MCP wire sanitizers -------------------------------------------------
//
// The Voiceflow MCP exposes two JSON-Schema shapes that break host serializers; we
// neutralize both at the wire (in the custom fetch) so Mastra never sees them:
//
//   (A) Prototype-pollution key. `voiceflow_project` has a param literally named
//       `prototype`. Mastra serializes tool schemas with SuperJSON, whose pollution
//       guard hard-rejects ANY object containing a `prototype` (or `__proto__` /
//       `constructor`) key — "Detected property prototype … prototype pollution risk".
//       That throws during tool serialization and stalls agent runs to the 300s
//       timeout. We strip those keys from tools/list + tools/call response bodies.
//
//   (B) Array arg flattened to a string. `globalPrompt` / `instructions` are typed as
//       a recursive array (allOf → anyOf union); some hosts flatten that array argument
//       to a string in transit, so the server's Zod rejects writes with
//       "expected array, received string" (Linear COR-12408). We re-inflate those args
//       to arrays on outgoing tools/call requests.
//
// Both are really server-side schema warts (rename the param; flatten the schema). These
// are client-side shims so the copilot works until the MCP schemas are simplified.

const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Fields typed as arrays that some hosts flatten to a string (COR-12408).
const ARRAY_TEXT_FIELDS = ['globalPrompt', 'instructions'];

/** Rebuild a value omitting any forbidden (prototype-pollution) keys at every depth. */
function stripPollutionDeep(v: any): any {
  if (Array.isArray(v)) return v.map(stripPollutionDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v)) {
      if (POLLUTION_KEYS.has(k)) continue;
      out[k] = stripPollutionDeep(v[k]);
    }
    return out;
  }
  return v;
}

/** Apply a JSON transform to an MCP response body (plain JSON or SSE `data:` frames). */
function transformMcpBody(text: string, fn: (json: any) => any): string {
  const apply = (payload: string): string => {
    try {
      return JSON.stringify(fn(JSON.parse(payload)));
    } catch {
      return payload;
    }
  };
  if (/^\s*[[{]/.test(text)) return apply(text); // plain JSON
  return text
    .split(/\r?\n/)
    .map((line) => {
      const m = /^data:\s*(.*)$/.exec(line);
      if (!m) return line;
      const payload = m[1].trim();
      if (!payload.startsWith('{') && !payload.startsWith('[')) return line;
      return 'data: ' + apply(payload);
    })
    .join('\n');
}

/** Coerce a value that should be an array but arrived as a string back into an array. */
function inflateArrayArg(v: any): any {
  if (Array.isArray(v) || v == null) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        /* not JSON — fall through to wrapping */
      }
    }
    return [v]; // wrap a plain string as a single-element array
  }
  return v;
}

/** Re-inflate flattened array args on an outgoing tools/call request body (COR-12408). */
function fixOutgoingBody(body: unknown): unknown {
  if (typeof body !== 'string' || !body.includes('"method":"tools/call"')) return body;
  try {
    const rpc = JSON.parse(body);
    const args = rpc?.params?.arguments;
    if (!args || typeof args !== 'object') return body;
    let changed = false;
    for (const f of ARRAY_TEXT_FIELDS) {
      if (f in args && typeof args[f] === 'string') {
        args[f] = inflateArrayArg(args[f]);
        changed = true;
      }
    }
    if (!changed) return body;
    console.info(`[vf-mcp] re-inflated array arg(s) [${ARRAY_TEXT_FIELDS.join(',')}] for ${rpc?.params?.name}`);
    return JSON.stringify(rpc);
  } catch {
    return body;
  }
}

/**
 * A `fetch` for the MCPClient that runs the Voiceflow MCP in plain-bearer mode:
 * it injects a freshly-minted access token on every request and force-refreshes
 * once on a 401. No authProvider → none of the SDK's reauthorize-on-connect path.
 * It also applies the wire sanitizers above (prototype-key strip + array re-inflation).
 */
export function makeVoiceflowAuthFetch(): (url: any, init?: any) => Promise<Response> {
  return async (url: any, init?: any) => {
    const body = fixOutgoingBody(init?.body); // (B) outgoing
    const withAuth = (token: string) => {
      const headers = new Headers((init?.headers as any) ?? {});
      headers.set('authorization', `Bearer ${token}`);
      return { ...init, body, headers };
    };
    let token = await getFreshVoiceflowAccessToken();
    let res = await fetch(url, withAuth(token));
    if (res.status === 401) {
      token = await getFreshVoiceflowAccessToken(true);
      res = await fetch(url, withAuth(token));
    }
    // (A) Strip prototype-pollution keys from tool list/call responses so Mastra's
    // SuperJSON serializer doesn't throw on the `prototype` param of voiceflow_project.
    const reqBody = typeof init?.body === 'string' ? init.body : '';
    const isToolPayload =
      reqBody.includes('"method":"tools/list"') || reqBody.includes('"method":"tools/call"');
    if (res.ok && isToolPayload) {
      const text = await res.text();
      const cleaned = /"(?:prototype|__proto__|constructor)"/.test(text)
        ? transformMcpBody(text, stripPollutionDeep)
        : text;
      const headers = new Headers(res.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      return new Response(cleaned, { status: res.status, statusText: res.statusText, headers });
    }
    return res;
  };
}

// ---- Diagnostics ---------------------------------------------------------

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null; // not a JWT (opaque token)
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Deep, on-demand probe of the Voiceflow MCP OAuth path. Surfaced via
 * GET /_diag/mcp-probe so we can diagnose connect failures with one curl instead
 * of reading serverless logs. It reports, WITHOUT leaking secrets:
 *   - what's in storage (client_id, token shape, decoded JWT aud/exp/scope)
 *   - whether the stored access token is actually accepted by the MCP server
 *   - the exact result of a manual refresh against the token endpoint
 *   - the verdict from the SDK's auth() (AUTHORIZED vs REDIRECT)
 * This pinpoints whether 0-tools is caused by an expired token, an audience/scope
 * mismatch, a failing refresh, or a connectivity problem.
 */
export async function probeVoiceflowMcp(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { mcpUrl: env.vf.mcpUrl };
  const provider = makeVoiceflowOAuthProvider();
  const nowSec = Math.floor(Date.now() / 1000);

  // 1) Stored client + token shape (+ decoded JWT claims if it's a JWT).
  let access: string | undefined;
  let refresh: string | undefined;
  try {
    const ci: any = await (provider as any).clientInformation();
    out.clientId = ci?.client_id ?? null;
  } catch (e: any) {
    out.clientInfoError = e?.message ?? String(e);
  }
  try {
    const tk: any = await (provider as any).tokens();
    access = tk?.access_token;
    refresh = tk?.refresh_token;
    const claims = access ? decodeJwtClaims(access) : null;
    out.tokens = tk
      ? {
          has_access: !!access,
          has_refresh: !!refresh,
          token_type: tk.token_type,
          scope: tk.scope,
          expires_in: tk.expires_in,
          access_len: access?.length,
          is_jwt: !!claims,
          jwt: claims
            ? {
                aud: (claims as any).aud,
                iss: (claims as any).iss,
                scope: (claims as any).scope,
                exp: (claims as any).exp,
                exp_in_sec: typeof (claims as any).exp === 'number' ? (claims as any).exp - nowSec : undefined,
                expired: typeof (claims as any).exp === 'number' ? (claims as any).exp < nowSec : undefined,
              }
            : undefined,
        }
      : null;
  } catch (e: any) {
    out.tokensError = e?.message ?? String(e);
  }

  // 2) Does the MCP server accept the stored access token? Direct initialize POST.
  const initBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '0' } },
  });
  try {
    const res = await fetchWithTimeout(
      env.vf.mcpUrl,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(access ? { authorization: `Bearer ${access}` } : {}),
        },
        body: initBody,
      },
      15_000,
    );
    out.initWithToken = {
      status: res.status,
      wwwAuthenticate:
        res.headers.get('www-authenticate') ?? res.headers.get('x-amzn-remapped-www-authenticate'),
      body: (await res.text()).slice(0, 300),
    };
  } catch (e: any) {
    out.initWithTokenError = `${e?.name}: ${e?.message ?? String(e)}`;
  }

  // 3) Manual refresh against the token endpoint — captures the EXACT refresh error.
  try {
    const asMeta: any = await fetchWithTimeout(
      'https://auth-api.voiceflow.com/.well-known/oauth-authorization-server',
      { headers: { accept: 'application/json' } },
      10_000,
    ).then((r) => r.json());
    const tokenEndpoint = asMeta?.token_endpoint;
    out.tokenEndpoint = tokenEndpoint ?? null;
    if (tokenEndpoint && refresh) {
      const form = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        scope: SCOPE,
      });
      const ci: any = await (provider as any).clientInformation();
      if (ci?.client_id) form.set('client_id', ci.client_id);
      // Mirror the resource indicator the SDK sends (validateResourceURL override).
      form.set('resource', env.vf.oauthResource || env.vf.mcpUrl);
      const res = await fetchWithTimeout(
        tokenEndpoint,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: form.toString(),
        },
        15_000,
      );
      const txt = await res.text();
      out.manualRefresh = { status: res.status, ok: res.ok, body: txt.slice(0, 120) };
      // If the refresh succeeded, PERSIST the rotated tokens (Voiceflow rotates the
      // refresh token, so not saving would strand it), then verify the new access token.
      try {
        const fresh = JSON.parse(txt);
        const newAccess = fresh?.access_token;
        if (newAccess && res.ok) {
          const cur: any = await (provider as any).tokens();
          await (provider as any).saveTokens({
            ...cur,
            ...fresh,
            refresh_token: fresh.refresh_token ?? cur?.refresh_token,
          });
          out.manualRefreshSaved = true;
          const r2 = await fetchWithTimeout(
            env.vf.mcpUrl,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                authorization: `Bearer ${newAccess}`,
              },
              body: initBody,
            },
            15_000,
          );
          out.initWithRefreshedToken = { status: r2.status, body: (await r2.text()).slice(0, 200) };
        }
      } catch {
        /* body not JSON */
      }
    }
  } catch (e: any) {
    out.manualRefreshError = `${e?.name}: ${e?.message ?? String(e)}`;
  }

  return out;
}
