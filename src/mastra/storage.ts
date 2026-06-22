import { LibSQLStore } from '@mastra/libsql';
import { PostgresStore } from '@mastra/pg';

/**
 * Durable storage backend. Uses Postgres (Neon) when a connection string is
 * present — durable and shared across all serverless instances — otherwise
 * LibSQL (a repo-root file locally, /tmp on serverless). Postgres is what makes
 * memory + the editor reliable on Vercel (every instance hits the same DB).
 */
export function getPostgresUrl(): string | undefined {
  for (const k of ['DATABASE_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_PRISMA_URL', 'NEON_DATABASE_URL']) {
    const v = process.env[k];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

export const hasPostgres = (): boolean => Boolean(getPostgresUrl());

export function getStorage() {
  const pg = getPostgresUrl();
  if (pg) return new PostgresStore({ connectionString: pg, max: 5 });
  const isServerless = Boolean(process.env.VERCEL);
  const url = process.env.STORAGE_URL ?? (isServerless ? 'file:/tmp/copilot.db' : 'file:copilot.db');
  return new LibSQLStore({ id: 'copilot', url });
}
