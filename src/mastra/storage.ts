import { LibSQLStore } from '@mastra/libsql';
import { PostgresStore } from '@mastra/pg';
import { Client } from 'pg';

/** Neon/Postgres needs SSL; rejectUnauthorized:false avoids cert-chain issues on serverless. */
export const PG_SSL = { rejectUnauthorized: false } as const;

/**
 * Postgres connection string, preferring the UNPOOLED (direct) connection.
 *
 * Neon's Vercel integration sets DATABASE_URL to the *pooled* (PgBouncer) endpoint
 * by default. PgBouncer transaction-pooling breaks Mastra's storage migrations,
 * which rely on session-scoped features (advisory locks for migration coordination,
 * CREATE EXTENSION) — so init() throws and memory silently falls back. The direct
 * connection runs migrations cleanly; fine for a low-traffic demo (pool capped at 3).
 */
export function getPostgresUrl(): string | undefined {
  // 1) Explicit unpooled vars win.
  for (const k of ['DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING']) {
    const v = process.env[k];
    if (v && v.trim()) return v.trim();
  }
  // 2) Otherwise take a pooled var and de-pool it (drop Neon's "-pooler" host segment).
  for (const k of ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'NEON_DATABASE_URL']) {
    const v = process.env[k];
    if (v && v.trim()) return v.trim().replace(/-pooler\./, '.');
  }
  return undefined;
}

export const hasPostgres = (): boolean => Boolean(getPostgresUrl());

export function makePostgresStore(url: string): PostgresStore {
  return new PostgresStore({ id: 'copilot', connectionString: url, ssl: PG_SSL, max: 3 });
}

/**
 * Probe whether pgvector is usable (semantic recall depends on it). Runs the exact
 * statement PgVector needs — CREATE EXTENSION IF NOT EXISTS vector — so if the Neon
 * role can't enable it, we learn HERE (and disable recall) rather than 500-ing every
 * agent call that does a recall query. Never throws.
 */
export async function probePgvector(url: string): Promise<boolean> {
  const c = new Client({ connectionString: url, ssl: PG_SSL, connectionTimeoutMillis: 8000, statement_timeout: 8000 });
  try {
    await c.connect();
    await c.query('CREATE EXTENSION IF NOT EXISTS vector');
    return true;
  } catch (e: any) {
    console.warn(`[pgvector] unavailable: ${e?.code ?? '?'} ${String(e?.message ?? e).slice(0, 90)}`);
    return false;
  } finally {
    try { await c.end(); } catch { /* ignore */ }
  }
}

export function makeLibsqlStore(): LibSQLStore {
  const isServerless = Boolean(process.env.VERCEL);
  const url = process.env.STORAGE_URL ?? (isServerless ? 'file:/tmp/copilot.db' : 'file:copilot.db');
  return new LibSQLStore({ id: 'copilot', url });
}
