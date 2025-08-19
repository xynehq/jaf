# Juspay Agent Framework (JAF) API Reference

**Version:** 0.0.1

The Juspay Agent Framework (JAF) is a purely functional agent framework with immutable state and composable tools. This document provides a comprehensive reference for all public APIs, types, and interfaces.

## Table of Contents

- [Core Functions](#core-functions)
- [Type Definitions](#type-definitions)
- [Agent Configuration](#agent-configuration)
- [Tool System](#tool-system)
- [Memory Providers](#memory-providers)
- [Model Providers](#model-providers)
- [Server Configuration](#server-configuration)
- [Error Handling](#error-handling)
- [Validation and Policies](#validation-and-policies)
- [Tracing and Observability](#tracing-and-observability)
- [Utility Functions](#utility-functions)

---

## Core Functions

### `run<Ctx, Out>(initialState, config)`

Executes an agent with the given initial state and configuration.

**Type Signature:**
```typescript
function run<Ctx, Out>(
  initialState: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<RunResult<Out>>
```

**Parameters:**
- `initialState: RunState<Ctx>` - The initial state containing messages, context, and agent information
- `config: RunConfig<Ctx>` - Configuration including agent registry, model provider, and optional settings

**Returns:**
- `Promise<RunResult<Out>>` - The final result with either a successful output or an error

**Example:**
```typescript
import { run, createRunId, createTraceId } from '@xynehq/jaf';

const initialState = {
  runId: createRunId('run-123'),
  traceId: createTraceId('trace-456'),
  messages: [{ role: 'user', content: 'Hello!' }],
  currentAgentName: 'assistant',
  context: { userId: 'user123' },
  turnCount: 0
};

const config = {
  agentRegistry: new Map([['assistant', myAgent]]),
  modelProvider: myModelProvider,
  maxTurns: 10
};

const result = await run(initialState, config);
```

### `runServer<Ctx>(agents, runConfig, options)`

Creates and starts a development server for testing agents locally.

**Type Signature:**
```typescript
function runServer<Ctx>(
  agents: Map<string, Agent<Ctx, any>> | Agent<Ctx, any>[],
  runConfig: Omit<RunConfig<Ctx>, 'agentRegistry'>,
  options?: Partial<Omit<ServerConfig<Ctx>, 'runConfig' | 'agentRegistry'>>
): Promise<{ app: FastifyInstance; start: () => Promise<void>; stop: () => Promise<void> }>
```

**Parameters:**
- `agents` - Map of agent names to agent definitions, or array of agents
- `runConfig` - Configuration for running agents (excluding agentRegistry)
- `options` - Optional server configuration (port, host, memory provider, etc.)

**Returns:**
- Server instance with `start()` and `stop()` methods

**Example:**
```typescript
import { runServer, makeLiteLLMProvider } from '@xynehq/jaf';

const myAgent = {
  name: 'assistant',
  instructions: 'You are a helpful assistant',
  tools: []
};

const server = await runServer(
  [myAgent],
  { modelProvider: makeLiteLLMProvider('http://localhost:4000') },
  { port: 3000 }
);
```

### `generateTraceId()` and `generateRunId()`

Generate unique identifiers for tracing and run identification.

**Type Signatures:**
```typescript
function generateTraceId(): TraceId
function generateRunId(): RunId
```

**Returns:**
- Branded string types for type safety

**Example:**
```typescript
import { generateTraceId, generateRunId } from '@xynehq/jaf';

const traceId = generateTraceId();
const runId = generateRunId();
```

---

## Type Definitions

### Core Types

#### `TraceId` and `RunId`
```typescript
type TraceId = string & { readonly _brand: 'TraceId' };
type RunId = string & { readonly _brand: 'RunId' };

// Factory functions
const createTraceId = (id: string): TraceId
const createRunId = (id: string): RunId
```

#### `Message`
```typescript
type Message = {
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

#### `RunState<Ctx>`
```typescript
type RunState<Ctx> = {
  readonly runId: RunId;
  readonly traceId: TraceId;
  readonly messages: readonly Message[];
  readonly currentAgentName: string;
  readonly context: Readonly<Ctx>;
  readonly turnCount: number;
};
```

#### `RunResult<Out>`
```typescript
type RunResult<Out> = {
  readonly finalState: RunState<any>;
  readonly outcome:
    | { readonly status: 'completed'; readonly output: Out }
    | { readonly status: 'error'; readonly error: JAFError };
};
```

#### `ValidationResult`
```typescript
type ValidationResult =
  | { readonly isValid: true }
  | { readonly isValid: false; readonly errorMessage: string };
```

### Configuration Types

#### `RunConfig<Ctx>`
```typescript
type RunConfig<Ctx> = {
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

#### `ModelConfig`
```typescript
type ModelConfig = {
  readonly name?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
};
```

---

## Agent Configuration

### `Agent<Ctx, Out>`
```typescript
type Agent<Ctx, Out> = {
  readonly name: string;
  readonly instructions: (state: Readonly<RunState<Ctx>>) => string;
  readonly tools?: readonly Tool<any, Ctx>[];
  readonly outputCodec?: z.ZodType<Out>;
  readonly handoffs?: readonly string[];
  readonly modelConfig?: ModelConfig;
};
```

**Properties:**
- `name` - Unique identifier for the agent
- `instructions` - Function that returns instructions based on current state
- `tools` - Optional array of tools available to the agent
- `outputCodec` - Optional Zod schema for validating agent output
- `handoffs` - Optional list of agent names this agent can hand off to
- `modelConfig` - Optional model-specific configuration

**Example:**
```typescript
import { z } from 'zod';

const weatherAgent: Agent<{ userId: string }, { temperature: number }> = {
  name: 'weather',
  instructions: (state) => `You are a weather assistant. Help user ${state.context.userId}.`,
  tools: [weatherTool],
  outputCodec: z.object({ temperature: z.number() }),
  handoffs: ['general-assistant'],
  modelConfig: { temperature: 0.1, maxTokens: 500 }
};
```

---

## Tool System

### `Tool<A, Ctx>`
```typescript
type Tool<A, Ctx> = {
  readonly schema: {
    readonly name: string;
    readonly description: string;
    readonly parameters: z.ZodType<A>;
  };
  readonly execute: (args: A, context: Readonly<Ctx>) => Promise<string | ToolResult>;
};
```

**Properties:**
- `schema.name` - Unique tool name
- `schema.description` - Human-readable description
- `schema.parameters` - Zod schema for validating tool arguments
- `execute` - Function that executes the tool with validated arguments

### `ToolResult<T>`
```typescript
interface ToolResult<T = any> {
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

type ToolResultStatus = 'success' | 'error' | 'validation_error' | 'permission_denied' | 'not_found';
```

### Tool Response Helpers

#### `ToolResponse` Class
```typescript
class ToolResponse {
  static success<T>(data: T, metadata?: ToolResult['metadata']): ToolResult<T>
  static error(code: ToolErrorCode, message: string, details?: any, metadata?: ToolResult['metadata']): ToolResult
  static validationError(message: string, details?: any, metadata?: ToolResult['metadata']): ToolResult
  static permissionDenied(message: string, requiredPermissions?: string[], metadata?: ToolResult['metadata']): ToolResult
  static notFound(resource: string, identifier?: string, metadata?: ToolResult['metadata']): ToolResult
}
```

#### `withErrorHandling<TArgs, TResult, TContext>`
```typescript
function withErrorHandling<TArgs, TResult, TContext>(
  toolName: string,
  executor: (args: TArgs, context: TContext) => Promise<TResult> | TResult
): (args: TArgs, context: TContext) => Promise<ToolResult<TResult>>
```

Wraps a tool execution function with standardized error handling and timing.

### Tool Error Codes
```typescript
const ToolErrorCodes = {
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  NOT_FOUND: 'NOT_FOUND',
  RESOURCE_UNAVAILABLE: 'RESOURCE_UNAVAILABLE',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  TIMEOUT: 'TIMEOUT',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;
```

### Example Tool Implementation
```typescript
import { z } from 'zod';
import { Tool, ToolResponse, withErrorHandling } from '@xynehq/jaf';

const weatherSchema = z.object({
  city: z.string().describe("The city to get weather for"),
  units: z.enum(['celsius', 'fahrenheit']).default('celsius')
});

const weatherTool: Tool<z.infer<typeof weatherSchema>, { apiKey: string }> = {
  schema: {
    name: 'get_weather',
    description: 'Get current weather for a city',
    parameters: weatherSchema
  },
  execute: withErrorHandling('get_weather', async (args, context) => {
    if (!context.apiKey) {
      return ToolResponse.error('MISSING_API_KEY', 'Weather API key not configured');
    }
    
    // Fetch weather data
    const weather = await fetchWeather(args.city, context.apiKey);
    return ToolResponse.success(weather);
  })
};
```

---

## Memory Providers

### `MemoryProvider` Interface
```typescript
type MemoryProvider = {
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

  readonly findConversations: (query: MemoryQuery) => Promise<Result<ConversationMemory[]>>;

  readonly getRecentMessages: (
    conversationId: string,
    limit?: number
  ) => Promise<Result<readonly Message[]>>;

  readonly deleteConversation: (conversationId: string) => Promise<Result<boolean>>;

  readonly clearUserConversations: (userId: string) => Promise<Result<number>>;

  readonly getStats: (userId?: string) => Promise<Result<{
    totalConversations: number;
    totalMessages: number;
    oldestConversation?: Date;
    newestConversation?: Date;
  }>>;

  readonly healthCheck: () => Promise<Result<{ healthy: boolean; latencyMs?: number; error?: string }>>;

  readonly close: () => Promise<Result<void>>;
};
```

### `MemoryConfig`
```typescript
interface MemoryConfig {
  readonly provider: MemoryProvider;
  readonly autoStore?: boolean; // Automatically store conversation history
  readonly maxMessages?: number; // Maximum messages to keep in memory
  readonly ttl?: number; // Time-to-live in seconds for conversations
  readonly compressionThreshold?: number; // Compress conversations after N messages
}
```

### Memory Provider Factory Functions

#### `createMemoryProvider(config, externalClients?)`
```typescript
function createMemoryProvider(
  config: MemoryProviderConfig,
  externalClients?: {
    redis?: any;
    postgres?: any;
  }
): Promise<MemoryProvider>
```

#### `createMemoryProviderFromEnv(externalClients?)`
```typescript
function createMemoryProviderFromEnv(
  externalClients?: {
    redis?: any;
    postgres?: any;
  }
): Promise<MemoryProvider>
```

#### `createSimpleMemoryProvider`
```typescript
// In-memory provider
function createSimpleMemoryProvider(type: 'memory'): Promise<MemoryProvider>

// Redis provider
function createSimpleMemoryProvider(
  type: 'redis',
  redisClient: any,
  config?: Partial<RedisConfig>
): Promise<MemoryProvider>

// PostgreSQL provider
function createSimpleMemoryProvider(
  type: 'postgres',
  postgresClient: any,
  config?: Partial<PostgresConfig>
): Promise<MemoryProvider>
```

### Memory Provider Configuration Schemas

#### In-Memory Provider
```typescript
const InMemoryConfigSchema = z.object({
  type: z.literal('memory'),
  maxConversations: z.number().default(1000),
  maxMessagesPerConversation: z.number().default(1000)
});

type InMemoryConfig = z.infer<typeof InMemoryConfigSchema>;
```

#### Redis Provider
```typescript
const RedisConfigSchema = z.object({
  type: z.literal('redis'),
  url: z.string().optional(),
  host: z.string().default('localhost'),
  port: z.number().default(6379),
  password: z.string().optional(),
  db: z.number().default(0),
  keyPrefix: z.string().default('jaf:memory:'),
  ttl: z.number().optional() // seconds
});

type RedisConfig = z.infer<typeof RedisConfigSchema>;
```

#### PostgreSQL Provider
```typescript
const PostgresConfigSchema = z.object({
  type: z.literal('postgres'),
  connectionString: z.string().optional(),
  host: z.string().default('localhost'),
  port: z.number().default(5432),
  database: z.string().default('jaf_memory'),
  username: z.string().default('postgres'),
  password: z.string().optional(),
  ssl: z.boolean().default(false),
  tableName: z.string().default('conversations'),
  maxConnections: z.number().default(10)
});

type PostgresConfig = z.infer<typeof PostgresConfigSchema>;
```

### Example Memory Usage
```typescript
import { createSimpleMemoryProvider } from '@xynehq/jaf';

// In-memory provider
const memoryProvider = await createSimpleMemoryProvider('memory');

// Redis provider (requires Redis client)
import Redis from 'ioredis';
const redis = new Redis();
const redisProvider = await createSimpleMemoryProvider('redis', redis);

// PostgreSQL provider (requires pg client)
import { Client } from 'pg';
const pg = new Client({ connectionString: 'postgresql://...' });
const pgProvider = await createSimpleMemoryProvider('postgres', pg);
```

---

## Model Providers

### `ModelProvider<Ctx>` Interface
```typescript
interface ModelProvider<Ctx> {
  getCompletion: (
    state: Readonly<RunState<Ctx>>,
    agent: Readonly<Agent<Ctx, any>>,
    config: Readonly<RunConfig<Ctx>>
  ) => Promise<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
}
```

### `makeLiteLLMProvider(baseURL, apiKey?)`

Creates a model provider compatible with LiteLLM or OpenAI-compatible APIs.

**Type Signature:**
```typescript
function makeLiteLLMProvider<Ctx>(
  baseURL: string,
  apiKey?: string
): ModelProvider<Ctx>
```

**Parameters:**
- `baseURL` - The base URL for the API endpoint
- `apiKey` - Optional API key (defaults to "anything" for local services)

**Example:**
```typescript
import { makeLiteLLMProvider } from '@xynehq/jaf';

// For local LiteLLM instance
const localProvider = makeLiteLLMProvider('http://localhost:4000');

// For OpenAI
const openaiProvider = makeLiteLLMProvider(
  'https://api.openai.com/v1',
  'your-api-key'
);
```

---

## Server Configuration

### `ServerConfig<Ctx>`
```typescript
interface ServerConfig<Ctx> {
  port?: number;
  host?: string;
  cors?: boolean;
  runConfig: RunConfig<Ctx>;
  agentRegistry: Map<string, Agent<Ctx, any>>;
  defaultMemoryProvider?: MemoryProvider;
}
```

### HTTP API Schemas

#### Chat Request
```typescript
const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string()
  })),
  agentName: z.string(),
  context: z.any().optional(),
  maxTurns: z.number().optional(),
  stream: z.boolean().default(false),
  conversationId: z.string().optional(),
  memory: z.object({
    autoStore: z.boolean().default(true),
    maxMessages: z.number().optional(),
    compressionThreshold: z.number().optional()
  }).optional()
});

type ChatRequest = z.infer<typeof chatRequestSchema>;
```

#### Chat Response
```typescript
const chatResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    runId: z.string(),
    traceId: z.string(),
    conversationId: z.string().optional(),
    messages: z.array(fullMessageSchema),
    outcome: z.object({
      status: z.enum(['completed', 'error', 'max_turns']),
      output: z.string().optional(),
      error: z.any().optional()
    }),
    turnCount: z.number(),
    executionTimeMs: z.number()
  }).optional(),
  error: z.string().optional()
});

type ChatResponse = z.infer<typeof chatResponseSchema>;
```

### Server Endpoints

The server provides the following REST endpoints:

- `GET /health` - Health check
- `GET /agents` - List available agents
- `POST /chat` - Chat with any agent
- `POST /agents/:agentName/chat` - Chat with specific agent
- `GET /conversations/:conversationId` - Get conversation history
- `DELETE /conversations/:conversationId` - Delete conversation
- `GET /memory/health` - Memory provider health check

---

## Error Handling

### `JAFError` Union Type
```typescript
type JAFError =
  | { readonly _tag: "MaxTurnsExceeded"; readonly turns: number }
  | { readonly _tag: "ModelBehaviorError"; readonly detail: string }
  | { readonly _tag: "DecodeError"; readonly errors: z.ZodIssue[] }
  | { readonly _tag: "InputGuardrailTripwire"; readonly reason: string }
  | { readonly _tag: "OutputGuardrailTripwire"; readonly reason: string }
  | { readonly _tag: "ToolCallError"; readonly tool: string; readonly detail: string }
  | { readonly _tag: "HandoffError"; readonly detail: string }
  | { readonly _tag: "AgentNotFound"; readonly agentName: string };
```

### `JAFErrorHandler` Class
```typescript
class JAFErrorHandler {
  static format(error: JAFError): string
  static isRetryable(error: JAFError): boolean
  static getSeverity(error: JAFError): 'low' | 'medium' | 'high' | 'critical'
}
```

### `createJAFError(tag, details)`
```typescript
function createJAFError(tag: JAFError['_tag'], details: any): JAFError
```

### Memory Error Types
```typescript
type MemoryErrorUnion = 
  | MemoryConnectionError 
  | MemoryNotFoundError 
  | MemoryStorageError;

type MemoryConnectionError = {
  readonly _tag: 'MemoryConnectionError';
  readonly message: string;
  readonly provider: string;
  readonly cause?: Error;
};

type MemoryNotFoundError = {
  readonly _tag: 'MemoryNotFoundError';
  readonly message: string;
  readonly conversationId: string;
  readonly provider: string;
};

type MemoryStorageError = {
  readonly _tag: 'MemoryStorageError';
  readonly message: string;
  readonly operation: string;
  readonly provider: string;
  readonly cause?: Error;
};
```

### Result Type for Memory Operations
```typescript
type Result<T, E = MemoryErrorUnion> = 
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

// Helper functions
function createSuccess<T>(data: T): Result<T>
function createFailure<E extends MemoryErrorUnion>(error: E): Result<never, E>
function isSuccess<T, E>(result: Result<T, E>): result is { success: true; data: T }
function isFailure<T, E>(result: Result<T, E>): result is { success: false; error: E }
```

---

## Validation and Policies

### `Guardrail<I>` Type
```typescript
type Guardrail<I> = (
  input: I
) => Promise<ValidationResult> | ValidationResult;
```

### Schema Validation

#### `JsonSchema` Interface
```typescript
interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  // String validations
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;  // 'email' | 'uri' | 'date' | 'date-time' | 'uuid'
  // Number validations
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
  multipleOf?: number;
  // Array validations
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  // Object validations
  additionalProperties?: boolean | JsonSchema;
}
```

#### Schema Validators

```typescript
// Create validators with full JSON Schema support
createSchemaValidator<T>(schema: JsonSchema, validator: TypeGuard<T>): SchemaValidator<T>

// Specific type validators
createStringValidator(options?: { minLength?, maxLength?, pattern?, format? }): SchemaValidator<string>
createNumberValidator(options?: { minimum?, maximum?, multipleOf? }): SchemaValidator<number>
createArrayValidator<T>(items: JsonSchema, options?: { minItems?, maxItems?, uniqueItems? }): SchemaValidator<T[]>
createObjectValidator<T>(properties: Record<string, JsonSchema>, required?: string[]): SchemaValidator<T>

// Validation utilities
validateInput<T>(validator: SchemaValidator<T>, data: unknown): ValidationResult<T>
validateOutput<T>(validator: SchemaValidator<T>, data: unknown): ValidationResult<T>
assertValid<T>(validator: SchemaValidator<T>, data: unknown): T  // Throws on invalid
isValid<T>(validator: SchemaValidator<T>, data: unknown): data is T
```

### Validation Functions

#### `composeValidations(...fns)`
```typescript
function composeValidations<A, Ctx>(
  ...fns: Array<(a: A, c: Ctx) => ValidationResult>
): (a: A, c: Ctx) => ValidationResult
```

Composes multiple validation functions into a single function.

#### `withValidation(tool, validate)`
```typescript
function withValidation<A, Ctx>(
  tool: Tool<A, Ctx>,
  validate: (a: A, ctx: Ctx) => ValidationResult
): Tool<A, Ctx>
```

Wraps a tool with validation logic.

#### `createPathValidator(allowedPaths, contextAccessor?)`
```typescript
function createPathValidator<Ctx>(
  allowedPaths: string[],
  contextAccessor?: (ctx: Ctx) => { permissions?: string[] }
): (args: { path: string }, ctx: Ctx) => ValidationResult
```

Creates a validator for file system paths.

#### `createContentFilter()`
```typescript
function createContentFilter(): Guardrail<string>
```

Creates a content filter that blocks sensitive information patterns.

#### `createRateLimiter(maxCalls, windowMs, keyExtractor)`
```typescript
function createRateLimiter<T>(
  maxCalls: number,
  windowMs: number,
  keyExtractor: (input: T) => string
): Guardrail<T>
```

Creates a rate limiting guardrail.

#### `createPermissionValidator(requiredPermission, contextAccessor)`
```typescript
function createPermissionValidator<Ctx>(
  requiredPermission: string,
  contextAccessor: (ctx: Ctx) => { permissions?: string[] }
): (args: any, ctx: Ctx) => ValidationResult
```

Creates a permission-based validator.

### Handoff Tool

#### `handoffTool`
```typescript
const handoffTool: Tool<{ agentName: string; reason: string }, any>
```

Pre-built tool for handing off conversations between agents.

**Example:**
```typescript
import { handoffTool } from '@xynehq/jaf';

const routerAgent = {
  name: 'router',
  instructions: 'Route conversations to appropriate agents',
  tools: [handoffTool],
  handoffs: ['weather', 'support', 'general']
};
```

---

## Tracing and Observability

### `TraceEvent` Union Type
```typescript
type TraceEvent =
  | { type: 'run_start'; data: { runId: RunId; traceId: TraceId; } }
  | { type: 'llm_call_start'; data: { agentName: string; model: string; } }
  | { type: 'llm_call_end'; data: { choice: any; } }
  | { type: 'tool_call_start'; data: { toolName: string; args: any; } }
  | { type: 'tool_call_end'; data: { toolName: string; result: string; toolResult?: any; status?: string; } }
  | { type: 'handoff'; data: { from: string; to: string; } }
  | { type: 'run_end'; data: { outcome: RunResult<any>['outcome'] } };
```

### `TraceCollector` Interface
```typescript
interface TraceCollector {
  collect(event: TraceEvent): void;
  getTrace(traceId: TraceId): TraceEvent[];
  getAllTraces(): Map<TraceId, TraceEvent[]>;
  clear(traceId?: TraceId): void;
}
```

### Trace Collector Implementations

#### `InMemoryTraceCollector`
```typescript
class InMemoryTraceCollector implements TraceCollector
```

Stores traces in memory.

#### `ConsoleTraceCollector`
```typescript
class ConsoleTraceCollector implements TraceCollector
```

Logs trace events to the console and stores them in memory.

#### `FileTraceCollector`
```typescript
class FileTraceCollector implements TraceCollector
```

**Constructor:**
```typescript
constructor(filePath: string)
```

Writes trace events to a file in JSON format.

#### `createCompositeTraceCollector(...collectors)`
```typescript
function createCompositeTraceCollector(...collectors: TraceCollector[]): TraceCollector
```

Combines multiple trace collectors.

**Example:**
```typescript
import { 
  ConsoleTraceCollector,
  FileTraceCollector,
  createCompositeTraceCollector 
} from '@xynehq/jaf';

const collector = createCompositeTraceCollector(
  new ConsoleTraceCollector(),
  new FileTraceCollector('./traces.jsonl')
);

const config = {
  // ... other config
  onEvent: collector.collect.bind(collector)
};
```

---

## Utility Functions

### ID Generation
```typescript
function generateTraceId(): TraceId
function generateRunId(): RunId
function createTraceId(id: string): TraceId
function createRunId(id: string): RunId
```

### Tool Result Conversion
```typescript
function toolResultToString(result: ToolResult): string
```

Converts a `ToolResult` object to a string representation for backward compatibility.

### Memory Error Factories
```typescript
function createMemoryError(
  message: string,
  code: string,
  provider: string,
  cause?: Error
): MemoryError

function createMemoryConnectionError(
  provider: string,
  cause?: Error
): MemoryConnectionError

function createMemoryNotFoundError(
  conversationId: string,
  provider: string
): MemoryNotFoundError

function createMemoryStorageError(
  operation: string,
  provider: string,
  cause?: Error
): MemoryStorageError
```

### Memory Error Type Guards
```typescript
function isMemoryError(error: any): error is MemoryErrorUnion
function isMemoryConnectionError(error: any): error is MemoryConnectionError
function isMemoryNotFoundError(error: any): error is MemoryNotFoundError
function isMemoryStorageError(error: any): error is MemoryStorageError
```

---

## Environment Variables

The framework supports the following environment variables for memory provider configuration:

### General Memory Configuration
- `JAF_MEMORY_TYPE` - Type of memory provider (`memory`, `redis`, `postgres`)

### In-Memory Provider
- `JAF_MEMORY_MAX_CONVERSATIONS` - Maximum conversations to store (default: 1000)
- `JAF_MEMORY_MAX_MESSAGES` - Maximum messages per conversation (default: 1000)

### Redis Provider
- `JAF_REDIS_HOST` - Redis host (default: localhost)
- `JAF_REDIS_PORT` - Redis port (default: 6379)
- `JAF_REDIS_PASSWORD` - Redis password
- `JAF_REDIS_DB` - Redis database number (default: 0)
- `JAF_REDIS_PREFIX` - Key prefix (default: jaf:memory:)
- `JAF_REDIS_TTL` - Time-to-live in seconds

### PostgreSQL Provider
- `JAF_POSTGRES_HOST` - PostgreSQL host (default: localhost)
- `JAF_POSTGRES_PORT` - PostgreSQL port (default: 5432)
- `JAF_POSTGRES_DB` - Database name (default: jaf_memory)
- `JAF_POSTGRES_USER` - Username (default: postgres)
- `JAF_POSTGRES_PASSWORD` - Password
- `JAF_POSTGRES_SSL` - Enable SSL (default: false)
- `JAF_POSTGRES_TABLE` - Table name (default: conversations)
- `JAF_POSTGRES_MAX_CONNECTIONS` - Max connections (default: 10)

---

## Complete Example

Here's a comprehensive example showcasing most of the framework's features:

```typescript
import { 
  runServer,
  makeLiteLLMProvider,
  createSimpleMemoryProvider,
  withValidation,
  createPathValidator,
  createContentFilter,
  ConsoleTraceCollector,
  ToolResponse,
  handoffTool,
  z 
} from '@xynehq/jaf';

// Define context type
interface AppContext {
  userId: string;
  permissions: string[];
  apiKeys: {
    weather: string;
  };
}

// Create tools
const weatherTool = {
  schema: {
    name: 'get_weather',
    description: 'Get current weather for a city',
    parameters: z.object({
      city: z.string().describe('City name'),
      units: z.enum(['celsius', 'fahrenheit']).default('celsius')
    })
  },
  execute: async (args: any, context: AppContext) => {
    return ToolResponse.success({
      city: args.city,
      temperature: 22,
      condition: 'sunny',
      units: args.units
    });
  }
};

// Add validation to tools
const validatedWeatherTool = withValidation(
  weatherTool,
  (args, ctx) => {
    if (!ctx.permissions.includes('weather_access')) {
      return { isValid: false, errorMessage: 'Weather access not permitted' };
    }
    return { isValid: true };
  }
);

// Define agents
const weatherAgent = {
  name: 'weather',
  instructions: (state: any) => 
    `You are a weather assistant for user ${state.context.userId}. 
     Provide helpful weather information using the available tools.`,
  tools: [validatedWeatherTool, handoffTool],
  handoffs: ['general'],
  modelConfig: { temperature: 0.1, maxTokens: 500 }
};

const generalAgent = {
  name: 'general',
  instructions: () => 
    'You are a general assistant. Help users with various tasks.',
  tools: [handoffTool],
  handoffs: ['weather']
};

async function main() {
  // Create providers
  const modelProvider = makeLiteLLMProvider('http://localhost:4000');
  const memoryProvider = await createSimpleMemoryProvider('memory');
  
  // Create trace collector
  const traceCollector = new ConsoleTraceCollector();
  
  // Create guardrails
  const contentFilter = createContentFilter();
  
  // Start server
  const server = await runServer<AppContext>(
    [weatherAgent, generalAgent],
    {
      modelProvider,
      maxTurns: 10,
      initialInputGuardrails: [contentFilter],
      onEvent: traceCollector.collect.bind(traceCollector)
    },
    {
      port: 3000,
      host: 'localhost',
      defaultMemoryProvider: memoryProvider
    }
  );
  
  console.log('Server started successfully!');
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    await server.stop();
    process.exit(0);
  });
}

main().catch(console.error);
```

This example demonstrates:
- Creating and configuring agents with tools
- Setting up model and memory providers  
- Adding validation and guardrails
- Enabling tracing and observability
- Starting a development server
- Handling graceful shutdown

---

## Multi-Agent Coordination Features

### Intelligent Agent Selection

The framework now includes intelligent agent selection based on keyword matching when using the `conditional` delegation strategy:

```typescript
// How intelligent selection works:
// 1. Extracts keywords from user message (removing common words)
// 2. Scores each agent based on:
//    - Name matches (+3 points)
//    - Instruction matches (+2 points)  
//    - Tool name matches (+2 points)
//    - Tool description matches (+1 point)
// 3. Selects the highest-scoring agent

const coordinator: Agent<Context, any> = {
  name: 'smart_coordinator',
  instructions: 'Route to the best specialist',
  tools: [],
  subAgents: [weatherAgent, newsAgent, calculatorAgent],
  delegationStrategy: 'conditional' // Uses intelligent selection
};
```

### Parallel Response Merging

The parallel execution strategy now intelligently merges responses from multiple agents:

```typescript
const parallelAgent: Agent<Context, any> = {
  name: 'parallel_researcher',
  instructions: 'Research multiple topics simultaneously',
  tools: [],
  subAgents: [dataAgent, analysisAgent, reportAgent],
  delegationStrategy: 'parallel'
};

// Merged response includes:
// - Agent-prefixed text: "[dataAgent]: Data collected..."
// - Agent-prefixed artifacts: "dataAgent_results"
// - Combined response parts from all agents
```

### Coordination Rules

Define custom rules for fine-grained control over agent delegation:

```typescript
interface CoordinationRule {
  condition: (message: Content, context: RunContext) => boolean;
  action: 'delegate' | 'parallel' | 'sequential';
  targetAgents?: string[];
}

const multiAgentConfig: MultiAgentConfig = {
  name: 'advanced_coordinator',
  model: 'gpt-4',
  instruction: 'Coordinate based on rules',
  tools: [],
  subAgents: [agent1, agent2, agent3],
  delegationStrategy: 'conditional',
  coordinationRules: [
    {
      condition: (msg, ctx) => msg.parts.some(p => p.text?.includes('urgent')),
      action: 'parallel',
      targetAgents: ['agent1', 'agent2']
    },
    {
      condition: (msg, ctx) => msg.parts.some(p => p.text?.includes('analyze')),
      action: 'delegate',
      targetAgents: ['analysis_agent']
    }
  ]
};
```

---

## Enhanced Schema Validation

The schema validation system now supports comprehensive JSON Schema features:

### String Format Validation

```typescript
const emailValidator = createStringValidator({ format: 'email' });
const urlValidator = createStringValidator({ format: 'uri' });
const dateValidator = createStringValidator({ format: 'date' });
const uuidValidator = createStringValidator({ format: 'uuid' });
const ipv4Validator = createStringValidator({ format: 'ipv4' });
const ipv6Validator = createStringValidator({ format: 'ipv6' });
```

### Number Validation Features

```typescript
const ageValidator = createNumberValidator({
  minimum: 0,
  maximum: 150,
  integer: true // Must be whole number
});

const priceValidator = createNumberValidator({
  minimum: 0,
  exclusiveMinimum: true, // > 0, not >= 0
  multipleOf: 0.01 // Currency precision
});
```

### Array Validation with Unique Items

```typescript
const uniqueTagsValidator = createArrayValidator(
  stringSchema(),
  {
    minItems: 1,
    maxItems: 10,
    uniqueItems: true // Deep equality check
  }
);
```

### Object Property Constraints

```typescript
const userSchema = objectSchema(
  {
    name: stringSchema({ minLength: 1 }),
    email: stringSchema({ format: 'email' }),
    age: numberSchema({ minimum: 0, integer: true })
  },
  ['name', 'email'], // Required fields
  {
    minProperties: 2,
    maxProperties: 10,
    additionalProperties: false
  }
);
```

---

## Visualization System

The visualization system now uses direct DOT generation instead of the graphviz npm package:

### DOT Generation Approach

```typescript
import { generateAgentGraph, generateToolGraph, generateRunnerGraph } from 'jaf/visualization';

// Generate visualizations with DOT
const agentResult = await generateAgentGraph(agents, {
  title: 'Agent Architecture',
  outputFormat: 'png',
  colorScheme: 'modern'
});

// DOT content is always available
if (!agentResult.success && agentResult.graphDot) {
  // Save DOT for manual processing
  writeFileSync('graph.dot', agentResult.graphDot);
  // Process manually: dot -Tpng graph.dot -o graph.png
}
```

### Built-in Color Schemes

- **default**: Professional blue-purple palette
- **modern**: Contemporary gradients with bold fonts
- **minimal**: Clean black-and-white design

### Fallback Mechanisms

1. Falls back to system Graphviz command if npm package fails
2. Provides DOT content even if generation fails
3. Supports manual DOT processing with standard Graphviz tools

---

## TypeScript Usage

The framework is built with TypeScript and provides full type safety. Key points:

1. **Generic Types**: Most interfaces are generic over context type `<Ctx>`
2. **Branded Types**: `TraceId` and `RunId` are branded for type safety
3. **Immutable Types**: All state and configuration types use `readonly` modifiers
4. **Zod Integration**: Schemas are defined using Zod for runtime validation
5. **Result Types**: Memory operations use functional `Result<T, E>` types

For the best development experience, ensure your TypeScript configuration includes:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "exactOptionalPropertyTypes": true
  }
}
```

This ensures you get full type checking and IntelliSense support for all framework APIs.