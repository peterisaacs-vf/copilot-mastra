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
import { DEMO_HTML } from './demoPage';
import { MastraEditor } from '@mastra/editor';
import { Client } from 'pg';
import { getPostgresUrl, makePostgresStore, makeLibsqlStore, probePgvector, PG_SSL } from './storage';
import { pgMemory, localMemory, CONTEXT_TOKEN_BUDGET, OBSERVATIONAL_MEMORY } from './memory';
import { skillRoutingScorer } from './scorers/skillRouting';
import { skillRoutingJudgeScorer } from './scorers/skillRoutingJudge';
import { hasVoiceflowToken, hasGlmKey, useVoiceflowOAuth, env } from '../config/env';
import { beginVoiceflowAuthorization, completeVoiceflowAuthorization, hasVoiceflowTokens, resetVoiceflowOAuth, probeVoiceflowMcp, resetVoiceflowTokenCache } from './oauth';

if (!hasGlmKey()) {
  console.warn(
    '[glm] GLM_API_KEY not set — Studio will load and you can browse agents/workflows, ' +
      'but agent/model calls will fail until you set GLM_API_KEY.',
  );
}

// Voiceflow MCP tools — graceful no-token fallback so Studio still boots.
// mcpDiag is surfaced via GET /_diag/mcp so we can confirm the MCP is wired
// (token present + tools loaded) with a single curl instead of reading logs.
// Lazily-loaded, cached Voiceflow MCP toolset. Agents resolve their tools through
// ensureVfTools() on EVERY request (Mastra DynamicArgument), so:
//   - a cold-start connect failure (or a token that only becomes valid once the user
//     consents at /oauth/start) self-heals on the next request — no redeploy needed;
//   - once loaded, the cached toolset is returned instantly (the live MCP connection
//     refreshes the short-lived token per request via the custom fetch).
let vfToolsCache: Record<string, any> = {};
let vfToolsLoaded = false;
let vfLoadInflight: Promise<Record<string, any>> | undefined;
let vfLoadCooldownUntil = 0;
const mcpDiag: Record<string, unknown> = {
  authMode: useVoiceflowOAuth() ? 'oauth' : 'token',
  tokenPresent: hasVoiceflowToken(),
  tools: 0,
};

async function ensureVfTools(): Promise<Record<string, any>> {
  if (vfToolsLoaded) return vfToolsCache;
  if (!(useVoiceflowOAuth() || hasVoiceflowToken())) return vfToolsCache;
  if (Date.now() < vfLoadCooldownUntil) return vfToolsCache;
  if (!vfLoadInflight) {
    vfLoadInflight = (async () => {
      try {
        const t = await getVoiceflowTools();
        const names = Object.keys(t);
        if (names.length > 0) {
          vfToolsCache = t;
          vfToolsLoaded = true;
          mcpDiag.tools = names.length;
          mcpDiag.names = names.slice(0, 40);
          delete mcpDiag.error;
          console.info(`[voiceflow-mcp] loaded ${names.length} tools (${useVoiceflowOAuth() ? 'oauth' : 'token'})`);
        } else {
          // Connect failed silently inside the MCP client (returns {}). Back off briefly.
          vfLoadCooldownUntil = Date.now() + 15_000;
          console.warn('[voiceflow-mcp] 0 tools (connect failed) — will retry on a later request.');
          if (useVoiceflowOAuth()) console.warn('[voiceflow-mcp] if not yet authorized, visit /oauth/start once to consent.');
        }
      } catch (err) {
        mcpDiag.error = (err as Error).message;
        vfLoadCooldownUntil = Date.now() + 15_000;
        console.warn('[voiceflow-mcp] load failed:', (err as Error).message);
      } finally {
        vfLoadInflight = undefined;
      }
      return vfToolsCache;
    })();
  }
  return vfLoadInflight;
}

if (useVoiceflowOAuth() || hasVoiceflowToken()) {
  // Best-effort warm-up at boot so the first real request is fast; non-fatal if it
  // fails (ensureVfTools will retry lazily on a later request).
  await ensureVfTools();
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
  'debug-agent': buildDebugAgent(ensureVfTools, workspace, memory),
};
for (const spec of WORKER_SPECS) {
  workers[spec.key] = buildWorker(spec, ensureVfTools, workspace, memory);
}

// Supervisor: delegates to the workers (auto `agent-<key>` tools).
const orchestrator = buildOrchestrator(workers, ensureVfTools, workspace, memory);

