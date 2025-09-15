import type { AuthStore } from './store';
import type { AuthConfig, ExchangedAuthCredential } from './types';

// Minimal Redis client surface (ioredis-compatible)
type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: any[]): Promise<any>;
  del(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<any> | void;
};

export type RedisAuthStoreConfig = {
  url: string;
  prefix?: string; // key prefix
  responseTtlSec?: number; // TTL for one-time auth response
};

function keys(prefix: string) {
  return {
    cfg: (authKey: string) => `${prefix}cfg:${authKey}`,
    tok: (authKey: string) => `${prefix}tok:${authKey}`,
    rsp: (authKey: string) => `${prefix}rsp:${authKey}`,
    pend: (sessionId: string, toolCallId: string) => `${prefix}pend:${sessionId}:${toolCallId}`,
  } as const;
}

export async function createRedisAuthStore(config: RedisAuthStoreConfig): Promise<AuthStore> {
  const prefix = config.prefix ?? 'jaf:auth:';
  const responseTtl = config.responseTtlSec ?? 10 * 60; // 10 minutes default

  // Lazy import ioredis only when used
  const { default: IORedis } = await import('ioredis');
  const client: RedisClient = new IORedis(config.url);

  try {
    await client.ping();
    console.log(`[AUTH:Redis] Connected to ${config.url}`);
  } catch (e) {
    throw new Error(`Failed to connect Redis for AuthStore: ${(e as Error).message}`);
  }

  const k = keys(prefix);

  return {
    async setConfig(authKey, cfg) {
      await client.set(k.cfg(authKey), JSON.stringify(cfg));
    },
    async getConfig(authKey) {
      const v = await client.get(k.cfg(authKey));
      return v ? (JSON.parse(v) as AuthConfig) : null;
    },
    async setTokens(authKey, tokens) {
      await client.set(k.tok(authKey), JSON.stringify(tokens));
    },
    async getTokens(authKey) {
      const v = await client.get(k.tok(authKey));
      return v ? (JSON.parse(v) as ExchangedAuthCredential) : null;
    },
    async clearTokens(authKey) {
      await client.del(k.tok(authKey));
    },
    async setAuthResponse(authKey, payload) {
      await client.set(k.rsp(authKey), JSON.stringify(payload));
      if (responseTtl > 0) {
        await client.expire(k.rsp(authKey), responseTtl);
      }
    },
    async getAuthResponse(authKey) {
      const v = await client.get(k.rsp(authKey));
      return v ? (JSON.parse(v) as { authResponseUri: string; redirectUri?: string }) : null;
    },
    async clearAuthResponse(authKey) {
      await client.del(k.rsp(authKey));
    },
    async setPending(sessionId, toolCallId, authKey) {
      await client.set(k.pend(sessionId, toolCallId), authKey);
      if (responseTtl > 0) {
        await client.expire(k.pend(sessionId, toolCallId), responseTtl);
      }
    },
    async getPending(sessionId, toolCallId) {
      const v = await client.get(k.pend(sessionId, toolCallId));
      return v || null;
    },
    async clearPending(sessionId, toolCallId) {
      await client.del(k.pend(sessionId, toolCallId));
    },
  };
}
