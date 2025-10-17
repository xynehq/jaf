# Event Handling Guide

JAF provides a comprehensive event system for monitoring and responding to agent execution. This guide shows you how to use the event system effectively.

## Event Types

JAF emits events throughout the agent execution lifecycle. All events follow a discriminated union pattern with a `type` field and a `data` object containing event-specific information.

### Core Event Types

- **`run_start`** - Agent run begins
- **`run_end`** - Agent run completes
- **`llm_call_start`** - LLM API call starts
- **`llm_call_end`** - LLM API call completes
- **`tool_requests`** - Agent requests to execute tools
- **`tool_call_start`** - Tool execution starts
- **`tool_call_end`** - Tool execution completes
- **`assistant_message`** - Assistant generates a message
- **`handoff`** - Agent hands off to another agent
- **`token_usage`** - Token usage information
- **`guardrail_violation`** - Guardrail check failed
- **`decode_error`** - Output parsing error

## Method 1: Using Raw TraceEvent (Full Control)

Handle raw `TraceEvent` discriminated unions for maximum flexibility:

```typescript
import { run, type TraceEvent, type RunConfig } from '@xynehq/jaf';

const config: RunConfig<MyContext> = {
  // ... other config
  onEvent: (event: TraceEvent) => {
    switch (event.type) {
      case 'llm_call_end':
        console.log('Model:', event.data.model);
        console.log('Tokens:', event.data.usage?.total_tokens);
        break;

      case 'tool_requests':
        console.log('Tools requested:', event.data.toolCalls.map(c => c.name));
        break;

      case 'tool_call_end':
        console.log(`${event.data.toolName} completed in ${event.data.executionTime}ms`);
        break;
    }
  }
};
```

### Type-Safe Event Data Access

Use the `EventData` helper type for type-safe access to event data:

```typescript
import { type EventData } from '@xynehq/jaf';

// Extract specific event data type
type LLMCallEndData = EventData<'llm_call_end'>;
type ToolCallData = EventData<'tool_call_end'>;

function handleLLMCallEnd(data: LLMCallEndData) {
  console.log('Usage:', data.usage);
  console.log('Cost:', data.estimatedCost);
}
```

## Method 2: Using Simple Event Handlers (Recommended)

For common use cases, use the simplified event handler API:

```typescript
import { createSimpleEventHandler, type SimpleEventHandlers } from '@xynehq/jaf';

const handlers: SimpleEventHandlers = {
  // Called when assistant generates text
  onAssistantMessage: (content, thinking) => {
    console.log('Assistant:', content);
    if (thinking) console.log('Thinking:', thinking);
  },

  // Called when tools are requested
  onToolCalls: (calls) => {
    console.log('Executing tools:', calls.map(c => c.name).join(', '));
  },

  // Called when tool execution completes
  onToolResult: (toolName, result, error) => {
    if (error) {
      console.error(`${toolName} failed:`, error);
    } else {
      console.log(`${toolName} succeeded:`, result.substring(0, 100));
    }
  },

  // Called on token usage updates
  onTokenUsage: (usage) => {
    console.log(`Tokens: ${usage.total_tokens} (prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens})`);
  },

  // Called on errors
  onError: (error) => {
    console.error('Error:', error);
  },

  // Called when run starts/ends
  onRunStart: (runId, traceId) => {
    console.log(`Run started: ${runId}`);
  },

  onRunEnd: (outcome) => {
    if (outcome.status === 'completed') {
      console.log('Run completed successfully');
    } else if (outcome.status === 'error') {
      console.error('Run failed:', outcome.error);
    }
  },

  // Called on agent handoffs
  onHandoff: (from, to) => {
    console.log(`Handoff: ${from} → ${to}`);
  }
};

const config: RunConfig<MyContext> = {
  // ... other config
  onEvent: createSimpleEventHandler(handlers)
};
```

## Method 3: Hybrid Approach

Combine both approaches for maximum flexibility:

```typescript
import { createSimpleEventHandler } from '@xynehq/jaf';

const config: RunConfig<MyContext> = {
  onEvent: (event) => {
    // Handle common events with simple handler
    createSimpleEventHandler({
      onAssistantMessage: (content) => updateUI(content),
      onToolCalls: (calls) => showToolExecutionUI(calls),
    })(event);

    // Handle special events with raw access
    if (event.type === 'guardrail_violation') {
      alertUser(event.data.reason);
    } else if (event.type === 'memory_operation') {
      logMemoryOperation(event.data);
    }
  }
};
```

## Common Patterns

### Building a UI Progress Tracker

