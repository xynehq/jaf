/**
 * JAF Generic OpenAI-Compatible Provider
 *
 * Supports models that use an OpenAI-compatible chat completions API but
 * output thinking and tool calls inline in the content text rather than
 * using the standard tool_calls JSON array.
 *
 * Thinking format:  content before </think> is thinking, content after is response.
 * Tool call format: <tool_call><function=NAME><parameter=KEY>value</parameter></function></tool_call>
 */

import { createHash } from 'crypto';
import {
  ModelProvider,
  Message,
  ToolCall,
  CompletionStreamChunk,
  getTextContent,
  type RunState,
  type Agent,
  type RunConfig,
} from '../core/types.js';
import { zodSchemaToJsonSchema } from './model.js';
import { safeConsole, isVerboseLogging } from '../utils/logger.js';

// ========== Types ==========

interface GenericOpenAIProviderOptions {
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
}

interface ParsedResponse {
  thinking: string | null;
  content: string;
  toolCalls: readonly ToolCall[];
}

// ========== Thinking Parser ==========

export function parseThinkingContent(raw: string): { thinking: string | null; content: string } {
  const idx = raw.indexOf('</think>');
  if (idx === -1) {
    return { thinking: null, content: raw };
  }
  const thinking = raw.slice(0, idx).trim();
  const content = raw.slice(idx + '</think>'.length).trim();
  return { thinking: thinking || null, content };
}

// ========== XML Tool Call Parser ==========

function generateToolCallId(name: string, params: Record<string, unknown>): string {
  const payload = JSON.stringify({ name, params });
  const hash = createHash('md5').update(payload).digest('hex').slice(0, 8);
  return `call_${name}_${hash}`;
}

export function parseXmlToolCalls(text: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const toolCallRegex = /<tool_call>\s*<function=(\w+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g;
  let match;

  while ((match = toolCallRegex.exec(text)) !== null) {
    const funcName = match[1];
    const body = match[2];
    const params: Record<string, unknown> = {};

    const paramRegex = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(body)) !== null) {
      const key = paramMatch[1];
      const rawValue = paramMatch[2].trim();

      // Attempt JSON parse for structured values (arrays, objects, numbers, booleans)
      let value: unknown = rawValue;
      if (
        (rawValue.startsWith('[') && rawValue.endsWith(']')) ||
        (rawValue.startsWith('{') && rawValue.endsWith('}'))
      ) {
        try {
          value = JSON.parse(rawValue);
        } catch {
          // keep as string
        }
      } else if (rawValue === 'true' || rawValue === 'false') {
        value = rawValue === 'true';
      } else if (rawValue !== '' && !isNaN(Number(rawValue)) && isFinite(Number(rawValue))) {
        value = Number(rawValue);
      }

      params[key] = value;
    }

    toolCalls.push({
      id: generateToolCallId(funcName, params),
      type: 'function',
      function: {
        name: funcName,
        arguments: JSON.stringify(params),
      },
    });
  }

  return toolCalls;
}

export function stripXmlToolCalls(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .trim();
}

// ========== Full Response Parser ==========

function parseFullResponse(json: any): ParsedResponse & { usage?: any; model?: string; id?: string } {
  const choice = json?.choices?.[0];
  const rawContent: string = choice?.message?.content ?? '';

  const { thinking, content: afterThink } = parseThinkingContent(rawContent);

  // Try XML tool calls first
  let toolCalls = parseXmlToolCalls(afterThink);
  let cleanContent = stripXmlToolCalls(afterThink);

  // Fall back to native tool_calls array if no XML tool calls found
  if (toolCalls.length === 0 && Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length > 0) {
    toolCalls = choice.message.tool_calls.map((tc: any) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments: typeof tc.function.arguments === 'string'
          ? tc.function.arguments
          : JSON.stringify(tc.function.arguments),
      },
    }));
    // When using native tool calls, content stays as-is
    cleanContent = afterThink;
  }

  return {
    thinking,
    content: cleanContent,
    toolCalls,
    usage: json?.usage,
    model: json?.model,
    id: json?.id,
  };
}

// ========== Request Building ==========

function convertMessage(msg: Message): Record<string, unknown> {
  const textContent = getTextContent(msg.content);
  switch (msg.role) {
    case 'user':
      return { role: 'user', content: textContent };
    case 'assistant': {
      const m: Record<string, unknown> = { role: 'assistant', content: textContent };
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        m.tool_calls = msg.tool_calls;
      }
      return m;
    }
    case 'tool':
      return { role: 'tool', content: textContent, tool_call_id: msg.tool_call_id };
    default:
      return { role: 'user', content: textContent };
  }
}

function buildRequestBody<Ctx>(
  state: Readonly<RunState<Ctx>>,
  agent: Readonly<Agent<Ctx, any>>,
  config: Readonly<RunConfig<Ctx>>,
): { model: string; body: Record<string, unknown> } {
  const model = agent.modelConfig?.name ?? config.modelOverride;
  if (!model) {
    throw new Error(`Model not specified for agent ${agent.name}`);
  }

  const systemMessage = { role: 'system', content: agent.instructions(state) };
  const messages = [systemMessage, ...state.messages.map(convertMessage)];

  const tools = agent.tools?.map(t => ({
    type: 'function',
    function: {
      name: t.schema.name,
      description: t.schema.description,
      parameters: zodSchemaToJsonSchema(t.schema.parameters),
    },
  }));

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: agent.modelConfig?.temperature,
    max_tokens: agent.modelConfig?.maxTokens,
    tools: tools && tools.length > 0 ? tools : undefined,
  };

  if (agent.modelConfig?.reasoning?.effort) {
    body.reasoning_effort = agent.modelConfig.reasoning.effort;
  }

  return { model, body };
}

