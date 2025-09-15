Auth Demo (OAuth2/OIDC) for JAF

This example shows how to use the new tool authentication features to call a protected API (e.g., OIDC userinfo) using OAuth2/OIDC.

Setup
- Copy `.env.example` to `.env` and set values:
  - `LITELLM_URL`, `LITELLM_MODEL`: a LiteLLM endpoint + model
  - Either OIDC discovery or OAuth2 endpoints:
    - OIDC: `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES`
    - OAuth2: `OAUTH_AUTHORIZATION_URL`, `OAUTH_TOKEN_URL`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_SCOPES`
  - `AUTH_REDIRECT_URI`: must be registered with your provider (e.g., `http://localhost:5173/callback`)
  - `PROTECTED_API_URL`: API to call after auth (commonly the OIDC `userinfo` endpoint)

Run
- Start LiteLLM (or point to an existing one)
- Run: `pnpm tsx examples/auth-demo/index.ts`
- The script starts a JAF server on `127.0.0.1:3333`, triggers a tool call, and if auth is needed it will:
  - Print an authorization URL (with `redirect_uri` appended)
  - Start a local HTTP listener at `AUTH_REDIRECT_URI`
  - After you log in and the provider redirects back, it POSTs to `/auth/submit` and resumes the chat

Notes
- Tokens and client secrets are stored only in the in-memory `AuthStore` by default. For production, provide a persistent `AuthStore` implementation.
- This example uses the `getToolAuth` runtime helper to request credentials and apply them to the outbound HTTP request.
