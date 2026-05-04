/**
 * Generic OpenAI-compatible provider for models that return thinking and tool
 * calls inline in assistant content.
 *
 * Supported inline formats:
 * - Thinking: everything before the first </think> tag.
 * - Tool calls: <tool_call><function=name><parameter=key>value</parameter></function></tool_call>
 */

import { createHash } from 'crypto';
import {
  type Agent,
  type CompletionStreamChunk,
  getTextContent,
  type Message,
  type ModelProvider,
  type RunConfig,
  type RunState,
  type ToolCall,
} from '../core/types.js';
import { safeConsole, isVerboseLogging } from '../utils/logger.js';
import { zodSchemaToJsonSchema } from './schema.js';

export interface GenericOpenAIProviderOptions {
  readonly baseURL?: string;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

type ParsedResponse = {
  readonly thinking: string | null;
  readonly content: string;
  readonly toolCalls: readonly ToolCall[];
  readonly usage?: unknown;
  readonly model?: string;
  readonly id?: string;
  readonly created?: number;
};

const THINK_CLOSE_TAG = '</think>';
const TOOL_CALL_PREFIX = '<tool_call';
const TOOL_CALL_BLOCK_REGEX = /<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/g;
const TOOL_CALL_PARSE_REGEX =
  /<tool_call\b[^>]*>\s*<function=([A-Za-z_][A-Za-z0-9_-]*)>([\s\S]*?)<\/function>\s*<\/tool_call>/g;
const PARAMETER_PARSE_REGEX = /<parameter=([A-Za-z_][A-Za-z0-9_-]*)>([\s\S]*?)<\/parameter>/g;

export function parseThinkingContent(raw: string): { thinking: string | null; content: string } {
  const thinkEnd = raw.indexOf(THINK_CLOSE_TAG);
  if (thinkEnd === -1) {
    return { thinking: null, content: raw };
  }

  const thinking = raw.slice(0, thinkEnd).trim();
  const content = raw.slice(thinkEnd + THINK_CLOSE_TAG.length).trim();
  return { thinking: thinking.length > 0 ? thinking : null, content };
}

function parseParameterValue(rawValue: string): unknown {
  const value = rawValue.trim();

  if (
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']'))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && Number.isFinite(Number(value))) return Number(value);

  return value;
}

function generateToolCallId(name: string, params: Record<string, unknown>): string {
  const payload = JSON.stringify({ name, params });
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 10);
  return `call_${name}_${hash}`;
}

export function parseXmlToolCalls(text: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  for (const toolMatch of text.matchAll(TOOL_CALL_PARSE_REGEX)) {
    const functionName = toolMatch[1];
    const body = toolMatch[2];
    const params: Record<string, unknown> = {};

    for (const paramMatch of body.matchAll(PARAMETER_PARSE_REGEX)) {
      params[paramMatch[1]] = parseParameterValue(paramMatch[2]);
    }

    toolCalls.push({
      id: generateToolCallId(functionName, params),
      type: 'function',
      function: {
        name: functionName,
        arguments: JSON.stringify(params),
      },
    });
  }

  return toolCalls;
}

export function stripXmlToolCalls(text: string): string {
  return text.replace(TOOL_CALL_BLOCK_REGEX, '').trim();
}

function parseNativeToolCalls(rawToolCalls: unknown): ToolCall[] {
  if (!Array.isArray(rawToolCalls)) return [];

  return rawToolCalls
    .filter((toolCall): toolCall is { id?: string; function?: { name?: string; arguments?: unknown } } =>
      !!toolCall && typeof toolCall === 'object' && !!(toolCall as any).function?.name,
    )
    .map((toolCall, index) => ({
      id: toolCall.id ?? `call_${index}`,
      type: 'function' as const,
      function: {
        name: toolCall.function!.name!,
        arguments: typeof toolCall.function!.arguments === 'string'
          ? toolCall.function!.arguments
          : JSON.stringify(toolCall.function!.arguments ?? {}),
      },
    }));
}

function parseFullResponse(json: any): ParsedResponse {
  const choice = json?.choices?.[0];
  const rawContent = String(choice?.message?.content ?? '');
  const { thinking, content: afterThink } = parseThinkingContent(rawContent);

  const xmlToolCalls = parseXmlToolCalls(afterThink);
  const nativeToolCalls = parseNativeToolCalls(choice?.message?.tool_calls);
  const toolCalls = xmlToolCalls.length > 0 ? xmlToolCalls : nativeToolCalls;

  return {
    thinking,
    content: stripXmlToolCalls(afterThink),
    toolCalls,
    usage: json?.usage,
    model: json?.model,
    id: json?.id,
    created: json?.created,
  };
}

function convertMessage(message: Message): Record<string, unknown> {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: getTextContent(message.content) };
    case 'assistant': {
      const converted: Record<string, unknown> = {
        role: 'assistant',
        content: getTextContent(message.content),
      };
      if (message.tool_calls && message.tool_calls.length > 0) {
        converted.tool_calls = message.tool_calls;
      }
      return converted;
    }
    case 'tool':
      return {
        role: 'tool',
        content: getTextContent(message.content),
        tool_call_id: message.tool_call_id,
      };
  }
}

