/**
 * Tests for Type Conversion Functions
 */

import { describe, it, expect } from '@jest/globals';
import {
  convertAdkContentToCoreMessage,
  convertCoreMessageToAdkContent,
  convertAdkAgentToCoreAgent,
  convertCoreAgentToAdkAgent,
  convertAdkModelToCoreModel,
  convertCoreModelToAdkModel,
  convertAdkSessionToCoreState,
  convertCoreStateToAdkSession,
  safeJsonParse,
  safeJsonStringify,
  extractFunctionCallsFromAdkContent,
  extractFunctionResponsesFromAdkContent,
  createAdkContentWithText,
  createAdkContentWithFunctionCall,
  createAdkContentWithFunctionResponse
} from '../type-converters.js';
import {
  Content,
  ContentRole,
  PartType,
  Agent,
  Model,
  Session,
  FunctionCall,
  FunctionResponse,
  ToolParameterType
} from '../../types.js';

describe('Type Converters', () => {
  describe('Content Conversions', () => {
    it('should convert ADK content with text to Core message', () => {
      const adkContent: Content = {
        role: ContentRole.USER,
        parts: [{
          type: PartType.TEXT,
          text: 'Hello, world!'
        }],
        metadata: {}
      };

      const coreMessage = convertAdkContentToCoreMessage(adkContent);

      expect(coreMessage.role).toBe('user');
      expect(coreMessage.content).toBe('Hello, world!');
      expect(coreMessage.tool_calls).toBeUndefined();
    });

    it('should convert ADK content with function call to Core message', () => {
      const functionCall: FunctionCall = {
        id: 'call_123',
        name: 'get_weather',
        args: { location: 'New York' }
      };

      const adkContent: Content = {
        role: ContentRole.MODEL,
        parts: [
          {
            type: PartType.TEXT,
            text: 'Let me check the weather for you.'
          },
          {
            type: PartType.FUNCTION_CALL,
            functionCall
          }
        ],
        metadata: {}
      };

      const coreMessage = convertAdkContentToCoreMessage(adkContent);

      expect(coreMessage.role).toBe('assistant');
      expect(coreMessage.content).toBe('Let me check the weather for you.');
      expect(coreMessage.tool_calls).toHaveLength(1);
      expect(coreMessage.tool_calls![0].id).toBe('call_123');
      expect(coreMessage.tool_calls![0].function.name).toBe('get_weather');
      expect(JSON.parse(coreMessage.tool_calls![0].function.arguments)).toEqual({ location: 'New York' });
    });

    it('should convert ADK content with function response to Core message', () => {
      const functionResponse: FunctionResponse = {
        id: 'call_123',
        name: 'get_weather',
        response: { temperature: 22, condition: 'sunny' },
        success: true
      };

      const adkContent: Content = {
        role: ContentRole.MODEL,
        parts: [{
          type: PartType.FUNCTION_RESPONSE,
          functionResponse
        }],
        metadata: {}
      };

      const coreMessage = convertAdkContentToCoreMessage(adkContent);

      expect(coreMessage.role).toBe('tool');
      expect(coreMessage.tool_call_id).toBe('call_123');
      expect(JSON.parse(coreMessage.content)).toEqual({ temperature: 22, condition: 'sunny' });
    });

    it('should convert Core message to ADK content', () => {
      const coreMessage: any = {
        role: 'user',
        content: 'What is the weather like?',
        tool_calls: undefined
      };

      const adkContent = convertCoreMessageToAdkContent(coreMessage);

      expect(adkContent.role).toBe(ContentRole.USER);
      expect(adkContent.parts).toHaveLength(1);
      expect(adkContent.parts[0].type).toBe(PartType.TEXT);
      expect(adkContent.parts[0].text).toBe('What is the weather like?');
    });

    it('should convert Core message with tool calls to ADK content', () => {
      const coreMessage: any = {
        role: 'assistant',
        content: 'I will check the weather for you.',
        tool_calls: [{
          id: 'call_456',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: '{"location": "London"}'
          }
        }]
      };

      const adkContent = convertCoreMessageToAdkContent(coreMessage);

      expect(adkContent.role).toBe(ContentRole.MODEL);
      expect(adkContent.parts).toHaveLength(2);
      expect(adkContent.parts[0].type).toBe(PartType.TEXT);
      expect(adkContent.parts[1].type).toBe(PartType.FUNCTION_CALL);
      expect(adkContent.parts[1].functionCall!.id).toBe('call_456');
      expect(adkContent.parts[1].functionCall!.name).toBe('get_weather');
      expect(adkContent.parts[1].functionCall!.args).toEqual({ location: 'London' });
    });
  });

  describe('Role Conversions', () => {
    it('should convert ADK roles to Core roles', () => {
      expect(convertAdkContentToCoreMessage({ 
        role: ContentRole.USER, 
        parts: [{ type: PartType.TEXT, text: 'test' }], 
        metadata: {} 
      }).role).toBe('user');
      
      expect(convertAdkContentToCoreMessage({ 
        role: ContentRole.MODEL, 
        parts: [{ type: PartType.TEXT, text: 'test' }], 
        metadata: {} 
      }).role).toBe('assistant');
      
      expect(convertAdkContentToCoreMessage({ 
        role: ContentRole.SYSTEM, 
        parts: [{ type: PartType.TEXT, text: 'test' }], 
        metadata: {} 
      }).role).toBe('system');
    });

    it('should convert string roles to Core roles', () => {
      expect(convertAdkContentToCoreMessage({ 
        role: 'user', 
        parts: [{ type: PartType.TEXT, text: 'test' }], 
        metadata: {} 
      }).role).toBe('user');
    });
  });

  describe('Model Conversions', () => {
    it('should convert ADK models to Core model names', () => {
      expect(convertAdkModelToCoreModel(Model.GPT_4)).toBe('gpt-4');
      expect(convertAdkModelToCoreModel(Model.GPT_4_TURBO)).toBe('gpt-4-turbo');
      expect(convertAdkModelToCoreModel(Model.CLAUDE_3_5_SONNET_LATEST)).toBe('claude-3-sonnet');
      expect(convertAdkModelToCoreModel(Model.GEMINI_1_5_PRO)).toBe('gemini-1.5-pro');
      expect(convertAdkModelToCoreModel('custom-model')).toBe('custom-model');
    });

    it('should convert Core model names to ADK models', () => {
      expect(convertCoreModelToAdkModel('gpt-4')).toBe(Model.GPT_4);
      expect(convertCoreModelToAdkModel('claude-3-sonnet')).toBe(Model.CLAUDE_3_5_SONNET_LATEST);
      expect(convertCoreModelToAdkModel('gemini-1.5-pro')).toBe(Model.GEMINI_1_5_PRO);
      expect(convertCoreModelToAdkModel('unknown-model')).toBe(Model.CUSTOM);
    });
  });

  describe('Agent Conversions', () => {
    it('should convert ADK agent to Core agent', () => {
      const adkAgent: Agent = {
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

      const coreAgent = convertAdkAgentToCoreAgent(adkAgent);

      expect(coreAgent.name).toBe('TestAgent');
      expect(typeof coreAgent.instructions).toBe('function');
      expect(coreAgent.instructions({} as any)).toBe('You are a test agent');
      expect(coreAgent.modelConfig?.name).toBe('gpt-4');
      expect(coreAgent.tools).toEqual([]);
    });

    it('should convert Core agent to ADK agent', () => {
      const coreAgent: any = {
        name: 'CoreAgent',
        instructions: () => 'Instructions from core',
        tools: [],
        modelConfig: {
          name: 'claude-3-sonnet',
          temperature: 0.7
        },
        handoffs: []
      };

      const adkAgent = convertCoreAgentToAdkAgent(coreAgent);

      expect(adkAgent.id).toBe('CoreAgent');
      expect(adkAgent.config.name).toBe('CoreAgent');
      expect(adkAgent.config.model).toBe(Model.CLAUDE_3_5_SONNET_LATEST);
      expect(adkAgent.config.instruction).toBe('Instructions from core');
    });
  });

  describe('Session Conversions', () => {
    it('should convert ADK session to Core state', () => {
      const session: Session = {
        id: 'session-123',
        appName: 'test-app',
        userId: 'user-456',
        messages: [{
          role: ContentRole.USER,
          parts: [{ type: PartType.TEXT, text: 'Hello' }],
          metadata: {}
        }],
        artifacts: { key: 'value' },
        metadata: {
          created: new Date(),
          properties: { custom: 'prop' }
        }
      };

      const newMessage: Content = {
        role: ContentRole.USER,
        parts: [{ type: PartType.TEXT, text: 'New message' }],
        metadata: {}
      };

      const coreState = convertAdkSessionToCoreState(session, newMessage);

      expect(coreState.runId).toBe('session-123');
      expect(coreState.traceId).toBe('session-123');
      expect(coreState.messages).toHaveLength(2);
      expect(coreState.currentAgentName).toBe('default');
      expect(coreState.context.userId).toBe('user-456');
      expect(coreState.context.artifacts).toEqual({ key: 'value' });
      expect(coreState.turnCount).toBe(1);
    });

    it('should convert Core state to ADK session', () => {
      const coreState: any = {
        runId: 'run-123',
        traceId: 'trace-456',
        messages: [{
          role: 'user',
          content: 'Test message'
        }],
        currentAgentName: 'TestAgent',
        context: {
          userId: 'user-789',
          appName: 'test-app',
          artifacts: { data: 'test' }
        },
        turnCount: 5
      };

      const session = convertCoreStateToAdkSession(coreState);

      expect(session.id).toBe('run-123');
      expect(session.userId).toBe('user-789');
      expect(session.appName).toBe('test-app');
      expect(session.messages).toHaveLength(1);
      expect(session.artifacts).toEqual({ data: 'test' });
      expect(session.metadata.properties?.turnCount).toBe(5);
    });
  });

  describe('Utility Functions', () => {
    it('should safely parse JSON', () => {
      expect(safeJsonParse('{"key": "value"}')).toEqual({ key: 'value' });
      expect(safeJsonParse('invalid json')).toBe('invalid json');
      expect(safeJsonParse('')).toBe('');
    });

    it('should safely stringify JSON', () => {
      expect(safeJsonStringify({ key: 'value' })).toBe('{"key":"value"}');
      expect(safeJsonStringify('string')).toBe('"string"');
      
      // Test circular reference
      const circular: any = { a: 1 };
      circular.self = circular;
      expect(safeJsonStringify(circular)).toBe('[object Object]');
    });

    it('should extract function calls from ADK content', () => {
      const functionCall: FunctionCall = {
        id: 'call_123',
        name: 'test_function',
        args: { param: 'value' }
      };

      const content: Content = {
        role: ContentRole.MODEL,
        parts: [
          { type: PartType.TEXT, text: 'Text part' },
          { type: PartType.FUNCTION_CALL, functionCall }
        ],
        metadata: {}
      };

      const extractedCalls = extractFunctionCallsFromAdkContent(content);

      expect(extractedCalls).toHaveLength(1);
      expect(extractedCalls[0]).toEqual(functionCall);
    });

    it('should extract function responses from ADK content', () => {
      const functionResponse: FunctionResponse = {
        id: 'call_123',
        name: 'test_function',
        response: 'Function result',
        success: true
      };

      const content: Content = {
        role: ContentRole.MODEL,
        parts: [
          { type: PartType.TEXT, text: 'Text part' },
          { type: PartType.FUNCTION_RESPONSE, functionResponse }
        ],
        metadata: {}
      };

      const extractedResponses = extractFunctionResponsesFromAdkContent(content);

      expect(extractedResponses).toHaveLength(1);
      expect(extractedResponses[0]).toEqual(functionResponse);
    });

    it('should create ADK content with text', () => {
      const content = createAdkContentWithText('Hello world', ContentRole.USER);

      expect(content.role).toBe(ContentRole.USER);
      expect(content.parts).toHaveLength(1);
      expect(content.parts[0].type).toBe(PartType.TEXT);
      expect(content.parts[0].text).toBe('Hello world');
    });

    it('should create ADK content with function call', () => {
      const functionCall: FunctionCall = {
        id: 'call_456',
        name: 'test_function',
        args: { test: 'data' }
      };

      const content = createAdkContentWithFunctionCall(functionCall);

      expect(content.role).toBe(ContentRole.MODEL);
      expect(content.parts).toHaveLength(1);
      expect(content.parts[0].type).toBe(PartType.FUNCTION_CALL);
      expect(content.parts[0].functionCall).toEqual(functionCall);
    });

    it('should create ADK content with function response', () => {
      const functionResponse: FunctionResponse = {
        id: 'call_456',
        name: 'test_function',
        response: { result: 'success' },
        success: true
      };

      const content = createAdkContentWithFunctionResponse(functionResponse);

      expect(content.role).toBe(ContentRole.MODEL);
      expect(content.parts).toHaveLength(1);
      expect(content.parts[0].type).toBe(PartType.FUNCTION_RESPONSE);
      expect(content.parts[0].functionResponse).toEqual(functionResponse);
    });
  });

  describe('Tool Conversions', () => {
    it('should handle tool conversion with parameters', () => {
      const adkTool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: [{
          name: 'param1',
          type: ToolParameterType.STRING,
          description: 'String parameter',
          required: true
        }, {
          name: 'param2',
          type: ToolParameterType.NUMBER,
          description: 'Number parameter',
          required: false
        }],
        execute: async (params: any, context: any) => ({ success: true, response: 'tool result' }),
        metadata: {
          source: 'function' as const,
          version: '1.0.0'
        }
      };

      expect(() => convertAdkAgentToCoreAgent({
        id: 'test',
        config: {
          name: 'TestAgent',
          model: Model.GPT_4,
          instruction: 'Test',
          tools: [adkTool],
          subAgents: []
        },
        metadata: {
          created: new Date(),
          version: '1.0.0'
        }
      })).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty content parts', () => {
      const content: Content = {
        role: ContentRole.USER,
        parts: [],
        metadata: {}
      };

      const coreMessage = convertAdkContentToCoreMessage(content);
      expect(coreMessage.content).toBe('');
    });

    it('should handle mixed content types', () => {
      const content: Content = {
        role: ContentRole.USER,
        parts: [
          { type: PartType.TEXT, text: 'First part' },
          { type: PartType.TEXT, text: 'Second part' }
        ],
        metadata: {}
      };

      const coreMessage = convertAdkContentToCoreMessage(content);
      expect(coreMessage.content).toBe('First part Second part');
    });

    it('should handle undefined function call arguments', () => {
      const content: Content = {
        role: ContentRole.MODEL,
        parts: [{
          type: PartType.FUNCTION_CALL,
          functionCall: {
            id: 'call_123',
            name: 'test_function',
            args: undefined as any
          }
        }],
        metadata: {}
      };

      expect(() => convertAdkContentToCoreMessage(content)).not.toThrow();
    });
  });
});