import type { Agent } from '@mastra/core/agent';
import type { z } from 'zod';
import { extractJsonObject } from './extractJson';

export interface StructuredRun<T> {
  result: T | null;
  text: string;
  reasoningText: string;
  finishReason?: string;
}

/**
 * Generate a Zod-validated structured result from an agent. GLM over the
 * OpenAI-compatible endpoint needs jsonPromptInjection, and still sometimes
 * fences the JSON — so we fall back to fence-tolerant extraction. modelSettings
 * .maxOutputTokens bounds generation. (Same pattern proven for the debug-agent.)
 */
export async function generateStructured<T extends z.ZodTypeAny>(
  agent: Agent,
  input: string,
  schema: T,
  opts: { maxSteps?: number; maxTokens?: number } = {},
): Promise<StructuredRun<z.infer<T>>> {
  const res = await agent.generate(input, {
    maxSteps: opts.maxSteps ?? 6,
    modelSettings: { maxOutputTokens: opts.maxTokens ?? 8000 },
    structuredOutput: { schema, jsonPromptInjection: true, errorStrategy: 'warn' },
  });
  const r = res as { object?: unknown; text?: string; reasoningText?: string; finishReason?: string };
  const base = { text: r.text ?? '', reasoningText: r.reasoningText ?? '', finishReason: r.finishReason };

  const direct = schema.safeParse(r.object);
  if (direct.success) return { result: direct.data, ...base };

  const fallback = schema.safeParse(extractJsonObject(r.text ?? ''));
  return { result: fallback.success ? fallback.data : null, ...base };
}
