import {
  Agent,
  CompactionConfig,
  Message,
  ModelProvider,
  RunConfig,
  RunState,
  TokenLedger,
  getTextContent,
} from './types.js';
import { safeConsole } from '../utils/logger.js';

const DEFAULT_TRIGGER_PERCENTAGE = 0.8;
const DEFAULT_MIN_CANDIDATE_MESSAGES = 4;
const DEFAULT_COMPACTION_PREFIX = '[JAF COMPACTION SUMMARY]\n';
const FIXED_IMAGE_TOKENS = 1844;
const BASE64_DECODE_OVERHEAD_BYTES = 650;

type ResolvedCompactionConfig = {
  readonly enabled: true;
  readonly triggerPercentage: number;
  readonly doNotCompactSystemPrompt: boolean;
  readonly preserveLastAssistantMessage: boolean;
  readonly rules?: string;
  readonly minCandidateMessages: number;
};

type CompactionSegments = {
  readonly boundaryIndex: number;
  readonly compactableMessages: readonly Message[];
  readonly preservedMessages: readonly Message[];
};

type CompactStateSuccess<Ctx> = {
  readonly success: true;
  readonly state: RunState<Ctx>;
};

type CompactStateFailure<Ctx> = {
  readonly success: false;
  readonly state: RunState<Ctx>;
  readonly error: string;
};

export type CompactStateResult<Ctx> = CompactStateSuccess<Ctx> | CompactStateFailure<Ctx>;

export function normalizeCompactionConfig(
  config?: boolean | CompactionConfig
): ResolvedCompactionConfig | null {
  if (config === undefined || config === false) {
    return null;
  }

  if (config === true) {
    return {
      enabled: true,
      triggerPercentage: DEFAULT_TRIGGER_PERCENTAGE,
      doNotCompactSystemPrompt: true,
      preserveLastAssistantMessage: true,
      minCandidateMessages: DEFAULT_MIN_CANDIDATE_MESSAGES,
    };
  }

  if (config.enabled === false) {
    return null;
  }

  return {
    enabled: true,
    triggerPercentage: normalizeTriggerPercentage(config.triggerPercentage),
    doNotCompactSystemPrompt: config.doNotCompactSystemPrompt ?? true,
    preserveLastAssistantMessage: config.preserveLastAssistantMessage ?? true,
    rules: config.rules?.trim() || undefined,
    minCandidateMessages: normalizeMinCandidateMessages(config.minCandidateMessages),
  };
}

export function shouldTrackTokens<Ctx>(state: Readonly<RunState<Ctx>>, agent: Readonly<Agent<Ctx, any>>): boolean {
  return Boolean(state.tokenLedger) || Boolean(normalizeCompactionConfig(agent.compaction));
}

export function estimateTextTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

export function ensureTokenLedger<Ctx>(state: Readonly<RunState<Ctx>>): RunState<Ctx> {
  if (state.tokenLedger && state.tokenLedger.messageTokenEstimates.length === state.messages.length) {
    return state as RunState<Ctx>;
  }

  return {
    ...state,
    tokenLedger: createTokenLedger(state.messages, undefined, state.tokenLedger),
  };
}

export function appendMessagesWithLedger<Ctx>(
  state: Readonly<RunState<Ctx>>,
  messagesToAppend: readonly Message[],
  options?: {
    readonly trackTokens?: boolean;
    readonly overrides?: readonly (number | undefined)[];
  }
): RunState<Ctx> {
  const nextMessages = [...state.messages, ...messagesToAppend];
  if (!(options?.trackTokens || state.tokenLedger)) {
    return {
      ...state,
      messages: nextMessages,
    };
  }

  const stateWithLedger = ensureTokenLedger(state);
  const baseLedger = stateWithLedger.tokenLedger!;
  const appendedEstimates = messagesToAppend.map((message, index) =>
    options?.overrides?.[index] ?? estimateMessageTokens(message)
  );

  return {
    ...stateWithLedger,
    messages: nextMessages,
    tokenLedger: {
      ...baseLedger,
      messageTokenEstimates: [...baseLedger.messageTokenEstimates, ...appendedEstimates],
      totalMessageTokens: baseLedger.totalMessageTokens + sum(appendedEstimates),
    },
  };
}

