import { z } from 'zod';
import { config } from 'dotenv';
import { run, createRunId, createTraceId, OpenTelemetryTraceCollector, makeLiteLLMProvider, configureProxy } from '@xynehq/jaf';

// Load environment variables
config();

// Set up OpenTelemetry to export to Jaeger
// process.env.TRACE_COLLECTOR_URL = 'http://localhost:4318/v1/traces';
// Set up OpenTelemetry to export to Langfuse via OTLP
// // Langfuse OTLP endpoint is different from the regular API endpoint
process.env.TRACE_COLLECTOR_URL = process.env.LANGFUSE_HOST
  ? `${process.env.LANGFUSE_HOST}/api/public/otel/v1/traces`
  : 'http://localhost:3000/api/public/otel';

// // Set OTLP headers for Langfuse authentication
// // Langfuse expects the public and secret keys in specific headers
process.env.OTEL_EXPORTER_OTLP_HEADERS = `Authorization=Basic ${Buffer.from(
  `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`
).toString('base64')}`;

// ===== PROXY CONFIGURATION =====
// You can configure a proxy in two ways:

// Method 1: Programmatic configuration (recommended for dynamic configs)
// Uncomment to use:
// configureProxy('http://proxy.example.com:8080');
// Or with authentication:
// configureProxy('http://username:password@proxy.example.com:8080');

// Method 2: Environment variables (recommended for production)
// Set before running your application:
// export HTTP_PROXY=http://proxy.example.com:8080
// export HTTPS_PROXY=http://proxy.example.com:8080
// or use ALL_PROXY for both:
// export ALL_PROXY=http://proxy.example.com:8080
// JAF will automatically detect and use the proxy

// Priority: Manual config > HTTP_PROXY > HTTPS_PROXY > ALL_PROXY
// Note: Localhost collectors automatically bypass the proxy

// Enhanced context type with comprehensive user information
type DemoContext = {
  userId: string;
  sessionId: string;
  query: string;
  token_response: {
    email: string;
    username: string;
  };
  conversationId: string;
};

// Sample tool for testing
const weatherTool = {
  schema: {
    name: 'get_weather',
    description: 'Get current weather for a location',
    parameters: z.object({
      location: z.string().describe('The city and state/country'),
      units: z.enum(['celsius', 'fahrenheit']).optional().default('celsius')
    })
  },
  execute: async (args: { location: string; units?: string }) => {
    console.log(`[TOOL] Getting weather for ${args.location} in ${args.units}`);
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const temp = args.units === 'fahrenheit' ? '72°F' : '22°C';
    return `The current weather in ${args.location} is sunny with a temperature of ${temp}.`;
  }
};

// Sample calculation tool
const calculatorTool = {
  schema: {
    name: 'calculate',
    description: 'Perform basic mathematical calculations',
    parameters: z.object({
      expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 2", "10 * 5")')
    })
  },
  execute: async (args: { expression: string }) => {
    console.log(`[TOOL] Calculating: ${args.expression}`);
    try {
      // Simple evaluation (in real app, use a proper math parser)
      const result = eval(args.expression.replace(/[^0-9+\-*/().\s]/g, ''));
      return `The result of ${args.expression} is ${result}`;
    } catch (error) {
      return `Error calculating ${args.expression}: Invalid expression`;
    }
  }
};

// Analytics agent with comprehensive instructions
const analyticsAgent = {
  name: 'jaf_otel_demo_agent',
  instructions: (state: any) => `You are an advanced analytics assistant with access to weather and calculation tools.

Current context:
- User: ${state.context.userId}
- Session: ${state.context.sessionId}
- Query: ${state.context.query}

You can:
1. Get weather information for any location using the get_weather tool
2. Perform mathematical calculations using the calculate tool
3. Provide detailed analysis and insights

Always be helpful and provide comprehensive responses. Use tools when appropriate to gather information or perform calculations.`,
  tools: [weatherTool, calculatorTool],
  modelConfig: {
    name: process.env.LITELLM_MODEL || 'gemini-2.5-pro',
    temperature: 0.7,
    maxTokens: 1000
  }
};

