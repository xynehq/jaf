import { createInMemoryAuthStore, type AuthStore } from './store';
import { wrapAuthStoreWithKms } from './store-kms-wrapper';
import { createKmsCrypto } from './kms';

export async function createAuthStoreFromEnv(): Promise<AuthStore> {
  try {
    const kind = process.env.JAF_AUTH_STORE || '';

    // Redis
    const redisUrl = process.env.JAF_AUTH_REDIS_URL || process.env.REDIS_URL;
    if (kind.toLowerCase() === 'redis' || redisUrl) {
      const { createRedisAuthStore } = await import('./store-redis');
      let base = await createRedisAuthStore({
        url: redisUrl!,
        prefix: process.env.JAF_AUTH_REDIS_PREFIX || 'jaf:auth:',
      });
      // Optional KMS
      if ((process.env.JAF_AUTH_ENCRYPTION || '').toLowerCase() === 'kms') {
        const keyId = process.env.JAF_AUTH_KMS_KEY_ID;
        if (!keyId) throw new Error('JAF_AUTH_KMS_KEY_ID is required for KMS encryption');
        const crypto = await createKmsCrypto({
          keyId,
          region: process.env.AWS_REGION,
        });
        base = wrapAuthStoreWithKms(base, crypto);
      }
      return base;
    }

    // Postgres
    const pgUrl = process.env.JAF_AUTH_PG_URL || process.env.DATABASE_URL;
    if (kind.toLowerCase() === 'postgres' || pgUrl) {
      const { createPostgresAuthStore } = await import('./store-postgres');
      let base = await createPostgresAuthStore({
        connectionString: pgUrl!,
        table: process.env.JAF_AUTH_PG_TABLE || 'jaf_auth_kv',
      });
      if ((process.env.JAF_AUTH_ENCRYPTION || '').toLowerCase() === 'kms') {
        const keyId = process.env.JAF_AUTH_KMS_KEY_ID;
        if (!keyId) throw new Error('JAF_AUTH_KMS_KEY_ID is required for KMS encryption');
        const crypto = await createKmsCrypto({
          keyId,
          region: process.env.AWS_REGION,
        });
        base = wrapAuthStoreWithKms(base, crypto);
      }
      return base;
    }
  } catch (e) {
    console.warn(`[AUTH] Failed to create AuthStore from env: ${(e as Error).message}. Falling back to in-memory.`);
  }
  return createInMemoryAuthStore();
}