export function rebuildStateWithLedger<Ctx>(
  state: Readonly<RunState<Ctx>>,
  messages: readonly Message[],
  options?: {
    readonly trackTokens?: boolean;
    readonly overrides?: readonly (number | undefined)[];
  }
): RunState<Ctx> {
  if (!(options?.trackTokens || state.tokenLedger)) {
    return {
      ...state,
      messages,
    };
  }

  return {
    ...state,
    messages,
    tokenLedger: createTokenLedger(messages, options?.overrides, state.tokenLedger),
  };
}

export function syncSystemPromptLedger<Ctx>(
  state: Readonly<RunState<Ctx>>,
  agent: Readonly<Agent<Ctx, any>>
): {
  readonly state: RunState<Ctx>;
  readonly systemPromptText: string;
  readonly inputTokens: number;
} {
  const stateWithLedger = ensureTokenLedger(state);
  const currentLedger = stateWithLedger.tokenLedger!;
  const systemPromptText = agent.instructions(stateWithLedger);

  if (currentLedger.lastSystemPromptText === systemPromptText) {
    return {
      state: stateWithLedger,
      systemPromptText,
      inputTokens: currentLedger.totalMessageTokens + currentLedger.lastSystemPromptTokens,
    };
  }

  const systemPromptTokens = estimateTextTokens(systemPromptText);
  const nextState: RunState<Ctx> = {
    ...stateWithLedger,
    tokenLedger: {
      ...currentLedger,
      lastSystemPromptText: systemPromptText,
      lastSystemPromptTokens: systemPromptTokens,
    },
  };

  return {
    state: nextState,
    systemPromptText,
    inputTokens: nextState.tokenLedger!.totalMessageTokens + systemPromptTokens,
  };
}

