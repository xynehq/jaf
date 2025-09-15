# Auth Demo Walkthrough

The repo includes a runnable demo that exercises the full OAuth2/OIDC flow.

Location: `examples/auth-demo`

Configure
- Copy `.env.example` to `.env` and set:
  - LiteLLM: `LITELLM_URL`, `LITELLM_MODEL` (e.g., `gpt-4o-mini`)
  - Choose one auth mode:
    - OIDC: `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES`
    - OAuth2: `OAUTH_AUTHORIZATION_URL`, `OAUTH_TOKEN_URL`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_SCOPES`
  - Redirect: `AUTH_REDIRECT_URI` (e.g., `http://localhost:5173/callback`, must be registered at your provider)
  - Protected API: `PROTECTED_API_URL` (commonly the OIDC `userinfo` endpoint)

Run
```bash
pnpm -F jaf-auth-demo install
pnpm -F jaf-auth-demo dev
```

Flow
1) The demo starts a JAF server on `127.0.0.1:3333` and calls `/chat`.
2) The tool requests credentials via `requestCredential`; the engine emits a `tool_auth` interruption.
3) The demo auto-opens the provider auth URL in your browser and spins up a small local listener at `AUTH_REDIRECT_URI`.
4) After login, the provider redirects to the local listener; the full callback URL is POSTed to `/auth/submit`.
5) A second `/chat` call resumes; JAF exchanges the code for tokens and retries the tool. The tool fetches the protected API and the conversation completes.

Persistent Stores (Optional)
- Set env to use Redis or Postgres for tokens and configs; see [Auth Storage](stores.md).
- To enable KMS encryption, see [AWS KMS](kms.md).

