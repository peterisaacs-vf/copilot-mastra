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
import { pgMemory, localMemory } from './memory';
import { hasVoiceflowToken, hasGlmKey } from '../config/env';

if (!hasGlmKey()) {
  console.warn(
    '[glm] GLM_API_KEY not set — Studio will load and you can browse agents/workflows, ' +
      'but agent/model calls will fail until you set GLM_API_KEY.',
  );
}

// Voiceflow MCP tools — graceful no-token fallback so Studio still boots.
let vfTools: Record<string, any> = {};
if (hasVoiceflowToken()) {
  try {
    vfTools = await getVoiceflowTools();
    console.info(`[voiceflow-mcp] loaded ${Object.keys(vfTools).length} tools`);
  } catch (err) {
    console.warn('[voiceflow-mcp] failed to load tools:', (err as Error).message);
  }
} else {
  console.warn(
    '[voiceflow-mcp] VF_MCP_TOKEN not set — agents boot WITHOUT Voiceflow tools. ' +
      'Set VF_MCP_TOKEN in .env to enable live transcript/KB/eval/test access.',
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
    });
    console.info(`[storage] postgres ready; [memory] window(100)+workingMemory${vectorOk ? '+semanticRecall' : ' (no pgvector → recall off)'}`);
  } catch (e: any) {
    storage = makeLibsqlStore();
    memory = undefined;
    Object.assign(storageDiag, { mode: 'libsql-fallback', memory: false, code: e?.code ?? null, error: redact(String(e?.message ?? e)) });
    console.error(`[pg-fail] ${e?.code ?? '?'} ${String(e?.message ?? e).slice(0, 110)} -> libsql fallback`);
  }
} else {
  storage = makeLibsqlStore();
  memory = process.env.VERCEL ? undefined : localMemory();
  Object.assign(storageDiag, { mode: 'libsql', pgUrlPresent: false, memory: Boolean(memory) });
  console.info(`[storage] libsql; [memory] ${memory ? 'local' : 'off (set DATABASE_URL for durable memory)'}`);
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
