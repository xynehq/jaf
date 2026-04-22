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
 * Identifies tool interaction groups (assistant with tool_calls + their tool results)
 * Returns a map of message indices to their group IDs
 */
function identifyToolGroups(messages: readonly Message[]): Map<number, string> {
  const messageToGroup = new Map<number, string>();
  const pendingToolCalls = new Map<string, number>(); // tool_call_id -> assistant message index

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // This is an assistant message initiating tool calls
      const groupId = `group_${i}`;
      messageToGroup.set(i, groupId);

      // Track all tool_call_ids from this assistant message
      for (const tc of msg.tool_calls) {
        pendingToolCalls.set(tc.id, i);
      }
    } else if (msg.role === 'tool' && msg.tool_call_id) {
      // This is a tool result - associate it with its originating assistant
      const assistantIndex = pendingToolCalls.get(msg.tool_call_id);
      if (assistantIndex !== undefined) {
        const groupId = messageToGroup.get(assistantIndex);
        if (groupId) {
          messageToGroup.set(i, groupId);
        }
      }
    }
  }

  return messageToGroup;
}

/**
 * Trim messages from the start, removing complete tool interaction groups
 * Stops when token count falls below target limit or no more complete groups to trim
 */
export function trimToolMessages(
  messages: readonly Message[],
  targetTokenLimit: number
): CompactionResult {
  const originalTokens = estimateTotalTokens(messages);
  let currentTokens = originalTokens;
  const removedMessages: Message[] = [];
  const preservedMessages: Message[] = [];

  // Identify tool interaction groups
  const toolGroups = identifyToolGroups(messages);

  // Track which groups we've decided to remove
  const removedGroups = new Set<string>();

  // Scan from start
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // If we're under the limit, preserve everything remaining
    if (currentTokens <= targetTokenLimit) {
      preservedMessages.push(msg);
      continue;
    }

    const groupId = toolGroups.get(i);

    if (groupId) {
      // This message is part of a tool interaction group
      if (removedGroups.has(groupId)) {
        // Already decided to remove this group, skip counting tokens again
        removedMessages.push(msg);
        continue;
      }

      // Calculate tokens for the entire group
      let groupTokens = 0;
      const groupIndices: number[] = [];

      for (let j = i; j < messages.length; j++) {
        if (toolGroups.get(j) === groupId) {
          groupTokens += estimateMessageTokens(messages[j]);
          groupIndices.push(j);
        }
      }

      // Decide whether to remove this group
      // Always remove complete groups from the start until under target
      removedGroups.add(groupId);
      for (const idx of groupIndices) {
        removedMessages.push(messages[idx]);
      }
      currentTokens -= groupTokens;

      // Skip ahead past this group (will be handled in subsequent iterations)
      // Actually, we need to skip in the outer loop
      const lastGroupIndex = Math.max(...groupIndices);
      i = lastGroupIndex; // Will be incremented by the for loop
    } else {
      // Not a tool message - preserve it (user messages, plain assistant messages)
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
 * Compacts state by trimming tool interaction groups from the start
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
      messages: result.preservedMessages
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