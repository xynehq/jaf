/**
 * FAF ADK Layer - Tool System Tests
 */

import {
  createFunctionTool,
  createAsyncFunctionTool,
  createOpenAPIToolset,
  createCrewAIAdapter,
  createLangChainAdapter,
  validateTool,
  validateToolParameter,
  validateToolParameters,
  executeTool,
  executeTools,
  getToolByName,
  hasToolByName,
  filterToolsBySource,
  getToolNames,
  cloneTool,
  createToolError,
  createEchoTool,
  createCalculatorTool,
  createTimestampTool
} from '../tools';

import { createAgent } from '../agents';
import { createInMemorySessionProvider } from '../sessions';
import { createUserMessage } from '../content';
import { Tool, ToolContext, OpenAPISpec, Model, ToolParameterType } from '../types';

describe('Tool System', () => {
  const mockSession = {
    id: 'session_123',
    appName: 'test_app',
    userId: 'user_123',
    messages: [],
    artifacts: {},
    metadata: { created: new Date() }
  };

  const mockAgent = createAgent({
    name: 'test_agent',
    model: 'test_model',
    instruction: 'Test agent',
    tools: []
  });

  const mockContext: ToolContext = {
    agent: mockAgent,
    session: mockSession,
    message: createUserMessage('Test message'),
    actions: {
      addArtifact: () => {},
      getArtifact: () => null
    }
  };

  describe('Function Tool Creation', () => {
    test('createFunctionTool should create valid tool', () => {
      const tool = createFunctionTool({
        name: 'test_tool',
        description: 'A test tool',
        execute: (params, context) => {
          const typedParams = params as { input: string };
          return `Hello ${typedParams.input}`;
        },
        parameters: [
          {
            name: 'input',
            type: ToolParameterType.STRING,
            description: 'Input parameter',
            required: true
          }
        ]
      });

      expect(tool.name).toBe('test_tool');
      expect(tool.description).toBe('A test tool');
      expect(tool.parameters).toHaveLength(1);
      expect(tool.metadata?.source).toBe('function');
      expect(typeof tool.execute).toBe('function');
    });

    test('createAsyncFunctionTool should create async tool', async () => {
      const asyncFunc = async (params: Record<string, unknown>, context: any) => {
        const typedParams = params as { value: number };
        await new Promise(resolve => setTimeout(resolve, 10));
        return typedParams.value * 2;
      };

      const tool = createAsyncFunctionTool({
        name: 'async_tool',
        description: 'An async tool',
        execute: asyncFunc,
        parameters: [
          {
            name: 'value',
            type: ToolParameterType.NUMBER,
            description: 'Number to double',
            required: true
          }
        ]
      });

      const result = await tool.execute({ value: 5 }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data).toBe(10);
    });

    test('createFunctionTool should handle function errors', async () => {
      const throwingFunc = () => {
        throw new Error('Function error');
      };

      const tool = createFunctionTool({
        name: 'error_tool',
        description: 'Error tool',
        execute: throwingFunc,
        parameters: []
      });
      const result = await tool.execute({}, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Function error');
    });

    test('createFunctionTool should validate parameters', async () => {
      const tool = createFunctionTool({
        name: 'param_tool',
        description: 'Parameter validation tool',
        execute: (params, context) => {
          const typedParams = params as { required: string };
          return typedParams.required;
        },
        parameters: [
          {
            name: 'required',
            type: ToolParameterType.STRING,
            description: 'Required parameter',
            required: true
          }
        ]
      });

      // Missing required parameter
      const result = await tool.execute({}, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Required parameter');
    });
  });

  describe('OpenAPI Tool Generation', () => {
    const mockOpenAPISpec: OpenAPISpec = {
      openapi: '3.0.0',
      info: {
        title: 'Test API',
        version: '1.0.0'
      },
      paths: {
        '/test': {
          get: {
            operationId: 'getTest',
            summary: 'Get test data',
            parameters: [
              {
                name: 'id',
                in: 'query',
                description: 'Test ID',
                required: true,
                schema: { type: 'string' }
              }
            ],
            responses: {
              '200': {
                description: 'Success'
              }
            }
          }
        }
      }
    };

    test('createOpenAPIToolset should generate tools from spec', async () => {
      const tools = await createOpenAPIToolset(mockOpenAPISpec);
      
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('getTest');
      expect(tools[0].description).toBe('Get test data');
      expect(tools[0].metadata?.source).toBe('openapi');
      expect(tools[0].parameters).toHaveLength(1);
      expect(tools[0].parameters[0].name).toBe('id');
    });

    test('createOpenAPIToolset should handle operations without operationId', async () => {
      const spec = {
        ...mockOpenAPISpec,
        paths: {
          '/test': {
            post: {
              summary: 'Post test data',
              responses: { '200': { description: 'Success' } }
            }
          }
        }
      };

      const tools = await createOpenAPIToolset(spec);
      
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('post__test');
    });
  });

  describe('External Tool Adapters', () => {
    test('createCrewAIAdapter should adapt CrewAI tool', () => {
      const mockCrewAITool = {
        name: 'crewai_tool',
        description: 'A CrewAI tool',
        run: async (params: any) => `CrewAI result: ${params.input}`
      };

      const tool = createCrewAIAdapter(mockCrewAITool);
      
      expect(tool.name).toBe('crewai_tool');
      expect(tool.description).toBe('A CrewAI tool');
      expect(tool.metadata?.source).toBe('crewai');
    });

    test('createLangChainAdapter should adapt LangChain tool', () => {
      const mockLangChainTool = {
        name: 'langchain_tool',
        description: 'A LangChain tool',
        call: async (params: any) => `LangChain result: ${params.input}`
      };

      const tool = createLangChainAdapter(mockLangChainTool);
      
      expect(tool.name).toBe('langchain_tool');
      expect(tool.description).toBe('A LangChain tool');
      expect(tool.metadata?.source).toBe('langchain');
    });

    test('adapters should handle tool execution errors', async () => {
      const mockTool = {
        name: 'error_tool',
        description: 'Error tool',
        run: async () => {
          throw new Error('External tool error');
        }
      };

      const tool = createCrewAIAdapter(mockTool);
      const result = await tool.execute({}, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('External tool error');
    });
  });

  describe('Tool Validation', () => {
    test('validateTool should accept valid tool', () => {
      const tool = createEchoTool();
      const result = validateTool(tool);
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual(tool);
    });

    test('validateTool should reject tool with missing name', () => {
      const invalidTool = {
        name: '',
        description: 'Test',
        parameters: [],
        execute: async () => ({ success: true })
      } as Tool;

      const result = validateTool(invalidTool);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Tool name is required');
    });

    test('validateTool should reject tool with missing description', () => {
      const invalidTool = {
        name: 'test',
        description: '',
        parameters: [],
        execute: async () => ({ success: true })
      } as Tool;

      const result = validateTool(invalidTool);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Tool description is required');
    });

    test('validateTool should reject tool with invalid parameters', () => {
      const invalidTool = {
        name: 'test',
        description: 'Test',
        parameters: 'not-array' as any,
        execute: async () => ({ success: true })
      } as Tool;

      const result = validateTool(invalidTool);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Tool parameters must be an array');
    });

    test('validateTool should reject tool without execute function', () => {
      const invalidTool = {
        name: 'test',
        description: 'Test',
        parameters: [],
        execute: 'not-function' as any
      } as Tool;

      const result = validateTool(invalidTool);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Tool execute must be a function');
    });

    test('validateToolParameter should validate parameter structure', () => {
      const validParam = {
        name: 'test_param',
        type: ToolParameterType.STRING,
        description: 'Test parameter',
        required: true
      };

      const result = validateToolParameter(validParam);
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validParam);
    });

    test('validateToolParameter should reject invalid parameter', () => {
      const invalidParam = {
        name: '',
        type: 'invalid' as any,
        description: '',
        required: true
      };

      const result = validateToolParameter(invalidParam);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Parameter name is required');
      expect(result.errors).toContain('Invalid parameter type: invalid');
      expect(result.errors).toContain('Parameter description is required');
    });

    test('validateToolParameters should validate parameter values', () => {
      const schema = [
        {
          name: 'required_param',
          type: ToolParameterType.STRING,
          description: 'Required parameter',
          required: true
        },
        {
          name: 'optional_param',
          type: ToolParameterType.NUMBER,
          description: 'Optional parameter',
          required: false
        }
      ];

      // Valid parameters
      const validParams = {
        required_param: 'test_value',
        optional_param: 42
      };

      const validResult = validateToolParameters(validParams, schema);
      expect(validResult.success).toBe(true);

      // Missing required parameter
      const missingRequired = { optional_param: 42 };
      const missingResult = validateToolParameters(missingRequired, schema);
      expect(missingResult.success).toBe(false);
      expect(missingResult.errors).toContain("Required parameter 'required_param' is missing");

      // Wrong type
      const wrongType = {
        required_param: 'test_value',
        optional_param: 'not_a_number'
      };
      const typeResult = validateToolParameters(wrongType, schema);
      expect(typeResult.success).toBe(false);
      expect(typeResult.errors).toContain("Parameter 'optional_param' has invalid type (expected number)");
    });
  });

  describe('Tool Execution', () => {
    test('executeTool should execute tool successfully', async () => {
      const tool = createEchoTool();
      const result = await executeTool(tool, { message: 'Hello' }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data).toBe('Hello');
    });

    test('executeTool should handle validation errors', async () => {
      const tool = createFunctionTool({
        name: 'test_tool',
        description: 'Test tool',
        execute: (params, context) => 'result',
        parameters: [
          {
            name: 'required',
            type: ToolParameterType.STRING,
            description: 'Required param',
            required: true
          }
        ]
      });

      const result = await executeTool(tool, {}, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Parameter validation failed');
    });

    test('executeTools should execute multiple tools', async () => {
      const tool1 = createEchoTool();
      const tool2 = createTimestampTool();
      
      const params = {
        echo: { message: 'test' },
        timestamp: {}
      };

      const results = await executeTools([tool1, tool2], params, mockContext);
      
      expect(results.echo.success).toBe(true);
      expect(results.echo.data).toBe('test');
      expect(results.timestamp.success).toBe(true);
      expect(results.timestamp.data).toHaveProperty('timestamp');
    });
  });

  describe('Tool Utilities', () => {
    const tools = [
      createEchoTool(),
      createCalculatorTool(),
      createTimestampTool()
    ];

    test('getToolByName should find tool by name', () => {
      const tool = getToolByName(tools, 'echo');
      expect(tool?.name).toBe('echo');
    });

    test('getToolByName should return null for nonexistent tool', () => {
      const tool = getToolByName(tools, 'nonexistent');
      expect(tool).toBeNull();
    });

    test('hasToolByName should detect tool presence', () => {
      expect(hasToolByName(tools, 'echo')).toBe(true);
      expect(hasToolByName(tools, 'nonexistent')).toBe(false);
    });

    test('filterToolsBySource should filter by source', () => {
      const functionTools = filterToolsBySource(tools, 'function');
      expect(functionTools).toHaveLength(3);
      expect(functionTools.every(t => t.metadata?.source === 'function')).toBe(true);
    });

    test('getToolNames should return tool names', () => {
      const names = getToolNames(tools);
      expect(names).toEqual(['echo', 'calculator', 'timestamp']);
    });

    test('cloneTool should create deep copy', () => {
      const original = createEchoTool();
      const cloned = cloneTool(original);
      
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.parameters).not.toBe(original.parameters);
    });
  });

  describe('Built-in Tools', () => {
    test('createEchoTool should create echo tool', async () => {
      const tool = createEchoTool();
      const result = await tool.execute({ message: 'Hello World' }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data).toBe('Hello World');
    });

    test('createCalculatorTool should create calculator tool', async () => {
      const tool = createCalculatorTool();
      const result = await tool.execute({ expression: '2 + 2' }, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        result: 4,
        expression: '2 + 2'
      });
    });

    test('createCalculatorTool should handle invalid expressions', async () => {
      const tool = createCalculatorTool();
      const result = await tool.execute({ expression: 'invalid' }, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid expression');
    });

    test('createTimestampTool should create timestamp tool', async () => {
      const tool = createTimestampTool();
      const result = await tool.execute({}, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('timestamp');
      expect(result.data).toHaveProperty('unix');
      expect(typeof (result.data as any).unix).toBe('number');
    });
  });

  describe('Error Handling', () => {
    test('createToolError should create ToolError', () => {
      const error = createToolError('Tool failed', 'test_tool', { context: 'test' });
      
      expect(error.message).toBe('Tool failed');
      expect(error.toolName).toBe('test_tool');
      expect(error.context).toEqual({ context: 'test' });
      expect(error.code).toBe('TOOL_ERROR');
    });

    test('tool execution should catch and return errors gracefully', async () => {
      const tool = createFunctionTool({
        name: 'error_tool',
        description: 'Tool that throws',
        execute: (params, context) => {
          throw new Error('Tool execution error');
        },
        parameters: []
      });

      const result = await tool.execute({}, mockContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool execution error');
      expect(result.metadata).toHaveProperty('error');
    });
  });

  describe('Tool Context Actions', () => {
    test('tool context should provide artifact management', async () => {
      let addedArtifact: { key: string; value: unknown } | null = null;
      
      const mockContextWithActions: ToolContext = {
        ...mockContext,
        actions: {
          addArtifact: (key: string, value: unknown) => {
            addedArtifact = { key, value };
          },
          getArtifact: (key: string) => {
            return addedArtifact?.key === key ? addedArtifact.value : null;
          }
        }
      };

      const tool = createFunctionTool({
        name: 'artifact_tool',
        description: 'Tool that uses artifacts',
        execute: (params, context: ToolContext) => {
          context.actions.addArtifact?.('test_key', 'test_value');
          return context.actions.getArtifact?.('test_key');
        },
        parameters: []
      });

      const result = await tool.execute({}, mockContextWithActions);
      
      expect(result.success).toBe(true);
      expect(result.data).toBe('test_value');
      expect(addedArtifact).toEqual({ key: 'test_key', value: 'test_value' });
    });

    test('tool context should support agent transfer actions', async () => {
      const mockContextWithTransfer: ToolContext = {
        ...mockContext,
        actions: {
          ...mockContext.actions,
          transferToAgent: undefined
        }
      };

      const tool = createFunctionTool({
        name: 'transfer_tool',
        description: 'Tool that transfers to another agent',
        execute: (params, context: ToolContext) => {
          context.actions.transferToAgent = 'specialist_agent';
          return 'Transfer initiated';
        },
        parameters: []
      });

      const result = await tool.execute({}, mockContextWithTransfer);
      
      expect(result.success).toBe(true);
      expect(result.data).toBe('Transfer initiated');
      expect(mockContextWithTransfer.actions.transferToAgent).toBe('specialist_agent');
    });
  });
});