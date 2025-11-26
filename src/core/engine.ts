import {
  RunState,
  RunConfig,
  RunResult,
  Message,
  TraceEvent,
  Agent,
  ToolCall,
  Interruption,
  getTextContent,
  Guardrail,
  ClarificationOption,
  Tool,
  InterruptionStatus,
} from './types.js';
import { setToolRuntime } from './tool-runtime.js';
import { buildEffectiveGuardrails, executeInputGuardrailsParallel, executeInputGuardrailsSequential, executeOutputGuardrails } from './guardrails.js';
import { safeConsole } from '../utils/logger.js';
import { DEFAULT_CLARIFICATION_DESCRIPTION } from '../utils/constants.js';

type ClarificationTriggerMarker = {
  readonly _clarification_trigger: true;
  readonly question: string;
  readonly options: readonly ClarificationOption[];
  readonly context?: Record<string, unknown>;
};

/**
 * Create the built-in clarification tool
 */
function createClarificationTool<Ctx>(config: RunConfig<Ctx>): Tool<{
  question: string;
  options: ClarificationOption[];
}, Ctx> {
  const description = config.clarificationDescription || DEFAULT_CLARIFICATION_DESCRIPTION;

  return {
    schema: {
      name: 'request_user_clarification',
      description,
      parameters: z.object({
        question: z.string().describe('The clarifying question to ask the user'),
        options: z.array(z.object({
          id: z.string().describe('Unique identifier for this option'),
          label: z.string().describe('Human-readable label shown to the user')
        })).min(2).describe('clear and meaningful options that user can choose from (minimum 2 options)')
      })
    },
    execute: async (args, _context): Promise<string> => {
      const trigger: ClarificationTriggerMarker = {
        _clarification_trigger: true,
        question: args.question,
        options: args.options
      };
      return JSON.stringify(trigger);
    }
  };
}


export async function run<Ctx, Out>(
  initialState: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<RunResult<Out>> {
  try {
    config.onEvent?.({
      type: 'run_start',
      data: { 
        runId: initialState.runId, 
        traceId: initialState.traceId,
        context: initialState.context,
        userId: (initialState.context as any)?.userId,
        sessionId: (initialState.context as any)?.sessionId || (initialState.context as any)?.conversationId,
        messages: initialState.messages
      }
    });

    let stateWithMemory = initialState;
    if (config.memory?.autoStore && config.conversationId) {
      safeConsole.log(`[JAF:ENGINE] Loading conversation history for ${config.conversationId}`);
      stateWithMemory = await loadConversationHistory(initialState, config);
    } else {
      safeConsole.log(`[JAF:ENGINE] Skipping memory load - autoStore: ${config.memory?.autoStore}, conversationId: ${config.conversationId}`);
    }

    if (config.approvalStorage) {
      safeConsole.log(`[JAF:ENGINE] Loading approvals for runId ${stateWithMemory.runId}`);
      const { loadApprovalsIntoState } = await import('./state');
      stateWithMemory = await loadApprovalsIntoState(stateWithMemory, config);
    }

    const result = await runInternal<Ctx, Out>(stateWithMemory, config);

    if (config.memory?.autoStore && config.conversationId && result.outcome.status === 'completed' && config.memory.storeOnCompletion) {
      safeConsole.log(`[JAF:ENGINE] Storing final completed conversation for ${config.conversationId}`);
      await storeConversationHistory(result.finalState, config);
    } else if (result.outcome.status === 'interrupted') {
      safeConsole.log(`[JAF:ENGINE] Conversation interrupted - storage already handled during interruption`);
    } else {
      safeConsole.log(`[JAF:ENGINE] Skipping memory store - status: ${result.outcome.status}, storeOnCompletion: ${config.memory?.storeOnCompletion}`);
    }

    config.onEvent?.({
      type: 'run_end',
      data: {
        outcome: result.outcome,
        finalState: result.finalState,
        traceId: initialState.traceId,
        runId: initialState.runId
      }
    });

    return result;
  } catch (error) {
    const errorResult: RunResult<Out> = {
      finalState: initialState,
      outcome: {
        status: 'error',
        error: {
          _tag: 'ModelBehaviorError',
          detail: error instanceof Error ? error.message : String(error)
        }
      }
    } as RunResult<Out>;

    config.onEvent?.({
      type: 'run_end',
      data: {
        outcome: errorResult.outcome,
        finalState: errorResult.finalState,
        traceId: initialState.traceId,
        runId: initialState.runId
      }
    });

    return errorResult;
  }
}

function createAsyncEventStream<T>() {
  const queue: T[] = [];
  let resolveNext: ((value: IteratorResult<T>) => void) | null = null;
  let done = false;

  return {
    push(event: T) {
      if (done) return;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: event, done: false });
      } else {
        queue.push(event);
      }
    },
    end() {
      if (done) return;
      done = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: undefined as any, done: true });
      }
    },
    iterator: {
      [Symbol.asyncIterator]() {
        return this;
      },
      next(): Promise<IteratorResult<T>> {
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift() as T, done: false });
        }
        if (done) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          resolveNext = resolve;
        });
      },
    },
  } as const;
}

async function runTurnEndHooks<Ctx>(
  config: RunConfig<Ctx>,
  payload: {
    readonly turn: number;
    readonly agentName: string;
    readonly state: RunState<Ctx>;
    readonly lastAssistantMessage?: Message;
  }
): Promise<void> {
  config.onEvent?.({
    type: 'turn_end',
    data: { turn: payload.turn, agentName: payload.agentName }
  });

  if (config.onTurnEnd) {
    await config.onTurnEnd({
      turn: payload.turn,
      agentName: payload.agentName,
      state: payload.state,
      lastAssistantMessage: payload.lastAssistantMessage
    });
  }
}

/**
 * Stream run events as they happen via an async generator.
 * Consumers can iterate events to build live UIs or forward via SSE.
 *
 * @param initialState - The initial run state
 * @param config - Run configuration
 * @param streamEventHandler - Optional event handler for the stream consumer to handle/modify events
 */
