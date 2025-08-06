# Juspay Agent Framework (JAF) - Core Concepts

The Juspay Agent Framework (JAF) is a type-safe, functional programming framework for building AI agent systems. This guide covers the core concepts, type system, and architectural patterns that make JAF a robust foundation for agent development.

## Table of Contents

1. [Immutable State and RunState](#immutable-state-and-runstate)
2. [Agent Definition and Structure](#agent-definition-and-structure)
3. [Tool System Architecture](#tool-system-architecture)
4. [RunConfig and Configuration](#runconfig-and-configuration)
5. [Message Flow and Conversation Handling](#message-flow-and-conversation-handling)
6. [TraceId and RunId Concepts](#traceid-and-runid-concepts)
7. [Error Handling Patterns](#error-handling-patterns)
8. [Context and Typing](#context-and-typing)
9. [Memory Management](#memory-management)
10. [Functional Programming Principles](#functional-programming-principles)

## Immutable State and RunState

### Core Principle: Immutability

JAF follows strict functional programming principles where all state is immutable. The central state object, `RunState`, represents the complete execution context at any point in time and is never mutated - only new states are created.

```typescript
export type RunState<Ctx> = {
  readonly runId: RunId;
  readonly traceId: TraceId;
  readonly messages: readonly Message[];
  readonly currentAgentName: string;
  readonly context: Readonly<Ctx>;
  readonly turnCount: number;
};
```

### Key Properties

- **`runId`**: Unique identifier for the current execution run
- **`traceId`**: Identifier for tracing related runs across handoffs
- **`messages`**: Immutable array of conversation messages
- **`currentAgentName`**: Name of the currently active agent
- **`context`**: User-defined context object (read-only)
- **`turnCount`**: Number of turns completed in this run

### State Evolution

State evolution follows a pure functional pattern:

```typescript
// State is never mutated directly
const nextState: RunState<Ctx> = {
  ...state,
  messages: [...state.messages, newMessage],
  turnCount: state.turnCount + 1
};
```

This immutability ensures:
- **Predictable state transitions**
- **Easy debugging and tracing**
- **Thread safety**
- **Ability to replay executions**

## Agent Definition and Structure

### Agent Type Definition

Agents are the core execution units in JAF, defined as immutable configuration objects:

```typescript
export type Agent<Ctx, Out> = {
  readonly name: string;
  readonly instructions: (state: Readonly<RunState<Ctx>>) => string;
  readonly tools?: readonly Tool<any, Ctx>[];
  readonly outputCodec?: z.ZodType<Out>;
  readonly handoffs?: readonly string[];
  readonly modelConfig?: ModelConfig;
};
```

### Agent Components

#### 1. Instructions Function
The instructions function dynamically generates system prompts based on the current state:

```typescript
const dynamicAgent: Agent<MyContext, string> = {
  name: "dynamic-helper",
  instructions: (state) => {
    const messageCount = state.messages.length;
    const userName = state.context.user?.name || "User";
    
    return `You are a helpful assistant for ${userName}. 
            This conversation has ${messageCount} messages so far.
            Current turn: ${state.turnCount}`;
  },
  // ... other properties
};
```

#### 2. Tool Registration
Tools are registered as readonly arrays, ensuring immutability:

```typescript
const agentWithTools: Agent<MyContext, any> = {
  name: "tool-user",
  instructions: () => "You can use tools to help users.",
  tools: [
    searchTool,
    calculatorTool,
    weatherTool
  ] as const,
};
```

#### 3. Output Validation
Optional Zod schemas ensure type-safe outputs:

```typescript
const structuredOutputAgent: Agent<MyContext, { result: string; confidence: number }> = {
  name: "structured-agent",
  instructions: () => "Return structured JSON responses.",
  outputCodec: z.object({
    result: z.string(),
    confidence: z.number().min(0).max(1)
  })
};
```

#### 4. Handoff Configuration
Agents can specify which other agents they can delegate to:

```typescript
const coordinatorAgent: Agent<MyContext, any> = {
  name: "coordinator",
  instructions: () => "Coordinate tasks and delegate to specialists.",
  handoffs: ["search-specialist", "calculation-specialist"],
  tools: [handoffTool]
};
```

## Tool System Architecture

### Tool Type Definition

Tools are strongly typed, pure functions with schema validation:

```typescript
export type Tool<A, Ctx> = {
  readonly schema: {
    readonly name: string;
    readonly description: string;
    readonly parameters: z.ZodType<A>;
  };
  readonly execute: (args: A, context: Readonly<Ctx>) => Promise<string | ToolResult>;
};
```

### Tool Implementation Example

```typescript
const searchTool: Tool<{ query: string; limit?: number }, MyContext> = {
  schema: {
    name: "web_search",
    description: "Search the web for information",
    parameters: z.object({
      query: z.string().min(1),
      limit: z.number().default(10).optional()
    })
  },
  execute: async (args, context) => {
    // Tool execution logic
    const results = await performSearch(args.query, args.limit);
    
    // Return string or ToolResult object
    return ToolResponse.success(results, {
      executionTimeMs: Date.now() - startTime,
      toolName: "web_search"
    });
  }
};
```

### ToolResult System

JAF provides a standardized result system for consistent error handling:

```typescript
export interface ToolResult<T = any> {
  readonly status: ToolResultStatus;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: any;
  };
  readonly metadata?: {
    readonly executionTimeMs?: number;
    readonly toolName?: string;
    readonly [key: string]: any;
  };
}
```

Tools can return either strings (for backward compatibility) or `ToolResult` objects for structured responses:

```typescript
// String response (simple)
return "Search completed successfully";

// ToolResult response (structured)
return ToolResponse.success(searchResults, {
  executionTimeMs: 150,
  resultsCount: searchResults.length
});

// Error response
return ToolResponse.error(
  ToolErrorCodes.EXTERNAL_SERVICE_ERROR,
  "Search service temporarily unavailable"
);
```

### Tool Validation and Error Handling

Tools include built-in validation and error handling:

```typescript
const validatedTool = withErrorHandling("my-tool", async (args, context) => {
  // Tool logic that may throw
  const result = await riskyOperation(args);
  return result;
});
```

The `withErrorHandling` wrapper provides:
- Automatic error catching and formatting
- Execution time tracking
- Consistent error response format
- Logging integration

## RunConfig and Configuration

### RunConfig Type Definition

`RunConfig` centralizes all execution configuration:

```typescript
export type RunConfig<Ctx> = {
  readonly agentRegistry: ReadonlyMap<string, Agent<Ctx, any>>;
  readonly modelProvider: ModelProvider<Ctx>;
  readonly maxTurns?: number;
  readonly modelOverride?: string;
  readonly initialInputGuardrails?: readonly Guardrail<string>[];
  readonly finalOutputGuardrails?: readonly Guardrail<any>[];
  readonly onEvent?: (event: TraceEvent) => void;
  readonly memory?: MemoryConfig;
  readonly conversationId?: string;
};
```

### Configuration Components

#### 1. Agent Registry
Immutable map of available agents:

```typescript
const agentRegistry = new Map([
  ["coordinator", coordinatorAgent],
  ["search-specialist", searchAgent],
  ["calculation-specialist", calculationAgent]
] as const);
```

#### 2. Model Provider
Abstraction for different LLM providers:

```typescript
const openAIProvider: ModelProvider<MyContext> = {
  getCompletion: async (state, agent, config) => {
    // Provider-specific implementation
    const response = await openai.chat.completions.create({
      model: config.modelOverride ?? agent.modelConfig?.name ?? "gpt-4",
      messages: formatMessages(state.messages),
      tools: formatTools(agent.tools),
      temperature: agent.modelConfig?.temperature
    });
    
    return response.choices[0];
  }
};
```

#### 3. Guardrails
Input and output validation functions:

```typescript
const inputGuardrails: Guardrail<string>[] = [
  createContentFilter(), // Filter sensitive content
  createRateLimiter(10, 60000, () => "global") // Rate limiting
];

const outputGuardrails: Guardrail<any>[] = [
  (output) => {
    if (typeof output === 'string' && output.length > 10000) {
      return { isValid: false, errorMessage: "Output too long" };
    }
    return { isValid: true };
  }
];
```

#### 4. Event Handling
Optional event callback for monitoring:

```typescript
const config: RunConfig<MyContext> = {
  // ... other config
  onEvent: (event) => {
    console.log(`[${event.type}]`, event.data);
    
    // Custom handling based on event type
    switch (event.type) {
      case 'tool_call_start':
        metrics.toolCallStarted(event.data.toolName);
        break;
      case 'handoff':
        console.log(`Agent handoff: ${event.data.from} → ${event.data.to}`);
        break;
    }
  }
};
```

## Message Flow and Conversation Handling

### Message Structure

All communication follows a standardized message format:

```typescript
export type Message = {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly tool_call_id?: string;
  readonly tool_calls?: readonly {
    readonly id: string;
    readonly type: 'function';
    readonly function: {
      readonly name: string;
      readonly arguments: string;
    };
  }[];
};
```

### Conversation Flow

1. **User Input**: Creates initial message with role 'user'
2. **Agent Processing**: Agent generates response with optional tool calls
3. **Tool Execution**: Tools execute and return results as 'tool' messages
4. **Response Generation**: Agent processes tool results and generates final response

```typescript
// Example conversation flow
const messages: Message[] = [
  {
    role: 'user',
    content: 'What is the weather in San Francisco?'
  },
  {
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: 'call_123',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"location": "San Francisco"}'
      }
    }]
  },
  {
    role: 'tool',
    content: '{"temperature": 68, "condition": "sunny"}',
    tool_call_id: 'call_123'
  },
  {
    role: 'assistant',
    content: 'The weather in San Francisco is currently 68°F and sunny.'
  }
];
```

### Message Immutability

Messages are always appended, never modified:

```typescript
// Correct: Create new array with additional message
const newMessages = [...state.messages, assistantMessage];

// Incorrect: Mutation
state.messages.push(assistantMessage); // This would cause TypeScript error
```

## TraceId and RunId Concepts

### Purpose and Distinction

JAF uses two levels of identification for tracking and observability:

- **`TraceId`**: Groups related executions across agent handoffs
- **`RunId`**: Identifies individual execution runs within a trace

```typescript
export type TraceId = string & { readonly _brand: 'TraceId' };
export type RunId = string & { readonly _brand: 'RunId' };
```

### Branded Types

JAF uses TypeScript branded types to prevent ID confusion:

```typescript
// These are string types at runtime but distinct types at compile time
const traceId = createTraceId("trace-123");
const runId = createRunId("run-456");

// TypeScript prevents mixing them up
function processRun(runId: RunId) { /* ... */ }
processRun(traceId); // TypeScript error!
```

### Trace Relationships

```
TraceId: trace-abc123
├── RunId: run-001 (coordinator agent)
├── RunId: run-002 (search specialist - handoff)
└── RunId: run-003 (coordinator agent - return)
```

### Trace Collection

Events are automatically associated with traces:

```typescript
export type TraceEvent =
  | { type: 'run_start'; data: { runId: RunId; traceId: TraceId; } }
  | { type: 'llm_call_start'; data: { agentName: string; model: string; } }
  | { type: 'tool_call_start'; data: { toolName: string; args: any; } }
  | { type: 'handoff'; data: { from: string; to: string; } }
  | { type: 'run_end'; data: { outcome: RunResult<any>['outcome'] } };
```

## Error Handling Patterns

### Functional Error Types

JAF uses discriminated unions for type-safe error handling:

```typescript
export type JAFError =
  | { readonly _tag: "MaxTurnsExceeded"; readonly turns: number }
  | { readonly _tag: "ModelBehaviorError"; readonly detail: string }
  | { readonly _tag: "DecodeError"; readonly errors: z.ZodIssue[] }
  | { readonly _tag: "InputGuardrailTripwire"; readonly reason: string }
  | { readonly _tag: "OutputGuardrailTripwire"; readonly reason: string }
  | { readonly _tag: "ToolCallError"; readonly tool: string; readonly detail: string }
  | { readonly _tag: "HandoffError"; readonly detail: string }
  | { readonly _tag: "AgentNotFound"; readonly agentName: string };
```

### Error Classification

The JAF error system includes utilities for error analysis:

```typescript
const errorHandler = new JAFErrorHandler();

// Format errors for display
const message = errorHandler.format(error);

// Check if error is retryable
const canRetry = errorHandler.isRetryable(error);

// Get error severity
const severity = errorHandler.getSeverity(error); // 'low' | 'medium' | 'high' | 'critical'
```

### Result Type Pattern

Operations that may fail return a `RunResult` type:

```typescript
export type RunResult<Out> = {
  readonly finalState: RunState<any>;
  readonly outcome:
    | { readonly status: 'completed'; readonly output: Out }
    | { readonly status: 'error'; readonly error: JAFError };
};
```

This enables functional error handling:

```typescript
const result = await run(initialState, config);

if (result.outcome.status === 'completed') {
  console.log('Success:', result.outcome.output);
} else {
  console.error('Error:', JAFErrorHandler.format(result.outcome.error));
}
```

### Validation Results

Input validation follows the same pattern:

```typescript
export type ValidationResult =
  | { readonly isValid: true }
  | { readonly isValid: false; readonly errorMessage: string };
```

### Guardrail Implementation

Guardrails are pure functions that validate inputs or outputs:

```typescript
const contentFilter: Guardrail<string> = (input: string): ValidationResult => {
  const sensitivePatterns = [/password/i, /secret/i, /api[_-]?key/i];
  
  for (const pattern of sensitivePatterns) {
    if (pattern.test(input)) {
      return {
        isValid: false,
        errorMessage: 'Content contains potentially sensitive information'
      };
    }
  }
  
  return { isValid: true };
};
```

## Context and Typing

### Generic Context System

JAF uses TypeScript generics to provide type-safe context throughout the system:

```typescript
// Define your application context
interface MyApplicationContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly permissions: readonly string[];
  readonly preferences: {
    readonly language: string;
    readonly timezone: string;
  };
}

// All components are typed with your context
const agent: Agent<MyApplicationContext, string> = {
  name: "personalized-agent",
  instructions: (state) => {
    const { userId, preferences } = state.context;
    return `You are helping user ${userId}. 
            Respond in ${preferences.language}.
            User timezone: ${preferences.timezone}`;
  }
};
```

### Context Immutability

Context is readonly throughout the system:

```typescript
const tool: Tool<{query: string}, MyApplicationContext> = {
  schema: {
    name: "personalized_search",
    description: "Search with user personalization",
    parameters: z.object({ query: z.string() })
  },
  execute: async (args, context) => {
    // context is Readonly<MyApplicationContext>
    const userLang = context.preferences.language;
    
    // This would cause TypeScript error:
    // context.userId = "new-id"; // Cannot assign to readonly property
    
    return performLocalizedSearch(args.query, userLang);
  }
};
```

### Context Evolution

Since context is immutable, evolution requires creating new states:

```typescript
// Update context by creating new state
const updatedState: RunState<MyApplicationContext> = {
  ...currentState,
  context: {
    ...currentState.context,
    preferences: {
      ...currentState.context.preferences,
      language: "es" // Update language preference
    }
  }
};
```

## Memory Management

### Memory Provider Interface

JAF includes a pluggable memory system for conversation persistence:

```typescript
export type MemoryProvider = {
  readonly storeMessages: (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { userId?: string; traceId?: TraceId; [key: string]: any }
  ) => Promise<Result<void>>;
  
  readonly getConversation: (conversationId: string) => Promise<Result<ConversationMemory | null>>;
  
  readonly appendMessages: (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { traceId?: TraceId; [key: string]: any }
  ) => Promise<Result<void>>;
  
  // ... other methods
};
```

### Memory Configuration

Memory behavior is configured through `MemoryConfig`:

```typescript
export interface MemoryConfig {
  readonly provider: MemoryProvider;
  readonly autoStore?: boolean; // Automatically store conversation history
  readonly maxMessages?: number; // Maximum messages to keep in memory
  readonly ttl?: number; // Time-to-live in seconds for conversations
  readonly compressionThreshold?: number; // Compress conversations after N messages
}
```

### Functional Error Handling in Memory

Memory operations use the Result pattern for error handling:

```typescript
export type Result<T, E = MemoryErrorUnion> = 
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

// Usage
const result = await memoryProvider.getConversation(conversationId);
if (result.success) {
  console.log('Messages:', result.data.messages);
} else {
  console.error('Memory error:', result.error.message);
}
```

### Memory Provider Types

JAF supports multiple memory providers:

- **InMemoryProvider**: For development and testing
- **RedisProvider**: For production caching
- **PostgresProvider**: For persistent storage

Each provider follows the same interface but with provider-specific configuration.

## Functional Programming Principles

### Pure Functions

All core functions in JAF are pure - they don't have side effects and return the same output for the same input:

```typescript
// Pure function - no side effects
function addMessage(state: RunState<Ctx>, message: Message): RunState<Ctx> {
  return {
    ...state,
    messages: [...state.messages, message],
    turnCount: state.turnCount + 1
  };
}
```

### Immutability

All data structures are immutable:

```typescript
// Immutable update patterns
const newState = {
  ...oldState,
  messages: [...oldState.messages, newMessage]
};

// Array operations create new arrays
const filteredMessages = state.messages.filter(m => m.role === 'user');
const mappedMessages = state.messages.map(m => ({ ...m, processed: true }));
```

### Composition

JAF emphasizes function composition:

```typescript
// Compose validation functions
const composedValidation = composeValidations(
  pathValidator,
  permissionValidator,
  contentValidator
);

// Compose guardrails
const inputGuardrails = [
  createContentFilter(),
  createRateLimiter(10, 60000, () => "user"),
  createPermissionCheck()
];
```

### Type Safety

TypeScript's type system ensures correctness:

```typescript
// Generic types ensure consistency
function createAgent<Ctx, Out>(
  config: Omit<Agent<Ctx, Out>, 'name'>
): Agent<Ctx, Out> {
  return {
    name: generateAgentName(),
    ...config
  };
}

// Branded types prevent ID confusion
function processTrace(traceId: TraceId, runId: RunId) {
  // Types ensure correct IDs are passed
}
```

### Error as Values

Errors are represented as values, not exceptions:

```typescript
// Return error values instead of throwing
type OperationResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string };

async function safeOperation(): Promise<OperationResult<string>> {
  try {
    const result = await riskyOperation();
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

## Conclusion

The Juspay Agent Framework provides a robust, type-safe foundation for building AI agent systems. Its core principles of immutability, pure functions, and strong typing create a predictable and maintainable development environment.

Key benefits of JAF's approach:

- **Predictability**: Immutable state and pure functions make behavior predictable
- **Type Safety**: Strong TypeScript typing catches errors at compile time  
- **Composability**: Functional design enables easy composition of behaviors
- **Testability**: Pure functions and immutable state make testing straightforward
- **Observability**: Built-in tracing and event systems provide visibility
- **Scalability**: Functional patterns scale well across complex agent systems

This functional approach to agent development reduces bugs, improves maintainability, and provides a solid foundation for building complex AI systems.