function buildResponseFormat(agent: Readonly<Agent<any, any>>): Record<string, unknown> | undefined {
  if (!agent.outputCodec) return undefined;

  return {
    type: 'json_schema',
    json_schema: {
      name: agent.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'jaf_output',
      strict: true,
      schema: zodSchemaToJsonSchema(agent.outputCodec),
    },
  };
}

function buildRequestBody<Ctx>(
  state: Readonly<RunState<Ctx>>,
  agent: Readonly<Agent<Ctx, any>>,
  config: Readonly<RunConfig<Ctx>>,
): { readonly model: string; readonly body: Record<string, unknown> } {
  const model = agent.modelConfig?.name ?? config.modelOverride;
  if (!model) {
    throw new Error(`Model not specified for agent ${agent.name}`);
  }

  const tools = agent.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.schema.name,
      description: tool.schema.description,
      parameters: zodSchemaToJsonSchema(tool.schema.parameters),
    },
  }));

  const lastMessage = state.messages[state.messages.length - 1];
  const isAfterToolCall = lastMessage?.role === 'tool';

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: agent.instructions(state) },
      ...state.messages.map(convertMessage),
    ],
    temperature: agent.modelConfig?.temperature,
    max_tokens: agent.modelConfig?.maxTokens,
    tools: tools && tools.length > 0 ? tools : undefined,
    tool_choice: tools && tools.length > 0 && isAfterToolCall ? 'auto' : undefined,
    response_format: buildResponseFormat(agent),
  };

  if (agent.modelConfig?.reasoning?.effort) {
    body.reasoning_effort = agent.modelConfig.reasoning.effort;
  }

  return { model, body };
}