export async function* runStream<Ctx, Out>(
  initialState: RunState<Ctx>,
  config: RunConfig<Ctx>,
  streamEventHandler?: (event: TraceEvent) => void | any | Promise<void | any>
): AsyncGenerator<TraceEvent, void, unknown> {
  const stream = createAsyncEventStream<TraceEvent>();

  const onEvent = async (event: TraceEvent) => {
    // First, let the stream consumer handle it (can modify before events)
    let eventResult: any;
    if (streamEventHandler) {
      try {
        eventResult = await streamEventHandler(event);
      } catch { /* ignore */ }
    }

    // Then push to stream for observation
    try { stream.push(event); } catch { /* ignore */ }

    // Also call config.onEvent if provided
    try {
      const configResult = await config.onEvent?.(event);
      // If config.onEvent returns a value and streamEventHandler didn't, use config result
      if (configResult !== undefined && eventResult === undefined) {
        eventResult = configResult;
      }
    } catch { /* ignore */ }

    // Return the result (for before events)
    return eventResult;
  };

  const runPromise = run<Ctx, Out>(initialState, { ...config, onEvent });
  void runPromise.finally(() => {
    stream.end();
  });

  try {
    for await (const event of stream.iterator as AsyncGenerator<TraceEvent>) {
      yield event;
    }
  } finally {
    await runPromise.catch(() => undefined);
  }
}

async function tryResumePendingToolCalls<Ctx, Out>(
  state: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<RunResult<Out> | null> {
  try {
    const messages = state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        const ids = new Set(msg.tool_calls.map(tc => tc.id));

        const executed = new Set<string>();
        for (let j = i + 1; j < messages.length; j++) {
          const m = messages[j];
          if (m.role === 'tool' && m.tool_call_id && ids.has(m.tool_call_id)) {
            executed.add(m.tool_call_id);
          }
        }

        const pendingToolCalls = msg.tool_calls.filter(tc => !executed.has(tc.id));
        if (pendingToolCalls.length === 0) {
          return null; // Nothing to resume
        }

        const currentAgent = config.agentRegistry.get(state.currentAgentName);
        if (!currentAgent) {
          return {
            finalState: state,
            outcome: {
              status: 'error',
              error: {
                _tag: 'AgentNotFound',
                agentName: state.currentAgentName,
              }
            }
          } as RunResult<Out>;
        }

        try {
          const requests = pendingToolCalls.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            args: tryParseJSON(tc.function.arguments)
          }));
          config.onEvent?.({ type: 'tool_requests', data: { toolCalls: requests } });
        } catch { /* ignore */ }

        const toolResults = await executeToolCalls(pendingToolCalls, currentAgent, state, config);

        const interruptions = toolResults
          .map(r => r.interruption)
          .filter((it): it is Interruption<Ctx> => it !== undefined);
        if (interruptions.length > 0) {
          const nonInterruptedResults = toolResults.filter(r => !r.interruption);
          return {
            finalState: {
              ...state,
              messages: [...state.messages, ...nonInterruptedResults.map(r => r.message)],
              turnCount: state.turnCount,
            },
            outcome: {
              status: 'interrupted',
              interruptions,
            },
          } as RunResult<Out>;
        }

        config.onEvent?.({
          type: 'tool_results_to_llm',
          data: { results: toolResults.map(r => r.message) }
        });

        const nextState: RunState<Ctx> = {
          ...state,
          messages: [...state.messages, ...toolResults.map(r => r.message)],
          turnCount: state.turnCount,
          approvals: state.approvals ?? new Map(),
        };
        return await runInternal<Ctx, Out>(nextState, config);
      }
    }
  } catch {
    // Ignore resume errors and continue with normal flow
  }
  return null;
}

