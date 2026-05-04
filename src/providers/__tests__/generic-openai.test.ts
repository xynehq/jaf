import {
  parseThinkingContent,
  parseXmlToolCalls,
  stripXmlToolCalls,
  makeGenericOpenAIProvider,
} from '../generic-openai';
import type { RunState, Agent, RunConfig, ToolCall } from '../../core/types';
import { z } from 'zod';

// ========== Unit Tests: Parsers ==========

describe('parseThinkingContent', () => {
  it('should separate thinking from content when </think> is present', () => {
    const raw = 'I need to search for this.\n\n</think>\nHere is the answer.';
    const result = parseThinkingContent(raw);
    expect(result.thinking).toBe('I need to search for this.');
    expect(result.content).toBe('Here is the answer.');
  });

  it('should return null thinking when no </think> tag', () => {
    const raw = 'Just a normal response with no thinking.';
    const result = parseThinkingContent(raw);
    expect(result.thinking).toBeNull();
    expect(result.content).toBe('Just a normal response with no thinking.');
  });

  it('should handle </think> at the very beginning', () => {
    const raw = '</think>\nActual content here.';
    const result = parseThinkingContent(raw);
    expect(result.thinking).toBeNull(); // empty string becomes null
    expect(result.content).toBe('Actual content here.');
  });

  it('should handle </think> at the very end', () => {
    const raw = 'All thinking, no content.</think>';
    const result = parseThinkingContent(raw);
    expect(result.thinking).toBe('All thinking, no content.');
    expect(result.content).toBe('');
  });

  it('should handle multi-line thinking content', () => {
    const raw = 'Step 1: analyze\nStep 2: plan\nStep 3: execute\n\n</think>\nFinal answer.';
    const result = parseThinkingContent(raw);
    expect(result.thinking).toBe('Step 1: analyze\nStep 2: plan\nStep 3: execute');
    expect(result.content).toBe('Final answer.');
  });

  it('should handle empty string', () => {
    const result = parseThinkingContent('');
    expect(result.thinking).toBeNull();
    expect(result.content).toBe('');
  });
});

