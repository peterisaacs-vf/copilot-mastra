import { existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Optional helper for the `vercel deploy --prebuilt` path: copy the local .env
 * into the built function bundle so the deployed function has the GLM key at
 * runtime (env.ts does `import 'dotenv/config'`, so a .env beside the handler is
 * loaded automatically). This bakes the secret into the artifact — convenient for
 * a throwaway demo with a time-bound key. The cleaner alternative is to leave this
 * out and set GLM_API_KEY in the Vercel project's Environment Variables instead.
 *
 *   npm run build && npm run vercel:env && vercel deploy --prebuilt
 */
const root = process.cwd();
const src = resolve(root, '.env');
const funcDir = resolve(root, '.vercel/output/functions/index.func');
const dest = resolve(funcDir, '.env');

if (!existsSync(funcDir)) {
  console.log('[vercel:env] no build output (.vercel/output) — run `npm run build` first. Skipping.');
} else if (!existsSync(src)) {
  console.log('[vercel:env] no local .env found — skipping. Set GLM_API_KEY in Vercel project settings instead.');
} else {
  copyFileSync(src, dest);
  console.log('[vercel:env] baked .env into the function bundle (.vercel/output/functions/index.func/.env)');
}
