import { z } from 'zod';
import { MemoryConfig } from '../memory/types';
import type { ApprovalStorage } from '../memory/approval-storage';

export type TraceId = string & { readonly _brand: 'TraceId' };
export type RunId = string & { readonly _brand: 'RunId' };

export const createTraceId = (id: string): TraceId => id as TraceId;
export const createRunId = (id: string): RunId => id as RunId;

export type ValidationResult =
  | { readonly isValid: true }
  | { readonly isValid: false; readonly errorMessage: string };

export type ToolCall = {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
};

export type Attachment = {
  readonly kind: 'image' | 'document' | 'file';
  readonly mimeType?: string; // e.g. image/png, application/pdf
  readonly name?: string;     // Optional filename
  readonly url?: string;      // Remote URL or data URL
  readonly data?: string;     // Base64 without data: prefix
  readonly format?: string;   // Optional short format like 'pdf', 'txt'
  readonly useLiteLLMFormat?: boolean; // Use LiteLLM native file format instead of text extraction
};

export type MessageContentPart = 
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image_url'; readonly image_url: { readonly url: string; readonly detail?: 'low' | 'high' | 'auto' } }
  | { readonly type: 'file'; readonly file: { readonly file_id: string; readonly format?: string } };

export type Message = {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string | readonly MessageContentPart[];
  readonly attachments?: readonly Attachment[]; // Optional structured attachments
  readonly tool_call_id?: string;
  readonly tool_calls?: readonly ToolCall[];
};

export function getTextContent(content: string | readonly MessageContentPart[] | any): string {
  if (typeof content === 'string') {
    return content;
  }
  
  if (Array.isArray(content)) {
    return content
      .filter(item => item && typeof item === 'object' && item.type === 'text')
      .map(item => item.text || '')
      .join(' ');
  }
  
  if (content && typeof content === 'object') {
    return content.text || content.content || '';
  }
  
  return String(content || '');
}

export type ModelConfig = {
  readonly name?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
};

export type Tool<A, Ctx> = {
  readonly schema: {
    readonly name: string;
    readonly description: string;
    readonly parameters: z.ZodType<A>;
  };
  readonly execute: (
    args: A,
    context: Readonly<Ctx>,
  ) => Promise<string | import('./tool-results').ToolResult>;
  readonly needsApproval?:
    | boolean
    | ((
        context: Readonly<Ctx>,
        params: Readonly<A>,
      ) => Promise<boolean> | boolean);
};

export type AdvancedGuardrailsConfig = {
  readonly inputPrompt?: string;
  readonly outputPrompt?: string;
  readonly requireCitations?: boolean;
  readonly fastModel?: string;
  readonly failSafe?: 'allow' | 'block';
  readonly executionMode?: 'parallel' | 'sequential';
  readonly timeoutMs?: number;
};

export const defaultGuardrailsConfig: Required<AdvancedGuardrailsConfig> = {
  inputPrompt: '',
  outputPrompt: '',
  requireCitations: false,
  fastModel: '',
  failSafe: 'allow',
  executionMode: 'parallel',
  timeoutMs: 30000
};

export function validateGuardrailsConfig(
  config: AdvancedGuardrailsConfig
): Required<AdvancedGuardrailsConfig> {
  return {
    inputPrompt: config.inputPrompt?.trim() || defaultGuardrailsConfig.inputPrompt,
    outputPrompt: config.outputPrompt?.trim() || defaultGuardrailsConfig.outputPrompt,
    requireCitations: config.requireCitations ?? defaultGuardrailsConfig.requireCitations,
    fastModel: config.fastModel?.trim() || defaultGuardrailsConfig.fastModel,
    failSafe: config.failSafe || defaultGuardrailsConfig.failSafe,
    executionMode: config.executionMode || defaultGuardrailsConfig.executionMode,
    timeoutMs: Math.max(1000, config.timeoutMs || defaultGuardrailsConfig.timeoutMs)
  };
}

export type AdvancedConfig = {
  readonly guardrails?: AdvancedGuardrailsConfig;
};

export type Agent<Ctx, Out> = {
  readonly name: string;
  readonly instructions: (state: Readonly<RunState<Ctx>>) => string;
  readonly tools?: readonly Tool<any, Ctx>[];
  readonly outputCodec?: z.ZodType<Out>;
  readonly handoffs?: readonly string[];
  readonly modelConfig?: ModelConfig;
  readonly advancedConfig?: AdvancedConfig;
};

export type Guardrail<I> = (
  input: I
) => Promise<ValidationResult> | ValidationResult;

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type ApprovalValue = {
  readonly status: ApprovalStatus;
  readonly approved: boolean;
  readonly additionalContext?: Record<string, any>;
};

export type RunState<Ctx> = {
  readonly runId: RunId;
  readonly traceId: TraceId;
  readonly messages: readonly Message[];
  readonly currentAgentName: string;
  readonly context: Readonly<Ctx>;
  readonly turnCount: number;
  readonly approvals?: ReadonlyMap<string, ApprovalValue>;
};

