import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { env } from '../config/env';

/**
 * GLM served via Fireworks' OpenAI-compatible endpoint.
 * We use the v5 line of @ai-sdk/openai-compatible (1.x) to match the
 * LanguageModelV2 type Mastra's custom-gateway docs target.
 */
export const glmProvider = createOpenAICompatible({
  name: 'glm-fireworks',
  baseURL: env.glm.baseURL,
  apiKey: env.glm.apiKey,
});

/** main / strong tier — replaces the plugin's "opus" agents */
export const mainModel = glmProvider.chatModel(env.glm.modelMain);

/** triage / cheap tier — replaces the plugin's "sonnet" agents (currently same id) */
export const triageModel = glmProvider.chatModel(env.glm.modelTriage);
