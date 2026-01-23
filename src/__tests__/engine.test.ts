import { run, RunConfig, RunState, generateTraceId, generateRunId } from '../index.js';

describe('JAF Engine', () => {
  const mockContext = { userId: 'test' };
  
  const mockAgent = {
    name: 'TestAgent',
    instructions: () => 'Test agent instructions',
    tools: [],
    modelConfig: {
      name: 'test-model'
    }
  };

  const mockModelProvider = {
    async getCompletion() {
      return {
        message: {
          content: 'Test response'
        }
      };
    }
  };

  const agentRegistry = new Map([['TestAgent', mockAgent]]);

  it('should complete a simple run successfully', async () => {
    const config: RunConfig<typeof mockContext> = {
      agentRegistry,
      modelProvider: mockModelProvider,
      maxTurns: 10,
    };

    const initialState: RunState<typeof mockContext> = {
      runId: generateRunId(),
      traceId: generateTraceId(),
      messages: [{ role: 'user', content: 'Hello' }],
      currentAgentName: 'TestAgent',
      context: mockContext,
      turnCount: 0,
      approvals: new Map(),
    };

    const result = await run(initialState, config);

    expect(result.outcome.status).toBe('completed');
    if (result.outcome.status === 'completed') {
      expect(result.outcome.output).toBe('Test response');
    }
  });

  it('should fail when max turns exceeded', async () => {
    const loopingModelProvider = {
      async getCompletion() {
        return {
          message: {
            tool_calls: [{
              id: 'test',
              type: 'function' as const,
              function: {
                name: 'nonexistent_tool',
                arguments: '{}'
              }
            }]
          }
        };
      }
    };

    const config: RunConfig<typeof mockContext> = {
      agentRegistry,
      modelProvider: loopingModelProvider,
      maxTurns: 2,
    };

    const initialState: RunState<typeof mockContext> = {
      runId: generateRunId(),
      traceId: generateTraceId(),
      messages: [{ role: 'user', content: 'Hello' }],
      currentAgentName: 'TestAgent',
      context: mockContext,
      turnCount: 0,
      approvals: new Map(),
    };

    const result = await run(initialState, config);

    expect(result.outcome.status).toBe('error');
    if (result.outcome.status === 'error') {
      expect(result.outcome.error._tag).toBe('MaxTurnsExceeded');
    }
  });

  it('should fail when agent not found', async () => {
    const config: RunConfig<typeof mockContext> = {
      agentRegistry,
      modelProvider: mockModelProvider,
      maxTurns: 10,
    };

    const initialState: RunState<typeof mockContext> = {
      runId: generateRunId(),
      traceId: generateTraceId(),
      messages: [{ role: 'user', content: 'Hello' }],
      currentAgentName: 'NonexistentAgent',
      context: mockContext,
      turnCount: 0,
      approvals: new Map(),
    };

    const result = await run(initialState, config);

    expect(result.outcome.status).toBe('error');
    if (result.outcome.status === 'error') {
      expect(result.outcome.error._tag).toBe('AgentNotFound');
    }
  });
});