/**
 * Example demonstrating real LLM streaming
 */

import { 
  createAdkLLMService, 
  createAgent, 
  createUserMessage,
  createInMemorySessionProvider,
  createFunctionTool
} from '../index.js';

// Helper to display streaming output
const displayStream = async (stream: AsyncGenerator<any>) => {
  process.stdout.write('🤖 Assistant: ');
  
  for await (const chunk of stream) {
    if (chunk.delta) {
      process.stdout.write(chunk.delta);
    }
    
    if (chunk.functionCall) {
      process.stdout.write(`\n📞 Calling function: ${chunk.functionCall.name}(${JSON.stringify(chunk.functionCall.args)})`);
    }
    
    if (chunk.isDone) {
      process.stdout.write('\n');
      break;
    }
  }
};

// Example 1: Basic streaming with OpenAI
async function openAIStreamingExample() {
  console.log('\n=== OpenAI Streaming Example ===\n');
  
  if (!process.env.OPENAI_API_KEY) {
    console.log('❌ OPENAI_API_KEY not set. Skipping OpenAI example.');
    return;
  }
  
  const service = createAdkLLMService({
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY
  });
  
  const agent = createAgent({
    name: 'streaming-assistant',
    model: 'gpt-3.5-turbo',
    instruction: 'You are a helpful assistant. Be concise but friendly.',
    tools: []
  });
  
  const sessionProvider = createInMemorySessionProvider();
  const session = await sessionProvider.createSession({
    appName: 'streaming-demo',
    userId: 'demo-user'
  });
  
  const message = createUserMessage('Tell me a very short story about a robot learning to stream data.');
  
  console.log('👤 User:', message.parts[0].text);
  
  const stream = service.generateStreamingResponse(agent, session, message);
  await displayStream(stream);
}

// Example 2: Streaming with function calls
async function streamingWithToolsExample() {
  console.log('\n=== Streaming with Tools Example ===\n');
  
  if (!process.env.OPENAI_API_KEY) {
    console.log('❌ OPENAI_API_KEY not set. Skipping tools example.');
    return;
  }
  
  const service = createAdkLLMService({
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY
  });
  
  // Create a weather tool
  const weatherTool = createFunctionTool({
    name: 'getWeather',
    description: 'Get the current weather for a location',
    parameters: [{
      name: 'location',
      type: 'string',
      description: 'The city or location'
    }],
    execute: async ({ location }) => {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      return {
        location,
        temperature: Math.floor(Math.random() * 30) + 10,
        condition: ['sunny', 'cloudy', 'rainy'][Math.floor(Math.random() * 3)]
      };
    }
  });
  
  const agent = createAgent({
    name: 'weather-assistant',
    model: 'gpt-3.5-turbo',
    instruction: 'You are a weather assistant. Use the weather tool to get current conditions.',
    tools: [weatherTool]
  });
  
  const sessionProvider = createInMemorySessionProvider();
  const session = await sessionProvider.createSession({
    appName: 'streaming-demo',
    userId: 'demo-user'
  });
  
  const message = createUserMessage('What\'s the weather like in Tokyo and London?');
  
  console.log('👤 User:', message.parts[0].text);
  
  const stream = service.generateStreamingResponse(agent, session, message);
  await displayStream(stream);
}

// Example 3: LiteLLM streaming
async function liteLLMStreamingExample() {
  console.log('\n=== LiteLLM Streaming Example ===\n');
  
  if (!process.env.LITELLM_URL) {
    console.log('❌ LITELLM_URL not set. Skipping LiteLLM example.');
    return;
  }
  
  const service = createAdkLLMService({
    provider: 'litellm',
    baseUrl: process.env.LITELLM_URL,
    apiKey: process.env.LITELLM_API_KEY || 'test',
    defaultModel: 'gpt-3.5-turbo'
  });
  
  const agent = createAgent({
    name: 'litellm-assistant',
    model: 'gpt-3.5-turbo',
    instruction: 'You are a helpful assistant running through LiteLLM proxy.',
    tools: []
  });
  
  const sessionProvider = createInMemorySessionProvider();
  const session = await sessionProvider.createSession({
    appName: 'streaming-demo',
    userId: 'demo-user'
  });
  
  const message = createUserMessage('Count from 1 to 10 slowly.');
  
  console.log('👤 User:', message.parts[0].text);
  
  const stream = service.generateStreamingResponse(agent, session, message);
  await displayStream(stream);
}

// Example 4: Comparing streaming vs non-streaming
async function compareStreamingExample() {
  console.log('\n=== Streaming vs Non-Streaming Comparison ===\n');
  
  if (!process.env.OPENAI_API_KEY) {
    console.log('❌ OPENAI_API_KEY not set. Skipping comparison.');
    return;
  }
  
  const service = createAdkLLMService({
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY
  });
  
  const agent = createAgent({
    name: 'comparison-assistant',
    model: 'gpt-3.5-turbo',
    instruction: 'You are a helpful assistant.',
    tools: []
  });
  
  const sessionProvider = createInMemorySessionProvider();
  const session = await sessionProvider.createSession({
    appName: 'streaming-demo',
    userId: 'demo-user'
  });
  
  const message = createUserMessage('Explain streaming in one sentence.');
  
  // Non-streaming
  console.log('🚀 Non-streaming (wait for complete response):');
  const startNonStream = Date.now();
  const response = await service.generateResponse(agent, session, message);
  const endNonStream = Date.now();
  console.log('Response:', response.content.parts[0].text);
  console.log(`Time: ${endNonStream - startNonStream}ms\n`);
  
  // Streaming
  console.log('🌊 Streaming (see response as it arrives):');
  const startStream = Date.now();
  let firstChunkTime = 0;
  const stream = service.generateStreamingResponse(agent, session, message);
  
  for await (const chunk of stream) {
    if (chunk.delta && !firstChunkTime) {
      firstChunkTime = Date.now() - startStream;
      process.stdout.write(`First chunk in ${firstChunkTime}ms: `);
    }
    
    if (chunk.delta) {
      process.stdout.write(chunk.delta);
    }
    
    if (chunk.isDone) {
      const endStream = Date.now();
      console.log(`\nTotal time: ${endStream - startStream}ms`);
      break;
    }
  }
}

// Main function
async function main() {
  console.log('🎯 FAF ADK Real Streaming Examples\n');
  console.log('This demonstrates real LLM streaming, not simulated chunking.\n');
  
  try {
    await openAIStreamingExample();
    await streamingWithToolsExample();
    await liteLLMStreamingExample();
    await compareStreamingExample();
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  console.log('\n✅ Examples completed!');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { 
  openAIStreamingExample, 
  streamingWithToolsExample, 
  liteLLMStreamingExample,
  compareStreamingExample
};