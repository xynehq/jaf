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

**Ready to build with FAF?** Start with the [Getting Started Guide](./getting-started.md) and explore the [examples](./examples.md)!