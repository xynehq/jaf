/**
 * JAF ADK Layer - LLM Service Bridge
 *
 * Bridges ADK types to Core ModelProvider interface following functional patterns
 */

import { ModelProvider } from '../../core/types.js';
import { makeLiteLLMProvider } from '../../providers/model.js';
import { withLLMRetry, withLLMTimeout, classifyLLMError, createLLMErrorLogger } from './error-handler.js';
import { convertAdkToolToCoreTool, convertAdkModelToCoreModel as convertModelToCoreModel, safeJsonParse } from './type-converters.js';
import {
  Agent,
  Content,
  Session,
  Model,
  FunctionCall,
  Part,
  PartType,
  ContentRole,
  ToolParameter
} from '../types.js';
import OpenAI from 'openai';
import { safeConsole } from '../../utils/logger.js';

// ========== ADK LLM Service Types ==========

export interface AdkLLMServiceConfig {
  provider: 'litellm' | 'openai' | 'anthropic' | 'google';
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
}

export interface AdkLLMResponse {
  content: Content;
  functionCalls: FunctionCall[];
  metadata: {
    model: string;
    tokensUsed?: number;
    finishReason?: string;
  };
}

export interface AdkLLMStreamChunk {
  delta: string;
  functionCall?: Partial<FunctionCall>;
  isDone: boolean;
}

export type AdkLLMService = {
  generateResponse: (
    agent: Agent,
    session: Session,
    message: Content,
    requestConfig?: { modelOverride?: string; temperature?: number; maxTokens?: number }
  ) => Promise<AdkLLMResponse>;
  
  generateStreamingResponse: (
    agent: Agent,
    session: Session,
    message: Content,
    requestConfig?: { modelOverride?: string; temperature?: number; maxTokens?: number }
  ) => AsyncGenerator<AdkLLMStreamChunk>;
};

// ========== LLM Service Factory ==========

export const createAdkLLMService = (config: AdkLLMServiceConfig): AdkLLMService => {
  // Create the underlying Core ModelProvider
  const coreProvider = createCoreProvider(config);
  const errorLogger = createLLMErrorLogger();
  
  // Wrap with error handling
  const generateResponseWithErrorHandling = withLLMTimeout(
    withLLMRetry(
      createGenerateResponse(coreProvider),
      { maxRetries: 3, baseDelay: 1000, maxDelay: 30000 },
      config.provider,
      config.defaultModel || 'unknown'
    ),
    30000, // 30 second timeout
    config.provider,
    config.defaultModel || 'unknown'
  );
  
  const generateStreamingResponseWithErrorHandling = async function* (
    agent: Agent,
    session: Session,
    message: Content,
    requestConfig?: { modelOverride?: string; temperature?: number; maxTokens?: number }
  ): AsyncGenerator<AdkLLMStreamChunk> {
    try {
      const streamGenerator = createGenerateStreamingResponse(coreProvider);
      yield* streamGenerator(agent, session, message, requestConfig);
    } catch (error) {
      const llmError = error instanceof Error 
        ? classifyLLMError(error, config.provider, requestConfig?.modelOverride || config.defaultModel || 'unknown')
        : new Error('Unknown streaming error');
      
      errorLogger.logError(llmError as any, { agent: agent.config.name, streaming: true });
      throw llmError;
    }
  };
  
  return {
    generateResponse: async (agent, session, message, requestConfig) => {
      try {
        return await generateResponseWithErrorHandling(agent, session, message, requestConfig);
      } catch (error) {
        const llmError = error instanceof Error 
          ? classifyLLMError(error, config.provider, requestConfig?.modelOverride || config.defaultModel || 'unknown')
          : new Error('Unknown error');
        
        errorLogger.logError(llmError as any, { agent: agent.config.name });
        throw llmError;
      }
    },
    generateStreamingResponse: generateStreamingResponseWithErrorHandling
  };
};

// ========== Core Provider Creation ==========

