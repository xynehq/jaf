import { z } from 'zod';
import { run } from '../../core/engine';
import { makeGenericOpenAIProvider } from '../generic-openai';
import type { Agent, Message, RunConfig, RunState } from '../../core/types';
import { describe, it, expect, jest, afterEach } from '@jest/globals';

type MockedFetchCall = [
  string,
  RequestInit & {
    body: string;
    headers: Record<string, string>;
  },
];

type MockedFetch = typeof fetch & {
  mock: {
    calls: MockedFetchCall[];
  };
};

describe('generic OpenAI provider debug output', () => {
  const originalFetch = global.fetch;

  const makeFetchResponse = (body: unknown): Response => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);

  const mockFetchResponses = (...responses: Response[]) => {
    let index = 0;
    global.fetch = jest.fn(async () => {
      const response = responses[index];
      index += 1;
      if (!response) {
        throw new Error(`Unexpected fetch call ${index}`);
      }
      return response;
    });
  };

  const mockedModelContent = `We need to call a tool before answering.

</think>
The model is requesting a search before the final answer.
<tool_call>
<function=searchGlobal>
<parameter=query>Platform Credential Generation before Service Subscription</parameter>
<parameter=limit>5</parameter>
<parameter=includeArchived>false</parameter>
</function>
</tool_call>`;

  const mockedModelResponse = {
    id: 'chatcmpl-debug',
    object: 'chat.completion',
    created: 1777533657,
    model: 'nemotron-3-120b-a12b-bf16',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: mockedModelContent,
          tool_calls: [],
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 42, completion_tokens: 24, total_tokens: 66 },
  };

  const makeState = (): RunState<Record<string, never>> => ({
    runId: 'run-debug' as any,
    traceId: 'trace-debug' as any,
    messages: [{ role: 'user', content: 'Do we need Platform Credential Generation first?' }],
    currentAgentName: 'DebugAgent',
    context: {},
    turnCount: 0,
  });

  const makeAgent = (): Agent<Record<string, never>, string> => ({
    name: 'DebugAgent',
    instructions: () => 'You are a test agent. Use tools when needed.',
    tools: [
      {
        schema: {
          name: 'searchGlobal',
          description: 'Search globally',
          parameters: z.object({
            query: z.string(),
            limit: z.number().optional(),
            includeArchived: z.boolean().optional(),
          }),
        },
        execute: async () => 'result',
      },
    ],
    modelConfig: { name: 'nemotron-3-120b-a12b-bf16' },
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('prints the mocked model input and parsed provider output', async () => {
    mockFetchResponses(makeFetchResponse(mockedModelResponse));

    const provider = makeGenericOpenAIProvider('test-key', { baseURL: 'https://mock-llm.local/v1' });
    const config: RunConfig<Record<string, never>> = {
      agentRegistry: new Map([['DebugAgent', makeAgent()]]),
      modelProvider: provider,
    };

    const parsedOutput = await provider.getCompletion(makeState(), makeAgent(), config);
    const [, requestOptions] = (global.fetch as MockedFetch).mock.calls[0];
    const requestBodySentToMockedModel = JSON.parse(requestOptions.body);

    console.log(
      '[GENERIC_OPENAI_DEBUG] Request body sent to mocked model:',
      JSON.stringify(requestBodySentToMockedModel, null, 2),
    );
    console.log(
      '[GENERIC_OPENAI_DEBUG] Raw mocked model response content:',
      mockedModelContent,
    );
    console.log(
      '[GENERIC_OPENAI_DEBUG] Parsed provider output:',
      JSON.stringify(parsedOutput, null, 2),
    );

    expect(parsedOutput.message?.content).toBe('The model is requesting a search before the final answer.');
    expect(parsedOutput.message?.tool_calls).toHaveLength(1);
    expect(JSON.parse(parsedOutput.message!.tool_calls![0].function.arguments)).toEqual({
      query: 'Platform Credential Generation before Service Subscription',
      limit: 5,
      includeArchived: false,
    });
    expect((parsedOutput as any).thinking).toBe('We need to call a tool before answering.');
  });

  it('prints a mocked multi-turn conversation through the provider parser', async () => {
    const turn1RawContent = `Check the ordering requirement first.

</think>
Yes. Platform Credential Generation should happen before Service Subscription.`;

    const turn2RawContent = `The user asked why, so search for supporting detail.

</think>
<tool_call>
<function=searchGlobal>
<parameter=query>why Platform Credential Generation before Service Subscription</parameter>
<parameter=limit>3</parameter>
</function>
</tool_call>`;

    const turn3RawContent = `Summarize the tool-backed answer.

</think>
Credentials need to exist first because subscription setup depends on a generated platform identity.`;

    const makeMockResponse = (id: string, content: string, totalTokens: number) => ({
      id,
      object: 'chat.completion',
      created: 1777533657,
      model: 'nemotron-3-120b-a12b-bf16',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
            tool_calls: [],
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: Math.floor(totalTokens / 2),
        completion_tokens: Math.ceil(totalTokens / 2),
        total_tokens: totalTokens,
      },
    });

    mockFetchResponses(
      makeFetchResponse(makeMockResponse('chatcmpl-turn-1', turn1RawContent, 40)),
      makeFetchResponse(makeMockResponse('chatcmpl-turn-2', turn2RawContent, 55)),
      makeFetchResponse(makeMockResponse('chatcmpl-turn-3', turn3RawContent, 45)),
    );

    const provider = makeGenericOpenAIProvider('test-key', { baseURL: 'https://mock-llm.local/v1' });
    const agent = makeAgent();
    const config: RunConfig<Record<string, never>> = {
      agentRegistry: new Map([['DebugAgent', agent]]),
      modelProvider: provider,
    };

    let messages: Message[] = [
      { role: 'user', content: 'Is Platform Credential Generation required before Service Subscription?' },
    ];

    const runTurn = async (turn: number, rawContent: string) => {
      const state: RunState<Record<string, never>> = {
        runId: `run-debug-${turn}` as any,
        traceId: `trace-debug-${turn}` as any,
        messages,
        currentAgentName: 'DebugAgent',
        context: {},
        turnCount: turn - 1,
      };
      const parsedOutput = await provider.getCompletion(state, agent, config);
      const [, requestOptions] = (global.fetch as MockedFetch).mock.calls[turn - 1];
      const requestBody = JSON.parse(requestOptions.body);

      console.log(
        `[GENERIC_OPENAI_MULTI_TURN] Turn ${turn} request body sent to mocked model:`,
        JSON.stringify(requestBody, null, 2),
      );
      console.log(
        `[GENERIC_OPENAI_MULTI_TURN] Turn ${turn} raw mocked model response content:`,
        rawContent,
      );
      console.log(
        `[GENERIC_OPENAI_MULTI_TURN] Turn ${turn} parsed provider output:`,
        JSON.stringify(parsedOutput, null, 2),
      );

      messages = [
        ...messages,
        {
          role: 'assistant',
          content: parsedOutput.message?.content ?? '',
          tool_calls: parsedOutput.message?.tool_calls,
        },
      ];

      return { requestBody, parsedOutput };
    };

    const turn1 = await runTurn(1, turn1RawContent);
    messages = [
      ...messages,
      { role: 'user', content: 'Why is that ordering needed?' },
    ];

    const turn2 = await runTurn(2, turn2RawContent);
    const turn2ToolCall = turn2.parsedOutput.message!.tool_calls![0];
    messages = [
      ...messages,
      {
        role: 'tool',
        tool_call_id: turn2ToolCall.id,
        content: 'Search result: Service Subscription requires an existing platform credential identity.',
      },
      { role: 'user', content: 'Summarize that in one sentence.' },
    ];

    const turn3 = await runTurn(3, turn3RawContent);

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(turn1.requestBody.messages.map((message: any) => message.role)).toEqual(['system', 'user']);
    expect(turn2.requestBody.messages.map((message: any) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(turn3.requestBody.messages.map((message: any) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'tool',
      'user',
    ]);

    expect(turn1.parsedOutput.message?.content).toBe(
      'Yes. Platform Credential Generation should happen before Service Subscription.',
    );
    expect(turn2.parsedOutput.message?.content).toBe('');
    expect(turn2.parsedOutput.message?.tool_calls).toHaveLength(1);
    expect(JSON.parse(turn2ToolCall.function.arguments)).toEqual({
      query: 'why Platform Credential Generation before Service Subscription',
      limit: 3,
    });
    expect(turn3.parsedOutput.message?.content).toBe(
      'Credentials need to exist first because subscription setup depends on a generated platform identity.',
    );
  });

  it('executes a parsed XML tool call and completes on the next no-tool LLM response', async () => {
    const firstModelRawContent = `Need to verify the credential state with a tool.

</think>
<tool_call>
<function=searchGlobal>
<parameter=query>Platform Credential Generation status for merchant_123</parameter>
<parameter=limit>1</parameter>
</function>
</tool_call>`;

    const secondModelRawContent = `The tool result confirms the credential exists.

</think>
Platform Credential Generation is complete for merchant_123, so Service Subscription can proceed.`;

    const makeMockResponse = (id: string, content: string) => ({
      id,
      object: 'chat.completion',
      created: 1777533657,
      model: 'nemotron-3-120b-a12b-bf16',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
            tool_calls: [],
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 25, completion_tokens: 15, total_tokens: 40 },
    });

    mockFetchResponses(
      makeFetchResponse(makeMockResponse('chatcmpl-tool-turn-1', firstModelRawContent)),
      makeFetchResponse(makeMockResponse('chatcmpl-tool-turn-2', secondModelRawContent)),
    );

    const executedToolCalls: unknown[] = [];
    const searchGlobalExecute = jest.fn(async (args: { query: string; limit?: number }) => {
      executedToolCalls.push(args);
      return JSON.stringify({
        credentialGenerated: true,
        merchantId: 'merchant_123',
        matchedQuery: args.query,
      });
    });

    const agent: Agent<Record<string, never>, string> = {
      name: 'ToolRunAgent',
      instructions: () => 'Use searchGlobal when credential state must be checked.',
      tools: [
        {
          schema: {
            name: 'searchGlobal',
            description: 'Search globally',
            parameters: z.object({
              query: z.string(),
              limit: z.number().optional(),
            }),
          },
          execute: searchGlobalExecute,
        },
      ],
      modelConfig: { name: 'nemotron-3-120b-a12b-bf16' },
    };

    const baseProvider = makeGenericOpenAIProvider<Record<string, never>>('test-key', {
      baseURL: 'https://mock-llm.local/v1',
    });
    const nonStreamingProvider = {
      ...baseProvider,
      getCompletionStream: undefined,
    };

    const events: string[] = [];
    const config: RunConfig<Record<string, never>> = {
      agentRegistry: new Map([['ToolRunAgent', agent]]),
      modelProvider: nonStreamingProvider,
      onEvent: event => {
        events.push(event.type);
        if (event.type === 'tool_requests') {
          console.log(
            '[GENERIC_OPENAI_TOOL_RUN] Tool requests emitted by engine:',
            JSON.stringify(event.data.toolCalls, null, 2),
          );
        }
        if (event.type === 'tool_call_end') {
          console.log(
            '[GENERIC_OPENAI_TOOL_RUN] Tool execution result emitted by engine:',
            JSON.stringify(event.data, null, 2),
          );
        }
        if (event.type === 'final_output') {
          console.log(
            '[GENERIC_OPENAI_TOOL_RUN] Final output emitted by engine:',
            JSON.stringify(event.data.output, null, 2),
          );
        }
      },
    };

    const initialState: RunState<Record<string, never>> = {
      runId: 'run-tool-exec' as any,
      traceId: 'trace-tool-exec' as any,
      messages: [
        {
          role: 'user',
          content: 'Check if merchant_123 can proceed to Service Subscription.',
        },
      ],
      currentAgentName: 'ToolRunAgent',
      context: {},
      turnCount: 0,
    };

    const result = await run<Record<string, never>, string>(initialState, config);

    const fetchCalls = (global.fetch as MockedFetch).mock.calls;
    const firstRequestBody = JSON.parse(fetchCalls[0][1].body);
    const secondRequestBody = JSON.parse(fetchCalls[1][1].body);

    console.log(
      '[GENERIC_OPENAI_TOOL_RUN] Turn 1 request body sent to mocked LLM:',
      JSON.stringify(firstRequestBody, null, 2),
    );
    console.log(
      '[GENERIC_OPENAI_TOOL_RUN] Turn 1 raw mocked LLM response:',
      firstModelRawContent,
    );
    console.log(
      '[GENERIC_OPENAI_TOOL_RUN] Turn 2 request body sent to mocked LLM after tool execution:',
      JSON.stringify(secondRequestBody, null, 2),
    );
    console.log(
      '[GENERIC_OPENAI_TOOL_RUN] Turn 2 raw mocked LLM response with no tool call:',
      secondModelRawContent,
    );
    console.log(
      '[GENERIC_OPENAI_TOOL_RUN] Final run result:',
      JSON.stringify(result, null, 2),
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(searchGlobalExecute).toHaveBeenCalledTimes(1);
    expect(executedToolCalls).toEqual([
      {
        query: 'Platform Credential Generation status for merchant_123',
        limit: 1,
      },
    ]);

    expect(secondRequestBody.messages.map((message: any) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
    ]);
    expect(secondRequestBody.messages[2].tool_calls).toHaveLength(1);
    const wrappedToolResult = JSON.parse(secondRequestBody.messages[3].content);
    expect(JSON.parse(wrappedToolResult.result)).toMatchObject({
      credentialGenerated: true,
      merchantId: 'merchant_123',
    });

    expect(result.outcome).toEqual({
      status: 'completed',
      output: 'Platform Credential Generation is complete for merchant_123, so Service Subscription can proceed.',
    });
    expect(result.finalState.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(events).toContain('tool_requests');
    expect(events).toContain('tool_call_end');
    expect(events).toContain('final_output');
  });
});
