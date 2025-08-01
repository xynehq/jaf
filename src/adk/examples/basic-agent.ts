/**
 * FAF ADK Layer - Basic Agent Example
 * 
 * Demonstrates basic agent creation and usage
 */

import {
  createAgent,
  createFunctionTool,
  createInMemorySessionProvider,
  createRunnerConfig,
  runAgent,
  runAgentStream,
  createUserMessage,
  quickSetup
} from '../index';

// ========== Example 1: Simple Chat Agent ==========

export const createBasicChatAgent = () => {
  // Create a simple agent
  const agent = createAgent({
    name: 'basic_chat',
    model: 'gemini-2.0-flash',
    instruction: 'You are a friendly assistant. Be helpful and conversational.',
    tools: []
  });

  // Create session provider
  const sessionProvider = createInMemorySessionProvider();

  // Create runner configuration
  const runnerConfig = createRunnerConfig(agent, sessionProvider);

  return { agent, sessionProvider, runnerConfig };
};

// ========== Example 2: Agent with Tools ==========

export const createAgentWithTools = () => {
  // Create some tools
  const greetingTool = createFunctionTool(
    'greeting',
    'Generate a personalized greeting',
    ({ name, timeOfDay }: { name: string; timeOfDay: string }) => {
      const greetings = {
        morning: 'Good morning',
        afternoon: 'Good afternoon',
        evening: 'Good evening',
        night: 'Good night'
      };
      
      const greeting = greetings[timeOfDay as keyof typeof greetings] || 'Hello';
      return `${greeting}, ${name}! How can I help you today?`;
    },
    [
      {
        name: 'name',
        type: 'string',
        description: 'Person\'s name',
        required: true
      },
      {
        name: 'timeOfDay',
        type: 'string',
        description: 'Time of day (morning, afternoon, evening, night)',
        required: true,
        enum: ['morning', 'afternoon', 'evening', 'night']
      }
    ]
  );

  const mathTool = createFunctionTool(
    'calculate',
    'Perform basic mathematical operations',
    ({ operation, a, b }: { operation: string; a: number; b: number }) => {
      switch (operation) {
        case 'add':
          return { result: a + b, operation: `${a} + ${b}` };
        case 'subtract':
          return { result: a - b, operation: `${a} - ${b}` };
        case 'multiply':
          return { result: a * b, operation: `${a} × ${b}` };
        case 'divide':
          return { result: b !== 0 ? a / b : 'Error: Division by zero', operation: `${a} ÷ ${b}` };
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
    },
    [
      {
        name: 'operation',
        type: 'string',
        description: 'Mathematical operation',
        required: true,
        enum: ['add', 'subtract', 'multiply', 'divide']
      },
      {
        name: 'a',
        type: 'number',
        description: 'First number',
        required: true
      },
      {
        name: 'b',
        type: 'number',
        description: 'Second number',
        required: true
      }
    ]
  );

  // Create agent with tools
  const agent = createAgent({
    name: 'assistant_with_tools',
    model: 'gemini-2.0-flash',
    instruction: `You are a helpful assistant with access to greeting and calculation tools.
    Use the greeting tool to welcome users personally, and the calculate tool for math operations.
    Always be friendly and helpful.`,
    tools: [greetingTool, mathTool]
  });

  const sessionProvider = createInMemorySessionProvider();
  const runnerConfig = createRunnerConfig(agent, sessionProvider);

  return { agent, sessionProvider, runnerConfig };
};

// ========== Example 3: Quick Setup Usage ==========

export const createQuickAgent = () => {
  const timestampTool = createFunctionTool(
    'get_timestamp',
    'Get the current timestamp',
    () => ({
      timestamp: new Date().toISOString(),
      unix: Date.now(),
      formatted: new Date().toLocaleString()
    }),
    []
  );

  return quickSetup(
    'timestamp_agent',
    'gemini-2.0-flash',
    'You are a time-keeping assistant. Use the get_timestamp tool to provide current time information.',
    [timestampTool]
  );
};

// ========== Example Usage Functions ==========

export async function runBasicExample() {
  console.log('=== FAF ADK Layer - Basic Agent Example ===\n');

  const { runnerConfig } = createBasicChatAgent();

  const message = createUserMessage('Hello! How are you doing today?');
  
  const response = await runAgent(runnerConfig, {
    userId: 'user_123',
    sessionId: 'session_456'
  }, message);

  console.log('User:', message.parts[0].text);
  console.log('Agent:', response.content.parts[0].text);
  console.log('Session ID:', response.session.id);
  console.log('Message Count:', response.session.messages.length);
}

export async function runToolExample() {
  console.log('\n=== FAF ADK Layer - Agent with Tools Example ===\n');

  const { runnerConfig } = createAgentWithTools();

  // Test greeting tool
  const greetingMessage = createUserMessage('Please greet me, my name is Alice and it\'s morning');
  
  const greetingResponse = await runAgent(runnerConfig, {
    userId: 'user_123',
    sessionId: 'session_456'
  }, greetingMessage);

  console.log('User:', greetingMessage.parts[0].text);
  console.log('Agent:', greetingResponse.content.parts[0].text);

  // Test math tool
  const mathMessage = createUserMessage('What is 15 + 27?');
  
  const mathResponse = await runAgent(runnerConfig, {
    userId: 'user_123',
    sessionId: 'session_456'
  }, mathMessage);

  console.log('\nUser:', mathMessage.parts[0].text);
  console.log('Agent:', mathResponse.content.parts[0].text);
}

export async function runStreamingExample() {
  console.log('\n=== FAF ADK Layer - Streaming Example ===\n');

  const { runnerConfig } = createBasicChatAgent();

  const message = createUserMessage('Tell me about the benefits of functional programming');

  console.log('User:', message.parts[0].text);
  console.log('Agent (streaming):');

  const events = runAgentStream(runnerConfig, {
    userId: 'user_123',
    sessionId: 'session_789'
  }, message);

  for await (const event of events) {
    if (event.type === 'message_delta' && event.content) {
      process.stdout.write(event.content.parts[0].text || '');
    } else if (event.type === 'message_complete') {
      console.log('\n[Stream complete]');
      break;
    } else if (event.type === 'error') {
      console.log('\n[Error]:', event.error);
      break;
    }
  }
}

export async function runQuickSetupExample() {
  console.log('\n=== FAF ADK Layer - Quick Setup Example ===\n');

  const { run } = createQuickAgent();

  const message = createUserMessage('What time is it?');
  
  const response = await run({
    userId: 'user_123'
  }, message);

  console.log('User:', message.parts[0].text);
  console.log('Agent:', response.content.parts[0].text);
}

// ========== Main Example Runner ==========

export async function runAllExamples() {
  try {
    await runBasicExample();
    await runToolExample();
    await runStreamingExample();
    await runQuickSetupExample();
    
    console.log('\n=== All examples completed successfully! ===');
  } catch (error) {
    console.error('Example failed:', error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runAllExamples();
}