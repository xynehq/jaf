/**
 * JAF ADK Layer - Type Converters
 * 
 * Functional type conversion between ADK and Core formats
 */

import { z } from 'zod';
import type { Message, RunState, Agent as CoreAgent, Tool as CoreTool } from '../../core/types.js';
import { getTextContent } from '../../core/types.js';
import {
  Content,
  Part,
  PartType,
  ContentRole,
  FunctionCall,
  FunctionResponse,
  Agent,
  Tool,
  Session,
  Model,
  ToolParameter,
  ToolParameterType
} from '../types.js';

// ========== Content Conversions ==========

export const convertAdkContentToCoreMessage = (content: Content): Message => {
  // Extract text content
  const textParts = content.parts.filter(p => String(p.type) === 'text');
  const textContent = textParts.map(p => p.text || '').join(' ').trim();
  
  // Extract function calls
  const functionCallParts = content.parts.filter(p => String(p.type) === 'function_call');
  const toolCalls = functionCallParts
    .map(p => p.functionCall)
    .filter(fc => fc !== undefined)
    .map(fc => ({
      id: fc!.id,
      type: 'function' as const,
      function: {
        name: fc!.name,
        arguments: JSON.stringify(fc!.args)
      }
    }));
  
  // Extract function responses
  const functionResponseParts = content.parts.filter(p => String(p.type) === 'function_response');
  const functionResponse = functionResponseParts.length > 0 ? functionResponseParts[0].functionResponse : undefined;
  
  // Determine role - function responses should always be 'tool' role
  const role = functionResponse ? 'tool' : convertAdkRoleToCoreRole(content.role);
  
  const message: any = {
    role: role as any,
    content: textContent
  };
  
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }
  
  if (functionResponse) {
    message.tool_call_id = functionResponse.id;
    message.content = typeof functionResponse.response === 'string' 
      ? functionResponse.response 
      : JSON.stringify(functionResponse.response);
  }
  
  return message;
};

export const convertCoreMessageToAdkContent = (message: Message): Content => {
  const parts: Part[] = [];
  
  // Add text content
  const textContent = getTextContent(message.content);
  if (textContent && textContent.trim()) {
    parts.push({
      type: PartType.TEXT,
      text: textContent
    });
  }
  
  // Add tool calls
  if (message.tool_calls) {
    for (const toolCall of message.tool_calls) {
      parts.push({
        type: PartType.FUNCTION_CALL,
        functionCall: {
          id: toolCall.id,
          name: toolCall.function.name,
          args: safeJsonParse(toolCall.function.arguments)
        }
      });
    }
  }
  
  // Add tool responses
  if (message.tool_call_id && message.role === 'tool') {
    parts.push({
      type: PartType.FUNCTION_RESPONSE,
      functionResponse: {
        id: message.tool_call_id,
        name: 'unknown', // Core doesn't track function name in responses
        response: safeJsonParse(getTextContent(message.content) || ''),
        success: true
      }
    });
  }
  
  return {
    role: convertCoreRoleToAdkRole(message.role),
    parts,
    metadata: {}
  };
};

// ========== Role Conversions ==========

export const convertAdkRoleToCoreRole = (adkRole: ContentRole | string): string => {
  switch (adkRole) {
    case ContentRole.USER:
    case 'user':
      return 'user';
    case ContentRole.MODEL:
    case 'model':
      return 'assistant';
    case ContentRole.SYSTEM:
    case 'system':
      return 'system';
    default:
      return 'user';
  }
};

export const convertCoreRoleToAdkRole = (coreRole: string): ContentRole => {
  switch (coreRole) {
    case 'user':
      return ContentRole.USER;
    case 'assistant':
      return ContentRole.MODEL;
    case 'system':
      return ContentRole.SYSTEM;
    case 'tool':
      return ContentRole.MODEL; // Tool responses become model content
    default:
      return ContentRole.USER;
  }
};

// ========== Session Conversions ==========

export const convertAdkSessionToCoreState = (session: Session, newMessage?: Content): RunState<any> => {
  const messages = session.messages.map(convertAdkContentToCoreMessage);
  
  if (newMessage) {
    messages.push(convertAdkContentToCoreMessage(newMessage));
  }
  
  return {
    runId: session.id as any, // Type conversion needed
    traceId: session.id as any, // Type conversion needed
    messages,
    currentAgentName: 'default', // ADK doesn't have explicit agent names in sessions
    context: {
      userId: session.userId,
      sessionId: session.id,
      artifacts: session.artifacts,
      ...session.metadata.properties
    },
    turnCount: session.messages.length
  };
};

export const convertCoreStateToAdkSession = (state: RunState<any>): Session => {
  return {
    id: String(state.runId),
    appName: (state.context as any)?.appName || 'default',
    userId: (state.context as any)?.userId || 'unknown',
    messages: state.messages.map(convertCoreMessageToAdkContent),
    artifacts: (state.context as any)?.artifacts || {},
    metadata: {
      created: new Date(),
      lastAccessed: new Date(),
      properties: {
        turnCount: state.turnCount,
        currentAgentName: state.currentAgentName
      }
    }
  };
};

