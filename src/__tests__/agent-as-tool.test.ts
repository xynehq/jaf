import { 
  run, 
  Agent, 
  RunConfig, 
  RunState, 
  generateRunId, 
  generateTraceId,
  agentAsTool
} from '../index';

type Ctx = { userId: string; permissions: string[] };

describe('Agents as Tools', () => {
  const context: Ctx = { userId: 'u1', permissions: ['user'] };

  const summarizer: Agent<Ctx, string> = {
    name: 'Summarizer',
    instructions: () => 'Summarize the user input in a short sentence.',
    modelConfig: { name: 'test-model' }
  };

  const summarizeTool = agentAsTool<Ctx, string>(summarizer, {
    toolName: 'summarize_text',
    toolDescription: 'Summarize the supplied text.'
  });

  const mainAgent: Agent<Ctx, string> = {
    name: 'MainAgent',
    instructions: () => 'You can use tools to help you; call summarize_text when asked to summarize.',
    tools: [summarizeTool],
    modelConfig: { name: 'test-model' }
  };

  test('runs sub-agent via tool and returns output to parent', async () => {
    const calls: string[] = [];

    const modelProvider = {
      async getCompletion(state: Readonly<RunState<Ctx>>, agent: Readonly<Agent<Ctx, any>>) {
        calls.push(agent.name);

        const lastMsg = state.messages[state.messages.length - 1];

        if (agent.name === 'Summarizer') {
          // Child agent returns a summary based on its single user message
          const input = lastMsg?.content ?? '';
          return { message: { content: `SUMMARY(${input})` } };
        }

        // Parent agent logic: first return a tool call, then finalize
        if (lastMsg.role !== 'tool') {
          const userInput = lastMsg.content || 'empty';
          return {
            message: {
              tool_calls: [{
                id: 'call_1',
                type: 'function' as const,
                function: {
                  name: 'summarize_text',
                  arguments: JSON.stringify({ input: userInput })
                }
              }]
            }
          };
        }

        // After tool result arrives, return a final assistant message
        return { message: { content: 'Done.' } };
      }
    } as any;

    const agentRegistry = new Map<string, Agent<Ctx, any>>([
      [mainAgent.name, mainAgent]
    ]);

    const config: RunConfig<Ctx> = {
      agentRegistry,
      modelProvider,
      maxTurns: 6
    };

    const initialState: RunState<Ctx> = {
      runId: generateRunId(),
      traceId: generateTraceId(),
      messages: [{ role: 'user', content: 'Please summarize: Hello World' }],
      currentAgentName: mainAgent.name,
      context,
      turnCount: 0
    };

    const result = await run<Ctx, string>(initialState, config);
    expect(result.outcome.status).toBe('completed');
    expect(calls).toContain('Summarizer');

    // Ensure a tool message was recorded
    const toolMsgs = result.finalState.messages.filter(m => m.role === 'tool');
    expect(toolMsgs.length).toBeGreaterThan(0);
    // The tool result should include the SUMMARY prefix from the sub-agent
    const hasSummary = toolMsgs.some(m => (m.content || '').includes('SUMMARY('));
    expect(hasSummary).toBe(true);
  });

  test('respects customOutputExtractor', async () => {
    const extractedTool = agentAsTool<Ctx, string>(summarizer, {
      toolName: 'summarize_text_custom',
      customOutputExtractor: async (output) => `EXTRACTED:${output}`
    });

    const customAgent: Agent<Ctx, string> = {
      name: 'MainWithExtractor',
      instructions: () => 'Call summarize_text_custom then finish.',
      tools: [extractedTool],
      modelConfig: { name: 'test-model' }
    };

    const modelProvider = {
      async getCompletion(state: Readonly<RunState<Ctx>>, agent: Readonly<Agent<Ctx, any>>) {
        const lastMsg = state.messages[state.messages.length - 1];
        if (agent.name === 'Summarizer') {
          return { message: { content: 'child-output' } };
        }
        if (lastMsg.role !== 'tool') {
          return {
            message: {
              tool_calls: [{
                id: 'x',
                type: 'function' as const,
                function: {
                  name: 'summarize_text_custom',
                  arguments: JSON.stringify({ input: 'anything' })
                }
              }]
            }
          };
        }
        return { message: { content: 'ok' } };
      }
    } as any;

    const agentRegistry = new Map<string, Agent<Ctx, any>>([
      [customAgent.name, customAgent]
    ]);

    const config: RunConfig<Ctx> = {
      agentRegistry,
      modelProvider,
      maxTurns: 5
    };

    const initialState: RunState<Ctx> = {
      runId: generateRunId(),
      traceId: generateTraceId(),
      messages: [{ role: 'user', content: 'Use the tool' }],
      currentAgentName: customAgent.name,
      context,
      turnCount: 0
    };

    const result = await run<Ctx, string>(initialState, config);
    expect(result.outcome.status).toBe('completed');
    const toolMsgs = result.finalState.messages.filter(m => m.role === 'tool');
    expect(toolMsgs.some(m => (m.content || '').includes('EXTRACTED:child-output'))).toBe(true);
  });

  test('returns ToolResult.error when sub-run fails', async () => {
    // Child agent will fail (no message returned)
    const failingProvider = {
      async getCompletion(state: Readonly<RunState<Ctx>>, agent: Readonly<Agent<Ctx, any>>) {
        const lastMsg = state.messages[state.messages.length - 1];
        if (agent.name === 'Summarizer') {
          // Return no message to trigger ModelBehaviorError inside sub-run
          return {} as any;
        }
        if (lastMsg.role !== 'tool') {
          return {
            message: {
              tool_calls: [{
                id: 'x',
                type: 'function' as const,
                function: { name: 'summarize_text', arguments: JSON.stringify({ input: 'fail-me' }) }
              }]
            }
          };
        }
        return { message: { content: 'done' } };
      }
    } as any;

    const agentRegistry = new Map<string, Agent<Ctx, any>>([
      [mainAgent.name, mainAgent]
    ]);

    const config: RunConfig<Ctx> = {
      agentRegistry,
      modelProvider: failingProvider,
      maxTurns: 4
    };

    const initialState: RunState<Ctx> = {
      runId: generateRunId(),
      traceId: generateTraceId(),
      messages: [{ role: 'user', content: 'Trigger failure' }],
      currentAgentName: mainAgent.name,
      context,
      turnCount: 0
    };

    const result = await run<Ctx, string>(initialState, config);
    expect(result.outcome.status).toBe('completed');
    const toolMsgs = result.finalState.messages.filter(m => m.role === 'tool');
    // Expect a structured error string from ToolResponse.error
    const hasExecError = toolMsgs.some(m => (m.content || '').includes('"code": "EXECUTION_FAILED"'));
    expect(hasExecError).toBe(true);
  });

  test('passes parent context to sub-agent', async () => {
    const capturedContexts: Ctx[] = [];

    const provider = {
      async getCompletion(state: Readonly<RunState<Ctx>>, agent: Readonly<Agent<Ctx, any>>) {
        const lastMsg = state.messages[state.messages.length - 1];
        if (agent.name === 'Summarizer') {
          capturedContexts.push(state.context as Ctx);
          return { message: { content: 'ok' } };
        }
        if (lastMsg.role !== 'tool') {
          return {
            message: {
              tool_calls: [{
                id: 'x',
                type: 'function' as const,
                function: { name: 'summarize_text', arguments: JSON.stringify({ input: 'ctx' }) }
              }]
            }
          };
        }
        return { message: { content: 'done' } };
      }
    } as any;

    const agentRegistry = new Map<string, Agent<Ctx, any>>([[mainAgent.name, mainAgent]]);
    const config: RunConfig<Ctx> = { agentRegistry, modelProvider: provider, maxTurns: 4 };
    const initialState: RunState<Ctx> = {
      runId: generateRunId(),
      traceId: generateTraceId(),
      messages: [{ role: 'user', content: 'check ctx' }],
      currentAgentName: mainAgent.name,
      context,
      turnCount: 0
    };

    const result = await run<Ctx, string>(initialState, config);
    expect(result.outcome.status).toBe('completed');
    expect(capturedContexts.length).toBeGreaterThan(0);
    expect(capturedContexts[0]).toBe(context);
  });
});
