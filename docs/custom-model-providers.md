# Writing a Custom Model Provider

This guide explains how to build a custom model provider for JAF. It focuses on implementing the `ModelProvider` contract, mapping JAF messages to your LLM API, supporting tools and streaming, and wiring the provider into `run` or `runServer`.

If you are looking for general model provider usage, see `docs/model-providers.md`. This guide is specifically for building your own provider.

## When to build a custom provider

Create a custom provider when you need to:
- Integrate a model API that is not supported by LiteLLM.
- Add custom authentication, routing, or rate limiting.
- Control message formatting or streaming behavior.
- Implement a local model or private gateway.

## Provider contract

JAF calls your provider with a run state, the current agent, and the run config. You must return a response with a `message` containing either text, tool calls, or both.

```typescript
export type CompletionStreamChunk = {
  readonly delta?: string;
  readonly toolCallDelta?: {
    readonly index: number;
    readonly id?: string;
    readonly type: 'function';
    readonly function?: {
      readonly name?: string;
      readonly argumentsDelta?: string;
    };
  };
  readonly isDone?: boolean;
  readonly finishReason?: string | null;
  readonly raw?: any;
};

export interface ModelProvider<Ctx> {
  isAiSdkProvider?: boolean;
  getCompletion: (
    state: Readonly<RunState<Ctx>>,
    agent: Readonly<Agent<Ctx, any>>,
    config: Readonly<RunConfig<Ctx>>
  ) => Promise<{
    message?: {
      content?: string | null;
      tool_calls?: readonly ToolCall[];
    };
  }>;
  getCompletionStream?: (
    state: Readonly<RunState<Ctx>>,
    agent: Readonly<Agent<Ctx, any>>,
    config: Readonly<RunConfig<Ctx>>
  ) => AsyncGenerator<CompletionStreamChunk, void, unknown>;
}
```

Key points:
- `getCompletion` is required.
- `getCompletionStream` is optional but enables streaming in the engine and server.
- If your provider does not use a string model name, set `isAiSdkProvider: true` to bypass the "No model configured" check.

## Step 1: Start with a minimal provider

```typescript
import { getTextContent } from '@xynehq/jaf';
import type {
  ModelProvider,
  RunState,
  Agent,
  RunConfig,
  Message,
  Tool,
  ToolCall,
} from '@xynehq/jaf';

type ProviderOptions = {
  baseUrl: string;
  apiKey: string;
};

export const createCustomProvider = <Ctx>(
  opts: ProviderOptions,
): ModelProvider<Ctx> => ({
  async getCompletion(state, agent, config) {
    const model = agent.modelConfig?.name ?? config.modelOverride;
    if (!model) {
      throw new Error(`Model not specified for agent ${agent.name}`);
    }

    const system = agent.instructions(state);
    const messages = [
      { role: 'system', content: system },
      ...state.messages.map(toProviderMessage),
    ];

    const body = {
      model,
      messages,
      temperature: agent.modelConfig?.temperature,
      max_tokens: agent.modelConfig?.maxTokens,
      tools: toProviderTools(agent.tools),
    };

    const response = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Model API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      message: {
        content: data.choices?.[0]?.message?.content ?? null,
        tool_calls: data.choices?.[0]?.message?.tool_calls,
      },
      usage: data.usage,
      model: data.model,
      id: data.id,
      created: data.created,
    };
  },
});
```

Notes:
- JAF expects `tool_calls[].function.arguments` to be a JSON string. Use `JSON.stringify` when you create tool calls yourself.
- The built-in LiteLLM provider uses `agent.modelConfig?.name ?? config.modelOverride`. If you want a global override to win, flip the order.
- Any extra fields you return (like `usage`) are passed through to tracing events.

## Step 2: Convert JAF messages to your API format

JAF messages have three roles: `user`, `assistant`, and `tool`. Tool results appear as messages with role `tool` and a `tool_call_id`.

```typescript
function toProviderMessage(msg: Message) {
  switch (msg.role) {
    case 'user':
      return {
        role: 'user',
        content: getTextContent(msg.content),
      };
    case 'assistant':
      return {
        role: 'assistant',
        content: getTextContent(msg.content),
        tool_calls: msg.tool_calls,
      };
    case 'tool':
      return {
        role: 'tool',
        content: getTextContent(msg.content),
        tool_call_id: msg.tool_call_id,
      };
  }
}
```

If your API supports multipart messages (text, images, files), you can pass through `MessageContentPart[]` and attachments (see "Attachments and multimodal content" below).

