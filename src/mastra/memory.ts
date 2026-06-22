import { Memory } from '@mastra/memory';
import type { MastraStorage } from '@mastra/core/storage';
import { PgVector } from '@mastra/pg';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { glmProvider } from './models';
import { PG_SSL } from './storage';

/** Fireworks embedding model (768-dim) for semantic recall — same provider/key as the chat models. */
const EMBED_MODEL = 'nomic-ai/nomic-embed-text-v1.5';

/**
 * Verbatim recency window. NOTE: counts messages, not turns — one agentic step (tool
 * call + result + response) is several messages, so 100 messages ≈ a few dozen turns.
 * Set generous; semantic recall reaches back across ALL history (resource-scoped) so
 * total memory isn't capped at this window, and working memory holds durable facts on
 * top. If large tool-result messages strain the context window, prefer adding a token-
 * budget processor over shrinking this.
 */
const LAST_MESSAGES = 100;

/** Relevant older messages pulled back by similarity (resource-scoped → spans the whole swarm + past sessions). */
const SEMANTIC_RECALL = { topK: 5, messageRange: 3, scope: 'resource' as const };

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
    options: { lastMessages: LAST_MESSAGES, workingMemory: WORKING_MEMORY },
  };
  if (vectorOk) {
    cfg.vector = new PgVector({ id: 'copilot-vec', connectionString: url, ssl: PG_SSL });
    cfg.embedder = glmProvider.textEmbeddingModel(EMBED_MODEL);
    cfg.options = { lastMessages: LAST_MESSAGES, workingMemory: WORKING_MEMORY, semanticRecall: SEMANTIC_RECALL };
  }
  return new Memory(cfg);
}

/** Local (non-serverless) file-backed memory with the full strategy — low risk on disk. */
export function localMemory(): Memory {
  return new Memory({
    storage: new LibSQLStore({ id: 'copilot-mem', url: 'file:copilot-mem.db' }),
    vector: new LibSQLVector({ id: 'copilot-mem-vec', url: 'file:copilot-mem.db' }),
    embedder: glmProvider.textEmbeddingModel(EMBED_MODEL),
    options: { lastMessages: LAST_MESSAGES, workingMemory: WORKING_MEMORY, semanticRecall: SEMANTIC_RECALL },
  });
}