export type JAFError =
  | { readonly _tag: "MaxTurnsExceeded"; readonly turns: number }
  | { readonly _tag: "ModelBehaviorError"; readonly detail: string }
  | { readonly _tag: "DecodeError"; readonly errors: z.ZodIssue[] }
  | { readonly _tag: "InputGuardrailTripwire"; readonly reason: string }
  | { readonly _tag: "OutputGuardrailTripwire"; readonly reason: string }
  | { readonly _tag: "ToolCallError"; readonly tool: string; readonly detail: string }
  | { readonly _tag: "HandoffError"; readonly detail: string }
  | { readonly _tag: "AgentNotFound"; readonly agentName: string };

export type ToolApprovalInterruption<Ctx> = {
  readonly type: 'tool_approval';
  readonly toolCall: ToolCall;
  readonly agent: Agent<Ctx, any>;
  readonly sessionId?: string;
};

export type Interruption<Ctx> = ToolApprovalInterruption<Ctx>;

export type RunResult<Out> = {
  readonly finalState: RunState<any>;
  readonly outcome:
    | { readonly status: 'completed'; readonly output: Out }
    | { readonly status: 'error'; readonly error: JAFError }
    | {
        readonly status: 'interrupted';
        readonly interruptions: readonly Interruption<any>[];
      };
};

/**
 * Comprehensive trace event system with discriminated unions
 * All events follow the pattern: { type: string, data: {...properties} }
 */
export type TraceEvent =
  | { type: 'run_start'; data: { runId: RunId; traceId: TraceId; context?: any; userId?: string; sessionId?: string; messages?: readonly Message[]; } }
  | { type: 'turn_start'; data: { turn: number; agentName: string } }
  | { type: 'llm_call_start'; data: { agentName: string; model: string; traceId: TraceId; runId: RunId; messages?: readonly Message[]; tools?: any[]; modelConfig?: any; turnCount?: number; context?: any; } }
  | { type: 'llm_call_end'; data: { choice: any; fullResponse?: any; prompt?: any; traceId: TraceId; runId: RunId; agentName?: string; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; }; estimatedCost?: { promptCost: number; completionCost: number; totalCost: number; }; } }
  | { type: 'token_usage'; data: { prompt?: number; completion?: number; total?: number; model?: string } }
  | { type: 'tool_call_start'; data: { toolName: string; args: any; traceId: TraceId; runId: RunId; toolSchema?: any; context?: any; agentName?: string; } }
  | { type: 'tool_call_end'; data: { toolName: string; result: string; toolResult?: any; status?: string; traceId: TraceId; runId: RunId; executionTime?: number; error?: any; metadata?: any; } }
  | { type: 'agent_processing'; data: { agentName: string; traceId: TraceId; runId: RunId; turnCount: number; messageCount: number; toolsAvailable: Array<{ name: string; description: string }>; handoffsAvailable: readonly string[]; modelConfig?: any; hasOutputCodec: boolean; context: any; currentState: any; } }
  | { type: 'handoff'; data: { from: string; to: string; } }
  | { type: 'tool_requests'; data: { toolCalls: Array<{ id: string; name: string; args: any }>; } }
  | { type: 'tool_results_to_llm'; data: { results: Message[] } }
  | { type: 'assistant_message'; data: { message: Message } }
  | { type: 'final_output'; data: { output: any } }
  | { type: 'handoff_denied'; data: { from: string; to: string; reason: string } }
  | { type: 'guardrail_violation'; data: { stage: 'input' | 'output'; reason: string } }
  | { type: 'guardrail_check'; data: { guardrailName: string; content: any; isValid?: boolean; errorMessage?: string; } }
  | { type: 'memory_operation'; data: { operation: 'load' | 'store'; conversationId: string; status: 'start' | 'end' | 'fail'; error?: string; messageCount?: number; } }
  | { type: 'output_parse'; data: { content: string; status: 'start' | 'end' | 'fail'; parsedOutput?: any; error?: string; } }
  | { type: 'decode_error'; data: { errors: z.ZodIssue[] } }
  | { type: 'turn_end'; data: { turn: number; agentName: string } }
  | { type: 'run_end'; data: { outcome: RunResult<any>['outcome']; traceId: TraceId; runId: RunId; } };

/**
 * Helper type to extract event data by event type
 * @example EventData<'llm_call_end'> -> { choice: any, fullResponse?: any, ... }
 */
export type EventData<T extends TraceEvent['type']> = Extract<TraceEvent, { type: T }>['data'];

/**
 * Token usage information from LLM calls
 */
export type TokenUsage = {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
};

/**
 * Cost estimation for LLM calls
 */
export type CostEstimate = {
  readonly promptCost: number;
  readonly completionCost: number;
  readonly totalCost: number;
};

/**
 * Simplified event handler interface for common use cases
 * This provides an alternative to handling raw TraceEvent discriminated unions
 *
 * @example
 * ```typescript
 * const handler = createSimpleEventHandler({
 *   onAssistantMessage: (content, thinking) => {
 *     console.log('Assistant:', content);
 *   },
 *   onToolCalls: (calls) => {
 *     console.log('Tools requested:', calls.map(c => c.name));
 *   },
 *   onToolResult: (toolName, result) => {
 *     console.log(`${toolName} completed:`, result);
 *   }
 * });
 * ```
 */