describe('parseXmlToolCalls', () => {
  it('should parse a single tool call', () => {
    const text = `
<tool_call>
<function=searchGlobal>
<parameter=query>Platform Credential Generation</parameter>
</function>
</tool_call>`;
    const result = parseXmlToolCalls(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('searchGlobal');
    const args = JSON.parse(result[0].function.arguments);
    expect(args.query).toBe('Platform Credential Generation');
  });

  it('should parse multiple tool calls', () => {
    const text = `
<tool_call>
<function=toDoWrite>
<parameter=goal>Find info</parameter>
</function>
</tool_call>
<tool_call>
<function=searchGlobal>
<parameter=query>test query</parameter>
<parameter=limit>10</parameter>
</function>
</tool_call>`;
    const result = parseXmlToolCalls(text);
    expect(result).toHaveLength(2);
    expect(result[0].function.name).toBe('toDoWrite');
    expect(result[1].function.name).toBe('searchGlobal');
    const args1 = JSON.parse(result[1].function.arguments);
    expect(args1.limit).toBe(10);
  });

  it('should parse JSON array parameters', () => {
    const text = `
<tool_call>
<function=toDoWrite>
<parameter=goal>Determine requirement</parameter>
<parameter=subTasks>[{"id": "search_info", "description": "Search for info", "status": "pending", "toolsRequired": ["searchGlobal"]}]</parameter>
</function>
</tool_call>`;
    const result = parseXmlToolCalls(text);
    expect(result).toHaveLength(1);
    const args = JSON.parse(result[0].function.arguments);
    expect(args.goal).toBe('Determine requirement');
    expect(Array.isArray(args.subTasks)).toBe(true);
    expect(args.subTasks[0].id).toBe('search_info');
  });

  it('should parse boolean parameters', () => {
    const text = `
<tool_call>
<function=setFlag>
<parameter=enabled>true</parameter>
<parameter=verbose>false</parameter>
</function>
</tool_call>`;
    const result = parseXmlToolCalls(text);
    const args = JSON.parse(result[0].function.arguments);
    expect(args.enabled).toBe(true);
    expect(args.verbose).toBe(false);
  });

  it('should return empty array for text with no tool calls', () => {
    const result = parseXmlToolCalls('Just some normal text with no tools.');
    expect(result).toEqual([]);
  });

  it('should generate deterministic IDs', () => {
    const text = `<tool_call><function=search><parameter=q>test</parameter></function></tool_call>`;
    const result1 = parseXmlToolCalls(text);
    const result2 = parseXmlToolCalls(text);
    expect(result1[0].id).toBe(result2[0].id);
  });
});

describe('stripXmlToolCalls', () => {
  it('should remove tool call XML and leave surrounding text', () => {
    const text = `Here is my plan.\n<tool_call>\n<function=search>\n<parameter=q>test</parameter>\n</function>\n</tool_call>\n`;
    const result = stripXmlToolCalls(text);
    expect(result).toBe('Here is my plan.');
  });

  it('should handle multiple tool call blocks', () => {
    const text = `Intro text.<tool_call><function=a><parameter=x>1</parameter></function></tool_call> Middle. <tool_call><function=b><parameter=y>2</parameter></function></tool_call> End.`;
    const result = stripXmlToolCalls(text);
    expect(result).toBe('Intro text. Middle.  End.');
  });

  it('should return text unchanged if no tool calls', () => {
    const text = 'No tool calls here.';
    expect(stripXmlToolCalls(text)).toBe('No tool calls here.');
  });
});

// ========== Integration: Full Response Parsing (via getCompletion) ==========

describe('makeGenericOpenAIProvider', () => {
  // Mock the docs.txt response format
  const MOCK_RESPONSE_WITH_THINKING_AND_TOOLS = {
    id: 'chatcmpl-test123',
    object: 'chat.completion',
    created: 1777533657,
    model: 'nemotron-3-120b-a12b-bf16',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: 'We need to search for this info. Let me plan.\n\n</think>\n<tool_call>\n<function=toDoWrite>\n<parameter=goal>Find the answer</parameter>\n<parameter=subTasks>[{"id":"s1","description":"Search","status":"pending","toolsRequired":["searchGlobal"]}]</parameter>\n</function>\n</tool_call>\n',
        tool_calls: [],
        reasoning: null,
      },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };

  const MOCK_RESPONSE_PLAIN_TEXT = {
    id: 'chatcmpl-plain',
    object: 'chat.completion',
    created: 1777533657,
    model: 'nemotron-3-120b-a12b-bf16',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: 'The answer is 42.',
        tool_calls: [],
      },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
  };

  const MOCK_RESPONSE_NATIVE_TOOL_CALLS = {
    id: 'chatcmpl-native',
    object: 'chat.completion',
    created: 1777533657,
    model: 'gpt-4o',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call_abc123',
          type: 'function',
          function: { name: 'searchGlobal', arguments: '{"query":"test"}' },
        }],
      },
      finish_reason: 'tool_calls',
    }],
    usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
  };

  // Helpers
  const makeState = (): RunState<any> => ({
    runId: 'run-1' as any,
    traceId: 'trace-1' as any,
    messages: [{ role: 'user', content: 'Hello' }],
    currentAgentName: 'TestAgent',
    context: {},
    turnCount: 0,
  });

  const makeAgent = (): Agent<any, any> => ({
    name: 'TestAgent',
    instructions: () => 'You are a test agent.',
    tools: [{
      schema: {
        name: 'searchGlobal',
        description: 'Search globally',
        parameters: z.object({ query: z.string() }),
      },
      execute: async () => 'result',
    }],
    modelConfig: { name: 'nemotron-3-120b-a12b-bf16' },
  });

  const makeConfig = (provider: any): RunConfig<any> => ({
    agentRegistry: new Map([['TestAgent', makeAgent()]]),
    modelProvider: provider,
  });

  beforeEach(() => {
    // Reset fetch mock before each test
    (global as any).fetch = undefined;
  });

  afterEach(() => {
    delete (global as any).fetch;
  });

  function mockFetch(responseBody: any, status = 200) {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    });
  }

  // ---------- getCompletion tests ----------

  describe('getCompletion', () => {
    it('should parse thinking + XML tool calls from content (docs.txt format)', async () => {
      mockFetch(MOCK_RESPONSE_WITH_THINKING_AND_TOOLS);

      const provider = makeGenericOpenAIProvider('test-key', { baseURL: 'https://test.api/v1' });
      const result = await provider.getCompletion(makeState(), makeAgent(), makeConfig(provider));

      // Content should be clean — no thinking, no XML
      expect(result.message?.content).toBe('');
      // Tool calls should be parsed from XML
      expect(result.message?.tool_calls).toHaveLength(1);
      expect(result.message!.tool_calls![0].function.name).toBe('toDoWrite');
      const args = JSON.parse(result.message!.tool_calls![0].function.arguments);
      expect(args.goal).toBe('Find the answer');
      expect(Array.isArray(args.subTasks)).toBe(true);
    });

    it('should handle plain text response (no thinking, no tools)', async () => {
      mockFetch(MOCK_RESPONSE_PLAIN_TEXT);

      const provider = makeGenericOpenAIProvider('test-key', { baseURL: 'https://test.api/v1' });
      const result = await provider.getCompletion(makeState(), makeAgent(), makeConfig(provider));

      expect(result.message?.content).toBe('The answer is 42.');
      expect(result.message?.tool_calls).toBeUndefined();
    });

    it('should fall back to native tool_calls when no XML tool calls found', async () => {
      mockFetch(MOCK_RESPONSE_NATIVE_TOOL_CALLS);

      const provider = makeGenericOpenAIProvider('test-key', { baseURL: 'https://test.api/v1' });
      const result = await provider.getCompletion(makeState(), makeAgent(), makeConfig(provider));

      expect(result.message?.tool_calls).toHaveLength(1);
      expect(result.message!.tool_calls![0].id).toBe('call_abc123');
      expect(result.message!.tool_calls![0].function.name).toBe('searchGlobal');
    });

    it('should send correct request body structure', async () => {
      mockFetch(MOCK_RESPONSE_PLAIN_TEXT);

      const provider = makeGenericOpenAIProvider('test-key', {
        baseURL: 'https://test.api/v1',
        defaultHeaders: { 'X-Custom': 'header' },
      });
      await provider.getCompletion(makeState(), makeAgent(), makeConfig(provider));

      const fetchCall = (global as any).fetch;
      expect(fetchCall).toHaveBeenCalledTimes(1);

      const [url, options] = fetchCall.mock.calls[0];
      expect(url).toBe('https://test.api/v1/chat/completions');
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('Bearer test-key');
      expect(options.headers['X-Custom']).toBe('header');

      const body = JSON.parse(options.body);
      expect(body.model).toBe('nemotron-3-120b-a12b-bf16');
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[0].content).toBe('You are a test agent.');
      expect(body.messages[1].role).toBe('user');
      expect(body.messages[1].content).toBe('Hello');
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].function.name).toBe('searchGlobal');
    });

    it('should throw on non-OK response', async () => {
      mockFetch({ error: 'Unauthorized' }, 401);

      const provider = makeGenericOpenAIProvider('bad-key', { baseURL: 'https://test.api/v1' });

      await expect(
        provider.getCompletion(makeState(), makeAgent(), makeConfig(provider))
      ).rejects.toThrow('GenericOpenAI API error 401');
    });
  });

  // ---------- getCompletionStream tests ----------

  describe('getCompletionStream', () => {
    function mockStreamFetch(sseChunks: string[]) {
      const encoder = new TextEncoder();
      let chunkIndex = 0;

      const readableStream = new ReadableStream({
        pull(controller) {
          if (chunkIndex < sseChunks.length) {
            controller.enqueue(encoder.encode(sseChunks[chunkIndex]));
            chunkIndex++;
          } else {
            controller.close();
          }
        },
      });

      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: readableStream,
      });
    }

    it('should buffer thinking and only yield clean content', async () => {
      // Simulate SSE chunks: thinking text, then </think>, then clean content, then done
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Let me think"},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"content":" about this."},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"content":"\\n\\n</think>\\n"},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Here is the answer."},"index":0}]}\n\n',
        'data: {"choices":[{"index":0,"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockStreamFetch(sseChunks);

      const provider = makeGenericOpenAIProvider('key', { baseURL: 'https://test.api/v1' });
      const stream = provider.getCompletionStream!(makeState(), makeAgent(), makeConfig(provider));

      const deltas: string[] = [];
      const toolCallDeltas: any[] = [];
      let isDone = false;

      for await (const chunk of stream) {
        if (chunk.delta) deltas.push(chunk.delta);
        if (chunk.toolCallDelta) toolCallDeltas.push(chunk.toolCallDelta);
        if (chunk.isDone) isDone = true;
      }

      // Should NOT contain thinking text
      const fullContent = deltas.join('');
      expect(fullContent).not.toContain('Let me think');
      expect(fullContent).not.toContain('</think>');
      expect(fullContent).toContain('Here is the answer.');
      expect(isDone).toBe(true);
    });

    it('should emit tool calls as toolCallDeltas at stream end', async () => {
      // Content with thinking + XML tool call
      const content = 'Thinking...\n\n</think>\n<tool_call>\n<function=searchGlobal>\n<parameter=query>test</parameter>\n</function>\n</tool_call>\n';
      // Send it in one big chunk for simplicity
      const sseChunks = [
        `data: {"choices":[{"delta":{"content":${JSON.stringify(content)}},"index":0}]}\n\n`,
        'data: {"choices":[{"index":0,"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockStreamFetch(sseChunks);

      const provider = makeGenericOpenAIProvider('key', { baseURL: 'https://test.api/v1' });
      const stream = provider.getCompletionStream!(makeState(), makeAgent(), makeConfig(provider));

      const deltas: string[] = [];
      const toolCallDeltas: any[] = [];

      for await (const chunk of stream) {
        if (chunk.delta) deltas.push(chunk.delta);
        if (chunk.toolCallDelta) toolCallDeltas.push(chunk.toolCallDelta);
      }

      // Content should not have XML tool calls
      const fullContent = deltas.join('');
      expect(fullContent).not.toContain('<tool_call>');
      expect(fullContent).not.toContain('Thinking');

      // Should have one tool call delta
      expect(toolCallDeltas).toHaveLength(1);
      expect(toolCallDeltas[0].function.name).toBe('searchGlobal');
      const args = JSON.parse(toolCallDeltas[0].function.argumentsDelta);
      expect(args.query).toBe('test');
    });

    it('should handle response with no thinking (no </think> tag)', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Direct answer."},"index":0}]}\n\n',
        'data: {"choices":[{"index":0,"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockStreamFetch(sseChunks);

      const provider = makeGenericOpenAIProvider('key', { baseURL: 'https://test.api/v1' });
      const stream = provider.getCompletionStream!(makeState(), makeAgent(), makeConfig(provider));

      const deltas: string[] = [];
      for await (const chunk of stream) {
        if (chunk.delta) deltas.push(chunk.delta);
      }

      expect(deltas.join('')).toBe('Direct answer.');
    });

    it('should handle native tool call deltas from models that support them', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":""}}]},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":"}}]},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"test\\"}"}}]},"index":0}]}\n\n',
        'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockStreamFetch(sseChunks);

      const provider = makeGenericOpenAIProvider('key', { baseURL: 'https://test.api/v1' });
      const stream = provider.getCompletionStream!(makeState(), makeAgent(), makeConfig(provider));

      const toolCallDeltas: any[] = [];
      for await (const chunk of stream) {
        if (chunk.toolCallDelta) toolCallDeltas.push(chunk.toolCallDelta);
      }

      expect(toolCallDeltas.length).toBeGreaterThanOrEqual(3);
      expect(toolCallDeltas[0].id).toBe('call_1');
      expect(toolCallDeltas[0].function.name).toBe('search');
    });

    it('should capture usage from final stream chunk', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Hi"},"index":0}]}\n\n',
        'data: {"choices":[{"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
        'data: [DONE]\n\n',
      ];
      mockStreamFetch(sseChunks);

      const provider = makeGenericOpenAIProvider('key', { baseURL: 'https://test.api/v1' });
      const stream = provider.getCompletionStream!(makeState(), makeAgent(), makeConfig(provider));

      let finalChunk: any = null;
      for await (const chunk of stream) {
        if (chunk.isDone) finalChunk = chunk;
      }

      expect(finalChunk).not.toBeNull();
      expect(finalChunk.usage?.prompt_tokens).toBe(10);
      expect(finalChunk.usage?.completion_tokens).toBe(5);
    });
  });
});

