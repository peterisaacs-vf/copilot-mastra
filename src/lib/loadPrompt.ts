import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load a markdown prompt/skill file and return its body with YAML frontmatter
 * stripped. Paths are resolved relative to the project root (process.cwd()),
 * so prompts/skills stay editable files (data), not hardcoded strings.
 */
export function loadMarkdownBody(relPath: string): string {
  const abs = resolve(process.cwd(), relPath);
  const raw = readFileSync(abs, 'utf8');
  const fm = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  let body = fm ? raw.slice(fm[0].length) : raw;
  // drop a leftover leading '---' line (some agent .md files have double frontmatter)
  body = body.replace(/^\s*---\s*\r?\n/, '');
  return body.trim();
}
