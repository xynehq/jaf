# FAF ADK Layer

The **Functional Agent Development Kit (ADK) Layer** brings Google ADK-style functionality to FAF while maintaining FAF's core principles of functional purity and simplicity.

## Overview

The FAF ADK Layer provides:

- **Functional Agent System**: Create and manage agents using pure functions
- **Rich Tool Ecosystem**: Support for OpenAPI, CrewAI, LangChain, and custom tools
- **Multi-Agent Coordination**: Hierarchical and conditional agent delegation
- **Schema Validation**: Type-safe input/output validation
- **Streaming Support**: Real-time bidirectional communication
- **Session Management**: Pluggable persistence with multiple providers
- **Guardrails**: Content moderation and safety mechanisms
- **No Classes**: 100% functional implementation following FAF principles

## Quick Start

### Simple Agent

```typescript
import { quickSetup, createUserMessage } from 'faf/adk';

// Create a simple agent with tools
const { run } = quickSetup(
  'my_agent',
  'gemini-2.0-flash',
  'You are a helpful assistant',
  [] // tools array
);

// Use the agent
const response = await run(
  { userId: 'user123' },
  createUserMessage('Hello!')
);

console.log(response.content.parts[0].text);
```

### Agent with Tools

```typescript
import { 
  createAgent, 
  createFunctionTool, 
  createInMemorySessionProvider,
  createRunnerConfig,
  runAgent 
} from 'faf/adk';

// Create a tool
const weatherTool = createFunctionTool(
  'get_weather',
  'Get current weather',
  ({ location }: { location: string }) => ({
    location,
    temperature: 22,
    condition: 'sunny'
  }),
  [
    {
      name: 'location',
      type: 'string',
      description: 'City name',
      required: true
    }
  ]
);

// Create agent
const agent = createAgent({
  name: 'weather_agent',
  model: 'gemini-2.0-flash',
  instruction: 'Use the weather tool to provide accurate information',
  tools: [weatherTool]
});

// Setup execution
const sessionProvider = createInMemorySessionProvider();
const runnerConfig = createRunnerConfig(agent, sessionProvider);

// Run the agent
const response = await runAgent(
  runnerConfig,
  { userId: 'user123' },
  createUserMessage('What\'s the weather in Tokyo?')
);
```

### Streaming

```typescript
import { runAgentStream } from 'faf/adk';

const events = runAgentStream(
  runnerConfig,
  { userId: 'user123' },
  createUserMessage('Tell me a story')
);

for await (const event of events) {
  if (event.type === 'message_delta' && event.content) {
    process.stdout.write(event.content.parts[0].text || '');
  }
}
```

### Multi-Agent System

```typescript
import { createMultiAgent } from 'faf/adk';

const coordinator = createMultiAgent(
  'coordinator',
  'gemini-2.0-flash',
  'Coordinate between specialist agents',
  [weatherAgent, newsAgent, calcAgent],
  'conditional' // delegation strategy
);
```

## Core Concepts

### Agents

Agents are created using pure functions and configuration objects:

```typescript
const agent = createAgent({
  name: 'my_agent',
  model: 'gemini-2.0-flash',
  instruction: 'Agent behavior description',
  tools: [tool1, tool2],
  subAgents: [childAgent1, childAgent2], // Optional
  inputSchema: inputValidator, // Optional
  outputSchema: outputValidator, // Optional
  guardrails: [guardrail1, guardrail2] // Optional
});
```

### Tools

Tools are functions that agents can call:

```typescript
const tool = createFunctionTool(
  'tool_name',
  'Tool description',
  (params) => { /* implementation */ },
  [/* parameter definitions */]
);
```

### Sessions

Sessions manage conversation state:

```typescript
// In-memory sessions
const sessionProvider = createInMemorySessionProvider();

// Redis sessions
const sessionProvider = createRedisSessionProvider({
  host: 'localhost',
  port: 6379
});

// PostgreSQL sessions
const sessionProvider = createPostgresSessionProvider({
  connectionString: 'postgresql://...'
});
```

### Schema Validation

Type-safe input/output validation:

```typescript
interface WeatherQuery {
  location: string;
  units?: 'celsius' | 'fahrenheit';
}

const validator = createObjectValidator<WeatherQuery>(
  {
    location: stringSchema({ description: 'City name' }),
    units: stringSchema({ 
      enum: ['celsius', 'fahrenheit'],
      default: 'celsius'
    })
  },
  ['location']
);
```

### Guardrails

Content moderation and safety:

```typescript
const contentGuardrail: GuardrailFunction = async (message, context) => {
  if (containsInappropriateContent(message)) {
    return {
      allowed: false,
      reason: 'Inappropriate content detected'
    };
  }
  return { allowed: true };
};
```

## Architecture

### Functional Design

The ADK Layer follows FAF's functional principles:

- **No Classes**: All functionality is implemented as pure functions
- **Immutable State**: State is passed explicitly through function parameters
- **Composition**: Complex behaviors built through function composition
- **Type Safety**: Full TypeScript typing throughout

### Directory Structure

