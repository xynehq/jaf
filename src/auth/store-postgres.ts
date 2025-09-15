import type { AuthStore } from './store';
import type { AuthConfig, ExchangedAuthCredential } from './types';

export type PostgresAuthStoreConfig = {
  connectionString: string;
  table?: string; // base table for KV; pending will use `${table}_pending`
};

export async function createPostgresAuthStore(config: PostgresAuthStoreConfig): Promise<AuthStore> {
  const table = config.table ?? 'jaf_auth_kv';
  const tablePending = `${table}_pending`;

  // Lazy import pg only when used
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: config.connectionString });

  // Ensure tables exist
  await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);

  await pool.query(`CREATE TABLE IF NOT EXISTS ${tablePending} (
    pkey TEXT PRIMARY KEY,
    auth_key TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);

  const upsertKv = async (key: string, value: any) => {
    await pool.query(
      `INSERT INTO ${table} (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
  };

  const getKv = async <T>(key: string): Promise<T | null> => {
    const r = await pool.query(`SELECT value FROM ${table} WHERE key = $1`, [key]);
    if (r.rowCount === 0) return null;
    return r.rows[0].value as T;
  };

  return {
    async setConfig(authKey, cfg) {
      await upsertKv(`cfg:${authKey}`, cfg);
    },
    async getConfig(authKey) {
      return await getKv<AuthConfig>(`cfg:${authKey}`);
    },
    async setTokens(authKey, tokens) {
      await upsertKv(`tok:${authKey}`, tokens);
    },
    async getTokens(authKey) {
      return await getKv<ExchangedAuthCredential>(`tok:${authKey}`);
    },
    async clearTokens(authKey) {
      await pool.query(`DELETE FROM ${table} WHERE key = $1`, [`tok:${authKey}`]);
    },
    async setAuthResponse(authKey, payload) {
      await upsertKv(`rsp:${authKey}`, payload);
    },
    async getAuthResponse(authKey) {
      return await getKv<{ authResponseUri: string; redirectUri?: string }>(`rsp:${authKey}`);
    },
    async clearAuthResponse(authKey) {
      await pool.query(`DELETE FROM ${table} WHERE key = $1`, [`rsp:${authKey}`]);
    },
    async setPending(sessionId, toolCallId, authKey) {
      const k = `${sessionId}:${toolCallId}`;
      await pool.query(
        `INSERT INTO ${tablePending} (pkey, auth_key, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (pkey) DO UPDATE SET auth_key = EXCLUDED.auth_key, updated_at = NOW()`,
        [k, authKey]
      );
    },
    async getPending(sessionId, toolCallId) {
      const k = `${sessionId}:${toolCallId}`;
      const r = await pool.query(`SELECT auth_key FROM ${tablePending} WHERE pkey = $1`, [k]);
      if (r.rowCount === 0) return null;
      return r.rows[0].auth_key as string;
    },
    async clearPending(sessionId, toolCallId) {
      const k = `${sessionId}:${toolCallId}`;
      await pool.query(`DELETE FROM ${tablePending} WHERE pkey = $1`, [k]);
    },
  };
}

