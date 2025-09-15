import crypto from 'crypto';

// Authentication types and helpers for tools

export type AuthCredentialType = 'API_KEY' | 'HTTP' | 'OAUTH2' | 'OPEN_ID_CONNECT';

export type ApiKeyLocation = 'header' | 'query' | 'cookie';

export type ApiKeyScheme = {
  type: 'apiKey';
  in: ApiKeyLocation;
  name: string; // header/query/cookie name
};

export type HttpScheme = {
  type: 'http';
  scheme: 'bearer';
};

export type OAuth2Scheme = {
  type: 'oauth2';
  authorizationUrl: string; // provider authorization endpoint
  tokenUrl: string; // provider token endpoint
  scopes?: Record<string, string>;
  usePKCE?: boolean;
  redirectUri?: string;
};

export type OidcScheme = {
  type: 'openidconnect';
  openIdConnectUrl: string; // issuer discovery endpoint (well-known)
  scopes?: string[]; // requested scopes
  redirectUri?: string;
};

export type AuthScheme = ApiKeyScheme | HttpScheme | OAuth2Scheme | OidcScheme;

export type ApiKeyCredential = {
  type: 'API_KEY';
  value: string;
};

export type HttpCredential = {
  type: 'HTTP';
  bearer?: string; // already-obtained Bearer token
};

export type OAuth2Credential = {
  type: 'OAUTH2';
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
};

export type OidcCredential = {
  type: 'OPEN_ID_CONNECT';
  clientId: string;
  clientSecret?: string;
  issuer?: string; // optional override
  scopes?: string[];
};

export type AuthCredential =
  | ApiKeyCredential
  | HttpCredential
  | OAuth2Credential
  | OidcCredential;

export type ExchangedAuthCredential = {
  tokenType?: string; // e.g., Bearer
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
};

export type AuthConfig = {
  authScheme: AuthScheme;
  rawAuthCredential: AuthCredential;
  exchangedAuthCredential?: ExchangedAuthCredential;
  // internal state (e.g. PKCE verifier). Treated as secret; not sent to clients.
  state?: Record<string, any>;
};

export type AuthRequestPresentation = {
  // Key to correlate submit calls with stored config/tokens
  authKey: string;
  schemeType: AuthScheme['type'];
  authorizationUrl?: string; // for OAuth2/OIDC flows
  scopes?: string[];
};

export function deriveAuthKey(input: {
  agentName?: string;
  toolName?: string;
  scheme: AuthScheme;
  credential: AuthCredential;
}): string {
  const h = crypto.createHash('sha256');
  const base = {
    agentName: input.agentName || '',
    toolName: input.toolName || '',
    scheme: input.scheme,
    credential: {
      type: input.credential.type,
      clientId: (input.credential as any).clientId,
      scopes: (input.credential as any).scopes,
    },
  };
  h.update(JSON.stringify(base));
  return `auth:${h.digest('hex')}`;
}
