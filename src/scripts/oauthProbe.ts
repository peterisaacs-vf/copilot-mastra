/**
 * oauthProbe.ts — validate the Voiceflow OAuth flow's DISCOVERY + dynamic client registration
 * + authorize-URL build against a target auth server, WITHOUT the browser consent step.
 *
 * Set the target inline (e.g. Ben's review environment):
 *   VF_AUTH_MODE=oauth \
 *   VF_MCP_URL=https://mcp-review-dry-tree.us.development.voiceflow.com/mcp \
 *   VF_OAUTH_AUTH_SERVER=https://auth-api-review-dry-tree.us.development.voiceflow.com \
 *   npx tsx src/scripts/oauthProbe.ts
 *
 * It performs REAL dynamic client registration against the auth server (creates a throwaway
 * client) and builds a real PKCE authorize URL — but does NOT complete the flow (no token is
 * obtained), so in-memory storage is fine. Use it to confirm the auth-server override + DCR
 * work before deploying and doing the one-time human consent in a browser.
 */
import 'dotenv/config';
import { env, useVoiceflowOAuth } from '../config/env';
import { beginVoiceflowAuthorization } from '../mastra/oauth';

if (!useVoiceflowOAuth()) {
  console.error('Set VF_AUTH_MODE=oauth (this probe only exercises the OAuth path).');
  process.exit(1);
}

console.log('config:');
console.log('  VF_MCP_URL          :', env.vf.mcpUrl);
console.log('  VF_OAUTH_AUTH_SERVER :', env.vf.oauthAuthServer || '(none — discovered from MCP server)');
console.log('  redirect_uri        :', env.vf.oauthRedirectUrl);
console.log('  client_id (fixed?)  :', env.vf.oauthClientId || '(none — will dynamically register)');
console.log('');

try {
  const url = await beginVoiceflowAuthorization();
  if (!url) {
    console.log('AUTHORIZED already — valid tokens are present in storage (no consent needed).');
    process.exit(0);
  }
  const u = new URL(url.toString());
  console.log('✓ authorization URL built:');
  console.log(' ', u.toString());
  console.log('\nparsed:');
  console.log('  auth host     :', u.host);
  console.log('  auth path     :', u.pathname);
  for (const k of ['client_id', 'redirect_uri', 'response_type', 'scope', 'code_challenge_method', 'resource', 'state']) {
    const v = u.searchParams.get(k);
    if (v !== null) console.log(`  ${k.padEnd(14)}:`, v);
  }
  console.log('\nNext: open this URL in a browser (logged into the review env) to consent.');
  console.log('For the real flow the redirect_uri must be the DEPLOYED callback so the code lands');
  console.log('on the app that holds the PKCE verifier — i.e. deploy with these env vars, then');
  console.log('visit /oauth/start. (This probe just proves discovery + DCR + URL build succeed.)');
} catch (e: any) {
  console.error('✗ OAuth probe failed:', e?.message ?? e);
  if (e?.stack) console.error(e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}
process.exit(0);
