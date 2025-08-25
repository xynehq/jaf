import 'dotenv/config';
import { z } from 'zod';
import {
  runServer,
  Tool,
  Agent,
  makeLiteLLMProvider,
  ConsoleTraceCollector,
} from '@xynehq/jaf';

type DemoCtx = { userId: string };

// Simple tools to make tool events visible in the stream
const greetTool: Tool<{ name: string }, DemoCtx> = {
  schema: {
    name: 'greet',
    description: 'Greet the user by name',
    parameters: z.object({ name: z.string() })
  },
  execute: async (args) => {
    return `Hello ${args.name}!`;
  }
};

const timeTool: Tool<Record<string, never>, DemoCtx> = {
  schema: {
    name: 'get_current_time',
    description: 'Get the current server time',
    parameters: z.object({})
  },
  execute: async (_args: Record<string, never>) => {
    return JSON.stringify({ now: new Date().toISOString() });
  }
};

const streamerAgent: Agent<DemoCtx, string> = {
  name: 'StreamerBot',
  instructions: () => [
    'You are StreamerBot. You can greet users and tell the current time.',
    '- If user tells their name, use the greet tool.',
    '- If user asks for time, use the get_current_time tool.',
    '- Otherwise, reply helpfully.'
  ].join('\n'),
  tools: [greetTool, timeTool],
};

async function main() {
  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000';
  const litellmApiKey = process.env.LITELLM_API_KEY;
  const model = process.env.LITELLM_MODEL || 'gpt-3.5-turbo';

  console.log('📡 LiteLLM URL:', litellmUrl);
  console.log('🔑 API Key:', litellmApiKey ? 'Set' : 'Not set');
  console.log('💬 Model:', model);
  console.log('⚠️  Note: This demo requires a running LiteLLM proxy');

  const modelProvider = makeLiteLLMProvider(litellmUrl, litellmApiKey) as any;
  const tracer = new ConsoleTraceCollector();

  await runServer(
    [streamerAgent],
    {
      modelProvider,
      modelOverride: model,
      maxTurns: 5,
      onEvent: tracer.collect.bind(tracer)
    },
    {
      port: parseInt(process.env.PORT || '3004', 10),
      host: '127.0.0.1',
      cors: false
    }
  );

  console.log('\n✅ Streaming server is ready');
  console.log('Try streaming with curl:');
  console.log('');
  const sseCmd = [
    'curl -N -H "Content-Type: application/json"',
    '  -X POST http://localhost:3004/chat',
    `  -d '\'${JSON.stringify({
      agentName: 'StreamerBot',
      stream: true,
      messages: [{ role: 'user', content: 'Hi, I am Alice. What time is it?' }],
      context: { userId: 'demo' }
    })}\''`
  ].join('\n');
  console.log(sseCmd);
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}

