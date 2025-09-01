import OpenAI from "openai";
import { VertexAI } from '@google-cloud/vertexai';
import { ModelProvider, RunState, Agent, RunConfig, Message } from '../core/types.js';

export const makeLiteLLMProvider = <Ctx>(
  baseURL: string,
  apiKey = "anything"
): ModelProvider<Ctx> => {
  const client = new OpenAI({ 
    baseURL, 
    apiKey, 
    dangerouslyAllowBrowser: true 
  });

  return {
    async getCompletion(state, agent, config) {
      const model = config.modelOverride ?? agent.modelConfig?.name;

      if (!model) {
        throw new Error(`Model not specified for agent ${agent.name}`);
      }

      const systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: "system",
        content: agent.instructions(state)
      };

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        systemMessage,
        ...state.messages.map(convertMessage)
      ];

      const tools = agent.tools?.map(t => ({
        type: "function" as const,
        function: {
          name: t.schema.name,
          description: t.schema.description,
          parameters: zodSchemaToJsonSchema(t.schema.parameters),
        },
      }));

      const lastMessage = state.messages[state.messages.length - 1];
      const isAfterToolCall = lastMessage?.role === 'tool';

      const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
        model,
        messages,
        temperature: agent.modelConfig?.temperature,
        max_tokens: agent.modelConfig?.maxTokens,
        tools: tools && tools.length > 0 ? tools : undefined,
        tool_choice: (tools && tools.length > 0) ? (isAfterToolCall ? "auto" : undefined) : undefined,
        response_format: agent.outputCodec ? { type: "json_object" } : undefined,
      };

      console.log(`📞 Calling model: ${model} with params: ${JSON.stringify(requestParams, null, 2)}`);
      const resp = await client.chat.completions.create(requestParams);

      return resp.choices[0];
    },
  };
};

function convertMessage(msg: Message): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  switch (msg.role) {
    case 'user':
      return {
        role: 'user',
        content: msg.content
      };
    case 'assistant':
      return {
        role: 'assistant',
        content: msg.content,
        tool_calls: msg.tool_calls as any
      };
    case 'tool':
      return {
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.tool_call_id!
      };
    default:
      throw new Error(`Unknown message role: ${(msg as any).role}`);
  }
}

function zodSchemaToJsonSchema(zodSchema: any): any {
  if (zodSchema._def?.typeName === 'ZodObject') {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    
    for (const [key, value] of Object.entries(zodSchema._def.shape())) {
      properties[key] = zodSchemaToJsonSchema(value);
      if (!(value as any).isOptional()) {
        required.push(key);
      }
    }
    
    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false
    };
  }
  
  if (zodSchema._def?.typeName === 'ZodString') {
    const schema: any = { type: 'string' };
    if (zodSchema._def.description) {
      schema.description = zodSchema._def.description;
    }
    return schema;
  }
  
  if (zodSchema._def?.typeName === 'ZodNumber') {
    return { type: 'number' };
  }
  
  if (zodSchema._def?.typeName === 'ZodBoolean') {
    return { type: 'boolean' };
  }
  
  if (zodSchema._def?.typeName === 'ZodArray') {
    return {
      type: 'array',
      items: zodSchemaToJsonSchema(zodSchema._def.type)
    };
  }
  
  if (zodSchema._def?.typeName === 'ZodOptional') {
    return zodSchemaToJsonSchema(zodSchema._def.innerType);
  }
  
  if (zodSchema._def?.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: zodSchema._def.values
    };
  }
  
  return { type: 'string', description: 'Unsupported schema type' };
}