// ========== End-to-end: Full docs.txt response format ==========

describe('docs.txt response format (end-to-end)', () => {
  it('should correctly parse the exact response from docs.txt', () => {
    // This is the actual content from docs.txt
    const rawContent = `We need to answer: "Find whether Platform Credential Generation is required before Service Subscription and explain why." This is likely about some system/platform, possibly related to enterprise software, maybe Salesforce? Or maybe "Platform Credential Generation" refers to something like generating platform credentials (API tokens, etc.) before subscribing to a service. Might be from some internal documentation.

We need to use tools if needed. We don't have any prior context. We need to search for information about "Platform Credential Generation required before Service Subscription". Let's search globally.

We'll start by creating a plan with toDoWrite. Then call searchGlobal.

Plan: Goal: Determine whether Platform Credential Generation is required before Service Subscription and explain why.

Subtasks: 1) Search for relevant information. 2) Analyze results. 3) Provide answer.

We need to call toDoWrite first. Then after that, we can call searchGlobal.

Let's do that.

</think>
<tool_call>
<function=toDoWrite>
<parameter=goal>
Determine whether Platform Credential Generation is required before Service Subscription and explain why.
</parameter>
<parameter=subTasks>
[{"id": "search_info", "description": "Search for information about Platform Credential Generation and Service Subscription requirements.", "status": "pending", "toolsRequired": ["searchGlobal"], "result": ""}, {"id": "analyze", "description": "Analyze search results to determine requirement and rationale.", "status": "pending", "toolsRequired": [], "result": ""}, {"id": "answer", "description": "Prepare final answer with explanation.", "status": "pending", "toolsRequired": [], "result": ""}]
</parameter>
</function>
</tool_call>
`;

    // Test thinking separation
    const { thinking, content } = parseThinkingContent(rawContent);
    expect(thinking).not.toBeNull();
    expect(thinking).toContain('We need to answer');
    expect(thinking).toContain("Let's do that.");
    expect(thinking).not.toContain('<tool_call>');

    // Test tool call parsing
    const toolCalls = parseXmlToolCalls(content);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].type).toBe('function');
    expect(toolCalls[0].function.name).toBe('toDoWrite');

    const args = JSON.parse(toolCalls[0].function.arguments);
    expect(args.goal).toContain('Platform Credential Generation');
    expect(Array.isArray(args.subTasks)).toBe(true);
    expect(args.subTasks).toHaveLength(3);
    expect(args.subTasks[0].id).toBe('search_info');
    expect(args.subTasks[0].toolsRequired).toContain('searchGlobal');

    // Test content stripping
    const cleanContent = stripXmlToolCalls(content);
    expect(cleanContent).not.toContain('<tool_call>');
    expect(cleanContent).not.toContain('<function=');
    expect(cleanContent).not.toContain('<parameter=');
  });
});