const createCoreProvider = (config: AdkLLMServiceConfig): ModelProvider<any> => {

  // Store config for streaming
  (global as any).__adk_llm_config = config;

  switch (config.provider) {
    case 'litellm': {
      const litellmUrl = config.baseUrl || process.env.LITELLM_URL || 'http://localhost:4000';
      const litellmKey = config.apiKey || process.env.LITELLM_API_KEY || 'anything';
      // console.log('🔗 [LLM-DEBUG] Creating LiteLLM provider with:', { url: litellmUrl, key: `${litellmKey.substring(0, 10)}...` });
      return makeLiteLLMProvider(litellmUrl, litellmKey);
    }
    
    case 'openai': {
      const openaiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
      return makeLiteLLMProvider('https://api.openai.com/v1', openaiKey);
    }
    
    case 'anthropic': {
      const anthropicKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
      return makeLiteLLMProvider('https://api.anthropic.com', anthropicKey);
    }
    
    case 'google': {
      const googleKey = config.apiKey || process.env.GOOGLE_API_KEY || '';
      return makeLiteLLMProvider('https://generativelanguage.googleapis.com/v1beta', googleKey);
    }
    
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
};

// ========== Response Generation ==========

const createGenerateResponse = (coreProvider: ModelProvider<any>) => {
  return async (
    agent: Agent,
    session: Session,
    message: Content,
    config?: { modelOverride?: string; temperature?: number; maxTokens?: number }
  ): Promise<AdkLLMResponse> => {
    // console.log('🚀 [LLM-DEBUG] Starting API call...');
    // console.log('📤 [LLM-DEBUG] Agent:', { name: agent.config.name, model: agent.config.model });
    // console.log('📤 [LLM-DEBUG] Message:', { role: message.role, text: message.parts.map(p => p.text).join('') });
    // console.log('📤 [LLM-DEBUG] Config:', config);
    
    // Convert ADK types to Core types
    const coreState = convertAdkSessionToCoreState(session, message);
    const coreAgent = convertAdkAgentToCoreAgent(agent);
    const coreConfig = convertAdkConfigToCoreConfig(config, agent);
    
    // console.log('📡 [LLM-DEBUG] Calling coreProvider.getCompletion...');
    
    // Call Core ModelProvider
    const coreResponse = await coreProvider.getCompletion(coreState, coreAgent, coreConfig);
    
    // console.log('📥 [LLM-DEBUG] Raw Core Response:', coreResponse);
    // console.log('✅ [LLM-DEBUG] API call successful!');
    
    // Convert Core response back to ADK format
    const adkResponse = convertCoreResponseToAdkResponse(coreResponse, config?.modelOverride || agent.config.model.toString());
    
    return adkResponse;
  };
};

// ========== Streaming Response Generation ==========

const createGenerateStreamingResponse = (coreProvider: ModelProvider<any>) => {
  return async function* (
    agent: Agent,
    session: Session,
    message: Content,
    config?: { modelOverride?: string; temperature?: number; maxTokens?: number }
  ): AsyncGenerator<AdkLLMStreamChunk> {
    // console.log('🌊 [LLM-DEBUG] Starting streaming API call...');
    
    // Get OpenAI client directly for streaming support
    const { client, model } = await getStreamingClient(config, agent);
    
    // Convert ADK types to OpenAI format
    const coreState = convertAdkSessionToCoreState(session, message);
    const coreAgent = convertAdkAgentToCoreAgent(agent);
    
    // Prepare messages for OpenAI
    const systemMessage = {
      role: 'system' as const,
      content: agent.config.instruction
    };
    
    const messages = [
      systemMessage,
      ...coreState.messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
        ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {})
      }))
    ];
    
    // Prepare tools if any
    const tools = agent.config.tools.length > 0 ? agent.config.tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: convertAdkParametersToJsonSchema(t.parameters)
      }
    })) : undefined;
    
    // Create streaming completion
    const stream = await client.chat.completions.create({
      model: model,
      messages: messages as any,
      temperature: config?.temperature ?? 0.7,
      max_tokens: config?.maxTokens ?? 2000,
      tools: tools,
      stream: true
    });
    
    let accumulatedText = '';
      let currentFunctionCall: Partial<FunctionCall> | null = null;
      
      // Process the stream
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        
        if (!delta) continue;
        
        // Handle text content
        if (delta.content) {
          accumulatedText += delta.content;
          yield {
            delta: delta.content,
            isDone: false
          };
        }
        
        // Handle function calls
        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            if (toolCall.function?.name) {
              currentFunctionCall = {
                id: toolCall.id || '',
                name: toolCall.function.name,
                args: {}
              };
            }
            
            if (toolCall.function?.arguments) {
              if (currentFunctionCall) {
                // Accumulate arguments
                const argString = (currentFunctionCall.args as any).__raw_args || '';
                (currentFunctionCall.args as any).__raw_args = argString + toolCall.function.arguments;
                
                // Try to parse complete arguments
                try {
                  currentFunctionCall.args = JSON.parse((currentFunctionCall.args as any).__raw_args);
                  delete (currentFunctionCall.args as any).__raw_args;
                } catch {
                  // Arguments not complete yet
                }
              }
            }
          }
        }
        
        // Check if we have a complete function call
        if (currentFunctionCall && currentFunctionCall.id && currentFunctionCall.name && 
            currentFunctionCall.args && !(currentFunctionCall.args as any).__raw_args) {
          yield {
            delta: '',
            functionCall: currentFunctionCall as FunctionCall,
            isDone: false
          };
          currentFunctionCall = null;
        }
      }
      
      // Final chunk
      yield {
        delta: '',
        isDone: true
      };
    
    // console.log('✅ [LLM-DEBUG] Streaming completed successfully');
  };
};