export const makeVertexAIProvider = <Ctx>(
  projectId: string,
  location: string = 'us-central1',
  defaultModel: string = 'gemini-1.5-flash'
): ModelProvider<Ctx> => {
  // Initialize Vertex AI - uses gcloud credentials automatically
  const vertexAI = new VertexAI({ 
    project: projectId, 
    location: location 
  });

  return {
    async getCompletion(state, agent, config) {
      const model = config.modelOverride ?? agent.modelConfig?.name ?? defaultModel;

      if (!model) {
        throw new Error(`Model not specified for agent ${agent.name}`);
      }

      try {
        console.log(`📞 Calling Vertex AI model: ${model} in project: ${projectId}, location: ${location}`);
        
        // Get the generative model
        const generativeModel = vertexAI.preview.getGenerativeModel({
          model: model,
          generationConfig: {
            temperature: agent.modelConfig?.temperature ?? 0.7,
            maxOutputTokens: agent.modelConfig?.maxTokens ?? 8192, // Increased default for gemini-2.5-pro
          },
          systemInstruction: agent.instructions(state),
        });

        // Handle tools if available
        let tools: any[] | undefined = undefined;
        if (agent.tools && agent.tools.length > 0) {
          tools = [{
            functionDeclarations: agent.tools.map(t => ({
              name: t.schema.name,
              description: t.schema.description,
              parameters: zodSchemaToVertexAISchema(t.schema.parameters),
            }))
          }];
        }

        // Convert JAF messages to Vertex AI format
        const contents = convertToVertexAIContents(state);
        console.log('🔍 Vertex AI request contents:', JSON.stringify(contents, null, 2));
        
        // Generate content
        const request = {
          contents,
          tools,
        };

        console.log('🔍 Vertex AI full request:', JSON.stringify(request, null, 2));
        const result = await generativeModel.generateContent(request);
        const response = result.response;
        
        console.log('🔍 Vertex AI raw response:', JSON.stringify(response, null, 2));
        
        // Get the candidates
        const candidates = response.candidates;
        if (!candidates || candidates.length === 0) {
          console.error('❌ No candidates returned from Vertex AI');
          throw new Error('No candidates returned from Vertex AI');
        }

        const candidate = candidates[0];
        console.log('🔍 First candidate:', JSON.stringify(candidate, null, 2));
        
        // Check for safety ratings or blocks
        if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION') {
          throw new Error(`Vertex AI response blocked due to: ${candidate.finishReason}`);
        }
        
        if (candidate.finishReason === 'MAX_TOKENS') {
          console.warn('⚠️ Vertex AI response was truncated due to max tokens limit');
        }
        
        const content = candidate.content;
        
        // Extract text content
        let textContent = '';
        const toolCalls: any[] = [];
        
        if (content && content.parts && Array.isArray(content.parts)) {
          for (const part of content.parts) {
            if (part.text) {
              textContent += part.text;
            }
            if (part.functionCall) {
              toolCalls.push({
                id: `call_${Math.random().toString(36).substr(2, 9)}`,
                type: 'function' as const,
                function: {
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args || {})
                }
              });
            }
          }
        } else {
          console.warn('⚠️ No parts found in Vertex AI response content');
          // The response content structure is missing parts - this might indicate an issue
          console.error('❌ Invalid response structure from Vertex AI - content has no parts');
        }

        console.log('🔍 Extracted text content:', textContent);
        console.log('🔍 Extracted tool calls:', toolCalls);

        const result_message = {
          content: textContent || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        };

        console.log('🔍 Final message:', JSON.stringify(result_message, null, 2));

        return {
          message: result_message
        };
      } catch (error) {
        console.error('Vertex AI API error:', error);
        throw new Error(`Vertex AI API call failed: ${error}`);
      }
    },
  };
};

function convertToVertexAIContents(state: RunState<any>): any[] {
  const contents = [];
  
  for (const message of state.messages) {
    if (message.role === 'user') {
      contents.push({
        role: 'user',
        parts: [{ text: message.content }]
      });
    } else if (message.role === 'assistant') {
      const parts = [];
      if (message.content) {
        parts.push({ text: message.content });
      }
      if (message.tool_calls) {
        // Add function calls
        for (const toolCall of message.tool_calls) {
          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments)
            }
          });
        }
      }
      
      // Only add if we have parts
      if (parts.length > 0) {
        contents.push({
          role: 'model',
          parts
        });
      }
    } else if (message.role === 'tool') {
      // For tool responses, we need to match the function name exactly
      // Find the previous assistant message with function calls to get the correct name
      let functionName = 'unknown_function';
      
      // Look backwards through contents to find the matching function call
      for (let i = contents.length - 1; i >= 0; i--) {
        const content = contents[i];
        if (content.role === 'model' && content.parts) {
          for (const part of content.parts) {
            if ('functionCall' in part && part.functionCall) {
              functionName = part.functionCall.name;
              break;
            }
          }
          if (functionName !== 'unknown_function') break;
        }
      }
      
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: functionName,
            response: {
              name: functionName,
              content: message.content
            }
          }
        }]
      });
    }
  }
  
  return contents;
}

function zodSchemaToVertexAISchema(zodSchema: any): any {
  if (zodSchema._def?.typeName === 'ZodObject') {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    
    for (const [key, value] of Object.entries(zodSchema._def.shape())) {
      properties[key] = zodSchemaToVertexAISchema(value);
      if (!(value as any).isOptional()) {
        required.push(key);
      }
    }
    
    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }
  
  if (zodSchema._def?.typeName === 'ZodString') {
    const schema: any = { type: 'string' };
    if (zodSchema._def.description) {
      schema.description = zodSchema._def.description;
    }
    return schema;
  }
  
  if (zodSchema._def?.typeName === 'ZodNumber') {
    return { type: 'number' };
  }
  
  if (zodSchema._def?.typeName === 'ZodBoolean') {
    return { type: 'boolean' };
  }
  
  if (zodSchema._def?.typeName === 'ZodArray') {
    return {
      type: 'array',
      items: zodSchemaToVertexAISchema(zodSchema._def.type)
    };
  }
  
  if (zodSchema._def?.typeName === 'ZodOptional') {
    return zodSchemaToVertexAISchema(zodSchema._def.innerType);
  }
  
  if (zodSchema._def?.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: zodSchema._def.values
    };
  }
  
  return { type: 'string', description: 'Unsupported schema type' };
}