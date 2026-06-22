import { Memory } from '@mastra/memory';
import type { MastraStorage } from '@mastra/core/storage';
import { TokenLimiterProcessor } from '@mastra/core/processors';
import { PgVector } from '@mastra/pg';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { glmProvider, triageModel } from './models';
import { PG_SSL } from './storage';

/** Fireworks embedding model (768-dim) for semantic recall — same provider/key as the chat models. */
const EMBED_MODEL = 'nomic-ai/nomic-embed-text-v1.5';

/**
 * Verbatim recency window. NOTE: counts messages, not turns — one agentic step (tool
 * call + result + response) is several messages, so 100 messages ≈ a few dozen turns.
 * This is just the message-count ceiling on what's *fetched* from history; the real
 * context-size guard is the token budget below (CONTEXT_TOKEN_BUDGET), which trims the
 * assembled context — window + recall + working memory — to a token ceiling at every step.
 * Semantic recall still reaches back across ALL history (resource-scoped) and working
 * memory holds durable facts, so total memory isn't capped at this window.
 */
const LAST_MESSAGES = 100;

/**
 * Token budget for the assembled input context (system + history + recalled + working
 * memory), enforced at EVERY agentic step by a TokenLimiterProcessor on each agent.
 *
 * This is our "compaction": Mastra's memory processors first assemble the context
 * (lastMessages window + semantic recall + working memory), THEN this trims the total
 * to a token ceiling — preserving system messages, prioritizing recent turns, and keeping
 * a contiguous suffix (no gaps). It also bounds per-step growth when tool results pile up
 * across a multi-step loop, so context can't blow the model window mid-task.
 *
 * Sizing: Claude Code compacts at ~150K on a ≥1M window (a deliberate fraction, not the
 * whole window). Our Fireworks-served models (GLM-5.2 / DeepSeek-V4-Flash) windows are not
 * yet confirmed; 96K is safe for a ≥128K window and leaves headroom for output (~8K) plus
 * system + tool schemas. Tunable via MEMORY_TOKEN_BUDGET — raise once the real window is
 * confirmed; lower if the triage (DeepSeek) window turns out smaller. Counting uses
 * model-agnostic estimation (tokenx), which is fine for a budget cap.
 */
export const CONTEXT_TOKEN_BUDGET = Number(process.env.MEMORY_TOKEN_BUDGET ?? 96_000);

/**
 * Shared agent input processors. A single token-budget ceiling on the assembled context,
 * attached to EVERY agent (independent of durable memory — it also bounds per-step tool
 * growth). `contiguous` keeps an unbroken suffix of recent turns rather than a gappy
 * best-fit, which reads better for a conversational copilot. Optional `limit` override
 * lets a smaller-window tier (e.g. triage) get a tighter cap later without restructuring.
 */
export function makeContextProcessors(limit: number = CONTEXT_TOKEN_BUDGET) {
  return [new TokenLimiterProcessor({ limit, trimMode: 'contiguous' })];
}

/** Relevant older messages pulled back by similarity (resource-scoped → spans the whole swarm + past sessions). */
const SEMANTIC_RECALL = { topK: 5, messageRange: 3, scope: 'resource' as const };

/**
 * Observational Memory — the framework-native "compaction". Two background agents
 * (Observer + Reflector) watch the conversation and compress raw history into a dense
 * observation log once it crosses a token threshold (observe ~30k, reflect ~40k by
 * default), tracking the "current task" so the agent picks up where it left off. This is
 * the same idea as Claude Code's compaction: keep a tight, relevant working set instead of
 * letting raw history rot — except it runs continuously in the background, not at a cliff.
 *
 * Choices for our setup:
 * - Model = triageModel (DeepSeek-V4-Flash): on OM's tested-model list, cheap + fast for
 *   background work, and reuses our existing Fireworks provider (no new key). Sets both
 *   the Observer and the Reflector.
 * - scope: 'thread' (NOT resource). Thread scope is well-tested; resource scope is
 *   experimental and explicitly hazardous for *concurrent* threads — where one thread can
 *   "continue" another's unfinished work. That's exactly our orchestrator+worker swarm, so
 *   resource scope is the wrong choice here. Cross-thread continuity is already provided by
 *   resource-scoped working memory + semantic recall; OM adds intra-thread compaction on
 *   top (most relevant on the orchestrator's long-running conversation).
 *
 * Thread-scoped OM needs a threadId on every call. Studio and the production swarm always
 * pass one; stateless dev scripts (skillProbe/eval) do not — run those with OM_DISABLED=1.
 * The same env var is the kill switch if a live issue surfaces.
 */
export const OBSERVATIONAL_MEMORY = process.env.OM_DISABLED
  ? (false as const)
  : { model: triageModel, scope: 'thread' as const };

/**
 * Working memory: a durable, resource-scoped scratchpad the copilot maintains across
 * threads/sessions (and across the sub-agent swarm, since they share the resource).
 * Survives even when messages age out of the window — this is the real "continuity".
 */
const WORKING_MEMORY = {
  enabled: true,
  scope: 'resource' as const,
  template: `# Voiceflow Copilot — Session Memory

## Project context
- Project / agent:
- Working environment:

## Current task
- Goal:
- Status:

## Findings & decisions
- (key diagnoses, fixes applied, what worked / didn't)

## Next steps / open questions
-
`,
};

/**
 * Memory on an already-initialized Postgres store. Always: 50-message window + durable
 * working memory. Semantic recall (pgvector) only when `vectorOk` — probed at boot so a
 * missing extension can never break agent calls.
 */
export function pgMemory(store: MastraStorage, url: string, vectorOk: boolean): Memory {
  const cfg: ConstructorParameters<typeof Memory>[0] = {
    storage: store,
    options: { lastMessages: LAST_MESSAGES, workingMemory: WORKING_MEMORY, observationalMemory: OBSERVATIONAL_MEMORY },
  };
  if (vectorOk) {
    cfg.vector = new PgVector({ id: 'copilot-vec', connectionString: url, ssl: PG_SSL });
    cfg.embedder = glmProvider.textEmbeddingModel(EMBED_MODEL);
    cfg.options = { lastMessages: LAST_MESSAGES, workingMemory: WORKING_MEMORY, semanticRecall: SEMANTIC_RECALL, observationalMemory: OBSERVATIONAL_MEMORY };
  }
  return new Memory(cfg);
}

/** Local (non-serverless) file-backed memory with the full strategy — low risk on disk. */
export function localMemory(): Memory {
  return new Memory({
    storage: new LibSQLStore({ id: 'copilot-mem', url: 'file:copilot-mem.db' }),
    vector: new LibSQLVector({ id: 'copilot-mem-vec', url: 'file:copilot-mem.db' }),
    embedder: glmProvider.textEmbeddingModel(EMBED_MODEL),
    options: { lastMessages: LAST_MESSAGES, workingMemory: WORKING_MEMORY, semanticRecall: SEMANTIC_RECALL, observationalMemory: OBSERVATIONAL_MEMORY },
  });
}