async function* parseSseStream(response: Response): AsyncGenerator<any, void, unknown> {
  if (!response.body) {
    throw new Error('GenericOpenAI API streaming response did not include a body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '' || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice('data:'.length).trimStart();
        if (data === '[DONE]') return;

        try {
          yield JSON.parse(data);
        } catch {
          safeConsole.warn(`[JAF:GENERIC] Skipping malformed SSE data: ${data.slice(0, 120)}`);
        }
      }
    }

    const remaining = buffer.trim();
    if (remaining.startsWith('data:')) {
      const data = remaining.slice('data:'.length).trimStart();
      if (data !== '[DONE]') {
        try {
          yield JSON.parse(data);
        } catch {
          safeConsole.warn(`[JAF:GENERIC] Skipping malformed SSE data: ${data.slice(0, 120)}`);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function partialToolCallPrefixLength(text: string): number {
  const maxPrefixLength = Math.min(text.length, TOOL_CALL_PREFIX.length - 1);
  for (let length = maxPrefixLength; length > 0; length--) {
    if (TOOL_CALL_PREFIX.startsWith(text.slice(-length))) {
      return length;
    }
  }
  return 0;
}

function streamSafeCleanContent(text: string): string {
  let safeEnd = text.length;
  let searchFrom = 0;

  while (true) {
    const toolStart = text.indexOf(TOOL_CALL_PREFIX, searchFrom);
    if (toolStart === -1) break;

    const toolEnd = text.indexOf('</tool_call>', toolStart);
    if (toolEnd === -1) {
      safeEnd = toolStart;
      break;
    }

    searchFrom = toolEnd + '</tool_call>'.length;
  }

  const heldPrefixLength = safeEnd === text.length ? partialToolCallPrefixLength(text) : 0;
  const safeText = text.slice(0, safeEnd - heldPrefixLength);
  return stripXmlToolCalls(safeText);
}

type FinalizeStreamOptions = {
  readonly rawBuffer: string;
  readonly cleanYielded: number;
  readonly nativeToolCallSeen: boolean;
  readonly finishReason: string | null;
  readonly usage: unknown;
  readonly raw: unknown;
};

function finalizeStreamChunks(options: FinalizeStreamOptions): Array<CompletionStreamChunk & { usage?: unknown }> {
  const { content: afterThink } = parseThinkingContent(options.rawBuffer);
  const cleanContent = stripXmlToolCalls(afterThink);
  const chunks: Array<CompletionStreamChunk & { usage?: unknown }> = [];
  const newContent = cleanContent.slice(options.cleanYielded);

  if (newContent.length > 0) {
    chunks.push({ delta: newContent, raw: options.raw });
  }

  if (!options.nativeToolCallSeen) {
    const xmlToolCalls = parseXmlToolCalls(afterThink);
    for (let index = 0; index < xmlToolCalls.length; index++) {
      const toolCall = xmlToolCalls[index];
      chunks.push({
        toolCallDelta: {
          index,
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.function.name,
            argumentsDelta: toolCall.function.arguments,
          },
        },
        raw: options.raw,
      });
    }
  }

  chunks.push({
    isDone: true,
    finishReason: options.finishReason,
    usage: options.usage,
    raw: options.raw,
  });

  return chunks;
}

export const makeGenericOpenAIProvider = <Ctx>(
  apiKey: string,
  options: GenericOpenAIProviderOptions = {},
): ModelProvider<Ctx> => {
  const baseURL = (options.baseURL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 120_000;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...(options.defaultHeaders ?? {}),
  };

  return {
    async getCompletion(state, agent, config) {
      const { model, body } = buildRequestBody(state, agent, config);

      if (isVerboseLogging()) {
        safeConsole.log(`[JAF:GENERIC] Calling model: ${model} with body: ${JSON.stringify(body, null, 2)}`);
      } else {
        const lastMessage = state.messages[state.messages.length - 1];
        safeConsole.log(
          `[JAF:GENERIC] Calling model: ${model} | messages: ${state.messages.length + 1} | last: "${getTextContent(lastMessage?.content).slice(0, 120)}"`,
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'unknown');
          safeConsole.error(`[JAF:GENERIC] getCompletion failed for model=${model}`, {
            status: response.status,
            responseBody: errorBody,
          });
          throw new Error(`GenericOpenAI API error ${response.status}: ${errorBody}`);
        }

        const parsed = parseFullResponse(await response.json());
        return {
          message: {
            content: parsed.content,
            tool_calls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined,
          },
          usage: parsed.usage,
          model: parsed.model,
          id: parsed.id,
          created: parsed.created,
          thinking: parsed.thinking,
        };
      } finally {
        clearTimeout(timeout);
      }
    },

    async *getCompletionStream(state, agent, config) {
      const { model, body } = buildRequestBody(state, agent, config);
      body.stream = true;
      body.stream_options = { include_usage: true };

      if (isVerboseLogging()) {
        safeConsole.log(`[JAF:GENERIC] Streaming model: ${model} with body: ${JSON.stringify(body, null, 2)}`);
      } else {
        const lastMessage = state.messages[state.messages.length - 1];
        safeConsole.log(
          `[JAF:GENERIC] Streaming model: ${model} | messages: ${state.messages.length + 1} | last: "${getTextContent(lastMessage?.content).slice(0, 120)}"`,
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;

      try {
        response = await fetch(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeout);
        safeConsole.error(`[JAF:GENERIC] getCompletionStream failed for model=${model}`, {
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      if (!response.ok) {
        clearTimeout(timeout);
        const errorBody = await response.text().catch(() => 'unknown');
        throw new Error(`GenericOpenAI API error ${response.status}: ${errorBody}`);
      }

      let rawBuffer = '';
      let thinkingDone = false;
      let cleanYielded = 0;
      let streamUsage: unknown;
      let nativeToolCallSeen = false;
      let doneSent = false;
      let lastRaw: unknown;

      try {
        for await (const chunk of parseSseStream(response)) {
          lastRaw = chunk;
          if (chunk?.usage) {
            streamUsage = chunk.usage;
          }

          const choice = chunk?.choices?.[0];
          const delta = choice?.delta;

          if (typeof delta?.content === 'string' && delta.content.length > 0) {
            rawBuffer += delta.content;

            if (!thinkingDone) {
              thinkingDone = rawBuffer.includes(THINK_CLOSE_TAG);
            }

            if (thinkingDone) {
              const afterThink = rawBuffer.slice(rawBuffer.indexOf(THINK_CLOSE_TAG) + THINK_CLOSE_TAG.length);
              const cleanContent = streamSafeCleanContent(afterThink);
              const newContent = cleanContent.slice(cleanYielded);
              if (newContent.length > 0) {
                cleanYielded = cleanContent.length;
                yield { delta: newContent, raw: chunk };
              }
            }
          }

          if (Array.isArray(delta?.tool_calls)) {
            nativeToolCallSeen = true;
            for (const toolCall of delta.tool_calls) {
              const fn = toolCall.function ?? {};
              yield {
                toolCallDelta: {
                  index: toolCall.index ?? 0,
                  id: toolCall.id,
                  type: 'function',
                  function: {
                    name: fn.name,
                    argumentsDelta: fn.arguments,
                  },
                },
                raw: chunk,
              };
            }
          }

          const finishReason = choice?.finish_reason;
          if (finishReason) {
            for (const finalChunk of finalizeStreamChunks({
              rawBuffer,
              cleanYielded,
              nativeToolCallSeen,
              finishReason,
              usage: streamUsage,
              raw: chunk,
            })) {
              yield finalChunk;
            }
            doneSent = true;
          }
        }

        if (!doneSent) {
          for (const finalChunk of finalizeStreamChunks({
            rawBuffer,
            cleanYielded,
            nativeToolCallSeen,
            finishReason: null,
            usage: streamUsage,
            raw: lastRaw,
          })) {
            yield finalChunk;
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    },
  };
};
