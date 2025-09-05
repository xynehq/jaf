import {
  LanguageModel,
  generateText,
  generateObject,
  ModelMessage,
  tool,
} from 'ai';
import { ModelProvider, Message, getTextContent } from '../core/types.js';

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

export const createAiSdkProvider = <Ctx>(
  model: unknown,
): ModelProvider<Ctx> => {
  const lm = model as LanguageModel;
  return {
    async getCompletion(state, agent) {
      const system = agent.instructions(state);

      // Convert JAF messages to AI SDK ModelMessages using standard OpenAI format
      const messages: ModelMessage[] = [];

      for (const msg of state.messages) {
        switch (msg.role) {
          case 'user':
            messages.push({ role: 'user', content: getTextContent(msg.content) });
            break;
          case 'assistant':
            if (msg.tool_calls && msg.tool_calls.length > 0) {
              // Assistant message with tool calls
              messages.push({
                role: 'assistant',
                content: getTextContent(msg.content),
                toolInvocations: msg.tool_calls.map(tc => ({
                  toolCallId: tc.id,
                  toolName: tc.function.name,
                  args: JSON.parse(tc.function.arguments),
                  state: 'call',
                })),
              } as any);
            } else {
              messages.push({ role: 'assistant', content: getTextContent(msg.content) });
            }
            break;
          case 'tool': {
            // Find the corresponding assistant message and update toolInvocations
            for (let i = messages.length - 1; i >= 0; i--) {
              const assistantMsg = messages[i];
              if (assistantMsg.role === 'assistant' && (assistantMsg as any).toolInvocations) {
                const toolInvocation = (assistantMsg as any).toolInvocations.find(
                  (inv: any) => inv.toolCallId === msg.tool_call_id
                );
                if (toolInvocation) {
                  toolInvocation.result = msg.content;
                  toolInvocation.state = 'result';
                  break;
                }
              }
            }
            break;
          }
        }
      }

      if (agent.outputCodec) {
        const { object } = await generateObject({
          model: lm,
          schema: agent.outputCodec as any,
          system,
          messages,
          temperature: agent.modelConfig?.temperature,
          maxOutputTokens: agent.modelConfig?.maxTokens,
        });

        return {
          message: {
            content: JSON.stringify(object),
          },
        };
      } else {
        // Check if the last message has completed tool invocations
        const lastMessage = messages[messages.length - 1];
        const hasCompletedTools = lastMessage?.role === 'assistant' &&
          (lastMessage as any).toolInvocations?.some((inv: any) => inv.state === 'result');
        
        console.log('[DEBUG] Last message analysis:', {
          role: lastMessage?.role,
          hasToolInvocations: !!(lastMessage as any).toolInvocations,
          completedToolsCount: (lastMessage as any).toolInvocations?.filter((inv: any) => inv.state === 'result').length || 0,
          hasCompletedTools
        });

        // Only provide tools if we don't have completed tool results
        const toolsForAiSDK: Record<string, any> | undefined =
          !hasCompletedTools && agent.tools && agent.tools.length > 0
            ? agent.tools.reduce(
                (acc, jafTool) => {
                  console.log('[DEBUG] Processing JAF tool:', {
                    name: jafTool.schema.name,
                    description: jafTool.schema.description,
                    parametersType: typeof jafTool.schema.parameters,
                    zodTypeName: (jafTool.schema.parameters._def as any)?.typeName,
                  });
                  
                  // Use AI SDK's tool() function with explicit type to avoid recursion
                  acc[jafTool.schema.name] = tool({
                    description: jafTool.schema.description,
                    inputSchema: jafTool.schema.parameters as any, // Cast to any to break type recursion
                  } as any);
                  
                  console.log(`[DEBUG] Created AI SDK tool for ${jafTool.schema.name}`);
                  return acc;
                },
                {} as Record<string, any>,
              )
            : undefined;
        
        console.log(`[DEBUG] Complete tools object passed to AI SDK with ${toolsForAiSDK ? Object.keys(toolsForAiSDK).length : 0} tools (hasCompletedTools: ${hasCompletedTools})`);
        
        try {
          console.log('[DEBUG] Messages being passed to AI SDK:', JSON.stringify(messages, null, 2));
          
          const completeResponse = await generateText({
            model: lm,
            system,
            messages,
            tools: toolsForAiSDK,
            temperature: agent.modelConfig?.temperature,
            maxOutputTokens: agent.modelConfig?.maxTokens,
          });
          
          console.log('[DEBUG] AI SDK generateText response:', {
            text: completeResponse.text?.slice(0, 100),
            toolCallsCount: completeResponse.toolCalls?.length ?? 0,
            toolCalls: completeResponse.toolCalls?.map((tc: any) => ({
              id: tc.toolCallId,
              name: tc.toolName,
              input: tc.input
            }))
          });
          
          return {
            message: {
              content: completeResponse.text,
              tool_calls: completeResponse.toolCalls?.map((tc: any) => ({
                id: tc.toolCallId,
                type: 'function' as const,
                function: {
                  name: tc.toolName,
                  arguments: JSON.stringify(tc.input),
                },
              })),
            },
          };
        } catch (error) {
          console.error('[DEBUG] AI SDK generateText error:', error);
          throw error;
        }
      }
    },
  };
};

/**
 * @deprecated Use `createAiSdkProvider` with a Vercel AI SDK `LanguageModel` instance instead.
 *
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
        content: getTextContent(msg.content),
      };
    case 'assistant':
      return {
        role: 'assistant',
        content: getTextContent(msg.content),
        tool_calls: msg.tool_calls as any,
      };
    case 'tool':
      return {
        role: 'tool',
        content: getTextContent(msg.content),
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
  console.log('[DEBUG] zodSchemaToJsonSchema input:', {
    typeName: zodSchema._def?.typeName,
    hasShape: typeof zodSchema._def?.shape,
    shapeKeys: zodSchema._def?.shape ? Object.keys(zodSchema._def.shape) : 'no shape',
    schema: JSON.stringify(zodSchema._def, null, 2).slice(0, 200)
  });

  if (zodSchema._def?.typeName === 'ZodObject') {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    
    // Handle both function and property access for shape
    const shape = typeof zodSchema._def.shape === 'function'
      ? zodSchema._def.shape()
      : zodSchema._def.shape;

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodSchemaToJsonSchema(value);
      if (!(value as any).isOptional()) {
        required.push(key);
      }
    }

    const result = {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };
    
    console.log('[DEBUG] ZodObject result:', JSON.stringify(result, null, 2));
    return result;
  }

  if (zodSchema._def?.typeName === 'ZodString') {
    const schema: any = { type: 'string' };
    if (zodSchema._def.description) {
      schema.description = zodSchema._def.description;
    }
    console.log('[DEBUG] ZodString result:', schema);
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
      items: zodSchemaToJsonSchema(zodSchema._def.type),
    };
  }

  if (zodSchema._def?.typeName === 'ZodOptional') {
    return zodSchemaToJsonSchema(zodSchema._def.innerType);
  }

  if (zodSchema._def?.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: zodSchema._def.values,
    };
  }

  console.log('[DEBUG] Fallback for unsupported type:', zodSchema._def?.typeName);
  return { type: 'string', description: 'Unsupported schema type' };
}
