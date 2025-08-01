# Functional Agent Framework (FAF) Documentation

Welcome to the comprehensive documentation for the Functional Agent Framework (FAF) - a purely functional agent framework built on immutable state, type safety, and composable policies.

## 🚀 Quick Start

New to FAF? Start here:

1. **[Getting Started](./getting-started.md)** - Installation, basic concepts, and your first agent
2. **[Core Concepts](./core-concepts.md)** - Understanding FAF's functional architecture
3. **[Examples](./examples.md)** - Working examples and tutorials

## 📚 Documentation Structure

### Core Framework
- **[Core Concepts](./core-concepts.md)** - RunState, agents, tools, and functional programming principles
- **[API Reference](./api-reference.md)** - Complete TypeScript API documentation
- **[Tools](./tools.md)** - Building robust, production-ready tools with validation and error handling

### System Components
- **[Memory System](./memory-system.md)** - Conversation persistence with in-memory, Redis, and PostgreSQL providers
- **[Model Providers](./model-providers.md)** - LLM integration, configuration, and custom providers
- **[Server & API](./server-api.md)** - HTTP server setup and REST API documentation

### Development & Deployment
- **[Examples](./examples.md)** - Server demo, RAG demo, and integration patterns
- **[Testing & CI/CD](#testing-guidelines-and-cicd)** - Comprehensive testing infrastructure, patterns, and continuous integration
- **[Deployment](./deployment.md)** - Production deployment with Docker, Kubernetes, and infrastructure
- **[Troubleshooting](./troubleshooting.md)** - Common issues, debugging, and performance optimization

## 🎯 Use Case Navigation

### I want to...

**Build my first agent**  
→ [Getting Started](./getting-started.md) → [Examples](./examples.md)

**Create robust tools**  
→ [Tools](./tools.md) → [API Reference](./api-reference.md#tool-system)

**Add conversation memory**  
→ [Memory System](./memory-system.md) → [Examples: Memory Persistence](./examples.md#memory-and-persistence)

**Deploy to production**  
→ [Deployment](./deployment.md) → [Server & API](./server-api.md)

**Build an HTTP API**  
→ [Server & API](./server-api.md) → [Examples: Server Demo](./examples.md#server-demo-walkthrough)

**Integrate with external LLMs**  
→ [Model Providers](./model-providers.md) → [Deployment: Environment Setup](./deployment.md#environment-configuration)

**Debug issues**  
→ [Troubleshooting](./troubleshooting.md) → [Core Concepts: Error Handling](./core-concepts.md#error-handling-patterns)

**Understand the architecture**  
→ [Core Concepts](./core-concepts.md) → [API Reference](./api-reference.md)

## 🔧 Framework Philosophy

FAF is built on functional programming principles:

- **Immutability**: All core data structures are deeply `readonly`
- **Pure Functions**: Core logic expressed as pure, predictable functions  
- **Effects at the Edge**: Side effects isolated in Provider modules
- **Type Safety**: Comprehensive TypeScript types with runtime validation
- **Composability**: Small, focused components that compose into complex systems

## 📖 Documentation Quality

All documentation has been:

✅ **Validated against source code** - Every example and API reference is verified against the actual framework implementation  
✅ **Tested with real examples** - Code snippets are based on working examples in the repository  
✅ **Production-ready** - Includes best practices, error handling, and deployment considerations  
✅ **Comprehensive** - Covers all framework features from basic concepts to advanced patterns  

## 🤝 Contributing

Found an issue or want to improve the documentation?

1. Check the [source code](../src) to verify current implementation
2. Review the [examples](../examples) for usage patterns
3. Ensure all code examples are tested and working
4. Submit improvements via pull request

## 📋 Quick Reference

### Key Functions
```typescript
import { run, runServer, createInMemoryProvider } from 'functional-agent-framework';
```

### Essential Types
```typescript
type Agent<Ctx, Out> = { name: string; instructions: string; tools?: Tool<any, Ctx>[] }
type Tool<Args, Ctx> = { schema: ToolSchema<Args>; execute: ToolFunction<Args, Ctx> }
type RunState<Ctx> = { runId: RunId; traceId: TraceId; messages: readonly Message[]; ... }
```

### Memory Providers
```typescript
// Development
const memory = await createInMemoryProvider();

// Production
const memory = await createRedisProvider(config, redisClient);
const memory = await createPostgresProvider(config, pgClient);
```

### Server Setup
```typescript
const server = await runServer(agents, { modelProvider }, { port: 3000 });
```

---

## Testing Guidelines and CI/CD

FAF follows functional programming principles throughout its testing infrastructure, ensuring robust, reliable code with comprehensive coverage.

### 🧪 Testing Infrastructure

#### Jest Configuration
FAF uses Jest with TypeScript for comprehensive testing:

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/demo/**/*',
    '!src/providers/mcp.ts',
    '!src/a2a/examples/**/*',
  ],
  moduleNameMapping: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  }
};
```

#### Coverage Requirements
- **Minimum Coverage**: 80% overall coverage
- **Line Coverage**: 85% for core modules
- **Branch Coverage**: 75% for complex logic
- **Function Coverage**: 90% for public APIs

#### Test Structure
```
src/
├── __tests__/           # Core framework tests
├── a2a/__tests__/       # A2A protocol tests
├── adk/__tests__/       # ADK layer tests
└── module/__tests__/    # Module-specific tests
```

### 🚀 CI/CD Pipeline

#### GitHub Actions Workflow
```yaml
name: CI
on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x, 20.x, 22.x]
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
    
    - name: Use Node.js ${{ matrix.node-version }}
      uses: actions/setup-node@v4
      with:
        node-version: ${{ matrix.node-version }}
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run linting
      run: npm run lint
    
    - name: Run type checking
      run: npm run typecheck
    
    - name: Run tests
      run: npm test
    
    - name: Run build
      run: npm run build
```

#### Multi-Version Testing
- **Node.js 18.x**: LTS baseline support
- **Node.js 20.x**: Current LTS (primary development)
- **Node.js 22.x**: Latest stable for future compatibility

#### Quality Checks
- **ESLint**: TypeScript/functional programming rules
- **TypeScript**: Strict type checking with `--noEmit`
- **Prettier**: Code formatting consistency
- **Jest**: Comprehensive testing with coverage reporting

### 📝 Testing Patterns

#### Functional Testing Patterns
FAF tests follow functional programming principles:

```typescript
// ✅ Pure function testing
describe('createAgent', () => {
  it('should create agent with immutable configuration', () => {
    const config = { name: 'test', model: 'gpt-4', instruction: 'help' };
    const agent = createAgent(config);
    
    expect(agent.config).toEqual(config);
    expect(agent.config).not.toBe(config); // Different reference
    expect(Object.isFrozen(agent.config)).toBe(true);
  });
});

// ✅ Factory function testing
describe('createInMemoryProvider', () => {
  it('should create provider with default configuration', async () => {
    const provider = await createInMemoryProvider();
    
    expect(provider.config.type).toBe('memory');
    expect(typeof provider.store).toBe('function');
    expect(typeof provider.retrieve).toBe('function');
  });
});
```

#### Integration Testing
```typescript
describe('A2A Integration', () => {
  let taskProvider: A2ATaskProvider;

  beforeAll(async () => {
    taskProvider = await createSimpleA2ATaskProvider('memory');
  });

  afterAll(async () => {
    await taskProvider.close();
  });

  it('should handle complete task lifecycle', async () => {
    // Test complete workflow from submission to completion
    const task = createTestTask('task_123', 'ctx_456', 'submitted');
    const storeResult = await taskProvider.storeTask(task);
    
    expect(storeResult.success).toBe(true);
    
    // Update to working state
    await taskProvider.updateTaskStatus('task_123', 'working');
    
    // Complete the task
    await taskProvider.updateTaskStatus('task_123', 'completed');
    
    const finalTask = await taskProvider.getTask('task_123');
    expect(finalTask.data?.status.state).toBe('completed');
  });
});
```

#### Async Testing Patterns
```typescript
describe('Streaming Operations', () => {
  it('should handle async generators', async () => {
    const streamingEvents = runAgentStream(config, context, message);
    const events = [];
    
    for await (const event of streamingEvents) {
      events.push(event);
      if (events.length > 10) break; // Prevent infinite loops
    }
    
    expect(events).toHaveLength(10);
    expect(events[0].type).toBe('message_start');
  });
  
  it('should handle concurrent operations', async () => {
    const promises = Array.from({ length: 5 }, (_, i) =>
      runAgent(config, { userId: `user_${i}` }, createUserMessage(`Test ${i}`))
    );
    
    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    results.forEach(result => expect(result.success).toBe(true));
  });
});
```

### 🎯 Best Practices

#### Test Organization
```
__tests__/
├── unit/           # Pure function tests
├── integration/    # Multi-component tests
├── e2e/           # End-to-end scenarios
└── fixtures/      # Test data and helpers
```

#### Helper Functions
```typescript
// Test utilities following functional patterns
export const createTestTask = (
  id: string = 'task_123',
  contextId: string = 'ctx_456',
  state: TaskState = 'submitted'
): A2ATask => ({
  id,
  contextId,
  kind: 'task',
  status: {
    state,
    message: createTestMessage(`Task ${id} is ${state}`),
    timestamp: new Date().toISOString()
  },
  history: [],
  artifacts: [],
  metadata: {
    createdAt: new Date().toISOString(),
    priority: 'normal'
  }
});

export const createMockModelProvider = () => ({
  async getCompletion(params: any) {
    const lastMessage = params.messages?.[params.messages.length - 1];
    return {
      message: {
        content: `Echo: ${lastMessage?.content || 'Default response'}`
      }
    };
  }
});
```

#### Mocking Strategies
```typescript
// ✅ Functional mocking - create pure mock functions
const createMockProvider = (responses: string[]) => {
  let callCount = 0;
  return {
    async getCompletion() {
      return { content: responses[callCount++] || 'Default' };
    }
  };
};

// ✅ Dependency injection for testing
describe('Agent Execution', () => {
  it('should use injected model provider', async () => {
    const mockProvider = createMockProvider(['Test response']);
    const result = await runAgent(config, context, message, { modelProvider: mockProvider });
    
    expect(result.content).toContain('Test response');
  });
});
```

#### Error Testing
```typescript
describe('Error Handling', () => {
  it('should handle tool execution failures', async () => {
    const errorTool = createFunctionTool(
      'error_tool',
      'Tool that fails',
      () => { throw new Error('Tool failed'); }
    );
    
    const agent = createAgent({ name: 'test', tools: [errorTool] });
    const result = await runAgent(config, context, message);
    
    expect(result.toolResponses).toContainEqual(
      expect.objectContaining({ success: false })
    );
  });
  
  it('should maintain data integrity on partial failures', async () => {
    const provider = await createInMemoryProvider();
    
    // Test invalid operations don't affect valid data
    await provider.store('valid', { data: 'test' });
    
    try {
      await provider.store('invalid', null); // Should fail
    } catch (error) {
      // Error expected
    }
    
    const validData = await provider.retrieve('valid');
    expect(validData).toEqual({ data: 'test' });
  });
});
```

### 🤝 Contributing Guidelines

#### Pre-Commit Checks
```bash
# Required before committing
npm run lint          # ESLint validation
npm run typecheck     # TypeScript validation
npm test              # Test suite execution
npm run build         # Build verification
```

#### Coverage Requirements
- **New Features**: Must include comprehensive tests
- **Bug Fixes**: Must include regression tests
- **Refactoring**: Must maintain existing test coverage
- **Breaking Changes**: Must update all affected tests

#### CI Requirements
- All GitHub Actions checks must pass
- Code coverage must not decrease
- No TypeScript errors or warnings
- All tests must pass across supported Node.js versions

### 📚 Testing Examples

#### A2A Protocol Testing
```typescript
describe('A2A Memory Serialization', () => {
  it('should serialize and deserialize tasks correctly', async () => {
    const originalTask = createTestTask('serialize_test', 'ctx_123');
    const serialized = serializeA2ATask(originalTask);
    const deserialized = deserializeA2ATask(serialized);
    
    expect(deserialized).toEqual(originalTask);
    expect(deserialized).not.toBe(originalTask); // Different reference
  });
  
  it('should handle complex task artifacts', async () => {
    const task = createTestTask('artifact_test', 'ctx_456');
    task.artifacts = [
      {
        artifactId: 'test_artifact',
        name: 'Test Result',
        description: 'Complex test data',
        parts: [
          { kind: 'text', text: 'Result data' },
          { kind: 'json', json: { complex: { nested: 'data' } } }
        ]
      }
    ];
    
    const provider = await createA2AInMemoryTaskProvider({
      type: 'memory',
      enableArtifacts: true
    });
    
    await provider.storeTask(task);
    const retrieved = await provider.getTask('artifact_test');
    
    expect(retrieved.data?.artifacts).toEqual(task.artifacts);
  });
});
```

#### ADK Layer Testing
```typescript
describe('Multi-Agent Coordination', () => {
  it('should delegate tasks to appropriate agents', async () => {
    const weatherAgent = createAgent({
      name: 'weather',
      model: 'gpt-4',
      instruction: 'Provide weather info',
      tools: [createWeatherTool()]
    });
    
    const mathAgent = createAgent({
      name: 'math',
      model: 'gpt-4', 
      instruction: 'Perform calculations',
      tools: [createCalculatorTool()]
    });
    
    const coordinator = createMultiAgent(
      'coordinator',
      'gpt-4',
      'Route requests to specialists',
      [weatherAgent.config, mathAgent.config],
      'conditional'
    );
    
    const sessionProvider = createInMemorySessionProvider();
    const runnerConfig = createRunnerConfig(coordinator, sessionProvider);
    
    // Test weather delegation
    const weatherMessage = createUserMessage('What\'s the weather in Tokyo?');
    const response = await runAgent(runnerConfig, { userId: 'test' }, weatherMessage);
    
    expect(response.metadata.executedAgent).toBe('weather');
    expect(response.toolCalls.some(call => call.name === 'get_weather')).toBe(true);
  });
});
```

#### Performance Testing
```typescript
describe('Performance and Scalability', () => {
  it('should handle high-volume task operations', async () => {
    const provider = await createA2AInMemoryTaskProvider({
      type: 'memory',
      maxTasks: 10000
    });
    
    const startTime = Date.now();
    
    // Create 1000 tasks
    const createPromises = Array.from({ length: 1000 }, (_, i) =>
      provider.storeTask(createTestTask(`perf_task_${i}`, 'perf_ctx'))
    );
    
    await Promise.all(createPromises);
    const createTime = Date.now() - startTime;
    
    // Query performance
    const queryStart = Date.now();
    const tasks = await provider.getTasksByContext('perf_ctx');
    const queryTime = Date.now() - queryStart;
    
    expect(tasks.data).toHaveLength(1000);
    expect(createTime).toBeLessThan(5000); // 5 seconds max for 1000 creates
    expect(queryTime).toBeLessThan(1000);  // 1 second max for query
  });
});
```

### 🎯 Quick Testing Commands

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test suite
npm test -- --testPathPattern=a2a

# Watch mode for development
npm test -- --watch

# Run tests for specific file
npm test -- src/a2a/__tests__/integration.test.ts

# Verbose output with detailed test results
npm test -- --verbose

# Update snapshots (if using snapshot testing)
npm test -- --updateSnapshot
```

---

**Ready to build with FAF?** Start with the [Getting Started Guide](./getting-started.md) and explore the [examples](./examples.md)!