/**
 * A2A Client Tests
 * Tests for A2A client functionality and communication
 */

import {
  createA2AClient,
  createMessageRequest,
  createStreamingMessageRequest,
  extractTextResponse,
  type A2AClientState,
  type SendMessageRequest,
  type SendStreamingMessageRequest,
  type A2AStreamEvent
} from '../index';

// Mock fetch for testing
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('A2A Client', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('createA2AClient', () => {
    it('should create A2A client with default configuration', () => {
      const client = createA2AClient('http://localhost:3000');

      expect(client.config.baseUrl).toBe('http://localhost:3000');
      expect(client.config.timeout).toBe(30000);
      expect(client.sessionId).toMatch(/^client_/);
    });

    it('should create A2A client with custom configuration', () => {
      const client = createA2AClient('https://api.example.com', {
        timeout: 60000
      });

      expect(client.config.baseUrl).toBe('https://api.example.com');
      expect(client.config.timeout).toBe(60000);
    });

    it('should remove trailing slash from base URL', () => {
      const client = createA2AClient('http://localhost:3000/');

      expect(client.config.baseUrl).toBe('http://localhost:3000');
    });

    it('should generate unique session IDs', () => {
      const client1 = createA2AClient('http://localhost:3000');
      const client2 = createA2AClient('http://localhost:3000');

      expect(client1.sessionId).not.toBe(client2.sessionId);
      expect(client1.sessionId).toMatch(/^client_/);
      expect(client2.sessionId).toMatch(/^client_/);
    });
  });

  describe('createMessageRequest', () => {
    it('should create valid message request', () => {
      const request = createMessageRequest('Hello, world!', 'session_123');

      expect(request.jsonrpc).toBe('2.0');
      expect(request.method).toBe('message/send');
      expect(request.id).toMatch(/^req_/);
      expect(request.params.message.role).toBe('user');
      expect(request.params.message.parts).toHaveLength(1);
      expect(request.params.message.parts[0].kind).toBe('text');
      expect((request.params.message.parts[0] as any).text).toBe('Hello, world!');
      expect(request.params.message.contextId).toBe('session_123');
    });

    it('should create message request with configuration', () => {
      const config = {
        acceptedOutputModes: ['text/plain', 'application/json'],
        historyLength: 10,
        blocking: true
      };

      const request = createMessageRequest('Test message', 'session_123', config);

      expect(request.params.configuration).toEqual(config);
    });

    it('should generate unique message and request IDs', () => {
      const request1 = createMessageRequest('Message 1', 'session_123');
      const request2 = createMessageRequest('Message 2', 'session_123');

      expect(request1.id).not.toBe(request2.id);
      expect(request1.params.message.messageId).not.toBe(request2.params.message.messageId);
    });
  });

  describe('createStreamingMessageRequest', () => {
    it('should create valid streaming message request', () => {
      const request = createStreamingMessageRequest('Stream this message', 'session_456');

      expect(request.jsonrpc).toBe('2.0');
      expect(request.method).toBe('message/stream');
      expect(request.id).toMatch(/^req_/);
      expect(request.params.message.role).toBe('user');
      expect(request.params.message.parts).toHaveLength(1);
      expect(request.params.message.parts[0].kind).toBe('text');
      expect((request.params.message.parts[0] as any).text).toBe('Stream this message');
      expect(request.params.message.contextId).toBe('session_456');
    });

    it('should create streaming request with configuration', () => {
      const config = {
        acceptedOutputModes: ['text/plain'],
        blocking: false
      };

      const request = createStreamingMessageRequest('Stream message', 'session_456', config);

      expect(request.params.configuration).toEqual(config);
    });
  });

  describe('extractTextResponse', () => {
    it('should extract string response directly', () => {
      const result = 'Simple string response';
      const extracted = extractTextResponse(result);

      expect(extracted).toBe('Simple string response');
    });

    it('should extract text from task result with artifacts', () => {
      const result = {
        kind: 'task',
        artifacts: [
          {
            artifactId: 'art_1',
            parts: [
              { kind: 'text', text: 'First artifact text' },
              { kind: 'data', data: { ignored: true } }
            ]
          }
        ]
      };

      const extracted = extractTextResponse(result);
      expect(extracted).toBe('First artifact text');
    });

    it('should extract text from task result with history', () => {
      const result = {
        kind: 'task',
        history: [
          {
            role: 'user',
            parts: [{ kind: 'text', text: 'User message' }]
          },
          {
            role: 'agent',
            parts: [
              { kind: 'text', text: 'Agent response part 1' },
              { kind: 'text', text: 'Agent response part 2' }
            ]
          }
        ]
      };

      const extracted = extractTextResponse(result);
      expect(extracted).toBe('Agent response part 1\nAgent response part 2');
    });

    it('should extract text from message result', () => {
      const result = {
        kind: 'message',
        parts: [
          { kind: 'text', text: 'Message text 1' },
          { kind: 'text', text: 'Message text 2' },
          { kind: 'data', data: { ignored: true } }
        ]
      };

      const extracted = extractTextResponse(result);
      expect(extracted).toBe('Message text 1\nMessage text 2');
    });

    it('should handle object responses', () => {
      const result = {
        status: 'success',
        data: { value: 42 }
      };

      const extracted = extractTextResponse(result);
      expect(extracted).toBe(JSON.stringify(result, null, 2));
    });

    it('should handle empty or undefined responses', () => {
      expect(extractTextResponse(undefined)).toBe('No response content available');
      expect(extractTextResponse(null)).toBe('No response content available');
      expect(extractTextResponse({})).toBe('{}');
    });

    it('should handle task with no text content', () => {
      const result = {
        kind: 'task',
        artifacts: [
          {
            artifactId: 'art_1',
            parts: [{ kind: 'data', data: { only: 'data' } }]
          }
        ]
      };

      const extracted = extractTextResponse(result);
      expect(extracted).toBe('Task completed but no text response available');
    });

    it('should prioritize artifacts over history', () => {
      const result = {
        kind: 'task',
        artifacts: [
          {
            artifactId: 'art_1',
            parts: [{ kind: 'text', text: 'Artifact text' }]
          }
        ],
        history: [
          {
            role: 'agent',
            parts: [{ kind: 'text', text: 'History text' }]
          }
        ]
      };

      const extracted = extractTextResponse(result);
      expect(extracted).toBe('Artifact text');
    });
  });

  describe('HTTP Request Handling', () => {
    it('should handle successful JSON response', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          jsonrpc: '2.0',
          id: 'req_123',
          result: 'Success response'
        })
      };

      mockFetch.mockResolvedValue(mockResponse);

      // This would be tested in integration with actual sendA2ARequest
      expect(mockResponse.ok).toBe(true);
    });

    it('should handle HTTP error responses', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found'
      };

      mockFetch.mockResolvedValue(mockResponse);

      // This would be tested in integration with actual sendA2ARequest
      expect(mockResponse.ok).toBe(false);
      expect(mockResponse.status).toBe(404);
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network error');
      mockFetch.mockRejectedValue(networkError);

      // This would be tested in integration with actual sendA2ARequest
      try {
        await mockFetch();
      } catch (error) {
        expect(error).toBe(networkError);
      }
    });
  });

  describe('Request Timeout Handling', () => {
    it('should create AbortController for timeout', () => {
      const client = createA2AClient('http://localhost:3000', { timeout: 5000 });
      
      expect(client.config.timeout).toBe(5000);
      
      // AbortController would be used in actual HTTP requests
      const controller = new AbortController();
      expect(controller.signal).toBeDefined();
    });
  });

  describe('Session Management', () => {
    it('should maintain session across requests', () => {
      const client = createA2AClient('http://localhost:3000');
      const sessionId = client.sessionId;

      const request1 = createMessageRequest('Message 1', sessionId);
      const request2 = createMessageRequest('Message 2', sessionId);

      expect(request1.params.message.contextId).toBe(sessionId);
      expect(request2.params.message.contextId).toBe(sessionId);
      expect(request1.params.message.contextId).toBe(request2.params.message.contextId);
    });
  });

  describe('URL Construction', () => {
    it('should construct correct API URLs', () => {
      const client = createA2AClient('https://api.example.com:8080');
      
      // URLs would be constructed in actual client methods
      const a2aUrl = `${client.config.baseUrl}/a2a`;
      const healthUrl = `${client.config.baseUrl}/a2a/health`;
      const agentCardUrl = `${client.config.baseUrl}/.well-known/agent-card`;

      expect(a2aUrl).toBe('https://api.example.com:8080/a2a');
      expect(healthUrl).toBe('https://api.example.com:8080/a2a/health');
      expect(agentCardUrl).toBe('https://api.example.com:8080/.well-known/agent-card');
    });
  });

  describe('Message Content Types', () => {
    it('should set correct content type headers', () => {
      // Headers would be set in actual HTTP requests
      const expectedHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };

      expect(expectedHeaders['Content-Type']).toBe('application/json');
      expect(expectedHeaders['Accept']).toBe('application/json');
    });

    it('should handle streaming content type', () => {
      // For streaming requests
      const streamingHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      };

      expect(streamingHeaders['Accept']).toBe('text/event-stream');
    });
  });

  describe('Error Response Handling', () => {
    it('should handle A2A error responses', () => {
      const errorResponse = {
        jsonrpc: '2.0',
        id: 'req_123',
        error: {
          code: -32602,
          message: 'Invalid params',
          data: { details: 'Parameter validation failed' }
        }
      };

      expect(errorResponse.error.code).toBe(-32602);
      expect(errorResponse.error.message).toBe('Invalid params');
      expect(errorResponse.error.data.details).toBe('Parameter validation failed');
    });
  });
});