import { z } from 'zod';
import {
  makeGenericOpenAIProvider,
  parseThinkingContent,
  parseXmlToolCalls,
  stripXmlToolCalls,
} from '../generic-openai';
import type { Agent, RunConfig, RunState } from '../../core/types';
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

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

describe('parseThinkingContent', () => {
  it('separates thinking from content when a closing think tag is present', () => {
    const result = parseThinkingContent('I need to search.\n\n</think>\nHere is the answer.');

    expect(result.thinking).toBe('I need to search.');
    expect(result.content).toBe('Here is the answer.');
  });

  it('returns null thinking when no closing think tag is present', () => {
    const result = parseThinkingContent('Just a normal response.');

    expect(result.thinking).toBeNull();
    expect(result.content).toBe('Just a normal response.');
  });

  it('handles an empty thinking block', () => {
    const result = parseThinkingContent('</think>\nActual content.');

    expect(result.thinking).toBeNull();
    expect(result.content).toBe('Actual content.');
  });

  it('handles an empty content block', () => {
    const result = parseThinkingContent('All thinking.</think>');

    expect(result.thinking).toBe('All thinking.');
    expect(result.content).toBe('');
  });

  it('handles multiline thinking', () => {
    const result = parseThinkingContent('Step 1\nStep 2\n\n</think>\nFinal answer.');

    expect(result.thinking).toBe('Step 1\nStep 2');
    expect(result.content).toBe('Final answer.');
  });
});

describe('parseXmlToolCalls', () => {
  it('parses a single tool call', () => {
    const result = parseXmlToolCalls(`
<tool_call>
<function=searchGlobal>
<parameter=query>Platform Credential Generation</parameter>
</function>
</tool_call>`);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('searchGlobal');
    expect(JSON.parse(result[0].function.arguments)).toEqual({
      query: 'Platform Credential Generation',
    });
  });

  it('parses multiple tool calls and numeric parameters', () => {
    const result = parseXmlToolCalls(`
<tool_call><function=toDoWrite><parameter=goal>Find info</parameter></function></tool_call>
<tool_call><function=searchGlobal><parameter=query>test query</parameter><parameter=limit>10</parameter></function></tool_call>`);

    expect(result).toHaveLength(2);
    expect(result[0].function.name).toBe('toDoWrite');
    expect(result[1].function.name).toBe('searchGlobal');
    expect(JSON.parse(result[1].function.arguments)).toEqual({
      query: 'test query',
      limit: 10,
    });
  });

  it('parses JSON array and object parameters', () => {
    const result = parseXmlToolCalls(`
<tool_call>
<function=toDoWrite>
<parameter=goal>Determine requirement</parameter>
<parameter=subTasks>[{"id":"search_info","status":"pending","toolsRequired":["searchGlobal"]}]</parameter>
<parameter=metadata>{"source":"docs","count":1}</parameter>
</function>
</tool_call>`);

    const args = JSON.parse(result[0].function.arguments);
    expect(args.goal).toBe('Determine requirement');
    expect(args.subTasks).toEqual([
      { id: 'search_info', status: 'pending', toolsRequired: ['searchGlobal'] },
    ]);
    expect(args.metadata).toEqual({ source: 'docs', count: 1 });
  });

  it('parses boolean parameters', () => {
    const result = parseXmlToolCalls(`
<tool_call>
<function=setFlag>
<parameter=enabled>true</parameter>
<parameter=verbose>false</parameter>
</function>
</tool_call>`);

    expect(JSON.parse(result[0].function.arguments)).toEqual({
      enabled: true,
      verbose: false,
    });
  });

  it('returns an empty array when no tool calls are present', () => {
    expect(parseXmlToolCalls('Normal text.')).toEqual([]);
  });

  it('generates deterministic IDs', () => {
    const text = '<tool_call><function=search><parameter=q>test</parameter></function></tool_call>';

    expect(parseXmlToolCalls(text)[0].id).toBe(parseXmlToolCalls(text)[0].id);
  });

  it('assigns unique deterministic IDs to duplicate identical tool calls', () => {
    const text = `
<tool_call><function=search><parameter=q>test</parameter></function></tool_call>
<tool_call><function=search><parameter=q>test</parameter></function></tool_call>`;

    const firstParse = parseXmlToolCalls(text);
    const secondParse = parseXmlToolCalls(text);

    expect(firstParse).toHaveLength(2);
    expect(firstParse[0].id).not.toBe(firstParse[1].id);
    expect(firstParse[0].id).toBe(secondParse[0].id);
    expect(firstParse[1].id).toBe(secondParse[1].id);
  });
});

