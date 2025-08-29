import { z } from 'zod';
import { MemoryConfig } from '../memory/types';

export type TraceId = string & { readonly _brand: 'TraceId' };
export type RunId = string & { readonly _brand: 'RunId' };

export const createTraceId = (id: string): TraceId => id as TraceId;
export const createRunId = (id: string): RunId => id as RunId;

export type ValidationResult =
  | { readonly isValid: true }
  | { readonly isValid: false; readonly errorMessage: string };

export type Message = {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly tool_call_id?: string;
  readonly tool_calls?: readonly {
    readonly id: string;
    readonly type: 'function';
    readonly function: {
      readonly name: string;
      readonly arguments: string;
    };
  }[];
};

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
  readonly execute: (args: A, context: Readonly<Ctx>) => Promise<string | import('./tool-results').ToolResult>;
};

export type Agent<Ctx, Out> = {
  readonly name: string;
  readonly instructions: (state: Readonly<RunState<Ctx>>) => string;
  readonly tools?: readonly Tool<any, Ctx>[];
  readonly outputCodec?: z.ZodType<Out>;
  readonly handoffs?: readonly string[];
  readonly modelConfig?: ModelConfig;
};

export type Guardrail<I> = (
  input: I
) => Promise<ValidationResult> | ValidationResult;

export type RunState<Ctx> = {
  readonly runId: RunId;
  readonly traceId: TraceId;
  readonly messages: readonly Message[];
  readonly currentAgentName: string;
  readonly context: Readonly<Ctx>;
  readonly turnCount: number;
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

export type RunResult<Out> = {
  readonly finalState: RunState<any>;
  readonly outcome:
    | { readonly status: 'completed'; readonly output: Out }
    | { readonly status: 'error'; readonly error: JAFError };
};

export type TraceEvent =
  | { type: 'run_start'; data: { runId: RunId; traceId: TraceId; } }
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

export interface ModelProvider<Ctx> {
  getCompletion: (
    state: Readonly<RunState<Ctx>>,
    agent: Readonly<Agent<Ctx, any>>,
    config: Readonly<RunConfig<Ctx>>
  ) => Promise<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
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
};
