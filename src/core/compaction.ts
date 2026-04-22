import { Message, RunState, TraceEvent, getTextContent } from './types.js';

/**
 * Configuration for token-based message compaction
 */
export interface CompactionConfig {
  readonly enabled: boolean;
  readonly maxTokenLimit: number;      // Trigger compaction when token count exceeds this
  readonly targetTokenLimit: number;   // Compact until token count is below this
}

/**
 * Default compaction configuration
 */
export const defaultCompactionConfig: CompactionConfig = {
  enabled: true,
  maxTokenLimit: 180_000,
  targetTokenLimit: 100_000
};

/**
 * Result of a compaction operation
 */
export interface CompactionResult {
  readonly originalCount: number;
  readonly compactedCount: number;
  readonly removedCount: number;
  readonly originalTokens: number;
  readonly compactedTokens: number;
  readonly removedMessages: readonly Message[];
  readonly preservedMessages: readonly Message[];
}

/**
 * Estimate token count for a message
 * Uses a simple approximation: ~4 characters per token on average
 */
export function estimateMessageTokens(message: Message): number {
  let textLength = 0;

  if (typeof message.content === 'string') {
    textLength = message.content.length;
  } else if (Array.isArray(message.content)) {
    textLength = message.content
      .filter(part => part.type === 'text')
      .map(part => part.text.length)
      .reduce((a, b) => a + b, 0);
  }

  // Add overhead for tool_calls
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      textLength += tc.function.name.length;
      textLength += tc.function.arguments.length;
    }
  }

  // Rough estimate: 4 chars per token
  return Math.ceil(textLength / 4);
}

/**
 * Estimate total tokens for all messages
 */
export function estimateTotalTokens(messages: readonly Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * Check if compaction should be triggered
 */
export function shouldCompact(
  messages: readonly Message[],
  config: Pick<CompactionConfig, 'enabled' | 'maxTokenLimit'>
): boolean {
  if (!config.enabled) return false;
  const tokens = estimateTotalTokens(messages);
  return tokens > config.maxTokenLimit;
}

/**
 * Trim messages from the start, removing only tool messages (tool calls and results)
 * Stops when token count falls below target limit or no more tool messages to trim
 */
export function trimToolMessages(
  messages: readonly Message[],
  targetTokenLimit: number
): CompactionResult {
  const originalTokens = estimateTotalTokens(messages);
  let currentTokens = originalTokens;
  const removedMessages: Message[] = [];
  const preservedMessages: Message[] = [];

  // Scan from start, skip user messages, remove tool messages until under limit
  for (const msg of messages) {
    if (currentTokens <= targetTokenLimit) {
      preservedMessages.push(msg);
      continue;
    }

    // Only remove tool messages (role: 'tool' or assistant messages with tool_calls)
    const isToolMessage =
      msg.role === 'tool' ||
      (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0);

    if (isToolMessage) {
      const msgTokens = estimateMessageTokens(msg);
      removedMessages.push(msg);
      currentTokens -= msgTokens;
    } else {
      // Keep user messages and non-tool assistant messages
      preservedMessages.push(msg);
    }
  }

  return {
    originalCount: messages.length,
    compactedCount: preservedMessages.length,
    removedCount: removedMessages.length,
    originalTokens,
    compactedTokens: currentTokens,
    removedMessages,
    preservedMessages
  };
}

/**
 * Compacts state by trimming tool messages from the start
 * Returns updated state and compaction result
 */
export function compactState<Ctx>(
  state: RunState<Ctx>,
  config: Pick<CompactionConfig, 'targetTokenLimit'>
): { readonly state: RunState<Ctx>; readonly result: CompactionResult } {
  const result = trimToolMessages(state.messages, config.targetTokenLimit);

  if (result.removedCount === 0) {
    return { state, result };
  }

  return {
    state: {
      ...state,
      messages: result.removedMessages.length > 0 ? state.messages.filter(
        msg => !result.removedMessages.includes(msg)
      ) : state.messages
    },
    result
  };
}

/**
 * Creates a compaction event for tracing
 */
export function createCompactionEvent(
  result: CompactionResult,
  runId: string,
  traceId: string
): TraceEvent {
  return {
    type: 'memory_operation',
    data: {
      operation: 'compact',
      conversationId: runId,
      status: 'end',
      messageCount: result.compactedCount,
      metadata: {
        originalCount: result.originalCount,
        removedCount: result.removedCount,
        originalTokens: result.originalTokens,
        compactedTokens: result.compactedTokens,
        runId,
        traceId
      }
    }
  };
}