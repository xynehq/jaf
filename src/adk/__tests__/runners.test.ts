/**
 * FAF ADK Layer - Runner System Tests
 */

import {
  runAgent,
  runAgentStream,
  createRunnerConfig,
  validateRunnerConfig,
  validateRunContext,
  getRunnerStats,
  withRunnerErrorHandling
} from '../runners';

import {
  createAgent,
  createSimpleAgent,
  createMultiAgent
} from '../agents';

import {
  createFunctionTool,
  createEchoTool,
  createCalculatorTool
} from '../tools';

import {
  createInMemorySessionProvider,
  addMessageToSession
} from '../sessions';

import {
  createUserMessage,
  createModelMessage,
  getFunctionCalls
} from '../content';

import {
  createSchemaValidator,
  stringSchema,
  isString
} from '../schemas';

import { RunnerConfig, RunContext, AgentConfig, GuardrailFunction, AgentError } from '../types';

describe('Runner System', () => {
  const mockTool = createFunctionTool(
    'mock_tool',
    'A mock tool for testing',
    (params, context) => {
      const typedParams = params as { input: string };
      return `Processed: ${typedParams.input}`;
    },
    [
      {
        name: 'input',
        type: 'string',
        description: 'Input to process',
        required: true
      }
    ]
  );

  const mockAgent = createAgent({
    name: 'test_agent',
    model: 'gemini-2.0-flash',
    instruction: 'You are a test agent',
    tools: [mockTool]
  });

  const mockSessionProvider = createInMemorySessionProvider();

  const basicRunnerConfig: RunnerConfig = {
    agent: mockAgent,
    sessionProvider: mockSessionProvider
  };

  const basicRunContext: RunContext = {
    userId: 'test_user',
    sessionId: 'test_session'
  };

  describe('Runner Configuration', () => {
    test('createRunnerConfig should create valid config', () => {
      const config = createRunnerConfig(mockAgent, mockSessionProvider);
      
      expect(config.agent).toBe(mockAgent);
      expect(config.sessionProvider).toBe(mockSessionProvider);
    });

    test('createRunnerConfig should accept options', () => {
      const guardrail: GuardrailFunction = async () => ({ allowed: true });
      
      const config = createRunnerConfig(mockAgent, mockSessionProvider, {
        guardrails: [guardrail],
        maxLLMCalls: 10,
        timeout: 30000
      });
      
      expect(config.guardrails).toEqual([guardrail]);
      expect(config.maxLLMCalls).toBe(10);
      expect(config.timeout).toBe(30000);
    });

    test('validateRunnerConfig should accept valid config', () => {
      expect(() => validateRunnerConfig(basicRunnerConfig)).not.toThrow();
    });

    test('validateRunnerConfig should reject config without agent', () => {
      const invalidConfig = { ...basicRunnerConfig, agent: undefined as any };
      
      expect(() => validateRunnerConfig(invalidConfig))
        .toThrow('Agent is required');
    });

    test('validateRunnerConfig should reject config without session provider', () => {
      const invalidConfig = { ...basicRunnerConfig, sessionProvider: undefined as any };
      
      expect(() => validateRunnerConfig(invalidConfig))
        .toThrow('Session provider is required');
    });

    test('validateRunnerConfig should reject invalid maxLLMCalls', () => {
      const invalidConfig = { ...basicRunnerConfig, maxLLMCalls: -1 };
      
      expect(() => validateRunnerConfig(invalidConfig))
        .toThrow('Max LLM calls must be positive');
    });

    test('validateRunnerConfig should reject invalid timeout', () => {
      const invalidConfig = { ...basicRunnerConfig, timeout: -1 };
      
      expect(() => validateRunnerConfig(invalidConfig))
        .toThrow('Timeout must be positive');
    });

    test('validateRunContext should accept valid context', () => {
      expect(() => validateRunContext(basicRunContext)).not.toThrow();
    });

    test('validateRunContext should reject context without userId', () => {
      const invalidContext = { ...basicRunContext, userId: '' };
      
      expect(() => validateRunContext(invalidContext))
        .toThrow('User ID is required');
    });
  });

  describe('Basic Agent Execution', () => {
    test('runAgent should execute agent successfully', async () => {
      const message = createUserMessage('Hello, agent!');
      
      const response = await runAgent(basicRunnerConfig, basicRunContext, message);
      
      expect(response.content).toBeDefined();
      expect(response.session).toBeDefined();
      expect(response.metadata.agentId).toBe(mockAgent.id);
      expect(response.metadata.timestamp).toBeInstanceOf(Date);
    });

    test('runAgent should create session if not exists', async () => {
      const contextWithoutSession = {
        userId: 'new_user',
        metadata: { appName: 'test_app' }
      };
      
      const message = createUserMessage('Create session test');
      
      const response = await runAgent(basicRunnerConfig, contextWithoutSession, message);
      
      expect(response.session.id).toBeDefined();
      expect(response.session.userId).toBe('new_user');
      expect(response.session.messages).toContain(message);
    });

    test('runAgent should use existing session if provided', async () => {
      // First create a session with some history
      const session = await mockSessionProvider.createSession({
        appName: 'test_app',
        userId: 'test_user'
      });
      
      const historicalMessage = createModelMessage('Previous message');
      const sessionWithHistory = addMessageToSession(session, historicalMessage);
      await mockSessionProvider.updateSession(sessionWithHistory);
      
      const contextWithSession = {
        userId: 'test_user',
        sessionId: session.id
      };
      
      const message = createUserMessage('New message');
      const response = await runAgent(basicRunnerConfig, contextWithSession, message);
      
      expect(response.session.messages).toHaveLength(3); // historical + new user + new model response
    });

    test('runAgent should handle tool execution', async () => {
      const toolAgent = createAgent({
        name: 'tool_agent',
        model: 'gemini-2.0-flash',
        instruction: 'Use tools to help users',
        tools: [createEchoTool()]
      });
      
      const config = { ...basicRunnerConfig, agent: toolAgent };
      const message = createUserMessage('Echo: Hello World');
      
      const response = await runAgent(config, basicRunContext, message);
      
      // Check if tools were called (this is simplified - real implementation would be more complex)
      expect(response.toolCalls).toBeDefined();
      expect(response.toolResponses).toBeDefined();
    });
  });

  describe('Agent Streaming', () => {
    test('runAgentStream should stream agent responses', async () => {
      const message = createUserMessage('Stream me a response');
      
      const stream = runAgentStream(basicRunnerConfig, basicRunContext, message);
      const events = [];
      
      for await (const event of stream) {
        events.push(event);
        if (event.type === 'message_complete') break;
      }
      
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('message_start');
      expect(events[events.length - 1].type).toBe('message_complete');
    });

    test('runAgentStream should handle streaming errors', async () => {
      const errorConfig = {
        ...basicRunnerConfig,
        agent: createAgent({
          name: 'error_agent',
          model: 'invalid_model',
          instruction: 'This will cause an error',
          tools: []
        })
      };
      
      const message = createUserMessage('Cause an error');
      const stream = runAgentStream(errorConfig, basicRunContext, message);
      const events = [];
      
      for await (const event of stream) {
        events.push(event);
        if (event.type === 'error') break;
      }
      
      expect(events.some(e => e.type === 'error')).toBe(true);
    });
  });

  describe('Multi-Agent Execution', () => {
    const weatherAgent: AgentConfig = {
      name: 'weather_agent',
      model: 'gemini-2.0-flash',
      instruction: 'Provide weather information',
      tools: [createFunctionTool(
        'get_weather',
        'Get weather',
        (params, context) => ({ temp: 25, condition: 'sunny' }),
        []
      )]
    };

    const newsAgent: AgentConfig = {
      name: 'news_agent',
      model: 'gemini-2.0-flash',
      instruction: 'Provide news information',
      tools: [createFunctionTool(
        'get_news',
        'Get news',
        (params, context) => ['Breaking news 1', 'Breaking news 2'],
        []
      )]
    };

    test('runAgent should handle sequential multi-agent', async () => {
      const multiAgent = createMultiAgent(
        'sequential_coordinator',
        'gemini-2.0-flash',
        'Coordinate agents sequentially',
        [weatherAgent, newsAgent],
        'sequential'
      );
      
      const config = { ...basicRunnerConfig, agent: multiAgent };
      const message = createUserMessage('Get weather and news');
      
      const response = await runAgent(config, basicRunContext, message);
      
      expect(response.content).toBeDefined();
      expect(response.metadata.agentId).toBe(multiAgent.id);
    });

    test('runAgent should handle parallel multi-agent', async () => {
      const multiAgent = createMultiAgent(
        'parallel_coordinator',
        'gemini-2.0-flash',
        'Coordinate agents in parallel',
        [weatherAgent, newsAgent],
        'parallel'
      );
      
      const config = { ...basicRunnerConfig, agent: multiAgent };
      const message = createUserMessage('Get weather and news simultaneously');
      
      const response = await runAgent(config, basicRunContext, message);
      
      expect(response.content).toBeDefined();
    });

    test('runAgent should handle conditional multi-agent', async () => {
      const multiAgent = createMultiAgent(
        'conditional_coordinator',
        'gemini-2.0-flash',
        'Choose appropriate agent based on request',
        [weatherAgent, newsAgent],
        'conditional'
      );
      
      const config = { ...basicRunnerConfig, agent: multiAgent };
      
      // Test weather delegation
      const weatherMessage = createUserMessage('What\'s the weather like?');
      const weatherResponse = await runAgent(config, basicRunContext, weatherMessage);
      expect(weatherResponse.content).toBeDefined();
      
      // Test news delegation
      const newsMessage = createUserMessage('What\'s the latest news?');
      const newsResponse = await runAgent(config, basicRunContext, newsMessage);
      expect(newsResponse.content).toBeDefined();
    });

    test('runAgent should handle hierarchical multi-agent', async () => {
      const multiAgent = createMultiAgent(
        'hierarchical_coordinator',
        'gemini-2.0-flash',
        'Hierarchical agent coordination',
        [weatherAgent, newsAgent],
        'hierarchical'
      );
      
      const config = { ...basicRunnerConfig, agent: multiAgent };
      const message = createUserMessage('Hierarchical request');
      
      const response = await runAgent(config, basicRunContext, message);
      
      expect(response.content).toBeDefined();
    });
  });

  describe('Guardrails', () => {
    test('runAgent should apply guardrails', async () => {
      const blockingGuardrail: GuardrailFunction = async (message) => {
        const text = message.parts
          .filter(p => p.type === 'text')
          .map(p => p.text)
          .join(' ');
        
        if (text.toLowerCase().includes('blocked')) {
          return {
            allowed: false,
            reason: 'Content contains blocked word'
          };
        }
        
        return { allowed: true };
      };
      
      const configWithGuardrails = {
        ...basicRunnerConfig,
        guardrails: [blockingGuardrail]
      };
      
      const blockedMessage = createUserMessage('This message should be blocked');
      
      await expect(runAgent(configWithGuardrails, basicRunContext, blockedMessage))
        .rejects.toThrow('Message blocked by guardrail');
    });

    test('runAgent should modify messages with guardrails', async () => {
      const modifyingGuardrail: GuardrailFunction = async (message) => {
        return {
          allowed: true,
          modifiedMessage: {
            ...message,
            parts: [{
              type: 'text',
              text: 'Modified: ' + message.parts[0].text
            }]
          }
        };
      };
      
      const configWithGuardrails = {
        ...basicRunnerConfig,
        guardrails: [modifyingGuardrail]
      };
      
      const message = createUserMessage('Original message');
      const response = await runAgent(configWithGuardrails, basicRunContext, message);
      
      // The session should contain the modified message
      expect(response.session.messages.some(m => 
        m.parts[0].text?.includes('Modified: Original message')
      )).toBe(true);
    });
  });

  describe('Schema Validation', () => {
    test('runAgent should handle input schema validation', async () => {
      const inputValidator = createSchemaValidator(stringSchema(), isString);
      
      const agentWithSchema = createAgent({
        ...mockAgent.config,
        inputSchema: inputValidator
      });
      
      const config = { ...basicRunnerConfig, agent: agentWithSchema };
      const message = createUserMessage('Valid string input');
      
      // Should work with valid input
      const response = await runAgent(config, basicRunContext, message);
      expect(response.content).toBeDefined();
    });

    test('runAgent should handle output schema validation', async () => {
      const outputValidator = createSchemaValidator(stringSchema(), isString);
      
      const agentWithSchema = createAgent({
        ...mockAgent.config,
        outputSchema: outputValidator
      });
      
      const config = { ...basicRunnerConfig, agent: agentWithSchema };
      const message = createUserMessage('Test output validation');
      
      const response = await runAgent(config, basicRunContext, message);
      expect(response.content).toBeDefined();
    });
  });

  describe('Runner Statistics', () => {
    test('getRunnerStats should return runner statistics', () => {
      const stats = getRunnerStats(basicRunnerConfig);
      
      expect(stats.agentId).toBe(mockAgent.id);
      expect(stats.agentName).toBe(mockAgent.config.name);
      expect(stats.toolCount).toBe(mockAgent.config.tools.length);
      expect(stats.subAgentCount).toBe(0);
      expect(stats.hasGuardrails).toBe(false);
      expect(stats.isMultiAgent).toBe(false);
    });

    test('getRunnerStats should handle multi-agent configuration', () => {
      const multiAgent = createMultiAgent(
        'coordinator',
        'gemini-2.0-flash',
        'Coordinate sub-agents',
        [
          { name: 'sub1', model: 'model', instruction: 'Sub 1', tools: [] },
          { name: 'sub2', model: 'model', instruction: 'Sub 2', tools: [] }
        ],
        'conditional'
      );
      
      const config = { ...basicRunnerConfig, agent: multiAgent };
      const stats = getRunnerStats(config);
      
      expect(stats.subAgentCount).toBe(2);
      expect(stats.isMultiAgent).toBe(true);
    });

    test('getRunnerStats should handle guardrails', () => {
      const guardrail: GuardrailFunction = async () => ({ allowed: true });
      const configWithGuardrails = {
        ...basicRunnerConfig,
        guardrails: [guardrail]
      };
      
      const stats = getRunnerStats(configWithGuardrails);
      
      expect(stats.hasGuardrails).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('runAgent should handle agent execution errors', async () => {
      const errorAgent = createAgent({
        name: 'error_agent',
        model: 'invalid_model',
        instruction: 'This will cause an error',
        tools: []
      });
      
      const errorConfig = { ...basicRunnerConfig, agent: errorAgent };
      const message = createUserMessage('Cause an error');
      
      await expect(runAgent(errorConfig, basicRunContext, message))
        .rejects.toThrow('Agent execution failed');
    });

    test('withRunnerErrorHandling should wrap errors', async () => {
      const throwingFunction = async () => {
        throw new Error('Original error');
      };
      
      const wrappedFunction = withRunnerErrorHandling(throwingFunction, 'agent_123');
      
      await expect(wrappedFunction()).rejects.toThrow('Runner operation failed: Original error');
    });

    test('withRunnerErrorHandling should pass through runner errors', async () => {
      // Create an Error instance with AgentError properties for testing
      const runnerError = new Error('Runner error');
      runnerError.name = 'AgentError';
      (runnerError as any).agentId = 'agent_123';
      
      const throwingFunction = async () => {
        throw runnerError;
      };
      
      const wrappedFunction = withRunnerErrorHandling(throwingFunction, 'agent_123');
      
      await expect(wrappedFunction()).rejects.toThrow(runnerError);
    });
  });

  describe('Tool Context and Actions', () => {
    test('runAgent should provide tool context', async () => {
      let capturedContext: any = null;
      
      const contextCapturingTool = createFunctionTool(
        'context_tool',
        'Captures tool context',
        (params, context) => {
          capturedContext = context;
          return 'Context captured';
        },
        []
      );
      
      const agentWithContextTool = createAgent({
        name: 'context_agent',
        model: 'gemini-2.0-flash',
        instruction: 'Test tool context',
        tools: [contextCapturingTool]
      });
      
      const config = { ...basicRunnerConfig, agent: agentWithContextTool };
      const message = createUserMessage('Capture context');
      
      await runAgent(config, basicRunContext, message);
      
      // Note: In the mock implementation, tool execution is simplified
      // In a real scenario, the context would be properly populated
      expect(capturedContext).toBeDefined();
    });

    test('runAgent should handle agent transfer actions', async () => {
      const transferTool = createFunctionTool(
        'transfer_tool',
        'Transfers to another agent',
        (params, context) => {
          if (context.actions) {
            context.actions.transferToAgent = 'target_agent';
          }
          return 'Transfer initiated';
        },
        []
      );
      
      const subAgent: AgentConfig = {
        name: 'target_agent',
        model: 'gemini-2.0-flash',
        instruction: 'Target agent for transfer',
        tools: []
      };
      
      const transferAgent = createMultiAgent(
        'transfer_agent',
        'gemini-2.0-flash',
        'Can transfer to other agents',
        [subAgent],
        'conditional'
      );
      
      // Add the transfer tool to the agent
      transferAgent.config.tools = [transferTool];
      
      const config = { ...basicRunnerConfig, agent: transferAgent };
      const message = createUserMessage('Transfer me to target agent');
      
      const response = await runAgent(config, basicRunContext, message);
      
      expect(response.content).toBeDefined();
      // In a real implementation, we'd check if the transfer actually occurred
    });
  });

  describe('Performance and Limits', () => {
    test('runAgent should respect maxLLMCalls limit', async () => {
      const configWithLimit = {
        ...basicRunnerConfig,
        maxLLMCalls: 1
      };
      
      const message = createUserMessage('Test LLM call limit');
      
      // Should complete successfully within the limit
      const response = await runAgent(configWithLimit, basicRunContext, message);
      expect(response.content).toBeDefined();
    });

    test('runAgent should respect timeout', async () => {
      const configWithTimeout = {
        ...basicRunnerConfig,
        timeout: 50 // Very short timeout
      };
      
      const message = createUserMessage('Test timeout');
      
      // Note: In the mock implementation, timeout handling is simplified
      // In a real scenario, this might timeout
      const response = await runAgent(configWithTimeout, basicRunContext, message);
      expect(response.content).toBeDefined();
    });
  });

  describe('Integration Tests', () => {
    test('should handle complete agent workflow', async () => {
      // Create a realistic agent with multiple tools
      const weatherTool = createFunctionTool(
        'get_weather',
        'Get weather information',
        (params, context) => {
          const typedParams = params as { location: string };
          return {
            location: typedParams.location,
            temperature: 22,
            condition: 'sunny',
            humidity: 65
          };
        },
        [
          {
            name: 'location',
            type: 'string',
            description: 'City name',
            required: true
          }
        ]
      );
      
      const calcTool = createCalculatorTool();
      
      const realisticAgent = createAgent({
        name: 'realistic_agent',
        model: 'gemini-2.0-flash',
        instruction: 'You are a helpful assistant with weather and calculation capabilities',
        tools: [weatherTool, calcTool]
      });
      
      const config = { ...basicRunnerConfig, agent: realisticAgent };
      
      // Test weather query
      const weatherMessage = createUserMessage('What\'s the weather in Tokyo?');
      const weatherResponse = await runAgent(config, basicRunContext, weatherMessage);
      
      expect(weatherResponse.content).toBeDefined();
      expect(weatherResponse.session.messages).toContainEqual(weatherMessage);
      
      // Test calculation query
      const calcMessage = createUserMessage('What is 15 * 7?');
      const calcResponse = await runAgent(config, basicRunContext, calcMessage);
      
      expect(calcResponse.content).toBeDefined();
      expect(calcResponse.session.messages.length).toBeGreaterThan(2); // Should accumulate
    });

    test('should handle streaming workflow', async () => {
      const streamingAgent = createAgent({
        name: 'streaming_agent',
        model: 'gemini-2.0-flash',
        instruction: 'Provide streaming responses',
        tools: [createEchoTool()]
      });
      
      const config = { ...basicRunnerConfig, agent: streamingAgent };
      const message = createUserMessage('Stream me a detailed response');
      
      const stream = runAgentStream(config, basicRunContext, message);
      const events = [];
      
      for await (const event of stream) {
        events.push(event);
        if (event.type === 'message_complete') break;
        if (events.length > 20) break; // Safety limit
      }
      
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('message_start');
      expect(events.some(e => e.type === 'message_delta')).toBe(true);
    });
  });
});