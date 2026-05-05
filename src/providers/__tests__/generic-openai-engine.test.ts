import { z } from 'zod';
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { run, runStream } from '../../core/engine';
import {
  createRunId,
  createTraceId,
  type Agent,
  type MessageContentPart,
  type RunConfig,
  type RunState,
  type TraceEvent,
} from '../../core/types';
import { makeGenericOpenAIProvider } from '../generic-openai';

type TestContext = Record<string, never>;

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

function simulateXyneImageMemoryInjection<Ctx>(
  state: RunState<Ctx>,
): RunState<Ctx> {
  let lastUserIndex = -1;

  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i]?.role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  if (lastUserIndex === -1) {
    return state;
  }

  const messages = state.messages.map((message, index) => {
    if (index !== lastUserIndex || message.role !== 'user') {
      return message;
    }

    const baseParts: MessageContentPart[] = Array.isArray(message.content)
      ? [...message.content]
      : [{ type: 'text', text: message.content }];
    const injectedContent: MessageContentPart[] = [
      ...baseParts,
      { type: 'text', text: 'Image reference [1_1] from document doc-1.' },
      {
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
        },
      },
    ];

    return {
      ...message,
      role: 'user' as const,
      content: injectedContent,
    };
  });

  return { ...state, messages };
}

