import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { EMBEDDED_ASSETS } from '../generated/assets';

/**
 * Resolve the project root robustly across three runtimes:
 *  - `tsx` / local dev: the repo is on disk, so we find the real tree.
 *  - `mastra dev`: bundles to .mastra/output with a different cwd, but the repo
 *    is still on disk a few levels up — we walk up to find it.
 *  - serverless (Vercel): the source tree is NOT on disk (the bundler only ships
 *    reachable JS), so we materialize the embedded asset map (see
 *    src/generated/assets.ts) into a writable temp dir and read from there.
 *
 * Everything else in the app reads data files via `projectRoot()`, so this is the
 * single place that has to know about the serverless filesystem difference.
 */
let cachedRoot: string | null = null;
let materialized: string | null = null;

/** A file that only exists in the real source tree — proves we found the repo. */
const CANARY = 'agents/orchestrator.md';

function isRealRoot(dir: string): boolean {
  return existsSync(resolve(dir, CANARY)) && existsSync(resolve(dir, 'skills'));
}

function findRealRoot(): string | null {
  const starts: string[] = [process.cwd()];
  try {
    starts.push(dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* import.meta.url unavailable — ignore */
  }
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 12; i++) {
      if (isRealRoot(dir)) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/**
 * Write the embedded asset map to a writable temp dir, once. A sentinel marker
 * makes this idempotent and crash-safe across warm invocations.
 */
function materializeEmbedded(): string {
  if (materialized) return materialized;
  const root = join(tmpdir(), 'copilot-assets');
  const marker = resolve(root, '.materialized');
  if (!existsSync(marker)) {
    for (const [rel, content] of Object.entries(EMBEDDED_ASSETS)) {
      const abs = resolve(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    writeFileSync(marker, new Date().toISOString());
  }
  materialized = root;
  return root;
}

/** Absolute project root (where agents/, skills/, reference/ live or are staged). */
export function projectRoot(): string {
  if (cachedRoot) return cachedRoot;
  cachedRoot = findRealRoot() ?? materializeEmbedded();
  return cachedRoot;
}

/**
 * Load a markdown prompt/skill file and return its body with YAML frontmatter
 * stripped. Paths are relative to the project root, so prompts/skills stay
 * editable files (data), not hardcoded strings.
 */
export function loadMarkdownBody(relPath: string): string {
  const abs = resolve(projectRoot(), relPath);
  const raw = readFileSync(abs, 'utf8');
  const fm = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  let body = fm ? raw.slice(fm[0].length) : raw;
  // drop a leftover leading '---' line (some agent .md files have double frontmatter)
  body = body.replace(/^\s*---\s*\r?\n/, '');
  return body.trim();
}
