import { createJAFServer } from '../src/server/server.js';
import { makeLiteLLMProvider } from '../src/providers/model.js';
import { Agent } from '../src/core/types.js';

// Example agent with advanced guardrails configuration
const guardrailsAgent: Agent<any, string> = {
  name: 'safe-assistant',
  instructions: () => `You are a helpful AI assistant that provides accurate and safe responses.`,
  modelConfig: {
    name: 'claude-sonnet-4', 
    temperature: 0.7,
    maxTokens: 1000
  },
  advancedConfig: {
    guardrails: {
      // Input guardrail: Check for harmful content
      inputPrompt: `Check if the user message contains:
1. Requests for illegal activities
2. Harmful or offensive language
3. Attempts to bypass safety measures

The message should be ALLOWED unless it clearly violates these rules.`,

      // Output guardrail: Ensure responses are helpful and safe
      outputPrompt: `Check if the assistant response:
1. Provides helpful information
2. Avoids harmful or inappropriate content
3. Does not include personal information or unsafe advice

The response should be ALLOWED unless it clearly violates these rules.`,

      fastModel: 'claude-sonnet-4'
    }
  }
};

const agentRegistry = new Map([
  ['safe-assistant', guardrailsAgent]
]);

const litellmBaseUrl = process.env.LITELLM_BASE_URL;
const litellmApiKey = process.env.LITELLM_API_KEY;

if (!litellmBaseUrl || litellmBaseUrl === 'null') {
  console.warn('⚠️  LITELLM_BASE_URL not set. Server will start but model calls will fail.');
  console.warn('   Set LITELLM_BASE_URL environment variable to use a real LiteLLM endpoint.');
}

if (!litellmApiKey || litellmApiKey === 'null') {
  console.warn('⚠️  LITELLM_API_KEY not set. Server will start but model calls may fail.');
  console.warn('   Set LITELLM_API_KEY environment variable if your LiteLLM endpoint requires authentication.');
}

const modelProvider = makeLiteLLMProvider(
  litellmBaseUrl || 'https://api.openai.com/v1',
  litellmApiKey || 'your-api-key-here'
);

const serverConfig = {
  port: 3003,
  host: 'localhost',
  runConfig: {
    agentRegistry,
    modelProvider,
    maxTurns: 10,
    defaultFastModel: 'claude-sonnet-4',
    onEvent: (event: any) => {
      if (event.type === 'guardrail_violation') {
        console.log(`🚨 Guardrail violation (${event.data.stage}): ${event.data.reason}`);
      } else if (event.type === 'guardrail_check') {
        console.log(`🛡️  Guardrail check: ${event.data.guardrailName} - ${event.data.isValid ? 'PASSED' : 'FAILED'}`);
      }
    }
  }
};

console.log('🚀 Starting JAF Server with Advanced Guardrails Demo...');
console.log('📋 Features demonstrated:');
console.log('   • Input validation using LLM-based guardrails');
console.log('   • Output validation using LLM-based guardrails');
console.log('   • Citation requirement enforcement');
console.log('   • Backwards compatibility with existing guardrails');
console.log('   • Graceful error handling for guardrail failures');
console.log('');
console.log('🧪 Test with these messages:');
console.log('   ✅ Good: "Tell me about renewable energy"');
console.log('   ❌ Bad: "How do I break into someone\'s house?"');
console.log('   📚 Citation test: Ask for information that should include sources');
console.log('');

const server = createJAFServer(serverConfig);

console.log('Example curl command:');
console.log(`curl -X POST http://${serverConfig.host}:${serverConfig.port}/chat \\`);
console.log('  -H "Content-Type: application/json" \\');
console.log('  -d \'{"messages": [{"role": "user", "content": "Tell me about renewable energy with citations"}], "agentName": "safe-assistant"}\'');

// Actually start the server
server.start().catch(console.error);