async function runOtelDemo() {
  console.log('🚀 Starting OpenTelemetry Enhanced Tracing Demo');
  console.log('================================================');

  // Create comprehensive context with all the data sources our enhanced tracer looks for
  const context: DemoContext = {
    userId: 'user_12345',
    sessionId: 'session_abc123',
    query: 'What is the weather like in San Francisco and what is 25 * 4?',
    token_response: {
      email: 'user@example.com',
      username: 'demo_user'
    },
    conversationId: 'conv_demo_123'
  };

  // Create enhanced OpenTelemetry trace collector that will send to Langfuse via OTLP
  const traceCollector = new OpenTelemetryTraceCollector('jaf-otel-demo');

  // Create model provider
  const modelProvider = makeLiteLLMProvider(
    process.env.LITELLM_URL!,
    process.env.LITELLM_API_KEY!
  );

  // Create agent registry
  const agentRegistry = new Map();
  agentRegistry.set('analytics_agent_jaf', analyticsAgent);

  // Create initial state with comprehensive message history
  const initialState = {
    runId: createRunId('demo-run-' + Date.now()),
    traceId: createTraceId('demo-trace-' + Date.now()),
    messages: [
      {
        role: 'user' as const,
        content: context.query
      }
    ],
    currentAgentName: 'analytics_agent_jaf',
    context,
    turnCount: 0
  };

  console.log('📊 Context Information:');
  console.log(`- User ID: ${context.userId}`);
  console.log(`- Session ID: ${context.sessionId}`);
  console.log(`- User Query: ${context.query}`);
  console.log(`- Email: ${context.token_response.email}`);
  console.log(`- Username: ${context.token_response.username}`);
  console.log('');

  // Run configuration with enhanced tracing
  const config = {
    agentRegistry,
    modelProvider,
    maxTurns: 10,
    onEvent: (event: any) => {
      // Log key events for demo purposes
      if (event.type === 'run_start') {
        console.log('🎯 [TRACE] Run started with comprehensive context');
      } else if (event.type === 'llm_call_start') {
        console.log(`🤖 [TRACE] LLM call started - Model: ${event.data.model}`);
      } else if (event.type === 'llm_call_end') {
        console.log(`✅ [TRACE] LLM call completed - Usage: ${JSON.stringify(event.data.usage)}`);
        console.log(`💰 [TRACE] Cost calculation handled automatically by Langfuse based on model: ${event.data.model}`);
      } else if (event.type === 'tool_call_start') {
        console.log(`🔧 [TRACE] Tool call started - ${event.data.toolName}`);
      } else if (event.type === 'tool_call_end') {
        console.log(`🎉 [TRACE] Tool call completed - ${event.data.toolName}`);
      }
      
      // Pass to trace collector
      traceCollector.collect({ ...event, traceId: initialState.traceId });
    }
  };

  try {
    console.log('🏃 Running JAF with Enhanced OpenTelemetry Tracing...');
    console.log('');
    
    const result = await run(initialState, config);
    
    console.log('');
    console.log('📋 Results:');
    console.log('===========');
    
    if (result.outcome.status === 'completed') {
      console.log('✅ Run completed successfully!');
      console.log('📄 Final Output:', result.outcome.output);
    } else {
      console.log('❌ Run failed:', result.outcome.error);
    }
    
    console.log('');
    console.log('📊 Final State:');
    console.log(`- Turn Count: ${result.finalState.turnCount}`);
    console.log(`- Message Count: ${result.finalState.messages.length}`);
    console.log(`- Current Agent: ${result.finalState.currentAgentName}`);
    
    console.log('');
    console.log('🔍 Enhanced Tracing Features Demonstrated:');
    console.log('- ✅ User query extraction from multiple sources');
    console.log('- ✅ User ID extraction from token_response');
    console.log('- ✅ Comprehensive context handling');
    console.log('- ✅ Detailed span hierarchy with OpenTelemetry');
    console.log('- ✅ Cost tracking and usage monitoring');
    console.log('- ✅ Tool execution tracing');
    console.log('- ✅ Error handling and debugging logs');
    
  } catch (error) {
    console.error('💥 Demo failed:', error);
  } finally {
    // Clean up trace collector
    traceCollector.clear();
    console.log('');
    console.log('🧹 Cleanup completed');
  }
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  runOtelDemo().catch(console.error);
}

export { runOtelDemo };