## Step 3: Convert tools to your provider schema

JAF tools are defined with Zod schemas. Many model APIs expect JSON Schema for function definitions. You can:
- Use a JSON Schema converter (for example, `zod-to-json-schema`).
- Copy the minimal converter used in `src/providers/model.ts`.

```typescript
function toProviderTools(tools?: readonly Tool<any, any>[]) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.schema.name,
      description: tool.schema.description,
      parameters: zodToJsonSchema(tool.schema.parameters), // use your converter
    },
  }));
}
```

Tool call responses must follow this shape:

```typescript
const toolCalls: ToolCall[] = [
  {
    id: 'call_0',
    type: 'function',
    function: {
      name: 'search_docs',
      arguments: JSON.stringify({ query: 'payment retries' }),
    },
  },
];
```

## Step 4: Support structured outputs (outputCodec)

If `agent.outputCodec` is set, the engine will parse `message.content` as JSON. Your provider should:
- Use JSON mode or schema mode if your API supports it.
- Ensure `message.content` is valid JSON for that schema.

If you ignore this, JAF will return a `DecodeError` when it tries to parse the response.

## Step 5: Implement streaming (optional)

Implement `getCompletionStream` to send streaming deltas to JAF. The engine will accumulate deltas and emit `assistant_message` events with partial content.

```typescript
async function* streamToJafChunks(stream: AsyncIterable<any>) {
  for await (const chunk of stream) {
    if (chunk.textDelta) {
      yield { delta: chunk.textDelta, raw: chunk };
    }
    if (chunk.toolDelta) {
      yield {
        toolCallDelta: {
          index: chunk.toolDelta.index,
          id: chunk.toolDelta.id,
          type: 'function',
          function: {
            name: chunk.toolDelta.name,
            argumentsDelta: chunk.toolDelta.argumentsDelta,
          },
        },
        raw: chunk,
      };
    }
    if (chunk.done) {
      yield { isDone: true, finishReason: chunk.finishReason, raw: chunk };
    }
  }
}
```

Important details:
- Use `toolCallDelta.index` to indicate which tool call is being built.
- Send `argumentsDelta` as a string fragment; the engine concatenates them.

## Step 6: Attachments and multimodal content

JAF messages can include:
- `content` as `MessageContentPart[]` (text, image_url, file)
- `attachments` with images or documents

If your API supports OpenAI-style multipart inputs, you can map these directly. For a reference implementation, see:
- `src/providers/model.ts` (functions `convertContentPart` and `buildChatMessageWithAttachments`)

If your provider does not support images or documents, you can still:
- Use `getTextContent(msg.content)` to include any text.
- Ignore attachments or convert them to text placeholders.

## Step 7: Error handling and metadata

Best practices:
- Throw on HTTP errors or invalid responses. The engine will surface the error.
- Include `usage`, `model`, and `id` in the returned object if available. JAF uses these for tracing.
- Add your own logging around API calls when debugging (but avoid logging secrets).

## Step 8: Wire the provider into JAF

Use it with `run`:

```typescript
const agentRegistry = new Map([[agent.name, agent]]);
const modelProvider = createCustomProvider<MyContext>({
  baseUrl: process.env.CUSTOM_BASE_URL!,
  apiKey: process.env.CUSTOM_API_KEY!,
});

const config: RunConfig<MyContext> = {
  agentRegistry,
  modelProvider,
  modelOverride: 'my-model',
  maxTurns: 6,
};
```

Or with `runServer`:

```typescript
const server = await runServer(
  [agent],
  {
    modelProvider,
    modelOverride: 'my-model',
    maxTurns: 6,
  },
  { port: 3000 },
);
```

## Step 9: Test your provider

A lightweight provider stub is often enough for unit tests:

```typescript
const provider: ModelProvider<any> = {
  async getCompletion(state) {
    const last = state.messages[state.messages.length - 1];
    if (last.role !== 'tool') {
      return {
        message: {
          tool_calls: [
            {
              id: 'call_0',
              type: 'function',
              function: { name: 'ping', arguments: JSON.stringify({ ok: true }) },
            },
          ],
        },
      };
    }
    return { message: { content: 'done' } };
  },
};
```

## Checklist

Before shipping your provider, confirm:
- You return a `message` with either `content` or `tool_calls`.
- Tool call arguments are JSON strings.
- You respect `config.modelOverride` and `agent.modelConfig`.
- You handle `outputCodec` by returning valid JSON.
- Streaming deltas are aligned to `CompletionStreamChunk`.
- Errors are thrown and not silently swallowed.
