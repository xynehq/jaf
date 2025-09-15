import type { AuthStore } from './store';
import type { AuthConfig, ExchangedAuthCredential } from './types';
import type { KmsCrypto } from './kms';

type EncryptedPayload = { _enc: 'kms'; blob: string };
function isEncrypted(v: any): v is EncryptedPayload {
  return v && typeof v === 'object' && v._enc === 'kms' && typeof v.blob === 'string';
}

export function wrapAuthStoreWithKms(store: AuthStore, crypto: KmsCrypto): AuthStore {
  return {
    async setConfig(authKey, cfg) {
      const blob = await crypto.encrypt(JSON.stringify(cfg));
      await store.setConfig(authKey, { _enc: 'kms', blob } as any);
    },
    async getConfig(authKey) {
      const val = await store.getConfig(authKey);
      if (!val) return null;
      if (isEncrypted(val)) {
        const pt = await crypto.decrypt(val.blob);
        return JSON.parse(pt) as AuthConfig;
      }
      return val as any; // backward compatibility
    },
    async setTokens(authKey, tokens) {
      const blob = await crypto.encrypt(JSON.stringify(tokens));
      await store.setTokens(authKey, { _enc: 'kms', blob } as any);
    },
    async getTokens(authKey) {
      const val = await store.getTokens(authKey);
      if (!val) return null;
      if (isEncrypted(val)) {
        const pt = await crypto.decrypt(val.blob);
        return JSON.parse(pt) as ExchangedAuthCredential;
      }
      return val as any;
    },
    async clearTokens(authKey) {
      await store.clearTokens(authKey);
    },
    async setAuthResponse(authKey, payload) {
      const blob = await crypto.encrypt(JSON.stringify(payload));
      await store.setAuthResponse(authKey, { _enc: 'kms', blob } as any);
    },
    async getAuthResponse(authKey) {
      const val = await store.getAuthResponse(authKey);
      if (!val) return null;
      if (isEncrypted(val)) {
        const pt = await crypto.decrypt(val.blob);
        return JSON.parse(pt) as { authResponseUri: string; redirectUri?: string };
      }
      return val as any;
    },
    async clearAuthResponse(authKey) {
      await store.clearAuthResponse(authKey);
    },
    async setPending(sessionId, toolCallId, authKey) {
      await store.setPending(sessionId, toolCallId, authKey);
    },
    async getPending(sessionId, toolCallId) {
      return await store.getPending(sessionId, toolCallId);
    },
    async clearPending(sessionId, toolCallId) {
      await store.clearPending(sessionId, toolCallId);
    },
  };
}