async function runInternal<Ctx, Out>(
  state: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<RunResult<Out>> {
  const resumed = await tryResumePendingToolCalls<Ctx, Out>(state, config);
  if (resumed) return resumed;

  // Check if we're resuming from a clarification
  if (state.clarifications && state.clarifications.size > 0) {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage?.role === 'tool') {
      try {
        const content = JSON.parse(getTextContent(lastMessage.content));
        if (content.status === InterruptionStatus.AwaitingClarification) {
          const clarificationId = content.clarification_id;
          const selectedId = state.clarifications.get(clarificationId);

          if (selectedId) {
            safeConsole.log(`[JAF:ENGINE] Resuming with clarification: ${clarificationId}, selected option: ${selectedId}`);

            // Find the selected option to include in the event
            const updatedMessages = [...state.messages];
            updatedMessages[updatedMessages.length - 1] = {
              ...lastMessage,
              content: JSON.stringify({
                status: InterruptionStatus.ClarificationProvided,
                message: `User selected option: ${selectedId}`
              })
            };

            config.onEvent?.({
              type: 'clarification_provided',
              data: {
                clarificationId,
                selectedId,
                selectedOption: { id: selectedId, label: selectedId }
              }
            });

            // Continue execution with updated messages
            const stateWithClarification: RunState<Ctx> = {
              ...state,
              messages: updatedMessages
            };

            return runInternal(stateWithClarification, config);
          }
        }
      } catch (e) {
        safeConsole.log(`[JAF:ENGINE] Error checking for clarification resume:`, e);
      }
    }
  }

  const maxTurns = config.maxTurns ?? 50;
  if (state.turnCount >= maxTurns) {
    return {
      finalState: state,
      outcome: {
        status: 'error',
        error: {
          _tag: 'MaxTurnsExceeded',
          turns: state.turnCount
        }
      }
    };
  }

  const currentAgent = config.agentRegistry.get(state.currentAgentName);
  if (!currentAgent) {
    return {
      finalState: state,
      outcome: {
        status: 'error',
        error: {
          _tag: 'AgentNotFound',
          agentName: state.currentAgentName
        }
      }
    };
  }

  const hasAdvancedGuardrails = !!(currentAgent.advancedConfig?.guardrails &&
    (currentAgent.advancedConfig.guardrails.inputPrompt ||
     currentAgent.advancedConfig.guardrails.outputPrompt ||
     currentAgent.advancedConfig.guardrails.requireCitations));

  safeConsole.log('[JAF:ENGINE] Debug guardrails setup:', {
    agentName: currentAgent.name,
    hasAdvancedConfig: !!currentAgent.advancedConfig,
    hasAdvancedGuardrails,
    initialInputGuardrails: config.initialInputGuardrails?.length || 0,
    finalOutputGuardrails: config.finalOutputGuardrails?.length || 0
  });

  let effectiveInputGuardrails: Guardrail<string>[] = [];
  let effectiveOutputGuardrails: Guardrail<any>[] = [];
  
  if (hasAdvancedGuardrails) {
    const result = await buildEffectiveGuardrails(currentAgent, config);
    effectiveInputGuardrails = result.inputGuardrails;
    effectiveOutputGuardrails = result.outputGuardrails;
  } else {
    effectiveInputGuardrails = [...(config.initialInputGuardrails || [])];
    effectiveOutputGuardrails = [...(config.finalOutputGuardrails || [])];
  }

  const inputGuardrailsToRun = (state.turnCount === 0 && effectiveInputGuardrails.length > 0)
    ? effectiveInputGuardrails
    : [];

  safeConsole.log('[JAF:ENGINE] Input guardrails to run:', {
    turnCount: state.turnCount,
    effectiveInputLength: effectiveInputGuardrails.length,
    inputGuardrailsToRunLength: inputGuardrailsToRun.length,
    hasAdvancedGuardrails
  });

  const effectiveTools = [
    ...(currentAgent.tools || [])
  ];

  if(config.allowClarificationRequests){
    effectiveTools.push(createClarificationTool(config));
  }
  const effectiveAgent: Agent<Ctx, any> = {
    ...currentAgent,
    tools: effectiveTools
  };

  safeConsole.log(`[JAF:ENGINE] Using agent: ${effectiveAgent.name}`);
  if (effectiveTools) {
    safeConsole.log(`[JAF:ENGINE] Available tools:`, effectiveTools.map(t => t.schema.name));
  }

  config.onEvent?.({
    type: 'agent_processing',
    data: {
      agentName: effectiveAgent.name,
      traceId: state.traceId,
      runId: state.runId,
      turnCount: state.turnCount,
      messageCount: state.messages.length,
      toolsAvailable: effectiveTools.map(t => ({
        name: t.schema.name,
        description: t.schema.description
      })),
      handoffsAvailable: effectiveAgent.handoffs || [],
      modelConfig: effectiveAgent.modelConfig,
      hasOutputCodec: !!effectiveAgent.outputCodec,
      context: state.context,
      currentState: {
        messages: state.messages.map(m => ({
          role: m.role,
          contentLength: m.content?.length || 0,
          hasToolCalls: !!m.tool_calls?.length
        }))
      }
    }
  });


  const model = currentAgent.modelConfig?.name ?? config.modelOverride;

  if (!model && !(config.modelProvider as any).isAiSdkProvider) {
    return {
      finalState: state,
      outcome: {
        status: 'error',
        error: {
          _tag: 'ModelBehaviorError',
          detail: 'No model configured for agent'
        }
      }
    };
  }
  
  const turnNumber = state.turnCount + 1;
  config.onEvent?.({ type: 'turn_start', data: { turn: turnNumber, agentName: currentAgent.name } });

  const llmCallData = {
    agentName: effectiveAgent.name,
    model: model || 'unknown',
    traceId: state.traceId,
    runId: state.runId,
    messages: state.messages,
    tools: effectiveTools.map(tool => ({
      name: tool.schema.name,
      description: tool.schema.description,
      parameters: tool.schema.parameters
    })),
    modelConfig: {
      ...effectiveAgent.modelConfig,
      modelOverride: config.modelOverride
    },
    turnCount: state.turnCount,
    context: state.context
  };

  config.onEvent?.({
    type: 'llm_call_start',
    data: llmCallData
  });

  let llmResponse: any;
  let streamingUsed = false;
  let assistantEventStreamed = false;
  
  if (inputGuardrailsToRun.length > 0 && state.turnCount === 0) {
    const firstUserMessage = state.messages.find(m => m.role === 'user');
    if (firstUserMessage) {
      if (hasAdvancedGuardrails) {
        const executionMode = currentAgent.advancedConfig?.guardrails?.executionMode || 'parallel';
      
      if (executionMode === 'sequential') {
        const guardrailResult = await executeInputGuardrailsSequential(inputGuardrailsToRun, firstUserMessage, config);
        if (!guardrailResult.isValid) {
          await runTurnEndHooks(config, {
            turn: turnNumber,
            agentName: currentAgent.name,
            state,
            lastAssistantMessage: undefined
          });
          return {
            finalState: state,
            outcome: {
              status: 'error',
              error: {
                _tag: 'InputGuardrailTripwire',
                reason: guardrailResult.errorMessage
              }
            }
          };
        }

        safeConsole.log(`✅ All input guardrails passed. Starting LLM call.`);
        llmResponse = await config.modelProvider.getCompletion(state, effectiveAgent, config);
      } else {
        const guardrailPromise = executeInputGuardrailsParallel(inputGuardrailsToRun, firstUserMessage, config);
        const llmPromise = config.modelProvider.getCompletion(state, effectiveAgent, config);
        
        const [guardrailResult, llmResult] = await Promise.all([
          guardrailPromise,
          llmPromise
        ]);
        
        llmResponse = llmResult;

        if (!guardrailResult.isValid) {
          safeConsole.log(`🚨 Input guardrail violation: ${guardrailResult.errorMessage}`);
          safeConsole.log(`[JAF:GUARDRAILS] Discarding LLM response due to input guardrail violation`);
          await runTurnEndHooks(config, {
            turn: turnNumber,
            agentName: currentAgent.name,
            state,
            lastAssistantMessage: undefined
          });
          return {
            finalState: state,
            outcome: {
              status: 'error',
              error: {
                _tag: 'InputGuardrailTripwire',
                reason: guardrailResult.errorMessage
              }
            }
          };
        }

        safeConsole.log(`✅ All input guardrails passed. Using LLM response.`);
        }
      } else {
        safeConsole.log('[JAF:ENGINE] Using LEGACY guardrails path with', inputGuardrailsToRun.length, 'guardrails');
        for (const guardrail of inputGuardrailsToRun) {
          const result = await guardrail(getTextContent(firstUserMessage.content));
          if (!result.isValid) {
            const errorMessage = !result.isValid ? result.errorMessage : '';
            config.onEvent?.({
              type: 'guardrail_violation',
              data: { stage: 'input', reason: errorMessage }
            });
            await runTurnEndHooks(config, {
              turn: turnNumber,
              agentName: currentAgent.name,
              state,
              lastAssistantMessage: undefined
            });
            return {
              finalState: state,
              outcome: {
                status: 'error',
                error: {
                  _tag: 'InputGuardrailTripwire',
                  reason: errorMessage
                }
              }
            };
          }
        }
        llmResponse = await config.modelProvider.getCompletion(state, effectiveAgent, config);
      }
    } else {
      if (typeof config.modelProvider.getCompletionStream === 'function') {
        try {
          streamingUsed = true;
          const stream = config.modelProvider.getCompletionStream(state, effectiveAgent, config);
          let aggregatedText = '';
          const toolCalls: Array<{ id?: string; type: 'function'; function: { name?: string; arguments: string } }> = [];

          for await (const chunk of stream) {
            if (chunk?.delta) {
              aggregatedText += chunk.delta;
            }
            if (chunk?.toolCallDelta) {
              const idx = chunk.toolCallDelta.index ?? 0;
              while (toolCalls.length <= idx) {
                toolCalls.push({ id: undefined, type: 'function', function: { name: undefined, arguments: '' } });
              }
              const target = toolCalls[idx];
              if (chunk.toolCallDelta.id) target.id = chunk.toolCallDelta.id;
              if (chunk.toolCallDelta.function?.name) target.function.name = chunk.toolCallDelta.function.name;
              if (chunk.toolCallDelta.function?.argumentsDelta) {
                target.function.arguments += chunk.toolCallDelta.function.argumentsDelta;
              }
            }

            if (chunk?.delta || chunk?.toolCallDelta) {
              assistantEventStreamed = true;
              const partialMessage: Message = {
                role: 'assistant',
                content: aggregatedText,
                ...(toolCalls.length > 0
                  ? {
                      tool_calls: toolCalls.map((tc, i) => ({
                        id: tc.id ?? `call_${i}`,
                        type: 'function' as const,
                        function: {
                          name: tc.function.name ?? '',
                          arguments: tc.function.arguments
                        }
                      }))
                    }
                  : {})
              };
              try { config.onEvent?.({ type: 'assistant_message', data: { message: partialMessage } }); } catch (err) { safeConsole.error('Error in config.onEvent:', err); }
            }
          }

          llmResponse = {
            message: {
              content: aggregatedText || undefined,
              ...(toolCalls.length > 0
                ? {
                    tool_calls: toolCalls.map((tc, i) => ({
                      id: tc.id ?? `call_${i}`,
                      type: 'function' as const,
                      function: {
                        name: tc.function.name ?? '',
                        arguments: tc.function.arguments
                      }
                    }))
                  }
                : {})
            }
          };
        } catch (e) {
          streamingUsed = false;
          assistantEventStreamed = false;
          llmResponse = await config.modelProvider.getCompletion(state, effectiveAgent, config);
        }
      } else {
        llmResponse = await config.modelProvider.getCompletion(state, effectiveAgent, config);
      }
    }
  } else {
    if (typeof config.modelProvider.getCompletionStream === 'function') {
      try {
        streamingUsed = true;
        const stream = config.modelProvider.getCompletionStream(state, effectiveAgent, config);
        let aggregatedText = '';
        const toolCalls: Array<{ id?: string; type: 'function'; function: { name?: string; arguments: string } }> = [];

        for await (const chunk of stream) {
          if (chunk?.delta) {
            aggregatedText += chunk.delta;
          }
          if (chunk?.toolCallDelta) {
            const idx = chunk.toolCallDelta.index ?? 0;
            while (toolCalls.length <= idx) {
              toolCalls.push({ id: undefined, type: 'function', function: { name: undefined, arguments: '' } });
            }
            const target = toolCalls[idx];
            if (chunk.toolCallDelta.id) target.id = chunk.toolCallDelta.id;
            if (chunk.toolCallDelta.function?.name) target.function.name = chunk.toolCallDelta.function.name;
            if (chunk.toolCallDelta.function?.argumentsDelta) {
              target.function.arguments += chunk.toolCallDelta.function.argumentsDelta;
            }
          }

          if (chunk?.delta || chunk?.toolCallDelta) {
            assistantEventStreamed = true;
            const partialMessage: Message = {
              role: 'assistant',
              content: aggregatedText,
              ...(toolCalls.length > 0
                ? {
                    tool_calls: toolCalls.map((tc, i) => ({
                      id: tc.id ?? `call_${i}`,
                      type: 'function' as const,
                      function: {
                        name: tc.function.name ?? '',
                        arguments: tc.function.arguments
                      }
                    }))
                  }
                : {})
            };
            try { config.onEvent?.({ type: 'assistant_message', data: { message: partialMessage } }); } catch (err) {safeConsole.error('Error in config.onEvent:', err); }
          }
        }

        llmResponse = {
          message: {
            content: aggregatedText || undefined,
            ...(toolCalls.length > 0
              ? {
                  tool_calls: toolCalls.map((tc, i) => ({
                    id: tc.id ?? `call_${i}`,
                    type: 'function' as const,
                    function: {
                      name: tc.function.name ?? '',
                      arguments: tc.function.arguments
                    }
                  }))
                }
              : {})
          }
        };
      } catch (e) {
        streamingUsed = false;
        assistantEventStreamed = false;
        llmResponse = await config.modelProvider.getCompletion(state, effectiveAgent, config);
      }
    } else {
      llmResponse = await config.modelProvider.getCompletion(state, effectiveAgent, config);
    }
  }
  
  const usage = (llmResponse as any)?.usage;
  const prompt = (llmResponse as any)?.prompt;
  
  config.onEvent?.({
    type: 'llm_call_end',
    data: { 
      choice: llmResponse,
      fullResponse: llmResponse, // Include complete response
      prompt: prompt, // Include the prompt that was sent
      traceId: state.traceId, 
      runId: state.runId,
      agentName: currentAgent.name,
      model: model || 'unknown',
      usage: usage ? {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens
      } : undefined
    }
  });

  try {
    const usage = (llmResponse as any)?.usage;
    if (usage && (usage.prompt_tokens || usage.completion_tokens || usage.total_tokens)) {
      config.onEvent?.({
        type: 'token_usage',
        data: {
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens,
          model: model || 'unknown'
        }
      });
    }
  } catch { /* ignore */ }

  if (!llmResponse.message) {
    await runTurnEndHooks(config, {
      turn: turnNumber,
      agentName: currentAgent.name,
      state,
      lastAssistantMessage: undefined
    });
    return {
      finalState: state,
      outcome: {
        status: 'error',
        error: {
          _tag: 'ModelBehaviorError',
          detail: 'No message in model response'
        }
      }
    };
  }

  const assistantMessage: Message = {
    role: 'assistant',
    content: llmResponse.message.content || '',
    tool_calls: llmResponse.message.tool_calls
  };

  if (!assistantEventStreamed) {
    config.onEvent?.({
      type: 'assistant_message',
      data: { message: assistantMessage }
    });
  }

  const newMessages = [...state.messages, assistantMessage];
  const updatedTurnCount = state.turnCount + 1;

  if (llmResponse.message.tool_calls && llmResponse.message.tool_calls.length > 0) {
    safeConsole.log(`[JAF:ENGINE] Processing ${llmResponse.message.tool_calls.length} tool calls`);
    safeConsole.log(`[JAF:ENGINE] Tool calls:`, llmResponse.message.tool_calls);
    
    try {
      const requests = llmResponse.message.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        args: tryParseJSON(tc.function.arguments)
      }));
      config.onEvent?.({ type: 'tool_requests', data: { toolCalls: requests } });
    } catch { /* ignore */ }
    
    const toolResults = await executeToolCalls(
      llmResponse.message.tool_calls,
      effectiveAgent,
      state,
      config,
    );

    const interruptions = toolResults
      .map(r => r.interruption)
      .filter((interruption): interruption is Interruption<Ctx> => interruption !== undefined);
    if (interruptions.length > 0) {
      const completedToolResults = toolResults.filter(r => !r.interruption);
      const approvalRequiredResults = toolResults.filter(r => r.interruption);

      const updatedApprovals = new Map(state.approvals ?? []);
      const updatedClarifications = new Map(state.clarifications ?? []);

      for (const interruption of interruptions) {
        if (interruption.type === 'tool_approval') {
          updatedApprovals.set(interruption.toolCall.id, {
            status: 'pending',
            approved: false,
            additionalContext: { status: 'pending', timestamp: new Date().toISOString() }
          });
        } else if (interruption.type === 'clarification_required') {
          // Emit clarification requested event
          config.onEvent?.({
            type: 'clarification_requested',
            data: {
              clarificationId: interruption.clarificationId,
              question: interruption.question,
              options: interruption.options,
              context: interruption.context
            }
          });
          safeConsole.log(`[JAF:ENGINE] Clarification requested: ${interruption.question}`);
        }
      }
      
      const interruptedState = {
        ...state,
        messages: [...newMessages, ...completedToolResults.map(r => r.message)],
        turnCount: updatedTurnCount,
        approvals: updatedApprovals,
        clarifications: updatedClarifications,
      };

      if (config.memory?.autoStore && config.conversationId) {
        safeConsole.log(`[JAF:ENGINE] Storing conversation state due to interruption for ${config.conversationId}`);
        const stateForStorage = {
          ...interruptedState,
          messages: [...interruptedState.messages, ...approvalRequiredResults.map(r => r.message)]
        };
        await storeConversationHistory(stateForStorage, config);
      }

      await runTurnEndHooks(config, {
        turn: turnNumber,
        agentName: currentAgent.name,
        state: interruptedState,
        lastAssistantMessage: assistantMessage
      });

      return {
        finalState: interruptedState,
        outcome: {
          status: 'interrupted',
          interruptions,
        },
      };
    }

    // safeConsole.log(`[JAF:ENGINE] Tool execution completed. Results count:`, toolResults.length);

    config.onEvent?.({
      type: 'tool_results_to_llm',
      data: { results: toolResults.map(r => r.message) }
    });

    if (toolResults.some(r => r.isHandoff)) {
      const handoffResult = toolResults.find(r => r.isHandoff);
      if (handoffResult) {
        const targetAgent = handoffResult.targetAgent!;
        
        if (!currentAgent.handoffs?.includes(targetAgent)) {
          config.onEvent?.({
            type: 'handoff_denied',
            data: { from: currentAgent.name, to: targetAgent, reason: `Agent ${currentAgent.name} cannot handoff to ${targetAgent}` }
          });
          const failureState = { ...state, messages: newMessages, turnCount: updatedTurnCount };
          await runTurnEndHooks(config, {
            turn: turnNumber,
            agentName: currentAgent.name,
            state: failureState,
            lastAssistantMessage: assistantMessage
          });
          return {
            finalState: failureState,
            outcome: {
              status: 'error',
              error: {
                _tag: 'HandoffError',
                detail: `Agent ${currentAgent.name} cannot handoff to ${targetAgent}`
              }
            }
          };
        }

        config.onEvent?.({
          type: 'handoff',
          data: { from: currentAgent.name, to: targetAgent }
        });

        // Remove any halted messages that are being replaced by actual execution results
        const cleanedNewMessages = newMessages.filter(msg => {
          if (msg.role !== 'tool') return true;
          try {
            const content = JSON.parse(getTextContent(msg.content));
            if (content.status === 'halted') {
              // Remove this halted message if we have a new result for the same tool_call_id
              return !toolResults.some(result => result.message.tool_call_id === msg.tool_call_id);
            }
            return true;
          } catch {
            return true;
          }
        });

        const nextState: RunState<Ctx> = {
          ...state,
          messages: [...cleanedNewMessages, ...toolResults.map(r => r.message)],
          currentAgentName: targetAgent,
          turnCount: updatedTurnCount,
          approvals: state.approvals ?? new Map(),
        };
        await runTurnEndHooks(config, {
          turn: turnNumber,
          agentName: currentAgent.name,
          state: nextState,
          lastAssistantMessage: assistantMessage
        });
        return runInternal(nextState, config);
      }
    }

    // Remove any halted messages that are being replaced by actual execution results
    const cleanedNewMessages = newMessages.filter(msg => {
      if (msg.role !== 'tool') return true;
      try {
        const content = JSON.parse(getTextContent(msg.content));
        if (content.status === 'halted') {
          // Remove this halted message if we have a new result for the same tool_call_id
          return !toolResults.some(result => result.message.tool_call_id === msg.tool_call_id);
        }
        return true;
      } catch {
        return true;
      }
    });

    const nextState: RunState<Ctx> = {
      ...state,
      messages: [...cleanedNewMessages, ...toolResults.map(r => r.message)],
      turnCount: updatedTurnCount,
      approvals: state.approvals ?? new Map(),
    };
    await runTurnEndHooks(config, {
      turn: turnNumber,
      agentName: currentAgent.name,
      state: nextState,
      lastAssistantMessage: assistantMessage
    });
    return runInternal(nextState, config);
  }

  if (llmResponse.message.content) {
    if (currentAgent.outputCodec) {
      const parseResult = currentAgent.outputCodec.safeParse(
        tryParseJSON(llmResponse.message.content)
      );
      
      if (!parseResult.success) {
        config.onEvent?.({ type: 'decode_error', data: { errors: parseResult.error.issues } });
        await runTurnEndHooks(config, {
          turn: turnNumber,
          agentName: currentAgent.name,
          state: { ...state, messages: newMessages, turnCount: updatedTurnCount },
          lastAssistantMessage: assistantMessage
        });
        return {
          finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
          outcome: {
            status: 'error',
            error: {
              _tag: 'DecodeError',
              errors: parseResult.error.issues
            }
          }
        };
      }

      let outputGuardrailResult;
      if (hasAdvancedGuardrails) {
        // Use new advanced system
        outputGuardrailResult = await executeOutputGuardrails(effectiveOutputGuardrails, parseResult.data, config);
      } else {
        outputGuardrailResult = { isValid: true };
        if (effectiveOutputGuardrails && effectiveOutputGuardrails.length > 0) {
          for (const guardrail of effectiveOutputGuardrails) {
            const result = await guardrail(parseResult.data);
            if (!result.isValid) {
              const errorMessage = 'errorMessage' in result ? result.errorMessage : 'Guardrail violation';
              config.onEvent?.({ type: 'guardrail_violation', data: { stage: 'output', reason: errorMessage } });
              outputGuardrailResult = { isValid: false, errorMessage };
              break;
            }
          }
        }
      }
      if (!outputGuardrailResult.isValid) {
        await runTurnEndHooks(config, {
          turn: turnNumber,
          agentName: currentAgent.name,
          state: { ...state, messages: newMessages, turnCount: updatedTurnCount },
          lastAssistantMessage: assistantMessage
        });
        return {
          finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
          outcome: {
            status: 'error',
            error: {
              _tag: 'OutputGuardrailTripwire',
              reason: outputGuardrailResult.errorMessage || 'Output guardrail violation'
            }
          }
        };
      }

      config.onEvent?.({ type: 'final_output', data: { output: parseResult.data } });
      // End of turn
      await runTurnEndHooks(config, {
        turn: turnNumber,
        agentName: currentAgent.name,
        state: { ...state, messages: newMessages, turnCount: updatedTurnCount },
        lastAssistantMessage: assistantMessage
      });

      return {
        finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
        outcome: {
          status: 'completed',
          output: parseResult.data as Out
        }
      };
    } else {
      let outputGuardrailResult;
      if (hasAdvancedGuardrails) {
        // Use new advanced system
        outputGuardrailResult = await executeOutputGuardrails(effectiveOutputGuardrails, llmResponse.message.content, config);
      } else {
        outputGuardrailResult = { isValid: true };
        if (effectiveOutputGuardrails && effectiveOutputGuardrails.length > 0) {
          for (const guardrail of effectiveOutputGuardrails) {
            const result = await guardrail(llmResponse.message.content);
            if (!result.isValid) {
              const errorMessage = 'errorMessage' in result ? result.errorMessage : 'Guardrail violation';
              config.onEvent?.({ type: 'guardrail_violation', data: { stage: 'output', reason: errorMessage } });
              outputGuardrailResult = { isValid: false, errorMessage };
              break;
            }
          }
        }
      }
      if (!outputGuardrailResult.isValid) {
        await runTurnEndHooks(config, {
          turn: turnNumber,
          agentName: currentAgent.name,
          state: { ...state, messages: newMessages, turnCount: updatedTurnCount },
          lastAssistantMessage: assistantMessage
        });
        return {
          finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
          outcome: {
            status: 'error',
            error: {
              _tag: 'OutputGuardrailTripwire',
              reason: outputGuardrailResult.errorMessage || 'Output guardrail violation'
            }
          }
        };
      }

      config.onEvent?.({ type: 'final_output', data: { output: llmResponse.message.content } });
      // End of turn
      await runTurnEndHooks(config, {
        turn: turnNumber,
        agentName: currentAgent.name,
        state: { ...state, messages: newMessages, turnCount: updatedTurnCount },
        lastAssistantMessage: assistantMessage
      });

      return {
        finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
        outcome: {
          status: 'completed',
          output: llmResponse.message.content as Out
        }
      };
    }
  }

  await runTurnEndHooks(config, {
    turn: turnNumber,
    agentName: currentAgent.name,
    state: { ...state, messages: newMessages, turnCount: updatedTurnCount },
    lastAssistantMessage: assistantMessage
  });

  safeConsole.error(`[JAF:ENGINE] No tool calls or content returned by model. LLMResponse: `, llmResponse);
  return {
    finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
    outcome: {
      status: 'error',
      error: {
        _tag: 'ModelBehaviorError',
        detail: 'Model produced neither content nor tool calls'
      }
    }
  };
}

