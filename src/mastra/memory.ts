import { Memory } from '@mastra/memory';
import type { MastraStorage } from '@mastra/core/storage';
import { PgVector } from '@mastra/pg';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { glmProvider } from './models';
import { PG_SSL } from './storage';

/** Fireworks embedding model (768-dim) for semantic recall — same provider/key as the chat models. */
const EMBED_MODEL = 'nomic-ai/nomic-embed-text-v1.5';

/**
 * Memory backed by an already-initialized Postgres store. Threads-only by default
 * (durable conversation history) — set `recall` to add pgvector semantic recall
 * (needs the `vector` extension; turned on once verified so a recall failure can't
 * break agent calls).
 */
export function pgMemory(store: MastraStorage, url: string, recall = false): Memory {
  const cfg: ConstructorParameters<typeof Memory>[0] = {
    storage: store,
    options: { lastMessages: 20 },
  };
  if (recall) {
    cfg.vector = new PgVector({ connectionString: url, ssl: PG_SSL });
    cfg.embedder = glmProvider.textEmbeddingModel(EMBED_MODEL);
    cfg.options = { lastMessages: 20, semanticRecall: { topK: 4, messageRange: 2, scope: 'resource' } };
  }
  return new Memory(cfg);
}

/** Local (non-serverless) file-backed memory with semantic recall — low risk on disk. */
export function localMemory(): Memory {
  return new Memory({
    storage: new LibSQLStore({ id: 'copilot-mem', url: 'file:copilot-mem.db' }),
    vector: new LibSQLVector({ id: 'copilot-mem-vec', url: 'file:copilot-mem.db' }),
    embedder: glmProvider.textEmbeddingModel(EMBED_MODEL),
    options: { lastMessages: 20, semanticRecall: { topK: 4, messageRange: 2, scope: 'resource' } },
  });
}
