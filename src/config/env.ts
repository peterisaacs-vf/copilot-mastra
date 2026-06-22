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
  },
  vf: {
    mcpUrl: optional('VF_MCP_URL', 'https://mcp.voiceflow.com/mcp'),
    mcpToken: optional('VF_MCP_TOKEN'),
  },
} as const;

export const hasGlmKey = (): boolean => env.glm.apiKey.length > 0;
export const hasVoiceflowToken = (): boolean => env.vf.mcpToken.length > 0;
