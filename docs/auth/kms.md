# AWS KMS Encryption (Optional)

You can encrypt AuthStore values at rest using AWS KMS. This wraps any underlying store (Redis/Postgres) so configs, tokens, and callback payloads are stored as ciphertext.

Enable via Env
- `JAF_AUTH_ENCRYPTION=kms`
- `JAF_AUTH_KMS_KEY_ID=arn:aws:kms:...` (your key ARN or KeyId)
- `AWS_REGION=us-east-1` (or your region)
- Ensure AWS credentials are available in the environment (instance profile, env vars, or shared config)

How it works
- `createAuthStoreFromEnv()` creates the base store (Redis/Postgres) and wraps it with `wrapAuthStoreWithKms()`.
- On writes, values are JSON-stringified and encrypted with KMS; on reads, they are decrypted.
- Pending mappings are not encrypted (they contain no secrets, just a short authKey).

Programmatic Setup
```ts
import { createKmsCrypto, wrapAuthStoreWithKms, createRedisAuthStore } from '@xynehq/jaf';

const base = await createRedisAuthStore({ url: 'redis://localhost:6379/0' });
const crypto = await createKmsCrypto({ keyId: process.env.JAF_AUTH_KMS_KEY_ID!, region: process.env.AWS_REGION });
const store = wrapAuthStoreWithKms(base, crypto);
```

Notes
- This implementation uses direct KMS Encrypt/Decrypt calls; payload sizes are typically small (tokens/configs). If you need envelope encryption for larger payloads, open an issue.
- The AWS SDK client is imported dynamically; install `@aws-sdk/client-kms` in the runtime where you enable this feature.

