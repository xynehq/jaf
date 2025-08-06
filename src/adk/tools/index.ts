/**
 * FAF ADK Layer - Tool System
 * 
 * Functional tool creation, execution, and integration utilities
 */

import { 
  Tool, 
  ToolParameter, 
  ToolContext, 
  ToolResult, 
  ToolMetadata,
  ToolExecutor,
  OpenAPISpec,
  OperationObject,
  ParameterObject,
  ToolError,
  ValidationResult,
  throwToolError,
  createToolError,
  FunctionToolConfig,
  ToolSource,
  ToolParameterType
} from '../types';

// ========== Tool Creation ==========

export const createFunctionTool = (config: FunctionToolConfig): Tool => {
  const { name, description, execute, parameters = [], metadata } = config;
  
  const toolMetadata: ToolMetadata = {
    source: ToolSource.FUNCTION,
    version: '1.0.0',
    ...metadata
  };
  
  const executor: ToolExecutor = async (params, context) => {
    try {
      // Validate parameters
      const validation = validateToolParameters(params, parameters);
      if (!validation.success) {
        return {
          success: false,
          error: `Parameter validation failed: ${validation.errors?.join(', ')}`
        };
      }
      
      // Execute function with params and context
      const result = await execute(params, context);
      
      return {
        success: true,
        data: result,
        metadata: { executedAt: new Date() }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: { error, executedAt: new Date() }
      };
    }
  };
  
  return {
    name,
    description,
    parameters,
    execute: executor,
    metadata: toolMetadata
  };
};

// Legacy function signature for backward compatibility
export const createFunctionToolLegacy = (
  name: string,
  description: string,
  func: (params: Record<string, unknown>, context: ToolContext) => unknown | Promise<unknown>,
  parameters: ToolParameter[] = [],
  metadata?: Partial<ToolMetadata>
): Tool => {
  return createFunctionTool({
    name,
    description,
    execute: func,
    parameters,
    metadata
  });
};

export const createAsyncFunctionTool = (config: FunctionToolConfig): Tool => {
  return createFunctionTool(config);
};

// ========== OpenAPI Tool Generation ==========

export const createOpenAPIToolset = async (spec: OpenAPISpec): Promise<Tool[]> => {
  const tools: Tool[] = [];
  
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (isValidOperation(operation)) {
        const tool = await createToolFromOperation(path, method, operation, spec);
        tools.push(tool);
      }
    }
  }
  
  return tools;
};

const createToolFromOperation = async (
  path: string,
  method: string,
  operation: OperationObject,
  spec: OpenAPISpec
): Promise<Tool> => {
  const name = operation.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const description = operation.description || operation.summary || `${method.toUpperCase()} ${path}`;
  
  const parameters = extractParametersFromOperation(operation);
  
  const executor: ToolExecutor = async (params, context) => {
    try {
      const response = await executeOpenAPICall(path, method, params, spec);
      return {
        success: true,
        data: response,
        metadata: { 
          path, 
          method, 
          executedAt: new Date() 
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'API call failed',
        metadata: { 
          path, 
          method, 
          error, 
          executedAt: new Date() 
        }
      };
    }
  };
  
  return {
    name,
    description,
    parameters,
    execute: executor,
    metadata: {
      source: ToolSource.OPENAPI,
      version: spec.info.version,
      tags: ['api', 'openapi']
    }
  };
};

const extractParametersFromOperation = (operation: OperationObject): ToolParameter[] => {
  const parameters: ToolParameter[] = [];
  
  // Extract from parameters
  if (operation.parameters) {
    for (const param of operation.parameters) {
      parameters.push(convertOpenAPIParameter(param));
    }
  }
  
  // Extract from request body
  if (operation.requestBody) {
    const content = operation.requestBody.content;
    if (content['application/json']?.schema) {
      const schema = content['application/json'].schema;
      if (schema.properties) {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          parameters.push({
            name: propName,
            type: mapOpenAPIType(propSchema.type || 'string'),
            description: propSchema.description || '',
            required: schema.required?.includes(propName) || false
          });
        }
      }
    }
  }
  
  return parameters;
};

const convertOpenAPIParameter = (param: ParameterObject): ToolParameter => {
  return {
    name: param.name,
    type: mapOpenAPIType(param.schema.type || 'string'),
    description: param.description || '',
    required: param.required || false,
    default: param.schema.default
  };
};

const mapOpenAPIType = (openApiType: string): ToolParameter['type'] => {
  switch (openApiType) {
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    default:
      return 'string';
  }
};

