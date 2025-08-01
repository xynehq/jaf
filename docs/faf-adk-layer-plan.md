# FAF ADK Layer Implementation Plan

## Overview

The FAF ADK Layer will provide ADK-style functionality while maintaining FAF's core functional principles. This layer will bridge the gap between ADK's rich feature set and FAF's functional purity, enabling developers to leverage ADK patterns in a functional context.

## Architecture Design

### Core Principle: Functional ADK

The FAF ADK Layer follows these principles:
- **No Classes**: All ADK concepts mapped to pure functions
- **Immutable State**: All state passed explicitly through function parameters
- **Composition**: ADK-style patterns built through function composition
- **Type Safety**: Full TypeScript typing throughout

### Layer Structure

```
src/
├── adk/
│   ├── agents/          # Agent creation and management functions
│   ├── runners/         # Execution functions
│   ├── sessions/        # Session management functions
│   ├── tools/           # Tool integration functions
│   ├── content/         # Content and message handling
│   ├── streaming/       # Streaming and live interaction
│   ├── schemas/         # Schema validation functions
│   └── index.ts         # Main exports
```

## Functional Mapping: ADK Concepts → FAF Functions

### 1. Agent System

#### ADK Pattern:
```python
agent = LlmAgent(
    name="weather_agent",
    model="gemini-2.0-flash", 
    instruction="You are a weather assistant",
    tools=[weather_tool],
    input_schema=WeatherQuery
)
```

#### FAF Functional Equivalent:
```typescript
// Agent Configuration Type
interface AgentConfig {
  name: string;
  model: string;
  instruction: string;
  tools: Tool[];
  inputSchema?: SchemaValidator;
  outputSchema?: SchemaValidator;
  subAgents?: AgentConfig[];
}

// Agent Creation Function
const createAgent = (config: AgentConfig): Agent => ({
  id: generateId(),
  config,
  metadata: {
    created: new Date(),
    version: '1.0.0'
  }
});

// Usage
const weatherAgent = createAgent({
  name: "weather_agent",
  model: "gemini-2.0-flash",
  instruction: "You are a weather assistant",
  tools: [weatherTool],
  inputSchema: weatherQuerySchema
});
```

### 2. Runner System

#### ADK Pattern:
```python
runner = Runner(agent=agent, session_service=session_service)
events = runner.run_async(user_id="123", session_id="456", new_message=content)
```

#### FAF Functional Equivalent:
```typescript
// Runner Configuration
interface RunnerConfig {
  agent: Agent;
  sessionProvider: SessionProvider;
  artifactProvider?: ArtifactProvider;
  guardrails?: GuardrailFunction[];
}

// Single Execution Function
const runAgent = async (
  config: RunnerConfig,
  context: RunContext,
  message: Content
): Promise<AgentResponse> => {
  const session = await getOrCreateSession(config.sessionProvider, context);
  const guardedMessage = await applyGuardrails(config.guardrails || [], message);
  const response = await executeAgent(config.agent, session, guardedMessage);
  return response;
};

// Streaming Execution Function
const runAgentStream = async function* (
  config: RunnerConfig,
  context: RunContext,
  message: Content
): AsyncGenerator<AgentEvent> {
  const session = await getOrCreateSession(config.sessionProvider, context);
  const eventStream = executeAgentStream(config.agent, session, message);
  
  for await (const event of eventStream) {
    yield event;
  }
};

// Usage
const response = await runAgent(runnerConfig, {
  userId: "123",
  sessionId: "456"
}, message);
```

### 3. Session Management

#### ADK Pattern:
```python
session_service = InMemorySessionService()
session = await session_service.create_session(app_name="app", user_id="123")
```

