import 'dotenv/config';

function optional(name: string, fallback = ''): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

/**
 * GLM_API_KEY is required for the agents to actually call the model, but we do
 * NOT throw at import time: on a serverless target that would crash the whole
 * function (including the Studio UI) at cold start. Instead we read it leniently
 * and surface the problem only when an agent is invoked (see hasGlmKey()).
 */
export const env = {
  glm: {
    baseURL: optional('GLM_BASE_URL', 'https://api.fireworks.ai/inference/v1'),
    apiKey: optional('GLM_API_KEY'),
    modelMain: optional('GLM_MODEL_MAIN', 'accounts/fireworks/models/glm-5p2'),
    // Triage tier defaults to DeepSeek V4 Flash — ~20x cheaper than GLM and it
    // emits clean structured JSON (validated in the model bake-off). Used by the
    // mechanical workers (audit-kb / setup-evals / test-runner). Override via env.
    modelTriage: optional('GLM_MODEL_TRIAGE', 'accounts/fireworks/models/deepseek-v4-flash'),
    // Eval JUDGE tier — deliberately a NEUTRAL family (not GLM/DeepSeek) to avoid
    // self-preference bias. Kimi K2.6 (Moonshot) benchmarked on par with Claude's
    // reference verdicts on routing judgments. Override via GLM_MODEL_JUDGE.
    modelJudge: optional('GLM_MODEL_JUDGE', 'accounts/fireworks/models/kimi-k2p6'),
  },
  vf: {
    mcpUrl: optional('VF_MCP_URL', 'https://mcp.voiceflow.com/mcp'),
    mcpToken: optional('VF_MCP_TOKEN'),
    // Auth mode for the Voiceflow MCP: 'token' (static bearer, default) or 'oauth'
    // (authorization-code + refresh via MCPOAuthClientProvider). OAuth points at
    // whatever VF_MCP_URL resolves to, so set VF_MCP_URL to the staging MCP server
    // when testing against staging.
    authMode: optional('VF_AUTH_MODE', 'token'),
    // Our OAuth callback (must be allow-listed / DCR-registered on the auth server).
    oauthRedirectUrl: optional('OAUTH_REDIRECT_URL', 'https://copilot-mastra.vercel.app/oauth/callback'),
    // Pre-registered OAuth client. If set, the provider SKIPS dynamic client
    // registration (use this when the server's DCR endpoint isn't available). It's a
    // public client, so a secret is normally not needed.
    oauthClientId: optional('VF_OAUTH_CLIENT_ID'),
    oauthClientSecret: optional('VF_OAUTH_CLIENT_SECRET'),
  },
} as const;

export const hasGlmKey = (): boolean => env.glm.apiKey.length > 0;
export const hasVoiceflowToken = (): boolean => env.vf.mcpToken.length > 0;
/** OAuth mode for the Voiceflow MCP (vs. the static bearer token). */
export const useVoiceflowOAuth = (): boolean => env.vf.authMode.toLowerCase() === 'oauth';
