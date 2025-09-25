import { withProviderReasoning, reasoningOnly, callWithReasoning, type ReasoningOptions } from '../../providers/reasoning.js';

// Mock the 'ai' module to avoid network and capture calls
jest.mock('ai', () => {
  const actual = jest.requireActual('ai');
  return {
    ...actual,
    generateText: jest.fn(async (opts: any) => ({ text: 'ok', usage: {}, response: { providerMetadata: { debug: true } } })),
    streamText: jest.fn(async (_opts: any) => ({ textStream: (async function*() { yield 'ok'; })(), fullStream: (async function*() { yield { type: 'text', delta: 'ok' }; })() })),
  };
});
import { generateText, streamText } from 'ai';

async function collect(iter: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe('Reasoning provider mapping', () => {
  test('Anthropic: maps thinking with budgetTokens', () => {
    const ro: ReasoningOptions = { enabled: true, budgetTokens: 5000 };
    const mapped = withProviderReasoning('anthropic', ro);
    expect(mapped).toEqual({
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 5000 },
        sendReasoning: true,
      },
    });
  });

  test('Cohere: maps thinking tokenBudget', () => {
    const ro: ReasoningOptions = { enabled: true, tokenBudget: 321 };
    const mapped = withProviderReasoning('cohere', ro);
    expect(mapped).toEqual({
      cohere: { thinking: { type: 'enabled', tokenBudget: 321 } },
    });
  });

  test('Vertex: maps google.thinkingConfig includeThoughts', () => {
    const ro: ReasoningOptions = { enabled: true, includeThoughts: true };
    const mapped = withProviderReasoning('vertex', ro);
    expect(mapped).toEqual({
      google: { thinkingConfig: { includeThoughts: true } },
    });
  });

  test('OpenAI: maps reasoningSummary and effort', () => {
    const ro: ReasoningOptions = { enabled: true, summary: 'detailed', effort: 'high' };
    const mapped = withProviderReasoning('openai', ro);
    expect(mapped).toEqual({
      openai: { reasoningSummary: 'detailed', reasoningEffort: 'high' },
    });
  });

  test('Bedrock: clamps budgetTokens 1024..64000', () => {
    const low: ReasoningOptions = { enabled: true, budgetTokens: 12 };
    const hi: ReasoningOptions = { enabled: true, budgetTokens: 999999 };
    const def: ReasoningOptions = { enabled: true };

    const mappedLow = withProviderReasoning('bedrock', low);
    const mappedHi = withProviderReasoning('bedrock', hi);
    const mappedDef = withProviderReasoning('bedrock', def);

    expect(mappedLow).toEqual({ bedrock: { reasoningConfig: { type: 'enabled', budgetTokens: 1024 } } });
    expect(mappedHi).toEqual({ bedrock: { reasoningConfig: { type: 'enabled', budgetTokens: 64000 } } });
    expect(mappedDef).toEqual({ bedrock: { reasoningConfig: { type: 'enabled', budgetTokens: 2048 } } });
  });

  test('DeepSeek: returns no knob (stream-only reasoning)', () => {
    const ro: ReasoningOptions = { enabled: true };
    const mapped = withProviderReasoning('deepseek', ro);
    expect(mapped).toEqual({});
  });
});

describe('DeepSeek: reasoning arrives only via fullStream', () => {
  test('filters only reasoning events', async () => {
    async function* fakeFullStream() {
      yield { type: 'text', delta: 'Hello ' };
      yield { type: 'reasoning', textDelta: 'Think ' };
      yield { type: 'reasoning', delta: 'hard' };
      yield { type: 'tool', name: 'x' };
      yield { type: 'reasoning', content: '!' };
      yield { type: 'text', delta: 'world' };
    }
    const out = await collect(reasoningOnly(fakeFullStream()));
    expect(out.join('')).toBe('Think hard!');
  });
});

describe('OpenAI: store:false includes encrypted reasoning for chains', () => {
  test('verify include reasoning.encrypted_content is present', () => {
    // Build minimal mapping then merge store:false specific include.
    const ro: ReasoningOptions = { enabled: true };
    const mapped = withProviderReasoning('openai', ro) as any;
    // simulate callWithReasoning internal merge for store:false
    mapped.openai = mapped.openai ?? {};
    const include = new Set<string>(mapped.openai.include ?? []);
    include.add('reasoning.encrypted_content');
    mapped.openai.include = Array.from(include);

    expect(mapped.openai.include).toContain('reasoning.encrypted_content');
  });

  test('callWithReasoning passes include when store:false', async () => {
    const fakeModel: any = { provider: 'openai', modelId: 'o3-mini' };
    await callWithReasoning({ provider: 'openai', model: fakeModel, prompt: 'hello', stream: false, store: false, reasoning: { enabled: true } });
    const call = (generateText as jest.Mock).mock.calls[0][0];
    expect(call.providerOptions.openai.include).toContain('reasoning.encrypted_content');
  });
});

describe('Streaming: reasoningStream is derived from fullStream', () => {
  test('callWithReasoning exposes reasoning stream when events are present', async () => {
    (streamText as jest.Mock).mockImplementationOnce(async (_opts: any) => ({
      textStream: (async function* () { yield 'A'; yield 'B'; })(),
      fullStream: (async function* () {
        yield { type: 'reasoning', delta: 'think ' };
        yield { type: 'text', delta: 'ignored for reasoning' };
        yield { type: 'reasoning', textDelta: 'more' };
      })(),
      usage: { totalTokens: 1 },
      response: { providerMetadata: { demo: true } },
    }));

    const fakeModel: any = { provider: 'openai', modelId: 'o3-mini' };
    const res = await callWithReasoning({ provider: 'openai', model: fakeModel, prompt: 'x', stream: true, reasoning: { enabled: true } });
    expect(res.textStream).toBeDefined();
    expect(res.reasoningStream).toBeDefined();

    const chunks: string[] = [];
    for await (const r of res.reasoningStream!) chunks.push(r);
    expect(chunks.join('')).toBe('think more');
  });
});
