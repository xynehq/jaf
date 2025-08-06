# A2A Protocol Integration for JAF

This document describes the pure functional implementation of Agent2Agent (A2A) protocol support in the Juspay Agent Framework (JAF).

## Overview

The A2A integration allows JAF agents to communicate with other A2A-compatible agents using the standardized A2A protocol while maintaining JAF's core functional programming principles.

## Key Features

- **Pure Functional Implementation**: All A2A functionality implemented as pure functions
- **Zero Breaking Changes**: Existing JAF agents work unchanged
- **Automatic Protocol Translation**: JAF ↔ A2A message conversion
- **Agent Discovery**: Automatic Agent Card generation
- **Multiple Transport Support**: JSON-RPC over HTTP(S) 
- **Streaming Support**: Server-Sent Events for real-time updates
- **Type Safety**: Full TypeScript support with schema validation

## Quick Start

### 1. Create an A2A-Compatible Agent

```typescript
import { createA2AAgent, createA2ATool } from 'functional-agent-framework/a2a';
import { z } from 'zod';

const weatherAgent = createA2AAgent({
  name: 'weather_assistant',
  description: 'Weather information and travel planning',
  instruction: 'You help users with weather information and travel planning.',
  
  tools: [
    createA2ATool({
      name: 'get_weather',
      description: 'Get current weather for a location',
      parameters: z.object({
        location: z.string(),
        units: z.enum(['celsius', 'fahrenheit']).default('celsius')
      }),
      execute: async ({ location, units }) => {
        return `Weather in ${location}: 22°${units === 'celsius' ? 'C' : 'F'}, sunny`;
      }
    })
  ]
});
```

### 2. Start A2A Server

```typescript
import { startA2AServer } from 'functional-agent-framework/a2a';

const server = await startA2AServer({
  agents: new Map([
    ['weather', weatherAgent]
  ]),
  agentCard: {
    name: 'Weather Service',
    description: 'Weather and travel assistance',
    version: '1.0.0',
    provider: {
      organization: 'My Company',
      url: 'https://mycompany.com'
    }
  },
  port: 3000
});
```

### 3. Connect A2A Client

```typescript
import { connectToA2AAgent } from 'functional-agent-framework/a2a';

const agent = await connectToA2AAgent('http://localhost:3000');

// Simple usage
const response = await agent.ask('What\'s the weather in Tokyo?');
console.log(response);

// Streaming usage
for await (const update of agent.stream('Plan a trip to Paris')) {
  console.log(update);
}
```

## Core Concepts

### Pure Functional Design

All A2A functionality is implemented using pure functions:

```typescript
// Pure function to create A2A message
const createA2AMessage = (text: string, sessionId: string): A2AMessage => ({
  role: 'user',
  parts: [{ kind: 'text', text }],
  messageId: `msg_${Date.now()}`,
  contextId: sessionId,
  kind: 'message'
});

// Pure function to process agent query
const processAgentQuery = async function* (
  agent: A2AAgent,
  query: string,
  state: AgentState,
  modelProvider: any
): AsyncGenerator<StreamEvent> {
  // Pure functional processing...
};
```

### Immutable State

All state is immutable and passed explicitly:

```typescript
type AgentState = {
  readonly sessionId: string;
  readonly messages: readonly any[];
  readonly context: Readonly<Record<string, any>>;
  readonly artifacts: readonly any[];
  readonly timestamp: string;
};

// State updates return new objects
const addMessageToState = (state: AgentState, message: any): AgentState => ({
  ...state,
  messages: [...state.messages, message],
  timestamp: new Date().toISOString()
});
```

### Protocol Translation

JAF messages are automatically translated to/from A2A format:

```typescript
// JAF Message -> A2A Message
const jafMessage = { role: 'user', content: 'Hello' };
const a2aMessage = {
  role: 'user',
  parts: [{ kind: 'text', text: 'Hello' }],
  messageId: 'msg_123',
  kind: 'message'
};

// A2A Message -> JAF Message  
const extractedText = a2aMessage.parts
  .filter(part => part.kind === 'text')
  .map(part => part.text)
  .join('\n');
```

## A2A Protocol Features

### Agent Discovery

Agents automatically expose Agent Cards for discovery:

```typescript
// GET /.well-known/agent-card
{
  "protocolVersion": "0.3.0",
  "name": "Weather Assistant",
  "description": "Weather information and travel planning",
  "url": "http://localhost:3000/a2a",
  "skills": [
    {
      "id": "weather-lookup",
      "name": "Weather Information", 
      "description": "Get current weather conditions",
      "tags": ["weather", "forecast"]
    }
  ]
}
```

### JSON-RPC Methods

Supported A2A methods:

