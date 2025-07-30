# Functional Agent Framework (FAF) v2.0

A purely functional agent framework built on immutable state, type safety, and composable policies. FAF enables building production-ready AI agent systems with built-in security, observability, and error handling.

## 🎯 Core Philosophy

- **Immutability**: All core data structures are deeply `readonly`
- **Pure Functions**: Core logic expressed as pure, predictable functions
- **Effects at the Edge**: Side effects isolated in Provider modules
- **Composition over Configuration**: Build complex behavior by composing simple functions
- **Type-Safe by Design**: Leverages TypeScript's advanced features for compile-time safety

## 🚀 Quick Start

```bash
npm install
npm run build
npm test     # Run tests
```

## 📁 Project Structure

```
src/
├── core/           # Core framework types and engine
├── providers/      # External integrations (LLM, MCP)
├── policies/       # Validation and security policies
└── __tests__/     # Test suite
examples/
└── rag-demo/      # Vertex AI RAG integration demo
```

## 🏗️ Key Components

### Core Types

```typescript
import { z } from 'zod';
import { Agent, Tool, RunState, run } from 'functional-agent-framework';

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
import { run, makeLiteLLMProvider } from 'functional-agent-framework';

const modelProvider = makeLiteLLMProvider('http://localhost:4000');
const agentRegistry = new Map([['MathTutor', mathAgent]]);

const config = {
  agentRegistry,
  modelProvider,
  maxTurns: 10,
  onEvent: (event) => console.log(event), // Real-time tracing
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

## 🛡️ Security & Validation

### Composable Validation Policies

```typescript
import { createPathValidator, createPermissionValidator, composeValidations } from 'functional-agent-framework';

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
import { createContentFilter, createRateLimiter } from 'functional-agent-framework';

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
import { handoffTool } from 'functional-agent-framework';

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
import { ConsoleTraceCollector, FileTraceCollector } from 'functional-agent-framework';

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
import { FAFErrorHandler } from 'functional-agent-framework';

if (result.outcome.status === 'error') {
  const formattedError = FAFErrorHandler.format(result.outcome.error);
  const isRetryable = FAFErrorHandler.isRetryable(result.outcome.error);
  const severity = FAFErrorHandler.getSeverity(result.outcome.error);
  
  console.error(`[${severity}] ${formattedError} (retryable: ${isRetryable})`);
}
```

## 🔌 Provider Integrations

### LiteLLM Provider

```typescript
import { makeLiteLLMProvider } from 'functional-agent-framework';

// Connect to LiteLLM proxy for 100+ model support
const modelProvider = makeLiteLLMProvider(
  'http://localhost:4000', // LiteLLM proxy URL
  'your-api-key'           // Optional API key
);
```

### MCP (Model Context Protocol) Tools

```typescript
import { makeMCPClient, mcpToolToFAFTool } from 'functional-agent-framework';

// Connect to MCP server
const mcpClient = await makeMCPClient('python', ['-m', 'mcp_server']);

// Get available tools
const mcpTools = await mcpClient.listTools();

// Convert to FAF tools with validation
const fafTools = mcpTools.map(tool => 
  mcpToolToFAFTool(mcpClient, tool, myValidationPolicy)
);
```

## 🚀 Development Server

FAF includes a built-in development server for testing agents locally via HTTP endpoints:

```typescript
import { runServer, makeLiteLLMProvider } from 'functional-agent-framework';

const myAgent = {
  name: 'MyAgent',
  instructions: 'You are a helpful assistant',
  tools: [calculatorTool, greetingTool]
};

const modelProvider = makeLiteLLMProvider('http://localhost:4000');

// Start server on port 3000
await runServer(
  [myAgent], 
  { modelProvider },
  { port: 3000 }
);
```

Server provides RESTful endpoints:
- `GET /health` - Health check
- `GET /agents` - List available agents  
- `POST /chat` - General chat endpoint
- `POST /agents/{name}/chat` - Agent-specific endpoint

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
- ✅ FAF framework orchestration with type-safe tools
- ✅ Multi-turn conversations with observability

## 🧪 Testing

```bash
npm test        # Run tests
npm run lint    # Lint code
npm run typecheck # Type checking
```

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

## 📜 License

MIT

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Run the test suite
5. Submit a pull request

---

**FAF v2.0** - Building the future of functional AI agent systems 🚀