// ========== Type Conversion Functions ==========

const convertAdkSessionToCoreState = (session: Session, newMessage: Content): any => {
  // Convert ADK session messages to Core format
  const coreMessages = session.messages.map(convertAdkContentToCoreMessage);
  coreMessages.push(convertAdkContentToCoreMessage(newMessage));
  
  return {
    runId: session.id,
    traceId: session.id, // Use session ID as trace ID for now
    messages: coreMessages,
    currentAgentName: 'default', // ADK doesn't have explicit agent names
    context: {
      userId: session.userId,
      sessionId: session.id,
      artifacts: session.artifacts
    },
    turnCount: session.messages.length
  };
};

const convertAdkContentToCoreMessage = (content: Content): any => {
  const role = convertAdkRoleToCoreRole(content.role);
  
  // Handle text content
  const textParts = content.parts.filter(p => p.type === PartType.TEXT);
  const textContent = textParts.map(p => p.text || '').join(' ');
  
  // Handle function calls
  const functionCalls = content.parts
    .filter(p => p.type === PartType.FUNCTION_CALL)
    .map(p => p.functionCall)
    .filter(fc => fc !== undefined);
  
  // Handle function responses
  const functionResponses = content.parts
    .filter(p => p.type === PartType.FUNCTION_RESPONSE)
    .map(p => p.functionResponse)
    .filter(fr => fr !== undefined);
  
  const message: any = {
    role,
    content: textContent
  };
  
  if (functionCalls.length > 0) {
    message.tool_calls = functionCalls.map(fc => ({
      id: fc!.id,
      type: 'function' as const,
      function: {
        name: fc!.name,
        arguments: JSON.stringify(fc!.args)
      }
    }));
  }
  
  if (functionResponses.length > 0 && role === 'tool') {
    const fr = functionResponses[0]!;
    message.tool_call_id = fr.id;
    message.content = typeof fr.response === 'string' ? fr.response : JSON.stringify(fr.response);
  }
  
  return message;
};

const convertAdkRoleToCoreRole = (adkRole: ContentRole | string): string => {
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
    case 'tool':
      return 'tool';
    default:
      return 'user';
  }
};

const convertAdkAgentToCoreAgent = (adkAgent: Agent): any => {
  return {
    name: adkAgent.config.name,
    instructions: () => adkAgent.config.instruction,
    tools: adkAgent.config.tools.map(convertAdkToolToCoreTool),
    modelConfig: {
      name: convertModelToCoreModel(adkAgent.config.model),
      temperature: 0.7, // Default temperature
      maxTokens: 2000   // Default max tokens
    },
    handoffs: [],
    outputCodec: adkAgent.config.outputSchema ? {
      safeParse: (data: any) => adkAgent.config.outputSchema!.validate(data)
    } : undefined
  };
};