export async function maybeCompactStateBeforeTurn<Ctx>(
  state: Readonly<RunState<Ctx>>,
  agent: Readonly<Agent<Ctx, any>>,
  config: Readonly<RunConfig<Ctx>>,
  turnNumber: number
): Promise<CompactStateResult<Ctx>> {
  const compactionConfig = normalizeCompactionConfig(agent.compaction);
  if (!compactionConfig) {
    return {
      success: true,
      state: state as RunState<Ctx>,
    };
  }

  const synced = syncSystemPromptLedger(state, agent);
  const stateWithLedger = synced.state;
  const currentInputTokens = synced.inputTokens;

  const limits = await config.modelProvider.getTokenLimits?.(stateWithLedger, agent, config);
  const maxInputTokens = limits?.maxInputTokens;
  if (!Number.isFinite(maxInputTokens) || (maxInputTokens ?? 0) <= 0) {
    return {
      success: false,
      state: stateWithLedger,
      error: `Compaction is enabled for agent ${agent.name}, but the main model provider did not return a valid maxInputTokens limit.`,
    };
  }

  const thresholdTokens = Math.floor((maxInputTokens as number) * compactionConfig.triggerPercentage);
  if (currentInputTokens <= thresholdTokens) {
    return {
      success: true,
      state: stateWithLedger,
    };
  }

  const segments = splitMessagesForCompaction(stateWithLedger.messages, compactionConfig);
  const compactedMessageCount = segments.compactableMessages.length;
  const preservedMessageCount = segments.preservedMessages.length;
  const { provider, model, usingOverrideProvider, error: compactionProviderError } = resolveCompactionRuntime(agent, config);

  config.onEvent?.({
    type: 'compaction_start',
    data: {
      turn: turnNumber,
      agentName: agent.name,
      thresholdTokens,
      currentInputTokens,
      compactableMessageCount: compactedMessageCount,
      preservedMessageCount,
      usingOverrideProvider,
      model,
    },
  });

  if (compactedMessageCount < compactionConfig.minCandidateMessages) {
    config.onEvent?.({
      type: 'compaction_end',
      data: {
        turn: turnNumber,
        agentName: agent.name,
        status: 'skipped',
        thresholdTokens,
        beforeInputTokens: currentInputTokens,
        compactedMessageCount,
        preservedMessageCount,
        reason: `Not enough messages eligible for compaction (minimum ${compactionConfig.minCandidateMessages}).`,
        model,
      },
    });

    return {
      success: false,
      state: stateWithLedger,
      error: `Context exceeded the compaction threshold for agent ${agent.name}, but only ${compactedMessageCount} messages were eligible for compaction.`,
    };
  }

  if (compactionProviderError || !provider) {
    config.onEvent?.({
      type: 'compaction_end',
      data: {
        turn: turnNumber,
        agentName: agent.name,
        status: 'failed',
        thresholdTokens,
        beforeInputTokens: currentInputTokens,
        compactedMessageCount,
        preservedMessageCount,
        error: compactionProviderError || 'Compaction provider resolution failed.',
        model,
      },
    });

    return {
      success: false,
      state: stateWithLedger,
      error: compactionProviderError || 'Compaction provider resolution failed.',
    };
  }

  try {
    const compactionResponse = await provider.getCompletion(
      createCompactionState(stateWithLedger, segments, compactionConfig, synced.systemPromptText),
      createCompactionAgent(agent, model, compactionConfig.rules),
      createCompactionRunConfig(config, provider, model)
    );

    const summaryText = getTextContent(compactionResponse.message?.content || '').trim();
    if (!summaryText) {
      config.onEvent?.({
        type: 'compaction_end',
        data: {
          turn: turnNumber,
          agentName: agent.name,
          status: 'failed',
          thresholdTokens,
          beforeInputTokens: currentInputTokens,
          compactedMessageCount,
          preservedMessageCount,
          error: 'Compaction provider returned an empty summary.',
          model,
        },
      });

      return {
        success: false,
        state: stateWithLedger,
        error: 'Compaction provider returned an empty summary.',
      };
    }

    const summaryMessage: Message = {
      role: 'assistant',
      content: `${DEFAULT_COMPACTION_PREFIX}${summaryText}`,
    };
    const summaryMessageTokens = normalizeUsageTokens((compactionResponse as any)?.usage?.completion_tokens ?? (compactionResponse as any)?.usage?.completionTokens)
      ?? estimateMessageTokens(summaryMessage);
    const preservedOverrides = stateWithLedger.tokenLedger!.messageTokenEstimates.slice(segments.boundaryIndex);
    const rebuiltState = rebuildStateWithLedger(
      stateWithLedger,
      [summaryMessage, ...segments.preservedMessages],
      {
        trackTokens: true,
        overrides: [summaryMessageTokens, ...preservedOverrides],
      }
    );
    const syncedRebuiltState = syncSystemPromptLedger(rebuiltState, agent);

    if (syncedRebuiltState.inputTokens > thresholdTokens) {
      config.onEvent?.({
        type: 'compaction_end',
        data: {
          turn: turnNumber,
          agentName: agent.name,
          status: 'failed',
          thresholdTokens,
          beforeInputTokens: currentInputTokens,
          afterInputTokens: syncedRebuiltState.inputTokens,
          compactedMessageCount,
          preservedMessageCount,
          summaryMessageTokens,
          error: 'Compaction completed but the rebuilt transcript still exceeds the configured threshold.',
          model,
        },
      });

      return {
        success: false,
        state: syncedRebuiltState.state,
        error: 'Compaction completed but the rebuilt transcript still exceeds the configured threshold.',
      };
    }

    config.onEvent?.({
      type: 'compaction_end',
      data: {
        turn: turnNumber,
        agentName: agent.name,
        status: 'success',
        thresholdTokens,
        beforeInputTokens: currentInputTokens,
        afterInputTokens: syncedRebuiltState.inputTokens,
        compactedMessageCount,
        preservedMessageCount,
        summaryMessageTokens,
        model,
      },
    });

    safeConsole.log(
      `[JAF:COMPACTION] Compacted ${compactedMessageCount} messages into a summary for agent ${agent.name}. Input tokens ${currentInputTokens} -> ${syncedRebuiltState.inputTokens}.`
    );

    return {
      success: true,
      state: syncedRebuiltState.state,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    config.onEvent?.({
      type: 'compaction_end',
      data: {
        turn: turnNumber,
        agentName: agent.name,
        status: 'failed',
        thresholdTokens,
        beforeInputTokens: currentInputTokens,
        compactedMessageCount,
        preservedMessageCount,
        error: detail,
        model,
      },
    });

    return {
      success: false,
      state: stateWithLedger,
      error: detail,
    };
  }
}

function normalizeTriggerPercentage(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_TRIGGER_PERCENTAGE;
  }

  if (value > 1 && value <= 100) {
    return value / 100;
  }

  if (value <= 0 || value > 1) {
    return DEFAULT_TRIGGER_PERCENTAGE;
  }

  return value;
}

