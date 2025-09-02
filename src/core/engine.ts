import { z } from 'zod';
import {
  RunState,
  RunConfig,
  RunResult,
  JAFError,
  Message,
  TraceEvent,
  Agent,
  Tool,
  ToolCall,
  Interruption,
} from './types.js';

export async function run<Ctx, Out>(
  initialState: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<RunResult<Out>> {
  try {
    config.onEvent?.({
      type: 'run_start',
      data: { runId: initialState.runId, traceId: initialState.traceId }
    });

    // Load conversation history from memory if configured
    let stateWithMemory = initialState;
    if (config.memory?.autoStore && config.conversationId) {
      console.log(`[JAF:ENGINE] Loading conversation history for ${config.conversationId}`);
      stateWithMemory = await loadConversationHistory(initialState, config);
    } else {
      console.log(`[JAF:ENGINE] Skipping memory load - autoStore: ${config.memory?.autoStore}, conversationId: ${config.conversationId}`);
    }

    const result = await runInternal<Ctx, Out>(stateWithMemory, config);
    
    // Store conversation history to memory if configured
    if (config.memory?.autoStore && config.conversationId && result.finalState.messages.length > initialState.messages.length) {
      console.log(`[JAF:ENGINE] Storing conversation history for ${config.conversationId}`);
      await storeConversationHistory(result.finalState, config);
    } else {
      console.log(`[JAF:ENGINE] Skipping memory store - autoStore: ${config.memory?.autoStore}, conversationId: ${config.conversationId}, messageChange: ${result.finalState.messages.length > initialState.messages.length}`);
    }

    config.onEvent?.({
      type: 'run_end',
      data: { outcome: result.outcome }
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
      data: { outcome: errorResult.outcome }
    });

    return errorResult;
  }
}

// Streaming helper: create a simple async queue to yield events as they occur
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

/**
 * Stream run events as they happen via an async generator.
 * Consumers can iterate events to build live UIs or forward via SSE.
 */
export async function* runStream<Ctx, Out>(
  initialState: RunState<Ctx>,
  config: RunConfig<Ctx>
): AsyncGenerator<TraceEvent, void, unknown> {
  const stream = createAsyncEventStream<TraceEvent>();
  
  // Tee events: push to stream and call any existing onEvent
  const onEvent = (event: TraceEvent) => {
    try { stream.push(event); } catch { /* ignore */ }
    try { config.onEvent?.(event); } catch { /* ignore */ }
  };

  // Kick off the run without awaiting so events can flow concurrently
  const runPromise = run<Ctx, Out>(initialState, { ...config, onEvent });
  void runPromise.finally(() => {
    stream.end();
  });

  try {
    for await (const event of stream.iterator as AsyncGenerator<TraceEvent>) {
      yield event;
    }
  } finally {
    // Ensure completion
    await runPromise.catch(() => undefined);
  }
}

async function runInternal<Ctx, Out>(
  state: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<RunResult<Out>> {
  if (state.turnCount === 0) {
    const firstUserMessage = state.messages.find(m => m.role === 'user');
    if (firstUserMessage && config.initialInputGuardrails) {
      for (const guardrail of config.initialInputGuardrails) {
        const result = await guardrail(firstUserMessage.content);
        if (!result.isValid) {
          // Emit guardrail violation for input stage
          const errorMessage = !result.isValid ? result.errorMessage : '';
          config.onEvent?.({
            type: 'guardrail_violation',
            data: { stage: 'input', reason: errorMessage }
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

  console.log(`[JAF:ENGINE] Using agent: ${currentAgent.name}`);
  console.log(`[JAF:ENGINE] Agent has ${currentAgent.tools?.length || 0} tools available`);
  if (currentAgent.tools) {
    console.log(`[JAF:ENGINE] Available tools:`, currentAgent.tools.map(t => t.schema.name));
  }

  // Check if there are existing tool calls to execute from previous assistant message
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage?.role === 'assistant' && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    console.log(`[JAF:ENGINE] Found existing tool calls to execute:`, lastMessage.tool_calls.map(tc => tc.function.name));
    
    // Check if any of these tool calls are unanswered (no corresponding tool message)
    const answeredIds = state.messages
      .filter(m => m.role === 'tool')
      .map(m => m.tool_call_id)
      .filter(id => id !== undefined);
    
    const unansweredToolCalls = lastMessage.tool_calls.filter(tc => !answeredIds.includes(tc.id));
    
    if (unansweredToolCalls.length > 0) {
      console.log(`[JAF:ENGINE] Executing ${unansweredToolCalls.length} unanswered tool calls`);
      
      // Turn lifecycle start (before tool execution)
      const turnNumber = state.turnCount + 1;
      config.onEvent?.({ type: 'turn_start', data: { turn: turnNumber, agentName: currentAgent.name } });

      const toolResults = await executeToolCalls(
        unansweredToolCalls,
        currentAgent,
        state,
        config,
      );

      const interruptions = toolResults
        .map(r => r.interruption)
        .filter((interruption): interruption is Interruption<Ctx> => interruption !== undefined);
      if (interruptions.length > 0) {
        return {
          finalState: {
            ...state,
            messages: [...state.messages, ...toolResults.filter(r => !r.interruption).map(r => r.message)],
            turnCount: turnNumber,
          },
          outcome: {
            status: 'interrupted',
            interruptions,
          },
        };
      }
      
      console.log(`[JAF:ENGINE] Tool execution completed. Results count:`, toolResults.length);

      // Emit tool results being added
      config.onEvent?.({
        type: 'tool_results_to_llm',
        data: { results: toolResults.map(r => r.message) }
      });

      if (toolResults.some(r => r.isHandoff)) {
        const handoffResult = toolResults.find(r => r.isHandoff);
        if (handoffResult) {
          const targetAgent = handoffResult.targetAgent!;
          
          if (!currentAgent.handoffs?.includes(targetAgent)) {
            // Emit handoff denied event for observability
            config.onEvent?.({
              type: 'handoff_denied',
              data: { from: currentAgent.name, to: targetAgent, reason: `Agent ${currentAgent.name} cannot handoff to ${targetAgent}` }
            });
            return {
              finalState: { ...state, messages: [...state.messages, ...toolResults.map(r => r.message)], turnCount: turnNumber },
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

          const nextState: RunState<Ctx> = {
            ...state,
            messages: [...state.messages, ...toolResults.map(r => r.message)],
            currentAgentName: targetAgent,
            turnCount: turnNumber,
            approvals: state.approvals,
          };
          // End of turn before handing off to next agent
          config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
          return runInternal(nextState, config);
        }
      }

      const nextState: RunState<Ctx> = {
        ...state,
        messages: [...state.messages, ...toolResults.map(r => r.message)],
        turnCount: turnNumber,
        approvals: state.approvals,
      };
      // End of this turn before next model call
      config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
      return runInternal(nextState, config);
    }
  }

  const model = config.modelOverride ?? currentAgent.modelConfig?.name;

  if (!model) {
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
  
  // Turn lifecycle start (before LLM call)
  const turnNumber = state.turnCount + 1;
  config.onEvent?.({ type: 'turn_start', data: { turn: turnNumber, agentName: currentAgent.name } });

  config.onEvent?.({
    type: 'llm_call_start',
    data: { agentName: currentAgent.name, model }
  });

  const llmResponse = await config.modelProvider.getCompletion(state, currentAgent, config);
  
  config.onEvent?.({
    type: 'llm_call_end',
    data: { choice: llmResponse }
  });

  // Emit token usage if provider supplied it
  try {
    const usage = (llmResponse as any)?.usage;
    if (usage && (usage.prompt_tokens || usage.completion_tokens || usage.total_tokens)) {
      config.onEvent?.({
        type: 'token_usage',
        data: {
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens,
          model
        }
      });
    }
  } catch { /* ignore */ }

  if (!llmResponse.message) {
    // End of turn due to error condition
    config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
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

  // Emit assistant message received (could include tool calls and/or content)
  config.onEvent?.({
    type: 'assistant_message',
    data: { message: assistantMessage }
  });

  const newMessages = [...state.messages, assistantMessage];
  // Increment turnCount after each AI invocation
  const updatedTurnCount = state.turnCount + 1;

  if (llmResponse.message.tool_calls && llmResponse.message.tool_calls.length > 0) {
    console.log(`[JAF:ENGINE] Processing ${llmResponse.message.tool_calls.length} tool calls`);
    console.log(`[JAF:ENGINE] Tool calls:`, llmResponse.message.tool_calls);
    
    // Emit tool request(s) event with parsed args
    try {
      const requests = llmResponse.message.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        args: tryParseJSON(tc.function.arguments)
      }));
      config.onEvent?.({ type: 'tool_requests', data: { toolCalls: requests } });
    } catch { /* ignore */ }
    
    const toolResults = await executeToolCalls(
      llmResponse.message.tool_calls,
      currentAgent,
      state,
      config,
    );

    const interruptions = toolResults
      .map(r => r.interruption)
      .filter((interruption): interruption is Interruption<Ctx> => interruption !== undefined);
    if (interruptions.length > 0) {
      // Only include tool result messages that are not approval-required errors
      const nonInterruptedResults = toolResults.filter(r => !r.interruption);
      return {
        finalState: {
          ...state,
          messages: [...newMessages, ...nonInterruptedResults.map(r => r.message)],
          turnCount: updatedTurnCount,
        },
        outcome: {
          status: 'interrupted',
          interruptions,
        },
      };
    }
    
    console.log(`[JAF:ENGINE] Tool execution completed. Results count:`, toolResults.length);

    // Emit tool results being added (and thus sent back to the LLM on next turn)
    config.onEvent?.({
      type: 'tool_results_to_llm',
      data: { results: toolResults.map(r => r.message) }
    });

    if (toolResults.some(r => r.isHandoff)) {
      const handoffResult = toolResults.find(r => r.isHandoff);
      if (handoffResult) {
        const targetAgent = handoffResult.targetAgent!;
        
        if (!currentAgent.handoffs?.includes(targetAgent)) {
          // Emit handoff denied event for observability
          config.onEvent?.({
            type: 'handoff_denied',
            data: { from: currentAgent.name, to: targetAgent, reason: `Agent ${currentAgent.name} cannot handoff to ${targetAgent}` }
          });
          return {
            finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
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

        const nextState: RunState<Ctx> = {
          ...state,
          messages: [...newMessages, ...toolResults.map(r => r.message)],
          currentAgentName: targetAgent,
          turnCount: updatedTurnCount,
          approvals: state.approvals,
        };
        // End of turn before handing off to next agent
        config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
        return runInternal(nextState, config);
      }
    }

    const nextState: RunState<Ctx> = {
      ...state,
      messages: [...newMessages, ...toolResults.map(r => r.message)],
      turnCount: updatedTurnCount,
      approvals: state.approvals,
    };
    // End of this turn before next model call
    config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
    return runInternal(nextState, config);
  }

  if (llmResponse.message.content) {
    if (currentAgent.outputCodec) {
      const parseResult = currentAgent.outputCodec.safeParse(
        tryParseJSON(llmResponse.message.content)
      );
      
      if (!parseResult.success) {
        // Emit decode error
        config.onEvent?.({ type: 'decode_error', data: { errors: parseResult.error.issues } });
        // End of turn
        config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
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

      if (config.finalOutputGuardrails) {
        for (const guardrail of config.finalOutputGuardrails) {
          const result = await guardrail(parseResult.data);
          if (!result.isValid) {
            // Emit guardrail violation (output)
            const errorMessage = !result.isValid ? result.errorMessage : '';
            config.onEvent?.({ type: 'guardrail_violation', data: { stage: 'output', reason: errorMessage } });
            // End of turn
            config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
            return {
              finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
              outcome: {
                status: 'error',
                error: {
                  _tag: 'OutputGuardrailTripwire',
                  reason: errorMessage
                }
              }
            };
          }
        }
      }

      // Emit final output prior to completion
      config.onEvent?.({ type: 'final_output', data: { output: parseResult.data } });
      // End of turn
      config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });

      return {
        finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
        outcome: {
          status: 'completed',
          output: parseResult.data as Out
        }
      };
    } else {
      if (config.finalOutputGuardrails) {
        for (const guardrail of config.finalOutputGuardrails) {
          const result = await guardrail(llmResponse.message.content);
          if (!result.isValid) {
            // Emit guardrail violation (output)
            const errorMessage = !result.isValid ? result.errorMessage : '';
            config.onEvent?.({ type: 'guardrail_violation', data: { stage: 'output', reason: errorMessage } });
            // End of turn
            config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
            return {
              finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
              outcome: {
                status: 'error',
                error: {
                  _tag: 'OutputGuardrailTripwire',
                  reason: errorMessage
                }
              }
            };
          }
        }
      }

      // Emit final output prior to completion
      config.onEvent?.({ type: 'final_output', data: { output: llmResponse.message.content } });
      // End of turn
      config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });

      return {
        finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
        outcome: {
          status: 'completed',
          output: llmResponse.message.content as Out
        }
      };
    }
  }

  // End of turn due to error
  config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
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
  const results = await Promise.all(
    toolCalls.map(async (toolCall): Promise<ToolCallResult> => {
      config.onEvent?.({
        type: 'tool_call_start',
        data: {
          toolName: toolCall.function.name,
          args: tryParseJSON(toolCall.function.arguments)
        }
      });

      try {
        const tool = agent.tools?.find(t => t.schema.name === toolCall.function.name);
        
        if (!tool) {
          const errorResult = JSON.stringify({
            error: "tool_not_found",
            message: `Tool ${toolCall.function.name} not found`,
            tool_name: toolCall.function.name,
          });

          config.onEvent?.({
            type: 'tool_call_end',
            data: { toolName: toolCall.function.name, result: errorResult }
          });

          return {
            message: {
              role: 'tool',
              content: errorResult,
              tool_call_id: toolCall.id
            }
          };
        }

        const rawArgs = tryParseJSON(toolCall.function.arguments);
        const parseResult = tool.schema.parameters.safeParse(rawArgs);

        if (!parseResult.success) {
          const errorResult = JSON.stringify({
            error: "validation_error",
            message: `Invalid arguments for ${toolCall.function.name}: ${parseResult.error.message}`,
            tool_name: toolCall.function.name,
            validation_errors: parseResult.error.issues
          });

          config.onEvent?.({
            type: 'tool_call_end',
            data: { toolName: toolCall.function.name, result: errorResult }
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

        const approvalStatus = state.approvals.get(toolCall.id);
        if (needsApproval && approvalStatus === undefined) {
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
                error: 'approval_required',
                message: `Tool ${toolCall.function.name} requires approval.`,
              }),
              tool_call_id: toolCall.id,
            },
          };
        }

        // Handle both boolean and object approval status for backward compatibility
        const isApproved = typeof approvalStatus === 'boolean' ? approvalStatus : approvalStatus?.approved;
        const additionalContext = typeof approvalStatus === 'object' ? approvalStatus.additionalContext : undefined;

        if (isApproved === false) {
          const rejectionReason = additionalContext?.rejectionReason || 'User declined the action';
          return {
            message: {
              role: 'tool',
              content: JSON.stringify({
                error: 'approval_denied',
                message: `Action was not approved. ${rejectionReason}. Please ask if you can help with something else or suggest an alternative approach.`,
                tool_name: toolCall.function.name,
                rejection_reason: rejectionReason,
                additionalContext,
              }),
              tool_call_id: toolCall.id,
            },
          };
        }

        console.log(`[JAF:ENGINE] About to execute tool: ${toolCall.function.name}`);
        console.log(`[JAF:ENGINE] Tool args:`, parseResult.data);
        console.log(`[JAF:ENGINE] Tool context:`, state.context);
        
        // Merge additional context if provided through approval
        const contextWithAdditional = additionalContext 
          ? { ...state.context, ...additionalContext }
          : state.context;
        
        const toolResult = await tool.execute(parseResult.data, contextWithAdditional);
        
        // Handle both string and ToolResult formats
        let resultString: string;
        let toolResultObj: any = null;
        
        if (typeof toolResult === 'string') {
          resultString = toolResult;
          console.log(`[JAF:ENGINE] Tool ${toolCall.function.name} returned string:`, resultString);
        } else {
          // It's a ToolResult object
          toolResultObj = toolResult;
          const { toolResultToString } = await import('./tool-results');
          resultString = toolResultToString(toolResult);
          console.log(`[JAF:ENGINE] Tool ${toolCall.function.name} returned ToolResult:`, toolResult);
          console.log(`[JAF:ENGINE] Converted to string:`, resultString);
        }

        config.onEvent?.({
          type: 'tool_call_end',
          data: { 
            toolName: toolCall.function.name, 
            result: resultString,
            toolResult: toolResultObj,
            status: toolResultObj?.status || 'success'
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

        return {
          message: {
            role: 'tool',
            content: resultString,
            tool_call_id: toolCall.id
          }
        };

      } catch (error) {
        const errorResult = JSON.stringify({
          error: "execution_error",
          message: error instanceof Error ? error.message : String(error),
          tool_name: toolCall.function.name,
        });

        config.onEvent?.({
          type: 'tool_call_end',
          data: { toolName: toolCall.function.name, result: errorResult }
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
    console.warn(`[JAF:MEMORY] Failed to load conversation history: ${result.error}`);
    return initialState;
  }

  if (!result.data) {
    console.log(`[JAF:MEMORY] No existing conversation found for ${config.conversationId}`);
    return initialState;
  }

  // Apply memory limits if configured
  const maxMessages = config.memory.maxMessages || result.data.messages.length;
  const memoryMessages = result.data.messages.slice(-maxMessages);
  
  // Merge existing messages with new messages, avoiding duplicates
  const combinedMessages = [...memoryMessages, ...initialState.messages];
  
  console.log(`[JAF:MEMORY] Loaded ${memoryMessages.length} messages from memory for conversation ${config.conversationId}`);
  console.log(`[JAF:MEMORY] Memory messages:`, memoryMessages.map(m => ({ role: m.role, content: m.content?.substring(0, 100) + '...' })));
  console.log(`[JAF:MEMORY] New messages:`, initialState.messages.map(m => ({ role: m.role, content: m.content?.substring(0, 100) + '...' })));
  console.log(`[JAF:MEMORY] Combined messages (${combinedMessages.length} total):`, combinedMessages.map(m => ({ role: m.role, content: m.content?.substring(0, 100) + '...' })));
  
  return {
    ...initialState,
    messages: combinedMessages
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

  // Apply compression threshold if configured
  let messagesToStore = finalState.messages;
  if (config.memory.compressionThreshold && messagesToStore.length > config.memory.compressionThreshold) {
    // Keep first few messages and recent messages
    const keepFirst = Math.floor(config.memory.compressionThreshold * 0.2);
    const keepRecent = config.memory.compressionThreshold - keepFirst;
    
    messagesToStore = [
      ...messagesToStore.slice(0, keepFirst),
      ...messagesToStore.slice(-keepRecent)
    ];
    
    console.log(`[JAF:MEMORY] Compressed conversation from ${finalState.messages.length} to ${messagesToStore.length} messages`);
  }

  const metadata = {
    userId: (finalState.context as any)?.userId,
    traceId: finalState.traceId,
    runId: finalState.runId,
    agentName: finalState.currentAgentName,
    turnCount: finalState.turnCount
  };

  const result = await config.memory.provider.storeMessages(config.conversationId, messagesToStore, metadata);
  if (!result.success) {
    console.warn(`[JAF:MEMORY] Failed to store conversation history: ${result.error}`);
    return;
  }
  
  console.log(`[JAF:MEMORY] Stored ${messagesToStore.length} messages for conversation ${config.conversationId}`);
}
