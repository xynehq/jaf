import { AuthConfig, ExchangedAuthCredential, OAuth2Scheme, OidcScheme } from './types';

function parseQueryParamsFromUrl(url: string): Record<string, string> {
  try {
    const u = new URL(url);
    const params: Record<string, string> = {};
    for (const [k, v] of u.searchParams.entries()) params[k] = v;
    // Some providers return code in fragment; parse that as well
    if (u.hash && u.hash.startsWith('#')) {
      const frag = new URLSearchParams(u.hash.substring(1));
      for (const [k, v] of frag.entries()) params[k] = v;
    }
    return params;
  } catch {
    return {};
  }
}

export async function exchangeAuthorizationCode(
  config: AuthConfig,
  authResponseUri: string,
  redirectUri?: string
): Promise<ExchangedAuthCredential> {
  const scheme = config.authScheme;
  if (scheme.type !== 'oauth2' && scheme.type !== 'openidconnect') {
    throw new Error('exchangeAuthorizationCode called for non-OAuth2/OIDC scheme');
  }
  const tokenUrl = scheme.type === 'oauth2' ? scheme.tokenUrl : await discoverTokenEndpoint(scheme);

  const params = parseQueryParamsFromUrl(authResponseUri);
  const code = params['code'];
  if (!code) throw new Error('Authorization code not found in auth response URI');

  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
  };
  if (redirectUri) body.redirect_uri = redirectUri;

  const raw = config.rawAuthCredential as any;
  if (raw.clientId) body.client_id = raw.clientId;
  if (raw.clientSecret) body.client_secret = raw.clientSecret;
  const codeVerifier = config.state?.pkceVerifier;
  if (codeVerifier) body.code_verifier = codeVerifier;

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  const tok = await res.json() as any;
  const now = Date.now();
  const expiresIn = typeof tok.expires_in === 'number' ? tok.expires_in : undefined;
  const expiresAt = expiresIn ? now + expiresIn * 1000 : undefined;
  const out: ExchangedAuthCredential = {
    tokenType: tok.token_type || 'Bearer',
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt,
  };
  return out;
}

export async function refreshAccessToken(
  config: AuthConfig,
  refreshToken: string
): Promise<ExchangedAuthCredential> {
  const scheme = config.authScheme;
  if (scheme.type !== 'oauth2' && scheme.type !== 'openidconnect') {
    throw new Error('refreshAccessToken called for non-OAuth2/OIDC scheme');
  }
  const tokenUrl = scheme.type === 'oauth2' ? scheme.tokenUrl : await discoverTokenEndpoint(scheme);
  const raw = config.rawAuthCredential as any;

  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  };
  if (raw.clientId) body.client_id = raw.clientId;
  if (raw.clientSecret) body.client_secret = raw.clientSecret;

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }
  const tok = await res.json() as any;
  const now = Date.now();
  const expiresIn = typeof tok.expires_in === 'number' ? tok.expires_in : undefined;
  const expiresAt = expiresIn ? now + expiresIn * 1000 : undefined;
  const out: ExchangedAuthCredential = {
    tokenType: tok.token_type || 'Bearer',
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token || refreshToken,
    expiresAt,
  };
  return out;
}

export async function discoverOidcEndpoints(issuerOrWellKnownUrl: string): Promise<{ authorization_endpoint: string; token_endpoint: string }> {
  const wellKnownUrl = issuerOrWellKnownUrl.includes('/.well-known/')
    ? issuerOrWellKnownUrl
    : (issuerOrWellKnownUrl.replace(/\/?$/, '/') + '.well-known/openid-configuration');

  const res = await fetch(wellKnownUrl, { method: 'GET' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`OIDC discovery failed (${res.status}): ${t}`);
  }
  const j = await res.json() as any;
  if (!j.authorization_endpoint || !j.token_endpoint) {
    throw new Error('OIDC well-known document missing endpoints');
  }
  return { authorization_endpoint: j.authorization_endpoint, token_endpoint: j.token_endpoint };
}

async function discoverTokenEndpoint(scheme: OAuth2Scheme | OidcScheme): Promise<string> {
  if (scheme.type === 'oauth2') return scheme.tokenUrl;
  const endpoints = await discoverOidcEndpoints(scheme.openIdConnectUrl);
  return endpoints.token_endpoint;
}
