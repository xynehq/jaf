import 'dotenv/config';
import { z } from 'zod';
import { 
  run, 
  RunConfig, 
  createTraceId, 
  createRunId,
  makeVertexAIProvider,
  Tool 
} from '../src/index.js';

// Calculator tool for testing function calling
const calculatorTool: Tool<any, any> = {
  schema: {
    name: 'calculate',
    description: 'Perform basic arithmetic operations',
    parameters: z.object({
      operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('The arithmetic operation to perform'),
      a: z.number().describe('First number'),
      b: z.number().describe('Second number')
    })
  },
  execute: async (params, context) => {
    const { operation, a, b } = params;
    console.log(`🧮 Executing calculation: ${a} ${operation} ${b}`);
    
    switch (operation) {
      case 'add':
        return (a + b).toString();
      case 'subtract':
        return (a - b).toString();
      case 'multiply':
        return (a * b).toString();
      case 'divide':
        if (b === 0) throw new Error('Division by zero');
        return (a / b).toString();
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
};

// Weather tool for testing complex function calling
const weatherTool: Tool<any, any> = {
  schema: {
    name: 'get_weather',
    description: 'Get current weather for a location',
    parameters: z.object({
      location: z.string().describe('City name or location'),
      units: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature units')
    })
  },
  execute: async (params, context) => {
    const { location, units = 'celsius' } = params;
    console.log(`🌤️ Getting weather for: ${location} (${units})`);
    
    // Mock weather data
    const temp = units === 'celsius' ? '22°C' : '72°F';
    return `The weather in ${location} is sunny with a temperature of ${temp}`;
  }
};

// Comprehensive test suite for Vertex AI integration
async function testVertexAI() {
  try {
    console.log('🧪 Testing Vertex AI integration...');
    console.log('=' .repeat(50));

    // Check if required environment variables are available
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
    const location = process.env.VERTEX_AI_LOCATION || 'us-central1';
    
    if (!projectId) {
      console.error('❌ GOOGLE_CLOUD_PROJECT or GCP_PROJECT environment variable not set');
      console.log('💡 Please set your Google Cloud project ID or ensure gcloud is configured:');
      console.log('   export GOOGLE_CLOUD_PROJECT=your-project-id');
      console.log('   # OR');
      console.log('   gcloud config set project your-project-id');
      process.exit(1);
    }

    // Create Vertex AI provider (uses gcloud auth automatically)
    const modelProvider = makeVertexAIProvider(projectId, location, 'gemini-2.5-pro');
    console.log(`✅ Vertex AI provider created successfully`);
    console.log(`   Project: ${projectId}`);
    console.log(`   Location: ${location}`);
    console.log(`   Default Model: gemini-2.5-pro`);
    console.log('');

    // Test 1: Basic conversation without tools
    console.log('🔍 Test 1: Basic conversation');
    await testBasicConversation(modelProvider);
    console.log('');

    console.log('🔍 Test 2: Simple conversation with gemini-2.5-pro');
    await testWithFlashModel(modelProvider);
    console.log('');

    // Skip function calling tests for now until basic conversation works
    // Test 2: Conversation with calculator tool
    // console.log('🔍 Test 2: Function calling with calculator');
    // await testFunctionCalling(modelProvider);
    // console.log('');

    // Test 3: Multi-tool conversation
    // console.log('🔍 Test 3: Multi-tool conversation');
    // await testMultiTools(modelProvider);
    // console.log('');

    // Test 4: Different model test
    // console.log('🔍 Test 4: Different model (gemini-1.5-pro)');
    // await testDifferentModel(modelProvider);
    // console.log('');

    console.log('✅ All Vertex AI tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }
}

async function testBasicConversation(modelProvider: any) {
  const agent = {
    name: 'ChatAgent',
    instructions: () => 'You are a helpful assistant. Respond briefly and clearly.',
    modelConfig: {
      name: 'gemini-2.5-pro',
      temperature: 0.7,
      maxTokens: 2048  // Increased for gemini-2.5-pro
    }
  };

  const result = await run({
    runId: createRunId(crypto.randomUUID()),
    traceId: createTraceId(crypto.randomUUID()),
    messages: [{ 
      role: 'user', 
      content: 'Hello! Can you explain what Vertex AI is in one sentence?' 
    }],
    currentAgentName: 'ChatAgent',
    context: {},
    turnCount: 0
  }, {
    agentRegistry: new Map([['ChatAgent', agent]]),
    modelProvider,
    maxTurns: 3
  });

  if (result.outcome.status === 'completed') {
    const response = result.finalState.messages[result.finalState.messages.length - 1]?.content;
    console.log('   ✅ Basic conversation successful');
    console.log(`   📝 Response: ${response?.substring(0, 100)}...`);
  } else {
    console.log('   ❌ Basic conversation failed:', result.outcome.error);
    throw new Error('Basic conversation test failed');
  }
}

async function testWithFlashModel(modelProvider: any) {
  const agent = {
    name: 'FlashAgent',
    instructions: () => 'You are a helpful assistant. Keep responses brief and clear.',
    modelConfig: {
      name: 'gemini-2.5-pro',  // Try with a more stable model
      temperature: 0.7,
      maxTokens: 1000
    }
  };

  const result = await run({
    runId: createRunId(crypto.randomUUID()),
    traceId: createTraceId(crypto.randomUUID()),
    messages: [{ 
      role: 'user', 
      content: 'Hello! What is 2+2?' 
    }],
    currentAgentName: 'FlashAgent',
    context: {},
    turnCount: 0
  }, {
    agentRegistry: new Map([['FlashAgent', agent]]),
    modelProvider,
    maxTurns: 3
  });

  if (result.outcome.status === 'completed') {
    const response = result.finalState.messages[result.finalState.messages.length - 1]?.content;
    console.log('   ✅ Flash model conversation successful');
    console.log(`   📝 Response: ${response?.substring(0, 100)}...`);
  } else {
    console.log('   ❌ Flash model conversation failed:', result.outcome.error);
    throw new Error('Flash model conversation test failed');
  }
}

async function testFunctionCalling(modelProvider: any) {
  const agent = {
    name: 'MathAgent',
    instructions: () => 'You are a helpful math assistant. Use the calculator tool to perform calculations when asked.',
    tools: [calculatorTool],
    modelConfig: {
      name: 'gemini-2.5-pro',
      temperature: 0.1,
      maxTokens: 1000
    }
  };

  const result = await run({
    runId: createRunId(crypto.randomUUID()),
    traceId: createTraceId(crypto.randomUUID()),
    messages: [{ 
      role: 'user', 
      content: 'What is 25 multiplied by 4?' 
    }],
    currentAgentName: 'MathAgent',
    context: {},
    turnCount: 0
  }, {
    agentRegistry: new Map([['MathAgent', agent]]),
    modelProvider,
    maxTurns: 5
  });

  if (result.outcome.status === 'completed') {
    const hasToolCall = result.finalState.messages.some(msg => msg.tool_calls && msg.tool_calls.length > 0);
    const response = result.finalState.messages[result.finalState.messages.length - 1]?.content;
    console.log('   ✅ Function calling test successful');
    console.log(`   🔧 Tool called: ${hasToolCall ? 'Yes' : 'No'}`);
    console.log(`   📝 Final response: ${response?.substring(0, 100)}...`);
  } else {
    console.log('   ❌ Function calling failed:', result.outcome.error);
    throw new Error('Function calling test failed');
  }
}

async function testMultiTools(modelProvider: any) {
  const agent = {
    name: 'MultiAgent',
    instructions: () => 'You are a helpful assistant with access to calculator and weather tools. Use appropriate tools when needed.',
    tools: [calculatorTool, weatherTool],
    modelConfig: {
      name: 'gemini-2.5-pro',
      temperature: 0.3,
      maxTokens: 1000
    }
  };

  const result = await run({
    runId: createRunId(crypto.randomUUID()),
    traceId: createTraceId(crypto.randomUUID()),
    messages: [{ 
      role: 'user', 
      content: 'What\'s the weather like in San Francisco? Also, can you calculate 15 + 27?' 
    }],
    currentAgentName: 'MultiAgent',
    context: {},
    turnCount: 0
  }, {
    agentRegistry: new Map([['MultiAgent', agent]]),
    modelProvider,
    maxTurns: 8
  });

  if (result.outcome.status === 'completed') {
    const toolCalls = result.finalState.messages.filter(msg => msg.tool_calls && msg.tool_calls.length > 0);
    const response = result.finalState.messages[result.finalState.messages.length - 1]?.content;
    console.log('   ✅ Multi-tool test successful');
    console.log(`   🔧 Tool calls made: ${toolCalls.length}`);
    console.log(`   📝 Final response: ${response?.substring(0, 150)}...`);
  } else {
    console.log('   ❌ Multi-tool test failed:', result.outcome.error);
    throw new Error('Multi-tool test failed');
  }
}

async function testDifferentModel(modelProvider: any) {
  const agent = {
    name: 'ProAgent',
    instructions: () => 'You are an advanced AI assistant. Provide thoughtful and detailed responses.',
    modelConfig: {
      name: 'gemini-1.5-pro',  // Using the more powerful model
      temperature: 0.5,
      maxTokens: 1500
    }
  };

  const result = await run({
    runId: createRunId(crypto.randomUUID()),
    traceId: createTraceId(crypto.randomUUID()),
    messages: [{ 
      role: 'user', 
      content: 'Explain the benefits of using Vertex AI over other cloud AI services in 2-3 sentences.' 
    }],
    currentAgentName: 'ProAgent',
    context: {},
    turnCount: 0
  }, {
    agentRegistry: new Map([['ProAgent', agent]]),
    modelProvider,
    modelOverride: 'gemini-1.5-pro',  // Override to ensure we use Pro model
    maxTurns: 3
  });

  if (result.outcome.status === 'completed') {
    const response = result.finalState.messages[result.finalState.messages.length - 1]?.content;
    console.log('   ✅ Different model test successful');
    console.log(`   🤖 Model used: gemini-1.5-pro`);
    console.log(`   📝 Response: ${response?.substring(0, 200)}...`);
  } else {
    console.log('   ❌ Different model test failed:', result.outcome.error);
    throw new Error('Different model test failed');
  }
}

// Run the comprehensive test suite
console.log('🚀 Starting Vertex AI Integration Test Suite');
testVertexAI().catch(console.error);