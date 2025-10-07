# JAF Event Handlers - Quick Reference

## Import

```typescript
import {
  createSimpleEventHandler,
  type SimpleEventHandlers,
  type EventData,
  type TokenUsage,
  type TraceEvent
} from '@xynehq/jaf';
```

## Simple Event Handlers (Recommended)

```typescript
const handlers: SimpleEventHandlers = {
  // Called when assistant generates a message
  onAssistantMessage: (content: string, thinking?: string) => void;

  // Called when tools are requested
  onToolCalls: (calls: Array<{ id: string; name: string; args: any }>) => void;

  // Called when tool execution completes
  onToolResult: (toolName: string, result: string, error?: any) => void;

  // Called on errors
  onError: (error: any, context?: any) => void;

  // Called when run starts
  onRunStart: (runId: RunId, traceId: TraceId) => void;

  // Called when run ends
  onRunEnd: (outcome: RunResult<any>['outcome']) => void;

  // Called on token usage updates
  onTokenUsage: (usage: TokenUsage) => void;

  // Called when agent hands off
  onHandoff: (from: string, to: string) => void;
};
```

## Usage Example

```typescript
const config: RunConfig<MyContext> = {
  // Other config...
  onEvent: createSimpleEventHandler({
    onAssistantMessage: (content) => console.log('AI:', content),
    onToolCalls: (calls) => console.log('Tools:', calls.map(c => c.name)),
    onToolResult: (name, result, error) => {
      if (error) console.error(`${name} failed:`, error);
      else console.log(`${name} succeeded`);
    },
    onTokenUsage: (usage) => console.log('Tokens:', usage.total_tokens),
    onError: (error) => console.error('Error:', error),
  })
};
```

## Type-Safe Event Data

```typescript
// Extract specific event data types
type LLMCallData = EventData<'llm_call_end'>;
type ToolCallData = EventData<'tool_call_end'>;
type HandoffData = EventData<'handoff'>;

function handleLLMCall(data: LLMCallData) {
  console.log(data.usage?.total_tokens);     // ✅ Typed!
  console.log(data.estimatedCost?.totalCost); // ✅ Typed!
}
```

## Raw Event Handling (Advanced)

```typescript
const config: RunConfig<MyContext> = {
  onEvent: (event: TraceEvent) => {
    switch (event.type) {
      case 'llm_call_end':
        console.log(event.data.usage);
        break;
      case 'tool_call_end':
        console.log(event.data.toolName, event.data.result);
        break;
      // ... other cases
    }
  }
};
```

## Hybrid Approach

```typescript
const config: RunConfig<MyContext> = {
  onEvent: (event) => {
    // Common events with simple handler
    createSimpleEventHandler({
      onAssistantMessage: (content) => updateUI(content),
      onToolCalls: (calls) => showTools(calls),
    })(event);

    // Special events with raw access
    if (event.type === 'guardrail_violation') {
      alert(event.data.reason);
    }
  }
};
```

## All Event Types

| Event Type | Data Shape | Common Use |
|------------|------------|------------|
| `run_start` | `{ runId, traceId, context }` | Initialize tracking |
| `run_end` | `{ outcome }` | Cleanup, show results |
| `llm_call_start` | `{ agentName, model, messages }` | Show "thinking" UI |
| `llm_call_end` | `{ choice, usage, estimatedCost }` | Get response, track tokens |
| `tool_requests` | `{ toolCalls }` | Show tool execution UI |
| `tool_call_start` | `{ toolName, args }` | Show specific tool running |
| `tool_call_end` | `{ toolName, result, error, executionTime }` | Update tool status |
| `assistant_message` | `{ message }` | Display AI response |
| `token_usage` | `{ prompt, completion, total }` | Track token usage |
| `handoff` | `{ from, to }` | Show agent transition |
| `guardrail_violation` | `{ stage, reason }` | Handle policy violations |
| `decode_error` | `{ errors }` | Handle parsing errors |

## Migration Cheat Sheet

### From Other Frameworks

| Old Pattern | New JAF Pattern |
|-------------|----------------|
| `onLLMResponse(response)` | `onAssistantMessage(content, thinking)` |
| `onToolCall(toolCall)` | `onToolCalls(calls)` |
| `onToolComplete(result)` | `onToolResult(name, result, error)` |
| `message.type === 'user'` | `message.role === 'user'` |
| `toolCall.name` | `toolCall.function.name` |
| `toolCall.arguments` | `JSON.parse(toolCall.function.arguments)` |

## Common Patterns

### UI Progress Tracker

```typescript
createSimpleEventHandler({
  onRunStart: () => setLoading(true),
  onAssistantMessage: (content) => addMessage(content),
  onToolCalls: (calls) => setToolsRunning(calls.map(c => c.name)),
  onToolResult: (name) => removeToolRunning(name),
  onRunEnd: () => setLoading(false),
})
```

### Metrics Collector

```typescript
let totalTokens = 0;
let totalCost = 0;

createSimpleEventHandler({
  onTokenUsage: (usage) => {
    totalTokens += usage.total_tokens || 0;
  },
  onRunEnd: (outcome) => {
    console.log({ totalTokens, totalCost });
  }
})
```

### Debug Logger

```typescript
createSimpleEventHandler({
  onAssistantMessage: (content) => console.log('💬', content),
  onToolCalls: (calls) => console.log('🔧', calls),
  onToolResult: (name, _, error) => {
    if (error) console.error('❌', name, error);
    else console.log('✅', name);
  },
  onError: (error) => console.error('🚨', error),
})
```

## Tips

✅ **DO**: Use `createSimpleEventHandler` for most cases
✅ **DO**: Use hybrid approach when you need special event handling
✅ **DO**: Use `EventData<T>` for type-safe data extraction
✅ **DO**: Handle errors with `onError` callback

❌ **DON'T**: Use `(event as any)` - the types are provided!
❌ **DON'T**: Forget to handle `onError` - errors happen!
❌ **DON'T**: Create giant switch statements - use simple handlers!

## See Also

- Full Guide: `docs/event-handling-guide.md`
- Examples: `examples/simple-event-handler-demo.ts`
- API Reference: `src/core/types.ts`
