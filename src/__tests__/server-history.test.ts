import { z } from 'zod';
import { createJAFServer } from '../server/server';
import { Agent, Message, ModelProvider, RunState, Tool } from '../core/types';

describe('Server /chat full transcript with tool traces', () => {
  const executedArgs: Array<{ x: number }> = [];

  const sensitiveTool: Tool<{ x: number }, any> = {
    schema: {
      name: 'approveTest',
      description: 'Requires approval to run',
      parameters: z.object({ x: z.number() }) as z.ZodType<{ x: number }>,
    },
    needsApproval: true,
    async execute({ x }: { x: number }) {
      executedArgs.push({ x });
      return `ok:${x}`;
    },
  };

  const agent: Agent<any, any> = {
    name: 'HistoryAgent',
    instructions: () => 'Test agent',
    tools: [sensitiveTool],
    modelConfig: { name: 'mock-model' },
  };

  const seenMessages: Array<readonly Message[]> = [];

  const modelProvider: ModelProvider<any> = {
    async getCompletion(state: Readonly<RunState<any>>) {
      seenMessages.push(state.messages);
      return { message: { content: 'done' } };
    },
  };

  const server = createJAFServer<any>({
    port: 0,
    host: '127.0.0.1',
    cors: false,
    runConfig: {
      agentRegistry: new Map([[agent.name, agent]]),
      modelProvider,
      maxTurns: 5,
    },
  });

  const assistantWithToolCall = {
    role: 'assistant' as const,
    content: '',
    tool_calls: [
      {
        id: 'tc-A',
        type: 'function' as const,
        function: { name: 'approveTest', arguments: JSON.stringify({ x: 7 }) },
      },
    ],
  };

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    seenMessages.length = 0;
    executedArgs.length = 0;
  });

  it('passes user, assistant tool_calls, tool and user messages to the model intact', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        agentName: agent.name,
        messages: [
          { role: 'user', content: 'run tool' },
          assistantWithToolCall,
          { role: 'tool', content: 'ok:7', tool_call_id: 'tc-A' },
          { role: 'user', content: 'thanks, now summarise' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(seenMessages).toHaveLength(1);

    const msgs = seenMessages[0];
    expect(msgs).toHaveLength(4);
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(msgs[1].tool_calls).toEqual(assistantWithToolCall.tool_calls);
    expect(msgs[2].tool_call_id).toBe('tc-A');
    expect(msgs[2].content).toBe('ok:7');
  });

  it('applies an approval without a memory provider when the pending assistant message is replayed', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        agentName: agent.name,
        messages: [
          { role: 'user', content: 'run tool' },
          assistantWithToolCall,
        ],
        approvals: [
          { type: 'approval', sessionId: 'prev-run', toolCallId: 'tc-A', approved: true },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.outcome.status).toBe('completed');
    expect(executedArgs).toEqual([{ x: 7 }]);

    const toolMsg = body.data.messages.find((m: any) => m.role === 'tool');
    expect(toolMsg.tool_call_id).toBe('tc-A');
  });

  it('keeps text-only user/assistant requests unchanged', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        agentName: agent.name,
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
          { role: 'user', content: 'bye' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.outcome.status).toBe('completed');

    const msgs = seenMessages[0];
    expect(msgs.map(m => ({ role: m.role, content: m.content }))).toEqual([
      { role: 'user', content: 'be brief' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'bye' },
    ]);
    expect(msgs.every(m => m.tool_calls === undefined && m.tool_call_id === undefined)).toBe(true);
  });
});
