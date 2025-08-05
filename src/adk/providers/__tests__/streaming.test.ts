/**
 * Tests for real LLM streaming implementation
 */

import { createAdkLLMService } from '../llm-service.js';
import { createAgent, createUserMessage } from '../../index.js';
import { createInMemorySessionProvider } from '../../sessions/index.js';

describe('Real LLM Streaming', () => {
  // Skip tests if no API key is available
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const hasLiteLLMUrl = !!process.env.LITELLM_URL;
  
  const describeIfKey = hasOpenAIKey ? describe : describe.skip;
  const describeIfLiteLLM = hasLiteLLMUrl ? describe : describe.skip;

  describeIfKey('OpenAI Streaming', () => {
    it('should stream responses character by character from OpenAI', async () => {
      const service = createAdkLLMService({
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY
      });

      const agent = createAgent({
        name: 'test-agent',
        model: 'gpt-3.5-turbo',
        instruction: 'You are a helpful assistant. Keep responses brief.',
        tools: []
      });

      const sessionProvider = createInMemorySessionProvider();
      const session = await sessionProvider.createSession({
        appName: 'test',
        userId: 'test-user'
      });

      const message = createUserMessage('Say "Hello streaming!" word by word.');
      
      const chunks: string[] = [];
      const stream = service.generateStreamingResponse(agent, session, message);
      
      for await (const chunk of stream) {
        if (chunk.delta) {
          chunks.push(chunk.delta);
        }
        
        if (chunk.isDone) {
          break;
        }
      }
      
      const fullResponse = chunks.join('');
      expect(fullResponse).toContain('Hello');
      expect(fullResponse).toContain('streaming');
      expect(chunks.length).toBeGreaterThan(5); // Should have multiple chunks
    }, 30000);

    it('should stream function calls from OpenAI', async () => {
      const service = createAdkLLMService({
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY
      });

      const agent = createAgent({
        name: 'test-agent',
        model: 'gpt-3.5-turbo',
        instruction: 'You are a helpful assistant. Use the calculator for math.',
        tools: [{
          name: 'calculator',
          description: 'Performs calculations',
          parameters: [{
            name: 'expression',
            type: 'string',
            description: 'The math expression to evaluate'
          }],
          execute: async (params) => ({ success: true, data: eval(params.expression) })
        }]
      });

      const sessionProvider = createInMemorySessionProvider();
      const session = await sessionProvider.createSession({
        appName: 'test',
        userId: 'test-user'
      });

      const message = createUserMessage('What is 42 plus 58?');
      
      let functionCall: any = null;
      const stream = service.generateStreamingResponse(agent, session, message);
      
      for await (const chunk of stream) {
        if (chunk.functionCall) {
          functionCall = chunk.functionCall;
        }
        
        if (chunk.isDone) {
          break;
        }
      }
      
      expect(functionCall).toBeTruthy();
      expect(functionCall.name).toBe('calculator');
      expect(functionCall.args.expression).toMatch(/42.*58|58.*42/);
    }, 30000);
  });

  describeIfLiteLLM('LiteLLM Streaming', () => {
    it('should stream responses via LiteLLM proxy', async () => {
      const service = createAdkLLMService({
        provider: 'litellm',
        baseUrl: process.env.LITELLM_URL,
        apiKey: process.env.LITELLM_API_KEY || 'test'
      });

      const agent = createAgent({
        name: 'test-agent',
        model: 'gpt-3.5-turbo',
        instruction: 'You are a helpful assistant. Keep responses brief.',
        tools: []
      });

      const sessionProvider = createInMemorySessionProvider();
      const session = await sessionProvider.createSession({
        appName: 'test',
        userId: 'test-user'
      });

      const message = createUserMessage('Count from 1 to 5.');
      
      const chunks: string[] = [];
      const stream = service.generateStreamingResponse(agent, session, message);
      
      for await (const chunk of stream) {
        if (chunk.delta) {
          chunks.push(chunk.delta);
        }
        
        if (chunk.isDone) {
          break;
        }
      }
      
      const fullResponse = chunks.join('');
      expect(fullResponse).toMatch(/1.*2.*3.*4.*5/);
      expect(chunks.length).toBeGreaterThan(3); // Should have multiple chunks
    }, 30000);
  });

  describe('Streaming Error Handling', () => {
    it('should handle streaming errors gracefully', async () => {
      const service = createAdkLLMService({
        provider: 'openai',
        apiKey: 'invalid-key'
      });

      const agent = createAgent({
        name: 'test-agent',
        model: 'gpt-3.5-turbo',
        instruction: 'Test',
        tools: []
      });

      const sessionProvider = createInMemorySessionProvider();
      const session = await sessionProvider.createSession({
        appName: 'test',
        userId: 'test-user'
      });

      const message = createUserMessage('Test');
      const stream = service.generateStreamingResponse(agent, session, message);
      
      await expect(async () => {
        for await (const chunk of stream) {
          // Should throw before yielding any chunks
        }
      }).rejects.toThrow();
    });
  });
});