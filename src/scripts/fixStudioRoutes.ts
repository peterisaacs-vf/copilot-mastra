import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Post-build fix: serve the Studio SPA at "/".
 *
 * The Vercel deployer (studio: true) ships the Studio SPA into .vercel/output/static
 * but writes a route config whose SPA fallback uses `check: true`, which defers "/"
 * to the Mastra *server function's* landing page ("Mastra Server" with curl examples)
 * instead of the static Studio index. We rewrite the routes so:
 *   - /api/* and /health  → the server function,
 *   - real files (/assets/*, /index.html) → filesystem,
 *   - everything else (incl. "/") → the Studio SPA (/index.html).
 *
 * Runs automatically as `postbuild`. No-ops if there's no build output.
 */
const cfgPath = resolve(process.cwd(), '.vercel/output/config.json');

if (!existsSync(cfgPath)) {
  console.log('[vercel:routes] no .vercel/output/config.json — skipping (not a Vercel build).');
  process.exit(0);
}

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as { version: number; routes: unknown[] };
cfg.routes = [
  { src: '/', dest: '/index.html' },
  { src: '/api/(.*)', dest: '/' },
  { src: '/health', dest: '/' },
  { src: '/_diag/(.*)', dest: '/' },
  { handle: 'filesystem' },
  { src: '/(.*)', dest: '/index.html' },
];
writeFileSync(cfgPath, JSON.stringify(cfg));
console.log('[vercel:routes] patched config.json — Studio SPA now served at /');