```typescript
import { createSimpleEventHandler } from '@xynehq/jaf';

class AgentProgressTracker {
  private messages: string[] = [];
  private toolsExecuting: Set<string> = new Set();

  getEventHandler() {
    return createSimpleEventHandler({
      onAssistantMessage: (content) => {
        this.messages.push(content);
        this.updateUI();
      },

      onToolCalls: (calls) => {
        calls.forEach(call => this.toolsExecuting.add(call.name));
        this.updateUI();
      },

      onToolResult: (toolName) => {
        this.toolsExecuting.delete(toolName);
        this.updateUI();
      }
    });
  }

  private updateUI() {
    // Update your UI with this.messages and this.toolsExecuting
  }
}
```

### Collecting Metrics

```typescript
import { type TraceEvent } from '@xynehq/jaf';

class MetricsCollector {
  private totalTokens = 0;
  private totalCost = 0;
  private toolExecutions: Record<string, number> = {};

  handleEvent(event: TraceEvent) {
    switch (event.type) {
      case 'llm_call_end':
        if (event.data.usage) {
          this.totalTokens += event.data.usage.total_tokens || 0;
        }
        if (event.data.estimatedCost) {
          this.totalCost += event.data.estimatedCost.totalCost;
        }
        break;

      case 'tool_call_end':
        this.toolExecutions[event.data.toolName] =
          (this.toolExecutions[event.data.toolName] || 0) + 1;
        break;
    }
  }

  getMetrics() {
    return {
      totalTokens: this.totalTokens,
      totalCost: this.totalCost,
      toolExecutions: this.toolExecutions
    };
  }
}
```

### Debugging with Full Event Logging

```typescript
import { type TraceEvent } from '@xynehq/jaf';

function createDebugHandler(): (event: TraceEvent) => void {
  return (event: TraceEvent) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${event.type}:`, JSON.stringify(event.data, null, 2));
  };
}

const config: RunConfig<MyContext> = {
  // ... other config
  onEvent: createDebugHandler()
};
```

## Type Safety Tips

### Extract Event Data Types

```typescript
import { type EventData } from '@xynehq/jaf';

// Get type-safe access to specific event data
type ToolCallEndData = EventData<'tool_call_end'>;

function analyzeToolExecution(data: ToolCallEndData) {
  // TypeScript knows the exact shape of data
  console.log(data.toolName);       // ✓ Type-safe
  console.log(data.executionTime);  // ✓ Type-safe
  console.log(data.result);         // ✓ Type-safe
}
```

### Custom Event Filters

```typescript
import { type TraceEvent } from '@xynehq/jaf';

// Type-safe event filtering
function isToolEvent(event: TraceEvent): event is Extract<TraceEvent, { type: 'tool_call_start' | 'tool_call_end' }> {
  return event.type === 'tool_call_start' || event.type === 'tool_call_end';
}

const config: RunConfig<MyContext> = {
  onEvent: (event) => {
    if (isToolEvent(event)) {
      // TypeScript narrows the type here
      console.log('Tool name:', event.data.toolName);
    }
  }
};
```

## Migration from Other Frameworks

If you're migrating from another agent framework, here's how to map common patterns:

### Old Multi-Property Handler Pattern

```typescript
// ❌ Old framework pattern
const handler = {
  onLLMResponse: (response) => { ... },
  onToolCall: (toolCall) => { ... },
  onError: (error) => { ... }
};
```

```typescript
// ✅ JAF pattern with createSimpleEventHandler
const handler = createSimpleEventHandler({
  onAssistantMessage: (content) => { ... },
  onToolCalls: (calls) => { ... },
  onError: (error) => { ... }
});
```

### Old Message Type Checks

```typescript
// ❌ Old framework
if (message.type === 'user') { ... }
```

```typescript
// ✅ JAF
if (message.role === 'user') { ... }
```

### Old ToolCall Structure

```typescript
// ❌ Old framework
const toolName = toolCall.name;
const args = toolCall.arguments;
```

```typescript
// ✅ JAF
const toolName = toolCall.function.name;
const args = JSON.parse(toolCall.function.arguments);
```

## Best Practices

1. **Use `createSimpleEventHandler` for common cases** - It provides better ergonomics
2. **Use raw `TraceEvent` for advanced needs** - When you need access to all event data
3. **Use `EventData<T>` for type safety** - Extract specific event data types
4. **Log events during development** - Use the debug handler pattern
5. **Collect metrics in production** - Track tokens, costs, and tool usage
6. **Handle errors gracefully** - Always implement `onError` handler
