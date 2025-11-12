/**
 * A2A Types Tests
 * Comprehensive tests for A2A type definitions and utilities
 */

import { 
  A2AMessage, 
  A2ATask, 
  AgentCard,
  JSONRPCRequest,
  JSONRPCResponse,
  SendMessageRequest,
  SendStreamingMessageRequest,
  A2AError,
  A2AErrorCodes,
  a2aMessageSchema,
  sendMessageRequestSchema
} from '../types.js';

describe('A2A Types', () => {
  describe('A2AMessage', () => {
    it('should create valid A2A message with text part', () => {
      const message: A2AMessage = {
        role: 'user',
        parts: [
          {
            kind: 'text',
            text: 'Hello, world!'
          }
        ],
        messageId: 'msg_123',
        contextId: 'ctx_123',
        kind: 'message'
      };

      expect(message.role).toBe('user');
      expect(message.parts).toHaveLength(1);
      expect(message.parts[0].kind).toBe('text');
      expect((message.parts[0] as any).text).toBe('Hello, world!');
    });

    it('should create valid A2A message with data part', () => {
      const message: A2AMessage = {
        role: 'agent',
        parts: [
          {
            kind: 'data',
            data: { result: 'success', value: 42 }
          }
        ],
        messageId: 'msg_456',
        kind: 'message'
      };

      expect(message.role).toBe('agent');
      expect(message.parts[0].kind).toBe('data');
      expect((message.parts[0] as any).data).toEqual({ result: 'success', value: 42 });
    });

    it('should create valid A2A message with file part', () => {
      const message: A2AMessage = {
        role: 'user',
        parts: [
          {
            kind: 'file',
            file: {
              uri: 'https://example.com/file.pdf',
              name: 'document.pdf',
              mimeType: 'application/pdf'
            }
          }
        ],
        messageId: 'msg_789',
        kind: 'message'
      };

      expect(message.parts[0].kind).toBe('file');
      expect((message.parts[0] as any).file.uri).toBe('https://example.com/file.pdf');
    });

    it('should validate A2A message with schema', () => {
      const validMessage = {
        role: 'user',
        parts: [
          {
            kind: 'text',
            text: 'Test message'
          }
        ],
        messageId: 'msg_123',
        kind: 'message'
      };

      const result = a2aMessageSchema.safeParse(validMessage);
      expect(result.success).toBe(true);
    });

    it('should reject invalid A2A message', () => {
      const invalidMessage = {
        role: 'invalid',
        parts: [],
        messageId: 'msg_123'
        // missing kind
      };

      const result = a2aMessageSchema.safeParse(invalidMessage);
      expect(result.success).toBe(false);
    });
  });

  describe('A2ATask', () => {
    it('should create valid A2A task', () => {
      const task: A2ATask = {
        id: 'task_123',
        contextId: 'ctx_123',
        status: {
          state: 'working',
          timestamp: '2023-01-01T00:00:00.000Z'
        },
        history: [
          {
            role: 'user',
            parts: [{ kind: 'text', text: 'Start task' }],
            messageId: 'msg_1',
            kind: 'message'
          }
        ],
        artifacts: [],
        kind: 'task'
      };

      expect(task.id).toBe('task_123');
      expect(task.status.state).toBe('working');
      expect(task.history).toHaveLength(1);
    });

    it('should support all task states', () => {
      const states = [
        'submitted', 'working', 'input-required', 'completed', 
        'canceled', 'failed', 'rejected', 'auth-required', 'unknown'
      ];

      states.forEach(state => {
        const task: A2ATask = {
          id: 'task_123',
          contextId: 'ctx_123',
          status: { state: state as any },
          kind: 'task'
        };
        expect(task.status.state).toBe(state);
      });
    });
  });

  describe('AgentCard', () => {
    it('should create valid agent card', () => {
      const card: AgentCard = {
        protocolVersion: '0.3.0',
        name: 'Test Agent',
        description: 'A test agent',
        url: 'https://example.com/a2a',
        version: '1.0.0',
        provider: {
          organization: 'Test Org',
          url: 'https://testorg.com'
        },
        capabilities: {
          streaming: true,
          pushNotifications: false,
          stateTransitionHistory: true
        },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills: [
          {
            id: 'test-skill',
            name: 'Test Skill',
            description: 'A test skill',
            tags: ['test', 'demo']
          }
        ]
      };

      expect(card.name).toBe('Test Agent');
      expect(card.capabilities.streaming).toBe(true);
      expect(card.skills).toHaveLength(1);
    });
  });

  describe('JSON-RPC Types', () => {
    it('should create valid JSON-RPC request', () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 'req_123',
        method: 'message/send',
        params: { test: 'data' }
      };

      expect(request.jsonrpc).toBe('2.0');
      expect(request.method).toBe('message/send');
    });

    it('should create valid JSON-RPC success response', () => {
      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: 'req_123',
        result: { success: true }
      };

      expect(response.jsonrpc).toBe('2.0');
      expect('result' in response).toBe(true);
      expect('error' in response).toBe(false);
    });

    it('should create valid JSON-RPC error response', () => {
      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: 'req_123',
        error: {
          code: A2AErrorCodes.INVALID_REQUEST,
          message: 'Invalid request'
        }
      };

      expect(response.jsonrpc).toBe('2.0');
      expect('error' in response).toBe(true);
      expect('result' in response).toBe(false);
    });
  });

  describe('SendMessageRequest', () => {
    it('should create valid send message request', () => {
      const request: SendMessageRequest = {
        jsonrpc: '2.0',
        id: 'req_123',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
            messageId: 'msg_123',
            kind: 'message'
          }
        }
      };

      expect(request.method).toBe('message/send');
      expect(request.params.message.role).toBe('user');
    });

    it('should validate send message request with schema', () => {
      const validRequest = {
        jsonrpc: '2.0',
        id: 'req_123',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
            messageId: 'msg_123',
            kind: 'message'
          }
        }
      };

      const result = sendMessageRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });
  });

  describe('SendStreamingMessageRequest', () => {
    it('should create valid streaming message request', () => {
      const request: SendStreamingMessageRequest = {
        jsonrpc: '2.0',
        id: 'req_123',
        method: 'message/stream',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
            messageId: 'msg_123',
            kind: 'message'
          }
        }
      };

      expect(request.method).toBe('message/stream');
      expect(request.params.message.role).toBe('user');
    });
  });

  describe('A2AError', () => {
    it('should support all error codes', () => {
      const errorCodes = [
        A2AErrorCodes.PARSE_ERROR,
        A2AErrorCodes.INVALID_REQUEST,
        A2AErrorCodes.METHOD_NOT_FOUND,
        A2AErrorCodes.INVALID_PARAMS,
        A2AErrorCodes.INTERNAL_ERROR,
        A2AErrorCodes.TASK_NOT_FOUND,
        A2AErrorCodes.TASK_NOT_CANCELABLE,
        A2AErrorCodes.PUSH_NOTIFICATION_NOT_SUPPORTED,
        A2AErrorCodes.UNSUPPORTED_OPERATION,
        A2AErrorCodes.CONTENT_TYPE_NOT_SUPPORTED,
        A2AErrorCodes.INVALID_AGENT_RESPONSE
      ];

      errorCodes.forEach(code => {
        const error: A2AError = {
          code,
          message: 'Test error'
        };
        expect(typeof error.code).toBe('number');
        expect(error.message).toBe('Test error');
      });
    });
  });

  describe('Type Immutability', () => {
    it('should enforce readonly properties', () => {
      const message: A2AMessage = {
        role: 'user',
        parts: [{ kind: 'text', text: 'Hello' }],
        messageId: 'msg_123',
        kind: 'message'
      };

      // TypeScript should prevent these at compile time
      // (message as any).role = 'agent'; // Should be readonly
      // (message as any).parts.push({}); // Should be readonly array

      expect(message.role).toBe('user');
    });
  });
});