type ToolCallResult = {
  message: Message;
  isHandoff?: boolean;
  targetAgent?: string;
  interruption?: Interruption<any>;
};

async function executeToolCalls<Ctx>(
  toolCalls: readonly ToolCall[],
  agent: Agent<Ctx, any>,
  state: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<ToolCallResult[]> {
  try { setToolRuntime(state.context, { state, config }); } catch { /* ignore */ }
  const results = await Promise.all(
    toolCalls.map(async (toolCall): Promise<ToolCallResult> => {
      const tool = agent.tools?.find(t => t.schema.name === toolCall.function.name);
      const startTime = Date.now();
      
      let rawArgs = tryParseJSON(toolCall.function.arguments);

      // Emit before_tool_execution event - handler can return modified args
      if (config.onEvent) {
        try {
          const beforeEventResponse = await config.onEvent({
            type: 'before_tool_execution',
            data: {
              toolName: toolCall.function.name,
              args: rawArgs,
              toolCall,
              traceId: state.traceId,
              runId: state.runId,
              toolSchema: tool ? {
                name: tool.schema.name,
                description: tool.schema.description,
                parameters: tool.schema.parameters
              } : undefined,
              context: state.context,
              state,
              agentName: agent.name
            }
          });

          // If event handler returns a value, use it to override the args
          if (beforeEventResponse !== undefined && beforeEventResponse !== null) {
            rawArgs = beforeEventResponse;
          }
        } catch (eventError) {
          // Continue with original args if event handler fails
        }
      }

      // Emit tool_call_start event (for observation) with potentially modified args
      config.onEvent?.({
        type: 'tool_call_start',
        data: {
          toolName: toolCall.function.name,
          args: rawArgs,
          traceId: state.traceId,
          runId: state.runId,
          toolSchema: tool ? {
            name: tool.schema.name,
            description: tool.schema.description,
            parameters: tool.schema.parameters
          } : undefined,
          context: state.context,
          agentName: agent.name
        }
      });

      try {
        if (!tool) {
          const errorResult = JSON.stringify({
            status: "tool_not_found",
            message: `Tool ${toolCall.function.name} not found`,
            tool_name: toolCall.function.name,
          });

          config.onEvent?.({
            type: 'tool_call_end',
            data: {
              toolName: toolCall.function.name,
              result: errorResult,
              traceId: state.traceId,
              runId: state.runId,
              status: 'error',
              toolResult: { error: 'tool_not_found' },
              executionTime: Date.now() - startTime,
              error: { type: 'tool_not_found', message: `Tool ${toolCall.function.name} not found` }
            }
          });

          return {
            message: {
              role: 'tool',
              content: errorResult,
              tool_call_id: toolCall.id
            }
          };
        }

        const parseResult = tool.schema.parameters.safeParse(rawArgs);

        if (!parseResult.success) {
          const errorResult = JSON.stringify({
            status: "validation_error",
            message: `Invalid arguments for ${toolCall.function.name}: ${parseResult.error.message}`,
            tool_name: toolCall.function.name,
            validation_errors: parseResult.error.issues
          });

          config.onEvent?.({
            type: 'tool_call_end',
            data: { 
              toolName: toolCall.function.name, 
              result: errorResult,
              traceId: state.traceId,
              runId: state.runId,
              status: 'error',
              toolResult: { error: 'validation_error', details: parseResult.error.issues },
              executionTime: Date.now() - startTime,
              error: { type: 'validation_error', message: `Invalid arguments for ${toolCall.function.name}`, details: parseResult.error.issues }
            }
          });

          return {
            message: {
              role: 'tool',
              content: errorResult,
              tool_call_id: toolCall.id
            }
          };
        }

        let needsApproval = false;
        if (typeof tool.needsApproval === 'function') {
          needsApproval = await tool.needsApproval(state.context, parseResult.data);
        } else {
          needsApproval = !!tool.needsApproval;
        }

        const approvalStatus = state.approvals?.get(toolCall.id);
        const derivedStatus: 'approved' | 'rejected' | 'pending' | undefined =
          approvalStatus?.status ?? (
            approvalStatus?.approved === true
              ? 'approved'
              : approvalStatus?.approved === false
                ? ((approvalStatus?.additionalContext as any)?.status === 'pending' ? 'pending' : 'rejected')
                : undefined
          );

        const isPending = derivedStatus === 'pending';

        if (needsApproval && (approvalStatus === undefined || isPending)) {
          return {
            interruption: {
              type: 'tool_approval',
              toolCall,
              agent,
              sessionId: state.runId,
            },
            message: {
              role: 'tool',
              content: JSON.stringify({
                status: 'halted',
                message: `Tool ${toolCall.function.name} requires approval.`,
              }),
              tool_call_id: toolCall.id,
            },
          };
        }

        const additionalContext = approvalStatus?.additionalContext;

        if (derivedStatus === 'rejected') {
          const rejectionReason = additionalContext?.rejectionReason || 'User declined the action';
          return {
            message: {
              role: 'tool',
              content: JSON.stringify({
                status: 'approval_denied',
                message: `Action was not approved. ${rejectionReason}. Please ask if you can help with something else or suggest an alternative approach.`,
                tool_name: toolCall.function.name,
                rejection_reason: rejectionReason,
                additionalContext,
              }),
              tool_call_id: toolCall.id,
            },
          };
        }

        safeConsole.log(`[JAF:ENGINE] About to execute tool: ${toolCall.function.name}`);
        safeConsole.log(`[JAF:ENGINE] Tool args:`, parseResult.data);
        safeConsole.log(`[JAF:ENGINE] Tool context:`, state.context);

        const contextWithAdditional = additionalContext
          ? { ...state.context, ...additionalContext }
          : state.context;

        let toolResult = await tool.execute(parseResult.data, contextWithAdditional);

        // Check if this is a clarification request
        // The clarification tool returns a JSON string containing the trigger marker
        if (typeof toolResult === 'string') {
          try {
            const parsed = JSON.parse(toolResult);
            if (parsed && typeof parsed === 'object' && '_clarification_trigger' in parsed && parsed._clarification_trigger === true) {
              const clarificationId = `clarify_${toolCall.id}`;
              const trigger = parsed as ClarificationTriggerMarker;

              return {
                interruption: {
                  type: 'clarification_required',
                  clarificationId,
                  question: trigger.question,
                  options: trigger.options,
                  context: trigger.context
                },
                message: {
                  role: 'tool',
                  content: JSON.stringify({
                    status: InterruptionStatus.AwaitingClarification,
                    clarification_id: clarificationId,
                    message: 'Waiting for user to provide clarification'
                  }),
                  tool_call_id: toolCall.id
                }
              };
            }
          } catch {
            // Not a clarification trigger, continue with normal processing
          }
        }
        
        // Apply onAfterToolExecution callback if configured
        if (config.onAfterToolExecution) {
          try {
            const toolResultStatus = typeof toolResult === 'string' ? 'success' : (toolResult?.status || 'success');
            
            const modifiedResult = await config.onAfterToolExecution(
              toolCall.function.name,
              toolResult,
              {
                toolCall,
                args: parseResult.data,
                state,
                agentName: agent.name,
                executionTime: Date.now() - startTime,
                status: toolResultStatus
              }
            );
            if (modifiedResult !== undefined && modifiedResult !== null) {
              toolResult = modifiedResult;
            }
          } catch (callbackError) {
            console.error(`[JAF:ENGINE] Error in onAfterToolExecution callback for ${toolCall.function.name}:`, callbackError);
            // Continue with original result if callback fails
          }
        }
        let resultString: string;
        let toolResultObj: any = null;
        
        if (typeof toolResult === 'string') {
          resultString = toolResult;
          safeConsole.log(`[JAF:ENGINE] Tool ${toolCall.function.name}` );
        } else {
          toolResultObj = toolResult;
          const { toolResultToString } = await import('./tool-results');
          resultString = toolResultToString(toolResult);
          safeConsole.log(`[JAF:ENGINE] Tool ${toolCall.function.name} `);
        }

        config.onEvent?.({
          type: 'tool_call_end',
          data: { 
            toolName: toolCall.function.name, 
            result: resultString,
            traceId: state.traceId,
            runId: state.runId,
            toolResult: toolResultObj,
            status: toolResultObj?.status || 'success',
            executionTime: Date.now() - startTime,
            metadata: {
              agentName: agent.name,
              parsedArgs: parseResult.data,
              context: state.context,
              resultType: typeof toolResult === 'string' ? 'string' : 'object'
            }
          }
        });

        const handoffCheck = tryParseJSON(resultString);
        if (handoffCheck && typeof handoffCheck === 'object' && 'handoff_to' in handoffCheck) {
          return {
            message: {
              role: 'tool',
              content: resultString,
              tool_call_id: toolCall.id
            },
            isHandoff: true,
            targetAgent: handoffCheck.handoff_to as string
          };
        }

        let finalContent;
        if (additionalContext && Object.keys(additionalContext).length > 0) {
          finalContent = JSON.stringify({
            status: 'approved_and_executed',
            result: resultString,
            tool_name: toolCall.function.name,
            approval_context: additionalContext,
            message: 'Tool was approved and executed successfully with additional context.'
          });
        } else if (needsApproval) {
          finalContent = JSON.stringify({
            status: 'approved_and_executed',
            result: resultString,
            tool_name: toolCall.function.name,
            message: 'Tool was approved and executed successfully.'
          });
        } else {
          finalContent = JSON.stringify({
            status: 'executed',
            result: resultString,
            tool_name: toolCall.function.name,
            message: 'Tool executed successfully.'
          });
        }

        return {
          message: {
            role: 'tool',
            content: finalContent,
            tool_call_id: toolCall.id
          }
        };

      } catch (error) {
        const errorResult = JSON.stringify({
          status: "execution_error",
          message: error instanceof Error ? error.message : String(error),
          tool_name: toolCall.function.name,
        });

        config.onEvent?.({
          type: 'tool_call_end',
          data: { 
            toolName: toolCall.function.name, 
            result: errorResult,
            traceId: state.traceId,
            runId: state.runId,
            status: 'error',
            toolResult: { error: 'execution_error', detail: error instanceof Error ? error.message : String(error) },
            executionTime: Date.now() - startTime,
            error: { 
              type: 'execution_error', 
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined
            }
          }
        });

        return {
          message: {
            role: 'tool',
            content: errorResult,
            tool_call_id: toolCall.id
          }
        };
      }
    })
  );

  return results;
}

function tryParseJSON(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

/**
 * Load conversation history from memory and merge with initial state
 */
async function loadConversationHistory<Ctx>(
  initialState: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<RunState<Ctx>> {
  if (!config.memory?.provider || !config.conversationId) {
    return initialState;
  }

  const result = await config.memory.provider.getConversation(config.conversationId);
  if (!result.success) {
    safeConsole.warn(`[JAF:MEMORY] Failed to load conversation history: ${result.error}`);
    return initialState;
  }

  if (!result.data) {
    safeConsole.log(`[JAF:MEMORY] No existing conversation found for ${config.conversationId}`);
    return initialState;
  }

  const maxMessages = config.memory.maxMessages || result.data.messages.length;
  const allMemoryMessages = result.data.messages.slice(-maxMessages);
  
  const memoryMessages = allMemoryMessages.filter(msg => {
    if (msg.role !== 'tool') return true;
    try {
      const content = JSON.parse(getTextContent(msg.content));
      return content.status !== 'halted';
    } catch {
      return true; // Keep non-JSON tool messages
    }
  });
  
  const combinedMessages = memoryMessages.length > 0 
    ? [...memoryMessages, ...initialState.messages.filter(msg => 
        !memoryMessages.some(memMsg => 
          memMsg.role === msg.role && 
          memMsg.content === msg.content && 
          JSON.stringify(memMsg.tool_calls) === JSON.stringify(msg.tool_calls)
        )
      )]
    : initialState.messages;
  
  const storedApprovals = result.data.metadata?.approvals;
  const approvalsMap = storedApprovals 
    ? new Map(Object.entries(storedApprovals) as [string, any][])
    : (initialState.approvals ?? new Map());

  safeConsole.log(`[JAF:MEMORY] Loaded ${allMemoryMessages.length} messages from memory, filtered to ${memoryMessages.length} for LLM context (removed halted messages)`);
  if (storedApprovals) {
    safeConsole.log(`[JAF:MEMORY] Loaded ${Object.keys(storedApprovals).length} approvals from memory`);
  }
  safeConsole.log(`[JAF:MEMORY] Memory messages:`, memoryMessages.map(m => ({ role: m.role, content: getTextContent(m.content)?.substring(0, 100) + '...' })));
  safeConsole.log(`[JAF:MEMORY] New messages:`, initialState.messages.map(m => ({ role: m.role, content: getTextContent(m.content)?.substring(0, 100) + '...' })));
  safeConsole.log(`[JAF:MEMORY] Combined messages (${combinedMessages.length} total):`, combinedMessages.map(m => ({ role: m.role, content: getTextContent(m.content)?.substring(0, 100) + '...' })));
  
  return {
    ...initialState,
    messages: combinedMessages,
    approvals: approvalsMap
  };
}

/**
 * Store conversation history to memory
 */
async function storeConversationHistory<Ctx>(
  finalState: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<void> {
  if (!config.memory?.provider || !config.conversationId) {
    return;
  }

  let messagesToStore = finalState.messages;
  if (config.memory.compressionThreshold && messagesToStore.length > config.memory.compressionThreshold) {
    const keepFirst = Math.floor(config.memory.compressionThreshold * 0.2);
    const keepRecent = config.memory.compressionThreshold - keepFirst;
    
    messagesToStore = [
      ...messagesToStore.slice(0, keepFirst),
      ...messagesToStore.slice(-keepRecent)
    ];

    safeConsole.log(`[JAF:MEMORY] Compressed conversation from ${finalState.messages.length} to ${messagesToStore.length} messages`);
  }

  const metadata = {
    userId: (finalState.context as any)?.userId,
    traceId: finalState.traceId,
    runId: finalState.runId,
    agentName: finalState.currentAgentName,
    turnCount: finalState.turnCount,
    approvals: Object.fromEntries(finalState.approvals ?? new Map()) // Store approvals in metadata
  };

  const result = await config.memory.provider.storeMessages(config.conversationId, messagesToStore, metadata);
  if (!result.success) {
    safeConsole.warn(`[JAF:MEMORY] Failed to store conversation history: ${JSON.stringify(result.error)}`);
    return;
  }

  safeConsole.log(`[JAF:MEMORY] Stored ${messagesToStore.length} messages for conversation ${config.conversationId}`);
}
