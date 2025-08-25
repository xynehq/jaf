# JAF Server API Documentation

The Juspay Agent Framework (JAF) provides a production-ready HTTP server that exposes agents through RESTful endpoints. This guide covers the complete server API, configuration options, and best practices for deployment.

## Table of Contents

- [Getting Started](#getting-started)
- [Server Configuration](#server-configuration)
- [HTTP Endpoints](#http-endpoints)
- [Authentication and CORS](#authentication-and-cors)
- [Memory Provider Integration](#memory-provider-integration)
- [Error Handling](#error-handling)
- [Development vs Production](#development-vs-production)
- [Performance and Scaling](#performance-and-scaling)
- [Complete Examples](#complete-examples)

## Getting Started

### Basic Server Setup

```typescript
import { runServer, makeLiteLLMProvider, createInMemoryProvider } from '@xynehq/jaf';

const myAgent = {
  name: 'MyAgent',
  instructions: () => 'You are a helpful assistant',
  tools: []
};

const modelProvider = makeLiteLLMProvider('http://localhost:4000');
const memoryProvider = createInMemoryProvider();

const server = await runServer(
  [myAgent], 
  { modelProvider },
  { port: 3000, defaultMemoryProvider: memoryProvider }
);
```

### Using createJAFServer for Advanced Configuration

```typescript
import { createJAFServer } from '@xynehq/jaf/server';

const server = createJAFServer({
  port: 3000,
  host: '0.0.0.0',
  cors: true,
  runConfig: {
    agentRegistry: new Map([['MyAgent', myAgent]]),
    modelProvider,
    maxTurns: 10,
    memory: {
      provider: memoryProvider,
      autoStore: true,
      maxMessages: 100
    }
  },
  agentRegistry: new Map([['MyAgent', myAgent]]),
  defaultMemoryProvider: memoryProvider
});

await server.start();
```

## Server Configuration

### ServerConfig Interface

```typescript
interface ServerConfig<Ctx> {
  port?: number;                    // Default: 3000
  host?: string;                    // Default: '127.0.0.1'
  cors?: boolean;                   // Default: false
  runConfig: RunConfig<Ctx>;        // Required: Framework run configuration
  agentRegistry: Map<string, Agent<Ctx, any>>; // Required: Available agents
  defaultMemoryProvider?: MemoryProvider;      // Optional: Memory persistence
}
```

### runServer Parameters

The `runServer` function provides a simplified interface:

```typescript
async function runServer<Ctx>(
  agents: Map<string, Agent<Ctx, any>> | Agent<Ctx, any>[],
  runConfig: Omit<RunConfig<Ctx>, 'agentRegistry'>,
  options: Partial<Omit<ServerConfig<Ctx>, 'runConfig' | 'agentRegistry'>>
): Promise<ServerInstance>
```

**Parameters:**
- `agents`: Either an array of agents or a Map of agent name to agent
- `runConfig`: Framework configuration (modelProvider, maxTurns, etc.)
- `options`: Server-specific options (port, host, cors, memory provider)

## HTTP Endpoints

### Health Check

**GET /health**

Returns server health status and basic information.

```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "2.0.0",
  "uptime": 120000
}
```

### List Available Agents

**GET /agents**

Returns all registered agents with their descriptions and available tools.

```bash
curl http://localhost:3000/agents
```

**Response:**
```json
{
  "success": true,
  "data": {
    "agents": [
      {
        "name": "MathTutor",
        "description": "You are a helpful math tutor...",
        "tools": ["calculate"]
      },
      {
        "name": "ChatBot",
        "description": "You are a friendly chatbot...",
        "tools": ["greet"]
      }
    ]
  }
}
```

### Chat with Agent

**POST /chat**

Main endpoint for interacting with agents.

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "What is 15 * 7?"}
    ],
    "agentName": "MathTutor",
    "conversationId": "demo-conversation-1",
    "context": {"userId": "user123", "permissions": ["user"]},
    "maxTurns": 5,
    "memory": {
      "autoStore": true,
      "maxMessages": 100
    }
  }'
```

**Request Schema:**
```typescript
interface ChatRequest {
  messages: HttpMessage[];          // Required: Conversation messages
  agentName: string;               // Required: Target agent name
  context?: any;                   // Optional: Agent context
  maxTurns?: number;              // Optional: Override max turns
  stream?: boolean;               // Optional: When true, responds with Server-Sent Events (SSE)
  conversationId?: string;        // Optional: For conversation persistence
  memory?: {
    autoStore?: boolean;          // Default: true
    maxMessages?: number;         // Optional: Memory limit
    compressionThreshold?: number; // Optional: Compression trigger
  };
}

interface HttpMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
```

**Response (non-streaming):**
```json
{
  "success": true,
  "data": {
    "runId": "run_abc123",
    "traceId": "trace_def456",
    "conversationId": "demo-conversation-1",
    "messages": [
      {"role": "user", "content": "What is 15 * 7?"},
      {"role": "assistant", "content": "I'll calculate that for you.", "tool_calls": [...]},
      {"role": "tool", "content": "15 * 7 = 105", "tool_call_id": "call_123"},
      {"role": "assistant", "content": "15 × 7 equals 105."}
    ],
    "outcome": {
      "status": "completed",
      "output": "15 × 7 equals 105."
    },
    "turnCount": 2,
    "executionTimeMs": 1500
  }
}
```

#### Streaming Responses (SSE)

Set `stream: true` to receive a Server-Sent Events stream instead of a JSON response. The server keeps the HTTP connection open and pushes events as they happen. Each event name corresponds to a `TraceEvent.type`.

```bash
curl -N -H "Content-Type: application/json" \
  -X POST http://localhost:3000/chat \
  -d '{
    "messages": [{"role": "user", "content": "Hi, I am Alice. What time is it?"}],
    "agentName": "Assistant",
    "stream": true,
    "context": {"userId": "user123"}
  }'
```

SSE event format:
- Content-Type: `text/event-stream`
- Each event:
  - `event: <TraceEvent.type>`
  - `data: <JSON payload>`
  - blank line terminator

Example events you may see:
- `run_start`
- `llm_call_start` / `llm_call_end`
- `assistant_message`
- `tool_requests`
- `tool_call_start` / `tool_call_end`
- `tool_results_to_llm`
- `final_output`
- `run_end`

The stream starts with a `stream_start` event containing run metadata and ends with `stream_end` after `run_end`.

#### SSE Event Types and Payloads

Below is the list of SSE events you may receive when `stream: true` is set on `/chat` and their payload shapes. Events correspond to engine `TraceEvent`s unless noted.

| Event | Description | Payload (JSON) |
|------|-------------|----------------|
| `stream_start` | Server-only preface with metadata | `{ runId: string, traceId: string, conversationId?: string, agent: string }` |
| `run_start` | A new run has begun | `{ runId: string, traceId: string }` |
| `turn_start` | Turn started | `{ turn: number, agentName: string }` |
| `llm_call_start` | Engine is calling the model | `{ agentName: string, model: string }` |
| `llm_call_end` | Model responded (raw choice) | `{ choice: any }` |
| `token_usage` | Token usage reported by provider | `{ prompt?: number, completion?: number, total?: number, model?: string }` |
| `assistant_message` | Assistant message received from model | `{ message: { role: 'assistant', content?: string, tool_calls?: Array<{ id: string, type: 'function', function: { name: string, arguments: string } }> } }` |
| `tool_requests` | LLM requested tool invocations | `{ toolCalls: Array<{ id: string, name: string, args: any }>} ` |
| `tool_call_start` | Tool execution started | `{ toolName: string, args: any }` |
| `tool_call_end` | Tool execution finished | `{ toolName: string, result: string, toolResult?: any, status?: string }` |
| `tool_results_to_llm` | Tool results appended for next LLM turn | `{ results: Array<{ role: 'tool', content: string, tool_call_id?: string }> }` |
| `handoff` | Agent handoff occurred | `{ from: string, to: string }` |
| `handoff_denied` | Agent handoff was rejected | `{ from: string, to: string, reason: string }` |
| `guardrail_violation` | Input/output guardrail blocked output | `{ stage: 'input' | 'output', reason: string }` |
| `decode_error` | Output codec validation failed | `{ errors: any }` |
| `turn_end` | Turn finished | `{ turn: number, agentName: string }` |
| `final_output` | Final output before completion | `{ output: any }` |
| `run_end` | Run completed or failed | `{ outcome: { status: 'completed' | 'error', output?: any, error?: any } }` |
| `stream_end` | Server-only terminator | `{ ended: true }` |

### Agent-Specific Chat

**POST /agents/:agentName/chat**

Convenience endpoint for chatting with a specific agent.

```bash
curl -X POST http://localhost:3000/agents/MathTutor/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is 10 + 5?"}],
    "conversationId": "math-session-1",
    "context": {"userId": "user123"}
  }'
```

This endpoint automatically sets the `agentName` based on the URL parameter.

### Memory Management Endpoints

These endpoints are only available when a `defaultMemoryProvider` is configured.

#### Get Conversation

**GET /conversations/:conversationId**

Retrieve stored conversation history.

```bash
curl http://localhost:3000/conversations/demo-conversation-1
```

**Response:**
```json
{
  "success": true,
  "data": {
    "conversationId": "demo-conversation-1",
    "userId": "user123",
    "messages": [...],
    "metadata": {
      "createdAt": "2024-01-15T10:00:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z",
      "totalMessages": 8,
      "lastActivity": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

#### Delete Conversation

**DELETE /conversations/:conversationId**

Remove conversation from memory.

```bash
curl -X DELETE http://localhost:3000/conversations/demo-conversation-1
```

**Response:**
```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

#### Memory Health Check

**GET /memory/health**

Check memory provider health and connectivity.

```bash
curl http://localhost:3000/memory/health
```

**Response:**
```json
{
  "success": true,
  "data": {
    "healthy": true,
    "latencyMs": 12
  }
}
```

## Authentication and CORS

### CORS Configuration

CORS is disabled by default for security. Enable it for web applications:

```typescript
const server = await runServer(
  agents,
  runConfig,
  { 
    cors: true,  // Enables CORS with permissive settings
    port: 3000 
  }
);
```

**Default CORS Settings (when enabled):**
- `origin: true` (allows all origins)
- `methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']`
- `allowedHeaders: ['Content-Type', 'Authorization']`

### Authentication

JAF server doesn't provide built-in authentication. Implement authentication using:

1. **Reverse Proxy**: Use nginx, Apache, or cloud load balancers
2. **Custom Middleware**: Add Fastify hooks for authentication
3. **API Gateway**: Use AWS API Gateway, Kong, or similar solutions

Example custom authentication:

```typescript
const server = createJAFServer(config);

// Add authentication hook before starting
server.app.addHook('preHandler', async (request, reply) => {
  if (request.url.startsWith('/health')) return; // Skip health check
  
  const authHeader = request.headers.authorization;
  if (!authHeader || !isValidToken(authHeader)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
});

await server.start();
```

## Memory Provider Integration

### Server-Level Memory Configuration

Configure memory at the server level for automatic conversation persistence:

```typescript
const memoryProvider = createInMemoryProvider();

const server = await runServer(
  agents,
  { modelProvider },
  { 
    defaultMemoryProvider: memoryProvider,
    port: 3000 
  }
);
```

### Request-Level Memory Configuration

Override memory settings per request:

```json
{
  "messages": [...],
  "agentName": "Assistant",
  "conversationId": "session-123",
  "memory": {
    "autoStore": true,
    "maxMessages": 50,
    "compressionThreshold": 20
  }
}
```

### Memory Provider Types

#### In-Memory Provider
```typescript
import { createInMemoryProvider } from '@xynehq/jaf';

const memoryProvider = createInMemoryProvider({
  maxConversations: 1000,
  maxMessagesPerConversation: 1000
});
```

#### Redis Provider
```typescript
import { createRedisProvider } from '@xynehq/jaf';
import { createClient } from 'redis';

const redisClient = createClient({ url: 'redis://localhost:6379' });
await redisClient.connect();

const memoryProvider = await createRedisProvider({
  type: 'redis',
  keyPrefix: 'jaf:memory:',
  ttl: 3600 // 1 hour
}, redisClient);
```

#### PostgreSQL Provider
```typescript
import { createPostgresProvider } from '@xynehq/jaf';
import { Client } from 'pg';

const postgresClient = new Client({
  connectionString: 'postgresql://user:pass@localhost:5432/jaf'
});
await postgresClient.connect();

const memoryProvider = await createPostgresProvider({
  type: 'postgres',
  tableName: 'conversations'
}, postgresClient);
```

## Error Handling

### Standard Error Response Format

All endpoints return errors in a consistent format:

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

### Common HTTP Status Codes

- **200**: Success
- **400**: Bad Request (invalid JSON, missing required fields)
- **404**: Not Found (agent not found)
- **500**: Internal Server Error (agent execution failed, memory provider error)
  
Note: For streaming (`stream: true`), a successful connection returns `200` and remains open until the run finishes or the client disconnects.
- **503**: Service Unavailable (memory provider not configured)

### Agent Execution Errors

When agent execution fails, the response includes detailed error information:

```json
{
  "success": true,
  "data": {
    "outcome": {
      "status": "error",
      "error": {
        "_tag": "ToolCallError",
        "tool": "calculate",
        "detail": "Invalid expression"
      }
    },
    "turnCount": 1,
    "executionTimeMs": 500
  }
}
```

### Memory Provider Errors

Memory-related endpoints return specific error information:

```json
{
  "success": false,
  "error": "Memory provider not configured"
}
```

```json
{
  "success": false,
  "error": "Conversation not found",
  "details": {
    "_tag": "MemoryNotFoundError",
    "conversationId": "missing-conversation",
    "provider": "redis"
  }
}
```

## Development vs Production

### Development Configuration

```typescript
const server = await runServer(
  agents,
  {
    modelProvider: makeLiteLLMProvider('http://localhost:4000'),
    maxTurns: 10,
    onEvent: new ConsoleTraceCollector().collect
  },
  {
    port: 3000,
    host: '127.0.0.1',  // Local only
    cors: true,          // Permissive for development
    defaultMemoryProvider: createInMemoryProvider()
  }
);
```

### Production Configuration

```typescript
const server = await runServer(
  agents,
  {
    modelProvider: makeLiteLLMProvider(process.env.LITELLM_URL, process.env.LITELLM_API_KEY),
    maxTurns: 5,
    onEvent: productionTraceCollector.collect
  },
  {
    port: parseInt(process.env.PORT || '3000'),
    host: '0.0.0.0',     // Accept external connections
    cors: false,         // Use reverse proxy for CORS
    defaultMemoryProvider: await createPostgresProvider(/* production config */)
  }
);
```

### Environment Variables

```bash
# Server Configuration
PORT=3000
HOST=0.0.0.0

# Model Provider
LITELLM_URL=https://api.litellm.ai
LITELLM_API_KEY=your_api_key
LITELLM_MODEL=gpt-4

# Memory Provider
JAF_MEMORY_TYPE=postgres
JAF_POSTGRES_CONNECTION_STRING=postgresql://user:pass@localhost:5432/jaf
JAF_POSTGRES_SSL=true

# Or for Redis
JAF_MEMORY_TYPE=redis
JAF_REDIS_URL=redis://localhost:6379
JAF_REDIS_PASSWORD=your_password
```

## Performance and Scaling

### Server Performance

The JAF server is built on Fastify for high performance:

- **Async/Await**: All handlers are fully asynchronous
- **Schema Validation**: Request validation using JSON Schema/Zod
- **Connection Pooling**: Automatic connection management for memory providers
- **Graceful Shutdown**: Proper cleanup of resources

### Scaling Considerations

#### Horizontal Scaling

- **Stateless Design**: Agents are stateless; conversations persist in external memory
- **Load Balancing**: Use any HTTP load balancer (nginx, HAProxy, AWS ALB)
- **Shared Memory**: Use Redis or PostgreSQL for shared conversation state

#### Vertical Scaling

- **Memory Usage**: In-memory provider scales with conversation count
- **CPU Usage**: Depends on agent complexity and tool execution
- **I/O**: External memory providers add latency but enable scaling

#### Production Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Client    │    │   Client    │    │   Client    │
└─────────────┘    └─────────────┘    └─────────────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                  ┌─────────────┐
                  │Load Balancer│
                  └─────────────┘
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ JAF Server  │    │ JAF Server  │    │ JAF Server  │
│   Instance  │    │   Instance  │    │   Instance  │
└─────────────┘    └─────────────┘    └─────────────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                  ┌─────────────┐
                  │   Redis/    │
                  │ PostgreSQL  │
                  └─────────────┘
```

### Monitoring and Observability

#### Built-in Logging

JAF server includes structured logging via Fastify:

```typescript
// Logs are automatically generated for:
// - Request/response cycles
// - Agent execution times
// - Memory provider operations
// - Error conditions
```

#### Custom Tracing

Implement custom event collection:

```typescript
import { TraceCollector } from '@xynehq/jaf';

class ProductionTraceCollector implements TraceCollector {
  collect(event: TraceEvent): void {
    // Send to your monitoring system
    // (DataDog, New Relic, custom metrics)
    console.log(`[${event.type}]`, event.data);
  }
}

const server = await runServer(
  agents,
  {
    modelProvider,
    onEvent: new ProductionTraceCollector().collect
  },
  options
);
```

#### Health Monitoring

Monitor these endpoints for service health:

- `GET /health` - Server availability
- `GET /memory/health` - Memory provider connectivity
- `GET /agents` - Agent registry status

## Complete Examples

### Basic Chat Server

```typescript
import { runServer, makeLiteLLMProvider, createInMemoryProvider } from '@xynehq/jaf';

const chatAgent = {
  name: 'ChatBot',
  instructions: () => 'You are a helpful assistant',
  tools: []
};

async function startChatServer() {
  const server = await runServer(
    [chatAgent],
    {
      modelProvider: makeLiteLLMProvider('http://localhost:4000'),
      maxTurns: 10
    },
    {
      port: 3000,
      cors: true,
      defaultMemoryProvider: createInMemoryProvider()
    }
  );
  
  console.log('Chat server running on http://localhost:3000');
}

startChatServer().catch(console.error);
```

### Multi-Agent Server with Persistence

```typescript
import { runServer, makeLiteLLMProvider, createRedisProvider } from '@xynehq/jaf';
import { createClient } from 'redis';

const mathAgent = {
  name: 'MathTutor',
  instructions: () => 'You are a math tutor',
  tools: [calculatorTool]
};

const chatAgent = {
  name: 'ChatBot', 
  instructions: () => 'You are a friendly chatbot',
  tools: [greetingTool]
};

async function startProductionServer() {
  // Set up Redis for persistence
  const redisClient = createClient({ url: process.env.REDIS_URL });
  await redisClient.connect();
  
  const memoryProvider = await createRedisProvider({
    type: 'redis',
    keyPrefix: 'jaf:prod:',
    ttl: 86400 // 24 hours
  }, redisClient);

  const server = await runServer(
    [mathAgent, chatAgent],
    {
      modelProvider: makeLiteLLMProvider(
        process.env.LITELLM_URL,
        process.env.LITELLM_API_KEY
      ),
      maxTurns: 5,
      memory: {
        provider: memoryProvider,
        autoStore: true,
        maxMessages: 100
      }
    },
    {
      port: parseInt(process.env.PORT || '3000'),
      host: '0.0.0.0',
      cors: false, // Use reverse proxy
      defaultMemoryProvider: memoryProvider
    }
  );

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await server.stop();
    await redisClient.quit();
    process.exit(0);
  });
}

startProductionServer().catch(console.error);
```

### Advanced Server with Custom Middleware

```typescript
import { createJAFServer } from '@xynehq/jaf/server';

async function startAdvancedServer() {
  const server = createJAFServer({
    port: 3000,
    host: '0.0.0.0',
    cors: true,
    runConfig: {
      agentRegistry: new Map([
        ['MathTutor', mathAgent],
        ['ChatBot', chatAgent]
      ]),
      modelProvider: makeLiteLLMProvider('http://localhost:4000'),
      maxTurns: 10
    },
    agentRegistry: new Map([
      ['MathTutor', mathAgent],
      ['ChatBot', chatAgent]
    ]),
    defaultMemoryProvider: memoryProvider
  });

  // Add custom authentication
  server.app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/health') return;
    
    const apiKey = request.headers['x-api-key'];
    if (!apiKey || !isValidApiKey(apiKey)) {
      return reply.code(401).send({ error: 'Invalid API key' });
    }
  });

  // Add request logging
  server.app.addHook('preHandler', async (request, reply) => {
    console.log(`${request.method} ${request.url}`, {
      headers: request.headers,
      query: request.query
    });
  });

  // Add custom routes
  server.app.get('/metrics', async (request, reply) => {
    return {
      requestCount: getRequestCount(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  });

  await server.start();
}

function isValidApiKey(key: string): boolean {
  return key === process.env.API_KEY;
}

startAdvancedServer().catch(console.error);
```

### Testing the Server

```typescript
// Test script
async function testServer() {
  const baseUrl = 'http://localhost:3000';
  
  // Health check
  const health = await fetch(`${baseUrl}/health`);
  console.log('Health:', await health.json());
  
  // List agents
  const agents = await fetch(`${baseUrl}/agents`);
  console.log('Agents:', await agents.json());
  
  // Chat with agent
  const chatResponse = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Hello!' }],
      agentName: 'ChatBot',
      conversationId: 'test-conversation'
    })
  });
  
  console.log('Chat:', await chatResponse.json());
}

testServer().catch(console.error);
```

This comprehensive guide covers all aspects of the JAF server API. The server provides a robust, scalable foundation for deploying JAF agents in production environments with full conversation persistence, error handling, and monitoring capabilities.