#### FAF Functional Equivalent:
```typescript
// Session Provider Interface
interface SessionProvider {
  createSession: (context: SessionContext) => Promise<Session>;
  getSession: (sessionId: string) => Promise<Session | null>;
  updateSession: (session: Session) => Promise<Session>;
  listSessions: (userId: string) => Promise<Session[]>;
}

// In-Memory Session Provider Factory
const createInMemorySessionProvider = (): SessionProvider => {
  const sessions = new Map<string, Session>();
  
  return {
    createSession: async (context) => {
      const session: Session = {
        id: generateId(),
        appName: context.appName,
        userId: context.userId,
        messages: [],
        artifacts: {},
        metadata: { created: new Date() }
      };
      sessions.set(session.id, session);
      return session;
    },
    
    getSession: async (sessionId) => sessions.get(sessionId) || null,
    
    updateSession: async (session) => {
      sessions.set(session.id, session);
      return session;
    },
    
    listSessions: async (userId) => 
      Array.from(sessions.values()).filter(s => s.userId === userId)
  };
};

// Usage
const sessionProvider = createInMemorySessionProvider();
const session = await sessionProvider.createSession({
  appName: "weather_app",
  userId: "123"
});
```

### 4. Tool System

#### ADK Pattern:
```python
tools = [
    FunctionTool(func=get_weather),
    OpenAPIToolset(spec_str=api_spec),
    CrewaiTool(tool=serper_tool)
]
```

#### FAF Functional Equivalent:
```typescript
// Tool Interface
interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: ToolExecutor;
}

// Function Tool Factory
const createFunctionTool = (
  name: string,
  description: string,
  func: Function,
  parameters: ToolParameter[]
): Tool => ({
  name,
  description,
  parameters,
  execute: async (params, context) => {
    const result = await func(params);
    return { success: true, data: result };
  }
});

// OpenAPI Toolset Factory
const createOpenAPIToolset = async (
  spec: OpenAPISpec
): Promise<Tool[]> => {
  const tools: Tool[] = [];
  
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const tool = createToolFromOperation(path, method, operation);
      tools.push(tool);
    }
  }
  
  return tools;
};

// CrewAI Tool Adapter
const createCrewAIToolAdapter = (crewAITool: any): Tool => ({
  name: crewAITool.name,
  description: crewAITool.description,
  parameters: extractParameters(crewAITool),
  execute: async (params, context) => {
    const result = await crewAITool.run(params);
    return { success: true, data: result };
  }
});

// Usage
const tools = [
  createFunctionTool("get_weather", "Get weather info", getWeather, weatherParams),
  ...(await createOpenAPIToolset(weatherAPISpec)),
  createCrewAIToolAdapter(serperTool)
];
```

### 5. Schema Validation

#### ADK Pattern:
```python
class WeatherQuery(BaseModel):
    location: str = Field(description="City name")
    units: str = Field(default="celsius")

agent = LlmAgent(input_schema=WeatherQuery)
```

#### FAF Functional Equivalent:
```typescript
// Schema Definition
interface WeatherQuery {
  location: string;
  units?: 'celsius' | 'fahrenheit';
}

// Schema Validator Factory
const createSchemaValidator = <T>(
  schema: JsonSchema,
  validator: (data: unknown) => data is T
): SchemaValidator<T> => ({
  schema,
  validate: (data: unknown): ValidationResult<T> => {
    if (validator(data)) {
      return { success: true, data };
    }
    return { 
      success: false, 
      errors: ['Validation failed'] 
    };
  }
});

// Runtime Validation
const weatherQueryValidator = createSchemaValidator<WeatherQuery>(
  weatherQuerySchema,
  (data): data is WeatherQuery => 
    typeof data === 'object' && 
    data !== null && 
    'location' in data &&
    typeof data.location === 'string'
);

// Usage in Agent
const weatherAgent = createAgent({
  name: "weather_agent",
  model: "gemini-2.0-flash",
  instruction: "You are a weather assistant",
  tools: [weatherTool],
  inputSchema: weatherQueryValidator
});
```

### 6. Multi-Agent Systems

#### ADK Pattern:
```python
coordinator = LlmAgent(
    name="coordinator",
    sub_agents=[weather_agent, news_agent, calendar_agent]
)
```

