import { Pool } from 'pg';
import type { OAuthStorage } from '@mastra/mcp';
import { PG_SSL } from './storage';

/**
 * Postgres-backed OAuth storage for MCPOAuthClientProvider.
 *
 * Why this exists: the provider keeps ALL its state here — the dynamically
 * registered client, the PKCE code verifier, and the access/refresh tokens.
 * On Vercel the function is serverless and ephemeral: a different instance may
 * handle /oauth/start vs /oauth/callback, and instances are recycled constantly.
 * The default InMemoryOAuthStorage would lose the code verifier between the two
 * requests (breaking the exchange) and drop tokens on every cold start. Backing
 * it with our Neon DB makes the one-time consent persist and survive restarts,
 * so the agent can refresh tokens indefinitely without re-consent.
 *
 * It's a simple key/value table; the provider owns the key names and values
 * (opaque JSON strings). Tokens are secrets — they live only in our own DB.
 */
const TABLE = 'oauth_kv';

export class PgOAuthStorage implements OAuthStorage {
  private pool: Pool;
  private ready?: Promise<void>;

  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, ssl: PG_SSL, max: 2 });
  }

  private init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.pool
        .query(
          `CREATE TABLE IF NOT EXISTS ${TABLE} (k text PRIMARY KEY, v text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
        )
        .then(() => undefined);
    }
    return this.ready;
  }

  async set(key: string, value: string): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO ${TABLE} (k, v, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()`,
      [key, value],
    );
  }

  async get(key: string): Promise<string | undefined> {
    await this.init();
    const r = await this.pool.query(`SELECT v FROM ${TABLE} WHERE k = $1`, [key]);
    return r.rows[0]?.v as string | undefined;
  }

  async delete(key: string): Promise<void> {
    await this.init();
    await this.pool.query(`DELETE FROM ${TABLE} WHERE k = $1`, [key]);
  }

  /** Clear ALL stored OAuth state (registered client, PKCE verifier, tokens). */
  async clearAll(): Promise<void> {
    await this.init();
    await this.pool.query(`DELETE FROM ${TABLE}`);
  }
}
