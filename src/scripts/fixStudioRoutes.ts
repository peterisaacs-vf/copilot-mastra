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

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as {
  version: number;
  routes: unknown[];
  crons?: { path: string; schedule: string }[];
};
cfg.routes = [
  { src: '/', dest: '/index.html' },
  { src: '/api/(.*)', dest: '/' },
  { src: '/health', dest: '/' },
  { src: '/_diag/(.*)', dest: '/' },
  { src: '/oauth/(.*)', dest: '/' },
  { src: '/demo', dest: '/' },
  { handle: 'filesystem' },
  { src: '/(.*)', dest: '/index.html' },
];
// Keep-warm cron: ping /_diag/storage every 3 minutes so (a) the Neon DB doesn't
// auto-suspend (~5 min idle) and (b) a function instance stays warm with the MCP
// tools already loaded — eliminating the multi-second cold start on the first real
// request. /_diag/storage runs a real pg query, which is what keeps Neon awake.
cfg.crons = [{ path: '/_diag/storage', schedule: '*/3 * * * *' }];
writeFileSync(cfgPath, JSON.stringify(cfg));
console.log('[vercel:routes] patched config.json — Studio SPA at / + keep-warm cron (/_diag/storage every 3m)');
