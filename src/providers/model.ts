import OpenAI from "openai";
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

      // Return the choice with usage data attached for tracing
      return {
        ...resp.choices[0],
        usage: resp.usage,
        model: resp.model,
        id: resp.id,
        created: resp.created
      };
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