/**
 * FAF ADK Layer - Integration Tests
 */

import {
  createAgent,
  createSimpleAgent,
  createMultiAgent,
  createFunctionTool,
  createEchoTool,
  createCalculatorTool,
  createInMemorySessionProvider,
  createRunnerConfig,
  runAgent,
  runAgentStream,
  createUserMessage,
  createModelMessage,
  getTextContent,
  quickSetup,
  createQuickWeatherAgent,
  createQuickChatAgent
} from '../index';

import { streamToArray } from '../streaming';

describe('ADK Layer Integration', () => {
  describe('End-to-End Agent Workflows', () => {
    test('should create and run a complete agent workflow', async () => {
      // Create tools
      const greetingTool = createFunctionTool(
        'greet',
        'Generate a greeting',
        ({ name }: { name: string }) => `Hello, ${name}! Welcome to FAF ADK!`,
        [
          {
            name: 'name',
            type: 'string',
            description: 'Name to greet',
            required: true
          }
        ]
      );

      const calculatorTool = createCalculatorTool();

      // Create agent
      const agent = createAgent({
        name: 'integration_agent',
        model: 'gemini-2.0-flash',
        instruction: 'You are a helpful assistant that can greet users and perform calculations',
        tools: [greetingTool, calculatorTool]
      });

      // Create session provider and runner
      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      // Test greeting
      const greetingMessage = createUserMessage('Please greet me, my name is Alice');
      const greetingResponse = await runAgent(
        runnerConfig,
        { userId: 'user_123' },
        greetingMessage
      );

      expect(greetingResponse.content).toBeDefined();
      expect(greetingResponse.session.messages).toContain(greetingMessage);
      expect(greetingResponse.metadata.agentId).toBe(agent.id);

      // Test calculation in same session
      const calcMessage = createUserMessage('What is 25 * 4?');
      const calcResponse = await runAgent(
        runnerConfig,
        { userId: 'user_123', sessionId: greetingResponse.session.id },
        calcMessage
      );

      expect(calcResponse.content).toBeDefined();
      expect(calcResponse.session.id).toBe(greetingResponse.session.id);
      expect(calcResponse.session.messages.length).toBeGreaterThan(2);
    });

    test('should handle streaming agent interactions', async () => {
      const { run, stream } = quickSetup(
        'streaming_test_agent',
        'gemini-2.0-flash',
        'You are a storytelling agent that provides engaging narratives',
        [createEchoTool()]
      );

      // Test regular execution
      const message = createUserMessage('Tell me a short story');
      const response = await run({ userId: 'user_123' }, message);
      
      expect(response.content).toBeDefined();
      expect(getTextContent(response.content)).toBeTruthy();

      // Test streaming execution
      const streamingEvents = stream({ userId: 'user_123' }, message);
      const events = await streamToArray(streamingEvents);
      
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('message_start');
    });

    test('should handle multi-agent coordination', async () => {
      // Create specialized agents
      const weatherAgent = createAgent({
        name: 'weather_specialist',
        model: 'gemini-2.0-flash',
        instruction: 'Provide weather information',
        tools: [createFunctionTool(
          'get_weather',
          'Get weather data',
          ({ location }: { location: string }) => ({
            location,
            temperature: 22,
            condition: 'sunny',
            humidity: 60
          }),
          [{ name: 'location', type: 'string', description: 'Location', required: true }]
        )]
      });

      const mathAgent = createAgent({
        name: 'math_specialist', 
        model: 'gemini-2.0-flash',
        instruction: 'Perform mathematical calculations',
        tools: [createCalculatorTool()]
      });

      // Create coordinator
      const coordinator = createMultiAgent(
        'smart_coordinator',
        'gemini-2.0-flash',
        'Coordinate between weather and math specialists based on user requests',
        [weatherAgent.config, mathAgent.config],
        'conditional'
      );

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(coordinator, sessionProvider);

      // Test weather delegation
      const weatherMessage = createUserMessage('What\'s the weather in Tokyo?');
      const weatherResponse = await runAgent(
        runnerConfig,
        { userId: 'user_123' },
        weatherMessage
      );

      expect(weatherResponse.content).toBeDefined();

      // Test math delegation  
      const mathMessage = createUserMessage('Calculate 15 + 27');
      const mathResponse = await runAgent(
        runnerConfig,
        { userId: 'user_123', sessionId: weatherResponse.session.id },
        mathMessage
      );

      expect(mathResponse.content).toBeDefined();
    });
  });

  describe('Quick Setup Utilities', () => {
    test('should create weather agent using quick setup', async () => {
      const { agent, run } = createQuickWeatherAgent();
      
      expect(agent.config.name).toBe('weather_agent');
      expect(agent.config.tools.length).toBeGreaterThan(0);

      const message = createUserMessage('What\'s the weather like?');
      const response = await run({ userId: 'user_123' }, message);
      
      expect(response.content).toBeDefined();
    });

    test('should create chat agent using quick setup', async () => {
      const { agent, run } = createQuickChatAgent();
      
      expect(agent.config.name).toBe('chat_agent');
      expect(agent.config.tools.length).toBeGreaterThan(0);

      const message = createUserMessage('What is 50 / 2?');
      const response = await run({ userId: 'user_123' }, message);
      
      expect(response.content).toBeDefined();
    });
  });

  describe('Session Persistence', () => {
    test('should maintain conversation history across multiple interactions', async () => {
      const agent = createSimpleAgent(
        'persistent_agent',
        'gemini-2.0-flash',
        'Remember our conversation history',
        []
      );

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      const context = { userId: 'user_123' };

      // First interaction
      const message1 = createUserMessage('My name is Bob');
      const response1 = await runAgent(runnerConfig, context, message1);
      
      expect(response1.session.messages).toHaveLength(2); // user + model message

      // Second interaction with same session
      const message2 = createUserMessage('What did I tell you my name was?');
      const response2 = await runAgent(
        runnerConfig,
        { ...context, sessionId: response1.session.id },
        message2
      );

      expect(response2.session.messages).toHaveLength(4); // Previous 2 + new 2
      expect(response2.session.id).toBe(response1.session.id);
    });

    test('should handle multiple users with separate sessions', async () => {
      const agent = createSimpleAgent(
        'multi_user_agent',
        'gemini-2.0-flash',
        'Handle multiple users',
        []
      );

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      // User 1 interaction
      const user1Message = createUserMessage('I am user 1');
      const user1Response = await runAgent(
        runnerConfig,
        { userId: 'user_1' },
        user1Message
      );

      // User 2 interaction
      const user2Message = createUserMessage('I am user 2');
      const user2Response = await runAgent(
        runnerConfig,
        { userId: 'user_2' },
        user2Message
      );

      expect(user1Response.session.id).not.toBe(user2Response.session.id);
      expect(user1Response.session.userId).toBe('user_1');
      expect(user2Response.session.userId).toBe('user_2');
    });
  });

  describe('Tool Integration', () => {
    test('should handle complex tool interactions', async () => {
      const dataProcessingTool = createFunctionTool(
        'process_data',
        'Process and analyze data',
        ({ data, operation }: { data: number[]; operation: string }) => {
          switch (operation) {
            case 'sum':
              return { result: data.reduce((a, b) => a + b, 0), operation };
            case 'average':
              return { result: data.reduce((a, b) => a + b, 0) / data.length, operation };
            case 'max':
              return { result: Math.max(...data), operation };
            case 'min':
              return { result: Math.min(...data), operation };
            default:
              throw new Error(`Unknown operation: ${operation}`);
          }
        },
        [
          {
            name: 'data',
            type: 'array',
            description: 'Array of numbers to process',
            required: true
          },
          {
            name: 'operation',
            type: 'string',
            description: 'Operation to perform (sum, average, max, min)',
            required: true
          }
        ]
      );

      const agent = createAgent({
        name: 'data_agent',
        model: 'gemini-2.0-flash',
        instruction: 'Help users process and analyze numerical data',
        tools: [dataProcessingTool]
      });

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      const message = createUserMessage('Calculate the sum of these numbers: 10, 20, 30, 40, 50');
      const response = await runAgent(
        runnerConfig,
        { userId: 'user_123' },
        message
      );

      expect(response.content).toBeDefined();
      expect(response.toolCalls.length).toBeGreaterThan(0);
      expect(response.toolResponses.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle tool execution errors gracefully', async () => {
      const errorTool = createFunctionTool(
        'error_tool',
        'A tool that sometimes fails',
        ({ shouldFail }: { shouldFail: boolean }) => {
          if (shouldFail) {
            throw new Error('Tool execution failed');
          }
          return { success: true };
        },
        [
          {
            name: 'shouldFail',
            type: 'boolean',
            description: 'Whether the tool should fail',
            required: true
          }
        ]
      );

      const agent = createAgent({
        name: 'error_handling_agent',
        model: 'gemini-2.0-flash',
        instruction: 'Handle tool errors gracefully',
        tools: [errorTool]
      });

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      // Test successful tool execution
      const successMessage = createUserMessage('Execute tool with success');
      const successResponse = await runAgent(
        runnerConfig,
        { userId: 'user_123' },
        successMessage
      );

      expect(successResponse.content).toBeDefined();

      // Test failed tool execution
      const failMessage = createUserMessage('Execute tool with failure');
      const failResponse = await runAgent(
        runnerConfig,
        { userId: 'user_123', sessionId: successResponse.session.id },
        failMessage
      );

      expect(failResponse.content).toBeDefined();
      // Should have tool responses with errors
      expect(failResponse.toolResponses.some(r => !r.success)).toBeTruthy();
    });

    test('should handle agent execution errors', async () => {
      const problematicAgent = createAgent({
        name: 'problematic_agent',
        model: 'invalid_model',
        instruction: 'This agent will cause issues',
        tools: []
      });

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(problematicAgent, sessionProvider);

      const message = createUserMessage('Try to execute');
      
      await expect(runAgent(runnerConfig, { userId: 'user_123' }, message))
        .rejects.toThrow();
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle multiple concurrent agent executions', async () => {
      const agent = createSimpleAgent(
        'concurrent_agent',
        'gemini-2.0-flash',
        'Handle concurrent requests',
        [createEchoTool()]
      );

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      // Create multiple concurrent requests
      const promises = Array.from({ length: 5 }, (_, i) =>
        runAgent(
          runnerConfig,
          { userId: `user_${i}` },
          createUserMessage(`Concurrent request ${i}`)
        )
      );

      const responses = await Promise.all(promises);

      expect(responses).toHaveLength(5);
      responses.forEach((response, i) => {
        expect(response.content).toBeDefined();
        expect(response.session.userId).toBe(`user_${i}`);
      });
    });

    test('should handle large conversation histories', async () => {
      const agent = createSimpleAgent(
        'history_agent',
        'gemini-2.0-flash',
        'Handle large conversation histories',
        []
      );

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      let currentSession: any = null;

      // Build up a large conversation history
      for (let i = 0; i < 20; i++) {
        const message = createUserMessage(`Message number ${i + 1}`);
        const response = await runAgent(
          runnerConfig,
          {
            userId: 'user_123',
            sessionId: currentSession?.id
          },
          message
        );

        currentSession = response.session;
        expect(response.session.messages.length).toBe((i + 1) * 2);
      }

      // Final session should have 40 messages (20 user + 20 model)
      expect(currentSession.messages).toHaveLength(40);
    });
  });

  describe('Complex Scenarios', () => {
    test('should handle agent delegation and transfer', async () => {
      const transferTool = createFunctionTool(
        'transfer_request',
        'Transfer to specialist agent',
        ({ targetAgent }: { targetAgent: string }, context: any) => {
          if (context.actions) {
            context.actions.transferToAgent = targetAgent;
          }
          return { transferred: true, target: targetAgent };
        },
        [
          {
            name: 'targetAgent',
            type: 'string',
            description: 'Name of target agent',
            required: true
          }
        ]
      );

      const specialistAgent = createAgent({
        name: 'specialist',
        model: 'gemini-2.0-flash',
        instruction: 'I am a specialist agent',
        tools: []
      });

      const coordinatorAgent = createMultiAgent(
        'coordinator',
        'gemini-2.0-flash',
        'Coordinate and transfer to specialists when needed',
        [specialistAgent.config],
        'conditional'
      );
      
      // Add the transfer tool
      coordinatorAgent.config.tools = [transferTool];

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(coordinatorAgent, sessionProvider);

      const message = createUserMessage('I need specialist help');
      const response = await runAgent(
        runnerConfig,
        { userId: 'user_123' },
        message
      );

      expect(response.content).toBeDefined();
    });

    test('should handle mixed content types and complex interactions', async () => {
      const multiModalTool = createFunctionTool(
        'analyze_content',
        'Analyze different types of content',
        ({ contentType, data }: { contentType: string; data: string }) => {
          switch (contentType) {
            case 'text':
              return { type: 'text', length: data.length, words: data.split(' ').length };
            case 'url':
              return { type: 'url', domain: data.split('/')[2] || 'unknown' };
            case 'json':
              try {
                const parsed = JSON.parse(data);
                return { type: 'json', keys: Object.keys(parsed) };
              } catch {
                return { type: 'json', error: 'Invalid JSON' };
              }
            default:
              return { type: 'unknown', data };
          }
        },
        [
          {
            name: 'contentType',
            type: 'string',
            description: 'Type of content to analyze',
            required: true
          },
          {
            name: 'data',
            type: 'string',
            description: 'Content data to analyze',
            required: true
          }
        ]
      );

      const agent = createAgent({
        name: 'content_analyzer',
        model: 'gemini-2.0-flash',
        instruction: 'Analyze various types of content provided by users',
        tools: [multiModalTool]
      });

      const sessionProvider = createInMemorySessionProvider();
      const runnerConfig = createRunnerConfig(agent, sessionProvider);

      // Test text analysis
      const textMessage = createUserMessage('Analyze this text: "Hello world from FAF ADK"');
      const textResponse = await runAgent(
        runnerConfig,
        { userId: 'user_123' },
        textMessage
      );

      expect(textResponse.content).toBeDefined();

      // Test JSON analysis
      const jsonMessage = createUserMessage('Analyze this JSON: {"name": "test", "value": 123}');
      const jsonResponse = await runAgent(
        runnerConfig,
        { userId: 'user_123', sessionId: textResponse.session.id },
        jsonMessage
      );

      expect(jsonResponse.content).toBeDefined();
      expect(jsonResponse.session.messages.length).toBeGreaterThan(2);
    });
  });
});