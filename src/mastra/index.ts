import { Mastra } from '@mastra/core';
import type { Agent } from '@mastra/core/agent';
import { buildDebugAgent } from './agents/debugAgent';
import { buildWorker, buildOrchestrator, WORKER_SPECS } from './workers';
import { getVoiceflowTools } from './mcp';
import { getSkillWorkspace } from './workspace';
import { analyzeTranscriptsWorkflow } from './workflows/analyzeTranscripts';
import { promptOptimizerWorkflow } from './workflows/promptOptimizer';
import type { MastraStorage } from '@mastra/core/storage';
import type { Memory } from '@mastra/memory';
import { VercelDeployer } from '@mastra/deployer-vercel';
import { registerApiRoute } from '@mastra/core/server';
import { MastraEditor } from '@mastra/editor';
import { getPostgresUrl, makePostgresStore, makeLibsqlStore, probePgvector } from './storage';
import { pgMemory, localMemory, CONTEXT_TOKEN_BUDGET, OBSERVATIONAL_MEMORY } from './memory';
import { skillRoutingScorer } from './scorers/skillRouting';
import { hasVoiceflowToken, hasGlmKey, useVoiceflowOAuth } from '../config/env';
import { beginVoiceflowAuthorization, completeVoiceflowAuthorization, hasVoiceflowTokens } from './oauth';

if (!hasGlmKey()) {
  console.warn(
    '[glm] GLM_API_KEY not set — Studio will load and you can browse agents/workflows, ' +
      'but agent/model calls will fail until you set GLM_API_KEY.',
  );
}

// Voiceflow MCP tools — graceful no-token fallback so Studio still boots.
// mcpDiag is surfaced via GET /_diag/mcp so we can confirm the MCP is wired
// (token present + tools loaded) with a single curl instead of reading logs.
let vfTools: Record<string, any> = {};
const mcpDiag: Record<string, unknown> = {
  authMode: useVoiceflowOAuth() ? 'oauth' : 'token',
  tokenPresent: hasVoiceflowToken(),
  tools: 0,
};
if (useVoiceflowOAuth() || hasVoiceflowToken()) {
  try {
    vfTools = await getVoiceflowTools();
    const names = Object.keys(vfTools);
    mcpDiag.tools = names.length;
    mcpDiag.names = names.slice(0, 40);
    console.info(`[voiceflow-mcp] loaded ${names.length} tools (${useVoiceflowOAuth() ? 'oauth' : 'token'})`);
  } catch (err) {
    mcpDiag.error = (err as Error).message;
    console.warn('[voiceflow-mcp] failed to load tools:', (err as Error).message);
    if (useVoiceflowOAuth()) {
      console.warn('[voiceflow-mcp] OAuth mode: if not yet authorized, visit /oauth/start once to consent.');
    }
  }
} else {
  console.warn(
    '[voiceflow-mcp] VF_MCP_TOKEN not set and VF_AUTH_MODE!=oauth — agents boot WITHOUT ' +
      'Voiceflow tools. Set VF_MCP_TOKEN (static) or VF_AUTH_MODE=oauth to enable them.',
  );
}

// Shared skill workspace — exposes all SKILL.md under skills/ as on-demand skill
// tools. If it fails to init, agents still boot (without skill tooling).
let workspace: Awaited<ReturnType<typeof getSkillWorkspace>> | undefined;
try {
  workspace = await getSkillWorkspace();
  console.info('[workspace] skill workspace ready');
} catch (err) {
  console.warn('[workspace] failed to init skill workspace:', (err as Error).message);
}

// Storage + memory (resilient): try Postgres, eagerly run migrations so a bad DB
// fails HERE (caught) rather than 500-ing every request, then fall back to LibSQL.
// Memory is threads-only for now (durable history); semantic recall is added once
// pgvector is verified, so a recall failure can't break agent calls.
let storage: MastraStorage;
let memory: Memory | undefined;
// Readable storage diagnostics, surfaced via GET /_diag/storage (logs truncate errors).
const storageDiag: Record<string, unknown> = {};
const redact = (s: string) => s.replace(/:[^:@/\s]+@/, ':***@');
const pgUrl = getPostgresUrl();
if (pgUrl) {
  try {
    const pg = makePostgresStore(pgUrl);
    await Promise.race([
      pg.init(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('pg init timeout (20s)')), 20_000)),
    ]);
    storage = pg;
    const vectorOk = await probePgvector(pgUrl);
    memory = pgMemory(pg, pgUrl, vectorOk);
    Object.assign(storageDiag, {
      mode: 'postgres',
      host: (() => { try { return new URL(pgUrl).host; } catch { return '?'; } })(),
      memory: true,
      lastMessages: 100,
      workingMemory: true,
      semanticRecall: vectorOk,
      tokenBudget: CONTEXT_TOKEN_BUDGET,
      observationalMemory: OBSERVATIONAL_MEMORY ? OBSERVATIONAL_MEMORY.scope : false,
    });
    console.info(`[storage] postgres ready; [memory] window(100)+workingMemory${vectorOk ? '+semanticRecall' : ' (no pgvector → recall off)'}${OBSERVATIONAL_MEMORY ? '+observationalMemory' : ''}`);
  } catch (e: any) {
    storage = makeLibsqlStore();
    memory = undefined;
    Object.assign(storageDiag, { mode: 'libsql-fallback', memory: false, code: e?.code ?? null, error: redact(String(e?.message ?? e)), tokenBudget: CONTEXT_TOKEN_BUDGET });
    console.error(`[pg-fail] ${e?.code ?? '?'} ${String(e?.message ?? e).slice(0, 110)} -> libsql fallback`);
  }
} else {
  storage = makeLibsqlStore();
  memory = process.env.VERCEL ? undefined : localMemory();
  Object.assign(storageDiag, { mode: 'libsql', pgUrlPresent: false, memory: Boolean(memory), tokenBudget: CONTEXT_TOKEN_BUDGET });
  console.info(`[storage] libsql; [memory] ${memory ? 'local' : 'off (set DATABASE_URL for durable memory)'}`);
}

