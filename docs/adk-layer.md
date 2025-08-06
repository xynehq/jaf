# JAF ADK (Agent Development Kit) Layer

## Table of Contents
1. [Introduction](#introduction)
2. [Core Components](#core-components)
3. [Integration Patterns](#integration-patterns)
4. [API Reference](#api-reference)
5. [Examples and Tutorials](#examples-and-tutorials)
6. [Best Practices](#best-practices)

## Introduction

The JAF ADK (Agent Development Kit) Layer is a functional programming implementation of Google ADK-style agent development patterns, built on top of JAF's core framework. It provides a comprehensive set of tools for building sophisticated AI agents while maintaining JAF's fundamental principle of avoiding classes and embracing functional programming.

### What is ADK and Why Use It?

The ADK Layer bridges the gap between JAF's minimal functional core and the rich feature set needed for production agent applications. It provides:

- **Rich Tool Ecosystem**: Seamless integration with OpenAPI, CrewAI, LangChain, and MCP protocols
- **Advanced Session Management**: Persistent conversation state with pluggable providers
- **Real-time Streaming**: Bidirectional communication and live interaction
- **Multi-Agent Coordination**: Hierarchical agent delegation and coordination patterns
- **Schema Validation**: Type-safe input/output validation
- **Built-in Safety**: Guardrails and content filtering
- **Example System**: Few-shot learning and conversation templates

### Functional Programming Principles

The ADK Layer strictly adheres to JAF's functional programming paradigm:

```typescript
// ✅ GOOD: Pure functions and immutable data
const agent = createAgent({
  name: 'weather_agent',
  model: 'gemini-2.0-flash',
  instruction: 'You are a helpful weather assistant.',
  tools: [weatherTool]
});

// ❌ FORBIDDEN: Classes and mutable state
class WeatherAgent {
  constructor() { /* forbidden */ }
}
```

All functions are pure, data structures are immutable, and state is managed through explicit passing rather than side effects.

### Architecture Overview

The ADK Layer consists of six main functional modules:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Content       │    │    Agents       │    │     Tools       │
│   System        │    │   Management    │    │   Integration   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Sessions      │    │    Runners      │    │   Streaming     │
│   & Providers   │    │ & Orchestration │    │ & Events       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

Each module provides pure functional interfaces that compose naturally with each other and JAF's core systems.

## Core Components

### Agents

Agents are the primary unit of intelligence in the ADK Layer. They encapsulate model configuration, instructions, tools, and behavior patterns.

#### Agent Creation

```typescript
import { createAgent, createSimpleAgent, createMultiAgent } from 'jaf/adk';

// Basic agent creation
const basicAgent = createAgent({
  name: 'chat_assistant',
  model: 'gemini-2.0-flash',
  instruction: 'You are a helpful assistant.',
  tools: []
});

// Simple agent with minimal configuration
const simpleAgent = createSimpleAgent(
  'quick_agent',
  'gemini-2.0-flash', 
  'You help with quick questions.',
  [calculatorTool]
);

// Multi-agent with sub-agents
const multiAgent = createMultiAgent(
  'coordinator',
  'gemini-2.0-flash',
  'You coordinate multiple specialists.',
  [weatherAgent, newsAgent, mathAgent],
  'conditional' // delegation strategy
);
```

#### Agent Manipulation

```typescript
// Cloning and updating agents
const updatedAgent = updateAgent(originalAgent, {
  instruction: 'Updated instruction'
});

// Adding and removing tools
const agentWithTool = addToolToAgent(agent, newTool);
const agentWithoutTool = removeToolFromAgent(agent, 'tool_name');

// Multi-agent management
const agentWithSubAgent = addSubAgent(multiAgent, specialistAgent);
const agentWithoutSubAgent = removeSubAgent(multiAgent, 'specialist_name');
```

#### Agent Query Functions

```typescript
// Query agent properties
const hasWeatherTool = hasAgentTool(agent, 'get_weather');
const weatherTool = getAgentTool(agent, 'get_weather');
const toolNames = getAgentToolNames(agent);

// Multi-agent queries
const isMulti = isMultiAgent(agent);
const subAgentNames = getSubAgentNames(multiAgent);
const specialist = getAgentSubAgent(multiAgent, 'weather_specialist');

// Agent statistics
const stats = getAgentStats(agent);
// { toolCount: 3, subAgentCount: 0, lastModified: Date, ... }
```

#### Agent Templates

Pre-built agent configurations for common use cases:

```typescript
// Built-in agent templates
const weatherAgent = createWeatherAgent();
const chatAgent = createChatAgent();
const codeAgent = createCodeAgent();

// Quick setup with convenience functions
const { agent, sessionProvider, runnerConfig, run, stream } = quickSetup(
  'my_agent',
  'gemini-2.0-flash',
  'You are a helpful assistant.',
  [calculatorTool]
);

// Use the pre-configured setup
const response = await run({ userId: 'user123' }, userMessage);
```

### Tools

Tools extend agent capabilities by providing access to external systems, APIs, and custom functions.

#### Tool Creation

```typescript
import { createFunctionTool, createAsyncFunctionTool } from 'jaf/adk';

// Synchronous function tool
const calculatorTool = createFunctionTool(
  'calculate',
  'Perform mathematical calculations',
  (params, context) => {
    const { expression } = params as { expression: string };
    return { result: eval(expression), expression };
  },
  [
    {
      name: 'expression',
      type: 'string',
      description: 'Mathematical expression to evaluate',
      required: true
    }
  ]
);

// Asynchronous function tool
const weatherTool = createAsyncFunctionTool(
  'get_weather',
  'Get current weather information',
  async (params, context) => {
    const { location } = params as { location: string };
    const weatherData = await fetchWeatherAPI(location);
    return weatherData;
  },
  [
    {
      name: 'location',
      type: 'string',
      description: 'City or location name',
      required: true
    }
  ]
);
```

#### External Tool Integration

```typescript
// OpenAPI toolset
const apiToolset = createOpenAPIToolset({
  openapi: '3.0.0',
  info: { title: 'Weather API', version: '1.0.0' },
  paths: {
    '/weather': {
      get: {
        operationId: 'getWeather',
        parameters: [
          {
            name: 'location',
            in: 'query',
            required: true,
            schema: { type: 'string' }
          }
        ]
      }
    }
  }
});

// CrewAI adapter
const crewAITool = createCrewAIAdapter(existingCrewAITool);

// LangChain adapter  
const langChainTool = createLangChainAdapter(existingLangChainTool);
```

#### Tool Execution

```typescript
// Execute single tool
const result = await executeTool(tool, { expression: '2 + 2' }, context);

// Execute multiple tools
const results = await executeTools([tool1, tool2], [params1, params2], context);

// Tool utilities
const toolByName = getToolByName(tools, 'calculate');
const hasCalculator = hasToolByName(tools, 'calculate');
const toolNames = getToolNames(tools);
const clonedTool = cloneTool(originalTool);
```

#### Built-in Tools

```typescript
// Utility tools
const echoTool = createEchoTool();
const calcTool = createCalculatorTool();
const timestampTool = createTimestampTool();

// Use in agent configuration
const agent = createAgent({
  name: 'utility_agent',
  model: 'gemini-2.0-flash',
  instruction: 'You have access to utility tools.',
  tools: [echoTool, calcTool, timestampTool]
});
```

### Content System

The content system handles all message creation, manipulation, and conversion between different formats.

#### Content Creation

```typescript
import { 
  createContent, 
  createUserMessage, 
  createModelMessage, 
  createSystemMessage 
} from 'jaf/adk';

// Basic content creation
const userMessage = createUserMessage('Hello, how are you?');
const modelMessage = createModelMessage('I am doing well, thank you!');
const systemMessage = createSystemMessage('You are a helpful assistant.');

// Complex content with multiple parts
const complexContent = createContent('user', [
  createTextPart('Look at this image:'),
  createImagePart(imageData),
  createTextPart('What do you see?')
]);
```

#### Content Manipulation

```typescript
// Add parts to existing content
const withText = addTextPart(content, 'Additional text');
const withFunction = addFunctionCall(content, functionCall);
const withResponse = addFunctionResponse(content, functionResponse);

// Content queries
const textContent = getTextContent(content);
const functionCalls = getFunctionCalls(content);
const hasText = hasTextContent(content);
const hasCalls = hasFunctionCalls(content);

// Content utilities
const merged = mergeContent([content1, content2]);
const cloned = cloneContent(originalContent);
const userMessages = filterContentByRole(conversation, 'user');
const lastUser = getLastUserMessage(conversation);
const stats = getContentStats(conversation);
```

#### Content Conversion

```typescript
// Convert to different formats
const stringRepresentation = contentToString(content);
const parsedContent = parseContent(rawData);

// Validation
const isValid = isValidContent(content);
const isValidPart = isValidPart(part);

// Conversation utilities
const conversationStats = getConversationStats(messages);
// { totalMessages: 10, userMessages: 5, modelMessages: 5, ... }
```

### Sessions and Providers

Session management handles conversation state, persistence, and context across interactions.

#### Session Creation and Management

```typescript
import { 
  createSession, 
  createInMemorySessionProvider,
  createRedisSessionProvider,
  createPostgresSessionProvider
} from 'jaf/adk';

// Create session providers
const inMemoryProvider = createInMemorySessionProvider();
const redisProvider = createRedisSessionProvider({
  host: 'localhost',
  port: 6379,
  password: 'redis_password'
});
const postgresProvider = createPostgresSessionProvider({
  connectionString: 'postgresql://user:pass@host:5432/db'
});

// Session operations
const sessionContext = { appName: 'my_app', userId: 'user123' };
const session = await inMemoryProvider.createSession(sessionContext);

// Add messages and artifacts
const updatedSession = addMessageToSession(session, userMessage);
const withArtifact = addArtifactToSession(session, 'user_prefs', preferences);
const withoutArtifact = removeArtifactFromSession(session, 'temp_data');
```

#### Session Utilities

```typescript
// Session management utilities
const sessionOrNew = await getOrCreateSession(provider, sessionContext);
const sessionStats = getSessionStats(session);
const clonedSession = cloneSession(originalSession);
const mergedArtifacts = mergeSessionArtifacts(session1, session2);

// Session queries
const lastUserMsg = getLastUserMessageFromSession(session);
const lastModelMsg = getLastModelMessageFromSession(session);
const userMessages = getMessagesByRole(session, 'user');
const hasUserPrefs = hasArtifact(session, 'user_preferences');
const preferences = getArtifact(session, 'user_preferences');
const artifactKeys = getArtifactKeys(session);
```

#### Memory Provider Bridge

```typescript
// Bridge to JAF's memory system
const memoryBridge = createMemoryProviderBridge(jafMemoryProvider);

// Use with session management
const sessionProvider = createInMemorySessionProvider({
  memoryProvider: memoryBridge
});
```

### Streaming Capabilities

Real-time interaction through event streams and live request queues.

#### Event System

```typescript
import { 
  createAgentEvent,
  createMessageStartEvent,
  createMessageDeltaEvent,
  createMessageCompleteEvent
} from 'jaf/adk';

// Create events
const startEvent = createMessageStartEvent(content);
const deltaEvent = createMessageDeltaEvent(partialContent);
const completeEvent = createMessageCompleteEvent(finalContent);
const errorEvent = createErrorEvent('Something went wrong');
```

#### Stream Management

```typescript
// Stream utilities
const eventArray = await streamToArray(eventStream);
const firstThree = takeFromStream(eventStream, 3);
const afterFirst = skipFromStream(eventStream, 1);

// Stream processing
const filteredStream = filterEventStream(eventStream, isMessageEvent);
const mappedStream = mapEventStream(eventStream, transformEvent);
const combinedStream = combineStreams([stream1, stream2]);

// Event collection
const events = await collectEvents(eventStream);
const messageStart = await findFirstEvent(eventStream, 'message_start');
const eventCount = await countEvents(eventStream);
```

#### Live Request Queue

```typescript
// Bidirectional communication
const liveQueue = createLiveRequestQueue('session_123');

// Enqueue messages
await liveQueue.enqueue(userMessage);

// Dequeue messages
const nextMessage = await liveQueue.dequeue();

// Queue management
const isEmpty = liveQueue.isEmpty();
liveQueue.close();
```

#### Stream Configuration

```typescript
// Configure streaming behavior
const streamConfig = createStreamConfig(['TEXT', 'AUDIO']);
const textConfig = createTextStreamConfig({ bufferSize: 1024 });
const audioConfig = createAudioStreamConfig({ sampleRate: 44100 });
const multiModalConfig = createMultiModalStreamConfig(['TEXT', 'IMAGE']);

// Buffered streaming
const bufferedStream = createBufferedStream(eventStream, 100);
const throttledStream = createThrottledStream(eventStream, 1000);
const debouncedStream = createDebouncedStream(eventStream, 500);
```

### Schema Validation

Type-safe input and output validation using functional schema builders.

#### Schema Creation

```typescript
import { 
  createSchemaValidator,
  stringSchema,
  numberSchema,
  objectSchema,
  arraySchema
} from 'jaf/adk';

// Basic schema validators
const nameValidator = createStringValidator({
  minLength: 1,
  maxLength: 100,
  pattern: /^[a-zA-Z\s]+$/
});

const ageValidator = createNumberValidator({
  minimum: 0,
  maximum: 150,
  integer: true
});

// Complex object schema
const userSchema = objectSchema({
  name: stringSchema({ minLength: 1 }),
  age: numberSchema({ minimum: 0 }),
  email: stringSchema({ format: 'email' }),
  preferences: arraySchema(stringSchema())
});

const userValidator = createSchemaValidator(userSchema);
```

#### Validation Functions

```typescript
// Type guards
const isValidString = isString(value);
const isValidNumber = isNumber(value);
const isValidObject = isObject(value);

// Validation utilities
const inputResult = validateInput(userValidator, inputData);
const outputResult = validateOutput(responseValidator, outputData);

// Assert validation
assertValid(userValidator, userData); // throws if invalid
const isValid = isValid(userValidator, userData); // returns boolean

// Transform and validate
const transformedData = transformAndValidate(userData, transformer, validator);
```

#### Example Schemas

```typescript
// Built-in example schemas
const weatherQuery = weatherQueryValidator;
const weatherResponse = weatherResponseValidator;

// Usage with agents
const weatherAgent = createAgent({
  name: 'weather_agent',
  model: 'gemini-2.0-flash',
  instruction: 'Provide weather information.',
  tools: [weatherTool],
  inputSchema: weatherQuery,
  outputSchema: weatherResponse
});
```

### Runners and Orchestration

Runners execute agents and manage the interaction lifecycle.

#### Runner Configuration

```typescript
import { createRunnerConfig, runAgent, runAgentStream } from 'jaf/adk';

// Basic runner setup
const runnerConfig = createRunnerConfig(agent, sessionProvider);

// Advanced runner configuration
const advancedConfig = createRunnerConfig(agent, sessionProvider, {
  artifactProvider: customArtifactProvider,
  guardrails: [contentFilter, safetyCheck],
  maxLLMCalls: 10,
  timeout: 30000
});
```

#### Agent Execution

```typescript
// Standard execution
const response = await runAgent(runnerConfig, {
  userId: 'user123',
  sessionId: 'session456',
  requestId: 'req789'
}, userMessage);

console.log(response.content.parts[0].text);
console.log(response.toolCalls);
console.log(response.metadata.tokensUsed);

// Streaming execution
const eventStream = runAgentStream(runnerConfig, {
  userId: 'user123',
  sessionId: 'session456'
}, userMessage);

for await (const event of eventStream) {
  if (event.type === 'message_delta') {
    process.stdout.write(event.content?.parts[0]?.text || '');
  } else if (event.type === 'message_complete') {
    console.log('\n[Complete]');
    break;
  }
}
```

#### Runner Statistics

```typescript
// Get execution statistics
const stats = getRunnerStats(runnerConfig);
// {
//   totalRuns: 42,
//   averageExecutionTime: 1250,
//   totalTokensUsed: 15000,
//   averageLLMCalls: 2.3
// }
```

## Integration Patterns

### External Tool Integration

#### OpenAPI Integration

```typescript
// Full OpenAPI spec integration
const apiSpec = {
  openapi: '3.0.0',
  info: { title: 'Weather API', version: '1.0.0' },
  paths: {
    '/weather/{location}': {
      get: {
        operationId: 'getWeatherByLocation',
        parameters: [
          {
            name: 'location',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Weather data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    temperature: { type: 'number' },
                    condition: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

const weatherToolset = createOpenAPIToolset(apiSpec);
const agent = createAgent({
  name: 'weather_agent',
  model: 'gemini-2.0-flash',
  instruction: 'Use the weather API to provide weather information.',
  tools: await weatherToolset.getTools()
});
```

#### CrewAI Integration

```typescript
// Integrate existing CrewAI tools
import { SomeCrewAITool } from '@crewai/tools';

const crewAITool = new SomeCrewAITool({
  config: 'configuration'
});

const adkTool = createCrewAIAdapter('crew_tool', crewAITool);

const agent = createAgent({
  name: 'crew_agent',
  model: 'gemini-2.0-flash',
  instruction: 'Use CrewAI tools to help users.',
  tools: [adkTool]
});
```

#### LangChain Integration

```typescript
// Integrate LangChain tools
import { SomeLangChainTool } from 'langchain/tools';

const langChainTool = new SomeLangChainTool({
  apiKey: process.env.API_KEY
});

const adkTool = createLangChainAdapter('langchain_tool', langChainTool);

const agent = createAgent({
  name: 'langchain_agent',
  model: 'gemini-2.0-flash',
  instruction: 'Use LangChain tools for advanced capabilities.',
  tools: [adkTool]
});
```

### Multi-Agent Patterns

#### Intelligent Agent Selection

The framework now includes intelligent agent selection based on keyword matching. When using the `conditional` delegation strategy, the system automatically selects the most relevant agent by:

1. **Extracting keywords** from the user's message (removing common words)
2. **Scoring each agent** based on keyword matches:
   - +3 points for matches in agent name
   - +2 points for matches in agent instruction
   - +2 points for matches in tool names
   - +1 point for matches in tool descriptions
3. **Selecting the highest-scoring agent** to handle the request

#### Hierarchical Delegation

```typescript
// Create specialized agents
const dataAnalyst = createAgent({
  name: 'data_analyst',
  model: 'gemini-2.0-flash',
  instruction: 'Analyze data and find patterns.',
  tools: [analysisTools]
});

const reportWriter = createAgent({
  name: 'report_writer',
  model: 'gemini-2.0-flash',
  instruction: 'Create comprehensive reports.',
  tools: [reportingTools]
});

// Create coordinator with intelligent routing
const coordinator = createMultiAgent(
  'research_coordinator',
  'gemini-2.0-flash',
  `You coordinate research tasks:
   - Send data questions to data_analyst
   - Send report requests to report_writer
   - Synthesize results into final output`,
  [dataAnalyst, reportWriter],
  'conditional'  // Uses intelligent agent selection
);
```

#### Sequential Processing

```typescript
const sequentialPipeline = createMultiAgent(
  'data_pipeline',
  'gemini-2.0-flash',
  'Process data through sequential stages: collect → analyze → report',
  [dataCollector, dataAnalyzer, reportGenerator],
  'sequential'
);
```

#### Parallel Processing

```typescript
const parallelProcessing = createMultiAgent(
  'parallel_research',
  'gemini-2.0-flash',
  'Research multiple topics simultaneously and combine results',
  [newsAgent, weatherAgent, stockAgent],
  'parallel'
);
```

The parallel strategy now includes intelligent response merging that:
- Combines responses from all agents with agent identifiers
- Merges artifacts with agent-prefixed keys
- Preserves individual agent contributions in the final response

#### Coordination Rules

You can define custom coordination rules for fine-grained control:

```typescript
const multiConfig: MultiAgentConfig = {
  name: 'smart_coordinator',
  model: 'gpt-4',
  instruction: 'Coordinate based on rules',
  tools: [],
  subAgents: [weatherAgent, newsAgent, calcAgent],
  delegationStrategy: 'conditional',
  coordinationRules: [
    {
      condition: (message, context) => 
        message.parts.some(p => p.text?.includes('weather')),
      action: 'delegate',
      targetAgents: ['weather_specialist']
    },
    {
      condition: (message, context) => 
        message.parts.some(p => p.text?.includes('calculate')),
      action: 'parallel',
      targetAgents: ['calculator', 'validator']
    }
  ]
};
```

### Session Provider Selection

#### Development vs Production

```typescript
// Development: In-memory (fast, no persistence)
const devProvider = createInMemorySessionProvider();

// Production: Redis (fast, persistent, scalable)
const prodProvider = createRedisSessionProvider({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  db: 0
});

// Enterprise: PostgreSQL (ACID compliance, full SQL)
const enterpriseProvider = createPostgresSessionProvider({
  connectionString: process.env.DATABASE_URL,
  schema: 'agent_sessions'
});

// Select provider based on environment
const sessionProvider = process.env.NODE_ENV === 'production'
  ? prodProvider
  : devProvider;
```

#### Custom Provider Implementation

```typescript
// Implement custom session provider
const customProvider: SessionProvider = {
  createSession: async (context) => {
    // Custom session creation logic
    return createSession(generateSessionId(), context.appName, context.userId);
  },
  
  getSession: async (sessionId) => {
    // Custom session retrieval logic
    return await customStorage.get(sessionId);
  },
  
  updateSession: async (session) => {
    // Custom session update logic
    await customStorage.set(session.id, session);
    return session;
  },
  
  listSessions: async (userId) => {
    // Custom session listing logic
    return await customStorage.listByUser(userId);
  },
  
  deleteSession: async (sessionId) => {
    // Custom session deletion logic
    return await customStorage.delete(sessionId);
  }
};
```

## API Reference

### Complete Function Reference

#### Agent Functions

```typescript
// Agent Creation
createAgent(config: AgentConfig): Agent
createSimpleAgent(name: string, model: string, instruction: string, tools?: Tool[]): Agent
createMultiAgent(name: string, model: string, instruction: string, subAgents: AgentConfig[], strategy: DelegationStrategy): Agent

// Agent Validation
validateAgent(agent: Agent): ValidationResult<Agent>
validateAgentConfig(config: AgentConfig): ValidationResult<AgentConfig>

// Agent Manipulation
cloneAgent(agent: Agent): Agent
updateAgent(agent: Agent, updates: Partial<AgentConfig>): Agent
addToolToAgent(agent: Agent, tool: Tool): Agent
removeToolFromAgent(agent: Agent, toolName: string): Agent
addSubAgent(agent: Agent, subAgent: AgentConfig): Agent
removeSubAgent(agent: Agent, subAgentName: string): Agent

// Agent Query
getAgentTool(agent: Agent, toolName: string): Tool | null
hasAgentTool(agent: Agent, toolName: string): boolean
getAgentSubAgent(agent: Agent, subAgentName: string): AgentConfig | null
hasSubAgent(agent: Agent, subAgentName: string): boolean
isMultiAgent(agent: Agent): boolean
getAgentToolNames(agent: Agent): string[]
getSubAgentNames(agent: Agent): string[]
getAgentStats(agent: Agent): AgentStats

// Agent Templates
createWeatherAgent(): Agent
createChatAgent(): Agent
createCodeAgent(): Agent

// Agent Utilities
agentToJSON(agent: Agent): string
agentFromJSON(json: string): Agent
compareAgents(agent1: Agent, agent2: Agent): boolean
```

#### Tool Functions

```typescript
// Tool Creation
createFunctionTool(name: string, description: string, executor: ToolExecutor, parameters: ToolParameter[]): Tool
createAsyncFunctionTool(name: string, description: string, executor: AsyncToolExecutor, parameters: ToolParameter[]): Tool
createOpenAPIToolset(spec: OpenAPISpec): Toolset
createCrewAIAdapter(name: string, crewAITool: any): Tool
createLangChainAdapter(name: string, langChainTool: any): Tool

// Tool Validation
validateTool(tool: Tool): ValidationResult<Tool>
validateToolParameter(parameter: ToolParameter): ValidationResult<ToolParameter>
validateToolParameters(parameters: ToolParameter[]): ValidationResult<ToolParameter[]>

// Tool Execution
executeTool(tool: Tool, params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>
executeTools(tools: Tool[], paramsList: Record<string, unknown>[], context: ToolContext): Promise<ToolResult[]>

// Tool Utilities
getToolByName(tools: Tool[], name: string): Tool | null
hasToolByName(tools: Tool[], name: string): boolean
filterToolsBySource(tools: Tool[], source: string): Tool[]
getToolNames(tools: Tool[]): string[]
cloneTool(tool: Tool): Tool

// Built-in Tools
createEchoTool(): Tool
createCalculatorTool(): Tool
createTimestampTool(): Tool
```

#### Content Functions

```typescript
// Content Creation
createContent(role: 'user' | 'model' | 'system', parts: Part[], metadata?: Record<string, unknown>): Content
createUserMessage(text: string): Content
createModelMessage(text: string): Content
createSystemMessage(text: string): Content
createTextPart(text: string): Part
createImagePart(data: ArrayBuffer | string): Part
createAudioPart(data: ArrayBuffer): Part
createFunctionCallPart(call: FunctionCall): Part
createFunctionResponsePart(response: FunctionResponse): Part

// Content Manipulation
addPart(content: Content, part: Part): Content
addTextPart(content: Content, text: string): Content
addFunctionCall(content: Content, call: FunctionCall): Content
addFunctionResponse(content: Content, response: FunctionResponse): Content

// Content Query
getTextContent(content: Content): string
getFunctionCalls(content: Content): FunctionCall[]
getFunctionResponses(content: Content): FunctionResponse[]
hasTextContent(content: Content): boolean
hasFunctionCalls(content: Content): boolean
hasFunctionResponses(content: Content): boolean

// Content Conversion
contentToString(content: Content): string
parseContent(data: unknown): Content

// Content Validation
isValidContent(content: Content): boolean
isValidPart(part: Part): boolean

// Content Utilities
mergeContent(contents: Content[]): Content
cloneContent(content: Content): Content
filterContentByRole(contents: Content[], role: string): Content[]
getLastUserMessage(contents: Content[]): Content | null
getLastModelMessage(contents: Content[]): Content | null
getContentStats(content: Content): ContentStats
getConversationStats(contents: Content[]): ConversationStats
```

#### Session Functions

```typescript
// Session Creation
createSession(id: string, appName: string, userId: string): Session
generateSessionId(): string

// Session Providers
createInMemorySessionProvider(config?: InMemoryConfig): SessionProvider
createRedisSessionProvider(config: RedisConfig): SessionProvider
createPostgresSessionProvider(config: PostgresConfig): SessionProvider

// Session Operations
addMessageToSession(session: Session, message: Content): Session
addArtifactToSession(session: Session, key: string, value: unknown): Session
removeArtifactFromSession(session: Session, key: string): Session
updateSessionMetadata(session: Session, metadata: Partial<SessionMetadata>): Session
clearSessionMessages(session: Session): Session

// Session Validation
validateSession(session: Session): ValidationResult<Session>
validateSessionContext(context: SessionContext): ValidationResult<SessionContext>

// Session Utilities
getOrCreateSession(provider: SessionProvider, context: SessionContext): Promise<Session>
getSessionStats(session: Session): SessionStats
cloneSession(session: Session): Session
mergeSessionArtifacts(session1: Session, session2: Session): Session

// Session Query
getLastUserMessageFromSession(session: Session): Content | null
getLastModelMessageFromSession(session: Session): Content | null
getMessagesByRole(session: Session, role: string): Content[]
hasArtifact(session: Session, key: string): boolean
getArtifact(session: Session, key: string): unknown
getArtifactKeys(session: Session): string[]
```

#### Runner Functions

```typescript
// Core Runner Functions
runAgent(config: RunnerConfig, context: RunContext, message: Content): Promise<AgentResponse>
runAgentStream(config: RunnerConfig, context: RunContext, message: Content): AsyncIterable<AgentEvent>

// Runner Configuration
createRunnerConfig(agent: Agent, sessionProvider: SessionProvider, options?: RunnerOptions): RunnerConfig
validateRunnerConfig(config: RunnerConfig): ValidationResult<RunnerConfig>
validateRunContext(context: RunContext): ValidationResult<RunContext>

// Runner Statistics
getRunnerStats(config: RunnerConfig): RunnerStats
```

#### Schema Functions

```typescript
// Schema Validator Creation
createSchemaValidator<T>(schema: JsonSchema): SchemaValidator<T>
validateAgainstJsonSchema(data: unknown, schema: JsonSchema): ValidationResult<unknown>

// Type Guards
isString(value: unknown): value is string
isNumber(value: unknown): value is number
isBoolean(value: unknown): value is boolean
isObject(value: unknown): value is object
isArray(value: unknown): value is unknown[]
isNull(value: unknown): value is null
isUndefined(value: unknown): value is undefined

// Schema Builders
stringSchema(options?: StringSchemaOptions): JsonSchema
numberSchema(options?: NumberSchemaOptions): JsonSchema
booleanSchema(): JsonSchema
objectSchema(properties: Record<string, JsonSchema>, required?: string[]): JsonSchema
arraySchema(items: JsonSchema): JsonSchema

// Common Validators
createStringValidator(options?: StringValidatorOptions): SchemaValidator<string>
createNumberValidator(options?: NumberValidatorOptions): SchemaValidator<number>
createBooleanValidator(): SchemaValidator<boolean>
createObjectValidator(schema: ObjectSchema): SchemaValidator<object>
createArrayValidator(itemValidator: SchemaValidator<unknown>): SchemaValidator<unknown[]>

// Validation Utilities
validateInput<T>(validator: SchemaValidator<T>, data: unknown): ValidationResult<T>
validateOutput<T>(validator: SchemaValidator<T>, data: unknown): ValidationResult<T>
assertValid<T>(validator: SchemaValidator<T>, data: unknown): T
isValid<T>(validator: SchemaValidator<T>, data: unknown): boolean
```

#### Streaming Functions

```typescript
// Live Request Queue
createLiveRequestQueue(id: string): LiveRequestQueue

// Event Creation
createAgentEvent(type: AgentEventType, data?: AgentEventData): AgentEvent
createMessageStartEvent(content: Content): AgentEvent
createMessageDeltaEvent(content: Content): AgentEvent
createMessageCompleteEvent(content: Content): AgentEvent
createFunctionCallStartEvent(call: FunctionCall): AgentEvent
createFunctionCallCompleteEvent(call: FunctionCall, response: FunctionResponse): AgentEvent
createErrorEvent(error: string): AgentEvent

// Stream Utilities
streamToArray<T>(stream: AsyncIterable<T>): Promise<T[]>
takeFromStream<T>(stream: AsyncIterable<T>, count: number): AsyncIterable<T>
skipFromStream<T>(stream: AsyncIterable<T>, count: number): AsyncIterable<T>
combineStreams<T>(streams: AsyncIterable<T>[]): AsyncIterable<T>
filterEventStream(stream: AsyncIterable<AgentEvent>, predicate: (event: AgentEvent) => boolean): AsyncIterable<AgentEvent>
mapEventStream<T>(stream: AsyncIterable<AgentEvent>, mapper: (event: AgentEvent) => T): AsyncIterable<T>

// Stream Configuration
createStreamConfig(modalities: ResponseModality[], options?: StreamOptions): StreamConfig
createTextStreamConfig(options?: TextStreamOptions): StreamConfig
createAudioStreamConfig(options?: AudioStreamOptions): StreamConfig
createMultiModalStreamConfig(modalities: ResponseModality[]): StreamConfig
```

### Type Definitions

#### Core Types

```typescript
interface Agent {
  id: string;
  config: AgentConfig;
  metadata: AgentMetadata;
}

interface AgentConfig {
  name: string;
  model: string;
  instruction: string;
  description?: string;
  tools: Tool[];
  subAgents?: AgentConfig[];
  inputSchema?: SchemaValidator<unknown>;
  outputSchema?: SchemaValidator<unknown>;
  outputKey?: string;
  guardrails?: GuardrailFunction[];
  examples?: Example[];
}

interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: ToolExecutor;
  metadata?: ToolMetadata;
}

interface Content {
  role: 'user' | 'model' | 'system';
  parts: Part[];
  metadata?: Record<string, unknown>;
}

interface Session {
  id: string;
  appName: string;
  userId: string;
  messages: Content[];
  artifacts: Record<string, unknown>;
  metadata: SessionMetadata;
}
```

#### Function Types

```typescript
type ToolExecutor = (
  params: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

type GuardrailFunction = (
  message: Content,
  context: GuardrailContext
) => Promise<GuardrailResult>;

type DelegationStrategy = 'sequential' | 'parallel' | 'conditional' | 'hierarchical';

type ResponseModality = 'TEXT' | 'AUDIO' | 'IMAGE';

type AgentEventType = 
  | 'message_start'
  | 'message_delta' 
  | 'message_complete'
  | 'function_call_start'
  | 'function_call_complete'
  | 'agent_transfer'
  | 'conversation_end'
  | 'error';
```

### Configuration Options

#### Runner Configuration

```typescript
interface RunnerConfig {
  agent: Agent;
  sessionProvider: SessionProvider;
  artifactProvider?: ArtifactProvider;
  guardrails?: GuardrailFunction[];
  maxLLMCalls?: number;
  timeout?: number;
}

interface RunnerOptions {
  artifactProvider?: ArtifactProvider;
  guardrails?: GuardrailFunction[];
  maxLLMCalls?: number; // default: 5
  timeout?: number; // default: 30000ms
}
```

#### Session Provider Configuration

```typescript
interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  ttl?: number; // session TTL in seconds
}

interface PostgresConfig {
  connectionString: string;
  schema?: string;
  tableName?: string;
  ssl?: boolean;
}

interface InMemoryConfig {
  maxSessions?: number; // default: 1000
  ttl?: number; // default: 3600 seconds
}
```

#### Stream Configuration

```typescript
interface StreamConfig {
  responseModalities: ResponseModality[];
  bufferSize?: number;
  timeout?: number;
}

interface TextStreamOptions {
  bufferSize?: number; // default: 1024
  encoding?: string; // default: 'utf-8'
}

interface AudioStreamOptions {
  sampleRate?: number; // default: 44100
  channels?: number; // default: 1
  bitDepth?: number; // default: 16
}
```

## Examples and Tutorials

### Basic Agent Setup

This tutorial walks through creating a simple agent from scratch.

```typescript
import { 
  createAgent, 
  createFunctionTool, 
  createInMemorySessionProvider,
  createRunnerConfig,
  runAgent,
  createUserMessage,
  quickSetup
} from 'jaf/adk';

// Step 1: Create a simple tool
const greetingTool = createFunctionTool(
  'generate_greeting',
  'Generate a personalized greeting message',
  (params, context) => {
    const { name, timeOfDay } = params as { name: string; timeOfDay: string };
    const greetings = {
      morning: 'Good morning',
      afternoon: 'Good afternoon', 
      evening: 'Good evening'
    };
    
    const greeting = greetings[timeOfDay as keyof typeof greetings] || 'Hello';
    return {
      message: `${greeting}, ${name}! How can I help you today?`,
      timeOfDay,
      timestamp: new Date().toISOString()
    };
  },
  [
    {
      name: 'name',
      type: 'string',
      description: 'Person\'s name',
      required: true
    },
    {
      name: 'timeOfDay',
      type: 'string',
      description: 'Time of day for appropriate greeting',
      required: true,
      enum: ['morning', 'afternoon', 'evening']
    }
  ]
);

// Step 2: Create the agent
const greetingAgent = createAgent({
  name: 'greeting_assistant',
  model: 'gemini-2.0-flash',
  instruction: `You are a friendly greeting assistant. When someone wants a greeting:
  1. Ask for their name if not provided
  2. Determine the appropriate time of day
  3. Use the generate_greeting tool to create a personalized greeting
  4. Be warm and welcoming in your response`,
  tools: [greetingTool]
});

// Step 3: Set up session management
const sessionProvider = createInMemorySessionProvider();

// Step 4: Create runner configuration
const runnerConfig = createRunnerConfig(greetingAgent, sessionProvider);

// Step 5: Use the agent
async function runGreetingExample() {
  const userMessage = createUserMessage('Hi there! My name is Alice and it\'s morning time.');
  
  const response = await runAgent(runnerConfig, {
    userId: 'user_alice',
    sessionId: 'greeting_session_1'
  }, userMessage);
  
  console.log('User:', userMessage.parts[0].text);
  console.log('Assistant:', response.content.parts[0].text);
  console.log('Tool calls made:', response.toolCalls.length);
}

// Alternative: Quick setup method
async function quickGreetingExample() {
  const { run } = quickSetup(
    'quick_greeter',
    'gemini-2.0-flash',
    'You are a friendly assistant who greets people.',
    [greetingTool]
  );
  
  const message = createUserMessage('Please greet me, I\'m Bob and it\'s afternoon');
  const response = await run({ userId: 'user_bob' }, message);
  
  console.log('Quick Setup Response:', response.content.parts[0].text);
}

// Run the examples
await runGreetingExample();
await quickGreetingExample();
```

### Streaming Interactions

Learn how to implement real-time streaming responses.

```typescript
import { 
  createAgent,
  createFunctionTool,
  createInMemorySessionProvider,
  createRunnerConfig,
  runAgentStream,
  createUserMessage,
  isMessageEvent,
  filterEventStream
} from 'jaf/adk';

// Create a tool that simulates a time-consuming operation
const researchTool = createFunctionTool(
  'research_topic',
  'Research a topic and provide detailed information',
  async (params, context) => {
    const { topic } = params as { topic: string };
    
    // Simulate research delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return {
      topic,
      summary: `Comprehensive research results for ${topic}`,
      keyPoints: [
        `Key insight 1 about ${topic}`,
        `Key insight 2 about ${topic}`,
        `Key insight 3 about ${topic}`
      ],
      sources: ['Source 1', 'Source 2', 'Source 3'],
      researched_at: new Date().toISOString()
    };
  },
  [
    {
      name: 'topic',
      type: 'string',
      description: 'Topic to research',
      required: true
    }
  ]
);

// Create research agent
const researchAgent = createAgent({
  name: 'research_assistant',
  model: 'gemini-2.0-flash',
  instruction: `You are a thorough research assistant. When asked about a topic:
  1. Use the research_topic tool to gather information
  2. Present findings in a clear, organized manner
  3. Provide detailed explanations and context
  4. Cite your sources when available`,
  tools: [researchTool]
});

const sessionProvider = createInMemorySessionProvider();
const runnerConfig = createRunnerConfig(researchAgent, sessionProvider);

async function streamingResearchExample() {
  console.log('=== Streaming Research Example ===\n');
  
  const userMessage = createUserMessage('Can you research the benefits of functional programming?');
  
  console.log('User:', userMessage.parts[0].text);
  console.log('Assistant (streaming):');
  
  const eventStream = runAgentStream(runnerConfig, {
    userId: 'researcher_user',
    sessionId: 'research_session'
  }, userMessage);
  
  // Filter to only message events for display
  const messageStream = filterEventStream(eventStream, isMessageEvent);
  
  let fullResponse = '';
  
  for await (const event of messageStream) {
    switch (event.type) {
      case 'message_start':
        console.log('\n[Starting response...]');
        break;
        
      case 'message_delta':
        if (event.content?.parts[0]?.text) {
          const delta = event.content.parts[0].text;
          process.stdout.write(delta);
          fullResponse += delta;
        }
        break;
        
      case 'message_complete':
        console.log('\n\n[Response complete]');
        console.log('Full response length:', fullResponse.length, 'characters');
        break;
        
      case 'function_call_start':
        if (event.functionCall) {
          console.log(`\n[Calling function: ${event.functionCall.name}]`);
        }
        break;
        
      case 'function_call_complete':
        if (event.functionResponse) {
          console.log(`[Function ${event.functionResponse.name} completed]`);
        }
        break;
        
      case 'error':
        console.log('\n[Error]:', event.error);
        break;
    }
  }
}

// Advanced streaming with event processing
async function advancedStreamingExample() {
  console.log('\n=== Advanced Streaming Example ===\n');
  
  const userMessage = createUserMessage('Research artificial intelligence and machine learning');
  
  const eventStream = runAgentStream(runnerConfig, {
    userId: 'advanced_user',
    sessionId: 'advanced_stream'
  }, userMessage);
  
  // Collect all events for analysis
  const events = [];
  let responseText = '';
  let functionCalls = 0;
  let startTime = Date.now();
  
  for await (const event of eventStream) {
    events.push(event);
    
    if (event.type === 'message_delta' && event.content?.parts[0]?.text) {
      responseText += event.content.parts[0].text;
    }
    
    if (event.type === 'function_call_start') {
      functionCalls++;
    }
    
    if (event.type === 'message_complete') {
      break;
    }
  }
  
  const endTime = Date.now();
  
  console.log('Response:', responseText);
  console.log('\n=== Stream Statistics ===');
  console.log('Total events:', events.length);
  console.log('Function calls:', functionCalls);
  console.log('Response length:', responseText.length, 'characters');
  console.log('Total time:', endTime - startTime, 'ms');
}

// Run streaming examples
await streamingResearchExample();
await advancedStreamingExample();
```

### Multi-Agent Workflows

Build sophisticated multi-agent systems for complex tasks.

```typescript
import {
  createAgent,
  createMultiAgent,
  createFunctionTool,
  createInMemorySessionProvider,
  createRunnerConfig,
  runAgent,
  createUserMessage,
  AgentConfig
} from 'jaf/adk';

// Step 1: Create specialized agents

// Data Collection Agent
const dataCollectionTool = createFunctionTool(
  'collect_data',
  'Collect data from various sources',
  async (params, context) => {
    const { sources, query } = params as { sources: string[]; query: string };
    
    // Simulate data collection
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const mockData = sources.map(source => ({
      source,
      data: `Data from ${source} about ${query}`,
      timestamp: new Date().toISOString(),
      relevance: Math.random()
    }));
    
    return {
      query,
      sources: sources.length,
      collected_data: mockData,
      collection_time: new Date().toISOString()
    };
  },
  [
    {
      name: 'sources',
      type: 'array',
      description: 'List of data sources to query',
      required: true,
      items: { type: 'string' }
    },
    {
      name: 'query',
      type: 'string',
      description: 'Search query for data collection',
      required: true
    }
  ]
);

const dataCollectorAgent: AgentConfig = {
  name: 'data_collector',
  model: 'gemini-2.0-flash',
  instruction: `You are a data collection specialist. Your job is to:
  1. Identify relevant data sources for the given query
  2. Use the collect_data tool to gather information
  3. Organize and present the collected data clearly
  4. Focus on data quality and relevance`,
  tools: [dataCollectionTool]
};

// Analysis Agent
const analysisTool = createFunctionTool(
  'analyze_data',
  'Perform statistical and pattern analysis on data',
  async (params, context) => {
    const { data, analysis_type } = params as { data: any[]; analysis_type: string };
    
    // Simulate analysis
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const analyses = {
      statistical: {
        type: 'Statistical Analysis',
        results: {
          mean: 45.6,
          median: 42.3,
          std_dev: 12.8,
          correlation: 0.73
        }
      },
      trend: {
        type: 'Trend Analysis',
        results: {
          direction: 'upward',
          strength: 'strong',
          confidence: 0.85,
          forecast: 'continued growth expected'
        }
      },
      pattern: {
        type: 'Pattern Recognition',
        results: {
          patterns_found: ['seasonal variation', 'weekly cycles'],
          anomalies: 2,
          clusters: 3
        }
      }
    };
    
    return {
      analysis_type,
      data_points: data.length,
      results: analyses[analysis_type as keyof typeof analyses] || analyses.statistical,
      confidence_level: 0.87,
      analysis_time: new Date().toISOString()
    };
  },
  [
    {
      name: 'data',
      type: 'array',
      description: 'Data to analyze',
      required: true
    },
    {
      name: 'analysis_type',
      type: 'string',
      description: 'Type of analysis to perform',
      required: false,
      enum: ['statistical', 'trend', 'pattern'],
      default: 'statistical'
    }
  ]
);

const dataAnalystAgent: AgentConfig = {
  name: 'data_analyst',
  model: 'gemini-2.0-flash',
  instruction: `You are a data analysis expert. Your responsibilities include:
  1. Receive data from the data collector
  2. Determine the most appropriate analysis methods
  3. Use the analyze_data tool to perform analysis
  4. Interpret results and identify key insights
  5. Prepare findings for the report generator`,
  tools: [analysisTool]
};

// Report Generation Agent
const reportTool = createFunctionTool(
  'generate_report',
  'Create comprehensive reports from analysis results',
  async (params, context) => {
    const { title, sections, data_summary, analysis_results } = params as {
      title: string;
      sections: string[];
      data_summary: any;
      analysis_results: any;
    };
    
    // Simulate report generation
    await new Promise(resolve => setTimeout(resolve, 800));
    
    const report = {
      title,
      generated_at: new Date().toISOString(),
      executive_summary: `This report analyzes ${data_summary.sources} data sources with ${data_summary.data_points} total data points.`,
      sections: sections.map(section => ({
        name: section,
        content: `Detailed analysis and findings for ${section}`,
        charts: [`Chart 1 for ${section}`, `Chart 2 for ${section}`]
      })),
      key_findings: [
        'Significant trend identified in the data',
        'Strong correlations found between key variables',
        'Seasonal patterns detected with high confidence'
      ],
      recommendations: [
        'Continue monitoring current trends',
        'Implement data-driven decision making',
        'Schedule regular analysis updates'
      ],
      appendices: ['Raw data tables', 'Statistical details', 'Methodology notes']
    };
    
    return {
      report,
      page_count: sections.length * 2 + 3,
      format: 'comprehensive',
      generation_time: new Date().toISOString()
    };
  },
  [
    {
      name: 'title',
      type: 'string',
      description: 'Report title',
      required: true
    },
    {
      name: 'sections',
      type: 'array',
      description: 'Report sections to include',
      required: true,
      items: { type: 'string' }
    },
    {
      name: 'data_summary',
      type: 'object',
      description: 'Summary of data used',
      required: true
    },
    {
      name: 'analysis_results',
      type: 'object',
      description: 'Results from data analysis',
      required: true
    }
  ]
);

const reportGeneratorAgent: AgentConfig = {
  name: 'report_generator',
  model: 'gemini-2.0-flash',
  instruction: `You are a report generation specialist. Your job is to:
  1. Receive data summaries and analysis results
  2. Structure information into clear, readable reports
  3. Use the generate_report tool to create comprehensive documents
  4. Ensure reports are actionable and well-organized
  5. Include executive summaries and key recommendations`,
  tools: [reportTool]
};

// Step 2: Create Multi-Agent Coordinator

const researchCoordinator = createMultiAgent(
  'research_coordinator',
  'gemini-2.0-flash',
  `You coordinate a research pipeline with three specialists:
  
  1. **data_collector**: Gathers data from multiple sources
  2. **data_analyst**: Performs statistical and pattern analysis
  3. **report_generator**: Creates comprehensive reports
  
  Your process:
  1. Start with data_collector to gather relevant information
  2. Pass collected data to data_analyst for analysis
  3. Send analysis results to report_generator for final report
  4. Synthesize all outputs into a cohesive final response
  
  Always ensure each specialist receives the information they need from previous steps.`,
  [dataCollectorAgent, dataAnalystAgent, reportGeneratorAgent],
  'sequential'
);

// Step 3: Set up execution environment

const sessionProvider = createInMemorySessionProvider();
const runnerConfig = createRunnerConfig(researchCoordinator, sessionProvider);

// Step 4: Example usage functions

async function runCompleteResearchWorkflow() {
  console.log('=== Multi-Agent Research Workflow ===\n');
  
  const researchRequest = createUserMessage(`
    I need a comprehensive analysis of user engagement trends for our mobile app.
    Please collect data from app analytics, user surveys, and competitor analysis,
    then provide a detailed report with recommendations.
  `);
  
  console.log('Research Request:', researchRequest.parts[0].text);
  console.log('\n--- Processing through multi-agent pipeline ---\n');
  
  const response = await runAgent(runnerConfig, {
    userId: 'research_manager',
    sessionId: 'research_workflow_1',
    requestId: 'workflow_001'
  }, researchRequest);
  
  console.log('=== Final Coordinated Response ===');
  console.log(response.content.parts[0].text);
  
  console.log('\n=== Workflow Statistics ===');
  console.log('Total tool calls:', response.toolCalls.length);
  console.log('Response length:', response.content.parts[0].text?.length || 0, 'characters');
  console.log('Execution time:', response.metadata.executionTime, 'ms');
  console.log('LLM calls:', response.metadata.llmCalls);
}

async function runParallelResearchExample() {
  console.log('\n=== Parallel Multi-Agent Example ===\n');
  
  // Create a parallel processing coordinator
  const parallelCoordinator = createMultiAgent(
    'parallel_research',
    'gemini-2.0-flash',
    `You coordinate parallel research across multiple domains.
    Process multiple research topics simultaneously and combine results.`,
    [dataCollectorAgent, dataAnalystAgent, reportGeneratorAgent],
    'parallel'
  );
  
  const parallelConfig = createRunnerConfig(parallelCoordinator, sessionProvider);
  
  const parallelRequest = createUserMessage(`
    Research three topics in parallel:
    1. Market trends in AI technology
    2. User behavior patterns in mobile apps  
    3. Competitive landscape analysis
    
    Provide a consolidated report covering all three areas.
  `);
  
  const parallelResponse = await runAgent(parallelConfig, {
    userId: 'parallel_researcher',
    sessionId: 'parallel_workflow'
  }, parallelRequest);
  
  console.log('Parallel Research Results:');
  console.log(parallelResponse.content.parts[0].text);
}

async function runConditionalDelegationExample() {
  console.log('\n=== Conditional Delegation Example ===\n');
  
  // Create a conditional coordinator that chooses agents based on request type
  const conditionalCoordinator = createMultiAgent(
    'smart_coordinator',
    'gemini-2.0-flash',
    `You are an intelligent coordinator that delegates based on request type:
    
    - Data collection requests → data_collector
    - Analysis questions → data_analyst  
    - Report requests → report_generator
    
    Choose the most appropriate specialist(s) for each request.`,
    [dataCollectorAgent, dataAnalystAgent, reportGeneratorAgent],
    'conditional'
  );
  
  const conditionalConfig = createRunnerConfig(conditionalCoordinator, sessionProvider);
  
  // Test different types of requests
  const requests = [
    'Collect user feedback data from our latest product launch',
    'Analyze the conversion rate trends from last quarter\'s data',
    'Generate a executive summary report of our Q4 performance'
  ];
  
  for (const [index, requestText] of requests.entries()) {
    console.log(`\n--- Request ${index + 1}: ${requestText} ---`);
    
    const request = createUserMessage(requestText);
    const response = await runAgent(conditionalConfig, {
      userId: 'conditional_user',
      sessionId: `conditional_${index + 1}`
    }, request);
    
    console.log('Response:', response.content.parts[0].text?.substring(0, 200) + '...');
  }
}

// Run all multi-agent examples
async function runAllMultiAgentExamples() {
  try {
    await runCompleteResearchWorkflow();
    await runParallelResearchExample();
    await runConditionalDelegationExample();
    
    console.log('\n=== All multi-agent workflows completed successfully! ===');
  } catch (error) {
    console.error('Multi-agent workflow failed:', error);
  }
}

// Execute the examples
await runAllMultiAgentExamples();
```

## Best Practices

### Functional Patterns

The ADK Layer is built on functional programming principles. Follow these patterns for optimal results:

#### Pure Functions

```typescript
// ✅ GOOD: Pure function - no side effects, predictable output
const createWeatherAgent = (apiKey: string) => {
  return createAgent({
    name: 'weather_agent',
    model: 'gemini-2.0-flash', 
    instruction: 'Provide weather information using the weather API.',
    tools: [createWeatherTool(apiKey)]
  });
};

// ❌ BAD: Impure function - side effects, unpredictable
let globalAgent: Agent;
const createImpureAgent = (apiKey: string) => {
  globalAgent = createAgent({ /* config */ }); // mutating global state
  console.log('Agent created'); // side effect
  return globalAgent;
};
```

#### Immutable Data

```typescript
// ✅ GOOD: Create new objects instead of mutating
const addToolToAgentPure = (agent: Agent, tool: Tool): Agent => {
  return {
    ...agent,
    config: {
      ...agent.config,
      tools: [...agent.config.tools, tool]
    }
  };
};

// ❌ BAD: Mutating existing objects
const addToolToAgentMutable = (agent: Agent, tool: Tool): Agent => {
  agent.config.tools.push(tool); // mutation!
  return agent;
};
```

#### Function Composition

```typescript
// ✅ GOOD: Compose functions for complex operations
const createCompleteAgent = (name: string, model: string) => {
  const baseAgent = createSimpleAgent(name, model, 'Base instruction');
  const withTools = addToolToAgent(baseAgent, calculatorTool);
  const withValidation = updateAgent(withTools, { 
    inputSchema: inputValidator 
  });
  return withValidation;
};

// Even better: Use function composition utilities
const createCompleteAgentComposed = (name: string, model: string) => 
  pipe(
    createSimpleAgent(name, model, 'Base instruction'),
    agent => addToolToAgent(agent, calculatorTool),
    agent => updateAgent(agent, { inputSchema: inputValidator })
  );
```

#### Error Handling

```typescript
// ✅ GOOD: Functional error handling with Result types
const runAgentSafely = async (
  config: RunnerConfig, 
  context: RunContext, 
  message: Content
): Promise<Result<AgentResponse, string>> => {
  try {
    const response = await runAgent(config, context, message);
    return { success: true, data: response };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

// Usage
const result = await runAgentSafely(config, context, message);
if (result.success) {
  console.log('Response:', result.data.content);
} else {
  console.error('Error:', result.error);
}
```

### Error Handling

Implement robust error handling throughout your agent applications:

#### Tool Error Handling

```typescript
const robustCalculatorTool = createFunctionTool(
  'calculate',
  'Perform mathematical calculations with error handling',
  (params, context) => {
    try {
      const { expression } = params as { expression: string };
      
      // Validate input
      if (!expression || typeof expression !== 'string') {
        throw new Error('Expression must be a non-empty string');
      }
      
      // Sanitize expression (remove dangerous operations)
      const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');
      
      if (sanitized !== expression) {
        throw new Error('Expression contains invalid characters');
      }
      
      // Evaluate safely
      const result = Function(`"use strict"; return (${sanitized})`)();
      
      if (!isFinite(result)) {
        throw new Error('Calculation resulted in invalid number');
      }
      
      return {
        expression: sanitized,
        result,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      // Return structured error response
      throw createToolError(
        error instanceof Error ? error.message : 'Calculation failed',
        'calculate',
        { expression: params.expression }
      );
    }
  },
  [
    {
      name: 'expression',
      type: 'string',
      description: 'Mathematical expression (numbers and basic operators only)',
      required: true
    }
  ]
);
```

#### Session Error Recovery

```typescript
const createResilientSessionProvider = (baseProvider: SessionProvider): SessionProvider => ({
  createSession: async (context) => {
    try {
      return await baseProvider.createSession(context);
    } catch (error) {
      console.warn('Session creation failed, creating fallback session:', error);
      return createSession(generateSessionId(), context.appName, context.userId);
    }
  },
  
  getSession: async (sessionId) => {
    try {
      const session = await baseProvider.getSession(sessionId);
      if (!session) {
        console.warn(`Session ${sessionId} not found`);
        return null;
      }
      return session;
    } catch (error) {
      console.error('Session retrieval failed:', error);
      return null;
    }
  },
  
  updateSession: async (session) => {
    try {
      return await baseProvider.updateSession(session);
    } catch (error) {
      console.error('Session update failed:', error);
      // Return original session if update fails
      return session;
    }
  },
  
  listSessions: async (userId) => {
    try {
      return await baseProvider.listSessions(userId);
    } catch (error) {
      console.error('Session listing failed:', error);
      return [];
    }
  },
  
  deleteSession: async (sessionId) => {
    try {
      return await baseProvider.deleteSession(sessionId);
    } catch (error) {
      console.error('Session deletion failed:', error);
      return false;
    }
  }
});
```

#### Agent Execution Error Handling

```typescript
const runAgentWithRetry = async (
  config: RunnerConfig,
  context: RunContext,
  message: Content,
  maxRetries: number = 3
): Promise<AgentResponse> => {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await runAgent(config, context, message);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      
      console.warn(`Agent execution attempt ${attempt} failed:`, lastError.message);
      
      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw createAgentError(
    `Agent execution failed after ${maxRetries} attempts: ${lastError!.message}`,
    config.agent.id,
    { maxRetries, lastError: lastError!.message }
  );
};
```

### Performance Optimization

Optimize your agent applications for production use:

#### Tool Caching

```typescript
const createCachedTool = <T>(
  baseTool: Tool,
  cacheKeyFn: (params: Record<string, unknown>) => string,
  ttlMs: number = 300000 // 5 minutes
): Tool => {
  const cache = new Map<string, { result: T; timestamp: number }>();
  
  return {
    ...baseTool,
    execute: async (params, context) => {
      const cacheKey = cacheKeyFn(params);
      const cached = cache.get(cacheKey);
      
      // Check cache validity
      if (cached && Date.now() - cached.timestamp < ttlMs) {
        return {
          success: true,
          data: cached.result,
          metadata: { fromCache: true }
        };
      }
      
      // Execute tool and cache result
      const result = await baseTool.execute(params, context);
      
      if (result.success) {
        cache.set(cacheKey, {
          result: result.data,
          timestamp: Date.now()
        });
      }
      
      return result;
    }
  };
};

// Usage
const cachedWeatherTool = createCachedTool(
  weatherTool,
  (params) => `weather_${(params as any).location}`,
  600000 // 10 minutes
);
```

#### Session Optimization

```typescript
const optimizedSessionProvider = createInMemorySessionProvider({
  maxSessions: 10000, // Limit memory usage
  ttl: 3600 // Auto-cleanup after 1 hour
});

// Use compression for large sessions
const compressedSessionProvider = createCompressedSessionProvider(
  optimizedSessionProvider,
  {
    compressionLevel: 6,
    minSizeForCompression: 1024 // Only compress sessions > 1KB
  }
);
```

#### Streaming Optimization

```typescript
// Optimize streaming with buffering
const optimizedStreamConfig = createStreamConfig(['TEXT'], {
  bufferSize: 2048, // Larger buffer for better throughput
  timeout: 5000     // Reasonable timeout
});

// Use throttled streaming for real-time applications
const createThrottledAgent = (agent: Agent) => {
  const sessionProvider = createInMemorySessionProvider();
  const runnerConfig = createRunnerConfig(agent, sessionProvider);
  
  return {
    runStream: (context: RunContext, message: Content) => {
      const baseStream = runAgentStream(runnerConfig, context, message);
      return createThrottledStream(baseStream, 100); // Max 10 events/second
    }
  };
};
```

#### Memory Management

```typescript
// Clean up resources properly
const createResourceManagedAgent = (agentConfig: AgentConfig) => {
  const resources: (() => void)[] = [];
  
  const agent = createAgent({
    ...agentConfig,
    tools: agentConfig.tools.map(tool => ({
      ...tool,
      execute: async (params, context) => {
        try {
          return await tool.execute(params, context);
        } finally {
          // Clean up any resources created during tool execution
          resources.forEach(cleanup => cleanup());
          resources.length = 0;
        }
      }
    }))
  });
  
  return {
    agent,
    cleanup: () => {
      resources.forEach(cleanup => cleanup());
      resources.length = 0;
    }
  };
};
```

#### Monitoring and Metrics

```typescript
const createMonitoredAgent = (agent: Agent) => {
  const metrics = {
    totalRuns: 0,
    totalErrors: 0,
    averageResponseTime: 0,
    toolUsageCount: new Map<string, number>()
  };
  
  const monitoredAgent = updateAgent(agent, {
    tools: agent.config.tools.map(tool => ({
      ...tool,
      execute: async (params, context) => {
        const startTime = Date.now();
        
        try {
          const result = await tool.execute(params, context);
          
          // Update metrics
          metrics.toolUsageCount.set(
            tool.name,
            (metrics.toolUsageCount.get(tool.name) || 0) + 1
          );
          
          return result;
        } catch (error) {
          metrics.totalErrors++;
          throw error;
        } finally {
          const duration = Date.now() - startTime;
          metrics.averageResponseTime = 
            (metrics.averageResponseTime * metrics.totalRuns + duration) / 
            (metrics.totalRuns + 1);
          metrics.totalRuns++;
        }
      }
    }))
  });
  
  return {
    agent: monitoredAgent,
    getMetrics: () => ({ ...metrics }),
    resetMetrics: () => {
      metrics.totalRuns = 0;
      metrics.totalErrors = 0;
      metrics.averageResponseTime = 0;
      metrics.toolUsageCount.clear();
    }
  };
};
```

### Code Organization

Structure your ADK applications for maintainability:

#### Modular Agent Architecture

```typescript
// agents/weather.ts
export const createWeatherAgentConfig = (apiKey: string): AgentConfig => ({
  name: 'weather_specialist',
  model: 'gemini-2.0-flash',
  instruction: 'Provide accurate weather information using the weather API.',
  tools: [createWeatherTool(apiKey)]
});

// agents/news.ts
export const createNewsAgentConfig = (apiKey: string): AgentConfig => ({
  name: 'news_specialist',
  model: 'gemini-2.0-flash',
  instruction: 'Provide current news and updates.',
  tools: [createNewsTool(apiKey)]
});

// agents/coordinator.ts
export const createCoordinatorAgent = (
  weatherConfig: AgentConfig,
  newsConfig: AgentConfig
) => {
  return createMultiAgent(
    'smart_coordinator',
    'gemini-2.0-flash',
    'Coordinate between weather and news specialists.',
    [weatherConfig, newsConfig],
    'conditional'
  );
};

// app.ts
import { createWeatherAgentConfig } from './agents/weather';
import { createNewsAgentConfig } from './agents/news';
import { createCoordinatorAgent } from './agents/coordinator';

const weatherAgent = createWeatherAgentConfig(process.env.WEATHER_API_KEY!);
const newsAgent = createNewsAgentConfig(process.env.NEWS_API_KEY!);
const coordinator = createCoordinatorAgent(weatherAgent, newsAgent);
```

#### Configuration Management

```typescript
// config/agents.ts
export interface AppConfig {
  weather: {
    apiKey: string;
    endpoint: string;
  };
  news: {
    apiKey: string;
    sources: string[];
  };
  session: {
    provider: 'memory' | 'redis' | 'postgres';
    redis?: RedisConfig;
    postgres?: PostgresConfig;
  };
  runner: {
    maxLLMCalls: number;
    timeout: number;
  };
}

export const loadConfig = (): AppConfig => ({
  weather: {
    apiKey: process.env.WEATHER_API_KEY!,
    endpoint: process.env.WEATHER_ENDPOINT || 'https://api.weather.com'
  },
  news: {
    apiKey: process.env.NEWS_API_KEY!,
    sources: (process.env.NEWS_SOURCES || 'bbc,cnn').split(',')
  },
  session: {
    provider: (process.env.SESSION_PROVIDER as any) || 'memory',
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    }
  },
  runner: {
    maxLLMCalls: parseInt(process.env.MAX_LLM_CALLS || '5'),
    timeout: parseInt(process.env.TIMEOUT || '30000')
  }
});
```

#### Factory Pattern for Providers

```typescript
// providers/factory.ts
export const createSessionProvider = (config: AppConfig): SessionProvider => {
  switch (config.session.provider) {
    case 'redis':
      return createRedisSessionProvider(config.session.redis!);
    case 'postgres':
      return createPostgresSessionProvider(config.session.postgres!);
    case 'memory':
    default:
      return createInMemorySessionProvider();
  }
};

export const createRunnerConfig = (
  agent: Agent,
  config: AppConfig
): RunnerConfig => {
  const sessionProvider = createSessionProvider(config);
  
  return createRunnerConfig(agent, sessionProvider, {
    maxLLMCalls: config.runner.maxLLMCalls,
    timeout: config.runner.timeout
  });
};
```

This comprehensive documentation provides everything needed to effectively use the JAF ADK Layer for building sophisticated AI agents while maintaining JAF's functional programming principles.