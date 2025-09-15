# Auth Storage (AuthStore)

AuthStore is the pluggable storage layer for auth configs, tokens, and one-time callback responses.

Interface
```ts
type AuthStore = {
  setConfig(authKey: string, cfg: AuthConfig): Promise<void>;
  getConfig(authKey: string): Promise<AuthConfig | null>;
  setTokens(authKey: string, t: ExchangedAuthCredential): Promise<void>;
  getTokens(authKey: string): Promise<ExchangedAuthCredential | null>;
  clearTokens(authKey: string): Promise<void>;
  setAuthResponse(authKey: string, payload: { authResponseUri: string; redirectUri?: string }): Promise<void>;
  getAuthResponse(authKey: string): Promise<{ authResponseUri: string; redirectUri?: string } | null>;
  clearAuthResponse(authKey: string): Promise<void>;
  setPending(sessionId: string, toolCallId: string, authKey: string): Promise<void>;
  getPending(sessionId: string, toolCallId: string): Promise<string | null>;
  clearPending(sessionId: string, toolCallId: string): Promise<void>;
}
```

Implementations
- In-memory (default): `createInMemoryAuthStore()`
- Redis: `createRedisAuthStore({ url, prefix?, responseTtlSec? })`
- Postgres: `createPostgresAuthStore({ connectionString, table? })`

Env Factory
- `createAuthStoreFromEnv()` selects the store based on env:
  - Redis: `JAF_AUTH_STORE=redis` or `JAF_AUTH_REDIS_URL`/`REDIS_URL`
  - Postgres: `JAF_AUTH_STORE=postgres` or `JAF_AUTH_PG_URL`/`DATABASE_URL`
  - Else: in-memory

Server Integration
- The JAF server initializes a shared AuthStore on startup and uses it for both `/chat` and `/auth/submit`.
- You can also pass a custom store into `runConfig.authStore` to override the default.

Examples
```ts
import { createRedisAuthStore, createPostgresAuthStore } from '@xynehq/jaf';

const redisStore = await createRedisAuthStore({ url: 'redis://localhost:6379/0' });
const pgStore = await createPostgresAuthStore({ connectionString: process.env.DATABASE_URL! });
```

