import OpenAI from "openai";
import { ModelProvider, RunState, Agent, RunConfig, Message, MessageContentPart } from '../core/types.js';

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

      // Check if any message contains image content
      const hasImageContent = state.messages.some(msg => 
        Array.isArray(msg.content) && 
        msg.content.some(part => part.type === 'image_url')
      );

      if (hasImageContent) {
        const supportsVision = await isVisionModel(model, baseURL);
        if (!supportsVision) {
          throw new Error(`Model ${model} does not support vision capabilities. Please use a vision-capable model like gpt-4o, claude-3-5-sonnet, or gemini-1.5-pro.`);
        }
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

async function isVisionModel(model: string, baseURL: string): Promise<boolean> {
  try {
    // Try to call LiteLLM's model info API to check vision support
    const response = await fetch(`${baseURL}/model_group/info`, {
      headers: {
        'accept': 'application/json'
      }
    });
    
    if (response.ok) {
      const data: any = await response.json();
      const modelInfo = data.data?.find((m: any) => 
        m.model_group === model || model.includes(m.model_group)
      );
      
      if (modelInfo?.supports_vision !== undefined) {
        return modelInfo.supports_vision;
      }
    }
  } catch (error) {
    console.warn(`[JAF:VISION] Could not check vision support via API: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  const knownVisionModels = [
  'gpt-4-vision-preview',
  'gpt-4o',
  'gpt-4o-mini', 
  'claude-sonnet-4',          
  'claude-sonnet-4-20250514', 
  'gemini-2.5-flash',
  'gemini-2.5-pro'      
];
  
  const isKnownVisionModel = knownVisionModels.some(visionModel => 
    model.toLowerCase().includes(visionModel.toLowerCase())
  );
  
  if (isKnownVisionModel) {
    console.log(`[JAF:VISION] Using fallback: ${model} is a known vision model`);
  }
  
  return isKnownVisionModel;
}

function convertMessage(msg: Message): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  switch (msg.role) {
    case 'user':
      return {
        role: 'user',
        content: Array.isArray(msg.content) 
          ? msg.content.map(convertContentPart) as any
          : msg.content
      };
    case 'assistant':
      return {
        role: 'assistant',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        tool_calls: msg.tool_calls as any
      };
    case 'tool':
      return {
        role: 'tool',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        tool_call_id: msg.tool_call_id!
      };
    default:
      throw new Error(`Unknown message role: ${(msg as any).role}`);
  }
}

function convertContentPart(part: MessageContentPart): OpenAI.Chat.Completions.ChatCompletionContentPart {
  switch (part.type) {
    case 'text':
      return {
        type: 'text',
        text: part.text
      };
    case 'image_url':
      return {
        type: 'image_url',
        image_url: {
          url: part.image_url.url,
          detail: part.image_url.detail
        }
      };
    default:
      throw new Error(`Unknown content part type: ${(part as any).type}`);
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