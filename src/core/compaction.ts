import { Message, RunState, TraceEvent, CompactionConfig } from './types.js';

/**
 * Default compaction configuration values
 */
const DEFAULT_COMPACTION_CONFIG: Required<CompactionConfig> = {
  enabled: true,
  maxTokenLimit: 180_000,
  targetTokenLimit: 100_000
};

/**
 * Merges user-provided compaction config with defaults
 */
export function resolveCompactionConfig(
  userConfig?: CompactionConfig
): Required<CompactionConfig> {
  return {
    enabled: userConfig?.enabled ?? DEFAULT_COMPACTION_CONFIG.enabled,
    maxTokenLimit: userConfig?.maxTokenLimit ?? DEFAULT_COMPACTION_CONFIG.maxTokenLimit,
    targetTokenLimit: userConfig?.targetTokenLimit ?? DEFAULT_COMPACTION_CONFIG.targetTokenLimit
  };
}

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
  config: Required<Pick<CompactionConfig, 'enabled' | 'maxTokenLimit'>>
): boolean {
  if (!config.enabled) return false;
  const tokens = estimateTotalTokens(messages);
  return tokens > config.maxTokenLimit;
}

/**
 * Precomputed tool group info for efficient compaction
 */
interface ToolGroupInfo {
  readonly groupId: string;
  readonly indices: number[];
  readonly tokens: number;
}

/**
 * Precomputes tool interaction groups in a single pass (O(n))
 * Returns ordered array of groups from earliest to latest
 */
function precomputeToolGroups(messages: readonly Message[]): ToolGroupInfo[] {
  const messageToGroup = new Map<number, string>();
  const pendingToolCalls = new Map<string, number>(); // tool_call_id -> assistant message index
  const groupTokens = new Map<string, number>();
  const groupIndices = new Map<string, number[]>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgTokens = estimateMessageTokens(msg);

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // This is an assistant message initiating tool calls
      const groupId = `group_${i}`;
      messageToGroup.set(i, groupId);
      groupIndices.set(groupId, [i]);
      groupTokens.set(groupId, msgTokens);

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
          groupIndices.get(groupId)!.push(i);
          groupTokens.set(groupId, groupTokens.get(groupId)! + msgTokens);
        }
      }
    }
  }

  // Convert to ordered array (groups naturally ordered by assistant index)
  const groups: ToolGroupInfo[] = [];
  const seenGroups = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const groupId = messageToGroup.get(i);
    if (groupId && !seenGroups.has(groupId)) {
      seenGroups.add(groupId);
      groups.push({
        groupId,
        indices: groupIndices.get(groupId)!,
        tokens: groupTokens.get(groupId)!
      });
    }
  }

  return groups;
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

  // Precompute tool groups in single pass (O(n))
  const toolGroups = precomputeToolGroups(messages);
  const removedGroups = new Set<string>();
  let nextGroupIndex = 0;

  // Scan from start
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // If we're under the limit, preserve everything remaining
    if (currentTokens <= targetTokenLimit) {
      preservedMessages.push(msg);
      continue;
    }

    // Check if this message is the start of the next removable group
    const nextGroup = toolGroups[nextGroupIndex];
    if (nextGroup && nextGroup.indices[0] === i && !removedGroups.has(nextGroup.groupId)) {
      // Remove this complete group
      removedGroups.add(nextGroup.groupId);
      for (const idx of nextGroup.indices) {
        removedMessages.push(messages[idx]);
      }
      currentTokens -= nextGroup.tokens;
      i = nextGroup.indices[nextGroup.indices.length - 1]; // Skip to end of group
      nextGroupIndex++;
      continue;
    }

    // If current message is part of an already-removed group, skip it
    if (nextGroup && nextGroup.indices.includes(i) && removedGroups.has(nextGroup.groupId)) {
      continue;
    }

    // Not a tool message or part of removed group - preserve it
    preservedMessages.push(msg);
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
  config: Required<Pick<CompactionConfig, 'targetTokenLimit'>>
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