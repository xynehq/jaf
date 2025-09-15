# Tool Authentication API

Tools use a small runtime helper to request credentials and apply them to HTTP requests.

Import and use the helper inside your tool function:

```ts
import { getToolAuth } from '@xynehq/jaf';

const myProtectedTool = {
  schema: { /* ... */ },
  execute: async (args, context) => {
    const auth = getToolAuth(context);

    // 1) Describe how to authenticate
    const authConfig = {
      authScheme: {
        type: 'oauth2',
        authorizationUrl: 'https://provider/authorize',
        tokenUrl: 'https://provider/token',
        scopes: { 'profile': 'profile' },
        usePKCE: true,
      },
      rawAuthCredential: {
        type: 'OAUTH2',
        clientId: process.env.CLIENT_ID!,
        clientSecret: process.env.CLIENT_SECRET,
        scopes: ['profile'],
      },
    } as const;

    // 2) Use cached/exchanged tokens if available; else pause for auth
    const tokens = await auth.getAuthResponse(authConfig);
    if (!tokens) {
      await auth.requestCredential(authConfig); // throws; engine emits tool_auth
    }

    // 3) Apply auth to your request and call the API
    const req = await auth.applyAuth({ url: 'https://api.example.com/me', headers: {} }, authConfig);
    const res = await fetch(req.url!, { headers: req.headers });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return await res.text();
  }
};
```

## High-level builder (no auth code in execute)

When you don't want to write any auth logic inside the tool, use the factory `makeHttpTool`. You supply a request builder; optionally pass `auth` to enable OAuth2/OIDC/API key injection. The helper handles pause/resume, token exchange, and header injection when `auth` is provided.

```ts
import { z } from 'zod';
import { makeHttpTool } from '@xynehq/jaf';

export const getUserInfo = makeHttpTool({
  name: 'get_user_info',
  description: 'Fetch the authenticated user info',
  parameters: z.object({ endpoint: z.string().url().optional() }),
  auth: {
    authScheme: {
      type: 'openidconnect',
      openIdConnectUrl: process.env.OIDC_DISCOVERY_URL!,
      scopes: ['openid', 'profile', 'email']
    },
    rawAuthCredential: {
      type: 'OPEN_ID_CONNECT',
      clientId: process.env.OIDC_CLIENT_ID!,
      clientSecret: process.env.OIDC_CLIENT_SECRET
    }
  },
  request: async (args) => ({
    url: args.endpoint || process.env.PROTECTED_API_URL!,
    method: 'GET',
  }),
  onResponse: async (res) => JSON.stringify(await res.json())
});
```

You can also omit `auth` entirely to create a generic HTTP tool without authentication.

Runtime methods:
- `getAuthResponse(authConfig)`: returns an exchanged credential if available; performs token exchange if a callback was submitted; attempts refresh on expiry.
- `requestCredential(authConfig)`: throws a special error that the engine converts into a `tool_auth` interruption; JAF pauses the run and emits an auth URL for the client to open.
- `applyAuth(requestInit, authConfig)`: injects credentials into headers/query/cookies based on the scheme.
- `getCached/setCached/clearCached(cacheKey)`: session-level cache helpers for custom flows.

Supported schemes:
- API Key: header/query/cookie injection
- HTTP Bearer: `Authorization: Bearer <token>`
- OAuth2 / OIDC: Authorization Code + PKCE (when configured), OIDC discovery to resolve endpoints

## AuthScheme and AuthCredential

JAF models authentication as two complementary parts:

- `authScheme`: how the target API expects credentials (OpenAPI 3.0–style)
- `rawAuthCredential`: the initial credential your app supplies (client id/secret, api key, or an already‑obtained bearer token)

Type shapes (TypeScript)

```ts
// How the API expects credentials
type AuthScheme =
  | { type: 'apiKey'; in: 'header' | 'query' | 'cookie'; name: string }
  | { type: 'http'; scheme: 'bearer' }
  | {
      type: 'oauth2';
      authorizationUrl: string;
      tokenUrl: string;
      scopes?: Record<string, string>; // e.g., { 'openid': 'OpenID', 'email': 'Email' }
      usePKCE?: boolean;               // enable PKCE code_challenge
    }
  | {
      type: 'openidconnect';
      openIdConnectUrl: string;        // well-known discovery URL
      scopes?: string[];               // e.g., ['openid', 'profile', 'email']
    };

// Initial credential provided by your application
type AuthCredential =
  | { type: 'API_KEY'; value: string }
  | { type: 'HTTP'; bearer?: string } // if bearer provided, no exchange is needed
  | { type: 'OAUTH2'; clientId: string; clientSecret?: string; scopes?: string[] }
  | { type: 'OPEN_ID_CONNECT'; clientId: string; clientSecret?: string; issuer?: string; scopes?: string[] };

// Full configuration used by tools
type AuthConfig = {
  authScheme: AuthScheme;
  rawAuthCredential: AuthCredential;
};

// Result of a successful exchange/refresh
type ExchangedAuthCredential = {
  tokenType?: string;           // e.g., 'Bearer'
  accessToken: string;          // access token for API calls
  refreshToken?: string;        // present if the provider issued one
  expiresAt?: number;           // epoch ms; used to refresh before expiry
};
```

Examples

API Key in header:

```ts
const auth = {
  authScheme: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
  rawAuthCredential: { type: 'API_KEY', value: process.env.MY_API_KEY! }
};
```

OAuth2 (Authorization Code with PKCE):

```ts
const scopes = ['openid', 'profile', 'email'];
const auth = {
  authScheme: {
    type: 'oauth2',
    authorizationUrl: 'https://accounts.example.com/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.example.com/token',
    scopes: Object.fromEntries(scopes.map(s => [s, s])),
    usePKCE: true,
  },
  rawAuthCredential: {
    type: 'OAUTH2',
    clientId: process.env.CLIENT_ID!,
    clientSecret: process.env.CLIENT_SECRET, // optional if pure PKCE
    scopes,
  },
};
```

OpenID Connect (discovery):

```ts
const auth = {
  authScheme: {
    type: 'openidconnect',
    openIdConnectUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    scopes: ['openid', 'profile', 'email']
  },
  rawAuthCredential: {
    type: 'OPEN_ID_CONNECT',
    clientId: process.env.OIDC_CLIENT_ID!,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
  }
};
```

Notes and tips
- When using OAuth2/OIDC, JAF emits an authorization URL during `tool_auth`. If you set `redirectUri` in the scheme, JAF includes it automatically. Otherwise, append your app’s `redirect_uri` and redirect users to complete consent.
- PKCE: set `usePKCE: true` to generate a code challenge/verify; recommended when you don’t want to store a client secret.
- OIDC discovery: JAF fetches the well‑known document to discover `authorization_endpoint` and `token_endpoint` from `openIdConnectUrl`.
- Bearer tokens: if you already have a bearer token, you can skip exchange by setting `authScheme: { type: 'http', scheme: 'bearer' }` and `rawAuthCredential: { type: 'HTTP', bearer: '...' }`.
