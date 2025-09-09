import {
  LanguageModel,
  generateText,
  generateObject,
  ModelMessage,
  JSONValue,
  Schema,
  ToolSet,
  ToolCallPart,
  ToolResultPart,
  TextPart,
  tool,
  zodSchema,
} from 'ai';
import { ModelProvider, Message, getTextContent } from '../core/types.js';

export type AiSdkFunctionTool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: unknown;
  };
};

function safeParseJson(text: string): JSONValue {
  try {
    return JSON.parse(text) as JSONValue;
  } catch {
    return text;
  }
}

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
  [key: string]: unknown;
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

  [key: string]: unknown;
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
      const toolNameById = new Map<string, string>();

      for (const msg of state.messages) {
        switch (msg.role) {
          case 'user':
            messages.push({ role: 'user', content: getTextContent(msg.content) });
            break;
          case 'assistant':
            if (msg.tool_calls && msg.tool_calls.length > 0) {
              // Assistant message with tool calls as content parts
              const parts: Array<TextPart | ToolCallPart> = [];
              const text = getTextContent(msg.content);
              if (text) parts.push({ type: 'text', text });
              for (const tc of msg.tool_calls) {
                toolNameById.set(tc.id, tc.function.name);
                parts.push({
                  type: 'tool-call',
                  toolCallId: tc.id,
                  toolName: tc.function.name,
                  input: safeParseJson(tc.function.arguments),
                });
              }
              messages.push({ role: 'assistant', content: parts });
            } else {
              messages.push({ role: 'assistant', content: getTextContent(msg.content) });
            }
            break;
          case 'tool': {
            const toolCallId = msg.tool_call_id!;
            const toolName = toolNameById.get(toolCallId) ?? 'unknown';
            const parsed = safeParseJson(getTextContent(msg.content));
            const output: ToolResultPart['output'] =
              typeof parsed === 'string'
                ? { type: 'text', value: parsed }
                : { type: 'json', value: parsed };
            const content: ToolResultPart[] = [
              { type: 'tool-result', toolCallId, toolName, output },
            ];
            messages.push({ role: 'tool', content });
            break;
          }
        }
      }

      if (agent.outputCodec) {
        const toSchema = zodSchema as unknown as (s: unknown) => Schema;
        const go = generateObject as unknown as (opts: unknown) => Promise<unknown>;
        const resultUnknown = await go({
          model: lm,
          schema: toSchema((agent.outputCodec as unknown) as import('zod').ZodType<unknown>),
          system,
          messages,
          temperature: agent.modelConfig?.temperature,
          maxOutputTokens: agent.modelConfig?.maxTokens,
        });
        const object = (resultUnknown as { object: unknown }).object;

        return {
          message: {
            content: JSON.stringify(object),
          },
        };
      } else {
        // Check if the last original JAF message contained tool results
        const lastJafMessage = state.messages[state.messages.length - 1];
        const hasCompletedTools = lastJafMessage?.role === 'tool';

        // Only provide tools if we don't have completed tool results
        const toolsForAiSDK: ToolSet | undefined =
          !hasCompletedTools && agent.tools && agent.tools.length > 0
            ? agent.tools.reduce(
                (acc, jafTool) => {
                  // Use AI SDK's tool() and zodSchema() to keep types while avoiding deep instantiation
                  const toSchema = zodSchema as unknown as (s: unknown) => Schema;
                  acc[jafTool.schema.name] = tool({
                    description: jafTool.schema.description,
                    inputSchema: toSchema(jafTool.schema.parameters),
                  });
                  return acc;
                },
                {} as ToolSet,
              )
            : undefined;
        
        console.log(`[DEBUG] Tools passed to AI SDK: ${toolsForAiSDK ? Object.keys(toolsForAiSDK).length : 0} (hasCompletedTools: ${hasCompletedTools})`);
        
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
          
          console.log('[DEBUG] AI SDK generateText response summary:', {
            text: completeResponse.text?.slice(0, 100),
            toolCallsCount: completeResponse.toolCalls?.length ?? 0,
          });
          
          return {
            message: {
              content: completeResponse.text,
              tool_calls: completeResponse.toolCalls?.map((tc) => ({
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
