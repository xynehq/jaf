/**
 * Real LLM Integration Tests - Using Actual OpenAI API
 * 
 * These tests call the real OpenAI API to verify that line 252 and 
 * the entire LLM integration works with actual LLM providers.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import {
  createAgent,
  createSimpleAgent,
  createFunctionTool,
  createCalculatorTool,
  createInMemorySessionProvider,
  createRunnerConfig,
  runAgent,
  runAgentStream,
  createUserMessage,
  getTextContent,
  createAdkLLMService,
  createAdkLLMConfigFromEnvironment,
  Model,
  ToolParameterType,
  AgentEvent
} from '../index.js';

describe('Real LLM Integration Tests', () => {
  let hasOpenAIKey = false;

  beforeAll(() => {
    hasOpenAIKey = !!process.env.OPENAI_API_KEY;
    if (!hasOpenAIKey) {
      console.warn('OPENAI_API_KEY not found - skipping real LLM tests');
    }
  });

  describe('Basic LLM Calls', () => {
    it('should make a real call to OpenAI and get a response', async () => {
      if (!hasOpenAIKey) return;

      const agent = createSimpleAgent(
        'test_agent',
        Model.GPT_4,
        'You are a helpful assistant. Always respond with exactly "Hello from OpenAI!"',
        []
      );

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      const message = createUserMessage('Say hello');
      const response = await runAgent(
        runnerConfig,
        { userId: 'test_user' },
        message
      );

      console.log('=== REAL LLM RESPONSE ===');
      console.log('Agent ID:', response.metadata.agentId);
      console.log('Response:', getTextContent(response.content));
      console.log('LLM calls made:', response.metadata.llmCalls);
      console.log('Execution time:', response.metadata.executionTime + 'ms');
      console.log('========================');

      expect(response.content).toBeDefined();
      expect(getTextContent(response.content)).toBeTruthy();
      expect(response.metadata.llmCalls).toBeGreaterThan(0);
      expect(response.session.messages).toHaveLength(2); // User + Model
    }, 30000); // 30 second timeout for API call

    it('should handle streaming responses from real LLM', async () => {
      if (!hasOpenAIKey) return;

      const agent = createSimpleAgent(
        'streaming_agent',
        Model.GPT_4,
        'You are a storyteller. Tell a very short story about a robot.',
        []
      );

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      const message = createUserMessage('Tell me a short story');
      const streamingEvents = runAgentStream(
        runnerConfig,
        { userId: 'test_user' },
        message
      );

      const events: AgentEvent[] = [];
      let fullText = '';

      console.log('=== REAL STREAMING RESPONSE ===');
      for await (const event of streamingEvents) {
        events.push(event);
        console.log(`Event: ${event.type}`);
        
        if (event.type === 'message_delta' && event.content) {
          const deltaText = getTextContent(event.content);
          process.stdout.write(deltaText);
          fullText += deltaText;
        }
        
        if (event.type === 'message_complete') break;
      }
      console.log('\n==============================');

      expect(events.length).toBeGreaterThan(1);
      expect(events[0].type).toBe('message_start');
      expect(events.some(e => e.type === 'message_delta')).toBe(true);
      expect(events[events.length - 1].type).toBe('message_complete');
      expect(fullText.length).toBeGreaterThan(10);
    }, 30000);
  });

  describe('Tool Execution with Real LLM', () => {
    it('should use real LLM to execute calculator tool', async () => {
      if (!hasOpenAIKey) return;

      const calculatorTool = createCalculatorTool();
      
      const agent = createAgent({
        name: 'math_agent',
        model: Model.GPT_4,
        instruction: 'You are a math assistant. Use the calculator tool to solve mathematical problems. Always use the tool for calculations.',
        tools: [calculatorTool]
      });

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      const message = createUserMessage('What is 157 * 23? Please use the calculator tool.');
      const response = await runAgent(
        runnerConfig,
        { userId: 'test_user' },
        message
      );

      console.log('=== REAL TOOL EXECUTION ===');
      console.log('User asked:', getTextContent(message));
      console.log('LLM response:', getTextContent(response.content));
      console.log('Tool calls made:', response.toolCalls.length);
      console.log('Tool responses:', response.toolResponses.length);
      
      if (response.toolCalls.length > 0) {
        response.toolCalls.forEach((call, i) => {
          console.log(`Tool call ${i + 1}:`, call.name, call.args);
        });
      }
      
      if (response.toolResponses.length > 0) {
        response.toolResponses.forEach((resp, i) => {
          console.log(`Tool response ${i + 1}:`, resp.success ? resp.response : resp.error);
        });
      }
      console.log('==========================');

      expect(response.content).toBeDefined();
      expect(response.toolCalls.length).toBeGreaterThan(0);
      expect(response.toolResponses.length).toBeGreaterThan(0);
      expect(response.toolResponses[0].success).toBe(true);
      
      // Check if the calculation result (157 * 23 = 3611) appears in the response
      const responseText = getTextContent(response.content);
      expect(responseText).toMatch(/3611/);
    }, 45000);

    it('should handle custom tool with real LLM', async () => {
      if (!hasOpenAIKey) return;

      const weatherTool = createFunctionTool({
        name: 'get_weather',
        description: 'Get current weather information for a location',
        execute: (params) => {
          const { location } = params as { location: string };
          return {
            location,
            temperature: 22,
            condition: 'sunny',
            humidity: 65,
            timestamp: new Date().toISOString()
          };
        },
        parameters: [
          {
            name: 'location',
            type: ToolParameterType.STRING,
            description: 'The location to get weather for',
            required: true
          }
        ]
      });

      const agent = createAgent({
        name: 'weather_agent',
        model: Model.GPT_4,
        instruction: 'You are a weather assistant. Use the get_weather tool when users ask about weather. Always use the tool to get real weather data.',
        tools: [weatherTool]
      });

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      const message = createUserMessage('What\'s the weather like in Tokyo?');
      const response = await runAgent(
        runnerConfig,
        { userId: 'test_user' },
        message
      );

      console.log('=== REAL WEATHER TOOL TEST ===');
      console.log('User asked:', getTextContent(message));
      console.log('LLM response:', getTextContent(response.content));
      console.log('Tool calls:', response.toolCalls.map(c => ({ name: c.name, args: c.args })));
      console.log('Tool responses:', response.toolResponses.map(r => r.response));
      console.log('==============================');

      expect(response.toolCalls.length).toBeGreaterThan(0);
      expect(response.toolCalls[0].name).toBe('get_weather');
      expect(response.toolCalls[0].args.location).toMatch(/tokyo/i);
      expect(response.toolResponses[0].success).toBe(true);
      
      const responseText = getTextContent(response.content);
      expect(responseText.toLowerCase()).toMatch(/tokyo|weather|22|sunny/);
    }, 45000);
  });

  describe('Multi-turn Conversation with Real LLM', () => {
    it('should maintain context across multiple real LLM calls', async () => {
      if (!hasOpenAIKey) return;

      const agent = createSimpleAgent(
        'memory_agent',
        Model.GPT_4,
        'You are a helpful assistant with good memory. Remember what users tell you and refer to it in future responses.',
        []
      );

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      // First message
      const message1 = createUserMessage('My name is Alice and I love cats.');
      const response1 = await runAgent(
        runnerConfig,
        { userId: 'test_user' },
        message1
      );

      // Second message in same session
      const message2 = createUserMessage('What did I tell you about myself?');
      const response2 = await runAgent(
        runnerConfig,
        { userId: 'test_user', sessionId: response1.session.id },
        message2
      );

      console.log('=== REAL CONVERSATION TEST ===');
      console.log('Message 1:', getTextContent(message1));
      console.log('Response 1:', getTextContent(response1.content));
      console.log('Message 2:', getTextContent(message2));
      console.log('Response 2:', getTextContent(response2.content));
      console.log('Session messages count:', response2.session.messages.length);
      console.log('==============================');

      expect(response2.session.messages).toHaveLength(4); // 2 user + 2 model
      expect(response2.session.id).toBe(response1.session.id);
      
      const response2Text = getTextContent(response2.content).toLowerCase();
      expect(response2Text).toMatch(/alice|name/);
      expect(response2Text).toMatch(/cat/);
    }, 45000);
  });

  describe('Error Handling with Real LLM', () => {
    it('should handle invalid model gracefully', async () => {
      if (!hasOpenAIKey) return;

      const agent = createSimpleAgent(
        'error_agent',
        'invalid-model-name', // This will cause an error
        'You are a test assistant.',
        []
      );

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      const message = createUserMessage('Hello');
      const response = await runAgent(
        runnerConfig,
        { userId: 'test_user' },
        message
      );

      console.log('=== REAL ERROR HANDLING TEST ===');
      console.log('Response to invalid model:', getTextContent(response.content));
      console.log('================================');

      // Should get an error response, not throw an exception
      expect(response.content).toBeDefined();
      const responseText = getTextContent(response.content);
      expect(responseText).toMatch(/technical difficulties|error/i);
    }, 30000);
  });

  describe('LLM Service Direct Integration', () => {
    it('should work with direct LLM service calls', async () => {
      if (!hasOpenAIKey) return;

      // Create LLM service directly
      const config = createAdkLLMConfigFromEnvironment();
      const llmService = createAdkLLMService(config);

      const testAgent = createSimpleAgent(
        'direct_test',
        Model.GPT_4,
        'You are a test assistant. Respond with "Direct service works!"',
        []
      );

      const testSession = {
        id: 'test-session',
        appName: 'test-app',
        userId: 'test-user',
        messages: [],
        artifacts: {},
        metadata: { created: new Date() }
      };

      const testMessage = createUserMessage('Test direct service');

      const response = await llmService.generateResponse(
        testAgent,
        testSession,
        testMessage
      );

      console.log('=== DIRECT LLM SERVICE TEST ===');
      console.log('Config provider:', config.provider);
      console.log('Config model:', config.defaultModel);
      console.log('Response:', getTextContent(response.content));
      console.log('Function calls:', response.functionCalls.length);
      console.log('==============================');

      expect(response.content).toBeDefined();
      expect(getTextContent(response.content)).toBeTruthy();
      expect(response.metadata.model).toBeTruthy();
    }, 30000);
  });
});