const executeOpenAPICall = async (
  path: string,
  method: string,
  params: Record<string, unknown>,
  spec: OpenAPISpec
): Promise<unknown> => {
  // This is a simplified implementation
  // In a real implementation, you'd use a proper HTTP client
  // and handle authentication, base URLs, etc.
  
  const baseUrl = 'https://api.example.com'; // Extract from spec
  const url = interpolatePath(path, params);
  const fullUrl = `${baseUrl}${url}`;
  
  const options: RequestInit = {
    method: method.toUpperCase(),
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  if (method.toUpperCase() !== 'GET') {
    options.body = JSON.stringify(params);
  }
  
  const response = await fetch(fullUrl, options);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
};

const interpolatePath = (path: string, params: Record<string, unknown>): string => {
  let result = path;
  
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`{${key}}`, String(value));
  }
  
  return result;
};

const isValidOperation = (operation: any): operation is OperationObject => {
  return typeof operation === 'object' && operation !== null;
};

// ========== External Tool Adapters ==========

export const createCrewAIAdapter = (crewAITool: any): Tool => {
  const name = crewAITool.name || 'crewai_tool';
  const description = crewAITool.description || 'CrewAI tool adapter';
  
  // Extract parameters from CrewAI tool
  const parameters = extractCrewAIParameters(crewAITool);
  
  const executor: ToolExecutor = async (params, context) => {
    try {
      const result = await crewAITool.run(params);
      return {
        success: true,
        data: result,
        metadata: { 
          source: 'crewai',
          executedAt: new Date() 
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'CrewAI tool execution failed',
        metadata: { 
          source: 'crewai',
          error, 
          executedAt: new Date() 
        }
      };
    }
  };
  
  return {
    name,
    description,
    parameters,
    execute: executor,
    metadata: {
      source: ToolSource.CREWAI,
      version: '1.0.0',
      tags: ['crewai', 'external']
    }
  };
};

export const createLangChainAdapter = (langChainTool: any): Tool => {
  const name = langChainTool.name || 'langchain_tool';
  const description = langChainTool.description || 'LangChain tool adapter';
  
  const parameters = extractLangChainParameters(langChainTool);
  
  const executor: ToolExecutor = async (params, context) => {
    try {
      const result = await langChainTool.call(params);
      return {
        success: true,
        data: result,
        metadata: { 
          source: 'langchain',
          executedAt: new Date() 
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'LangChain tool execution failed',
        metadata: { 
          source: 'langchain',
          error, 
          executedAt: new Date() 
        }
      };
    }
  };
  
  return {
    name,
    description,
    parameters,
    execute: executor,
    metadata: {
      source: ToolSource.LANGCHAIN,
      version: '1.0.0',
      tags: ['langchain', 'external']
    }
  };
};

const extractCrewAIParameters = (crewAITool: any): ToolParameter[] => {
  // This is a simplified extraction
  // Real implementation would inspect the tool's schema
  return [
    {
      name: 'input',
      type: 'string',
      description: 'Input for the CrewAI tool',
      required: true
    }
  ];
};

const extractLangChainParameters = (langChainTool: any): ToolParameter[] => {
  // This is a simplified extraction
  // Real implementation would inspect the tool's schema
  return [
    {
      name: 'input',
      type: 'string',
      description: 'Input for the LangChain tool',
      required: true
    }
  ];
};

// ========== Tool Validation ==========

export const validateTool = (tool: Tool): ValidationResult<Tool> => {
  const errors: string[] = [];
  
  if (!tool.name || tool.name.trim().length === 0) {
    errors.push('Tool name is required');
  }
  
  if (!tool.description || tool.description.trim().length === 0) {
    errors.push('Tool description is required');
  }
  
  if (!Array.isArray(tool.parameters)) {
    errors.push('Tool parameters must be an array');
  }
  
  if (typeof tool.execute !== 'function') {
    errors.push('Tool execute must be a function');
  }
  
  // Validate parameters
  for (const param of tool.parameters) {
    const paramValidation = validateToolParameter(param);
    if (!paramValidation.success) {
      errors.push(`Parameter '${param.name}': ${paramValidation.errors?.join(', ')}`);
    }
  }
  
  if (errors.length > 0) {
    return { success: false, errors };
  }
  
  return { success: true, data: tool };
};

export const validateToolParameter = (param: ToolParameter): ValidationResult<ToolParameter> => {
  const errors: string[] = [];
  
  if (!param.name || param.name.trim().length === 0) {
    errors.push('Parameter name is required');
  }
  
  if (!param.type) {
    errors.push('Parameter type is required');
  }
  
  if (!['string', 'number', 'boolean', 'object', 'array'].includes(param.type)) {
    errors.push(`Invalid parameter type: ${param.type}`);
  }
  
  if (!param.description || param.description.trim().length === 0) {
    errors.push('Parameter description is required');
  }
  
  if (errors.length > 0) {
    return { success: false, errors };
  }
  
  return { success: true, data: param };
};

export const validateToolParameters = (
  params: Record<string, unknown>,
  paramSchema: ToolParameter[]
): ValidationResult<Record<string, unknown>> => {
  const errors: string[] = [];
  
  // Check required parameters
  for (const param of paramSchema) {
    if (param.required && !(param.name in params)) {
      errors.push(`Required parameter '${param.name}' is missing`);
    }
  }
  
  // Validate parameter types
  for (const [name, value] of Object.entries(params)) {
    const paramDef = paramSchema.find(p => p.name === name);
    if (paramDef) {
      const typeValidation = validateParameterType(value, paramDef);
      if (!typeValidation) {
        errors.push(`Parameter '${name}' has invalid type (expected ${paramDef.type})`);
      }
    }
  }
  
  if (errors.length > 0) {
    return { success: false, errors };
  }
  
  return { success: true, data: params };
};

const validateParameterType = (value: unknown, param: ToolParameter): boolean => {
  switch (param.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    default:
      return false;
  }
};

// ========== Tool Execution ==========

export const executeTool = async (
  tool: Tool,
  params: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> => {
  try {
    // Validate tool
    const toolValidation = validateTool(tool);
    if (!toolValidation.success) {
      throwToolError(
        `Tool validation failed: ${toolValidation.errors?.join(', ')}`,
        tool.name
      );
    }
    
    // Execute tool
    const result = await tool.execute(params, context);
    
    return result;
  } catch (error) {
    if (error && typeof error === 'object' && (error as any).name === 'ToolError') {
      throw error;
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Tool execution failed',
      metadata: { 
        toolName: tool.name,
        error,
        executedAt: new Date() 
      }
    };
  }
};

export const executeTools = async (
  tools: Tool[],
  params: Record<string, Record<string, unknown>>,
  context: ToolContext
): Promise<Record<string, ToolResult>> => {
  const results: Record<string, ToolResult> = {};
  
  for (const tool of tools) {
    const toolParams = params[tool.name] || {};
    results[tool.name] = await executeTool(tool, toolParams, context);
  }
  
  return results;
};

// ========== Tool Utilities ==========

export const getToolByName = (tools: Tool[], name: string): Tool | null => {
  return tools.find(tool => tool.name === name) || null;
};

export const hasToolByName = (tools: Tool[], name: string): boolean => {
  return getToolByName(tools, name) !== null;
};

export const filterToolsBySource = (tools: Tool[], source: ToolMetadata['source']): Tool[] => {
  return tools.filter(tool => tool.metadata?.source === source);
};

export const getToolNames = (tools: Tool[]): string[] => {
  return tools.map(tool => tool.name);
};

export const cloneTool = (tool: Tool): Tool => {
  return {
    ...tool,
    parameters: [...tool.parameters],
    metadata: tool.metadata ? { ...tool.metadata } : undefined
  };
};

// Export createToolError from types for external use
export { createToolError }

// ========== Built-in Tools ==========

export const createEchoTool = (): Tool => {
  return createFunctionTool({
    name: 'echo',
    description: 'Echoes back the input message',
    execute: (params) => {
      const typedParams = params as { message: string };
      return typedParams.message;
    },
    parameters: [
      {
        name: 'message',
        type: ToolParameterType.STRING,
        description: 'The message to echo back',
        required: true
      }
    ]
  });
};

export const createCalculatorTool = (): Tool => {
  // Import safe math evaluator
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { evaluateMathExpression } = require('../../utils/safe-math');
  
  return createFunctionTool({
    name: 'calculator',
    description: 'Performs safe mathematical calculations',
    execute: (params) => {
      const typedParams = params as { expression: string };
      try {
        // Use safe math parser instead of eval
        const result = evaluateMathExpression(typedParams.expression);
        return { result, expression: typedParams.expression };
      } catch (error) {
        throw new Error(`Invalid expression: ${typedParams.expression}. ${error instanceof Error ? error.message : ''}`);
      }
    },
    parameters: [
      {
        name: 'expression',
        type: ToolParameterType.STRING,
        description: 'Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)", "2^3")',
        required: true
      }
    ]
  });
};

export const createTimestampTool = (): Tool => {
  return createFunctionTool({
    name: 'timestamp',
    description: 'Returns the current timestamp',
    execute: () => ({
      timestamp: new Date().toISOString(),
      unix: Date.now()
    }),
    parameters: []
  });
};