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
  makeLiteLLMProvider,
  ConsoleTraceCollector,
} from '@xynehq/jaf';

type DemoCtx = { userId: string };

// Tools reused from server example
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

  const userMessage = process.argv.slice(2).join(' ') || 'Hi, I am Alice. What time is it?';

  console.log('📡 Using LiteLLM:', litellmUrl);
  console.log('💬 Model:', model);
  console.log('📝 Prompt:', userMessage);

  const modelProvider = makeLiteLLMProvider(litellmUrl, litellmApiKey) as any;
  const tracer = new ConsoleTraceCollector();

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
    maxTurns: 5,
    onEvent: tracer.collect.bind(tracer),
  };

  console.log('\n🌊 Streaming events from engine (no server)\n');

  try {
    for await (const event of runStream<DemoCtx, string>(initialState, runConfig)) {
      const { type } = event;
      // Compact console view of events
      switch (type) {
        case 'run_start':
          console.log('event: run_start', { runId: event.data.runId, traceId: event.data.traceId });
          break;
        case 'llm_call_start':
          console.log('event: llm_call_start', { agent: event.data.agentName, model: event.data.model });
          break;
        case 'llm_call_end':
          console.log('event: llm_call_end');
          break;
        case 'assistant_message':
          console.log('event: assistant_message', { hasToolCalls: !!event.data.message.tool_calls, contentPreview: (event.data.message.content || '').slice(0, 80) });
          break;
        case 'tool_requests':
          console.log('event: tool_requests', event.data.toolCalls.map(t => ({ id: t.id, name: t.name })));
          break;
        case 'tool_call_start':
          console.log('event: tool_call_start', { tool: event.data.toolName });
          break;
        case 'tool_call_end':
          console.log('event: tool_call_end', { tool: event.data.toolName, status: event.data.status || 'success' });
          break;
        case 'tool_results_to_llm':
          console.log('event: tool_results_to_llm', { count: event.data.results.length });
          break;
        case 'final_output':
          console.log('event: final_output', { outputPreview: String(event.data.output).slice(0, 120) });
          break;
        case 'handoff':
          console.log('event: handoff', event.data);
          break;
        case 'run_end':
          console.log('event: run_end', { status: event.data.outcome.status });
          break;
        default:
          console.log('event:', type);
      }
    }
  } catch (err) {
    console.error('❌ Streaming failed:', err);
    process.exit(1);
  }

  console.log('\n✅ Done');
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}

