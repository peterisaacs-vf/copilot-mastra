import { LibSQLStore } from '@mastra/libsql';
import { PostgresStore } from '@mastra/pg';

/** Neon/Postgres needs SSL; rejectUnauthorized:false avoids cert-chain issues on serverless. */
export const PG_SSL = { rejectUnauthorized: false } as const;

/** Postgres connection string from any of the common env var names (Neon/Vercel set these). */
export function getPostgresUrl(): string | undefined {
  for (const k of ['DATABASE_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_PRISMA_URL', 'NEON_DATABASE_URL']) {
    const v = process.env[k];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

export const hasPostgres = (): boolean => Boolean(getPostgresUrl());

export function makePostgresStore(url: string): PostgresStore {
  return new PostgresStore({ connectionString: url, ssl: PG_SSL, max: 3 });
}

export function makeLibsqlStore(): LibSQLStore {
  const isServerless = Boolean(process.env.VERCEL);
  const url = process.env.STORAGE_URL ?? (isServerless ? 'file:/tmp/copilot.db' : 'file:copilot.db');
  return new LibSQLStore({ id: 'copilot', url });
}