#### FAF Functional Equivalent:
```typescript
// Multi-Agent Configuration
interface MultiAgentConfig extends AgentConfig {
  subAgents: AgentConfig[];
  delegationStrategy: DelegationStrategy;
}

// Delegation Strategy
type DelegationStrategy = 
  | 'sequential'     // Run agents in order
  | 'parallel'       // Run agents concurrently
  | 'conditional'    // Choose agent based on conditions
  | 'hierarchical';  // Delegate based on capability

// Multi-Agent Execution
const runMultiAgent = async (
  config: MultiAgentConfig,
  context: RunContext,
  message: Content
): Promise<AgentResponse> => {
  const coordinator = createAgent(config);
  
  switch (config.delegationStrategy) {
    case 'sequential':
      return runSequentialAgents(config.subAgents, context, message);
    case 'parallel':
      return runParallelAgents(config.subAgents, context, message);
    case 'conditional':
      return runConditionalAgents(config.subAgents, context, message);
    case 'hierarchical':
      return runHierarchicalAgents(config.subAgents, context, message);
  }
};

// Usage
const coordinatorAgent = createAgent({
  name: "coordinator",
  model: "gemini-2.0-flash",
  instruction: "Coordinate multiple specialized agents",
  tools: [],
  subAgents: [weatherAgent, newsAgent, calendarAgent],
  delegationStrategy: 'conditional'
});
```

## Implementation Phases

### Phase 1: Core Foundation (Weeks 1-2)
- [ ] Basic agent creation functions
- [ ] Simple runner implementation
- [ ] In-memory session provider
- [ ] Function tool support
- [ ] Basic content types

### Phase 2: Tool Ecosystem (Weeks 3-4)
- [ ] OpenAPI toolset generation
- [ ] External tool adapters (CrewAI, LangChain)
- [ ] MCP protocol support
- [ ] Tool composition utilities

### Phase 3: Advanced Features (Weeks 5-6)
- [ ] Schema validation system
- [ ] Multi-agent coordination
- [ ] Guardrail functions
- [ ] Artifact management

### Phase 4: Streaming & Live Features (Weeks 7-8)
- [ ] Streaming execution
- [ ] Live interaction queues
- [ ] Bidirectional communication
- [ ] Event system

### Phase 5: Integration & Utilities (Weeks 9-10)
- [ ] Example system for few-shot learning
- [ ] Web UI integration
- [ ] Testing utilities
- [ ] Documentation and examples

## Function Signatures Reference

### Core Functions

```typescript
// Agent Management
export const createAgent: (config: AgentConfig) => Agent;
export const validateAgent: (agent: Agent) => ValidationResult;
export const cloneAgent: (agent: Agent, overrides: Partial<AgentConfig>) => Agent;

// Execution
export const runAgent: (config: RunnerConfig, context: RunContext, message: Content) => Promise<AgentResponse>;
export const runAgentStream: (config: RunnerConfig, context: RunContext, message: Content) => AsyncGenerator<AgentEvent>;
export const runMultiAgent: (config: MultiAgentConfig, context: RunContext, message: Content) => Promise<AgentResponse>;

// Session Management  
export const createInMemorySessionProvider: () => SessionProvider;
export const createRedisSessionProvider: (config: RedisConfig) => SessionProvider;
export const createPostgresSessionProvider: (config: PostgresConfig) => SessionProvider;

// Tool System
export const createFunctionTool: (name: string, description: string, func: Function, parameters: ToolParameter[]) => Tool;
export const createOpenAPIToolset: (spec: OpenAPISpec) => Promise<Tool[]>;
export const createCrewAIAdapter: (tool: CrewAITool) => Tool;
export const createLangChainAdapter: (tool: LangChainTool) => Tool;

// Schema Validation
export const createSchemaValidator: <T>(schema: JsonSchema, validator: TypeGuard<T>) => SchemaValidator<T>;
export const validateInput: <T>(validator: SchemaValidator<T>, data: unknown) => ValidationResult<T>;
export const validateOutput: <T>(validator: SchemaValidator<T>, data: unknown) => ValidationResult<T>;

// Content and Messaging
export const createContent: (role: 'user' | 'model', text: string) => Content;
export const createPart: (text: string, type?: PartType) => Part;
export const parseContent: (raw: string | object) => Content;

// Guardrails
export const createGuardrail: (name: string, check: GuardrailCheck) => GuardrailFunction;
export const applyGuardrails: (guardrails: GuardrailFunction[], message: Content) => Promise<Content>;

// Streaming
export const createLiveQueue: () => LiveRequestQueue;
export const streamToQueue: (stream: AsyncGenerator<AgentEvent>, queue: LiveRequestQueue) => Promise<void>;
export const queueToStream: (queue: LiveRequestQueue) => AsyncGenerator<AgentEvent>;
```

