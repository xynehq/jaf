# JAF v0.1.0 - Initial Release 🎉

We're excited to announce the first public release of JAF (Functional Agent Framework) - a purely functional framework for building AI agents with TypeScript.

## 🌟 What is JAF?

JAF is a production-ready framework that brings functional programming principles to AI agent development. Built on immutable state, type safety, and composable tools, JAF enables developers to create robust, predictable, and maintainable AI agent systems.

## ✨ Key Features

### 🎯 Core Framework
- **Pure Functional Design**: No classes, only functions and immutable data
- **Type-Safe by Design**: Leverages TypeScript's advanced type system
- **Composable Architecture**: Build complex behaviors by composing simple functions
- **Built-in Security**: Input/output validation, rate limiting, and content filtering
- **Comprehensive Error Handling**: Functional error types with graceful recovery
- **Real-time Observability**: Event tracing and monitoring built-in

### 🤖 Agent Development Kit (ADK)
- **Simplified Agent Creation**: High-level APIs for rapid agent development
- **Multi-Agent Support**: Sequential, parallel, conditional, and hierarchical execution
- **Tool Integration**: Easy integration with external tools (OpenAPI, CrewAI, LangChain)
- **Streaming Support**: Real-time communication with live event streams
- **Session Management**: Pluggable providers for state persistence

### 🔗 A2A Protocol
- **Agent-to-Agent Communication**: Standardized protocol for inter-agent messaging
- **Task Lifecycle Management**: Complete task tracking from submission to completion
- **Multiple Storage Backends**: In-memory, Redis, and PostgreSQL providers
- **Task Serialization**: Robust serialization with data integrity validation
- **Query System**: Advanced task querying with filtering and pagination

### 📊 Visualization
- **Graphviz Integration**: Generate visual diagrams of agents and tools
- **Multiple Layouts**: Support for different graph visualization styles
- **Color Schemes**: Default, modern, and minimal themes
- **Export Formats**: PNG, SVG, PDF, and DOT outputs

### 💾 Memory System
- **Conversation Persistence**: Save and restore agent conversations
- **Multiple Providers**: In-memory, Redis, and PostgreSQL backends
- **Automatic Cleanup**: Configurable retention policies
- **Query Capabilities**: Search conversations by user, time, or metadata

### 🌐 Server & API
- **HTTP Server**: Production-ready Fastify server with CORS support
- **REST API**: Clean API for agent interactions
- **Model Provider Integration**: Support for OpenAI, Anthropic, and LiteLLM
- **MCP Integration**: Model Context Protocol support

## 📦 Installation

```bash
npm install @xynehq/jaf
# or
yarn add @xynehq/jaf
# or
pnpm add @xynehq/jaf
```

## 🚀 Quick Example

```typescript
import { createAgent, createFunctionTool, run, makeLiteLLMProvider } from '@xynehq/jaf';

// Create a simple calculator tool
const calculatorTool = createFunctionTool(
  'calculator',
  'Performs calculations',
  ({ expression }) => eval(expression), // Don't use eval in production!
  [{ name: 'expression', type: 'string', required: true }]
);

// Create an agent
const mathAgent = createAgent({
  name: 'MathTutor',
  instructions: 'You are a helpful math tutor',
  tools: [calculatorTool],
  model: 'gpt-4'
});

// Run the agent
const result = await run(
  { messages: [{ role: 'user', content: 'What is 2 + 2?' }] },
  { agent: mathAgent, modelProvider: makeLiteLLMProvider() }
);
```

## 📚 Documentation

- **[Full Documentation](https://xynehq.github.io/jaf/)**: Comprehensive guides and API reference
- **[Getting Started](https://xynehq.github.io/jaf/getting-started/)**: Quick start guide
- **[ADK Guide](https://xynehq.github.io/jaf/adk-layer/)**: Agent Development Kit documentation
- **[Examples](https://github.com/xynehq/jaf/tree/main/examples)**: Sample implementations

## 🧪 Testing & Quality

- **614 tests** passing with comprehensive coverage
- **Zero linting errors** with strict ESLint configuration
- **Full TypeScript** support with strict mode enabled
- **CI/CD pipeline** with multi-version Node.js testing

## 🛠️ What's Included

- Core framework with engine, types, and error handling
- Agent Development Kit (ADK) for simplified development
- A2A Protocol implementation for agent communication
- Memory providers for conversation persistence
- Visualization tools for system diagrams
- HTTP server for API deployment
- Comprehensive test suite
- Full documentation with MkDocs

## 🙏 Acknowledgments

This framework is built on the principles of functional programming and inspired by the need for more predictable, maintainable AI agent systems. Special thanks to all contributors who helped shape JAF's architecture and implementation.

## 🔮 What's Next

- Enhanced tool marketplace
- More model provider integrations
- Advanced debugging tools
- Performance optimizations
- Community tool contributions

## 📄 License

JAF is released under the MIT License. See [LICENSE](LICENSE) file for details.

---

**Get Started**: `npm install @xynehq/jaf`
**Documentation**: https://xynehq.github.io/jaf/
**Report Issues**: https://github.com/xynehq/jaf/issues