function normalizeMinCandidateMessages(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MIN_CANDIDATE_MESSAGES;
  }

  return Math.max(1, Math.floor(value));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function createTokenLedger(
  messages: readonly Message[],
  overrides?: readonly (number | undefined)[],
  seed?: Readonly<TokenLedger>
): TokenLedger {
  const messageTokenEstimates = messages.map((message, index) => overrides?.[index] ?? estimateMessageTokens(message));

  return {
    messageTokenEstimates,
    totalMessageTokens: sum(messageTokenEstimates),
    lastSystemPromptText: seed?.lastSystemPromptText,
    lastSystemPromptTokens: seed?.lastSystemPromptTokens ?? 0,
  };
}

function estimateMessageTokens(message: Readonly<Message>): number {
  let total = estimateContentTokens(message.content);

  if (message.tool_calls && message.tool_calls.length > 0) {
    total += estimateTextTokens(JSON.stringify(message.tool_calls));
  }

  if (message.attachments && message.attachments.length > 0) {
    total += message.attachments.reduce((sumTokens, attachment) => sumTokens + estimateAttachmentTokens(attachment), 0);
  }

  if (message.tool_call_id) {
    total += estimateTextTokens(message.tool_call_id);
  }

  return total;
}

function estimateContentTokens(content: Message['content']): number {
  if (typeof content === 'string') {
    return estimateTextTokens(content);
  }

  if (Array.isArray(content)) {
    return content.reduce((total, part) => {
      if (part.type === 'text') {
        return total + estimateTextTokens(part.text);
      }

      if (part.type === 'image_url') {
        return total + estimateImageUrlTokens(part.image_url.url);
      }

      if (part.type === 'file') {
        return total + estimateTextTokens(JSON.stringify(part.file));
      }

      return total;
    }, 0);
  }

  return estimateTextTokens(getTextContent(content));
}

function estimateAttachmentTokens(attachment: NonNullable<Message['attachments']>[number]): number {
  if (attachment.kind === 'image') {
    return FIXED_IMAGE_TOKENS;
  }

  if (attachment.data) {
    return estimateEncodedTokens(attachment.data.length);
  }

  if (attachment.url?.startsWith('data:')) {
    const encodedPayload = attachment.url.split(',', 2)[1] || '';
    return estimateEncodedTokens(encodedPayload.length);
  }

  const placeholder = `${attachment.kind}:${attachment.name || attachment.mimeType || attachment.format || 'attachment'}${attachment.url ? `:${attachment.url}` : ''}`;
  return estimateTextTokens(placeholder);
}

function estimateImageUrlTokens(url: string): number {
  if (url.startsWith('data:')) {
    return FIXED_IMAGE_TOKENS;
  }
  return FIXED_IMAGE_TOKENS;
}

function estimateEncodedTokens(encodedLength: number): number {
  const estimatedBytes = Math.max(0, Math.floor((encodedLength * 3) / 4 - BASE64_DECODE_OVERHEAD_BYTES));
  return Math.ceil(estimatedBytes / 4);
}

function normalizeUsageTokens(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.ceil(value);
}

function splitMessagesForCompaction(
  messages: readonly Message[],
  compactionConfig: ResolvedCompactionConfig
): CompactionSegments {
  const boundaryIndex = resolveCompactionBoundary(messages, compactionConfig);

  return {
    boundaryIndex,
    compactableMessages: messages.slice(0, boundaryIndex),
    preservedMessages: messages.slice(boundaryIndex),
  };
}

