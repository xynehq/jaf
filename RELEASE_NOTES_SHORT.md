# JAF v0.1.0 - Initial Release 🎉

The first public release of JAF (Juspay Agent Framework) - a purely functional framework for building AI agents with TypeScript.

## ✨ Highlights

- **🎯 Pure Functional Design**: No classes, only functions and immutable data
- **🤖 Agent Development Kit (ADK)**: High-level APIs for rapid agent development  
- **🔗 A2A Protocol**: Standardized agent-to-agent communication
- **📊 Visualization**: Generate Graphviz diagrams of your agent systems
- **💾 Multi-Provider Memory**: In-memory, Redis, and PostgreSQL backends
- **🌐 Production Ready**: HTTP server, comprehensive testing, full TypeScript support

## 📦 Installation

```bash
npm install @xynehq/jaf
```

## 🚀 Quick Start

```typescript
import { createAgent, createFunctionTool, run } from '@xynehq/jaf';

const mathAgent = createAgent({
  name: 'MathTutor',
  instructions: 'You are a helpful math tutor',
  tools: [calculatorTool],
  model: 'gpt-4'
});
```

## 📚 Resources

- **Documentation**: https://xynehq.github.io/jaf/
- **npm Package**: https://www.npmjs.com/package/@xynehq/jaf
- **Examples**: See the `examples/` directory

## What's Included

- Core framework with functional engine
- Agent Development Kit (ADK)
- A2A Protocol implementation  
- Memory system with multiple providers
- Visualization tools
- HTTP server
- 614 passing tests
- Comprehensive documentation

---

**Full release notes**: See RELEASE_v0.1.0.md for detailed information