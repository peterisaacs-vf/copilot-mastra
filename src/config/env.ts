import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name} (see .env.example)`);
  }
  return v.trim();
}

function optional(name: string, fallback = ''): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

export const env = {
  glm: {
    baseURL: optional('GLM_BASE_URL', 'https://api.fireworks.ai/inference/v1'),
    apiKey: required('GLM_API_KEY'),
    modelMain: optional('GLM_MODEL_MAIN', 'accounts/fireworks/models/glm-5p2'),
    modelTriage: optional('GLM_MODEL_TRIAGE', 'accounts/fireworks/models/glm-5p2'),
  },
  vf: {
    mcpUrl: optional('VF_MCP_URL', 'https://mcp.voiceflow.com/mcp'),
    mcpToken: optional('VF_MCP_TOKEN'),
  },
} as const;

export const hasVoiceflowToken = (): boolean => env.vf.mcpToken.length > 0;