function resolveCompactionBoundary(
  messages: readonly Message[],
  compactionConfig: ResolvedCompactionConfig
): number {
  let boundaryIndex = messages.length;

  const lastUserIndex = findLastIndex(messages, message => message.role === 'user');
  if (lastUserIndex >= 0) {
    boundaryIndex = Math.min(boundaryIndex, lastUserIndex);
  }

  if (compactionConfig.preserveLastAssistantMessage) {
    const lastAssistantIndex = findLastIndex(messages, message => message.role === 'assistant');
    if (lastAssistantIndex >= 0) {
      boundaryIndex = Math.min(boundaryIndex, lastAssistantIndex);
    }
  }

  const liveBoundary = findLiveSuffixBoundary(messages);
  if (liveBoundary >= 0) {
    boundaryIndex = Math.min(boundaryIndex, liveBoundary);
  }

  if (!Number.isFinite(boundaryIndex)) {
    return 0;
  }

  return Math.max(0, Math.min(boundaryIndex, messages.length));
}

function findLiveSuffixBoundary(messages: readonly Message[]): number {
  const pendingToolCallBoundary = findPendingToolCallBoundary(messages);
  if (pendingToolCallBoundary >= 0) {
    return pendingToolCallBoundary;
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role === 'tool') {
    const toolStatus = tryReadToolStatus(lastMessage);
    if (toolStatus === 'halted' || toolStatus === 'awaiting_clarification') {
      const toolCallId = lastMessage.tool_call_id;
      if (toolCallId) {
        const assistantIndex = findLastIndex(
          messages,
          (message, index) =>
            index < messages.length - 1 &&
            message.role === 'assistant' &&
            Boolean(message.tool_calls?.some(toolCall => toolCall.id === toolCallId))
        );
        if (assistantIndex >= 0) {
          return assistantIndex;
        }
      }

      return messages.length - 1;
    }
  }

  return -1;
}

function findPendingToolCallBoundary(messages: readonly Message[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant' || !message.tool_calls || message.tool_calls.length === 0) {
      continue;
    }

    const pendingToolCall = message.tool_calls.some(toolCall => !hasMatchingToolResultAfter(messages, index, toolCall.id));
    if (pendingToolCall) {
      return index;
    }
  }

  return -1;
}

function hasMatchingToolResultAfter(messages: readonly Message[], assistantIndex: number, toolCallId: string): boolean {
  for (let index = assistantIndex + 1; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === 'tool' && message.tool_call_id === toolCallId) {
      return true;
    }
  }

  return false;
}

function tryReadToolStatus(message: Readonly<Message>): string | undefined {
  if (message.role !== 'tool') {
    return undefined;
  }

  try {
    const content = JSON.parse(getTextContent(message.content));
    return typeof content?.status === 'string' ? content.status : undefined;
  } catch {
    return undefined;
  }
}

function findLastIndex<T>(
  values: readonly T[],
  predicate: (value: T, index: number) => boolean
): number {
  for (let index = values.length - 1; index >= 0; index--) {
    if (predicate(values[index], index)) {
      return index;
    }
  }

  return -1;
}

function createCompactionState<Ctx>(
  state: Readonly<RunState<Ctx>>,
  segments: Readonly<CompactionSegments>,
  compactionConfig: Readonly<ResolvedCompactionConfig>,
  systemPromptText: string
): RunState<Ctx> {
  return {
    ...state,
    currentAgentName: `${state.currentAgentName}:compaction`,
    messages: [
      {
        role: 'user',
        content: buildCompactionTranscript(segments.compactableMessages, systemPromptText, compactionConfig),
      },
    ],
    tokenLedger: undefined,
  };
}