const convertAdkToolToCoreool = (adkTool: any): any => {
  return {
    schema: {
      name: adkTool.name,
      description: adkTool.description,
      parameters: convertAdkParametersToCoreParameters(adkTool.parameters)
    },
    execute: async (params: any, context: any) => {
      // Call the ADK tool executor and convert context
      const adkContext = convertCoreContextToAdkContext(context);
      return await adkTool.execute(params, adkContext);
    }
  };
};

const convertAdkParametersToCoreParameters = (adkParams: any[]): any => {
  // Convert ADK parameters to Zod-like schema
  const properties: any = {};
  const required: string[] = [];
  
  for (const param of adkParams) {
    properties[param.name] = {
      type: param.type,
      description: param.description
    };
    
    if (param.required) {
      required.push(param.name);
    }
  }
  
  return {
    safeParse: (data: any) => {
      // Simple validation
      const errors: string[] = [];
      
      for (const req of required) {
        if (!(req in data)) {
          errors.push(`Missing required parameter: ${req}`);
        }
      }
      
      if (errors.length > 0) {
        return { success: false, error: { issues: errors.map(e => ({ message: e })) } };
      }
      
      return { success: true, data };
    }
  };
};

const convertAdkModelToCoreModel = (adkModel: Model | string): string => {
  if (typeof adkModel === 'string') {
    return adkModel;
  }
  
  switch (adkModel) {
    case Model.GEMINI_2_0_FLASH:
      return 'gemini-2.0-flash';
    case Model.GEMINI_1_5_PRO:
      return 'gemini-1.5-pro';
    case Model.GEMINI_1_5_FLASH:
      return 'gemini-1.5-flash';
    case Model.GPT_4_TURBO:
      return 'gpt-4-turbo';
    case Model.GPT_4:
      return 'gpt-4';
    case Model.GPT_3_5_TURBO:
      return 'gpt-3.5-turbo';
    case Model.CLAUDE_3_OPUS_20240229:
      return 'claude-3-opus-20240229';
    case Model.CLAUDE_3_5_SONNET_LATEST:
      return 'claude-3-5-sonnet-latest';
    case Model.CLAUDE_3_HAIKU_20240307:
      return 'claude-3-haiku-20240307';
    default:
      return 'gpt-4o';
  }
};

const convertAdkConfigToCoreConfig = (
  adkConfig?: { modelOverride?: string; temperature?: number; maxTokens?: number },
  agent?: Agent
): any => {
  return {
    agentRegistry: new Map(), // Empty for now
    modelProvider: null as any, // Will be set by caller
    modelOverride: adkConfig?.modelOverride,
    maxTurns: 50,
    temperature: adkConfig?.temperature,
    maxTokens: adkConfig?.maxTokens
  };
};

const convertCoreResponseToAdkResponse = (coreResponse: any, model: string): AdkLLMResponse => {
  const content = convertCoreMessageToAdkContent(coreResponse);
  const functionCalls = extractFunctionCallsFromCoreResponse(coreResponse);
  
  return {
    content,
    functionCalls,
    metadata: {
      model,
      finishReason: 'stop'
    }
  };
};