export type SimpleEventHandlers = {
  /** Called when assistant generates a message */
  onAssistantMessage?: (content: string, thinking?: string) => void;

  /** Called when tool calls are requested */
  onToolCalls?: (toolCalls: Array<{ id: string; name: string; args: any }>) => void;

  /** Called when a tool execution completes */
  onToolResult?: (toolName: string, result: string, error?: any) => void;

  /** Called when an error occurs */
  onError?: (error: any, context?: any) => void;

  /** Called when run starts */
  onRunStart?: (runId: RunId, traceId: TraceId) => void;

  /** Called when run ends */
  onRunEnd?: (outcome: RunResult<any>['outcome']) => void;

  /** Called on token usage updates */
  onTokenUsage?: (usage: TokenUsage) => void;

  /** Called when agent hands off to another agent */
  onHandoff?: (from: string, to: string) => void;
};

/**
 * Create a TraceEvent handler from simple event handlers
 * Converts the simplified handler API to a full TraceEvent handler
 *
 * @param handlers - Object with optional event handler callbacks
 * @returns A function that handles TraceEvent discriminated unions
 *
 * @example
 * ```typescript
 * const config: RunConfig<MyContext> = {
 *   // ... other config
 *   onEvent: createSimpleEventHandler({
 *     onAssistantMessage: (content) => console.log(content),
 *     onToolCalls: (calls) => console.log('Tools:', calls),
 *   })
 * };
 * ```
 */
export function createSimpleEventHandler(handlers: SimpleEventHandlers): (event: TraceEvent) => void {
  return (event: TraceEvent) => {
    switch (event.type) {
      case 'run_start':
        handlers.onRunStart?.(event.data.runId, event.data.traceId);
        break;

      case 'run_end':
        handlers.onRunEnd?.(event.data.outcome);
        break;

      case 'assistant_message':
        if (event.data.message.role === 'assistant') {
          const content = getTextContent(event.data.message.content);
          handlers.onAssistantMessage?.(content);
        }
        break;

      case 'llm_call_end':
        // Extract assistant message from LLM response
        if (event.data.choice?.message) {
          const content = getTextContent(event.data.choice.message.content || '');
          if (content) {
            handlers.onAssistantMessage?.(content);
          }
        }
        // Handle token usage
        if (event.data.usage) {
          handlers.onTokenUsage?.(event.data.usage);
        }
        break;

      case 'tool_requests':
        handlers.onToolCalls?.(event.data.toolCalls);
        break;

      case 'tool_call_end':
        handlers.onToolResult?.(
          event.data.toolName,
          event.data.result,
          event.data.error
        );
        break;

      case 'handoff':
        handlers.onHandoff?.(event.data.from, event.data.to);
        break;

      case 'token_usage':
        if (event.data.total || event.data.prompt || event.data.completion) {
          handlers.onTokenUsage?.({
            prompt_tokens: event.data.prompt,
            completion_tokens: event.data.completion,
            total_tokens: event.data.total,
          });
        }
        break;

      case 'decode_error':
      case 'guardrail_violation':
        handlers.onError?.(event.data);
        break;
    }
  };
}

export type CompletionStreamChunk = {
  readonly delta?: string;
  readonly toolCallDelta?: {
    readonly index: number;
    readonly id?: string;
    readonly type: 'function';
    readonly function?: {
      readonly name?: string;
      readonly argumentsDelta?: string;
    };
  };
  readonly isDone?: boolean;
  readonly finishReason?: string | null;
  readonly raw?: any;
};

export interface ModelProvider<Ctx> {
  isAiSdkProvider?: boolean;
  getCompletion: (
    state: Readonly<RunState<Ctx>>,
    agent: Readonly<Agent<Ctx, any>>,
    config: Readonly<RunConfig<Ctx>>
  ) => Promise<{
    message?: {
      content?: string | null;
      tool_calls?: readonly ToolCall[];
    };
  }>;
  getCompletionStream?: (
    state: Readonly<RunState<Ctx>>,
    agent: Readonly<Agent<Ctx, any>>,
    config: Readonly<RunConfig<Ctx>>
  ) => AsyncGenerator<CompletionStreamChunk, void, unknown>;
}

export type RunConfig<Ctx> = {
  readonly agentRegistry: ReadonlyMap<string, Agent<Ctx, any>>;
  readonly modelProvider: ModelProvider<Ctx>;
  readonly maxTurns?: number;
  readonly modelOverride?: string;
  readonly initialInputGuardrails?: readonly Guardrail<string>[];
  readonly finalOutputGuardrails?: readonly Guardrail<any>[];
  readonly onEvent?: (event: TraceEvent) => void;
  readonly memory?: MemoryConfig;
  readonly conversationId?: string;
  readonly approvalStorage?: ApprovalStorage;
  readonly defaultFastModel?: string;
};

export const jsonParseLLMOutput = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

