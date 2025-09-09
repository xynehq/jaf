import 'dotenv/config';
import { z } from 'zod';
import {
  runStream,
  Agent,
  Tool,
  Message,
  RunState,
  RunConfig,
  generateRunId,
  generateTraceId,
  makeLiteLLMProvider
} from '@xynehq/jaf';

type DemoCtx = { userId: string };

// Tools reused with a minimal agent
const greetTool: Tool<{ name: string }, DemoCtx> = {
  schema: {
    name: 'greet',
    description: 'Greet the user by name',
    parameters: z.object({ name: z.string() })
  },
  execute: async (args) => `Hello ${args.name}!`,
};

const timeTool: Tool<Record<string, never>, DemoCtx> = {
  schema: {
    name: 'get_current_time',
    description: 'Get the current server time',
    parameters: z.object({})
  },
  execute: async () => JSON.stringify({ now: new Date().toISOString() }),
};

const agent: Agent<DemoCtx, string> = {
  name: 'StreamerPlain',
  instructions: () => [
    'You are StreamerBot. You can greet users and tell the current time.',
    '- If user tells their name, use the greet tool.',
    '- If user asks for time, use the get_current_time tool.',
    '- If asked, give user the list of all the PMs of India with their description.',
    '- Otherwise, reply helpfully.'
  ].join('\n'),
  tools: [greetTool, timeTool],
};

async function main() {
  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000';
  const litellmApiKey = process.env.LITELLM_API_KEY;
  const model = process.env.LITELLM_MODEL || 'gpt-3.5-turbo';

  const userMessage = process.argv.slice(2).join(' ') || 'Hi, I am Alice. What time is it?';

  console.log('📡 Using LiteLLM:', litellmUrl);
  console.log('💬 Model:', model);
  console.log('📝 Prompt:', userMessage);

  const modelProvider = makeLiteLLMProvider(litellmUrl, litellmApiKey) as any;

  const messages: Message[] = [
    { role: 'user', content: userMessage }
  ];

  const runId = generateRunId();
  const traceId = generateTraceId();

  const initialState: RunState<DemoCtx> = {
    runId,
    traceId,
    messages,
    currentAgentName: agent.name,
    context: { userId: 'demo' },
    turnCount: 0,
  };

  const agentRegistry = new Map<string, Agent<DemoCtx, any>>([[agent.name, agent]]);

  const runConfig: RunConfig<DemoCtx> = {
    agentRegistry,
    modelProvider,
    modelOverride: model,
    maxTurns: 5
    // Intentionally no onEvent to avoid extra logs; we consume runStream directly
  } as any;

  console.log('\n🔴 Plain streaming below:\n');

  // Print only the delta part as content grows in assistant_message events
  let lastLen = 0;

  for await (const event of runStream<DemoCtx, string>(initialState, runConfig)) {
    if (event.type === 'assistant_message') {
      const content = event.data.message.content || '';
      if (content.length > lastLen) {
        const delta = content.slice(lastLen);
        process.stdout.write(delta);
        lastLen = content.length;
      }
    } else if (event.type === 'run_end') {
      // Ensure newline after completion
      process.stdout.write('\n');
    }
  }
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}