const convertCoreMessageToAdkContent = (coreResponse: any): Content => {
  const parts: Part[] = [];
  
  // Add text content if present
  if (coreResponse.message?.content) {
    parts.push({
      type: PartType.TEXT,
      text: coreResponse.message.content
    });
  }
  
  // Add function calls if present
  if (coreResponse.message?.tool_calls) {
    for (const toolCall of coreResponse.message.tool_calls) {
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
  
  return {
    role: ContentRole.MODEL,
    parts,
    metadata: {}
  };
};

const extractFunctionCallsFromCoreResponse = (coreResponse: any): FunctionCall[] => {
  if (!coreResponse.message?.tool_calls) {
    return [];
  }
  
  return coreResponse.message.tool_calls.map((toolCall: any) => ({
    id: toolCall.id,
    name: toolCall.function.name,
    args: safeJsonParse(toolCall.function.arguments)
  }));
};

const convertCoreContextToAdkContext = (coreContext: any): any => {
  // Convert Core tool context to ADK tool context
  return {
    agent: coreContext.agent, // Will need proper conversion
    session: coreContext.session, // Will need proper conversion
    message: coreContext.message, // Will need proper conversion
    actions: coreContext.actions,
    metadata: coreContext.metadata
  };
};

// ========== Streaming Helpers ==========

const getStreamingClient = async (
  config?: { modelOverride?: string },
  agent?: Agent
): Promise<{ client: OpenAI, model: string }> => {
  // Get the stored config from service creation
  const serviceConfig = (global as any).__adk_llm_config as AdkLLMServiceConfig;
  if (!serviceConfig) {
    throw new Error('LLM service not properly initialized');
  }
  
  let client: OpenAI;
  let model: string;
  
  switch (serviceConfig.provider) {
    case 'openai': {
      const openaiKey = serviceConfig.apiKey || process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        throw new Error('OPENAI_API_KEY is required for OpenAI streaming');
      }
      
      client = new OpenAI({
        apiKey: openaiKey,
        dangerouslyAllowBrowser: true
      });

      model = (agent ? convertModelToCoreModel(agent.config.model) : undefined) || config?.modelOverride || serviceConfig.defaultModel || 'gpt-4o';
      break;
    }
      
    case 'litellm': {
      const litellmUrl = serviceConfig.baseUrl || process.env.LITELLM_URL || 'http://localhost:4000';
      const litellmKey = serviceConfig.apiKey || process.env.LITELLM_API_KEY || 'anything';
      
      client = new OpenAI({
        baseURL: litellmUrl,
        apiKey: litellmKey,
        dangerouslyAllowBrowser: true
      });

      model = (agent ? convertModelToCoreModel(agent.config.model) : undefined) || config?.modelOverride || serviceConfig.defaultModel || 'gpt-4o';
      break;
    }
      
    case 'anthropic': {
      // For Anthropic via LiteLLM proxy
      const anthropicUrl = serviceConfig.baseUrl || process.env.LITELLM_URL || 'http://localhost:4000';
      const anthropicKey = serviceConfig.apiKey || process.env.ANTHROPIC_API_KEY || process.env.LITELLM_API_KEY || 'anything';
      
      client = new OpenAI({
        baseURL: anthropicUrl,
        apiKey: anthropicKey,
        dangerouslyAllowBrowser: true
      });

      // Use claude model for Anthropic
      model = (agent ? convertModelToCoreModel(agent.config.model) : undefined) || config?.modelOverride || serviceConfig.defaultModel || 'claude-3-sonnet';
      break;
    }
      
    case 'google': {
      // For Google via LiteLLM proxy
      const googleUrl = serviceConfig.baseUrl || process.env.LITELLM_URL || 'http://localhost:4000';
      const googleKey = serviceConfig.apiKey || process.env.GOOGLE_API_KEY || process.env.LITELLM_API_KEY || 'anything';
      
      client = new OpenAI({
        baseURL: googleUrl,
        apiKey: googleKey,
        dangerouslyAllowBrowser: true
      });

      // Use gemini model for Google
      model = (agent ? convertModelToCoreModel(agent.config.model) : undefined) || config?.modelOverride || serviceConfig.defaultModel || 'gemini-1.5-pro';
      break;
    }
      
    default:
      throw new Error(`Unsupported streaming provider: ${serviceConfig.provider}`);
  }
  
  return { client, model };
};

const convertAdkParametersToJsonSchema = (parameters: ToolParameter[]): any => {
  const properties: any = {};
  const required: string[] = [];
  
  for (const param of parameters) {
    properties[param.name] = {
      type: param.type,
      description: param.description,
      ...(param.enum ? { enum: param.enum } : {}),
      ...(param.properties ? { properties: convertAdkParametersToJsonSchema(Object.values(param.properties)) } : {}),
      ...(param.items ? { items: convertAdkParametersToJsonSchema([param.items])[param.items.name] } : {})
    };
    
    if (param.required !== false) {
      required.push(param.name);
    }
  }
  
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false
  };
};

// ========== Default Service Instance ==========

export const createDefaultAdkLLMService = (): AdkLLMService => {
  return createAdkLLMService({
    provider: 'litellm',
    baseUrl: process.env.LITELLM_URL || 'http://localhost:4000',
    apiKey: process.env.LITELLM_API_KEY || 'anything',
    defaultModel: process.env.LITELLM_MODEL || 'gpt-4o'
  });
};