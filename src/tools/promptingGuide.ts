import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { projectRoot } from '../lib/loadPrompt';

/**
 * Port of bin/vf-load-prompting-guide: return the model-specific prompting guide
 * (with a freshness check) from reference/. Guides are editable data files.
 */
const STALE_DAYS = 30;

export interface PromptingGuide {
  content: string;
  stale: boolean;
  modelCovered: boolean;
  path: string;
}

function guideFileForModel(model: string): string | null {
  const m = model.toLowerCase();
  if (/(claude|anthropic|haiku|sonnet|opus)/.test(m)) return 'claude_prompting.md';
  if (/(gpt|openai|o1|o3|bedrock-claude)/.test(m)) return 'openai_prompting.md';
  if (/(voiceflow-core|voiceflow_core)/.test(m)) return 'voiceflow_core_prompting.md';
  return null;
}

export function loadPromptingGuide(model: string): PromptingGuide {
  const file = guideFileForModel(model);
  if (!file) return { content: '', stale: true, modelCovered: false, path: '' };

  const path = resolve(projectRoot(), 'reference', file);
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return { content: '', stale: true, modelCovered: false, path };
  }

  let stale = true;
  let modelCovered = false;
  const m = model.toLowerCase();

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    for (const line of fmMatch[1].trim().split('\n')) {
      if (line.startsWith('last_updated:')) {
        const dateStr = line.slice('last_updated:'.length).trim();
        const d = new Date(dateStr);
        if (!Number.isNaN(d.getTime())) {
          stale = Date.now() - d.getTime() > STALE_DAYS * 86_400_000;
        }
      }
      if (line.startsWith('models_covered:')) {
        const models = line.slice('models_covered:'.length).trim().toLowerCase();
        modelCovered = models.includes(m);
        if (!modelCovered && m.includes('.')) {
          modelCovered = models.includes(m.slice(0, m.lastIndexOf('.')));
        }
      }
    }
  }

  return { content, stale, modelCovered, path };
}

export const loadPromptingGuideTool = createTool({
  id: 'vf_load_prompting_guide',
  description:
    'Load the model-specific prompting guide (Claude / OpenAI / Voiceflow-core) for a TARGET agent model. Use BEFORE writing or editing a prompt so you follow the right provider conventions. Returns the guide text plus freshness/coverage flags (if stale or the model is not covered, web-search for fresh guidance).',
  inputSchema: z.object({
    model: z
      .string()
      .describe('Target agent model id, e.g. "claude-4.5-haiku", "gpt-5.2", "voiceflow-core-4.0"'),
  }),
  outputSchema: z.object({
    content: z.string(),
    stale: z.boolean(),
    modelCovered: z.boolean(),
    path: z.string(),
  }),
  execute: async ({ model }) => loadPromptingGuide(model),
});
