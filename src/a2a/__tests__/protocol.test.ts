/**
 * A2A Protocol Tests
 * Tests for JSON-RPC protocol handlers and validation
 */

import {
  validateJSONRPCRequest,
  createJSONRPCSuccessResponse,
  createJSONRPCErrorResponse,
  createA2AError,
  mapErrorToA2AError,
  validateSendMessageRequest,
  handleMessageSend,
  routeA2ARequest,
  createSimpleA2ATaskProvider,
  A2AErrorCodes,
  type JSONRPCRequest,
  type SendMessageRequest,
  type A2AAgent,
  type A2ATaskProvider
} from '../index';

describe('A2A Protocol', () => {
  // Mock agent for testing
  const mockAgent: A2AAgent = {
    name: 'TestAgent',
    description: 'Test agent for protocol testing',
    supportedContentTypes: ['text/plain'],
    instruction: 'Test agent instructions',
    tools: []
  };

  // Mock model provider
  const mockModelProvider = {
    async getCompletion() {
      return {
        message: {
          content: 'Test response from agent'
        }
      };
    }
  };

  describe('validateJSONRPCRequest', () => {
    it('should validate valid JSON-RPC request', () => {
      const validRequest = {
        jsonrpc: '2.0',
        id: 'test_123',
        method: 'message/send',
        params: { test: 'data' }
      };

      expect(validateJSONRPCRequest(validRequest)).toBe(true);
    });

    it('should reject request without jsonrpc field', () => {
      const invalidRequest = {
        id: 'test_123',
        method: 'message/send'
      };

      expect(validateJSONRPCRequest(invalidRequest)).toBe(false);
    });

    it('should reject request with wrong jsonrpc version', () => {
      const invalidRequest = {
        jsonrpc: '1.0',
        id: 'test_123',
        method: 'message/send'
      };

      expect(validateJSONRPCRequest(invalidRequest)).toBe(false);
    });

    it('should reject request without id', () => {
      const invalidRequest = {
        jsonrpc: '2.0',
        method: 'message/send'
      };

      expect(validateJSONRPCRequest(invalidRequest)).toBe(false);
    });

    it('should reject request without method', () => {
      const invalidRequest = {
        jsonrpc: '2.0',
        id: 'test_123'
      };

      expect(validateJSONRPCRequest(invalidRequest)).toBe(false);
    });
  });

  describe('createJSONRPCSuccessResponse', () => {
    it('should create valid success response', () => {
      const response = createJSONRPCSuccessResponse('test_123', { result: 'success' });

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test_123');
      expect(response.result).toEqual({ result: 'success' });
      expect('error' in response).toBe(false);
    });

    it('should handle null id', () => {
      const response = createJSONRPCSuccessResponse(null as any, { result: 'success' });

      expect(response.id).toBe(null);
    });
  });

  describe('createJSONRPCErrorResponse', () => {
    it('should create valid error response', () => {
      const error = createA2AError(A2AErrorCodes.INVALID_REQUEST, 'Invalid request');
      const response = createJSONRPCErrorResponse('test_123', error);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test_123');
      expect(response.error?.code).toBe(A2AErrorCodes.INVALID_REQUEST);
      expect(response.error?.message).toBe('Invalid request');
      expect('result' in response).toBe(false);
    });
  });

  describe('createA2AError', () => {
    it('should create A2A error with all fields', () => {
      const error = createA2AError(
        A2AErrorCodes.TASK_NOT_FOUND, 
        'Task not found', 
        { taskId: 'task_123' }
      );

      expect(error.code).toBe(A2AErrorCodes.TASK_NOT_FOUND);
      expect(error.message).toBe('Task not found');
      expect(error.data).toEqual({ taskId: 'task_123' });
    });

    it('should create A2A error without data', () => {
      const error = createA2AError(A2AErrorCodes.INTERNAL_ERROR, 'Internal error');

      expect(error.code).toBe(A2AErrorCodes.INTERNAL_ERROR);
      expect(error.message).toBe('Internal error');
      expect(error.data).toBeUndefined();
    });
  });

  describe('mapErrorToA2AError', () => {
    it('should map JavaScript Error to A2A error', () => {
      const jsError = new Error('Something went wrong');
      const a2aError = mapErrorToA2AError(jsError);

      expect(a2aError.code).toBe(A2AErrorCodes.INTERNAL_ERROR);
      expect(a2aError.message).toBe('Something went wrong');
    });

    it('should map string error to A2A error', () => {
      const stringError = 'String error';
      const a2aError = mapErrorToA2AError(stringError);

      expect(a2aError.code).toBe(A2AErrorCodes.INTERNAL_ERROR);
      expect(a2aError.message).toBe('String error');
    });

    it('should map unknown error to A2A error', () => {
      const unknownError = { custom: 'error' };
      const a2aError = mapErrorToA2AError(unknownError);

      expect(a2aError.code).toBe(A2AErrorCodes.INTERNAL_ERROR);
      expect(a2aError.message).toBe('Unknown error occurred');
    });
  });

  describe('validateSendMessageRequest', () => {
    it('should validate valid send message request', () => {
      const validRequest: SendMessageRequest = {
        jsonrpc: '2.0',
        id: 'test_123',
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

      const result = validateSendMessageRequest(validRequest);
      expect(result.isValid).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should reject invalid send message request', () => {
      const invalidRequest = {
        jsonrpc: '2.0' as const,
        id: 'test_123',
        method: 'message/send',
        params: {
          message: {
            role: 'invalid_role',
            parts: [],
            messageId: 'msg_123'
          }
        }
      };

      const result = validateSendMessageRequest(invalidRequest as any);
      expect(result.isValid).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(A2AErrorCodes.INVALID_PARAMS);
    });
  });

  describe('handleMessageSend', () => {
    it('should handle valid message send request', async () => {
      const request: SendMessageRequest = {
        jsonrpc: '2.0',
        id: 'test_123',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello agent' }],
            messageId: 'msg_123',
            kind: 'message'
          }
        }
      };

      const response = await handleMessageSend(request, mockAgent, mockModelProvider);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test_123');
      expect('result' in response).toBe(true);
      expect('error' in response).toBe(false);
    });
  });

  describe('routeA2ARequest', () => {
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

    afterAll(async () => {
      if (taskProvider) {
        await taskProvider.close();
      }
    });

    it('should route message/send request', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 'test_123',
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

      const result = routeA2ARequest(request, mockAgent, mockModelProvider, taskProvider, agentCard);
      expect(result).toBeInstanceOf(Promise);

      const response = await result as any;
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test_123');
    });

    it('should route message/stream request', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 'test_123',
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

      const result = routeA2ARequest(request, mockAgent, mockModelProvider, taskProvider, agentCard);
      expect(result).not.toBeInstanceOf(Promise);
      
      // Should return an async generator
      const generator = result as AsyncGenerator<any>;
      expect(typeof generator[Symbol.asyncIterator]).toBe('function');
    });

    it('should handle invalid request', async () => {
      const invalidRequest = {
        jsonrpc: '1.0', // Wrong version
        id: 'test_123',
        method: 'message/send'
      };

      const result = routeA2ARequest(invalidRequest, mockAgent, mockModelProvider, taskProvider, agentCard);
      const response = await result as any;

      expect(response.jsonrpc).toBe('2.0');
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(A2AErrorCodes.INVALID_REQUEST);
    });

    it('should handle unknown method', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 'test_123',
        method: 'unknown/method'
      };

      const result = routeA2ARequest(request, mockAgent, mockModelProvider, taskProvider, agentCard);
      const response = await result as any;

      expect(response.jsonrpc).toBe('2.0');
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(A2AErrorCodes.METHOD_NOT_FOUND);
    });
  });

  describe('Error Code Values', () => {
    it('should have correct JSON-RPC error codes', () => {
      expect(A2AErrorCodes.PARSE_ERROR).toBe(-32700);
      expect(A2AErrorCodes.INVALID_REQUEST).toBe(-32600);
      expect(A2AErrorCodes.METHOD_NOT_FOUND).toBe(-32601);
      expect(A2AErrorCodes.INVALID_PARAMS).toBe(-32602);
      expect(A2AErrorCodes.INTERNAL_ERROR).toBe(-32603);
    });

    it('should have correct A2A-specific error codes', () => {
      expect(A2AErrorCodes.TASK_NOT_FOUND).toBe(-32001);
      expect(A2AErrorCodes.TASK_NOT_CANCELABLE).toBe(-32002);
      expect(A2AErrorCodes.PUSH_NOTIFICATION_NOT_SUPPORTED).toBe(-32003);
      expect(A2AErrorCodes.UNSUPPORTED_OPERATION).toBe(-32004);
      expect(A2AErrorCodes.CONTENT_TYPE_NOT_SUPPORTED).toBe(-32005);
      expect(A2AErrorCodes.INVALID_AGENT_RESPONSE).toBe(-32006);
    });
  });
});