```
src/adk/
├── agents/         # Agent creation and management
├── content/        # Message and content handling
├── runners/        # Agent execution system
├── schemas/        # Schema validation
├── sessions/       # Session management
├── streaming/      # Streaming and live interaction
├── tools/          # Tool creation and execution
├── types.ts        # Core type definitions
├── index.ts        # Main exports
└── examples/       # Usage examples
```

## Examples

The `examples/` directory contains comprehensive examples:

- **`basic-agent.ts`**: Simple agents, tools, and streaming
- **`multi-agent.ts`**: Multi-agent coordination and delegation
- **`advanced-features.ts`**: Schema validation, guardrails, and monitoring

Run examples:

```bash
# Basic examples
npx ts-node src/adk/examples/basic-agent.ts

# Multi-agent examples
npx ts-node src/adk/examples/multi-agent.ts

# Advanced features
npx ts-node src/adk/examples/advanced-features.ts
```

## Integration with External Tools

### OpenAPI Integration

```typescript
import { createOpenAPIToolset } from 'faf/adk';

const tools = await createOpenAPIToolset(openApiSpec);
const agent = createAgent({
  name: 'api_agent',
  model: 'gemini-2.0-flash',
  instruction: 'Use API tools to help users',
  tools
});
```

### CrewAI Integration

```typescript
import { createCrewAIAdapter } from 'faf/adk';
import { SomeCrewAITool } from 'crewai-tools';

const crewAITool = new SomeCrewAITool();
const adkTool = createCrewAIAdapter(crewAITool);
```

### LangChain Integration

```typescript
import { createLangChainAdapter } from 'faf/adk';
import { SomeLangChainTool } from 'langchain/tools';

const langChainTool = new SomeLangChainTool();
const adkTool = createLangChainAdapter(langChainTool);
```

## Advanced Features

### Monitoring and Metrics

```typescript
import { monitorStream, metricsMonitor } from 'faf/adk';

const metrics = metricsMonitor();
const monitoredStream = monitorStream(eventStream, metrics.monitor);

// Get metrics
console.log(metrics.getMetrics());
```

### Stream Processing

```typescript
import { 
  filterEventStream, 
  combineStreams, 
  createBufferedStream 
} from 'faf/adk';

// Filter events
const messageEvents = filterEventStream(stream, isMessageEvent);

// Combine streams
const combined = combineStreams(stream1, stream2, stream3);

// Buffer events
const buffered = createBufferedStream(stream, 10);
```

### Bidirectional Communication

```typescript
import { createBidirectionalStream } from 'faf/adk';

const biStream = createBidirectionalStream();

// Send messages
await biStream.send(createUserMessage('Hello'));

// Receive events
for await (const event of biStream.receive()) {
  console.log('Received:', event);
}
```

## Error Handling

The ADK Layer provides comprehensive error handling:

```typescript
import { 
  AgentError, 
  ToolError, 
  SessionError, 
  ValidationError 
} from 'faf/adk';

try {
  const response = await runAgent(config, context, message);
} catch (error) {
  if (error instanceof AgentError) {
    console.log('Agent error:', error.message);
  } else if (error instanceof ToolError) {
    console.log('Tool error in:', error.toolName);
  }
}
```

## Performance Considerations

### Memory Management

- Sessions are automatically cleaned up
- Use appropriate session providers for your scale
- Consider pagination for large conversation histories

### Streaming Optimization

- Use buffered streams for high-throughput scenarios
- Implement appropriate backpressure handling
- Monitor stream metrics for performance insights

### Tool Execution

- Tools execute asynchronously by default
- Consider timeout configuration for long-running tools
- Use parallel execution where appropriate

## Migration from Google ADK

The FAF ADK Layer provides functional equivalents for all major Google ADK concepts:

| Google ADK | FAF ADK Layer |
|------------|---------------|
| `LlmAgent()` | `createAgent()` |
| `Runner()` | `createRunnerConfig()` + `runAgent()` |
| `InMemorySessionService()` | `createInMemorySessionProvider()` |
| `FunctionTool()` | `createFunctionTool()` |
| `OpenAPIToolset()` | `createOpenAPIToolset()` |
| `runner.run_async()` | `runAgent()` |
| `runner.run_live()` | `runAgentStream()` |

## Best Practices

1. **Agent Design**
   - Keep instructions clear and specific
   - Use appropriate tool selection
   - Implement proper error handling

2. **Tool Creation**
   - Provide detailed parameter descriptions
   - Validate inputs thoroughly
   - Handle errors gracefully

3. **Session Management**
   - Choose appropriate session providers
   - Clean up sessions regularly
   - Monitor session sizes

4. **Streaming**
   - Use monitoring for production streams
   - Implement proper error recovery
   - Consider buffering for performance

5. **Schema Validation**
   - Define clear input/output schemas
   - Use type guards for runtime safety
   - Provide helpful error messages

## Contributing

The FAF ADK Layer follows FAF's contribution guidelines. Key principles:

- Maintain functional purity (no classes)
- Comprehensive TypeScript typing
- Extensive testing coverage
- Clear documentation
- Performance optimization

## License

Licensed under the same terms as the FAF framework.