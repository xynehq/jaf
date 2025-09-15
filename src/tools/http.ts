import { z } from 'zod';
import type { Tool } from '../core/types';
import type { AuthConfig, AuthScheme, AuthCredential } from '../auth/types';
import { getToolAuth } from '../auth/runtime';
import { refreshAccessToken } from '../auth/oauth2';

export type HttpRequest<A, Ctx> = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
};

export type HttpRequestBuilder<A, Ctx> = (
  args: A,
  context: Readonly<Ctx>
) => Promise<HttpRequest<A, Ctx>> | HttpRequest<A, Ctx>;

export type HttpResponseHandler = (res: Response) => Promise<string> | string;

type AuthInput =
  | AuthConfig
  | { authScheme: AuthScheme; rawAuthCredential: AuthCredential };

function normalizeAuthConfig(input: AuthInput): AuthConfig {
  if ((input as AuthConfig).authScheme) return input as AuthConfig;
  const { authScheme, rawAuthCredential } = input as { authScheme: AuthScheme; rawAuthCredential: AuthCredential };
  return { authScheme, rawAuthCredential } as AuthConfig;
}

export function makeHttpTool<A, Ctx>(opts: {
  name: string;
  description: string;
  parameters: z.ZodType<A>;
  request: HttpRequestBuilder<A, Ctx>;
  onResponse?: HttpResponseHandler;
  auth?: AuthInput; // optional auth
}): Tool<A, Ctx> {
  const hasAuth = !!opts.auth;
  const authConfigBase = opts.auth ? normalizeAuthConfig(opts.auth) : undefined;

  return {
    schema: {
      name: opts.name,
      description: opts.description,
      parameters: opts.parameters,
    },
    execute: async (args: A, context: Readonly<Ctx>) => {
      const req = await opts.request(args, context);

      let finalUrl = req.url;
      let finalHeaders: Record<string, string> = { ...(req.headers || {}) };
      let finalMethod = req.method || 'GET';
      let finalBody = req.body;

      if (hasAuth && authConfigBase) {
        const auth = getToolAuth(context);
        const authConfig: AuthConfig = { ...authConfigBase, state: { ...(authConfigBase.state || {}) } };

        // Try existing/exchanged tokens; if not present, request credential (pause)
        const tokens = await auth.getAuthResponse(authConfig, opts.name);
        if (!tokens) {
          await auth.requestCredential(authConfig, opts.name);
        }

        const authed = await auth.applyAuth({ url: finalUrl, headers: finalHeaders, method: finalMethod, body: finalBody }, authConfig, undefined, opts.name);
        finalUrl = authed.url || finalUrl;
        finalHeaders = authed.headers || finalHeaders;
        finalMethod = authed.method || finalMethod;
        finalBody = (authed as any).body ?? finalBody;
      }

      let res = await fetch(finalUrl, { method: finalMethod, headers: finalHeaders, body: finalBody });
      // Optional 401 refresh flow for OAuth2/OIDC
      if (hasAuth && authConfigBase && res.status === 401) {
        try {
          const auth = getToolAuth(context);
          const authConfig: AuthConfig = { ...authConfigBase };
          const existing = await auth.getTokensFor?.(authConfig, opts.name);
          if (existing?.refreshToken) {
            const refreshed = await refreshAccessToken(authConfig, existing.refreshToken);
            await auth.setTokensFor?.(authConfig, refreshed, opts.name);
            // reapply auth header with new token
            const authed = await auth.applyAuth({ url: finalUrl, headers: finalHeaders, method: finalMethod, body: finalBody }, authConfig, undefined, opts.name);
            res = await fetch(authed.url || finalUrl, { method: authed.method || finalMethod, headers: authed.headers || finalHeaders, body: (authed as any).body ?? finalBody });
          } else {
            // If no refresh token, clear tokens to force re-auth next call
            await auth.clearTokensFor?.(authConfig, opts.name);
          }
        } catch { /* ignore and fall through with original response */ }
      }
      if (!opts.onResponse) {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          return JSON.stringify(json);
        } catch {
          return text;
        }
      }
      return await opts.onResponse(res);
    },
  };
}

// Backward-compatible alias for previous name
export function makeAuthenticatedHttpTool<A, Ctx>(opts: {
  name: string;
  description: string;
  parameters: z.ZodType<A>;
  auth: AuthInput;
  request: HttpRequestBuilder<A, Ctx>;
  onResponse?: HttpResponseHandler;
}): Tool<A, Ctx> {
  return makeHttpTool<A, Ctx>({
    name: opts.name,
    description: opts.description,
    parameters: opts.parameters,
    request: opts.request,
    onResponse: opts.onResponse,
    auth: opts.auth,
  });
}
