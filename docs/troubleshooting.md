# Troubleshooting Guide - Functional Agent Framework (FAF)

## Table of Contents

1. [Common Error Patterns](#common-error-patterns)
2. [Debugging Techniques](#debugging-techniques)
3. [Memory Provider Issues](#memory-provider-issues)
4. [Model Provider Troubleshooting](#model-provider-troubleshooting)
5. [Tool Execution Debugging](#tool-execution-debugging)
6. [Server and API Debugging](#server-and-api-debugging)
7. [Performance Troubleshooting](#performance-troubleshooting)
8. [Configuration Issues](#configuration-issues)
9. [Environment Setup Problems](#environment-setup-problems)
10. [Log Analysis and Observability](#log-analysis-and-observability)
11. [Frequently Asked Questions (FAQ)](#frequently-asked-questions-faq)

---

## Common Error Patterns

### 1. MaxTurnsExceeded Error

**Error Pattern:**
```typescript
{
  _tag: 'MaxTurnsExceeded',
  turns: 50
}
```

**Causes:**
- Agent caught in infinite loop calling tools
- Model consistently producing tool calls without completion
- Overly complex reasoning chains

**Solutions:**
```typescript
// Adjust maxTurns in run configuration
const runConfig: RunConfig<Ctx> = {
  agentRegistry,
  modelProvider,
  maxTurns: 20, // Reduce from default 50
};

// Add completion condition in agent instructions
const agent: Agent<Ctx, string> = {
  name: 'MyAgent',
  instructions: (state) => `
    ${baseInstructions}
    
    IMPORTANT: After using tools, provide a final answer. 
    Do not continue calling tools unnecessarily.
  `,
};
```

### 2. ModelBehaviorError

**Error Pattern:**
```typescript
{
  _tag: 'ModelBehaviorError',
  detail: 'No message in model response'
}
```

**Common Causes & Solutions:**

```typescript
// Cause: Invalid model configuration
const modelProvider = makeLiteLLMProvider(
  'http://localhost:8000', // Ensure server is running
  'valid-api-key'          // Check API key
);

// Cause: Network connectivity issues
// Check: curl http://localhost:8000/health

// Cause: Model overload or rate limiting
// Solution: Add retry logic or use different model
```

### 3. DecodeError

**Error Pattern:**
```typescript
{
  _tag: 'DecodeError',
  errors: [
    {
      path: ['field'],
      message: 'Required'
    }
  ]
}
```

**Solutions:**
```typescript
// Define clear output schema
const outputSchema = z.object({
  answer: z.string().describe('The final answer'),
  confidence: z.number().min(0).max(1).optional()
});

// Update agent instructions for structured output
const agent: Agent<Ctx, OutputType> = {
  outputCodec: outputSchema,
  instructions: (state) => `
    Respond with JSON matching this exact structure:
    {
      "answer": "your response here",
      "confidence": 0.9
    }
  `
};
```

### 4. ToolCallError

**Error Pattern:**
```typescript
{
  _tag: 'ToolCallError',
  tool: 'calculator',
  detail: 'Tool execution failed'
}
```

**Debugging Steps:**
```typescript
// Check tool execution
const debugTool: Tool<CalculatorArgs, Ctx> = {
  schema: {
    name: 'calculator',
    description: 'Perform calculations',
    parameters: z.object({
      expression: z.string()
    })
  },
  execute: async (args, context) => {
    try {
      console.log('[DEBUG] Tool args:', args);
      console.log('[DEBUG] Context:', context);
      
      const result = evaluate(args.expression);
      console.log('[DEBUG] Tool result:', result);
      
      return `Result: ${result}`;
    } catch (error) {
      console.error('[DEBUG] Tool error:', error);
      throw error;
    }
  }
};
```

### 5. AgentNotFound Error

**Error Pattern:**
```typescript
{
  _tag: 'AgentNotFound',
  agentName: 'NonexistentAgent'
}
```

**Solutions:**
```typescript
// Verify agent registry
console.log('Available agents:', Array.from(agentRegistry.keys()));

// Check agent name spelling
const runState: RunState<Ctx> = {
  currentAgentName: 'MathTutor', // Ensure exact match
  // ... other properties
};

// Use defensive programming
const getAgent = (name: string) => {
  const agent = agentRegistry.get(name);
  if (!agent) {
    throw new Error(`Agent '${name}' not found. Available: ${Array.from(agentRegistry.keys()).join(', ')}`);
  }
  return agent;
};
```

### 6. Guardrail Errors

**Input Guardrail:**
```typescript
{
  _tag: 'InputGuardrailTripwire',
  reason: 'Inappropriate content detected'
}
```

**Output Guardrail:**
```typescript
{
  _tag: 'OutputGuardrailTripwire',
  reason: 'Response contains sensitive information'
}
```

**Implementation:**
```typescript
const contentFilter: Guardrail<string> = async (input) => {
  const forbidden = ['password', 'secret', 'token'];
  const containsForbidden = forbidden.some(word => 
    input.toLowerCase().includes(word)
  );
  
  return containsForbidden 
    ? { isValid: false, errorMessage: 'Input contains forbidden content' }
    : { isValid: true };
};

const runConfig: RunConfig<Ctx> = {
  initialInputGuardrails: [contentFilter],
  finalOutputGuardrails: [contentFilter],
  // ... other config
};
```

### 7. HandoffError

**Error Pattern:**
```typescript
{
  _tag: 'HandoffError',
  detail: 'Agent MathTutor cannot handoff to AdminAgent'
}
```

**Solutions:**
```typescript
// Define allowed handoffs explicitly
const mathTutor: Agent<Ctx, string> = {
  name: 'MathTutor',
  handoffs: ['HelperAgent', 'ExpertAgent'], // Allowed targets
  tools: [handoffTool],
  // ... other properties
};

// Create handoff tool that returns proper format
const handoffTool: Tool<HandoffArgs, Ctx> = {
  execute: async (args, context) => {
    return JSON.stringify({
      handoff_to: args.targetAgent,
      reason: args.reason
    });
  }
};
```

---

## Debugging Techniques

### 1. Enable Comprehensive Logging

```typescript
import { ConsoleTraceCollector, FileTraceCollector, createCompositeTraceCollector } from 'faf';

// Console + File logging
const traceCollector = createCompositeTraceCollector(
  new ConsoleTraceCollector(),
  new FileTraceCollector('./debug.log')
);

const runConfig: RunConfig<Ctx> = {
  onEvent: (event) => traceCollector.collect(event),
  // ... other config
};
```

### 2. Debug Mode Setup

```typescript
// Environment variable for debug mode
const DEBUG_MODE = process.env.FAF_DEBUG === 'true';

const debugLog = (message: string, data?: any) => {
  if (DEBUG_MODE) {
    console.log(`[FAF:DEBUG] ${message}`, data || '');
  }
};

// Use in tools and agents
const debugTool: Tool<any, Ctx> = {
  execute: async (args, context) => {
    debugLog('Tool execution started', { args, context });
    
    try {
      const result = await actualExecution(args, context);
      debugLog('Tool execution completed', { result });
      return result;
    } catch (error) {
      debugLog('Tool execution failed', { error });
      throw error;
    }
  }
};
```

### 3. Step-by-Step Execution Tracing

```typescript
class DebugModelProvider implements ModelProvider<Ctx> {
  constructor(private baseProvider: ModelProvider<Ctx>) {}
  
  async getCompletion(state: RunState<Ctx>, agent: Agent<Ctx, any>, config: RunConfig<Ctx>) {
    console.log('[DEBUG] Model call for agent:', agent.name);
    console.log('[DEBUG] Message count:', state.messages.length);
    console.log('[DEBUG] Last message:', state.messages[state.messages.length - 1]);
    
    const start = Date.now();
    const result = await this.baseProvider.getCompletion(state, agent, config);
    const duration = Date.now() - start;
    
    console.log('[DEBUG] Model response time:', duration + 'ms');
    console.log('[DEBUG] Response type:', result.message?.tool_calls ? 'tool_calls' : 'content');
    
    return result;
  }
}

// Wrap your model provider
const modelProvider = new DebugModelProvider(originalProvider);
```

### 4. State Inspection Utilities

```typescript
const inspectRunState = (state: RunState<Ctx>, label: string) => {
  console.log(`\n=== ${label} ===`);
  console.log('Run ID:', state.runId);
  console.log('Agent:', state.currentAgentName);
  console.log('Turn:', state.turnCount);
  console.log('Messages:', state.messages.length);
  console.log('Latest message roles:', state.messages.slice(-3).map(m => m.role));
  console.log('Context:', Object.keys(state.context));
  console.log('==================\n');
};

// Use before and after critical operations
inspectRunState(initialState, 'BEFORE RUN');
const result = await run(initialState, config);
inspectRunState(result.finalState, 'AFTER RUN');
```

---

## Memory Provider Issues

### 1. Connection Problems

**In-Memory Provider:**
```typescript
// Issues: None - always works
// Use for: Development, testing
console.log('[MEMORY:InMemory] Always reliable');
```

**Redis Connection Issues:**
```bash
# Check Redis server status
docker ps | grep redis
redis-cli ping

# Common connection errors
Error: Redis connection refused
```

```typescript
// Debug Redis connection
const debugRedisProvider = async (config: RedisConfig) => {
  try {
    const redis = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
    });
    
    await redis.ping();
    console.log('[REDIS] Connection successful');
    return redis;
  } catch (error) {
    console.error('[REDIS] Connection failed:', error.message);
    
    // Common fixes
    console.log('Troubleshooting steps:');
    console.log('1. Check if Redis server is running');
    console.log('2. Verify host and port configuration');
    console.log('3. Check firewall settings');
    console.log('4. Verify authentication credentials');
    
    throw error;
  }
};
```

**PostgreSQL Connection Issues:**
```bash
# Check PostgreSQL server
docker ps | grep postgres
pg_isready -h localhost -p 5432

# Connection string format
postgresql://username:password@host:port/database
```

```typescript
// Debug PostgreSQL connection
const debugPostgresConnection = async (config: PostgresConfig) => {
  const connectionString = config.connectionString || 
    `postgresql://${config.username}:${config.password}@${config.host}:${config.port}/${config.database}`;
    
  console.log('[POSTGRES] Attempting connection to:', 
    connectionString.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@'));
    
  try {
    const client = new Client({ connectionString });
    await client.connect();
    console.log('[POSTGRES] Connection successful');
    await client.end();
  } catch (error) {
    console.error('[POSTGRES] Connection failed:', error.message);
    
    // Error-specific guidance
    if (error.code === 'ECONNREFUSED') {
      console.log('Fix: Start PostgreSQL server');
    } else if (error.code === '28P01') {
      console.log('Fix: Check username/password');
    } else if (error.code === '3D000') {
      console.log('Fix: Create database or check database name');
    }
    
    throw error;
  }
};
```

### 2. Memory Performance Issues

**Monitoring Memory Usage:**
```typescript
const monitorMemoryProvider = (provider: MemoryProvider) => {
  const originalStoreMessages = provider.storeMessages;
  
  provider.storeMessages = async (conversationId, messages, metadata) => {
    const start = Date.now();
    const result = await originalStoreMessages(conversationId, messages, metadata);
    const duration = Date.now() - start;
    
    if (duration > 1000) {
      console.warn(`[MEMORY] Slow store operation: ${duration}ms for ${messages.length} messages`);
    }
    
    return result;
  };
  
  return provider;
};
```

**Memory Cleanup:**
```typescript
// Periodic cleanup for production
const scheduleMemoryCleanup = async (provider: MemoryProvider) => {
  setInterval(async () => {
    try {
      if ('cleanup' in provider && typeof provider.cleanup === 'function') {
        const result = await provider.cleanup(30); // 30 days
        console.log(`[MEMORY] Cleaned up ${result} old conversations`);
      }
    } catch (error) {
      console.error('[MEMORY] Cleanup failed:', error);
    }
  }, 24 * 60 * 60 * 1000); // Daily
};
```

### 3. Memory Data Corruption

**Validation:**
```typescript
const validateConversationData = (conversation: ConversationMemory): boolean => {
  try {
    // Check required fields
    if (!conversation.conversationId || !conversation.messages) {
      return false;
    }
    
    // Validate message structure
    for (const message of conversation.messages) {
      if (!message.role || !message.content) {
        return false;
      }
      if (!['user', 'assistant', 'tool'].includes(message.role)) {
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
};

// Use when retrieving conversations
const safeGetConversation = async (provider: MemoryProvider, id: string) => {
  const result = await provider.getConversation(id);
  
  if (result.success && result.data) {
    if (!validateConversationData(result.data)) {
      console.warn(`[MEMORY] Invalid conversation data for ${id}`);
      return { success: false, error: { message: 'Invalid conversation data' } };
    }
  }
  
  return result;
};
```

---

## Model Provider Troubleshooting

### 1. API Connection Issues

**OpenAI/LiteLLM Provider Issues:**
```typescript
// Test connectivity
const testModelProvider = async (provider: ModelProvider<Ctx>) => {
  const testState: RunState<Ctx> = {
    runId: createRunId('test'),
    traceId: createTraceId('test'),
    messages: [{ role: 'user', content: 'Hello' }],
    currentAgentName: 'test',
    context: {} as Ctx,
    turnCount: 0
  };
  
  const testAgent: Agent<Ctx, string> = {
    name: 'test',
    instructions: () => 'Respond with "OK"'
  };
  
  try {
    const result = await provider.getCompletion(testState, testAgent, {} as RunConfig<Ctx>);
    console.log('[MODEL] Provider test successful');
    return true;
  } catch (error) {
    console.error('[MODEL] Provider test failed:', error.message);
    
    // Specific error handling
    if (error.status === 401) {
      console.log('Fix: Check API key configuration');
    } else if (error.status === 429) {
      console.log('Fix: Rate limited - wait and retry');
    } else if (error.code === 'ECONNREFUSED') {
      console.log('Fix: Check if model server is running');
    }
    
    return false;
  }
};
```

### 2. Model Response Issues

**Empty or Invalid Responses:**
```typescript
const robustModelProvider = (baseProvider: ModelProvider<Ctx>): ModelProvider<Ctx> => ({
  async getCompletion(state, agent, config) {
    const maxRetries = 3;
    let lastError: Error | null = null;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const result = await baseProvider.getCompletion(state, agent, config);
        
        // Validate response
        if (!result.message) {
          throw new Error('Empty model response');
        }
        
        if (!result.message.content && !result.message.tool_calls) {
          throw new Error('Model response has no content or tool calls');
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        console.warn(`[MODEL] Attempt ${i + 1} failed:`, error.message);
        
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }
    
    throw lastError;
  }
});
```

### 3. Model Configuration Issues

**Token Limits:**
```typescript
const calculateTokenUsage = (messages: Message[]): number => {
  // Rough estimation: 4 characters ≈ 1 token
  return messages.reduce((total, msg) => 
    total + Math.ceil(msg.content.length / 4), 0
  );
};

const managedModelProvider = (baseProvider: ModelProvider<Ctx>): ModelProvider<Ctx> => ({
  async getCompletion(state, agent, config) {
    const estimatedTokens = calculateTokenUsage(state.messages);
    const maxTokens = agent.modelConfig?.maxTokens || 4000;
    
    if (estimatedTokens > maxTokens * 0.8) {
      console.warn(`[MODEL] High token usage: ${estimatedTokens}/${maxTokens}`);
      
      // Truncate older messages
      const keepRecent = 5;
      const truncatedMessages = state.messages.slice(-keepRecent);
      const truncatedState = { ...state, messages: truncatedMessages };
      
      return baseProvider.getCompletion(truncatedState, agent, config);
    }
    
    return baseProvider.getCompletion(state, agent, config);
  }
});
```

---

## Tool Execution Debugging

### 1. Tool Call Failures

**Common Tool Issues:**
```typescript
// Issue: Invalid arguments
{
  error: "validation_error",
  message: "Invalid arguments for calculator: Required property 'expression'",
  tool_name: "calculator",
  validation_errors: [...]
}

// Issue: Tool not found
{
  error: "tool_not_found",
  message: "Tool calculator not found",
  tool_name: "calculator"
}

// Issue: Execution error
{
  error: "execution_error",
  message: "Division by zero",
  tool_name: "calculator"
}
```

**Robust Tool Implementation:**
```typescript
const robustCalculatorTool: Tool<CalculatorArgs, Ctx> = {
  schema: {
    name: 'calculator',
    description: 'Perform mathematical calculations',
    parameters: z.object({
      expression: z.string().describe('Mathematical expression to evaluate')
    })
  },
  
  execute: async (args, context) => {
    try {
      // Input validation
      if (!args.expression || typeof args.expression !== 'string') {
        return JSON.stringify({
          error: 'invalid_input',
          message: 'Expression must be a non-empty string'
        });
      }
      
      // Security check
      const allowedChars = /^[0-9+\-*/().\s]+$/;
      if (!allowedChars.test(args.expression)) {
        return JSON.stringify({
          error: 'invalid_expression',
          message: 'Expression contains invalid characters'
        });
      }
      
      // Safe evaluation
      const result = Function(`"use strict"; return (${args.expression})`)();
      
      if (typeof result !== 'number' || !isFinite(result)) {
        return JSON.stringify({
          error: 'invalid_result',
          message: 'Expression did not produce a valid number'
        });
      }
      
      return JSON.stringify({
        result: result,
        expression: args.expression
      });
      
    } catch (error) {
      console.error('[TOOL:Calculator] Error:', error);
      
      return JSON.stringify({
        error: 'execution_error',
        message: error instanceof Error ? error.message : 'Unknown error',
        expression: args.expression
      });
    }
  }
};
```

### 2. Tool Response Formats

**Standardized Tool Responses:**
```typescript
import { ToolResult } from 'faf';

// Success response
const successTool: Tool<any, Ctx> = {
  execute: async (args, context) => {
    const result: ToolResult = {
      status: 'success',
      data: { value: 42 },
      message: 'Calculation completed successfully'
    };
    return result;
  }
};

// Error response
const errorTool: Tool<any, Ctx> = {
  execute: async (args, context) => {
    const result: ToolResult = {
      status: 'error',
      error: 'division_by_zero',
      message: 'Cannot divide by zero'
    };
    return result;
  }
};

// Async operation
const asyncTool: Tool<any, Ctx> = {
  execute: async (args, context) => {
    const result: ToolResult = {
      status: 'pending',
      taskId: 'task-123',
      message: 'Operation started, check status later'
    };
    return result;
  }
};
```

### 3. Tool Debugging Utilities

```typescript
// Tool execution wrapper for debugging
const debugTool = <T, Ctx>(tool: Tool<T, Ctx>): Tool<T, Ctx> => ({
  ...tool,
  execute: async (args, context) => {
    const toolName = tool.schema.name;
    const startTime = Date.now();
    
    console.log(`[TOOL:${toolName}] Starting execution`);
    console.log(`[TOOL:${toolName}] Args:`, JSON.stringify(args, null, 2));
    console.log(`[TOOL:${toolName}] Context keys:`, Object.keys(context));
    
    try {
      const result = await tool.execute(args, context);
      const duration = Date.now() - startTime;
      
      console.log(`[TOOL:${toolName}] Completed in ${duration}ms`);
      console.log(`[TOOL:${toolName}] Result type:`, typeof result);
      console.log(`[TOOL:${toolName}] Result preview:`, 
        typeof result === 'string' ? result.substring(0, 200) + '...' : result);
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error(`[TOOL:${toolName}] Failed after ${duration}ms`);
      console.error(`[TOOL:${toolName}] Error:`, error);
      
      throw error;
    }
  }
});

// Apply to all tools
const debugAgent: Agent<Ctx, any> = {
  ...originalAgent,
  tools: originalAgent.tools?.map(debugTool)
};
```

---

## Server and API Debugging

### 1. Server Startup Issues

**Common Server Problems:**
```typescript
// Port already in use
Error: listen EADDRINUSE: address already in use :::3000

// Memory provider not configured
{
  success: false,
  error: 'Memory provider not configured'
}

// Missing environment variables
Error: Missing required environment variable: FAF_API_KEY
```

**Startup Diagnostics:**
```typescript
const diagnosticServer = (config: ServerConfig<Ctx>) => {
  console.log('=== FAF Server Diagnostics ===');
  
  // Check port availability
  const net = require('net');
  const server = net.createServer();
  
  server.listen(config.port, (err: any) => {
    if (err) {
      console.error(`❌ Port ${config.port} is not available`);
      console.log(`💡 Try: lsof -ti:${config.port} | xargs kill -9`);
    } else {
      console.log(`✅ Port ${config.port} is available`);
      server.close();
    }
  });
  
  // Check agent registry
  console.log(`📋 Agents: ${Array.from(config.agentRegistry.keys()).join(', ')}`);
  
  // Check memory provider
  if (config.defaultMemoryProvider) {
    console.log('✅ Memory provider configured');
    config.defaultMemoryProvider.healthCheck().then(result => {
      if (result.success) {
        console.log(`✅ Memory provider healthy (${result.data.latencyMs}ms)`);
      } else {
        console.error('❌ Memory provider unhealthy:', result.error);
      }
    });
  } else {
    console.log('⚠️  Memory provider not configured');
  }
  
  console.log('===============================');
};
```

### 2. API Request/Response Issues

**Request Validation:**
```typescript
// Detailed request logging
app.addHook('preHandler', async (request, reply) => {
  const reqId = Math.random().toString(36).substr(2, 9);
  
  console.log(`[REQ:${reqId}] ${request.method} ${request.url}`);
  console.log(`[REQ:${reqId}] Headers:`, request.headers);
  
  if (request.body) {
    console.log(`[REQ:${reqId}] Body:`, JSON.stringify(request.body, null, 2));
  }
  
  request.reqId = reqId;
});

app.addHook('onSend', async (request, reply, payload) => {
  const reqId = (request as any).reqId;
  console.log(`[RES:${reqId}] Status: ${reply.statusCode}`);
  console.log(`[RES:${reqId}] Body preview:`, payload.toString().substring(0, 500));
});
```

**Common API Errors:**
```typescript
// Agent not found
{
  success: false,
  error: "Agent 'NonexistentAgent' not found. Available agents: MathTutor, RAGAgent"
}

// Invalid request format
{
  success: false,
  error: "Invalid request body: missing required property 'messages'"
}

// Conversation not found
{
  success: false,
  error: "Conversation conv-123 not found"
}
```

### 3. Streaming and Real-time Issues

**WebSocket Debugging:**
```typescript
// Server-sent events for real-time updates
app.get('/events/:conversationId', async (request, reply) => {
  const conversationId = request.params.conversationId;
  
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  const sendEvent = (event: string, data: any) => {
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  // Send initial connection event
  sendEvent('connected', { conversationId });
  
  // Handle disconnection
  request.raw.on('close', () => {
    console.log(`[STREAM] Client disconnected from ${conversationId}`);
  });
});
```

---

## Performance Troubleshooting

### 1. Response Time Analysis

**Performance Monitoring:**
```typescript
class PerformanceTraceCollector implements TraceCollector {
  private metrics = new Map<string, number[]>();
  
  collect(event: TraceEvent): void {
    if (event.type === 'llm_call_start') {
      this.startTime = Date.now();
    }
    
    if (event.type === 'llm_call_end') {
      const duration = Date.now() - this.startTime;
      this.recordMetric('llm_call', duration);
      
      if (duration > 5000) {
        console.warn(`[PERF] Slow LLM call: ${duration}ms`);
      }
    }
    
    if (event.type === 'tool_call_end') {
      const toolName = event.data.toolName;
      // Extract duration from tool execution
      this.recordMetric(`tool_${toolName}`, duration);
    }
  }
  
  recordMetric(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(value);
  }
  
  getStats(name: string) {
    const values = this.metrics.get(name) || [];
    if (values.length === 0) return null;
    
    values.sort((a, b) => a - b);
    return {
      count: values.length,
      avg: values.reduce((a, b) => a + b) / values.length,
      median: values[Math.floor(values.length / 2)],
      p95: values[Math.floor(values.length * 0.95)],
      max: values[values.length - 1]
    };
  }
}
```

### 2. Memory Usage Optimization

**Memory Profiling:**
```typescript
const profileMemoryUsage = () => {
  const used = process.memoryUsage();
  console.log('Memory Usage:');
  for (let key in used) {
    console.log(`${key}: ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB`);
  }
};

// Monitor during execution
setInterval(profileMemoryUsage, 30000); // Every 30 seconds
```

**Message History Optimization:**
```typescript
const optimizeMessageHistory = (
  messages: Message[], 
  maxTokens: number = 4000
): Message[] => {
  // Keep system message and recent messages
  const systemMessages = messages.filter(m => m.role === 'user' && m.content.startsWith('System:'));
  const recentMessages = messages.slice(-10); // Keep last 10 messages
  
  // Estimate tokens (rough calculation)
  let totalTokens = 0;
  const optimizedMessages: Message[] = [];
  
  // Add system messages first
  for (const msg of systemMessages) {
    optimizedMessages.push(msg);
    totalTokens += Math.ceil(msg.content.length / 4);
  }
  
  // Add recent messages in reverse order
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msg = recentMessages[i];
    const msgTokens = Math.ceil(msg.content.length / 4);
    
    if (totalTokens + msgTokens <= maxTokens) {
      optimizedMessages.unshift(msg);
      totalTokens += msgTokens;
    } else {
      break;
    }
  }
  
  return optimizedMessages;
};
```

### 3. Database Performance

**Query Optimization:**
```typescript
// Add database query timing
const timedQuery = async (client: any, sql: string, params: any[]) => {
  const start = Date.now();
  try {
    const result = await client.query(sql, params);
    const duration = Date.now() - start;
    
    if (duration > 1000) {
      console.warn(`[DB] Slow query (${duration}ms):`, sql.substring(0, 100));
    }
    
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    console.error(`[DB] Query failed after ${duration}ms:`, error.message);
    throw error;
  }
};

// Connection pooling for PostgreSQL
const createOptimizedPostgresProvider = (config: PostgresConfig) => {
  const pool = new Pool({
    ...config,
    max: 20,                  // Maximum pool size
    idleTimeoutMillis: 30000, // Close idle connections after 30s
    connectionTimeoutMillis: 2000, // Timeout connection attempts after 2s
  });
  
  return createPostgresProvider(config, pool);
};
```

---

## Configuration Issues

### 1. Environment Variables

**Configuration Validation:**
```typescript
const validateEnvironment = () => {
  const required = [
    'FAF_MODEL_PROVIDER_URL',
    'FAF_MEMORY_TYPE'
  ];
  
  const optional = [
    'FAF_API_KEY',
    'FAF_DEBUG',
    'FAF_LOG_LEVEL'
  ];
  
  console.log('=== Environment Configuration ===');
  
  // Check required variables
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing);
    process.exit(1);
  }
  
  // Show configuration
  required.forEach(key => {
    console.log(`✅ ${key}: ${process.env[key]}`);
  });
  
  optional.forEach(key => {
    const value = process.env[key];
    console.log(`${value ? '✅' : '⚠️ '} ${key}: ${value || 'not set'}`);
  });
  
  console.log('================================');
};
```

### 2. Agent Configuration

**Agent Validation:**
```typescript
const validateAgent = <Ctx, Out>(agent: Agent<Ctx, Out>): string[] => {
  const errors: string[] = [];
  
  if (!agent.name || typeof agent.name !== 'string') {
    errors.push('Agent name is required and must be a string');
  }
  
  if (!agent.instructions) {
    errors.push('Agent instructions are required');
  }
  
  if (agent.tools) {
    agent.tools.forEach((tool, index) => {
      if (!tool.schema.name) {
        errors.push(`Tool at index ${index} missing name`);
      }
      
      if (!tool.schema.description) {
        errors.push(`Tool '${tool.schema.name}' missing description`);
      }
      
      if (!tool.execute) {
        errors.push(`Tool '${tool.schema.name}' missing execute function`);
      }
    });
  }
  
  if (agent.handoffs) {
    if (!Array.isArray(agent.handoffs)) {
      errors.push('Agent handoffs must be an array');
    }
  }
  
  return errors;
};

// Validate all agents
const validateAgentRegistry = (registry: Map<string, Agent<any, any>>) => {
  console.log('=== Agent Registry Validation ===');
  
  for (const [name, agent] of registry) {
    const errors = validateAgent(agent);
    
    if (errors.length === 0) {
      console.log(`✅ Agent '${name}' is valid`);
    } else {
      console.error(`❌ Agent '${name}' has errors:`);
      errors.forEach(error => console.error(`   - ${error}`));
    }
  }
  
  console.log('================================');
};
```

### 3. Model Configuration

**Model Settings Validation:**
```typescript
const validateModelConfig = (config: ModelConfig): string[] => {
  const errors: string[] = [];
  
  if (config.temperature !== undefined) {
    if (typeof config.temperature !== 'number') {
      errors.push('Temperature must be a number');
    } else if (config.temperature < 0 || config.temperature > 2) {
      errors.push('Temperature must be between 0 and 2');
    }
  }
  
  if (config.maxTokens !== undefined) {
    if (typeof config.maxTokens !== 'number') {
      errors.push('maxTokens must be a number');
    } else if (config.maxTokens <= 0) {
      errors.push('maxTokens must be positive');
    } else if (config.maxTokens > 128000) {
      errors.push('maxTokens seems unusually high (>128k)');
    }
  }
  
  return errors;
};
```

---

## Environment Setup Problems

### 1. Node.js and Dependencies

**Version Compatibility:**
```bash
# Check Node.js version
node --version  # Should be >= 18.0.0

# Check npm version
npm --version   # Should be >= 8.0.0

# Clean installation
rm -rf node_modules package-lock.json
npm install

# Check for peer dependency issues
npm ls --depth=0
```

**Common Package Issues:**
```bash
# TypeScript compilation errors
npm run build

# Missing peer dependencies
npm install @types/node typescript ts-node

# ESM/CommonJS issues
echo "{ \"type\": \"module\" }" > package.json  # For ESM
# Or remove for CommonJS
```

### 2. Docker Environment

**Docker Debugging:**
```bash
# Check Docker services
docker-compose ps
docker-compose logs faf-redis
docker-compose logs faf-postgres

# Network connectivity
docker network ls
docker exec faf-redis redis-cli ping
docker exec faf-postgres pg_isready

# Volume mounts
docker volume ls
docker exec -it faf-postgres ls -la /var/lib/postgresql/data
```

### 3. Development vs Production

**Environment-Specific Configuration:**
```typescript
const getEnvironmentConfig = (): EnvironmentConfig => {
  const env = process.env.NODE_ENV || 'development';
  
  const baseConfig = {
    host: '0.0.0.0',
    port: 3000,
    debug: false
  };
  
  switch (env) {
    case 'development':
      return {
        ...baseConfig,
        host: 'localhost',
        debug: true,
        memory: { type: 'memory' as const }
      };
      
    case 'production':
      return {
        ...baseConfig,
        debug: false,
        memory: {
          type: 'postgres' as const,
          connectionString: process.env.DATABASE_URL
        }
      };
      
    case 'test':
      return {
        ...baseConfig,
        port: 0, // Random port
        memory: { type: 'memory' as const }
      };
      
    default:
      throw new Error(`Unknown environment: ${env}`);
  }
};
```

---

## Log Analysis and Observability

### 1. Structured Logging

**Comprehensive Logging Setup:**
```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});

// Structured logging for FAF events
const logFAFEvent = (event: TraceEvent, context?: any) => {
  const logData = {
    faf_event: event.type,
    timestamp: new Date().toISOString(),
    ...event.data,
    ...context
  };
  
  switch (event.type) {
    case 'run_start':
      logger.info(logData, 'FAF run started');
      break;
    case 'run_end':
      if (event.data.outcome.status === 'error') {
        logger.error(logData, 'FAF run failed');
      } else {
        logger.info(logData, 'FAF run completed');
      }
      break;
    case 'tool_call_start':
      logger.debug(logData, 'Tool execution started');
      break;
    case 'tool_call_end':
      logger.debug(logData, 'Tool execution completed');
      break;
    default:
      logger.debug(logData, 'FAF event');
  }
};
```

### 2. Metrics Collection

**Custom Metrics:**
```typescript
class FAFMetrics {
  private counters = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  
  increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) || 0) + value);
  }
  
  recordDuration(name: string, duration: number): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, []);
    }
    this.histograms.get(name)!.push(duration);
  }
  
  getMetrics(): Record<string, any> {
    const metrics: Record<string, any> = {};
    
    // Counters
    for (const [name, value] of this.counters) {
      metrics[name] = value;
    }
    
    // Histograms with percentiles
    for (const [name, values] of this.histograms) {
      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        metrics[`${name}_count`] = values.length;
        metrics[`${name}_avg`] = values.reduce((a, b) => a + b) / values.length;
        metrics[`${name}_p50`] = sorted[Math.floor(sorted.length * 0.5)];
        metrics[`${name}_p95`] = sorted[Math.floor(sorted.length * 0.95)];
        metrics[`${name}_p99`] = sorted[Math.floor(sorted.length * 0.99)];
      }
    }
    
    return metrics;
  }
}

const metrics = new FAFMetrics();

// Use in trace collector
const metricsTraceCollector: TraceCollector = {
  collect(event: TraceEvent): void {
    metrics.increment(`faf_event_${event.type}`);
    
    if (event.type === 'run_end') {
      if (event.data.outcome.status === 'error') {
        metrics.increment('faf_runs_failed');
      } else {
        metrics.increment('faf_runs_completed');
      }
    }
  },
  
  // Implement other required methods...
};
```

### 3. Health Monitoring

**Comprehensive Health Checks:**
```typescript
const performHealthCheck = async (config: ServerConfig<Ctx>) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {} as Record<string, any>
  };
  
  // Check model provider
  try {
    await testModelProvider(config.runConfig.modelProvider);
    health.checks.model_provider = { status: 'healthy' };
  } catch (error) {
    health.checks.model_provider = { 
      status: 'unhealthy', 
      error: error.message 
    };
    health.status = 'unhealthy';
  }
  
  // Check memory provider
  if (config.defaultMemoryProvider) {
    const memoryHealth = await config.defaultMemoryProvider.healthCheck();
    health.checks.memory_provider = memoryHealth.success 
      ? { status: 'healthy', ...memoryHealth.data }
      : { status: 'unhealthy', error: memoryHealth.error };
      
    if (!memoryHealth.success) {
      health.status = 'unhealthy';
    }
  }
  
  // Check agent registry
  health.checks.agents = {
    status: 'healthy',
    count: config.agentRegistry.size,
    agents: Array.from(config.agentRegistry.keys())
  };
  
  return health;
};