## Integration with Existing FAF

### Memory Provider Bridge
```typescript
// Bridge FAF memory providers to ADK session providers
const createMemoryProviderBridge = (
  memoryProvider: MemoryProvider
): SessionProvider => ({
  createSession: async (context) => {
    const memory = await memoryProvider.createMemory(context.userId);
    return sessionFromMemory(memory, context);
  },
  getSession: async (sessionId) => {
    const memory = await memoryProvider.getMemory(sessionId);
    return memory ? sessionFromMemory(memory) : null;
  },
  updateSession: async (session) => {
    const memory = memoryFromSession(session);
    await memoryProvider.updateMemory(session.id, memory);
    return session;
  },
  listSessions: async (userId) => {
    const memories = await memoryProvider.listMemories(userId);
    return memories.map(memory => sessionFromMemory(memory));
  }
});
```

### Tool Compatibility
```typescript
// Bridge FAF tools to ADK tools
const createFAFToolBridge = (fafTool: FAFTool): Tool => ({
  name: fafTool.name,
  description: fafTool.description,
  parameters: fafTool.parameters,
  execute: async (params, context) => {
    const result = await fafTool.execute(params);
    return {
      success: result.success,
      data: result.content,
      error: result.error
    };
  }
});
```

## Benefits of FAF ADK Layer

### For Developers
- **Familiar Patterns**: ADK-style APIs in functional form
- **Rich Ecosystem**: Access to ADK's tool integrations
- **Type Safety**: Full TypeScript support
- **Functional Purity**: No classes, immutable state
- **Gradual Adoption**: Can be added incrementally to existing FAF projects

### For Framework
- **Enhanced Capabilities**: Multi-agent systems, streaming, guardrails
- **Ecosystem Growth**: Compatibility with ADK tools and patterns
- **Developer Experience**: Simplified complex agent workflows
- **Production Ready**: Battle-tested patterns from Google ADK

## Success Metrics

### Implementation Success
- [ ] 100% functional equivalent of core ADK features
- [ ] Zero classes in the implementation
- [ ] Full TypeScript coverage
- [ ] Performance parity with existing FAF functions

### Developer Adoption
- [ ] Clear migration path from ADK to FAF ADK Layer
- [ ] Comprehensive documentation and examples
- [ ] Positive developer feedback
- [ ] Active usage in FAF projects

### Ecosystem Integration
- [ ] Compatibility with major ADK tools (90%+)
- [ ] Seamless integration with existing FAF memory providers
- [ ] Support for ADK patterns (agents, tools, streaming)
- [ ] Maintained functional programming principles

## Next Steps

1. **Prototype Development**: Implement Phase 1 core functions
2. **Tool Integration**: Start with most common ADK tools
3. **Testing Framework**: Ensure compatibility and correctness
4. **Documentation**: Create comprehensive guides and examples
5. **Community Feedback**: Gather input from FAF and ADK developers

This FAF ADK Layer will bridge the best of both worlds - ADK's rich feature set and FAF's functional purity - creating a powerful, type-safe, and developer-friendly agent framework.