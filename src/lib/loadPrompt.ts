import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the project root robustly. `mastra dev` bundles to .mastra/output and
 * runs with a different cwd than the repo root, so we can't rely on process.cwd().
 * We walk up from both cwd and this module's location looking for the markers
 * that identify our repo (the `agents/` and `skills/` directories).
 */
let cachedRoot: string | null = null;

function hasMarkers(dir: string): boolean {
  return existsSync(resolve(dir, 'agents')) && existsSync(resolve(dir, 'skills'));
}

function findProjectRoot(): string {
  if (cachedRoot) return cachedRoot;
  const starts: string[] = [process.cwd()];
  try {
    starts.push(dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* import.meta.url unavailable — ignore */
  }
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 12; i++) {
      if (hasMarkers(dir)) {
        cachedRoot = dir;
        return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  cachedRoot = process.cwd();
  return cachedRoot;
}

/** Absolute project root (where agents/, skills/, reference/ live). */
export function projectRoot(): string {
  return findProjectRoot();
}

/**
 * Load a markdown prompt/skill file and return its body with YAML frontmatter
 * stripped. Paths are relative to the project root, so prompts/skills stay
 * editable files (data), not hardcoded strings.
 */
export function loadMarkdownBody(relPath: string): string {
  const abs = resolve(findProjectRoot(), relPath);
  const raw = readFileSync(abs, 'utf8');
  const fm = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  let body = fm ? raw.slice(fm[0].length) : raw;
  // drop a leftover leading '---' line (some agent .md files have double frontmatter)
  body = body.replace(/^\s*---\s*\r?\n/, '');
  return body.trim();
}