export const mastra = new Mastra({
  agents: { orchestrator, ...workers },
  workflows: {
    'analyze-transcripts': analyzeTranscriptsWorkflow,
    'prompt-optimizer': promptOptimizerWorkflow,
  },
  // Eval scorers (Mastra eval suite), visible in Studio.
  // - skill-routing: golden-set regression scorer (offline, runRoutingEval.ts).
  // - skill-routing-judge: LLM-judged routing quality for live runs (no ground truth).
  scorers: { 'skill-routing': skillRoutingScorer, 'skill-routing-judge': skillRoutingJudgeScorer },
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
      // Custom in-order demo UI: one chronological column (message → reasoning → tool →
      // skill → message) over the live /stream. The Studio playground splits the chat and
      // the trace into separate panes, which is hard to follow during a live demo.
      registerApiRoute('/demo', {
        method: 'GET',
        handler: async (c) => c.html(DEMO_HTML),
      }),
      // Admin: wipe ALL conversation memory (threads, messages, working memory,
      // observational memory, thread state, and semantic-recall vectors) for a clean
      // demo. Preserves oauth_kv (MCP auth) and agent/editor/skill config. Gated by
      // ?confirm=yes. Discovers pgvector recall tables dynamically so nothing is missed.
      registerApiRoute('/_diag/reset-memory', {
        method: 'GET',
        handler: async (c) => {
          if (c.req.query('confirm') !== 'yes') {
            return c.text(
              'Add ?confirm=yes to wipe ALL conversation memory (threads, messages, working ' +
                'memory, observational memory, semantic-recall vectors). Auth tokens and agent ' +
                'config are preserved.',
              400,
            );
          }
          const url = getPostgresUrl();
          if (!url) return c.json({ ok: false, error: 'No Postgres configured (memory is on /tmp libsql).' }, 400);
          const client = new Client({ connectionString: url, ssl: PG_SSL, connectionTimeoutMillis: 10_000 });
          const cleared: Record<string, number> = {};
          try {
            await client.connect();
            const present = new Set(
              (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map(
                (r: any) => r.table_name,
              ),
            );
            // Memory tables + any pgvector (semantic-recall embedding) tables.
            const memTables = [
              'mastra_messages',
              'mastra_threads',
              'mastra_resources',
              'mastra_observational_memory',
              'mastra_thread_state',
            ];
            const vecTables = (
              await client.query("SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND udt_name='vector'")
            ).rows.map((r: any) => r.table_name);
            const PRESERVE = new Set(['oauth_kv']);
            const toClear = [...new Set([...memTables, ...vecTables])].filter((t) => present.has(t) && !PRESERVE.has(t));
            for (const t of toClear) {
              cleared[t] = (await client.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n;
            }
            if (toClear.length) {
              await client.query(`TRUNCATE TABLE ${toClear.map((t) => `"${t}"`).join(', ')} CASCADE`);
            }
            return c.json({ ok: true, cleared, preserved: ['oauth_kv', 'agent/editor/skill config'] });
          } catch (e: any) {
            return c.json({ ok: false, error: e?.message ?? String(e), cleared }, 500);
          } finally {
            try {
              await client.end();
            } catch {
              /* ignore */
            }
          }
        },
      }),
      // Deep, on-demand OAuth probe: decodes the stored token, tests it against the
      // MCP server, and does a manual refresh — pinpoints WHY tools fail to load.
      registerApiRoute('/_diag/mcp-probe', {
        method: 'GET',
        handler: async (c) => {
          try {
            return c.json(await probeVoiceflowMcp());
          } catch (e: any) {
            return c.json({ error: e?.message ?? String(e) }, 500);
          }
        },
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
      registerApiRoute('/oauth/reset', {
        method: 'GET',
        handler: async (c) => {
          if (c.req.query('confirm') !== 'yes') {
            return c.text('Add ?confirm=yes to clear ALL stored OAuth state (client + tokens). You will then need /oauth/start again.', 400);
          }
          try {
            await resetVoiceflowOAuth();
            return c.text('OAuth state cleared. Visit /oauth/start to consent fresh.', 200);
          } catch (e: any) {
            return c.text(`OAuth reset failed: ${e?.message ?? e}`, 500);
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
            // Fresh consent → drop any stale token/backoff state and load tools NOW so
            // this warm instance is immediately usable (no redeploy / cold start needed).
            resetVoiceflowTokenCache();
            vfToolsLoaded = false;
            vfToolsCache = {};
            vfLoadCooldownUntil = 0;
            const tools = await ensureVfTools();
            const n = Object.keys(tools).length;
            return c.html(
              `<h2>✅ Voiceflow MCP authorized</h2><p>Tokens stored and ${n} tool${n === 1 ? '' : 's'} loaded. ` +
                'You can close this tab and start using the copilot.</p>',
            );
          } catch (e: any) {
            return c.text(`OAuth callback failed: ${e?.message ?? e}`, 500);
          }
        },
      }),
      registerApiRoute('/oauth/status', {
        method: 'GET',
        handler: async (c) =>
          c.json({
            mode: useVoiceflowOAuth() ? 'oauth' : 'token',
            hasTokens: await hasVoiceflowTokens(),
            mcpUrl: env.vf.mcpUrl,
            authServer: env.vf.oauthAuthServer || '(discovered from MCP server)',
          }),
      }),
    ],
  },
  // Editor: lets Studio manage/version agent instructions + prompt blocks (stored
  // in `storage`). Durable with Postgres; ephemeral on the /tmp fallback.
  editor: new MastraEditor(),
  // Build-time only: emits a Vercel Build Output API bundle (with the Studio SPA).
  // Agent runs are long — a full agent build makes many sequential MCP calls — so
  // give the function as long as the plan allows. Default 600s (10 min); override
  // via VERCEL_FN_MAX_DURATION. Ceilings: with Fluid Compute, Pro/Enterprise allow
  // up to 800s; without Fluid, Pro caps at 300s. If a deploy errors on maxDuration,
  // enable Fluid Compute for the project or set VERCEL_FN_MAX_DURATION=300.
  deployer: new VercelDeployer({
    studio: true,
    maxDuration: Number(process.env.VERCEL_FN_MAX_DURATION ?? 600),
  }),
});