describe('generic OpenAI provider - engine flow', () => {
  const originalFetch = global.fetch;

  const makeFetchResponse = (body: unknown): Response => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);

  const makeStreamResponse = (sseChunks: string[]): Response => {
    const encoder = new TextEncoder();
    let index = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (index < sseChunks.length) {
          controller.enqueue(encoder.encode(sseChunks[index]));
          index += 1;
          return;
        }
        controller.close();
      },
    });

    return {
      ok: true,
      status: 200,
      body,
      text: async () => 'stream error',
    } as Response;
  };

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

  const makeMockResponse = (id: string, content: string, totalTokens = 40) => ({
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

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('runs three engine turns with multiple tool calls and completes on the final no-tool response', async () => {
    const turn1RawContent = `We need facts from multiple sources before answering.

</think>
<tool_call>
<function=searchGlobal>
<parameter=query>Platform Credential Generation merchant_123 status</parameter>
<parameter=limit>2</parameter>
</function>
</tool_call>
<tool_call>
<function=getCredentialStatus>
<parameter=merchantId>merchant_123</parameter>
</function>
</tool_call>
<tool_call>
<function=getSubscriptionRequirements>
<parameter=service>Service Subscription</parameter>
</function>
</tool_call>`;

    const turn2RawContent = `We have the raw facts, now compute the decision payload.

</think>
<tool_call>
<function=buildRecommendation>
<parameter=merchantId>merchant_123</parameter>
<parameter=credentialReady>true</parameter>
<parameter=requirementFound>true</parameter>
</function>
</tool_call>`;

    const turn3RawContent = `The recommendation is ready.

</think>
Platform Credential Generation is already complete for merchant_123, so Service Subscription can proceed immediately.`;

    mockFetchResponses(
      makeFetchResponse(makeMockResponse('chatcmpl-engine-turn-1', turn1RawContent, 60)),
      makeFetchResponse(makeMockResponse('chatcmpl-engine-turn-2', turn2RawContent, 50)),
      makeFetchResponse(makeMockResponse('chatcmpl-engine-turn-3', turn3RawContent, 35)),
    );

    const executedCalls: Array<{ tool: string; args: unknown; output: unknown }> = [];
    const agent: Agent<TestContext, string> = {
      name: 'EngineAgent',
      instructions: () => 'Use tools to verify credential readiness before answering.',
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
          execute: async (args) => {
            const output = {
              source: 'search',
              matched: true,
              merchantId: 'merchant_123',
            };
            executedCalls.push({ tool: 'searchGlobal', args, output });
            return JSON.stringify(output);
          },
        },
        {
          schema: {
            name: 'getCredentialStatus',
            description: 'Get credential generation status',
            parameters: z.object({
              merchantId: z.string(),
            }),
          },
          execute: async (args) => {
            const output = {
              merchantId: args.merchantId,
              credentialReady: true,
            };
            executedCalls.push({ tool: 'getCredentialStatus', args, output });
            return JSON.stringify(output);
          },
        },
        {
          schema: {
            name: 'getSubscriptionRequirements',
            description: 'Get subscription requirements',
            parameters: z.object({
              service: z.string(),
            }),
          },
          execute: async (args) => {
            const output = {
              service: args.service,
              requiresCredentialGeneration: true,
            };
            executedCalls.push({ tool: 'getSubscriptionRequirements', args, output });
            return JSON.stringify(output);
          },
        },
        {
          schema: {
            name: 'buildRecommendation',
            description: 'Build final recommendation payload',
            parameters: z.object({
              merchantId: z.string(),
              credentialReady: z.boolean(),
              requirementFound: z.boolean(),
            }),
          },
          execute: async (args) => {
            const output = {
              merchantId: args.merchantId,
              proceed: args.credentialReady && args.requirementFound,
            };
            executedCalls.push({ tool: 'buildRecommendation', args, output });
            return JSON.stringify(output);
          },
        },
      ],
      modelConfig: { name: 'nemotron-3-120b-a12b-bf16' },
    };

    const baseProvider = makeGenericOpenAIProvider<TestContext>('test-key', {
      baseURL: 'https://mock-llm.local/v1',
    });
    const modelProvider = {
      ...baseProvider,
      getCompletionStream: undefined,
    };

    const eventTypes: string[] = [];
    const toolRequestBatches: Array<Array<{ id: string; name: string; args: unknown }>> = [];
    const toolResultBatchSizes: number[] = [];
    const turnEnds: number[] = [];
    const runEnds: Array<TraceEvent & { type: 'run_end' }> = [];

    const config: RunConfig<TestContext> = {
      agentRegistry: new Map([[agent.name, agent]]),
      modelProvider,
      onEvent: (event) => {
        eventTypes.push(event.type);
        if (event.type === 'tool_requests') {
          toolRequestBatches.push(event.data.toolCalls);
        }
        if (event.type === 'tool_results_to_llm') {
          toolResultBatchSizes.push(event.data.results.length);
        }
        if (event.type === 'turn_end') {
          turnEnds.push(event.data.turn);
        }
        if (event.type === 'run_end') {
          runEnds.push(event);
        }
      },
      maxTurns: 5,
    };

    const initialState: RunState<TestContext> = {
      runId: createRunId('run-engine-generic-provider'),
      traceId: createTraceId('trace-engine-generic-provider'),
      messages: [
        {
          role: 'user',
          content: 'Check whether merchant_123 can proceed to Service Subscription.',
        },
      ],
      currentAgentName: 'EngineAgent',
      context: {},
      turnCount: 0,
    };

    const result = await run<TestContext, string>(initialState, config);

    const fetchCalls = (global.fetch as MockedFetch).mock.calls;
    const firstRequestBody = JSON.parse(fetchCalls[0][1].body);
    const secondRequestBody = JSON.parse(fetchCalls[1][1].body);
    const thirdRequestBody = JSON.parse(fetchCalls[2][1].body);

    console.log(
      '[GENERIC_OPENAI_ENGINE] Turn 1 request body sent to mocked model:',
      JSON.stringify(firstRequestBody, null, 2),
    );
    console.log(
      '[GENERIC_OPENAI_ENGINE] Turn 1 raw mocked model response:',
      turn1RawContent,
    );
    console.log(
      '[GENERIC_OPENAI_ENGINE] Tool execution outputs:',
      JSON.stringify(executedCalls, null, 2),
    );
    console.log(
      '[GENERIC_OPENAI_ENGINE] Turn 2 request body sent to mocked model:',
      JSON.stringify(secondRequestBody, null, 2),
    );
    console.log(
      '[GENERIC_OPENAI_ENGINE] Turn 2 raw mocked model response:',
      turn2RawContent,
    );
    console.log(
      '[GENERIC_OPENAI_ENGINE] Turn 3 request body sent to mocked model:',
      JSON.stringify(thirdRequestBody, null, 2),
    );
    console.log(
      '[GENERIC_OPENAI_ENGINE] Turn 3 raw mocked model response:',
      turn3RawContent,
    );

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(executedCalls).toEqual([
      {
        tool: 'searchGlobal',
        args: {
          query: 'Platform Credential Generation merchant_123 status',
          limit: 2,
        },
        output: {
          source: 'search',
          matched: true,
          merchantId: 'merchant_123',
        },
      },
      {
        tool: 'getCredentialStatus',
        args: {
          merchantId: 'merchant_123',
        },
        output: {
          merchantId: 'merchant_123',
          credentialReady: true,
        },
      },
      {
        tool: 'getSubscriptionRequirements',
        args: {
          service: 'Service Subscription',
        },
        output: {
          service: 'Service Subscription',
          requiresCredentialGeneration: true,
        },
      },
      {
        tool: 'buildRecommendation',
        args: {
          merchantId: 'merchant_123',
          credentialReady: true,
          requirementFound: true,
        },
        output: {
          merchantId: 'merchant_123',
          proceed: true,
        },
      },
    ]);

    expect(firstRequestBody.messages.map((message: { role: string }) => message.role)).toEqual([
      'system',
      'user',
    ]);
    expect(secondRequestBody.messages.map((message: { role: string }) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'tool',
      'tool',
    ]);
    expect(thirdRequestBody.messages.map((message: { role: string }) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'tool',
      'tool',
      'assistant',
      'tool',
    ]);

    expect(secondRequestBody.messages[2].tool_calls).toHaveLength(3);
    expect(thirdRequestBody.messages[6].tool_calls).toHaveLength(1);

    expect(toolRequestBatches.map(batch => batch.length)).toEqual([3, 1]);
    expect(toolResultBatchSizes).toEqual([3, 1]);
    expect(turnEnds).toEqual([1, 2, 3]);
    expect(runEnds).toHaveLength(1);
    expect(runEnds[0].data.outcome.status).toBe('completed');

    expect(result.outcome).toEqual({
      status: 'completed',
      output: 'Platform Credential Generation is already complete for merchant_123, so Service Subscription can proceed immediately.',
    });
    expect(result.finalState.turnCount).toBe(3);
    expect(result.finalState.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(eventTypes).toContain('turn_end');
    expect(eventTypes).toContain('run_end');
    expect(eventTypes).toContain('tool_call_end');
    expect(eventTypes).toContain('final_output');
  });

  it('runs the streamed engine path and preserves tool execution ordering', async () => {
    mockFetchResponses(
      makeStreamResponse([
        'data: {"choices":[{"delta":{"content":"Need streamed tool checks."},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"content":"\\n\\n</think>\\n<tool_call>\\n<function=searchGlobal>\\n<parameter=query>merchant_456 credential status</parameter>\\n<parameter=limit>1</parameter>\\n</function>\\n</tool_call>"},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"content":"\\n<tool_call>\\n<function=getCredentialStatus>\\n<parameter=merchantId>merchant_456</parameter>\\n</function>\\n</tool_call>"},"index":0}]}\n\n',
        'data: {"choices":[{"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":9,"total_tokens":20}}\n\n',
        'data: [DONE]\n\n',
      ]),
      makeStreamResponse([
        'data: {"choices":[{"delta":{"content":"The streamed tool results are enough."},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"content":"\\n\\n</think>\\nmerchant_456 is ready to proceed."},"index":0}]}\n\n',
        'data: {"choices":[{"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":7,"total_tokens":15}}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const executedCalls: string[] = [];
    const agent: Agent<TestContext, string> = {
      name: 'StreamingEngineAgent',
      instructions: () => 'Use streamed tool calls when needed.',
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
          execute: async (args) => {
            executedCalls.push(`searchGlobal:${args.query}:${args.limit ?? 0}`);
            return JSON.stringify({ source: 'stream-search', matched: true });
          },
        },
        {
          schema: {
            name: 'getCredentialStatus',
            description: 'Get credential generation status',
            parameters: z.object({
              merchantId: z.string(),
            }),
          },
          execute: async (args) => {
            executedCalls.push(`getCredentialStatus:${args.merchantId}`);
            return JSON.stringify({ merchantId: args.merchantId, credentialReady: true });
          },
        },
      ],
      modelConfig: { name: 'nemotron-3-120b-a12b-bf16' },
    };

    const config: RunConfig<TestContext> = {
      agentRegistry: new Map([[agent.name, agent]]),
      modelProvider: makeGenericOpenAIProvider<TestContext>('test-key', {
        baseURL: 'https://mock-llm.local/v1',
      }),
      maxTurns: 4,
    };

    const initialState: RunState<TestContext> = {
      runId: createRunId('run-stream-engine-generic-provider'),
      traceId: createTraceId('trace-stream-engine-generic-provider'),
      messages: [
        {
          role: 'user',
          content: 'Check whether merchant_456 can proceed.',
        },
      ],
      currentAgentName: 'StreamingEngineAgent',
      context: {},
      turnCount: 0,
    };

    const events: TraceEvent[] = [];
    for await (const event of runStream<TestContext, string>(initialState, config)) {
      events.push(event);
    }

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(executedCalls).toEqual([
      'searchGlobal:merchant_456 credential status:1',
      'getCredentialStatus:merchant_456',
    ]);

    const eventTypes = events.map(event => event.type);
    expect(eventTypes).toContain('assistant_message');
    expect(eventTypes).toContain('tool_requests');
    expect(eventTypes).toContain('tool_results_to_llm');
    expect(eventTypes).toContain('turn_end');
    expect(eventTypes).toContain('final_output');
    expect(eventTypes).toContain('run_end');

    const assistantEvents = events.filter(
      (event): event is TraceEvent & { type: 'assistant_message' } => event.type === 'assistant_message',
    );
    expect(assistantEvents.length).toBeGreaterThanOrEqual(2);
    const assistantToolCallEvents = assistantEvents.filter(event => Array.isArray(event.data.message.tool_calls));
    expect(assistantToolCallEvents).toHaveLength(2);
    expect(assistantToolCallEvents[0].data.message.tool_calls).toHaveLength(1);
    expect(assistantToolCallEvents[0].data.message.content).toBe('');
    expect(assistantToolCallEvents[1].data.message.tool_calls).toHaveLength(2);
    expect(assistantToolCallEvents[1].data.message.tool_calls?.map(toolCall => toolCall.function.name)).toEqual([
      'searchGlobal',
      'getCredentialStatus',
    ]);

    const toolRequests = events.find(event => event.type === 'tool_requests');
    expect(toolRequests?.type).toBe('tool_requests');
    if (toolRequests?.type === 'tool_requests') {
      expect(toolRequests.data.toolCalls).toHaveLength(2);
      expect(toolRequests.data.toolCalls.map(toolCall => toolCall.name)).toEqual([
        'searchGlobal',
        'getCredentialStatus',
      ]);
    }

    const turnEnds = events.filter((event): event is TraceEvent & { type: 'turn_end' } => event.type === 'turn_end');
    expect(turnEnds.map(event => event.data.turn)).toEqual([1, 2]);

    const finalOutput = events.find((event): event is TraceEvent & { type: 'final_output' } => event.type === 'final_output');
    expect(finalOutput?.data.output).toBe('merchant_456 is ready to proceed.');
  });

  it('preserves Xyne-style image-memory content parts through engine turns', async () => {
    const turn1RawContent = `Need a lookup.

</think>
<tool_call>
<function=searchGlobal>
<parameter=query>image context</parameter>
</function>
</tool_call>`;

    const turn2RawContent = `Done.

</think>
The image context was considered.`;

    mockFetchResponses(
      makeFetchResponse(makeMockResponse('chatcmpl-image-turn-1', turn1RawContent, 44)),
      makeFetchResponse(makeMockResponse('chatcmpl-image-turn-2', turn2RawContent, 28)),
    );

    const agent: Agent<TestContext, string> = {
      name: 'EngineAgent',
      instructions: () => 'Use tools to verify image-backed context before answering.',
      tools: [
        {
          schema: {
            name: 'searchGlobal',
            description: 'Search globally',
            parameters: z.object({
              query: z.string(),
            }),
          },
          execute: async (args) => JSON.stringify({
            matchedQuery: args.query,
            source: 'image-memory',
          }),
        },
      ],
      modelConfig: { name: 'nemotron-3-120b-a12b-bf16' },
    };

    const config: RunConfig<TestContext> = {
      agentRegistry: new Map([[agent.name, agent]]),
      modelProvider: {
        ...makeGenericOpenAIProvider<TestContext>('test-key', {
          baseURL: 'https://mock-llm.local/v1',
        }),
        getCompletionStream: undefined,
      },
      maxTurns: 4,
    };

    const stateWithImages = simulateXyneImageMemoryInjection<TestContext>({
      runId: createRunId('run-image-memory'),
      traceId: createTraceId('trace-image-memory'),
      messages: [
        {
          role: 'user',
          content: 'Answer using the referenced image.',
        },
      ],
      currentAgentName: 'EngineAgent',
      context: {},
      turnCount: 0,
    });

    const result = await run<TestContext, string>(stateWithImages, config);

    const fetchCalls = (global.fetch as MockedFetch).mock.calls;
    const firstBody = JSON.parse(fetchCalls[0][1].body);
    const secondBody = JSON.parse(fetchCalls[1][1].body);

    expect(firstBody.messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Answer using the referenced image.' },
        { type: 'text', text: 'Image reference [1_1] from document doc-1.' },
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
          },
        },
      ],
    });
    expect(secondBody.messages[1].content).toEqual(firstBody.messages[1].content);
    expect(secondBody.messages[2].tool_calls).toHaveLength(1);
    expect(secondBody.messages[2].tool_calls[0].function.name).toBe('searchGlobal');
    expect(secondBody.messages[3].role).toBe('tool');
    expect(result.outcome).toEqual({
      status: 'completed',
      output: 'The image context was considered.',
    });
  });
});
