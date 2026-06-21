import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Port of bin/vf-diff-prompts: section-aware prompt diff (detects XML sections,
 * classifies added/removed/modified, flags likely duplicates).
 *
 * NOTE: the original used Python difflib.SequenceMatcher.ratio(); here similarity
 * is a Levenshtein-based ratio in [0,1] — a close, deterministic approximation
 * used for the "modified" score and the >0.7 duplicate heuristic.
 */

const HUMAN_NAMES: Record<string, string> = {
  role: 'Role / Identity',
  voice_rules: 'Voice delivery rules',
  tone: 'Tone',
  guardrails: 'Guardrails',
  rules: 'Rules',
  important: 'Important (guardrails duplicate)',
  playbook_scope: 'Playbook scope',
  process: 'Process',
  step_1_listen: 'Step 1 — Listen and classify',
  step_2_route: 'Step 2 — Routing rules',
  decision_tree: 'Decision tree',
  routing_notes: 'Routing notes',
  tools: 'Tools',
  exit_behaviour: 'Exit behaviour',
  session_context: 'Session context',
  critical_rule: 'Critical rule',
  greeting_logic: 'Greeting logic',
  language_handling: 'Language handling',
  formatting: 'Formatting',
  identity: 'Identity',
  goal: 'Goal',
  context: 'Context',
  flow: 'Flow',
  edge_cases: 'Edge cases',
  exit: 'Exit conditions',
};

function humanize(tagName: string): string {
  if (tagName.startsWith('(')) return tagName;
  if (HUMAN_NAMES[tagName]) return HUMAN_NAMES[tagName];
  return tagName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseSections(prompt: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const re = /<(\w+?)(?:\s[^>]*)?>([\s\S]+?)<\/\1>/g;
  const matches = [...prompt.matchAll(re)];

  if (matches.length === 0) {
    sections['(full prompt)'] = prompt;
    return sections;
  }

  const firstIdx = matches[0].index ?? 0;
  if (firstIdx > 0) {
    const preamble = prompt.slice(0, firstIdx).trim();
    if (preamble) sections['(preamble)'] = preamble;
  }

  for (const match of matches) {
    let tagName = match[1];
    const content = match[0];
    if (tagName in sections) {
      let counter = 2;
      while (`${tagName}_${counter}` in sections) counter += 1;
      tagName = `${tagName}_${counter}`;
    }
    sections[tagName] = content;
  }
  return sections;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return Math.round((1 - levenshtein(a, b) / maxLen) * 100) / 100;
}

function guessRemovalReason(name: string, content: string, otherSections: Record<string, string>): string {
  const cl = content.toLowerCase();
  for (const [otherName, otherContent] of Object.entries(otherSections)) {
    if (otherName === name) continue;
    if (similarity(cl, otherContent.toLowerCase()) > 0.7) {
      return `duplicate of ${humanize(otherName)}`;
    }
  }
  return '';
}

export interface DiffChange {
  section: string;
  display_name: string;
  type: 'added' | 'removed' | 'modified';
  added?: string;
  removed?: string;
  reason?: string;
  similarity?: number;
}

export interface DiffResult {
  changes: DiffChange[];
  unchanged: string[];
  summary: string;
  stats: {
    original_length: number;
    optimized_length: number;
    length_change: number;
    length_change_pct: number;
    sections_changed: number;
    sections_unchanged: number;
  };
}

export function diffPrompts(original: string, optimized: string): DiffResult {
  const origSections = parseSections(original);
  const optSections = parseSections(optimized);

  const allNames = [...new Set([...Object.keys(origSections), ...Object.keys(optSections)])];

  const changes: DiffChange[] = [];
  const unchanged: string[] = [];

  for (const name of allNames) {
    const origText = origSections[name] ?? '';
    const optText = optSections[name] ?? '';

    if (origText === optText) {
      unchanged.push(name);
      continue;
    }

    const change: DiffChange = { section: name, display_name: humanize(name), type: 'modified' };
    if (!origText) {
      change.type = 'added';
      change.added = optText.trim();
    } else if (!optText) {
      change.type = 'removed';
      change.removed = origText.trim();
      change.reason = guessRemovalReason(name, origText, optSections);
    } else {
      change.type = 'modified';
      change.removed = origText.trim();
      change.added = optText.trim();
      change.similarity = similarity(origText, optText);
    }
    changes.push(change);
  }

  const added = changes.filter((c) => c.type === 'added').length;
  const removed = changes.filter((c) => c.type === 'removed').length;
  const modified = changes.filter((c) => c.type === 'modified').length;

  const parts: string[] = [];
  if (modified) parts.push(`${modified} section${modified > 1 ? 's' : ''} modified`);
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);

  return {
    changes,
    unchanged,
    summary: parts.length ? parts.join(', ') : 'No changes',
    stats: {
      original_length: original.length,
      optimized_length: optimized.length,
      length_change: optimized.length - original.length,
      length_change_pct:
        Math.round(((optimized.length - original.length) / Math.max(original.length, 1)) * 1000) / 10,
      sections_changed: changes.length,
      sections_unchanged: unchanged.length,
    },
  };
}

const changeSchema = z.object({
  section: z.string(),
  display_name: z.string(),
  type: z.enum(['added', 'removed', 'modified']),
  added: z.string().optional(),
  removed: z.string().optional(),
  reason: z.string().optional(),
  similarity: z.number().optional(),
});

export const diffPromptsTool = createTool({
  id: 'vf_diff_prompts',
  description:
    'Diff two prompt versions, section-aware: detects XML sections, classifies each as added/removed/modified, and flags likely duplicate sections. Use to show exactly what changed between an original prompt and an edited/optimized one before applying.',
  inputSchema: z.object({
    original: z.string().describe('The original prompt text'),
    optimized: z.string().describe('The new / edited prompt text'),
  }),
  outputSchema: z.object({
    changes: z.array(changeSchema),
    unchanged: z.array(z.string()),
    summary: z.string(),
    stats: z.object({
      original_length: z.number(),
      optimized_length: z.number(),
      length_change: z.number(),
      length_change_pct: z.number(),
      sections_changed: z.number(),
      sections_unchanged: z.number(),
    }),
  }),
  execute: async ({ original, optimized }) => diffPrompts(original, optimized),
});