function buildCompactionTranscript(
  messages: readonly Message[],
  systemPromptText: string,
  compactionConfig: Readonly<ResolvedCompactionConfig>
): string {
  const sections: string[] = [
    'Compact the following conversation history into a concise summary that preserves goals, facts, decisions, constraints, unresolved questions, approvals, clarifications, and important tool outputs.',
    'Return plain text only.',
  ];

  if (!compactionConfig.doNotCompactSystemPrompt) {
    sections.push(`SYSTEM PROMPT:\n${systemPromptText}`);
  }

  if (compactionConfig.rules) {
    sections.push(`ADDITIONAL COMPACTION RULES:\n${compactionConfig.rules}`);
  }

  sections.push(`TRANSCRIPT:\n${messages.map(formatMessageForCompaction).join('\n\n')}`);
  return sections.join('\n\n');
}

function formatMessageForCompaction(message: Readonly<Message>): string {
  const lines: string[] = [`[${message.role.toUpperCase()}]`];
  const body = describeMessageBody(message);
  if (body) {
    lines.push(body);
  }

  if (message.tool_calls && message.tool_calls.length > 0) {
    lines.push(`Tool Calls: ${JSON.stringify(message.tool_calls)}`);
  }

  if (message.tool_call_id) {
    lines.push(`Tool Call ID: ${message.tool_call_id}`);
  }

  return lines.join('\n');
}

function describeMessageBody(message: Readonly<Message>): string {
  const fragments: string[] = [];

  if (typeof message.content === 'string') {
    if (message.content.trim().length > 0) {
      fragments.push(message.content);
    }
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text' && part.text.trim().length > 0) {
        fragments.push(part.text);
      } else if (part.type === 'image_url') {
        fragments.push('[Image content]');
      } else if (part.type === 'file') {
        fragments.push(`[File content: ${JSON.stringify(part.file)}]`);
      }
    }
  } else {
    const text = getTextContent(message.content);
    if (text.trim().length > 0) {
      fragments.push(text);
    }
  }

  if (message.attachments && message.attachments.length > 0) {
    for (const attachment of message.attachments) {
      fragments.push(
        `[${attachment.kind === 'image' ? 'Image' : 'Attachment'} attachment: ${attachment.name || attachment.mimeType || attachment.format || 'unknown'}]`
      );
    }
  }

  return fragments.join('\n');
}

function createCompactionAgent<Ctx>(
  agent: Readonly<Agent<Ctx, any>>,
  model: string,
  rules?: string
): Agent<Ctx, string> {
  const instructionLines = [
    'You summarize older conversation history for JAF core compaction.',
    'Preserve user intent, important facts, constraints, important tool outputs, approvals, clarifications, and unresolved threads.',
    'Do not invent details.',
    'Return plain text only.',
  ];

  if (rules) {
    instructionLines.push(`Additional rules:\n${rules}`);
  }

  return {
    name: `${agent.name}_compaction`,
    instructions: () => instructionLines.join('\n\n'),
    tools: [],
    modelConfig: {
      name: model || undefined,
      temperature: 0,
    },
  };
}

function createCompactionRunConfig<Ctx>(
  config: Readonly<RunConfig<Ctx>>,
  provider: ModelProvider<Ctx>,
  model: string
): RunConfig<Ctx> {
  return {
    ...config,
    modelProvider: provider,
    modelOverride: model || config.modelOverride,
  };
}

function resolveCompactionRuntime<Ctx>(
  agent: Readonly<Agent<Ctx, any>>,
  config: Readonly<RunConfig<Ctx>>
): {
  readonly provider?: ModelProvider<Ctx>;
  readonly model: string;
  readonly usingOverrideProvider: boolean;
  readonly error?: string;
} {
  const provider = config.compaction?.modelProvider ?? config.modelProvider;
  const model = config.compaction?.modelOverride ?? agent.modelConfig?.name ?? config.modelOverride ?? '';
  const usingOverrideProvider = Boolean(config.compaction?.modelProvider && config.compaction.modelProvider !== config.modelProvider);

  if (!provider?.getCompletion) {
    return {
      model,
      usingOverrideProvider,
      error: 'Compaction provider does not implement getCompletion.',
    };
  }

  if (!model && !provider.isAiSdkProvider) {
    return {
      provider,
      model,
      usingOverrideProvider,
      error: 'No model is configured for compaction.',
    };
  }

  return {
    provider,
    model,
    usingOverrideProvider,
  };
}
