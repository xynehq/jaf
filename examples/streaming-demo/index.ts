/**
 * JAF Streaming Demo
 * 
 * This example demonstrates how to use the streaming output system
 * to push agent events to external systems (like Redis).
 * 
 * Run: pnpm exec ts-node --esm index.ts
 */

import { z } from 'zod';
import {
  run,
  Agent,
  RunConfig,
  Tool,
  createTraceId,
  createRunId,
  Message,
  Streaming
} from '../../src/index.js';

// ========== Define Tools with Zod Schemas ==========
const SearchArgsSchema = z.object({
  query: z.string().describe('Search query')
});

type SearchArgs = z.infer<typeof SearchArgsSchema>;

const searchTool: Tool<SearchArgs, { sessionId: string }> = {
  schema: {
    name: 'search',
    description: 'Search for information',
    parameters: SearchArgsSchema
  },
  execute: async (args) => {
    console.log(`[TOOL] Searching for: ${args.query}`);
    // Simulate search
    return `Results for "${args.query}": Found 3 relevant documents about AI agents.`;
  }
};

const CalculatorArgsSchema = z.object({
  expression: z.string().describe('Math expression to evaluate')
});

type CalculatorArgs = z.infer<typeof CalculatorArgsSchema>;

const calculatorTool: Tool<CalculatorArgs, { sessionId: string }> = {
  schema: {
    name: 'calculator',
    description: 'Perform math calculations',
    parameters: CalculatorArgsSchema
  },
  execute: async (args) => {
    console.log(`[TOOL] Calculating: ${args.expression}`);
    try {
      // Simple safe math eval
      const result = Function(`"use strict"; return (${args.expression.replace(/[^0-9+\-*/().]/g, '')})`)();
      return `Result: ${result}`;
    } catch {
      return `Error: Could not calculate "${args.expression}"`;
    }
  }
};

// ========== Define the Agent ==========
const myAgent: Agent<{ sessionId: string }, string> = {
  name: 'demo-agent',
  instructions: (state) => `
You are a helpful assistant that can search for information and do calculations.
Use the search tool to find information and the calculator tool for math.
Session ID: ${state.context.sessionId}
`,
  tools: [searchTool, calculatorTool],
  modelConfig: {
    name: 'gpt-4o-mini', // Use a fast model for demo
    temperature: 0.7
  }
};

// ========== Mock Model Provider (for testing without API keys) ==========
const mockModelProvider = {
  name: 'mock-provider',
  
  getCompletion: async (messages: Message[], options: any) => {
    console.log('\n[MODEL] Received messages:', messages.length);
    
    // Check if the last message mentions search
    const lastMessage = messages[messages.length - 1];
    const content = typeof lastMessage.content === 'string' 
      ? lastMessage.content 
      : '';
    
    if (content.toLowerCase().includes('search') || content.toLowerCase().includes('find')) {
      return {
        content: null,
        toolCalls: [{
          id: 'call_1',
          name: 'search',
          arguments: { query: 'AI agents' }
        }]
      };
    }
    
    if (content.toLowerCase().includes('calculate') || content.toLowerCase().includes('math')) {
      return {
        content: null,
        toolCalls: [{
          id: 'call_2',
          name: 'calculator',
          arguments: { expression: '2 + 2' }
        }]
      };
    }
    
    // Default response
    return {
      content: 'Hello! I can help you search for information or do calculations. What would you like to do?',
      toolCalls: undefined
    };
  },
  
  getCompletionStream: async function* () {
    yield { content: 'Streaming not implemented in mock', toolCalls: undefined };
  }
};

