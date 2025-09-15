import 'dotenv/config';
import { z } from 'zod';
import http from 'http';
import open from 'open';
import {
  Agent,
  runServer,
  makeLiteLLMProvider,
  createInMemoryProvider,
  makeHttpTool,
} from '@xynehq/jaf';

type Ctx = { userId: string };

function buildAuthConfig() {
  const oauthAuthUrl = process.env.OAUTH_AUTHORIZATION_URL;
  const oauthTokenUrl = process.env.OAUTH_TOKEN_URL;
  if (!oauthAuthUrl || !oauthTokenUrl) throw new Error('Set OAUTH_AUTHORIZATION_URL and OAUTH_TOKEN_URL');
  const scopes = (process.env.OAUTH_SCOPES || 'openid profile email').split(/\s+/).filter(Boolean);
  return {
    authScheme: {
      type: 'oauth2' as const,
      authorizationUrl: oauthAuthUrl,
      tokenUrl: oauthTokenUrl,
      scopes: Object.fromEntries(scopes.map(s => [s, s])),
      usePKCE: true,
      redirectUri: process.env.AUTH_REDIRECT_URI,
    },
    rawAuthCredential: {
      type: 'OAUTH2' as const,
      clientId: process.env.OAUTH_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_CLIENT_SECRET,
      scopes,
    },
  };
}

const getUserInfoTool = makeHttpTool<{ endpoint?: string }, Ctx>({
  name: 'get_user_info',
  description: 'Fetch the authenticated user profile (OAuth2)',
  parameters: z.object({ endpoint: z.string().url().optional() }),
  auth: buildAuthConfig(),
  request: (args) => ({ url: args.endpoint || process.env.PROTECTED_API_URL!, method: 'GET' }),
  onResponse: async (res) => JSON.stringify({ status: res.status, body: await res.text() })
});

const agent: Agent<Ctx, string> = {
  name: 'AuthDemoAgentOAuth2',
  instructions: () => 'Use get_user_info to fetch user info with OAuth2.',
  tools: [getUserInfoTool],
  modelConfig: { name: process.env.LITELLM_MODEL || 'gpt-4o-mini' }
};

async function waitForCallbackServer(redirectUrl: string): Promise<string> {
  const u = new URL(redirectUrl);
  const port = Number(u.port) || 80;
  const host = u.hostname;
  return await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        if (req.method === 'GET' && req.url) {
          const full = `${u.protocol}//${host}:${port}${req.url}`;
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/plain');
          res.end('✅ Auth received. You can close this tab.');
          resolve(full);
          server.close();
        } else {
          res.statusCode = 404;
          res.end();
        }
      } catch (e) { reject(e); }
    });
    server.on('error', reject);
    server.listen(port, host);
  });
}

async function main() {
  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000';
  const litellmApiKey = process.env.LITELLM_API_KEY || 'anything';
  const modelProvider = makeLiteLLMProvider<Ctx>(litellmUrl, litellmApiKey) as any;

  const server = await runServer<Ctx>([agent], { modelProvider, maxTurns: 5 }, {
    port: 3333,
    host: '127.0.0.1',
    defaultMemoryProvider: createInMemoryProvider()
  });

  const baseUrl = 'http://127.0.0.1:3333';
  const initial = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName: agent.name,
      messages: [{ role: 'user', content: 'Fetch my user info now.' }],
      stream: false
    })
  });
  const initJson = await initial.json();

  if (initJson.success && initJson.data?.outcome?.status === 'interrupted') {
    const authIntr = initJson.data.outcome.interruptions.find((i: any) => i.type === 'tool_auth');
    const toolCallId: string = authIntr.toolCall.id;
    const authUrl: string | undefined = authIntr.auth.authorizationUrl;
    const redirectUri = process.env.AUTH_REDIRECT_URI || 'http://127.0.0.1:5173/callback';

    if (authUrl) {
      try { await open(authUrl, { wait: false }); } catch { /* ignore */ }
    }
    const callbackUrl = await waitForCallbackServer(redirectUri);

    const submit = await fetch(`${baseUrl}/auth/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: initJson.data.conversationId,
        sessionId: initJson.data.runId,
        toolCallId,
        authResponseUri: callbackUrl,
        redirectUri
      })
    });
    if (!submit.ok) {
      console.error('Auth submit failed:', await submit.text());
      process.exit(1);
    }

    const resume = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: agent.name, messages: [], conversationId: initJson.data.conversationId, stream: false })
    });
    const resumeJson = await resume.json();
    console.log('\nOAuth2 result:', JSON.stringify(resumeJson, null, 2));
  } else {
    console.log('\nResponse:', JSON.stringify(initJson, null, 2));
  }

  await server.stop();
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
