import { Memory } from '@mastra/memory';
import { PgVector, PostgresStore } from '@mastra/pg';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { glmProvider } from './models';
import { getPostgresUrl } from './storage';

/** Fireworks embedding model (768-dim) for semantic recall — same provider/key as the chat models. */
const EMBED_MODEL = 'nomic-ai/nomic-embed-text-v1.5';

/**
 * Build the shared agent Memory (conversation threads + semantic recall).
 *  - Postgres present  → durable + shared across instances (pgvector for recall).
 *  - local (non-Vercel) → durable file-backed LibSQL.
 *  - serverless w/o PG  → undefined: ephemeral /tmp memory is per-instance and
 *    would "lose" threads across instances, so we skip it (Studio shows
 *    "Memory not enabled") until a real DB is configured.
 * Never throws — a failure just disables memory so the agents still boot.
 */
export function buildMemory(): Memory | undefined {
  try {
    const embedder = glmProvider.textEmbeddingModel(EMBED_MODEL);
    const semanticRecall = { topK: 4, messageRange: 2, scope: 'resource' as const };
    const pg = getPostgresUrl();

    if (pg) {
      return new Memory({
        storage: new PostgresStore({ connectionString: pg, max: 5 }),
        vector: new PgVector({ connectionString: pg }),
        embedder,
        options: { lastMessages: 20, semanticRecall },
      });
    }
    if (!process.env.VERCEL) {
      return new Memory({
        storage: new LibSQLStore({ id: 'copilot-mem', url: 'file:copilot-mem.db' }),
        vector: new LibSQLVector({ id: 'copilot-mem-vec', url: 'file:copilot-mem.db' }),
        embedder,
        options: { lastMessages: 20, semanticRecall },
      });
    }
    return undefined;
  } catch (e) {
    console.warn('[memory] disabled —', (e as Error).message);
    return undefined;
  }
}
