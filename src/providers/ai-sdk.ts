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
import {
  AiSdkFunctionTool,
  AiSdkChatMessageParam,
  AiSdkChatRequest,
  AiSdkChatResponse,
  AiSdkClient,
  SafeJsonParseResult,
  GenerateObjectResult,
  GenerateObjectOptions
} from './ai-sdk-types.js';

function safeParseJson(text: string): SafeJsonParseResult {
  try {
    return JSON.parse(text) as JSONValue;
  } catch {
    return text;
  }
}

export {
  AiSdkFunctionTool,
  AiSdkChatMessageParam,
  AiSdkChatRequest,
  AiSdkChatResponse,
  AiSdkClient
};

export const createAiSdkProvider = <Ctx>(
  model: LanguageModel,
): ModelProvider<Ctx> => {
  const lm = model;
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

      // Decide whether to enable tool calls or produce final structured output
      const lastJafMessage = state.messages[state.messages.length - 1];
      const hasCompletedTools = lastJafMessage?.role === 'tool';

      const toolsForAiSDK: ToolSet | undefined =
        !hasCompletedTools && agent.tools && agent.tools.length > 0
          ? agent.tools.reduce(
              (acc, jafTool) => {
                const toSchema = zodSchema as (s: unknown) => Schema;
                acc[jafTool.schema.name] = tool({
                  description: jafTool.schema.description,
                  inputSchema: toSchema(jafTool.schema.parameters),
                });
                return acc;
              },
              {} as ToolSet,
            )
          : undefined;

      const shouldGenerateObject = Boolean(agent.outputCodec) && !toolsForAiSDK;

      if (shouldGenerateObject) {
        const toSchema = zodSchema as (s: unknown) => Schema;
        const result = await generateObject({
          model: lm,
          schema: toSchema(agent.outputCodec as import('zod').ZodType<unknown>),
          system,
          messages,
          temperature: agent.modelConfig?.temperature,
          maxOutputTokens: agent.modelConfig?.maxTokens,
        }) as GenerateObjectResult;

        return { message: { content: JSON.stringify(result.object) } };
      }

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
              function: { name: tc.toolName, arguments: JSON.stringify(tc.input) },
            })),
          },
        };
      } catch (error) {
        console.error('[DEBUG] AI SDK generateText error:', error);
        throw error;
      }
    },
  };
};
