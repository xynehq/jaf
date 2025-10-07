import 'dotenv/config';
import { randomUUID } from 'crypto';
import {
  run,
  createRunId,
  createTraceId,
  type RunConfig,
  type Agent,
  makeLiteLLMProvider,
  createSimpleEventHandler,
} from '@xynehq/jaf';
import { mathTool } from '@xynehq/jaf/tools';

type Ctx = Record<string, never>;

async function demoSimpleEventHandler() {
  console.log('=== Simple Event Handler Demo ===\n');
  console.log('This demo shows how to use createSimpleEventHandler() for cleaner event handling.\n');

  const agent: Agent<Ctx, string> = {
    name: 'EventDemoAgent',
    instructions: () => 'You can use the math tool to help users with calculations.',
    tools: [mathTool],
    modelConfig: { name: process.env.LITELLM_MODEL || 'gpt-4o-mini' },
  };

  const config: RunConfig<Ctx> = {
    agentRegistry: new Map([[agent.name, agent]]),
    modelProvider: makeLiteLLMProvider(
      process.env.LITELLM_URL || "http://localhost:4000",
      process.env.LITELLM_API_KEY
    ),
    maxTurns: 6,

    // ✨ Use the simplified event handler API
    onEvent: createSimpleEventHandler({
      onRunStart: (runId, traceId) => {
        console.log(`🚀 Run started: ${runId.slice(0, 8)}...`);
      },

      onAssistantMessage: (content, thinking) => {
        console.log('\n💬 Assistant:', content);
        if (thinking) {
          console.log('💭 Thinking:', thinking);
        }
      },

      onToolCalls: (calls) => {
        console.log('\n🔧 Tools requested:', calls.map(c => c.name).join(', '));
      },

      onToolResult: (toolName, result, error) => {
        if (error) {
          console.error(`❌ ${toolName} failed:`, error);
        } else {
          console.log(`✅ ${toolName} completed:`, result.substring(0, 100));
        }
      },

      onTokenUsage: (usage) => {
        console.log(`\n💰 Tokens used: ${usage.total_tokens} (prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens})`);
      },

      onError: (error) => {
        console.error('\n🚨 Error:', error);
      },

      onRunEnd: (outcome) => {
        if (outcome.status === 'completed') {
          console.log('\n✨ Run completed successfully\n');
        } else if (outcome.status === 'error') {
          console.error('\n💥 Run failed:', outcome.error);
        }
      },
    }),
  };

  const state = {
    runId: createRunId(randomUUID()),
    traceId: createTraceId(randomUUID()),
    messages: [{ role: 'user' as const, content: 'What is 144 divided by 12?' }],
    currentAgentName: agent.name,
    context: {} as Ctx,
    turnCount: 0,
  };

  const result = await run<Ctx, string>(state, config);

  console.log('--- Final Result ---');
  console.log('Status:', result.outcome.status);
  if (result.outcome.status === 'completed') {
    console.log('Output:', result.outcome.output);
  }
}

async function main() {
  await demoSimpleEventHandler();
}

if (require.main === module) {
  main().catch(console.error);
}