// ========== Agent Conversions ==========

export const convertAdkAgentToCoreAgent = (adkAgent: Agent): CoreAgent<any, any> => {
  return {
    name: adkAgent.config.name,
    instructions: (state: any) => adkAgent.config.instruction,
    tools: adkAgent.config.tools?.map(convertAdkToolToCoreTool) || [],
    modelConfig: {
      name: convertAdkModelToCoreModel(adkAgent.config.model),
      temperature: 0.7, // Default, can be overridden
      maxTokens: 2000   // Default, can be overridden
    },
    handoffs: [],
    outputCodec: adkAgent.config.outputSchema ? createZodFromAdkSchema(adkAgent.config.outputSchema) : undefined
  };
};

export const convertCoreAgentToAdkAgent = (coreAgent: CoreAgent<any, any>): Agent => {
  return {
    id: coreAgent.name,
    config: {
      name: coreAgent.name,
      model: convertCoreModelToAdkModel(coreAgent.modelConfig?.name || 'gpt-4o'),
      instruction: typeof coreAgent.instructions === 'function' 
        ? coreAgent.instructions({} as any) 
        : String(coreAgent.instructions),
      description: `Agent: ${coreAgent.name}`,
      tools: coreAgent.tools?.map(convertCoreToolToAdkTool) || [],
      subAgents: []
    },
    metadata: {
      created: new Date(),
      version: '1.0.0'
    }
  };
};

// ========== Tool Conversions ==========

export const convertAdkToolToCoreTool = (adkTool: Tool): CoreTool<any, any> => {
  return {
    schema: {
      name: adkTool.name,
      description: adkTool.description,
      parameters: createZodFromAdkParameters(adkTool.parameters)
    },
    execute: async (params: any, context: any) => {
      // Convert Core context to ADK context
      const adkContext = convertCoreContextToAdkContext(context);
      const result = await adkTool.execute(params, adkContext);
      
      // Ensure result is string or ToolResult format
      if (typeof result === 'string') {
        return result;
      }
      
      // Convert ADK ToolResult to Core format if needed
      return result as any;
    }
  };
};

export const convertCoreToolToAdkTool = (coreTool: CoreTool<any, any>): Tool => {
  return {
    name: coreTool.schema.name,
    description: coreTool.schema.description,
    parameters: convertZodToAdkParameters(coreTool.schema.parameters),
    execute: async (params: any, context: any): Promise<any> => {
      // Convert ADK context to Core context
      const coreContext = convertAdkContextToCoreContext(context);
      return await coreTool.execute(params, coreContext);
    },
    metadata: {
      source: 'function' as const,
      version: '1.0.0'
    }
  };
};

// ========== Model Conversions ==========

export const convertAdkModelToCoreModel = (adkModel: Model | string): string => {
  // Map specific model enum values to their Core equivalents
  switch (adkModel) {
    case Model.GEMINI_2_0_FLASH:
    case 'gemini-2.0-flash':
      return 'gemini-2.0-flash';
    case Model.GEMINI_1_5_PRO:
    case 'gemini-1.5-pro':
      return 'gemini-1.5-pro';
    case Model.GEMINI_1_5_FLASH:
    case 'gemini-1.5-flash':
      return 'gemini-1.5-flash';
    case Model.GPT_4_TURBO:
    case 'gpt-4-turbo':
      return 'gpt-4-turbo';
    case Model.GPT_4:
    case 'gpt-4':
      return 'gpt-4';
    case Model.GPT_3_5_TURBO:
    case 'gpt-3.5-turbo':
      return 'gpt-3.5-turbo';
    case Model.CLAUDE_3_OPUS_20240229:
    case 'claude-3-opus-20240229':
      return 'claude-3-opus';
    case Model.CLAUDE_3_5_SONNET_LATEST:
    case 'claude-3-5-sonnet-latest':
      return 'claude-3-sonnet';
    case Model.CLAUDE_3_HAIKU_20240307:
    case 'claude-3-haiku-20240307':
      return 'claude-3-haiku';
    case Model.CUSTOM:
    case 'custom':
      return 'gpt-4o';
    default:
      // For any other string model, return as-is
      if (typeof adkModel === 'string') {
        return adkModel;
      }
      return 'gpt-4o';
  }
};

export const convertCoreModelToAdkModel = (coreModel: string): Model => {
  switch (coreModel) {
    case 'gemini-2.0-flash':
      return Model.GEMINI_2_0_FLASH;
    case 'gemini-1.5-pro':
      return Model.GEMINI_1_5_PRO;
    case 'gemini-1.5-flash':
      return Model.GEMINI_1_5_FLASH;
    case 'gpt-4-turbo':
      return Model.GPT_4_TURBO;
    case 'gpt-4':
      return Model.GPT_4;
    case 'gpt-3.5-turbo':
      return Model.GPT_3_5_TURBO;
    case 'claude-3-opus':
    case 'claude-3-opus-20240229':
      return Model.CLAUDE_3_OPUS_20240229;
    case 'claude-3-sonnet':
    case 'claude-3-5-sonnet':
    case 'claude-3-5-sonnet-latest':
      return Model.CLAUDE_3_5_SONNET_LATEST;
    case 'claude-3-haiku':
    case 'claude-3-haiku-20240307':
      return Model.CLAUDE_3_HAIKU_20240307;
    default:
      return Model.CUSTOM;
  }
};

