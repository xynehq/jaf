import { ModelProvider, Message } from '../core/types.js';

export type AiSdkFunctionTool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: any;
  };
};

export type AiSdkChatMessageParam =
  | { role: 'system'; content: string }
  | {
      role: 'user' | 'assistant' | 'tool';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string | any;
        };
      }>;
      tool_call_id?: string;
    };

export type AiSdkChatRequest = {
  model: string;
  messages: AiSdkChatMessageParam[];
  temperature?: number;
  // Support both OpenAI-style and AI SDK-style naming for token limits
  max_tokens?: number;
  maxTokens?: number;
  tools?: AiSdkFunctionTool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'json_object' };
  // Allow arbitrary provider-specific fields
  [key: string]: any;
};

export type AiSdkChatResponse = {
  // Prefer a single normalized message if provided by the client
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string | any;
      };
    }>;
  };
  // Fallbacks for OpenAI-compatible responses
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string | any;
        };
      }>;
    };
  }>;
  // Fallback for plain-text responses (e.g., ai SDK generateText)
  text?: string | null;

  // Optional metadata if available
  id?: string;
  model?: string;
  created?: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };

  [key: string]: any;
};

export interface AiSdkClient {
  chat: (request: AiSdkChatRequest) => Promise<AiSdkChatResponse>;
}

/**
 * AI SDK-backed ModelProvider
 *
 * This adapter normalizes JAF Core state/messages/tools into a generic AI SDK chat request
 * and converts the response back into the Core-standard assistant message with optional tool_calls.
 *
 * Usage:
 *   const provider = makeAiSdkProvider(createMyAiSdkClient(...));
 *   // where client.chat({ ... }) performs the actual call via the Vercel AI SDK or a compatible wrapper.
 */
export const makeAiSdkProvider = <Ctx>(
  client: AiSdkClient
): ModelProvider<Ctx> => {
  return {
    async getCompletion(state, agent, config) {
      const model = config.modelOverride ?? agent.modelConfig?.name;

      if (!model) {
        throw new Error(`Model not specified for agent ${agent.name}`);
      }

      // Build system + conversation messages
      const systemMessage: AiSdkChatMessageParam = {
        role: 'system',
        content: agent.instructions(state),
      };

      const messages: AiSdkChatMessageParam[] = [
        systemMessage,
        ...state.messages.map(convertMessage),
      ];

      // Map JAF Zod tool schemas to JSON Schema function tools
      const tools: AiSdkFunctionTool[] | undefined = agent.tools?.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.schema.name,
          description: t.schema.description,
          parameters: zodSchemaToJsonSchema(t.schema.parameters),
        },
      }));

      const lastMessage = state.messages[state.messages.length - 1];
      const isAfterToolCall = lastMessage?.role === 'tool';

      const request: AiSdkChatRequest = {
        model,
        messages,
        temperature: agent.modelConfig?.temperature,
        // Provide both names to maximize compatibility across SDKs
        max_tokens: agent.modelConfig?.maxTokens,
        maxTokens: agent.modelConfig?.maxTokens,
        tools: tools && tools.length > 0 ? tools : undefined,
        tool_choice:
          tools && tools.length > 0
            ? isAfterToolCall
              ? 'auto'
              : undefined
            : undefined,
        response_format: agent.outputCodec ? { type: 'json_object' } : undefined,
      };

      // Keep logs minimal to avoid leaking large prompts in stdout
      console.log(
        `📞 [AI SDK] model=${model}, messages=${messages.length}, tools=${tools?.length ?? 0}, json=${Boolean(agent.outputCodec)}`
      );

      const resp = await client.chat(request);

      // Normalize response to Core-standard assistant message shape
      const normalized = normalizeResponse(resp);

      if (!normalized) {
        // Return an empty envelope if provider returned nothing meaningful
        return {};
      }

      return { message: normalized };
    },
  };
};

// Convert JAF Message -> AI SDK chat param
function convertMessage(msg: Message): AiSdkChatMessageParam {
  switch (msg.role) {
    case 'user':
      return {
        role: 'user',
        content: msg.content,
      };
    case 'assistant':
      return {
        role: 'assistant',
        content: msg.content,
        tool_calls: msg.tool_calls as any,
      };
    case 'tool':
      return {
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.tool_call_id!,
      };
    default:
      throw new Error(`Unknown message role: ${(msg as any).role}`);
  }
}

// Normalize various possible AI SDK response shapes into Core's assistant message
function normalizeResponse(
  resp: AiSdkChatResponse
):
  | {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    }
  | undefined {
  // Preferred: explicit single message
  if (resp && resp.message) {
    return {
      content: resp.message.content ?? null,
      tool_calls: normalizeToolCalls(resp.message.tool_calls),
    };
  }

  // OpenAI-style: choices[0].message
  const choiceMsg = resp?.choices?.[0]?.message;
  if (choiceMsg) {
    return {
      content: choiceMsg.content ?? null,
      tool_calls: normalizeToolCalls(choiceMsg.tool_calls),
    };
  }

  // Plain text fallback
  if (typeof resp?.text === 'string' || resp?.text === null) {
    return {
      content: resp.text ?? null,
      tool_calls: undefined,
    };
  }

  return undefined;
}

function normalizeToolCalls(
  calls:
    | Array<{
        id?: string;
        type?: string;
        function?:
          | {
              name?: string;
              arguments?: string | any;
            }
          | undefined;
        name?: string;
        arguments?: string | any;
      }>
    | undefined
):
  | Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>
  | undefined {
  if (!Array.isArray(calls) || calls.length === 0) return undefined;

  return calls.map((c) => {
    const id = c.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
    const name = c.function?.name ?? (c as any).name ?? 'unknown_function';
    const rawArgs = c.function?.arguments ?? (c as any).arguments ?? {};
    const args =
      typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
    return {
      id,
      type: 'function' as const,
      function: {
        name,
        arguments: args,
      },
    };
  });
}

// Minimal Zod -> JSON Schema converter (mirrors makeLiteLLMProvider)
function zodSchemaToJsonSchema(zodSchema: any): any {
  if (zodSchema?._def?.typeName === 'ZodObject') {
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
      additionalProperties: false,
    };
  }

  if (zodSchema?._def?.typeName === 'ZodString') {
    const schema: any = { type: 'string' };
    if (zodSchema._def.description) {
      schema.description = zodSchema._def.description;
    }
    return schema;
  }

  if (zodSchema?._def?.typeName === 'ZodNumber') {
    return { type: 'number' };
  }

  if (zodSchema?._def?.typeName === 'ZodBoolean') {
    return { type: 'boolean' };
  }

  if (zodSchema?._def?.typeName === 'ZodArray') {
    return {
      type: 'array',
      items: zodSchemaToJsonSchema(zodSchema._def.type),
    };
  }

  if (zodSchema?._def?.typeName === 'ZodOptional') {
    return zodSchemaToJsonSchema(zodSchema._def.innerType);
  }

  if (zodSchema?._def?.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: zodSchema._def.values,
    };
  }

  return { type: 'string', description: 'Unsupported schema type' };
}