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

// Build AuthConfig from environment (supports OAuth2 or OIDC)
function buildAuthConfig() {
  const oidcUrl = process.env.OIDC_DISCOVERY_URL;
  if (oidcUrl) {
    const scopes = (process.env.OIDC_SCOPES || 'openid profile email').split(/\s+/).filter(Boolean);
    return {
      authScheme: {
        type: 'openidconnect' as const,
        openIdConnectUrl: oidcUrl,
        scopes,
        redirectUri: process.env.AUTH_REDIRECT_URI,
      },
      rawAuthCredential: {
        type: 'OPEN_ID_CONNECT' as const,
        clientId: process.env.OIDC_CLIENT_ID || '',
        clientSecret: process.env.OIDC_CLIENT_SECRET,
        scopes,
      },
    };
  }
  throw new Error('Set OIDC_DISCOVERY_URL for OIDC authentication');
}

const getUserInfoTool = makeHttpTool<{ endpoint?: string }, Ctx>({
  name: 'get_user_info',
  description: 'Fetch the authenticated user profile (OIDC userinfo or protected API).',
  parameters: z.object({ endpoint: z.string().url().optional() }),
  auth: buildAuthConfig(),
  request: async (args) => {
    const apiUrl = args.endpoint || process.env.PROTECTED_API_URL || '';
    if (!apiUrl) throw new Error('PROTECTED_API_URL is not set');
    return { url: apiUrl, method: 'GET' };
  },
  onResponse: async (res) => {
    const text = await res.text();
    if (!res.ok) throw new Error(`Protected API error ${res.status}: ${text}`);
    try { return JSON.stringify({ status: 'success', data: JSON.parse(text) }); }
    catch { return JSON.stringify({ status: 'success', data: text }); }
  }
});

const agent: Agent<Ctx, string> = {
  name: 'AuthDemoAgent',
  instructions: () => [
    'You can fetch user info via the get_user_info tool.',
    'If the API requires login, follow the auth flow.',
  ].join('\n'),
  tools: [getUserInfoTool],
  modelConfig: {
    name: process.env.LITELLM_MODEL || 'gpt-4o-mini'
  }
};

async function waitForCallbackServer(redirectUrl: string): Promise<string> {
  const u = new URL(redirectUrl);
  const port = Number(u.port) || 80;
  const host = u.hostname;
  const path = u.pathname;

  console.log(`📡 Listening for auth callback at ${host}:${port}${path}`);

  return await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        if (req.method === 'GET' && req.url) {
          const full = `http://${host}:${port}${req.url}`;
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/plain');
          res.end('✅ Auth received. You can close this tab.');
          resolve(full);
          server.close();
        } else {
          res.statusCode = 404;
          res.end();
        }
      } catch (e) {
        reject(e);
      }
    });
    server.on('error', reject);
    server.listen(port, host);
  });
}

async function main() {
  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000';
  const litellmApiKey = process.env.LITELLM_API_KEY || 'anything';
  const modelProvider = makeLiteLLMProvider<Ctx>(litellmUrl, litellmApiKey) as any;

  const server = await runServer<Ctx>([
    agent
  ], {
    modelProvider,
    maxTurns: 5
  }, {
    port: 3333,
    host: '127.0.0.1',
    defaultMemoryProvider: createInMemoryProvider()
  });

  const baseUrl = 'http://127.0.0.1:3333';

  // Start chat and trigger tool
  const initial = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName: agent.name,
      messages: [{ role: 'user', content: 'Fetch my user info using the get_user_info tool. FETCH IT WITHOUT ASKING ANY QUESTIONS' }],
      stream: false
    })
  });
  const initJson = await initial.json();
  if (!initJson.success) {
    console.error('Chat failed:', initJson.error);
    process.exit(1);
  }

  const convId = initJson.data.conversationId;
  const runId = initJson.data.runId;

  if (initJson.data.outcome.status === 'interrupted') {
    const authIntr = initJson.data.outcome.interruptions.find((i: any) => i.type === 'tool_auth');
    if (!authIntr) {
      console.log('Interrupted for non-auth reason. Exiting.');
      process.exit(0);
    }

    const toolCallId: string = authIntr.toolCall.id;
    const authUrl: string | undefined = authIntr.auth.authorizationUrl;
    const redirectUri = process.env.AUTH_REDIRECT_URI || 'http://127.0.0.1:5173/callback';

    console.log('\n🔐 Authentication required');
    if (authUrl) {
      console.log('Opening your browser for authentication...');
      try {
        await open(authUrl, { wait: false });
      } catch (e) {
        console.warn('Could not auto-open browser. Please open this URL manually:');
        console.log(authUrl);
      }
    } else {
      console.log('(No provider URL emitted; ensure OIDC/OAuth2 env vars are set)');
    }

    const callbackUrl = await waitForCallbackServer(redirectUri);
    console.log('✅ Received callback:', callbackUrl);

    // Submit auth response to JAF server
    const submit = await fetch(`${baseUrl}/auth/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: convId,
        sessionId: runId,
        toolCallId,
        authResponseUri: callbackUrl,
        redirectUri
      })
    });
    if (!submit.ok) {
      const t = await submit.text();
      console.error('Auth submit failed:', t);
      process.exit(1);
    }

    // Resume conversation (empty messages; engine will resume pending tool call)
    const resume = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: agent.name,
        messages: [],
        conversationId: convId,
        stream: false
      })
    });
    const resumeJson = await resume.json();
    if (!resumeJson.success) {
      console.error('Resume failed:', resumeJson.error);
      process.exit(1);
    }
    console.log('\n🤖 Final messages:');
    for (const m of resumeJson.data.messages) {
      console.log('-', m.role, ':', typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
    }
  } else {
    console.log('Completed without auth:', initJson.data);
  }

  await server.stop();
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
