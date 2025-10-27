/**
 * A2A Integration Tests
 * End-to-end tests for A2A protocol implementation
 */

import { z } from 'zod';
import {
  createA2AAgent,
  createA2ATool,
  createA2AServer,
  createA2AClient,
  routeA2ARequest,
  handleMessageSend,
  generateAgentCard,
  validateJSONRPCRequest,
  validateSendMessageRequest,
  createSimpleA2ATaskProvider,
  type A2AServerConfig,
  type SendMessageRequest,
  type JSONRPCRequest,
  type A2ATaskProvider
} from '../index.js';

describe('A2A Integration', () => {
  // Mock model provider for integration tests
  const mockModelProvider = {
    async getCompletion(params: any) {
      // Simple echo-like behavior for testing
      const lastMessage = params.messages?.[params.messages.length - 1];
      const userContent = lastMessage?.content || 'Default response';
      
      return {
        message: {
          content: `Echo: ${userContent}`
        }
      };
    }
  };

  // Create test tools
  const calculatorTool = createA2ATool({
    name: 'calculator',
    description: 'Perform basic math operations',
    parameters: z.object({
      operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
      a: z.number(),
      b: z.number()
    }),
    execute: async ({ operation, a, b }) => {
      switch (operation) {
        case 'add': return a + b;
        case 'subtract': return a - b;
        case 'multiply': return a * b;
        case 'divide': return b !== 0 ? a / b : 'Error: Division by zero';
        default: return 'Error: Invalid operation';
      }
    }
  });

  const weatherTool = createA2ATool({
    name: 'get_weather',
    description: 'Get weather information for a location',
    parameters: z.object({
      location: z.string(),
      units: z.enum(['celsius', 'fahrenheit']).default('celsius')
    }),
    execute: async ({ location, units }) => {
      // Mock weather data
      const temp = units === 'celsius' ? '22°C' : '72°F';
      return `Weather in ${location}: ${temp}, sunny with light clouds`;
    }
  });

  // Create test agents
  const mathAgent = createA2AAgent({
    name: 'MathAgent',
    description: 'Mathematics and calculation assistant',
    instruction: 'You help users with mathematical calculations using the calculator tool.',
    tools: [calculatorTool]
  });

  const weatherAgent = createA2AAgent({
    name: 'WeatherAgent',
    description: 'Weather information assistant',
    instruction: 'You provide weather information for any location using the weather tool.',
    tools: [weatherTool]
  });

  const multiAgent = createA2AAgent({
    name: 'MultiAgent',
    description: 'Multi-purpose assistant',
    instruction: 'You can help with math calculations and weather information.',
    tools: [calculatorTool, weatherTool]
  });

  describe('Agent Card Generation', () => {
    it('should generate valid agent card for single agent', () => {
      const agents = new Map([['math', mathAgent]]);
      const config = {
        name: 'Math Service',
        description: 'Mathematical calculation service',
        version: '1.0.0',
        provider: {
          organization: 'Test Org',
          url: 'https://test.org'
        }
      };

      const agentCard = generateAgentCard(config, agents, 'http://localhost:3000');

      expect(agentCard.protocolVersion).toBe('0.3.0');
      expect(agentCard.name).toBe('Math Service');
      expect(agentCard.url).toBe('http://localhost:3000/a2a');
      expect(agentCard.skills).toHaveLength(2); // 1 main + 1 tool skill
      expect(agentCard.skills.find(s => s.id === 'math-main')).toBeDefined();
      expect(agentCard.skills.find(s => s.id === 'math-calculator')).toBeDefined();
      expect(agentCard.skills.find(s => s.name === 'calculator')).toBeDefined();
    });

    it('should generate agent card with multiple agents and skills', () => {
      const agents = new Map([
        ['math', mathAgent],
        ['weather', weatherAgent]
      ]);
      const config = {
        name: 'Multi Service',
        description: 'Math and weather service',
        version: '2.0.0',
        provider: {
          organization: 'Test Org',
          url: 'https://test.org'
        }
      };

      const agentCard = generateAgentCard(config, agents, 'https://api.example.com');

      expect(agentCard.skills).toHaveLength(4); // 2 main + 2 tool skills
      expect(agentCard.skills.find(s => s.id === 'math-main')).toBeDefined();
      expect(agentCard.skills.find(s => s.id === 'math-calculator')).toBeDefined();
      expect(agentCard.skills.find(s => s.id === 'weather-main')).toBeDefined();
      expect(agentCard.skills.find(s => s.id === 'weather-get_weather')).toBeDefined();
      expect(agentCard.url).toBe('https://api.example.com/a2a');
    });
  });

  describe('Server Configuration', () => {
    it('should create server with multiple agents', async () => {
      const serverConfig: A2AServerConfig = {
        agents: new Map([
          ['math', mathAgent],
          ['weather', weatherAgent]
        ]),
        agentCard: {
          name: 'Test Server',
          description: 'Test A2A server',
          version: '1.0.0',
          provider: {
            organization: 'Test Org',
            url: 'https://test.org'
          }
        },
        port: 3001,
        host: 'localhost'
      };

      const server = await createA2AServer(serverConfig);

      expect(server.config.agents.size).toBe(2);
      expect(server.config.agents.has('math')).toBe(true);
      expect(server.config.agents.has('weather')).toBe(true);
      expect(server.config.agentCard.skills.length).toBe(4); // 2 main + 2 tool skills
    });
  });

  describe('Protocol Request Handling', () => {
    let taskProvider: A2ATaskProvider;
    const agentCard = {
      protocolVersion: '0.3.0',
      name: 'Test Agent',
      description: 'Test agent',
      url: 'http://localhost:3000/a2a',
      version: '1.0.0'
    };

    beforeAll(async () => {
      taskProvider = await createSimpleA2ATaskProvider('memory');
    });

    it('should handle valid message/send request', async () => {
      const request: SendMessageRequest = {
        jsonrpc: '2.0',
        id: 'test_123',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'Calculate 5 + 3' }],
            messageId: 'msg_123',
            kind: 'message'
          }
        }
      };

      const response = await handleMessageSend(request, mathAgent, mockModelProvider);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test_123');
      expect('result' in response).toBe(true);
      expect('error' in response).toBe(false);
    });

    it('should route requests to appropriate handlers', async () => {
      const messageRequest: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 'test_456',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'What is the weather?' }],
            messageId: 'msg_456',
            kind: 'message'
          }
        }
      };

      const result = routeA2ARequest(messageRequest, weatherAgent, mockModelProvider, taskProvider, agentCard);
      expect(result).toBeInstanceOf(Promise);

      const response = await result as any;
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test_456');
    });

    it('should handle streaming requests', async () => {
      const streamRequest: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 'stream_123',
        method: 'message/stream',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'Stream this calculation' }],
            messageId: 'msg_stream',
            kind: 'message'
          }
        }
      };

      const result = routeA2ARequest(streamRequest, mathAgent, mockModelProvider, taskProvider, agentCard);
      expect(result).not.toBeInstanceOf(Promise);

      const generator = result as AsyncGenerator<any>;
      const events = [];
      for await (const event of generator) {
        events.push(event);
        // Limit iterations to prevent infinite loop in tests
        if (events.length > 10) break;
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1].jsonrpc).toBe('2.0');
    });
  });

  describe('Client-Server Communication', () => {
    it('should create compatible client and server configurations', async () => {
      const client = createA2AClient('http://localhost:3000');
      
      const serverConfig: A2AServerConfig = {
        agents: new Map([['test', mathAgent]]),
        agentCard: {
          name: 'Math Server',
          description: 'Math calculations',
          version: '1.0.0',
          provider: {
            organization: 'Test',
            url: 'https://test.com'
          }
        },
        port: 3000,
        host: 'localhost'
      };

      const server = await createA2AServer(serverConfig);

      expect(client.config.baseUrl).toBe('http://localhost:3000');
      expect(server.config.port).toBe(3000);
      expect(server.config.host).toBe('localhost');
    });
  });

  describe('Request Validation', () => {
    it('should validate complete request pipeline', () => {
      // Test JSON-RPC validation
      const validRequest = {
        jsonrpc: '2.0' as const,
        id: 'test_789',
        method: 'message/send',
        params: {
          message: {
            role: 'user' as const,
            parts: [{ kind: 'text' as const, text: 'Test message' }],
            messageId: 'msg_789',
            kind: 'message' as const
          }
        }
      };

      expect(validateJSONRPCRequest(validRequest)).toBe(true);

      // Test A2A message validation
      const messageValidation = validateSendMessageRequest(validRequest);
      expect(messageValidation.isValid).toBe(true);
      expect(messageValidation.data).toBeDefined();
    });

    it('should reject invalid requests at each validation level', () => {
      // Invalid JSON-RPC
      const invalidJsonRpc = {
        jsonrpc: '1.0', // Wrong version
        id: 'test',
        method: 'test'
      };

      expect(validateJSONRPCRequest(invalidJsonRpc)).toBe(false);

      // Invalid A2A message
      const invalidA2AMessage = {
        jsonrpc: '2.0' as const,
        id: 'test',
        method: 'message/send',
        params: {
          message: {
            role: 'invalid_role',
            parts: [],
            messageId: 'msg'
          }
        }
      };

      const validation = validateSendMessageRequest(invalidA2AMessage as any);
      expect(validation.isValid).toBe(false);
      expect(validation.error).toBeDefined();
    });
  });

  describe('Tool Integration', () => {
    it('should handle agent with multiple tools', () => {
      expect(multiAgent.tools).toHaveLength(2);
      expect(multiAgent.tools.find(t => t.name === 'calculator')).toBeDefined();
      expect(multiAgent.tools.find(t => t.name === 'get_weather')).toBeDefined();
    });

    it('should execute tools with proper parameters', async () => {
      // Test calculator tool
      const calcResult = await calculatorTool.execute({
        operation: 'multiply',
        a: 7,
        b: 8
      });
      expect(calcResult).toBe(56);

      // Test weather tool
      const weatherResult = await weatherTool.execute({
        location: 'London',
        units: 'celsius'
      });
      expect(weatherResult).toContain('London');
      expect(weatherResult).toContain('22°C');
    });
  });

  describe('Content Type Support', () => {
    it('should handle default content types', () => {
      const agent = createA2AAgent({
        name: 'DefaultAgent',
        description: 'Default content types',
        instruction: 'Handle standard content',
        tools: []
      });

      expect(agent.supportedContentTypes).toEqual(['text/plain', 'application/json']);
    });

    it('should handle custom content types', () => {
      const mediaAgent = createA2AAgent({
        name: 'MediaAgent',
        description: 'Media processing',
        instruction: 'Process media files',
        tools: [],
        supportedContentTypes: ['image/jpeg', 'image/png', 'video/mp4']
      });

      expect(mediaAgent.supportedContentTypes).toEqual(['image/jpeg', 'image/png', 'video/mp4']);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle tool execution errors gracefully', async () => {
      const errorTool = createA2ATool({
        name: 'error_tool',
        description: 'Tool that throws errors',
        parameters: z.object({
          shouldError: z.boolean()
        }),
        execute: async ({ shouldError }) => {
          if (shouldError) {
            throw new Error('Tool execution failed');
          }
          return 'Success';
        }
      });

      // Should not throw when shouldError is false
      const successResult = await errorTool.execute({ shouldError: false });
      expect(successResult).toBe('Success');

      // Should throw when shouldError is true
      await expect(errorTool.execute({ shouldError: true })).rejects.toThrow('Tool execution failed');
    });
  });

  describe('Protocol Compliance', () => {
    it('should maintain A2A protocol version consistency', () => {
      const agents = new Map([['test', mathAgent]]);
      const config = {
        name: 'Test Service',
        description: 'Test service',
        version: '1.0.0',
        provider: {
          organization: 'Test',
          url: 'https://test.com'
        }
      };

      const agentCard = generateAgentCard(config, agents);
      expect(agentCard.protocolVersion).toBe('0.3.0');
    });

    it('should use correct transport protocol', () => {
      const agents = new Map([['test', mathAgent]]);
      const config = {
        name: 'Test Service',
        description: 'Test service',
        version: '1.0.0',
        provider: {
          organization: 'Test',
          url: 'https://test.com'
        }
      };

      const agentCard = generateAgentCard(config, agents);
      expect(agentCard.preferredTransport).toBe('JSONRPC');
    });
  });
});