- `message/send` - Send a message and get response
- `message/stream` - Send a message and stream responses
- `tasks/get` - Get task status and history
- `tasks/cancel` - Cancel a running task
- `agent/getAuthenticatedExtendedCard` - Get extended agent information

### Message Types

Support for all A2A message parts:

```typescript
// Text messages
{ kind: 'text', text: 'Hello world' }

// Structured data
{ kind: 'data', data: { key: 'value' } }

// File attachments  
{ kind: 'file', file: { uri: 'https://example.com/file.pdf' } }
```

### Task Management

Tasks represent ongoing conversations:

```typescript
type A2ATask = {
  readonly id: string;
  readonly contextId: string;
  readonly status: {
    readonly state: 'submitted' | 'working' | 'completed' | 'failed';
    readonly timestamp: string;
  };
  readonly history: readonly A2AMessage[];
  readonly artifacts: readonly A2AArtifact[];
};
```

## Advanced Usage

### Form-Based Interactions

Agents can request user input via forms:

```typescript
createA2ATool({
  name: 'create_travel_form',
  description: 'Create travel planning form',
  parameters: z.object({
    destination: z.string().optional(),
    dates: z.string().optional()
  }),
  execute: async ({ destination, dates }, context) => {
    // Mark as requiring input
    context.actions.requiresInput = true;
    
    return JSON.stringify({
      type: 'form',
      form: {
        type: 'object',
        properties: {
          destination: { type: 'string', title: 'Destination' },
          dates: { type: 'string', title: 'Travel Dates' }
        }
      },
      form_data: { destination, dates }
    });
  }
})
```

### Multi-Agent Workflows

Agents can communicate with each other:

```typescript
// Agent A calls Agent B via A2A
const response = await sendMessageToAgent(
  client,
  'travel-planner',
  'Plan trip based on this weather data',
  { weatherContext: weatherData }
);
```

### Streaming Responses

Real-time streaming via Server-Sent Events:

```typescript
for await (const event of streamMessage(client, 'Complex planning task')) {
  switch (event.kind) {
    case 'status-update':
      console.log(`Status: ${event.status.state}`);
      break;
    case 'artifact-update':
      console.log(`New artifact: ${event.artifact.name}`);
      break;
  }
}
```

## API Reference

### Agent Creation

#### `createA2AAgent(config)`

Creates an A2A-compatible agent.

**Parameters:**
- `config.name` - Agent name
- `config.description` - Agent description  
- `config.instruction` - System instruction
- `config.tools` - Array of A2A tools
- `config.supportedContentTypes` - Supported MIME types

#### `createA2ATool(config)`

Creates an A2A-compatible tool.

**Parameters:**
- `config.name` - Tool name
- `config.description` - Tool description
- `config.parameters` - Zod schema for parameters
- `config.execute` - Async execution function

### Server Functions

#### `startA2AServer(config)`

Starts A2A-enabled server.

**Parameters:**
- `config.agents` - Map of agent name to agent
- `config.agentCard` - Agent card configuration
- `config.port` - Server port
- `config.host` - Server host

#### `createA2AServer(config)`

Creates server instance without starting.

### Client Functions

#### `createA2AClient(baseUrl, config?)`

Creates A2A client instance.

#### `connectToA2AAgent(url)`

Convenience function to connect to agent.

#### `sendMessage(client, message, config?)`

Send message and wait for response.

#### `streamMessage(client, message, config?)`

Send message and stream responses.

#### `getAgentCard(client)`

Get agent discovery information.

## Error Handling

A2A errors follow JSON-RPC standards:

```typescript
{
  "jsonrpc": "2.0",
  "id": "123", 
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": { "details": "..." }
  }
}
```

Standard A2A error codes:
- `-32001` - Task not found
- `-32002` - Task not cancelable  
- `-32003` - Push notifications not supported
- `-32004` - Unsupported operation
- `-32005` - Content type not supported

## Examples

### Complete Weather Agent

See `src/a2a/examples/weather-agent.ts` for a full implementation.

### Multi-Agent Server

See `src/a2a/examples/server-example.ts` for multiple agents.

### Client Usage

See `src/a2a/examples/client-example.ts` for comprehensive client examples.

## Testing

Run the examples:

```bash
# Start A2A server with example agents
npm run a2a:example

# Run client demonstrations  
npm run a2a:client

# Development with auto-reload
npm run a2a:dev
```

## Integration with Existing JAF

A2A integration is designed to be additive:

1. **Existing agents** work unchanged
2. **Existing server** gains A2A endpoints
3. **New A2A features** are opt-in
4. **Functional principles** maintained throughout

The integration provides a bridge between JAF's functional agent system and the broader A2A ecosystem while preserving all of JAF's core principles.