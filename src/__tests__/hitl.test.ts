import { z } from 'zod';
import { run, RunConfig, RunState, generateTraceId, generateRunId, Agent, Tool, getTextContent } from '../index.js';

describe('HITL approvals', () => {
  const sensitiveTool: Tool<{ x: number }, any> = {
    schema: {
      name: 'approveTest',
      description: 'Requires approval to run',
      parameters: z.object({ x: z.number() }) as z.ZodType<{ x: number }>,
    },
    needsApproval: true,
    async execute({ x }: { x: number }) {
      return `ok:${x}`;
    },
  };

  const agent: Agent<any, any> = {
    name: 'HITLAgent',
    instructions: () => 'Test agent with approval tool',
    tools: [sensitiveTool],
    modelConfig: { name: 'mock-model' },
  };

  const modelProvider = {
    async getCompletion(state: RunState<any>) {
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === 'tool') {
        return { message: { content: 'done' } };
      }
      return {
        message: {
          tool_calls: [
            {
              id: 'tc-1',
              type: 'function' as const,
              function: { name: 'approveTest', arguments: JSON.stringify({ x: 42 }) },
            },
          ],
        },
      };
    },
  };

  const config: RunConfig<any> = {
    agentRegistry: new Map([[agent.name, agent]]),
    modelProvider,
    maxTurns: 5,
  };

  it('resumes deterministically and completes when approved', async () => {
    const initial: RunState<any> = {
      runId: generateRunId(),
      traceId: generateTraceId(),
      messages: [{ role: 'user', content: 'run tool' }],
      currentAgentName: agent.name,
      context: {},
      turnCount: 0,
      approvals: new Map(),
    };

    const interrupted = await run(initial, config);
    expect(interrupted.outcome.status).toBe('interrupted');

    const stateAfter = interrupted.finalState;
    const approvals = new Map(stateAfter.approvals);
    approvals.set('tc-1', { status: 'approved', approved: true });

    const resumed: RunState<any> = { ...stateAfter, approvals };
    const completed = await run(resumed, config);
    expect(completed.outcome.status).toBe('completed');
    if (completed.outcome.status === 'completed') {
      expect(completed.outcome.output).toBe('done');
    }
  });

  it('treats pending as no decision (re-interrupt)', async () => {
    const initial: RunState<any> = {
      runId: generateRunId(),
      traceId: generateTraceId(),
      messages: [{ role: 'user', content: 'run tool' }],
      currentAgentName: agent.name,
      context: {},
      turnCount: 0,
      approvals: new Map(),
    };

    const interrupted = await run(initial, config);
    expect(interrupted.outcome.status).toBe('interrupted');

    const stateAfter = interrupted.finalState;
    const approvals = new Map(stateAfter.approvals);
    approvals.set('tc-1', { status: 'pending', approved: false, additionalContext: { status: 'pending' } });

    const resumed: RunState<any> = { ...stateAfter, approvals };
    const interruptedAgain = await run(resumed, config);
    expect(interruptedAgain.outcome.status).toBe('interrupted');
  });

  it('rejected produces approval_denied tool result', async () => {
    const initial: RunState<any> = {
      runId: generateRunId(),
      traceId: generateTraceId(),
      messages: [{ role: 'user', content: 'run tool' }],
      currentAgentName: agent.name,
      context: {},
      turnCount: 0,
      approvals: new Map(),
    };

    const interrupted = await run(initial, config);
    expect(interrupted.outcome.status).toBe('interrupted');

    const stateAfter = interrupted.finalState;
    const approvals = new Map(stateAfter.approvals);
    approvals.set('tc-1', { status: 'rejected', approved: false, additionalContext: { rejectionReason: 'nope' } });

    const resumed: RunState<any> = { ...stateAfter, approvals };
    const completed = await run(resumed, config);
    expect(completed.outcome.status).toBe('completed');
    const toolMsg = completed.finalState.messages.find(m => m.role === 'tool');
    expect(toolMsg).toBeTruthy();
    if (toolMsg) {
      const payload = JSON.parse(getTextContent(toolMsg.content));
      expect(payload.status).toBe('approval_denied');
      expect(payload.rejection_reason).toBe('nope');
    }
  });
});
