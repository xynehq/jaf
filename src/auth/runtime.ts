import { getToolRuntime } from '../core/tool-runtime';
import { AuthConfig, AuthScheme, AuthCredential, ExchangedAuthCredential, OAuth2Scheme, OidcScheme, deriveAuthKey, AuthRequestPresentation } from './types';
import { AuthRequiredError } from './errors';
import { webcrypto, randomBytes } from 'crypto';
import { exchangeAuthorizationCode, refreshAccessToken, discoverOidcEndpoints } from './oauth2';

function randomHex(bytes = 16): string {
  return Buffer.from(randomBytes(bytes)).toString('hex');
}

function base64url(input: Uint8Array): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export type ToolAuthContext = {
  getCached: (key: string) => Promise<ExchangedAuthCredential | null>;
  setCached: (key: string, token: ExchangedAuthCredential) => Promise<void>;
  clearCached: (key: string) => Promise<void>;
  getAuthResponse: (config: AuthConfig, toolName?: string) => Promise<ExchangedAuthCredential | null>;
  requestCredential: (config: AuthConfig, toolName?: string) => Promise<never>;
  applyAuth: <T extends { url?: string; headers?: Record<string, string>; query?: URLSearchParams }>(req: T, config: AuthConfig, authKey?: string, toolName?: string) => Promise<T>;
  getTokensFor?: (config: AuthConfig, toolName?: string) => Promise<ExchangedAuthCredential | null>;
  setTokensFor?: (config: AuthConfig, tokens: ExchangedAuthCredential, toolName?: string) => Promise<void>;
  clearTokensFor?: (config: AuthConfig, toolName?: string) => Promise<void>;
};

