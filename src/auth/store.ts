import { AuthConfig, ExchangedAuthCredential } from './types';

export interface AuthStore {
  // Store full auth config (with secrets) under a derived key
  setConfig: (authKey: string, config: AuthConfig) => Promise<void>;
  getConfig: (authKey: string) => Promise<AuthConfig | null>;

  // Store exchanged tokens
  setTokens: (authKey: string, tokens: ExchangedAuthCredential) => Promise<void>;
  getTokens: (authKey: string) => Promise<ExchangedAuthCredential | null>;
  clearTokens: (authKey: string) => Promise<void>;

  // Temporary user callback response (authorization response URI & redirect URI)
  setAuthResponse: (authKey: string, payload: { authResponseUri: string; redirectUri?: string }) => Promise<void>;
  getAuthResponse: (authKey: string) => Promise<{ authResponseUri: string; redirectUri?: string } | null>;
  clearAuthResponse: (authKey: string) => Promise<void>;

  // Mapping toolCall to authKey for correlation
  setPending: (sessionId: string, toolCallId: string, authKey: string) => Promise<void>;
  getPending: (sessionId: string, toolCallId: string) => Promise<string | null>;
  clearPending: (sessionId: string, toolCallId: string) => Promise<void>;
}

export function createInMemoryAuthStore(): AuthStore {
  const configs = new Map<string, AuthConfig>();
  const tokens = new Map<string, ExchangedAuthCredential>();
  const responses = new Map<string, { authResponseUri: string; redirectUri?: string }>();
  const pending = new Map<string, string>(); // key: `${sessionId}:${toolCallId}` -> authKey
  const responseTimers = new Map<string, NodeJS.Timeout>();
  const pendingTimers = new Map<string, NodeJS.Timeout>();
  const TTL_SEC = 10 * 60; // 10 minutes for one-time responses and pending mappings

  const key = (sessionId: string, toolCallId: string) => `${sessionId}:${toolCallId}`;

  return {
    async setConfig(authKey, config) {
      configs.set(authKey, config);
    },
    async getConfig(authKey) {
      return configs.get(authKey) || null;
    },
    async setTokens(authKey, t) {
      tokens.set(authKey, t);
    },
    async getTokens(authKey) {
      return tokens.get(authKey) || null;
    },
    async clearTokens(authKey) {
      tokens.delete(authKey);
    },
    async setAuthResponse(authKey, payload) {
      responses.set(authKey, payload);
      // set TTL
      const prev = responseTimers.get(authKey);
      if (prev) clearTimeout(prev);
      const t = setTimeout(() => {
        try { responses.delete(authKey); } catch { /* ignore */ }
        try { responseTimers.delete(authKey); } catch { /* ignore */ }
      }, TTL_SEC * 1000);
      responseTimers.set(authKey, t);
    },
    async getAuthResponse(authKey) {
      return responses.get(authKey) || null;
    },
    async clearAuthResponse(authKey) {
      responses.delete(authKey);
    },
    async setPending(sessionId, toolCallId, authKeyStr) {
      const k = key(sessionId, toolCallId);
      pending.set(k, authKeyStr);
      const prev = pendingTimers.get(k);
      if (prev) clearTimeout(prev);
      const t = setTimeout(() => {
        try { pending.delete(k); } catch { /* ignore */ }
        try { pendingTimers.delete(k); } catch { /* ignore */ }
      }, TTL_SEC * 1000);
      pendingTimers.set(k, t);
    },
    async getPending(sessionId, toolCallId) {
      return pending.get(key(sessionId, toolCallId)) || null;
    },
    async clearPending(sessionId, toolCallId) {
      const k = key(sessionId, toolCallId);
      pending.delete(k);
      const t = pendingTimers.get(k);
      if (t) clearTimeout(t);
      pendingTimers.delete(k);
    },
  };
}