describe('stripXmlToolCalls', () => {
  it('removes tool call XML and leaves surrounding text', () => {
    const result = stripXmlToolCalls(`Here is my plan.
<tool_call>
<function=search>
<parameter=q>test</parameter>
</function>
</tool_call>`);

    expect(result).toBe('Here is my plan.');
  });

  it('removes multiple tool call blocks', () => {
    const result = stripXmlToolCalls(
      'Intro.<tool_call><function=a><parameter=x>1</parameter></function></tool_call> Middle. <tool_call><function=b><parameter=y>2</parameter></function></tool_call> End.',
    );

    expect(result).toBe('Intro. Middle.  End.');
  });

  it('returns text unchanged when there are no tool calls', () => {
    expect(stripXmlToolCalls('No tool calls here.')).toBe('No tool calls here.');
  });
});

describe('makeGenericOpenAIProvider', () => {
  const originalFetch = global.fetch;

  const makeState = (): RunState<Record<string, never>> => ({
    runId: 'run-1' as any,
    traceId: 'trace-1' as any,
    messages: [{ role: 'user', content: 'Hello' }],
    currentAgentName: 'TestAgent',
    context: {},
    turnCount: 0,
  });

  const makeAgent = (): Agent<Record<string, never>, string> => ({
    name: 'TestAgent',
    instructions: () => 'You are a test agent.',
    tools: [
      {
        schema: {
          name: 'searchGlobal',
          description: 'Search globally',
          parameters: z.object({ query: z.string() }),
        },
        execute: async () => 'result',
      },
    ],
    modelConfig: { name: 'nemotron-3-120b-a12b-bf16' },
  });

  const makeConfig = (
    provider: ReturnType<typeof makeGenericOpenAIProvider<Record<string, never>>>,
  ): RunConfig<Record<string, never>> => ({
    agentRegistry: new Map([['TestAgent', makeAgent()]]),
    modelProvider: provider,
  });

  const mockFetch = (responseBody: unknown, status = 200) => {
    global.fetch = jest.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    } as Response));
  };

  const mockStreamFetch = (sseChunks: string[], status = 200) => {
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

    global.fetch = jest.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      body,
      text: async () => 'stream error',
    } as Response));
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('getCompletion', () => {
    it('parses thinking and XML tool calls from content', async () => {
      mockFetch({
        id: 'chatcmpl-test',
        created: 1777533657,
        model: 'nemotron-3-120b-a12b-bf16',
        choices: [
          {
            message: {
              role: 'assistant',
              content: `We need a tool.

</think>
<tool_call>
<function=toDoWrite>
<parameter=goal>Find the answer</parameter>
<parameter=subTasks>[{"id":"s1","description":"Search","status":"pending","toolsRequired":["searchGlobal"]}]</parameter>
</function>
</tool_call>`,
              tool_calls: [],
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });

      const provider = makeGenericOpenAIProvider('test-key', { baseURL: 'https://test.api/v1' });
      const result = await provider.getCompletion(makeState(), makeAgent(), makeConfig(provider));

      expect(result.message?.content).toBe('');
      expect(result.message?.tool_calls).toHaveLength(1);
      expect(result.message?.tool_calls?.[0].function.name).toBe('toDoWrite');
      expect(JSON.parse(result.message!.tool_calls![0].function.arguments)).toMatchObject({
        goal: 'Find the answer',
      });
      expect((result as any).usage.total_tokens).toBe(150);
      expect((result as any).thinking).toBe('We need a tool.');
    });

    it('handles plain text responses', async () => {
      mockFetch({
        id: 'chatcmpl-plain',
        model: 'nemotron-3-120b-a12b-bf16',
        choices: [{ message: { role: 'assistant', content: 'The answer is 42.' } }],
      });

      const provider = makeGenericOpenAIProvider('test-key', { baseURL: 'https://test.api/v1' });
      const result = await provider.getCompletion(makeState(), makeAgent(), makeConfig(provider));

      expect(result.message?.content).toBe('The answer is 42.');
      expect(result.message?.tool_calls).toBeUndefined();
    });

    it('falls back to native tool calls when no XML tool calls are present', async () => {
      mockFetch({
        id: 'chatcmpl-native',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: { name: 'searchGlobal', arguments: '{"query":"test"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });

      const provider = makeGenericOpenAIProvider('test-key', { baseURL: 'https://test.api/v1' });
      const result = await provider.getCompletion(makeState(), makeAgent(), makeConfig(provider));

      expect(result.message?.tool_calls).toEqual([
        {
          id: 'call_abc123',
          type: 'function',
          function: { name: 'searchGlobal', arguments: '{"query":"test"}' },
        },
      ]);
    });

    it('sends an OpenAI-compatible request body', async () => {
      mockFetch({
        id: 'chatcmpl-plain',
        model: 'nemotron-3-120b-a12b-bf16',
        choices: [{ message: { role: 'assistant', content: 'Done.' } }],
      });

      const provider = makeGenericOpenAIProvider('test-key', {
        baseURL: 'https://test.api/v1/',
        defaultHeaders: { 'X-Custom': 'header' },
      });
      await provider.getCompletion(makeState(), makeAgent(), makeConfig(provider));

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as MockedFetch).mock.calls[0];
      expect(url).toBe('https://test.api/v1/chat/completions');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-key');
      expect(options.headers['X-Custom']).toBe('header');

      const body = JSON.parse(options.body);
      expect(body.model).toBe('nemotron-3-120b-a12b-bf16');
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are a test agent.' },
        { role: 'user', content: 'Hello' },
      ]);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].function.name).toBe('searchGlobal');
      expect(body.tools[0].function.parameters).toMatchObject({
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      });
    });

    it('allows custom schema conversion and request body customization', async () => {
      mockFetch({
        id: 'chatcmpl-custom',
        model: 'rewritten-model',
        choices: [{ message: { role: 'assistant', content: 'Done.' } }],
      });

      const schemaConverter = jest.fn(() => ({
        type: 'object',
        properties: { custom: { type: 'string' } },
      }));

      const provider = makeGenericOpenAIProvider('test-key', {
        baseURL: 'https://test.api/v1',
        schemaConverter,
        customizeRequestBody: (body, context) => ({
          ...body,
          model: `rewritten-${context.model}`,
          parallel_tool_calls: false,
        }),
      });

      await provider.getCompletion(makeState(), makeAgent(), makeConfig(provider));

      const [, options] = (global.fetch as MockedFetch).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.model).toBe('rewritten-nemotron-3-120b-a12b-bf16');
      expect(body.parallel_tool_calls).toBe(false);
      expect(body.tools[0].function.parameters).toEqual({
        type: 'object',
        properties: { custom: { type: 'string' } },
      });
      expect(schemaConverter).toHaveBeenCalledTimes(1);
    });

    it('preserves OpenAI-compatible content parts on user messages', async () => {
      mockFetch({
        id: 'chatcmpl-multimodal',
        model: 'nemotron-3-120b-a12b-bf16',
        choices: [{ message: { role: 'assistant', content: 'Saw it.' } }],
      });

      const state: RunState<Record<string, never>> = {
        ...makeState(),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
            ],
          },
        ],
      };

      const provider = makeGenericOpenAIProvider('test-key', { baseURL: 'https://test.api/v1' });
      await provider.getCompletion(state, makeAgent(), makeConfig(provider));

      const [, options] = (global.fetch as MockedFetch).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.messages[1]).toEqual({
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        ],
      });
    });

    it('preserves synthetic assistant tool context before the first model call', async () => {
      mockFetch({
        id: 'chatcmpl-synthetic-context',
        model: 'nemotron-3-120b-a12b-bf16',
        choices: [{ message: { role: 'assistant', content: 'Continuing from seeded context.' } }],
      });

      const state: RunState<Record<string, never>> = {
        ...makeState(),
        messages: [
          { role: 'user', content: 'Continue the seeded workflow.' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_seed_1',
                type: 'function',
                function: {
                  name: 'searchGlobal',
                  arguments: '{"query":"seeded search"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            content: '{"status":"executed","result":"seed result"}',
            tool_call_id: 'call_seed_1',
          },
        ],
      };

      const provider = makeGenericOpenAIProvider('test-key', { baseURL: 'https://test.api/v1' });
      await provider.getCompletion(state, makeAgent(), makeConfig(provider));

      const [, options] = (global.fetch as MockedFetch).mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.messages).toEqual([
        { role: 'system', content: 'You are a test agent.' },
        { role: 'user', content: 'Continue the seeded workflow.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_seed_1',
              type: 'function',
              function: {
                name: 'searchGlobal',
                arguments: '{"query":"seeded search"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          content: '{"status":"executed","result":"seed result"}',
          tool_call_id: 'call_seed_1',
        },
      ]);
      expect(body.tool_choice).toBe('auto');
    });

    it('converts complex nested tool schemas into OpenAI-compatible parameters', async () => {
      mockFetch({
        id: 'chatcmpl-complex-schema',
        model: 'nemotron-3-120b-a12b-bf16',
        choices: [{ message: { role: 'assistant', content: 'Done.' } }],
      });

      const complexAgent: Agent<Record<string, never>, string> = {
        name: 'ComplexAgent',
        instructions: () => 'Use the nested tool schema.',
        tools: [
          {
            schema: {
              name: 'complexTool',
              description: 'A complex nested tool',
              parameters: z.object({
                merchantId: z.string(),
                mode: z.enum(['fast', 'deep']),
                filters: z.array(z.object({
                  field: z.string(),
                  values: z.array(z.string()),
                })),
                options: z.object({
                  dryRun: z.boolean(),
                  thresholds: z.object({
                    minScore: z.number(),
                    maxResults: z.number().optional(),
                  }),
                }),
                metadata: z.record(z.string()).optional(),
              }),
            },
            execute: async () => 'ok',
          },
        ],
        modelConfig: { name: 'nemotron-3-120b-a12b-bf16' },
      };

      const provider = makeGenericOpenAIProvider('test-key', { baseURL: 'https://test.api/v1' });
      const config: RunConfig<Record<string, never>> = {
        agentRegistry: new Map([[complexAgent.name, complexAgent]]),
        modelProvider: provider,
      };

      await provider.getCompletion(makeState(), complexAgent, config);

      const [, options] = (global.fetch as MockedFetch).mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.tools[0].function.parameters).toEqual({
        type: 'object',
        properties: {
          merchantId: { type: 'string' },
          mode: { type: 'string', enum: ['fast', 'deep'] },
          filters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                values: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['field', 'values'],
              additionalProperties: false,
            },
          },
          options: {
            type: 'object',
            properties: {
              dryRun: { type: 'boolean' },
              thresholds: {
                type: 'object',
                properties: {
                  minScore: { type: 'number' },
                  maxResults: { type: 'number' },
                },
                required: ['minScore'],
                additionalProperties: false,
              },
            },
            required: ['dryRun', 'thresholds'],
            additionalProperties: false,
          },
          metadata: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['merchantId', 'mode', 'filters', 'options'],
        additionalProperties: false,
      });
    });

    it('uses an external abort signal for requests', async () => {
      const controller = new AbortController();
      global.fetch = jest.fn(
        async (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('aborted by external signal'));
            });
            controller.abort();
          }),
      );

      const provider = makeGenericOpenAIProvider('test-key', {
        baseURL: 'https://test.api/v1',
        getAbortSignal: () => controller.signal,
      });

      await expect(provider.getCompletion(makeState(), makeAgent(), makeConfig(provider)))
        .rejects
        .toThrow('aborted by external signal');

      const [, options] = (global.fetch as MockedFetch).mock.calls[0];
      expect(options.signal?.aborted).toBe(true);
    });

    it('throws on non-OK responses', async () => {
      mockFetch({ error: 'Unauthorized' }, 401);
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const provider = makeGenericOpenAIProvider('bad-key', { baseURL: 'https://test.api/v1' });

      try {
        await expect(provider.getCompletion(makeState(), makeAgent(), makeConfig(provider)))
          .rejects
          .toThrow('GenericOpenAI API error 401');
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe('getCompletionStream', () => {
    it('buffers thinking and yields only clean content', async () => {
      mockStreamFetch([
        'data: {"choices":[{"delta":{"content":"Let me think"},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"content":" about this."},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"content":"\\n\\n</think>\\n"},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Here is the answer."},"index":0}]}\n\n',
        'data: {"choices":[{"index":0,"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]);

      const provider = makeGenericOpenAIProvider('key', { baseURL: 'https://test.api/v1' });
      const deltas: string[] = [];
      let isDone = false;

      for await (const chunk of provider.getCompletionStream!(makeState(), makeAgent(), makeConfig(provider))) {
        if (chunk.delta) deltas.push(chunk.delta);
        if (chunk.isDone) isDone = true;
      }

      expect(deltas.join('')).toBe('Here is the answer.');
      expect(isDone).toBe(true);
    });

    it('does not leak split XML tool call markup into content', async () => {
      mockStreamFetch([
        'data: {"choices":[{"delta":{"content":"Thinking"},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"content":"</think>Intro. <to"},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"content":"ol_call><function=searchGlobal><parameter=query>test"},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"content":"</parameter></function></tool_call> Done."},"index":0}]}\n\n',
        'data: {"choices":[{"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
        'data: [DONE]\n\n',
      ]);

      const provider = makeGenericOpenAIProvider('key', { baseURL: 'https://test.api/v1' });
      const deltas: string[] = [];
      const toolCallDeltas: any[] = [];
      let finalChunk: any;

      for await (const chunk of provider.getCompletionStream!(makeState(), makeAgent(), makeConfig(provider))) {
        if (chunk.delta) deltas.push(chunk.delta);
        if (chunk.toolCallDelta) toolCallDeltas.push(chunk.toolCallDelta);
        if (chunk.isDone) finalChunk = chunk;
      }

      const content = deltas.join('');
      expect(content).toBe('Intro.  Done.');
      expect(content).not.toContain('<tool_call>');
      expect(content).not.toContain('<to');
      expect(toolCallDeltas).toHaveLength(1);
      expect(toolCallDeltas[0].function.name).toBe('searchGlobal');
      expect(JSON.parse(toolCallDeltas[0].function.argumentsDelta)).toEqual({ query: 'test' });
      expect(finalChunk.usage.total_tokens).toBe(15);
    });

    it('handles responses without thinking tags', async () => {
      mockStreamFetch([
        'data: {"choices":[{"delta":{"content":"Direct answer."},"index":0}]}\n\n',
        'data: {"choices":[{"index":0,"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]);

      const provider = makeGenericOpenAIProvider('key', { baseURL: 'https://test.api/v1' });
      const deltas: string[] = [];

      for await (const chunk of provider.getCompletionStream!(makeState(), makeAgent(), makeConfig(provider))) {
        if (chunk.delta) deltas.push(chunk.delta);
      }

      expect(deltas.join('')).toBe('Direct answer.');
    });

    it('passes through native tool call deltas', async () => {
      mockStreamFetch([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":""}}]},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":"}}]},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"test\\"}"}}]},"index":0}]}\n\n',
        'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]);

      const provider = makeGenericOpenAIProvider('key', { baseURL: 'https://test.api/v1' });
      const toolCallDeltas: any[] = [];

      for await (const chunk of provider.getCompletionStream!(makeState(), makeAgent(), makeConfig(provider))) {
        if (chunk.toolCallDelta) toolCallDeltas.push(chunk.toolCallDelta);
      }

      expect(toolCallDeltas).toHaveLength(3);
      expect(toolCallDeltas[0].id).toBe('call_1');
      expect(toolCallDeltas[0].function.name).toBe('search');
      expect(toolCallDeltas.map(delta => delta.function.argumentsDelta).join('')).toBe('{"q":"test"}');
    });
  });
});