// ========== Parameter Schema Conversions ==========

export const createZodFromAdkParameters = (parameters: ToolParameter[]): z.ZodSchema => {
  const shape: Record<string, z.ZodSchema> = {};
  
  for (const param of parameters) {
    let schema = createZodFromAdkParameter(param);
    
    if (!param.required) {
      schema = schema.optional();
    }
    
    shape[param.name] = schema;
  }
  
  return z.object(shape);
};

export const createZodFromAdkParameter = (param: ToolParameter): z.ZodSchema => {
  switch (param.type) {
    case ToolParameterType.STRING:
    case 'string':
      if (param.enum) {
        return z.enum(param.enum as [string, ...string[]]);
      }
      return z.string().describe(param.description);
    
    case ToolParameterType.NUMBER:
    case 'number':
      return z.number().describe(param.description);
    
    case ToolParameterType.BOOLEAN:
    case 'boolean':
      return z.boolean().describe(param.description);
    
    case ToolParameterType.ARRAY:
    case 'array':
      if (param.items) {
        return z.array(createZodFromAdkParameter(param.items)).describe(param.description);
      }
      return z.array(z.any()).describe(param.description);
    
    case ToolParameterType.OBJECT:
    case 'object':
      if (param.properties) {
        const shape: Record<string, z.ZodSchema> = {};
        for (const [key, value] of Object.entries(param.properties)) {
          shape[key] = createZodFromAdkParameter(value);
        }
        return z.object(shape).describe(param.description);
      }
      return z.object({}).describe(param.description);
    
    default:
      return z.any().describe(param.description);
  }
};

export const convertZodToAdkParameters = (zodSchema: z.ZodSchema): ToolParameter[] => {
  // This is a simplified conversion - in practice, you'd need more sophisticated Zod introspection
  // For now, return a basic parameter structure
  return [{
    name: 'input',
    type: ToolParameterType.OBJECT,
    description: 'Tool input parameters',
    required: true
  }];
};

export const createZodFromAdkSchema = (adkSchema: any): z.ZodSchema => {
  // Simple wrapper around ADK schema validation
  return z.any().refine((data) => {
    const result = adkSchema.validate(data);
    return result.success;
  });
};

// ========== Context Conversions ==========

export const convertCoreContextToAdkContext = (coreContext: any): any => {
  return {
    agent: coreContext.agent ? convertCoreAgentToAdkAgent(coreContext.agent) : undefined,
    session: coreContext.session ? convertCoreStateToAdkSession(coreContext.session) : undefined,
    message: coreContext.message ? convertCoreMessageToAdkContent(coreContext.message) : undefined,
    actions: coreContext.actions,
    metadata: coreContext.metadata
  };
};

export const convertAdkContextToCoreContext = (adkContext: any): any => {
  return {
    agent: adkContext.agent ? convertAdkAgentToCoreAgent(adkContext.agent) : undefined,
    session: adkContext.session ? convertAdkSessionToCoreState(adkContext.session) : undefined,
    message: adkContext.message ? convertAdkContentToCoreMessage(adkContext.message) : undefined,
    actions: adkContext.actions,
    metadata: adkContext.metadata
  };
};

// ========== Utility Functions ==========

export const safeJsonParse = (jsonString: string): any => {
  try {
    return JSON.parse(jsonString);
  } catch {
    return jsonString; // Return as string if parsing fails
  }
};

export const safeJsonStringify = (obj: any): string => {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
};

// ========== Function Call Utilities ==========

export const extractFunctionCallsFromAdkContent = (content: Content): FunctionCall[] => {
  return content.parts
    .filter(p => String(p.type) === 'function_call')
    .map(p => p.functionCall)
    .filter(fc => fc !== undefined) as FunctionCall[];
};

export const extractFunctionResponsesFromAdkContent = (content: Content): FunctionResponse[] => {
  return content.parts
    .filter(p => String(p.type) === 'function_response')
    .map(p => p.functionResponse)
    .filter(fr => fr !== undefined) as FunctionResponse[];
};

export const createAdkContentWithText = (text: string, role: ContentRole = ContentRole.MODEL): Content => {
  return {
    role,
    parts: [{
      type: PartType.TEXT,
      text
    }],
    metadata: {}
  };
};

export const createAdkContentWithFunctionCall = (functionCall: FunctionCall, role: ContentRole = ContentRole.MODEL): Content => {
  return {
    role,
    parts: [{
      type: PartType.FUNCTION_CALL,
      functionCall
    }],
    metadata: {}
  };
};

export const createAdkContentWithFunctionResponse = (functionResponse: FunctionResponse, role: ContentRole = ContentRole.MODEL): Content => {
  return {
    role,
    parts: [{
      type: PartType.FUNCTION_RESPONSE,
      functionResponse
    }],
    metadata: {}
  };
};