// ========== SSE Stream Parser ==========

async function* parseSseStream(response: Response): AsyncGenerator<any, void, unknown> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!; // keep the incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === 'data: [DONE]') return;
        if (trimmed.startsWith('data: ')) {
          try {
            yield JSON.parse(trimmed.slice(6));
          } catch {
            // skip malformed JSON lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ========== Provider Factory ==========

export const makeGenericOpenAIProvider = <Ctx>(
  apiKey: string,
  options?: GenericOpenAIProviderOptions,
): ModelProvider<Ctx> => {
  const baseURL = (options?.baseURL ?? '').replace(/\/+$/, '');
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const defaultHeaders = options?.defaultHeaders ?? {};

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...defaultHeaders,
  };

  return {
    async getCompletion(state, agent, config) {
      const { model, body } = buildRequestBody(state, agent, config);

      if (isVerboseLogging()) {
        safeConsole.log(`[JAF:GENERIC] Calling model: ${model} with body: ${JSON.stringify(body, null, 2)}`);
      } else {
        const lastMsg = state.messages[state.messages.length - 1];
        safeConsole.log(
          `[JAF:GENERIC] Calling model: ${model} | messages: ${state.messages.length + 1} | last: "${String(getTextContent(lastMsg?.content) ?? '').slice(0, 120)}"`,
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

        const json = await response.json();
        const parsed = parseFullResponse(json);

        return {
          message: {
            content: parsed.content || null,
            tool_calls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined,
          },
          usage: parsed.usage,
          model: parsed.model,
          id: parsed.id,
          thinking: parsed.thinking,
        } as any;
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
        const lastMsg = state.messages[state.messages.length - 1];
        safeConsole.log(
          `[JAF:GENERIC] Streaming model: ${model} | messages: ${state.messages.length + 1} | last: "${String(getTextContent(lastMsg?.content) ?? '').slice(0, 120)}"`,
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

      // Buffer all raw text. We only yield clean deltas (post-thinking, no XML tool calls).
      let rawBuffer = '';
      let thinkingDone = false;     // true once we've seen </think>
      let cleanYielded = 0;         // how many chars of clean content we've already yielded
      let streamUsage: any = null;

      try {
        for await (const chunk of parseSseStream(response)) {
          // Capture usage from the final chunk
          if (chunk?.usage) {
            streamUsage = chunk.usage;
          }

          const choice = chunk?.choices?.[0];
          const delta = choice?.delta;

          if (delta?.content) {
            rawBuffer += delta.content;

            // Phase 1: still in thinking — check if </think> arrived
            if (!thinkingDone) {
              const thinkEnd = rawBuffer.indexOf('</think>');
              if (thinkEnd !== -1) {
                thinkingDone = true;
                // Everything after </think> is real content (minus XML tool calls)
                const afterThink = rawBuffer.slice(thinkEnd + '</think>'.length);
                const clean = stripXmlToolCalls(afterThink);
                if (clean.length > 0) {
                  yield { delta: clean, raw: chunk };
                  cleanYielded = clean.length;
                }
              }
              // While still thinking, yield nothing — buffer silently
            } else {
              // Phase 2: post-thinking — yield only the newly arrived clean content
              const afterThink = rawBuffer.slice(rawBuffer.indexOf('</think>') + '</think>'.length);
              const clean = stripXmlToolCalls(afterThink);
              const newContent = clean.slice(cleanYielded);
              if (newContent.length > 0) {
                yield { delta: newContent, raw: chunk };
                cleanYielded = clean.length;
              }
            }
          }

          // Native tool call deltas (fallback for models that support them natively)
          if (Array.isArray(delta?.tool_calls)) {
            for (const toolCall of delta.tool_calls) {
              const fn = toolCall.function || {};
              yield {
                toolCallDelta: {
                  index: toolCall.index ?? 0,
                  id: toolCall.id,
                  type: 'function' as const,
                  function: {
                    name: fn.name,
                    argumentsDelta: fn.arguments,
                  },
                },
                raw: chunk,
              };
            }
          }

          // Stream finished
          const finish = choice?.finish_reason;
          if (finish) {
            // If we never saw </think>, the entire buffer is content (no thinking)
            if (!thinkingDone) {
              const clean = stripXmlToolCalls(rawBuffer);
              const newContent = clean.slice(cleanYielded);
              if (newContent.length > 0) {
                yield { delta: newContent, raw: chunk };
              }
            }

            // Parse XML tool calls from the full buffer and emit as toolCallDeltas
            const { content: afterThink } = parseThinkingContent(rawBuffer);
            const toolCalls = parseXmlToolCalls(afterThink);
            for (let i = 0; i < toolCalls.length; i++) {
              const tc = toolCalls[i];
              yield {
                toolCallDelta: {
                  index: i,
                  id: tc.id,
                  type: 'function' as const,
                  function: {
                    name: tc.function.name,
                    argumentsDelta: tc.function.arguments,
                  },
                },
                raw: chunk,
              };
            }

            yield { isDone: true, finishReason: finish, usage: streamUsage, raw: chunk };
          }
        }

        // Final usage yield if not already sent
        if (streamUsage) {
          yield { isDone: true, usage: streamUsage };
        }
      } finally {
        clearTimeout(timeout);
      }
    },
  };
};