export function getToolAuth<Ctx>(context: Readonly<Ctx>): ToolAuthContext {
  const runtime = getToolRuntime(context);
  if (!runtime) {
    throw new Error('ToolAuth runtime not available');
  }
  const { state, config } = runtime;
  const storeMaybe = (config as any).authStore as import('./store').AuthStore | undefined;
  if (!storeMaybe) {
    throw new Error('AuthStore is not configured. Provide runConfig.authStore.');
  }
  const store = storeMaybe; // non-null

  const getCached = async (key: string) => store.getTokens(key);
  const setCached = async (key: string, token: ExchangedAuthCredential) => store.setTokens(key, token);
  const clearCached = async (key: string) => store.clearTokens(key);

  async function buildAuthorizationUrl(config: AuthConfig, authKey: string): Promise<string | undefined> {
    const scheme = config.authScheme;
    if (scheme.type === 'oauth2') {
      const raw = config.rawAuthCredential as any;
      // Support PKCE if requested
      const url = new URL(scheme.authorizationUrl);
      url.searchParams.set('response_type', 'code');
      if (raw.clientId) url.searchParams.set('client_id', String(raw.clientId));
      const scopes = raw.scopes || (scheme.scopes ? Object.keys(scheme.scopes) : undefined);
      if (scopes && scopes.length > 0) url.searchParams.set('scope', scopes.join(' '));
      const stateParam = randomHex(16);
      url.searchParams.set('state', stateParam);
      if (scheme.usePKCE) {
        const verifierBytes = randomBytes(32);
        const verifier = base64url(verifierBytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const digest = await webcrypto.subtle.digest('SHA-256', data);
        const hashArray = new Uint8Array(digest);
        const challenge = base64url(hashArray);
        // Persist verifier/state to config so the exchange can use it later
        config.state = { ...(config.state || {}), pkceVerifier: verifier, state: stateParam };
        await store.setConfig(authKey, config);
        url.searchParams.set('code_challenge', challenge);
        url.searchParams.set('code_challenge_method', 'S256');
      } else {
        // Persist state only
        config.state = { ...(config.state || {}), state: stateParam };
        await store.setConfig(authKey, config);
      }
      if (scheme.redirectUri) {
        url.searchParams.set('redirect_uri', scheme.redirectUri);
      }
      return url.toString();
    }
    if (scheme.type === 'openidconnect') {
      const raw = config.rawAuthCredential as any;
      const endpoints = await discoverOidcEndpoints(scheme.openIdConnectUrl);
      const url = new URL(endpoints.authorization_endpoint);
      url.searchParams.set('response_type', 'code');
      if (raw.clientId) url.searchParams.set('client_id', String(raw.clientId));
      const scopes = raw.scopes || scheme.scopes || ['openid'];
      url.searchParams.set('scope', scopes.join(' '));
      const stateParam = randomHex(16);
      url.searchParams.set('state', stateParam);
      config.state = { ...(config.state || {}), state: stateParam };
      await store.setConfig(authKey, config);
      if (scheme.redirectUri) {
        url.searchParams.set('redirect_uri', scheme.redirectUri);
      }
      return url.toString();
    }
    return undefined;
  }

  async function requestCredential(authConfig: AuthConfig, toolName?: string): Promise<never> {
    const authKey = deriveAuthKey({
      agentName: state.currentAgentName,
      toolName,
      scheme: authConfig.authScheme,
      credential: authConfig.rawAuthCredential,
    });
    await store.setConfig(authKey, authConfig);
    const authorizationUrl = await buildAuthorizationUrl(authConfig, authKey);
    const raw = authConfig.rawAuthCredential as any;
    const scopes = raw.scopes ||
      (authConfig.authScheme.type === 'oauth2' && authConfig.authScheme.scopes ? Object.keys(authConfig.authScheme.scopes) : undefined) ||
      (authConfig.authScheme.type === 'openidconnect' ? (authConfig.authScheme.scopes || ['openid']) : undefined);
    const presentation: AuthRequestPresentation = {
      authKey,
      schemeType: authConfig.authScheme.type,
      authorizationUrl,
      scopes,
    };
    throw new AuthRequiredError(authKey, authConfig, presentation);
  }

  async function getAuthResponse(authConfig: AuthConfig, toolName?: string): Promise<ExchangedAuthCredential | null> {
    const authKey = deriveAuthKey({
      agentName: state.currentAgentName,
      toolName,
      scheme: authConfig.authScheme,
      credential: authConfig.rawAuthCredential,
    });
    // Already exchanged?
    const cached = await store.getTokens(authKey);
    if (cached) {
      // Check expiry (30s skew)
      if (cached.expiresAt && cached.expiresAt < Date.now() + 30_000) {
        if (cached.refreshToken) {
          try {
            const cfg = (await store.getConfig(authKey)) || authConfig;
            const refreshed = await refreshAccessToken(cfg, cached.refreshToken);
            await store.setTokens(authKey, refreshed);
            return refreshed;
          } catch {
            // drop through to try using the existing access token if still valid
          }
        }
      } else {
        return cached;
      }
    }

    // Look for a submitted auth response (callback URL)
    const response = await store.getAuthResponse(authKey);
    if (!response) return null;
    // Load config and perform exchange
    const cfg = (await store.getConfig(authKey)) || authConfig;
    const exchanged = await exchangeAuthorizationCode(cfg, response.authResponseUri, response.redirectUri);
    await store.setTokens(authKey, exchanged);
    // Clear one-time response
    await store.clearAuthResponse(authKey);
    return exchanged;
  }

  async function applyAuth<T extends { url?: string; headers?: Record<string, string>; query?: URLSearchParams }>(
    req: T,
    authConfig: AuthConfig,
    authKey?: string,
    toolName?: string
  ): Promise<T> {
    const scheme = authConfig.authScheme;
    const headers = { ...(req.headers || {}) } as Record<string, string>;
    if (scheme.type === 'apiKey') {
      const raw = authConfig.rawAuthCredential as any;
      const apiKey = raw.value;
      if (scheme.in === 'header') {
        headers[scheme.name] = apiKey;
        return { ...req, headers };
      }
      if (scheme.in === 'query') {
        const u = req.url ? new URL(req.url) : new URL('http://localhost/');
        u.searchParams.set(scheme.name, apiKey);
        return { ...req, url: req.url ? u.toString() : undefined, headers };
      }
      if (scheme.in === 'cookie') {
        const existing = headers['Cookie'] || headers['cookie'] || '';
        const cookieStr = `${scheme.name}=${encodeURIComponent(apiKey)}`;
        headers['Cookie'] = existing ? `${existing}; ${cookieStr}` : cookieStr;
        return { ...req, headers };
      }
    } else if (scheme.type === 'http') {
      const raw = authConfig.rawAuthCredential as any;
      const token = raw.bearer || authConfig.exchangedAuthCredential?.accessToken;
      if (!token) throw new Error('No bearer token found');
      headers['Authorization'] = `Bearer ${token}`;
      return { ...req, headers };
    } else if (scheme.type === 'oauth2' || scheme.type === 'openidconnect') {
      const k = authKey || deriveAuthKey({
        agentName: state.currentAgentName,
        toolName,
        scheme: authConfig.authScheme,
        credential: authConfig.rawAuthCredential,
      });
      let tok = await store.getTokens(k);
      if (!tok) {
        tok = await getAuthResponse(authConfig);
      }
      if (!tok) throw new Error('No OAuth2/OIDC tokens available');
      if (tok.expiresAt && tok.expiresAt < Date.now() + 30_000 && tok.refreshToken) {
        const cfg = (await store.getConfig(k)) || authConfig;
        try {
          tok = await refreshAccessToken(cfg, tok.refreshToken);
          await store.setTokens(k, tok);
        } catch { /* use existing token if still acceptable */ }
      }
      headers['Authorization'] = `Bearer ${tok.accessToken}`;
      return { ...req, headers };
    }
    return { ...req, headers };
  }

  return {
    getCached,
    setCached,
    clearCached,
    getAuthResponse,
    requestCredential,
    applyAuth,
    getTokensFor: async (cfg, toolName) => {
      const k = deriveAuthKey({ agentName: state.currentAgentName, toolName, scheme: cfg.authScheme, credential: cfg.rawAuthCredential });
      return await store.getTokens(k);
    },
    setTokensFor: async (cfg, tokens, toolName) => {
      const k = deriveAuthKey({ agentName: state.currentAgentName, toolName, scheme: cfg.authScheme, credential: cfg.rawAuthCredential });
      await store.setTokens(k, tokens);
    },
    clearTokensFor: async (cfg, toolName) => {
      const k = deriveAuthKey({ agentName: state.currentAgentName, toolName, scheme: cfg.authScheme, credential: cfg.rawAuthCredential });
      await store.clearTokens(k);
    },
  };
}
