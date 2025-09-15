import 'dotenv/config';
import { z } from 'zod';
import {
  Agent,
  runServer,
  makeLiteLLMProvider,
  createInMemoryProvider,
  makeHttpTool,
} from '@xynehq/jaf';

type Ctx = { userId: string };

const bearer = process.env.BEARER_TOKEN || '';

const getUserInfoTool = makeHttpTool<{ endpoint?: string }, Ctx>({
  name: 'get_user_info',
  description: 'Fetch user info with an existing Bearer token',
  parameters: z.object({ endpoint: z.string().url().optional() }),
  auth: {
    authScheme: { type: 'http', scheme: 'bearer' },
    rawAuthCredential: { type: 'HTTP', bearer },
  },
  request: (args) => ({
    url: args.endpoint || process.env.PROTECTED_API_URL!,
    method: 'GET',
  }),
  onResponse: async (res) => JSON.stringify({ status: res.status, body: await res.text() })
});

const agent: Agent<Ctx, string> = {
  name: 'AuthDemoAgentBearer',
  instructions: () => 'Use get_user_info to fetch user info with Bearer token.',
  tools: [getUserInfoTool],
  modelConfig: { name: process.env.LITELLM_MODEL || 'gpt-4o-mini' }
};

async function main() {
  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000';
  const litellmApiKey = process.env.LITELLM_API_KEY || 'anything';
  const modelProvider = makeLiteLLMProvider<Ctx>(litellmUrl, litellmApiKey) as any;

  const server = await runServer<Ctx>([agent], { modelProvider, maxTurns: 3 }, {
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
  const out = await initial.json();
  console.log('\nResponse:', JSON.stringify(out, null, 2));
  await server.stop();
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();

