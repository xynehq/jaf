# Getting Started with Juspay Agent Framework (JAF)

Welcome to the Juspay Agent Framework (JAF) - a purely functional agent framework built on immutable state, type safety, and composable policies. This guide will help you get up and running quickly with building production-ready AI agent systems.

## Table of Contents

1. [Installation](#installation)
2. [Core Concepts](#core-concepts)
3. [Hello World Example](#hello-world-example)
4. [Creating Your First Agent](#creating-your-first-agent)
5. [Building Tools](#building-tools)
6. [Running Agents](#running-agents)
7. [Memory System](#memory-system)
8. [Development Server](#development-server)
9. [Error Handling](#error-handling)
10. [Common Patterns](#common-patterns)
11. [Next Steps](#next-steps)

## Installation

### Basic Installation

```bash
npm install functional-agent-framework
```

### Prerequisites

1. **Node.js 18+** with TypeScript support
2. **LiteLLM proxy server** for model access (see setup below)
3. **Optional**: Redis or PostgreSQL for persistent memory

### Setting up LiteLLM

JAF uses LiteLLM as the model provider, which gives you access to 100+ AI models:

```bash
# Install LiteLLM
pip install litellm

# Start the proxy server
litellm --model gpt-3.5-turbo --port 4000
```

For production, you can configure LiteLLM with your API keys:

```bash
# With OpenAI
export OPENAI_API_KEY=your_key_here
litellm --model gpt-4o --port 4000

# With multiple providers
litellm --config config.yaml --port 4000
```

## Core Concepts

JAF is built around several key concepts:

### 1. Agents
Agents are the core entities that process user inputs and coordinate responses. They have:
- **Instructions**: System prompts that define their behavior
- **Tools**: Functions they can call to perform actions
- **Context**: Type-safe context for permissions and state
- **Output Codec**: Optional structured output validation

### 2. Tools
Tools are functions that agents can call. They feature:
- **Schema**: Zod-based input validation
- **Execute**: Async function that performs the work
- **Type Safety**: Full TypeScript support with context types

### 3. Run State
Immutable state that tracks:
- **Messages**: Conversation history
- **Context**: User permissions and data
- **Metadata**: Run IDs, trace IDs, turn counts

### 4. Functional Execution
- Pure functions for core logic
- Immutable state transformations
- Effects isolated in providers
- Predictable, testable behavior

## Hello World Example

Let's start with the simplest possible JAF application:

```typescript
import { z } from 'zod';
import {
  run,
  Tool,
  Agent,
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId
} from 'functional-agent-framework';

// 1. Define your context type
type MyContext = {
  userId: string;
  permissions: string[];
};

// 2. Create a simple greeting tool
const greetingTool: Tool<{ name: string }, MyContext> = {
  schema: {
    name: "greet",
    description: "Generate a personalized greeting",
    parameters: z.object({
      name: z.string().describe("Name of the person to greet")
    }),
  },
  execute: async (args, context) => {
    return `Hello, ${args.name}! I'm running on JAF. Your user ID is ${context.userId}.`;
  },
};

// 3. Define an agent
const assistantAgent: Agent<MyContext, string> = {
  name: 'Assistant',
  instructions: () => 'You are a helpful assistant. Use the greeting tool when meeting new people.',
  tools: [greetingTool],
};

// 4. Set up the execution environment
async function runHelloWorld() {
  // Configure model provider
  const modelProvider = makeLiteLLMProvider('http://localhost:4000');
  
  // Create agent registry
  const agentRegistry = new Map([['Assistant', assistantAgent]]);
  
  // Create initial state
  const initialState = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [{ role: 'user' as const, content: 'Hi, my name is Alice' }],
    currentAgentName: 'Assistant',
    context: { userId: 'user123', permissions: ['user'] },
    turnCount: 0,
  };
  
  // Run the agent
  const result = await run(initialState, {
    agentRegistry,
    modelProvider,
    maxTurns: 5,
    onEvent: (event) => console.log('Event:', event.type),
  });
  
  if (result.outcome.status === 'completed') {
    console.log('Response:', result.outcome.output);
  } else {
    console.error('Error:', result.outcome.error);
  }
}

runHelloWorld().catch(console.error);
```

## Creating Your First Agent

Let's build a more sophisticated agent with multiple tools:

```typescript
import { z } from 'zod';
import {
  Tool,
  Agent,
  ToolResponse,
  ToolErrorCodes,
  withErrorHandling
} from 'functional-agent-framework';

type MyContext = {
  userId: string;
  permissions: string[];
};

// Math calculation tool with error handling
const calculatorTool: Tool<{ expression: string }, MyContext> = {
  schema: {
    name: "calculate",
    description: "Perform mathematical calculations",
    parameters: z.object({
      expression: z.string().describe("Math expression to evaluate (e.g., '2 + 2', '10 * 5')")
    }),
  },
  execute: withErrorHandling('calculate', async (args, context) => {
    // Input validation
    const sanitized = args.expression.replace(/[^0-9+\-*/().\s]/g, '');
    if (sanitized !== args.expression) {
      return ToolResponse.validationError(
        "Invalid characters in expression. Only numbers, +, -, *, /, (, ), and spaces are allowed.",
        { originalExpression: args.expression }
      );
    }
    
    try {
      const result = eval(sanitized);
      return ToolResponse.success(`${args.expression} = ${result}`, {
        originalExpression: args.expression,
        result,
        calculationType: 'arithmetic'
      });
    } catch (evalError) {
      return ToolResponse.error(
        ToolErrorCodes.EXECUTION_FAILED,
        `Failed to evaluate expression: ${evalError instanceof Error ? evalError.message : 'Unknown error'}`,
        { expression: args.expression }
      );
    }
  }),
};

// Weather tool (mock implementation)
const weatherTool: Tool<{ location: string }, MyContext> = {
  schema: {
    name: "get_weather",
    description: "Get current weather information for a location",
    parameters: z.object({
      location: z.string().describe("City name or location")
    }),
  },
  execute: async (args, context) => {
    // Check permissions
    if (!context.permissions.includes('weather_access')) {
      return ToolResponse.permissionDenied(
        "Weather access requires 'weather_access' permission",
        ['weather_access']
      );
    }
    
    // Mock weather data
    const weatherData = {
      location: args.location,
      temperature: Math.floor(Math.random() * 30) + 10,
      condition: ['sunny', 'cloudy', 'rainy'][Math.floor(Math.random() * 3)],
      humidity: Math.floor(Math.random() * 100)
    };
    
    return ToolResponse.success(
      `Weather in ${weatherData.location}: ${weatherData.temperature}°C, ${weatherData.condition}, ${weatherData.humidity}% humidity`,
      weatherData
    );
  },
};

// Create a multi-tool agent
const assistantAgent: Agent<MyContext, string> = {
  name: 'SmartAssistant',
  instructions: (state) => `You are a helpful assistant with access to calculation and weather tools.
  
  Current user: ${state.context.userId}
  User permissions: ${state.context.permissions.join(', ')}
  
  You can:
  - Perform mathematical calculations using the calculator tool
  - Get weather information (if user has weather_access permission)
  - Engage in helpful conversation
  
  Always use the appropriate tools when the user asks for calculations or weather information.`,
  
  tools: [calculatorTool, weatherTool],
  
  modelConfig: {
    temperature: 0.1, // Lower temperature for more consistent responses
    maxTokens: 1000
  }
};
```

## Building Tools

Tools are the core of JAF's extensibility. Here are the key patterns:

### Basic Tool Structure

```typescript
const myTool: Tool<ArgsType, ContextType> = {
  schema: {
    name: "tool_name",
    description: "What this tool does",
    parameters: z.object({
      // Zod schema for input validation
    }),
  },
  execute: async (args, context) => {
    // Tool implementation
    return "result";
  },
};
```

### Using Standardized Error Handling

```typescript
import { withErrorHandling, ToolResponse, ToolErrorCodes } from 'functional-agent-framework';

const robustTool: Tool<{ input: string }, MyContext> = {
  schema: {
    name: "robust_tool",
    description: "A tool with proper error handling",
    parameters: z.object({
      input: z.string()
    }),
  },
  execute: withErrorHandling('robust_tool', async (args, context) => {
    // Validation
    if (!args.input.trim()) {
      return ToolResponse.validationError("Input cannot be empty");
    }
    
    // Permission check
    if (!context.permissions.includes('required_permission')) {
      return ToolResponse.permissionDenied(
        "This tool requires special permissions",
        ['required_permission']
      );
    }
    
    // Business logic
    const result = processInput(args.input);
    
    return ToolResponse.success(result, {
      processingTime: Date.now(),
      inputLength: args.input.length
    });
  }),
};
```

### Tool Result Types

Tools can return either strings or `ToolResult` objects:

```typescript
// String return (simple)
return "Simple text response";

// ToolResult return (structured)
return ToolResponse.success(data, metadata);
return ToolResponse.error(ToolErrorCodes.NOT_FOUND, "Resource not found");
return ToolResponse.validationError("Invalid input format");
return ToolResponse.permissionDenied("Access denied", ['admin']);
```

## Running Agents

### Basic Execution

```typescript
import { run, makeLiteLLMProvider } from 'functional-agent-framework';

async function runAgent() {
  const modelProvider = makeLiteLLMProvider('http://localhost:4000');
  const agentRegistry = new Map([['Assistant', assistantAgent]]);
  
  const initialState = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [{ role: 'user', content: 'What is 15 * 7?' }],
    currentAgentName: 'Assistant',
    context: { userId: 'user123', permissions: ['user', 'calculator'] },
    turnCount: 0,
  };
  
  const result = await run(initialState, {
    agentRegistry,
    modelProvider,
    maxTurns: 10,
    modelOverride: 'gpt-4o', // Optional model override
    onEvent: (event) => {
      console.log(`[${event.type}]`, event.data);
    },
  });
  
  return result;
}
```

### With Tracing and Observability

```typescript
import { ConsoleTraceCollector } from 'functional-agent-framework';

const traceCollector = new ConsoleTraceCollector();

const config = {
  agentRegistry,
  modelProvider,
  maxTurns: 10,
  onEvent: traceCollector.collect.bind(traceCollector),
};
```

### With Guardrails

```typescript
// Input validation
const inputGuardrail = async (input: string) => {
  if (input.includes('harmful_content')) {
    return { isValid: false, errorMessage: 'Content policy violation' };
  }
  return { isValid: true };
};

// Output validation
const outputGuardrail = async (output: any) => {
  if (typeof output === 'string' && output.length > 5000) {
    return { isValid: false, errorMessage: 'Response too long' };
  }
  return { isValid: true };
};

const config = {
  agentRegistry,
  modelProvider,
  initialInputGuardrails: [inputGuardrail],
  finalOutputGuardrails: [outputGuardrail],
};
```

## Memory System

JAF provides a powerful memory system for conversation persistence:

### Basic Memory Setup

```typescript
import { createInMemoryProvider } from 'functional-agent-framework';

const memoryProvider = await createInMemoryProvider();

const config = {
  agentRegistry,
  modelProvider,
  memory: {
    provider: memoryProvider,
    autoStore: true, // Automatically store conversation history
    maxMessages: 100, // Keep last 100 messages per conversation
  },
  conversationId: 'user-session-123', // Required for memory persistence
};
```

### Redis Memory Provider

```bash
# Install Redis dependencies
npm install redis
```

```typescript
import { createMemoryProviderFromEnv } from 'functional-agent-framework';

// Set environment variables
process.env.JAF_MEMORY_TYPE = 'redis';
process.env.JAF_REDIS_HOST = 'localhost';
process.env.JAF_REDIS_PORT = '6379';

// Create Redis client
const { createClient } = await import('redis');
const redisClient = createClient({
  url: 'redis://localhost:6379'
});
await redisClient.connect();

// Create memory provider
const memoryProvider = await createMemoryProviderFromEnv({ redis: redisClient });
```

### PostgreSQL Memory Provider

```bash
# Install PostgreSQL dependencies
npm install pg @types/pg
```

```typescript
// Set environment variables
process.env.JAF_MEMORY_TYPE = 'postgres';
process.env.JAF_POSTGRES_HOST = 'localhost';
process.env.JAF_POSTGRES_DB = 'jaf_memory';

// Create PostgreSQL client
const { Client } = await import('pg');
const postgresClient = new Client({
  host: 'localhost',
  database: 'jaf_memory',
  user: 'postgres',
  password: 'your_password'
});
await postgresClient.connect();

// Create memory provider
const memoryProvider = await createMemoryProviderFromEnv({ postgres: postgresClient });
```

## Development Server

JAF includes a built-in development server for testing agents via HTTP:

```typescript
import { runServer } from 'functional-agent-framework';

async function startDevServer() {
  const modelProvider = makeLiteLLMProvider('http://localhost:4000');
  const memoryProvider = await createInMemoryProvider();
  
  const server = await runServer(
    [assistantAgent, calculatorAgent], // Array of agents
    {
      modelProvider,
      maxTurns: 5,
      onEvent: (event) => console.log(event.type),
      memory: {
        provider: memoryProvider,
        autoStore: true,
        maxMessages: 100
      }
    },
    {
      port: 3000,
      host: '127.0.0.1',
      cors: true
    }
  );
  
  console.log('Server running on http://localhost:3000');
}
```

### Server API Endpoints

- `GET /health` - Health check
- `GET /agents` - List available agents
- `POST /chat` - General chat endpoint
- `POST /agents/{name}/chat` - Agent-specific endpoint
- `GET /memory/health` - Memory system health check

### Example API Usage

```bash
# Chat with an agent
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is 15 * 7?"}],
    "agentName": "SmartAssistant",
    "conversationId": "session-123",
    "context": {"userId": "user123", "permissions": ["user", "calculator"]}
  }'
```

## Error Handling

JAF provides comprehensive error handling:

### Runtime Error Types

```typescript
import { JAFErrorHandler } from 'functional-agent-framework';

if (result.outcome.status === 'error') {
  const error = result.outcome.error;
  
  switch (error._tag) {
    case 'MaxTurnsExceeded':
      console.log(`Exceeded ${error.turns} turns`);
      break;
    case 'ToolCallError':
      console.log(`Tool ${error.tool} failed: ${error.detail}`);
      break;
    case 'AgentNotFound':
      console.log(`Agent ${error.agentName} not found`);
      break;
    case 'InputGuardrailTripwire':
      console.log(`Input blocked: ${error.reason}`);
      break;
    // ... handle other error types
  }
}
```

### Tool Error Handling

```typescript
// In tools, use ToolResponse for structured errors
return ToolResponse.error(
  ToolErrorCodes.VALIDATION_ERROR,
  "Invalid input provided",
  { field: 'email', reason: 'Invalid format' }
);

// Check for tool errors in results
if (toolResult.status === 'error') {
  console.error('Tool failed:', toolResult.error.message);
  console.error('Error code:', toolResult.error.code);
  console.error('Details:', toolResult.error.details);
}
```

## Common Patterns

### Agent Handoffs

```typescript
import { handoffTool } from 'functional-agent-framework';

const triageAgent: Agent<MyContext, string> = {
  name: 'TriageAgent',
  instructions: () => 'Route requests to specialized agents based on the task.',
  tools: [handoffTool],
  handoffs: ['MathAgent', 'WeatherAgent'], // Allowed handoff targets
};

// The handoff tool automatically transfers control
// No additional setup required
```

### Structured Outputs

```typescript
const dataAgent: Agent<MyContext, { answer: string; confidence: number }> = {
  name: 'DataAgent',
  instructions: () => 'Return structured JSON with answer and confidence.',
  tools: [],
  outputCodec: z.object({
    answer: z.string(),
    confidence: z.number().min(0).max(1)
  }),
};
```

### Permission-Based Tools

```typescript
const adminTool: Tool<{ action: string }, MyContext> = {
  schema: {
    name: "admin_action",
    description: "Perform administrative actions",
    parameters: z.object({ action: z.string() }),
  },
  execute: async (args, context) => {
    // Check permissions first
    if (!context.permissions.includes('admin')) {
      return ToolResponse.permissionDenied(
        "Admin access required",
        ['admin']
      );
    }
    
    // Perform admin action
    return ToolResponse.success(`Executed: ${args.action}`);
  },
};
```

### Custom Model Configurations

```typescript
const creativeAgent: Agent<MyContext, string> = {
  name: 'CreativeAgent',
  instructions: () => 'Be creative and imaginative in your responses.',
  tools: [],
  modelConfig: {
    temperature: 0.9, // High creativity
    maxTokens: 2000
  }
};

const factualAgent: Agent<MyContext, string> = {
  name: 'FactualAgent',
  instructions: () => 'Provide accurate, factual information only.',
  tools: [],
  modelConfig: {
    temperature: 0.1, // Low creativity, high consistency
    maxTokens: 500
  }
};
```

## Next Steps

Now that you understand the basics, explore these advanced topics:

1. **[Core Concepts](./core-concepts.md)** - Deep dive into JAF's architecture
2. **[Memory System](./memory-system.md)** - Advanced memory management
3. **[Model Providers](./model-providers.md)** - Using different AI models
4. **[Server API](./server-api.md)** - Building production servers
5. **[API Reference](./api-reference.md)** - Complete API documentation

### Example Projects

Check out the example projects in the repository:

- `examples/server-demo/` - Full-featured development server
- `examples/rag-demo/` - Vertex AI RAG integration

### Best Practices

- **Type Safety**: Always define proper context types
- **Error Handling**: Use `withErrorHandling` and `ToolResponse` for robust tools
- **Memory Management**: Use appropriate memory providers for your scale
- **Observability**: Implement comprehensive tracing in production
- **Security**: Always validate inputs and check permissions
- **Testing**: JAF's functional design makes unit testing straightforward

### Community & Support

- GitHub Repository: [JAF on GitHub](https://github.com/your-repo/jaf)
- Issues & Discussions: Use GitHub Issues for bugs and feature requests
- Examples: Check the `examples/` directory for working code

---

**Happy building with JAF!** 🚀

Remember: JAF's functional approach makes agent systems more predictable, testable, and maintainable. Start simple and gradually add complexity as your needs grow.