// Test/eval escape hatch: run agents with NO memory, so dev scripts can call
// generate() without a thread/resource (resource-scoped working memory + thread-scoped
// OM otherwise require them). Irrelevant to routing/perf, which is what evals measure.
if (process.env.MEMORY_DISABLED) {
  memory = undefined;
  console.warn('[memory] disabled (MEMORY_DISABLED)');
}

// Workers (debug has its own structured-output helper; the rest come from specs).
const workers: Record<string, Agent> = {
  'debug-agent': buildDebugAgent(vfTools, workspace, memory),
};
for (const spec of WORKER_SPECS) {
  workers[spec.key] = buildWorker(spec, vfTools, workspace, memory);
}

// Supervisor: delegates to the workers (auto `agent-<key>` tools).
const orchestrator = buildOrchestrator(workers, vfTools, workspace, memory);

export const mastra = new Mastra({
  agents: { orchestrator, ...workers },
  workflows: {
    'analyze-transcripts': analyzeTranscriptsWorkflow,
    'prompt-optimizer': promptOptimizerWorkflow,
  },
  // Eval scorers (Mastra eval suite). skill-routing is a golden-set regression scorer,
  // driven offline by src/scripts/runRoutingEval.ts and visible in Studio.
  scorers: { 'skill-routing': skillRoutingScorer },
  // Durable store chosen above: Postgres (Neon) when reachable, else LibSQL.
  // Backs workflow runs, memory threads, and the editor.
  storage,
  server: {
    // Diagnostic: reports whether Postgres connected (and the full error if not),
    // since Vercel's runtime logs truncate the message.
    apiRoutes: [
      registerApiRoute('/_diag/storage', {
        method: 'GET',
        handler: async (c) => c.json(storageDiag),
      }),
      // Confirms the Voiceflow MCP is wired: token present + how many tools loaded.
      registerApiRoute('/_diag/mcp', {
        method: 'GET',
        handler: async (c) => c.json(mcpDiag),
      }),
      // OAuth (VF_AUTH_MODE=oauth): visit /oauth/start once in a browser to consent;
      // the server redirects you to Voiceflow, then back to /oauth/callback, which
      // stores the tokens. /oauth/status reports whether we currently hold valid tokens.
      registerApiRoute('/oauth/start', {
        method: 'GET',
        handler: async (c) => {
          if (!useVoiceflowOAuth()) {
            return c.text('OAuth mode is off. Set VF_AUTH_MODE=oauth (and VF_MCP_URL to the target server).', 400);
          }
          try {
            const url = await beginVoiceflowAuthorization();
            if (!url) return c.text('Already authorized — Voiceflow MCP tokens are valid.', 200);
            return c.redirect(url.toString(), 302);
          } catch (e: any) {
            return c.text(`OAuth start failed: ${e?.message ?? e}`, 500);
          }
        },
      }),
      registerApiRoute('/oauth/callback', {
        method: 'GET',
        handler: async (c) => {
          const error = c.req.query('error');
          if (error) {
            return c.text(`Authorization denied: ${error} ${c.req.query('error_description') ?? ''}`, 400);
          }
          const code = c.req.query('code');
          if (!code) return c.text('Missing ?code in callback.', 400);
          try {
            await completeVoiceflowAuthorization(code);
            return c.html(
              '<h2>✅ Voiceflow MCP authorized</h2><p>Tokens stored. You can close this tab. ' +
                'The copilot picks up the tools on its next cold start (or redeploy to force it).</p>',
            );
          } catch (e: any) {
            return c.text(`OAuth callback failed: ${e?.message ?? e}`, 500);
          }
        },
      }),
      registerApiRoute('/oauth/status', {
        method: 'GET',
        handler: async (c) =>
          c.json({ mode: useVoiceflowOAuth() ? 'oauth' : 'token', hasTokens: await hasVoiceflowTokens() }),
      }),
    ],
  },
  // Editor: lets Studio manage/version agent instructions + prompt blocks (stored
  // in `storage`). Durable with Postgres; ephemeral on the /tmp fallback.
  editor: new MastraEditor(),
  // Build-time only: emits a Vercel Build Output API bundle (with the Studio SPA).
  // maxDuration is env-driven so it can be tuned to the target plan's ceiling
  // (Hobby 60s / Pro 300s) — agent runs are long, so give them as long as allowed.
  deployer: new VercelDeployer({
    studio: true,
    maxDuration: Number(process.env.VERCEL_FN_MAX_DURATION ?? 60),
  }),
});