// Expose health endpoint
app.get('/health/detailed', async (request, reply) => {
  const health = await performHealthCheck(config);
  const statusCode = health.status === 'healthy' ? 200 : 503;
  return reply.code(statusCode).send(health);
});
```

---

## Frequently Asked Questions (FAQ)

### Q: Why is my agent stuck in an infinite loop?

**A:** This usually happens when:
1. The agent keeps calling tools without reaching a completion condition
2. Tools return ambiguous results that trigger more tool calls
3. The `maxTurns` limit is too high

**Solutions:**
- Lower the `maxTurns` limit (default is 50)
- Add clear completion instructions to your agent
- Implement tool result validation
- Use the debugging techniques to trace the execution flow

### Q: My memory provider keeps failing. What should I check?

**A:** Common issues:
1. **Connection problems**: Verify the service is running and accessible
2. **Authentication**: Check credentials and permissions
3. **Schema issues**: Ensure database tables exist and have correct structure
4. **Resource limits**: Check memory/disk usage on the provider service

**Debug steps:**
```bash
# For Redis
redis-cli ping
redis-cli info memory

# For PostgreSQL  
pg_isready -h host -p port
psql -h host -p port -d database -c "SELECT version();"
```

### Q: Tool calls are failing with validation errors. How do I fix this?

**A:** Tool validation failures usually indicate:
1. **Schema mismatch**: Tool parameters don't match the Zod schema
2. **Model confusion**: The model doesn't understand the tool format
3. **Complex schemas**: Overly complex parameter structures

**Solutions:**
- Simplify tool schemas
- Add clear descriptions to all parameters
- Use debugging mode to see exact tool call arguments
- Test tools independently before integrating

### Q: How do I handle rate limiting from model providers?

**A:** Implement retry logic with exponential backoff:

```typescript
const rateLimitedProvider = (baseProvider: ModelProvider<Ctx>): ModelProvider<Ctx> => ({
  async getCompletion(state, agent, config) {
    const maxRetries = 3;
    
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await baseProvider.getCompletion(state, agent, config);
      } catch (error) {
        if (error.status === 429 && i < maxRetries) {
          const delay = Math.pow(2, i) * 1000; // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
  }
});
```

### Q: My server runs out of memory over time. What's causing this?

**A:** Memory leaks often come from:
1. **Conversation history accumulation**: Large message histories not being cleaned up
2. **Event listeners**: Trace collectors not being properly cleaned up
3. **Database connections**: Connection pools not being managed

**Solutions:**
- Implement conversation cleanup/compression
- Use memory monitoring tools
- Set up proper connection pooling
- Clear old traces periodically

### Q: How do I debug complex agent interactions and handoffs?

**A:** Use comprehensive tracing:

```typescript
const debugConfig: RunConfig<Ctx> = {
  ...config,
  onEvent: (event) => {
    console.log(`[TRACE] ${event.type}:`, event.data);
    
    if (event.type === 'handoff') {
      console.log(`[HANDOFF] ${event.data.from} → ${event.data.to}`);
    }
  }
};
```

### Q: What's the best way to structure error handling in production?

**A:** Use structured error handling:

```typescript
const handleFAFError = (error: FAFError): ErrorResponse => {
  const severity = FAFErrorHandler.getSeverity(error);
  const isRetryable = FAFErrorHandler.isRetryable(error);
  const message = FAFErrorHandler.format(error);
  
  // Log based on severity
  if (severity === 'critical') {
    logger.error({ error, severity }, message);
    // Alert operations team
  } else {
    logger.warn({ error, severity }, message);
  }
  
  return {
    error: error._tag,
    message,
    retryable: isRetryable,
    severity
  };
};
```

### Q: How do I optimize for high-throughput scenarios?

**A:** Several optimizations help:

1. **Connection pooling** for databases
2. **Request batching** for model calls
3. **Caching** for frequently used data
4. **Horizontal scaling** with load balancers

```typescript
// Example: Request batching
const batchedModelProvider = (baseProvider: ModelProvider<Ctx>) => {
  const queue: Array<{ resolve: Function, reject: Function, args: any }> = [];
  
  const processBatch = async () => {
    if (queue.length === 0) return;
    
    const batch = queue.splice(0, 10); // Process 10 at a time
    
    await Promise.all(batch.map(async ({ resolve, reject, args }) => {
      try {
        const result = await baseProvider.getCompletion(...args);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }));
  };
  
  setInterval(processBatch, 100); // Process every 100ms
  
  return {
    async getCompletion(...args) {
      return new Promise((resolve, reject) => {
        queue.push({ resolve, reject, args });
      });
    }
  };
};
```

### Q: How do I set up monitoring and alerting?

**A:** Implement monitoring at multiple levels:

```typescript
// Application metrics
const alertOnError = (error: FAFError) => {
  const severity = FAFErrorHandler.getSeverity(error);
  
  if (severity === 'critical') {
    // Send to alerting system (PagerDuty, Slack, etc.)
    sendAlert({
      severity: 'critical',
      message: FAFErrorHandler.format(error),
      service: 'faf-agent',
      timestamp: new Date().toISOString()
    });
  }
};

// System health monitoring
setInterval(async () => {
  const health = await performHealthCheck(config);
  
  if (health.status === 'unhealthy') {
    sendAlert({
      severity: 'warning',
      message: 'FAF system health check failed',
      details: health.checks
    });
  }
}, 60000); // Check every minute
```

---

## Conclusion

This troubleshooting guide covers the most common issues you'll encounter when working with the Functional Agent Framework. Remember to:

1. **Start with basics**: Check connections, configurations, and environment setup first
2. **Use debugging tools**: Enable comprehensive logging and tracing
3. **Monitor proactively**: Set up health checks and alerting
4. **Test incrementally**: Validate components individually before integration
5. **Keep logs structured**: Use consistent logging formats for easier analysis

For additional help:
- Check the framework's GitHub issues for known problems
- Review the example implementations for reference patterns
- Use the built-in diagnostic tools and health checks
- Enable debug mode during development

The FAF framework is designed to be observable and debuggable - use the built-in tools to understand what's happening in your system.