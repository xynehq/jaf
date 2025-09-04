import 'dotenv/config';
import {
  runServer,
  ConsoleTraceCollector,
  makeLiteLLMProvider,
  Agent,
  agentAsTool,
  createMemoryProviderFromEnv,
} from '@xynehq/jaf';

type AppContext = {
  userId: string;
  permissions: string[];
};

// Sub-agent that summarizes input text
const summarizerAgent: Agent<AppContext, string> = {
  name: 'Summarizer',
  instructions: () =>
    [
      'You are a precise summarization assistant.',
      'Summarize the supplied text concisely in 2-3 sentences.',
      'Do not add commentary. Output only the summary.',
    ].join(' '),
  // No outputCodec: we want free-form text output
  modelConfig: {
    name: process.env.LITELLM_MODEL || 'gpt-4o-mini',
    temperature: 0.2,
  },
};

// Wrap as a tool consumable by other agents
const summarizeTool = agentAsTool<AppContext, string>(summarizerAgent, {
  toolName: 'summarize_text',
  toolDescription: 'Generate a concise summary of the supplied text.',
  // Keep a conservative turn cap for the child run
  maxTurns: 4,
});

// Parent agent that can decide to use the summarizer tool
const mainAgent: Agent<AppContext, string> = {
  name: 'MainAgent',
  instructions: () =>
    [
      'You are a research assistant. You can use tools to help you.',
      'When asked to summarize or condense text, call the summarize_text tool with the full text.',
      'Otherwise, respond directly.',
    ].join(' '),
  tools: [summarizeTool],
  modelConfig: {
    name: process.env.LITELLM_MODEL || 'gpt-4o-mini',
    temperature: 0.3,
  },
};

async function startServer() {
  console.log('🚀 Starting JAF Agents-as-Tools Server Demo...\n');

  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000';
  const litellmApiKey = process.env.LITELLM_API_KEY;

  console.log(`📡 LiteLLM URL: ${litellmUrl}`);
  console.log(`🔑 API Key: ${litellmApiKey ? 'Set' : 'Not set'}`);
  console.log(`⚠️  Note: Chat endpoints will fail without a running LiteLLM server\n`);

  const modelProvider = makeLiteLLMProvider<AppContext>(litellmUrl, litellmApiKey);
  const traceCollector = new ConsoleTraceCollector();

  // Memory provider from env (defaults to in-memory)
  const memoryProvider = await createMemoryProviderFromEnv();

  const server = await runServer<AppContext>(
    [mainAgent],
    {
      modelProvider,
      maxTurns: 8,
      modelOverride: process.env.LITELLM_MODEL || 'gpt-4o-mini',
      onEvent: traceCollector.collect.bind(traceCollector),
      memory: {
        provider: memoryProvider,
        autoStore: true,
        maxMessages: 100,
      },
    },
    {
      port: parseInt(process.env.PORT || '3000'),
      host: '127.0.0.1',
      cors: false,
      defaultMemoryProvider: memoryProvider,
    }
  );

  console.log('\n✅ Server started! Try these requests:\n');
  console.log('1) Simple chat with MainAgent (will call summarize_text tool):');
  console.log('   curl -X POST http://localhost:3000/agents/MainAgent/chat \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"messages":[{"role":"user","content":"Summarize: JAF is a framework for agents with immutable state and strong tooling"}],"conversationId":"agent-tool-demo-1","context":{"userId":"demo","permissions":["user"]}}\'');
  console.log('');
  console.log('2) Use /chat with explicit agentName:');
  console.log('   curl -X POST http://localhost:3000/chat \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"messages":[{"role":"user","content":"Please summarize this: Agents can be composed as tools."}],"agentName":"MainAgent","conversationId":"agent-tool-demo-2","context":{"userId":"demo","permissions":["user"]}}\'');

  const gracefulShutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}, shutting down...`);
    await server.stop();
    console.log('✅ Shutdown complete');
    process.exit(0);
  };
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  });
}