// ========== Main Demo Function ==========
async function main() {
  console.log('='.repeat(60));
  console.log('JAF Streaming Demo');
  console.log('='.repeat(60));
  
  // Create an in-memory stream provider for testing
  const streamProvider = Streaming.createInMemoryStreamProvider({
    maxEventsPerSession: 100
  });
  
  console.log('\n✅ Created InMemory stream provider');
  
  // Create session ID upfront (in production, get this from your request context)
  const sessionId = `session-${Date.now()}`;
  
  // Create the event handler with streaming
  // Using static sessionId since JAF doesn't pass context to onEvent
  const streamHandler = Streaming.withStreamOutput(streamProvider, {
    // Use static session ID (captured in closure)
    sessionId: sessionId,
    
    // Only stream tool and message events
    eventFilter: Streaming.EventFilters.externalStreamEvents,
    
    // Callbacks for monitoring
    onPushSuccess: (event, sid) => {
      console.log(`  📤 Pushed: ${event.type} → session: ${sid}`);
    },
    onPushError: (error, event, sid) => {
      console.error(`  ❌ Failed: ${event.type} - ${error.message}`);
    }
  });
  
  // Compose with console logging
  const composedHandler = Streaming.composeEventHandlers([
    streamHandler,
    (event) => {
      console.log(`  📋 Event: ${event.type}`);
    }
  ]);
  
  console.log('✅ Created stream handler with Python-compatible mapping');
  console.log('   tool_call_start → tool_input');
  console.log('   tool_call_end → tool_output');
  console.log('   assistant_message → agent_response\n');
  
  // Create agent registry
  const agentRegistry = new Map<string, Agent<{ sessionId: string }, any>>();
  agentRegistry.set('demo-agent', myAgent);
  
  // Create run config
  const config: RunConfig<{ sessionId: string }> = {
    agentRegistry,
    modelProvider: mockModelProvider as any,
    maxTurns: 5,
    onEvent: composedHandler
  };
  
  // Create initial state
  const initialState = {
    runId: createRunId(`run-${Date.now()}`),
    traceId: createTraceId(`trace-${Date.now()}`),
    messages: [
      { role: 'user' as const, content: 'Please search for information about AI agents' }
    ],
    currentAgentName: 'demo-agent',
    context: { sessionId },
    turnCount: 0
  };
  
  console.log(`Running agent with session: ${sessionId}\n`);
  console.log('-'.repeat(60));
  
  // Run the agent
  try {
    const result = await run(initialState, config);
    
    console.log('-'.repeat(60));
    console.log('\n📊 Run Result:');
    console.log(`   Status: ${result.outcome}`);
    console.log(`   Turns: ${result.finalState.turnCount}`);
    console.log(`   Messages: ${result.finalState.messages.length}`);
    
    // Get streamed events
    const streamedEvents = streamProvider.getEvents(sessionId);
    console.log(`\n📦 Streamed Events (${streamedEvents.length}):`);
    
    streamedEvents.forEach((event, i) => {
      console.log(`   ${i + 1}. ${event.eventType} @ ${event.timestamp}`);
      console.log(`      Data: ${JSON.stringify(event.data).slice(0, 80)}...`);
    });
    
  } catch (error) {
    console.error('Error running agent:', error);
  }
  
  // Health check
  const health = await streamProvider.healthCheck();
  console.log(`\n🏥 Provider Health: ${health.healthy ? '✅ Healthy' : '❌ Unhealthy'}`);
  
  // Cleanup
  await streamProvider.close();
  console.log('✅ Provider closed\n');
  
  console.log('='.repeat(60));
  console.log('Demo Complete!');
  console.log('='.repeat(60));
  
  // Show what would happen with Redis
  console.log(`
📝 To use Redis in production:

  import { Streaming } from '@xynehq/jaf';
  
  // Install: npm install ioredis
  const streamProvider = await Streaming.createRedisStreamProvider({
    url: 'redis://localhost:6379',
    streamPrefix: 'agent_events:',
    retry: { maxRetries: 3, retryDelayMs: 50 }
  });
  
  // This pushes events to Redis lists like:
  //   RPUSH agent_events:session-123 '{"event_type":"tool_input",...}'
  
`);
}

// Run the demo
main().catch(console.error);
