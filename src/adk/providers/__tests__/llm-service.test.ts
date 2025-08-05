/**
 * Tests for LLM Service Bridge
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { 
  createAdkLLMService, 
  createDefaultAdkLLMService,
  type AdkLLMServiceConfig 
} from '../llm-service.js';
import { 
  Agent, 
  Session, 
  Content, 
  ContentRole, 
  PartType, 
  Model 
} from '../../types.js';

// Mock the Core ModelProvider
jest.mock('../../../providers/model.js', () => ({
  makeLiteLLMProvider: jest.fn()
}));

// Mock the error handler
jest.mock('../error-handler.js', () => ({
  withLLMRetry: jest.fn((fn) => fn),
  withLLMTimeout: jest.fn((fn) => fn),
  classifyLLMError: jest.fn((error) => error),
  createLLMErrorLogger: jest.fn(() => ({
    logError: jest.fn()
  }))
}));

describe('LLM Service Bridge', () => {
  let mockModelProvider: any;
  let testAgent: Agent;
  let testSession: Session;
  let testMessage: Content;

  beforeEach(() => {
    // Create mock model provider
    mockModelProvider = {
      getCompletion: jest.fn()
    };

    // Mock the makeLiteLLMProvider to return our mock
    const { makeLiteLLMProvider } = require('../../../providers/model.js');
    (makeLiteLLMProvider as jest.Mock).mockReturnValue(mockModelProvider);

    // Create test data
    testAgent = {
      id: 'test-agent',
      config: {
        name: 'TestAgent',
        model: Model.GPT_4,
        instruction: 'You are a test agent',
        tools: [],
        subAgents: []
      },
      metadata: {
        created: new Date(),
        version: '1.0.0'
      }
    };

    testSession = {
      id: 'test-session',
      appName: 'test-app',
      userId: 'test-user',
      messages: [],
      artifacts: {},
      metadata: {
        created: new Date()
      }
    };

    testMessage = {
      role: ContentRole.USER,
      parts: [{
        type: PartType.TEXT,
        text: 'Hello, how are you?'
      }],
      metadata: {}
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createAdkLLMService', () => {
    it('should create LLM service with valid config', () => {
      const config: AdkLLMServiceConfig = {
        provider: 'litellm',
        baseUrl: 'http://localhost:4000',
        apiKey: 'test-key',
        defaultModel: 'gpt-4'
      };

      const service = createAdkLLMService(config);

      expect(service).toBeDefined();
      expect(typeof service.generateResponse).toBe('function');
      expect(typeof service.generateStreamingResponse).toBe('function');
    });

    it('should throw error for unknown provider', () => {
      const config: AdkLLMServiceConfig = {
        provider: 'unknown' as any,
        baseUrl: 'http://localhost:4000',
        apiKey: 'test-key'
      };

      expect(() => createAdkLLMService(config)).toThrow('Unsupported provider: unknown');
    });
  });

  describe('generateResponse', () => {
    it('should generate response from LLM', async () => {
      const config: AdkLLMServiceConfig = {
        provider: 'litellm',
        baseUrl: 'http://localhost:4000',
        apiKey: 'test-key',
        defaultModel: 'gpt-4'
      };

      // Mock successful LLM response
      mockModelProvider.getCompletion.mockResolvedValue({
        message: {
          content: 'Hello! How can I help you today?',
          tool_calls: null
        }
      });

      const service = createAdkLLMService(config);
      const response = await service.generateResponse(testAgent, testSession, testMessage);

      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.content.role).toBe(ContentRole.MODEL);
      expect(response.content.parts).toHaveLength(1);
      expect(response.content.parts[0].type).toBe(PartType.TEXT);
      expect(response.content.parts[0].text).toBe('Hello! How can I help you today?');
      expect(response.functionCalls).toEqual([]);
      expect(response.metadata.model).toBe('gpt-4');
    });

    it('should handle LLM response with function calls', async () => {
      const config: AdkLLMServiceConfig = {
        provider: 'litellm',
        baseUrl: 'http://localhost:4000',
        apiKey: 'test-key',
        defaultModel: 'gpt-4'
      };

      // Mock LLM response with function calls
      mockModelProvider.getCompletion.mockResolvedValue({
        message: {
          content: 'I need to check the weather for you.',
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"location": "New York"}'
            }
          }]
        }
      });

      const service = createAdkLLMService(config);
      const response = await service.generateResponse(testAgent, testSession, testMessage);

      expect(response.content.parts).toHaveLength(2); // Text + function call
      expect(response.content.parts[0].type).toBe(PartType.TEXT);
      expect(response.content.parts[1].type).toBe(PartType.FUNCTION_CALL);
      expect(response.functionCalls).toHaveLength(1);
      expect(response.functionCalls[0].name).toBe('get_weather');
      expect(response.functionCalls[0].args).toEqual({ location: 'New York' });
    });

    it('should handle model override', async () => {
      const config: AdkLLMServiceConfig = {
        provider: 'litellm',
        baseUrl: 'http://localhost:4000',
        apiKey: 'test-key',
        defaultModel: 'gpt-4'
      };

      mockModelProvider.getCompletion.mockResolvedValue({
        message: {
          content: 'Response from Claude',
          tool_calls: null
        }
      });

      const service = createAdkLLMService(config);
      const response = await service.generateResponse(
        testAgent, 
        testSession, 
        testMessage, 
        { modelOverride: 'claude-3-sonnet' }
      );

      expect(response.metadata.model).toBe('claude-3-sonnet');
    });

    it('should handle LLM errors gracefully', async () => {
      const config: AdkLLMServiceConfig = {
        provider: 'litellm',
        baseUrl: 'http://localhost:4000',
        apiKey: 'test-key',
        defaultModel: 'gpt-4'
      };

      // Mock LLM error
      mockModelProvider.getCompletion.mockRejectedValue(new Error('API rate limit exceeded'));

      const service = createAdkLLMService(config);

      await expect(service.generateResponse(testAgent, testSession, testMessage))
        .rejects.toThrow('API rate limit exceeded');
    });
  });

  describe('generateStreamingResponse', () => {
    it('should generate streaming response', async () => {
      const config: AdkLLMServiceConfig = {
        provider: 'litellm',
        baseUrl: 'http://localhost:4000',
        apiKey: 'test-key',
        defaultModel: 'gpt-4'
      };

      // Mock successful LLM response for streaming simulation
      mockModelProvider.getCompletion.mockResolvedValue({
        message: {
          content: 'Hello there!',
          tool_calls: null
        }
      });

      const service = createAdkLLMService(config);
      const streamGenerator = service.generateStreamingResponse(testAgent, testSession, testMessage);

      const chunks = [];
      for await (const chunk of streamGenerator) {
        chunks.push(chunk);
        if (chunk.isDone) break;
      }

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[chunks.length - 1].isDone).toBe(true);
      
      // Combine all delta chunks
      const combinedText = chunks
        .filter(c => !c.isDone)
        .map(c => c.delta)
        .join('');
      
      expect(combinedText).toBe('Hello there!');
    });

    it('should handle streaming errors', async () => {
      const config: AdkLLMServiceConfig = {
        provider: 'litellm',
        baseUrl: 'http://localhost:4000',
        apiKey: 'test-key',
        defaultModel: 'gpt-4'
      };

      // Mock LLM error
      mockModelProvider.getCompletion.mockRejectedValue(new Error('Connection timeout'));

      const service = createAdkLLMService(config);
      const streamGenerator = service.generateStreamingResponse(testAgent, testSession, testMessage);

      await expect(async () => {
        for await (const chunk of streamGenerator) {
          // Should throw error before yielding chunks
        }
      }).rejects.toThrow('Connection timeout');
    });
  });

  describe('createDefaultAdkLLMService', () => {
    it('should create default service with environment config', () => {
      // Mock environment variables
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        LITELLM_URL: 'http://test:4000',
        LITELLM_API_KEY: 'test-key',
        LITELLM_MODEL: 'gpt-3.5-turbo'
      };

      const service = createDefaultAdkLLMService();

      expect(service).toBeDefined();
      expect(typeof service.generateResponse).toBe('function');
      expect(typeof service.generateStreamingResponse).toBe('function');

      // Restore environment
      process.env = originalEnv;
    });
  });

  describe('Provider Support', () => {
    it('should support OpenAI provider', () => {
      const config: AdkLLMServiceConfig = {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-key',
        defaultModel: 'gpt-4'
      };

      expect(() => createAdkLLMService(config)).not.toThrow();
    });

    it('should support Anthropic provider', () => {
      const config: AdkLLMServiceConfig = {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-test-key',
        defaultModel: 'claude-3-sonnet'
      };

      expect(() => createAdkLLMService(config)).not.toThrow();
    });

    it('should support Google provider', () => {
      const config: AdkLLMServiceConfig = {
        provider: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'google-test-key',
        defaultModel: 'gemini-1.5-pro'
      };

      expect(() => createAdkLLMService(config)).not.toThrow();
    });
  });
});