# Juspay Agent Framework (JAF)

[![CI](https://github.com/xynehq/jaf/workflows/CI/badge.svg)](https://github.com/xynehq/jaf/actions)
[![Documentation](https://img.shields.io/badge/docs-mkdocs-blue)](https://xynehq.github.io/jaf/)
[![npm version](https://img.shields.io/npm/v/@juspay-jaf%2Fjaf.svg)](https://www.npmjs.com/package/@juspay-jaf/jaf)
[![npm downloads](https://img.shields.io/npm/dm/@juspay-jaf%2Fjaf.svg)](https://www.npmjs.com/package/@juspay-jaf/jaf)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

![Juspay Agent Framework](/docs/cover.png?raw=true "Juspay Agent Framework")

A purely functional agent framework built on immutable state, type safety, and composable policies. JAF enables building production-ready AI agent systems with built-in security, observability, and error handling.

📚 **[Read the Documentation](https://xynehq.github.io/jaf/)**

## 🎯 Core Philosophy

- **Immutability**: All core data structures are deeply `readonly`
- **Pure Functions**: Core logic expressed as pure, predictable functions
- **Effects at the Edge**: Side effects isolated in Provider modules
- **Composition over Configuration**: Build complex behavior by composing simple functions
- **Type-Safe by Design**: Leverages TypeScript's advanced features for compile-time safety
- **Functional Composition**: Complex behaviors built through function composition, not inheritance or mutation

## 🚀 Quick Start

### Installation

```bash
# Install from npm
npm install @juspay-jaf/jaf

# Or using yarn
yarn add @juspay-jaf/jaf

# Or using pnpm
pnpm add @juspay-jaf/jaf
```

### Development Setup

```bash
# Clone the repository
git clone https://github.com/xynehq/jaf.git
cd jaf

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

## 📁 Project Structure

```
src/
├── core/           # Core framework types and engine
│   ├── engine.ts   # Main execution engine
│   ├── errors.ts   # Error handling and types
│   ├── tool-results.ts # Tool execution results
│   ├── tracing.ts  # Event tracing system
│   └── types.ts    # Core type definitions
├── memory/         # Memory providers for conversation persistence
│   ├── factory.ts  # Memory provider factory
│   ├── types.ts    # Memory system types
│   └── providers/
│       ├── in-memory.ts  # In-memory provider
│       ├── postgres.ts   # PostgreSQL provider
│       └── redis.ts      # Redis provider
├── providers/      # External integrations
│   ├── mcp.ts      # Model Context Protocol integration
│   └── model.ts    # LLM provider integrations
├── policies/       # Validation and security policies
│   ├── handoff.ts  # Agent handoff policies
│   └── validation.ts # Input/output validation
├── server/         # HTTP server implementation
│   ├── index.ts    # Server entry point
│   ├── server.ts   # Express server setup
│   └── types.ts    # Server-specific types
├── __tests__/      # Test suite
│   ├── engine.test.ts     # Engine tests
│   └── validation.test.ts # Validation tests
└── index.ts        # Main framework exports
examples/
├── rag-demo/       # Vertex AI RAG integration demo
│   ├── index.ts    # Demo entry point
│   ├── rag-agent.ts # RAG agent implementation
│   └── rag-tool.ts  # RAG tool implementation
├── hooks/turn-end-review.ts # Demonstrates awaiting onTurnEnd reviews between turns
└── server-demo/    # Development server demo
    └── index.ts    # Server demo entry point
docs/               # Documentation
├── getting-started.md
├── core-concepts.md
├── api-reference.md
├── tools.md
├── memory-system.md
├── model-providers.md
├── server-api.md
├── examples.md
├── deployment.md
└── troubleshooting.md
```

## 🏗️ Key Components

### Core Types

```typescript
import { z } from 'zod';
import { Agent, Tool, RunState, run } from '@juspay-jaf/jaf';

// Define your context type
type MyContext = {
  userId: string;
  permissions: string[];
};

// Create a tool
const calculatorTool: Tool<{ expression: string }, MyContext> = {
  schema: {
    name: "calculate",
    description: "Perform mathematical calculations",
    parameters: z.object({
      expression: z.string().describe("Math expression to evaluate")
    }),
  },
  execute: async (args) => {
    const result = eval(args.expression); // Don't do this in production!
    return `${args.expression} = ${result}`;
  },
};

// Define an agent
const mathAgent: Agent<MyContext, string> = {
  name: 'MathTutor',
  instructions: () => 'You are a helpful math tutor',
  tools: [calculatorTool],
};
```

### Running the Framework

```typescript
import { run, makeLiteLLMProvider } from '@juspay-jaf/jaf';

const modelProvider = makeLiteLLMProvider('http://localhost:4000');
const agentRegistry = new Map([['MathTutor', mathAgent]]);

const config = {
  agentRegistry,
  modelProvider,
  maxTurns: 10,
  onEvent: (event) => console.log(event), // Real-time tracing
  onTurnEnd: async ({ turn, lastAssistantMessage }) => {
    console.log(`Turn ${turn} completed:`, lastAssistantMessage?.content);
    // Run reviews, persist breadcrumbs, throttle next turn, etc.
  },
};

const initialState = {
  runId: generateRunId(),
  traceId: generateTraceId(),
  messages: [{ role: 'user', content: 'What is 2 + 2?' }],
  currentAgentName: 'MathTutor',
  context: { userId: 'user123', permissions: ['user'] },
  turnCount: 0,
};

const result = await run(initialState, config);
```


## 🔄 Function Composition

JAF emphasizes function composition to build complex behaviors from simple, reusable functions:

### Composing Tools

```typescript
import { createFunctionTool, composeTool, withRetry, withCache } from '@juspay-jaf/jaf';

// Simple base tools
const fetchWeatherTool = createFunctionTool({
  name: 'fetch_weather',
  description: 'Fetch weather data',
  execute: async ({ location }) => {
    const response = await fetch(`/api/weather?location=${location}`);
    return response.json();
  },
  parameters: [{ name: 'location', type: 'string', required: true }]
});

const formatTemperatureTool = createFunctionTool({
  name: 'format_temp',
  description: 'Format temperature reading',
  execute: ({ temp, unit }) => `${temp}°${unit.toUpperCase()}`,
  parameters: [
    { name: 'temp', type: 'number', required: true },
    { name: 'unit', type: 'string', required: true }
  ]
});

// Compose tools with higher-order functions
const cachedWeatherTool = withCache(fetchWeatherTool, { ttl: 300000 }); // 5 min cache
const reliableWeatherTool = withRetry(cachedWeatherTool, { maxRetries: 3 });

// Chain tools together
const weatherReportTool = composeTool([
  reliableWeatherTool,
  formatTemperatureTool
], 'weather_report', 'Get formatted weather report');
```

### Composing Validators

```typescript
import { compose, createValidator } from '@juspay-jaf/jaf';

// Base validators
const isPositive = createValidator<number>(
  n => n > 0,
  'Value must be positive'
);

const isInteger = createValidator<number>(
  n => Number.isInteger(n),
  'Value must be an integer'
);

const isInRange = (min: number, max: number) => createValidator<number>(
  n => n >= min && n <= max,
  `Value must be between ${min} and ${max}`
);

// Compose validators
const validateAge = compose(
  isPositive,
  isInteger,
  isInRange(0, 150)
);

// Use in tool parameters
const ageTool = createFunctionTool({
  name: 'process_age',
  description: 'Process age data',
  execute: ({ age }) => `Age ${age} is valid`,
  parameters: [{
    name: 'age',
    type: 'number',
    required: true,
    validate: validateAge
  }]
});
```

### Composing Agent Behaviors

```typescript
import { createAgent, withMiddleware, withFallback } from '@juspay-jaf/jaf';

// Base agents
const primaryAgent = createAgent({
  name: 'primary',
  model: 'gpt-4',
  instruction: 'Primary processing agent',
  tools: [calculatorTool]
});

const fallbackAgent = createAgent({
  name: 'fallback',
  model: 'gpt-3.5-turbo',
  instruction: 'Fallback processing agent',
  tools: [simpleMathTool]
});

// Compose with middleware
const loggingMiddleware = (agent) => ({
  ...agent,
  execute: async (input) => {
    console.log(`[${agent.name}] Processing:`, input);
    const result = await agent.execute(input);
    console.log(`[${agent.name}] Result:`, result);
    return result;
  }
});

const rateLimitMiddleware = (limit: number) => (agent) => {
  let count = 0;
  const resetTime = Date.now() + 60000;
  
  return {
    ...agent,
    execute: async (input) => {
      if (Date.now() > resetTime) {
        count = 0;
      }
      if (count >= limit) {
        throw new Error('Rate limit exceeded');
      }
      count++;
      return agent.execute(input);
    }
  };
};

// Compose everything
const productionAgent = compose(
  withFallback(fallbackAgent),
  withMiddleware(loggingMiddleware),
  withMiddleware(rateLimitMiddleware(100))
)(primaryAgent);
```

### Composing Memory Providers

```typescript
import { composeMemoryProviders, createCacheLayer } from '@juspay-jaf/jaf';

// Layer memory providers for performance and reliability
const memoryProvider = composeMemoryProviders([
  createCacheLayer({ maxSize: 100 }),      // L1: In-memory cache
  createRedisProvider({ ttl: 3600 }),      // L2: Redis cache
  createPostgresProvider({ table: 'chat' }) // L3: Persistent storage
]);

// The composed provider automatically:
// - Reads from the fastest available layer
// - Writes to all layers
// - Falls back on layer failure
```

## 🛡️ Security & Validation

### Composable Validation Policies

```typescript
import { createPathValidator, createPermissionValidator, composeValidations } from '@juspay-jaf/jaf';

// Create individual validators
const pathValidator = createPathValidator(['/shared', '/public']);
const permissionValidator = createPermissionValidator('admin', ctx => ctx);

// Compose them
const combinedValidator = composeValidations(pathValidator, permissionValidator);

// Apply to tools
const secureFileTool = withValidation(baseFileTool, combinedValidator);
```

### Guardrails

```typescript
import { createContentFilter, createRateLimiter } from '@juspay-jaf/jaf';

const config = {
  // ... other config
  initialInputGuardrails: [
    createContentFilter(),
    createRateLimiter(10, 60000, input => 'global')
  ],
  finalOutputGuardrails: [
    createContentFilter()
  ],
};
```

## 🔗 Agent Handoffs

```typescript
import { handoffTool } from '@juspay-jaf/jaf';

const triageAgent: Agent<Context, { agentName: string }> = {
  name: 'TriageAgent',
  instructions: () => 'Route requests to specialized agents',
  tools: [handoffTool],
  handoffs: ['MathTutor', 'FileManager'], // Allowed handoff targets
  outputCodec: z.object({
    agentName: z.enum(['MathTutor', 'FileManager'])
  }),
};
```

## 📊 Observability

### Real-time Tracing

```typescript
import { ConsoleTraceCollector, FileTraceCollector } from '@juspay-jaf/jaf';

// Console logging
const consoleTracer = new ConsoleTraceCollector();

// File logging
const fileTracer = new FileTraceCollector('./traces.log');

// Composite tracing
const tracer = createCompositeTraceCollector(consoleTracer, fileTracer);

const config = {
  // ... other config
  onEvent: tracer.collect.bind(tracer),
};
```

### Error Handling

```typescript
import { JAFErrorHandler } from '@juspay-jaf/jaf';

if (result.outcome.status === 'error') {
  const formattedError = JAFErrorHandler.format(result.outcome.error);
  const isRetryable = JAFErrorHandler.isRetryable(result.outcome.error);
  const severity = JAFErrorHandler.getSeverity(result.outcome.error);
  
  console.error(`[${severity}] ${formattedError} (retryable: ${isRetryable})`);
}
```

## 🔌 Provider Integrations

### LiteLLM Provider

```typescript
import { makeLiteLLMProvider } from '@juspay-jaf/jaf';

// Connect to LiteLLM proxy for 100+ model support
const modelProvider = makeLiteLLMProvider(
  'http://localhost:4000', // LiteLLM proxy URL
  'your-api-key'           // Optional API key
);
```

### MCP (Model Context Protocol) Tools

```typescript
import { makeMCPClient, mcpToolToJAFTool } from '@juspay-jaf/jaf';

// Connect to MCP server
const mcpClient = await makeMCPClient('python', ['-m', 'mcp_server']);

// Get available tools
const mcpTools = await mcpClient.listTools();

// Convert to JAF tools with validation
const jafTools = mcpTools.map(tool => 
  mcpToolToJAFTool(mcpClient, tool, myValidationPolicy)
);
```

## 🚀 Development Server

JAF includes a built-in development server for testing agents locally via HTTP endpoints:

```typescript
import { runServer, makeLiteLLMProvider, createInMemoryProvider } from '@juspay-jaf/jaf';

const myAgent = {
  name: 'MyAgent',
  instructions: 'You are a helpful assistant',
  tools: [calculatorTool, greetingTool]
};

const modelProvider = makeLiteLLMProvider('http://localhost:4000');
const memoryProvider = createInMemoryProvider();

// Start server on port 3000
const server = await runServer(
  [myAgent], 
  { modelProvider },
  { port: 3000, defaultMemoryProvider: memoryProvider }
);
```

Server provides RESTful endpoints:
- `GET /health` - Health check
- `GET /agents` - List available agents  
- `POST /chat` - General chat endpoint
- `POST /agents/{name}/chat` - Agent-specific endpoint

## 📚 Documentation

Comprehensive documentation is available in the [`/docs`](./docs) folder:

- **[Getting Started](./docs/getting-started.md)** - Installation, basic concepts, and first agent
- **[Core Concepts](./docs/core-concepts.md)** - JAF's functional architecture and principles  
- **[API Reference](./docs/api-reference.md)** - Complete TypeScript API documentation
- **[ADK Layer](./docs/adk-layer.md)** - Agent Development Kit for simplified agent creation
- **[A2A Protocol](./docs/a2a-protocol.md)** - Agent-to-Agent communication and task management
- **[Tools](./docs/tools.md)** - Building robust tools with validation and error handling
- **[Memory System](./docs/memory-system.md)** - Conversation persistence (in-memory, Redis, PostgreSQL)
- **[Model Providers](./docs/model-providers.md)** - LLM integration and configuration
- **[Server & API](./docs/server-api.md)** - HTTP server setup and REST API
- **[Visualization](./docs/visualization.md)** - Generate Graphviz diagrams of agents and tools
- **[Examples](./docs/examples.md)** - Tutorials and integration patterns
- **[Deployment](./docs/deployment.md)** - Production deployment guide
- **[Troubleshooting](./docs/troubleshooting.md)** - Common issues and debugging
- **[New Features](./docs/new-features.md)** - Recent enhancements and capabilities

### 📖 Documentation Website

Browse the full documentation online at **[https://xynehq.github.io/jaf/](https://xynehq.github.io/jaf/)**

The documentation site features:
- 🔍 Full-text search
- 🌓 Dark/light mode toggle  
- 📱 Mobile-friendly responsive design
- 🔗 Deep linking to sections
- 📋 Code block copy buttons

#### Running Documentation Locally

```bash
# Install documentation dependencies
pip install -r requirements.txt

# Run local documentation server
mkdocs serve
# Visit http://127.0.0.1:8000

# Or use the convenience script
./docs/serve.sh
```

## 🎮 Example Applications

Explore the example applications to see the framework in action:

### Development Server Demo

```bash
cd examples/server-demo
npm install
npm run dev
```

The server demo showcases:
- ✅ Multiple agent types with different capabilities
- ✅ RESTful API with type-safe validation
- ✅ Tool integration (calculator, greeting)
- ✅ Real-time tracing and error handling
- ✅ CORS support and graceful shutdown

### Vertex AI RAG Demo

```bash
cd examples/rag-demo
npm install
npm run dev
```

The RAG demo showcases:
- ✅ Real Vertex AI RAG integration with Google GenAI SDK
- ✅ Permission-based access control
- ✅ Real-time streaming responses with source attribution
- ✅ Performance metrics and comprehensive error handling
- ✅ JAF framework orchestration with type-safe tools
- ✅ Multi-turn conversations with observability

## 🧪 Testing

```bash
npm test        # Run tests
npm run lint    # Lint code
npm run typecheck # Type checking
```

## ✨ Recent Enhancements

### Multi-Agent Coordination
- **Intelligent Agent Selection**: Automatic keyword-based routing for conditional delegation
- **Parallel Response Merging**: Smart merging of responses from multiple agents
- **Coordination Rules**: Define custom rules for sophisticated orchestration
- **Hierarchical Delegation**: Multi-level agent architectures with automatic handoffs

### Enhanced Schema Validation
- **Full JSON Schema Draft 7**: Complete support for all validation features
- **Format Validators**: Built-in email, URL, date, UUID, IPv4/IPv6 validation
- **Advanced Constraints**: minLength, maxLength, pattern, multipleOf, uniqueItems
- **Deep Validation**: Object property constraints, array uniqueness with deep equality

### Visualization System
- **DOT Generation**: Direct Graphviz DOT generation for better reliability
- **Multiple Color Schemes**: Default, modern, and minimal themes
- **Architecture Diagrams**: Generate agent, tool, and runner visualizations
- **Fallback Support**: DOT content available even if rendering fails

### Model Support
- **300+ Models**: Comprehensive enum with all major LLM providers
- **Type-Safe**: Strongly typed model identifiers
- **Provider Detection**: Automatic provider identification from model names

## 🏛️ Architecture Principles

### Immutable State Machine
- All state transformations create new state objects
- No mutation of existing data structures
- Predictable, testable state transitions

### Type Safety
- Runtime validation with Zod schemas
- Compile-time safety with TypeScript
- Branded types prevent ID mixing

### Pure Functions
- Core logic is side-effect free
- Easy to test and reason about
- Deterministic behavior

### Effect Isolation
- Side effects only in Provider modules
- Clear boundaries between pure and impure code
- Easier mocking and testing

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Run the test suite
5. Submit a pull request

---

**JAF** - Building the future of functional AI agent systems 🚀
