# Juspay Agent Framework (JAF) Examples Guide

This comprehensive guide covers the example projects in the JAF framework, demonstrating real-world usage patterns and implementation strategies for building production-ready AI agent systems.

## Table of Contents

- [Overview](#overview)
- [Server Demo: Multi-Agent HTTP Server](#server-demo-multi-agent-http-server)
- [RAG Demo: Vertex AI Integration](#rag-demo-vertex-ai-integration)
- [Common Patterns & Tutorials](#common-patterns--tutorials)
- [Integration Patterns](#integration-patterns)
- [Advanced Use Cases](#advanced-use-cases)
- [Troubleshooting](#troubleshooting)

## Overview

The JAF framework includes two comprehensive example projects that demonstrate different aspects of the framework:

1. **Server Demo** (`examples/server-demo/`) - A multi-agent HTTP server with memory persistence
2. **RAG Demo** (`examples/rag-demo/`) - Vertex AI RAG integration with streaming responses

Both examples showcase the framework's core principles:
- **Immutability**: All state is deeply readonly
- **Pure Functions**: Core logic expressed as pure, predictable functions
- **Type Safety**: Leverages TypeScript's advanced features
- **Effects at the Edge**: Side effects isolated in Provider modules
- **Composition over Configuration**: Complex behavior through simple function composition

## Server Demo: Multi-Agent HTTP Server

### Overview

The Server Demo showcases how to build a production-ready HTTP API for AI agents using JAF's `runServer` function. It demonstrates multi-agent architectures, memory persistence, and RESTful API design.

**Location**: `/Users/anurag.sharan/repos/jaf/examples/server-demo/`

### Key Features

- **Multiple Agent Types**: Three specialized agents (MathTutor, ChatBot, Assistant)
- **Memory Persistence**: Three provider options (In-Memory, Redis, PostgreSQL)
- **RESTful API**: Standard HTTP endpoints with type-safe validation
- **Tool Integration**: Calculator and greeting tools with error handling
- **Real-time Tracing**: Console-based observability
- **CORS Support**: Cross-origin requests enabled
- **Graceful Shutdown**: Proper cleanup on exit

### Architecture Deep Dive

#### Agent Definitions

```typescript
// Math-focused agent with calculator tool
const mathAgent: Agent<MyContext, string> = {
  name: 'MathTutor',
  instructions: () => 'You are a helpful math tutor with access to conversation history. Use the calculator tool to perform calculations and explain math concepts clearly.',
  tools: [calculatorTool],
};

// Social interaction agent with greeting tool
const chatAgent: Agent<MyContext, string> = {
  name: 'ChatBot',
  instructions: () => 'You are a friendly chatbot. Use the greeting tool when meeting new people, and engage in helpful conversation.',
  tools: [greetingTool],
};

// Multi-purpose agent with both tools
const assistantAgent: Agent<MyContext, string> = {
  name: 'Assistant',
  instructions: () => 'You are a general-purpose assistant with access to conversation history. You can help with math calculations and provide greetings.',
  tools: [calculatorTool, greetingTool],
};
```

#### Tool Implementation with Error Handling

The server demo showcases advanced tool implementation with the JAF error handling system:

```typescript
const calculatorTool: Tool<{ expression: string }, MyContext> = {
  schema: {
    name: "calculate",
    description: "Perform mathematical calculations",
    parameters: z.object({
      expression: z.string().describe("Math expression to evaluate (e.g., '2 + 2', '10 * 5')")
    }),
  },
  execute: withErrorHandling('calculate', async (args, context) => {
    // Input sanitization
    const sanitized = args.expression.replace(/[^0-9+\-*/().\s]/g, '');
    if (sanitized !== args.expression) {
      return ToolResponse.validationError(
        "Invalid characters in expression. Only numbers, +, -, *, /, (, ), and spaces are allowed.",
        { 
          originalExpression: args.expression,
          sanitizedExpression: sanitized,
          invalidCharacters: args.expression.replace(/[0-9+\-*/().\s]/g, '')
        }
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
        { 
          expression: args.expression,
          evalError: evalError instanceof Error ? evalError.message : evalError
        }
      );
    }
  }),
};
```

#### Memory Provider Configuration

The server supports three memory providers, configured via environment variables:

```typescript
// Environment-based memory provider setup
const memoryType = process.env.JAF_MEMORY_TYPE || 'memory';
const memoryProvider = await createMemoryProviderFromEnv(externalClients);

// Memory configuration in runServer
const server = await runServer(
  [mathAgent, chatAgent, assistantAgent],
  {
    modelProvider,
    maxTurns: 5,
    onEvent: traceCollector.collect.bind(traceCollector),
    memory: {
      provider: memoryProvider,
      autoStore: true, // Automatically store conversation history
      maxMessages: 100 // Keep last 100 messages per conversation
    }
  },
  {
    port: parseInt(process.env.PORT || '3000'),
    defaultMemoryProvider: memoryProvider
  }
);
```

### API Endpoints

The server provides comprehensive RESTful endpoints:

| Endpoint | Method | Description | Use Case |
|----------|--------|-------------|----------|
| `/health` | GET | Health check | Monitoring, load balancer checks |
| `/agents` | GET | List available agents | Discovery, frontend integration |
| `/chat` | POST | General chat endpoint | Agent-agnostic conversations |
| `/agents/{name}/chat` | POST | Agent-specific endpoint | Direct agent communication |
| `/memory/health` | GET | Memory provider health | Memory system monitoring |
| `/conversations/:id` | GET | Get conversation by ID | Conversation retrieval |
| `/conversations/:id` | DELETE | Delete conversation | Conversation cleanup |

### Setup and Configuration

#### Environment Variables

```bash
# Core LiteLLM configuration
LITELLM_URL=http://localhost:4000
LITELLM_API_KEY=sk-your-api-key
LITELLM_MODEL=gpt-3.5-turbo

# Server configuration
PORT=3000

# Memory provider selection
JAF_MEMORY_TYPE=memory  # or 'redis' or 'postgres'

# Redis configuration (if using Redis)
JAF_REDIS_HOST=localhost
JAF_REDIS_PORT=6379
JAF_REDIS_PASSWORD=your-password
JAF_REDIS_DB=0

# PostgreSQL configuration (if using PostgreSQL)
JAF_POSTGRES_HOST=localhost
JAF_POSTGRES_PORT=5432
JAF_POSTGRES_DB=jaf_memory
JAF_POSTGRES_USER=postgres
JAF_POSTGRES_PASSWORD=your-password
```

#### Running the Server

```bash
cd examples/server-demo
npm install
npm run dev
```

### Usage Examples

#### Basic Chat Request

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is 15 * 7?"}],
    "agentName": "MathTutor",
    "context": {"userId": "demo", "permissions": ["user"]}
  }'
```

#### Conversation with Memory Persistence

```bash
# Start conversation
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is 15 * 7?"}],
    "conversationId": "my-conversation-1",
    "agentName": "MathTutor",
    "context": {"userId": "demo", "permissions": ["user"]}
  }'

# Continue conversation (references previous calculation)
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What was my previous calculation?"}],
    "conversationId": "my-conversation-1",
    "agentName": "MathTutor",
    "context": {"userId": "demo", "permissions": ["user"]}
  }'
```

### Response Format

All endpoints return structured JSON responses:

```typescript
{
  "success": boolean,
  "data": {
    "runId": string,
    "traceId": string,
    "conversationId": string,
    "messages": Array<{role: string, content: string}>,
    "outcome": {
      "status": "completed" | "error" | "max_turns",
      "output": string
    },
    "turnCount": number,
    "executionTimeMs": number
  },
  "error": string?
}
```

### Memory Provider Comparison

| Provider | Best For | Persistence | Setup Complexity | Scalability |
|----------|----------|-------------|------------------|-------------|
| **In-Memory** | Development, testing | None (lost on restart) | None | Single instance |
| **Redis** | Production, caching | Persistent | Moderate | High |
| **PostgreSQL** | Production, complex queries | Full persistence | High | Very High |

## RAG Demo: Vertex AI Integration

### Overview

The RAG Demo demonstrates real-world integration with Google's Vertex AI RAG (Retrieval Augmented Generation) system. It showcases streaming responses, source attribution, and performance metrics.

**Location**: `/Users/anurag.sharan/repos/jaf/examples/rag-demo/`

### Key Features

- **Real Vertex AI Integration**: Uses Google's @google/genai SDK
- **Streaming Responses**: Real-time streaming from Vertex AI
- **Source Attribution**: Automatic grounding and citation
- **Performance Metrics**: Detailed timing and performance tracking
- **Permission Control**: Role-based access to RAG functionality
- **Error Handling**: Comprehensive error management
- **Memory Integration**: Conversation persistence with JAF memory providers

### Architecture Deep Dive

#### RAG Tool Implementation

The RAG tool showcases advanced integration with external services:

```typescript
export const vertexAIRAGTool: Tool<any, RAGContext> = {
  schema: {
    name: "vertex_ai_rag_query",
    description: "Query the Vertex AI RAG system to get information from the knowledge base",
    parameters: z.object({
      query: z.string().describe("The question to ask the RAG system"),
      similarity_top_k: z.number().describe("Number of similar documents to retrieve").default(20)
    }),
  },
  execute: async (args, context) => {
    // Permission validation
    if (!context.permissions.includes('rag_access')) {
      return JSON.stringify({
        error: "permission_denied",
        message: "RAG access requires 'rag_access' permission",
        query: args.query
      });
    }
    
    const result = await vertexAIRAG(args.query, args.similarity_top_k);
    
    // Structured response with metrics
    return `
**RAG Query Results**

**Query:** ${result.query}
**Model:** ${result.model}

**Response:**
${result.response}

**Sources:**
${result.sources.map((source, index) => `${index + 1}. ${source}`).join('\n')}

**Performance Metrics:**
- Total execution time: ${result.metrics?.total_execution_time.toFixed(3)}s
- Time to first chunk: ${result.metrics?.time_to_first_chunk?.toFixed(3)}s
- Chunks received: ${result.metrics?.chunk_count}
- Response length: ${result.metrics?.response_length} characters
- Average chars/second: ${result.metrics?.avg_chars_per_second.toFixed(1)}
    `.trim();
  }
};
```

#### Vertex AI RAG Implementation

The core RAG function demonstrates proper SDK usage:

```typescript
async function vertexAIRAG(query: string, similarity_top_k: number): Promise<RAGResponse> {
  const total_start_time = Date.now();
  
  // Initialize Google Generative AI client for Vertex AI
  const project = process.env.GOOGLE_CLOUD_PROJECT || "genius-dev-393512";
  const location = process.env.GOOGLE_CLOUD_LOCATION || "global";
  
  const client = new GoogleGenAI({
    vertexai: true,
    project,
    location
  });
  
  const model = process.env.RAG_MODEL || "gemini-2.0-flash-exp";
  
  // RAG request configuration
  const request = {
    model,
    contents: [
      {
        role: "user" as const,
        parts: [{ text: query }]
      }
    ],
    tools: [
      {
        retrieval: {
          vertexRagStore: {
            ragResources: [
              {
                ragCorpus: process.env.RAG_CORPUS_ID || "projects/genius-dev-393512/locations/us-central1/ragCorpora/2305843009213693952"
              }
            ],
            similarityTopK: similarity_top_k
          }
        }
      }
    ]
  };
  
  // Execute RAG query with performance tracking
  const result = await client.models.generateContent(request);
  
  // Extract grounding metadata for source attribution
  const source_urls: string[] = [];
  if (result.candidates?.[0]?.groundingMetadata?.groundingChunks) {
    for (const chunk of result.candidates[0].groundingMetadata.groundingChunks) {
      if (chunk.retrievedContext?.uri && !source_urls.includes(chunk.retrievedContext.uri)) {
        source_urls.push(chunk.retrievedContext.uri);
      }
    }
  }
  
  return {
    response: extractResponseText(result),
    query,
    model,
    sources: source_urls,
    metrics: calculateMetrics(total_start_time, result)
  };
}
```

#### RAG Agent Configuration

The RAG agent is specifically tuned for knowledge retrieval tasks:

```typescript
export const ragAgent: Agent<RAGContext, string> = {
  name: 'RAGAgent',
  instructions: (state) => `You are a helpful AI assistant powered by Vertex AI RAG.

You have access to a comprehensive knowledge base through the RAG system. When users ask questions, you should:

1. Use the vertex_ai_rag_query tool to search the knowledge base
2. Provide comprehensive answers based on the retrieved information
3. Always cite your sources when providing information
4. If the knowledge base doesn't contain relevant information, clearly state that

Current user: ${state.context.userId}
User permissions: ${state.context.permissions.join(', ')}`,
  
  tools: [vertexAIRAGTool],
  
  modelConfig: {
    temperature: parseFloat(process.env.RAG_TEMPERATURE || '0.1'), // Lower temperature for factual responses
    maxTokens: parseInt(process.env.RAG_MAX_TOKENS || '2000')
  }
};
```

### Setup and Configuration

#### Prerequisites

1. **Google Cloud Project**: Active GCP project with Vertex AI enabled
2. **Authentication**: Properly configured `gcloud` authentication
3. **RAG Corpus**: Existing Vertex AI RAG corpus with indexed documents
4. **LiteLLM Proxy**: Running LiteLLM instance for model access

#### Environment Configuration

```bash
# Google Cloud configuration
GOOGLE_CLOUD_PROJECT=your-project-id

# LiteLLM configuration  
LITELLM_URL=http://localhost:4000
LITELLM_API_KEY=sk-your-api-key
LITELLM_MODEL=gemini-2.5-flash-lite

# RAG-specific configuration
RAG_CORPUS_ID=projects/your-project/locations/us-central1/ragCorpora/your-corpus-id
RAG_MODEL=gemini-2.0-flash-exp
RAG_TEMPERATURE=0.1
RAG_MAX_TOKENS=2000
RAG_SIMILARITY_TOP_K=20
RAG_MAX_TURNS=5
```

#### Authentication Setup

```bash
# Authenticate with Google Cloud with required scopes
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/generative-language.retriever

# Set your project
export GOOGLE_CLOUD_PROJECT="your-project-id"
```

#### Running the Demo

```bash
cd examples/rag-demo
npm install
cp .env.example .env
# Edit .env with your configuration
npm run dev
```

### Demo Queries

The demo runs predefined queries to showcase RAG capabilities:

```typescript
const demoQueries = [
  "What is return URL?",
  "How do I integrate hypercheckout on android? Remember what we discussed earlier."
];
```

These queries demonstrate:
- **Knowledge retrieval** from the RAG corpus
- **Conversation memory** with context from previous queries
- **Source attribution** with automatic grounding
- **Performance metrics** tracking

### Performance Metrics

The RAG demo tracks comprehensive performance metrics:

```typescript
interface RAGMetrics {
  client_init_time: number;           // Time to initialize the client
  time_to_first_chunk: number | null; // Latency to first response chunk
  total_generation_time: number;      // Total generation time
  total_execution_time: number;       // End-to-end execution time
  chunk_count: number;                // Number of response chunks
  response_length: number;            // Character count of response
  avg_chunks_per_second: number;      // Throughput metric
  avg_chars_per_second: number;       // Character throughput
}
```

### Sample Output

```
🔍 JAF Vertex AI RAG Demo
========================

📋 Demo Query 1: "What is return URL?"
==================================================

[RAG] Initializing Vertex AI client...
[RAG] Client initialized in 0.123s
[RAG] Querying RAG corpus with query: "What is return URL?"
[RAG] Retrieving top 20 similar documents
[RAG] Query completed in 2.456s, 15 chunks, 1247 chars

✅ RAG Query Completed Successfully!

📝 Response:
**RAG Query Results**

**Query:** What is return URL?
**Model:** gemini-2.0-flash-exp

**Response:**
A return URL is a web address where users are redirected after completing an action, such as payment processing or authentication. In the context of payment systems, the return URL is where customers are sent back to your application after completing their transaction on the payment provider's platform.

**Sources:**
1. https://docs.example.com/payment-integration
2. https://wiki.example.com/return-urls
3. https://api-docs.example.com/webhooks

**Performance Metrics:**
- Total execution time: 2.456s
- Time to first chunk: 0.234s
- Chunks received: 15
- Response length: 1247 characters
- Average chars/second: 507.3
```

## Common Patterns & Tutorials

### Pattern 1: Creating Custom Tools

#### Basic Tool Structure

```typescript
import { z } from 'zod';
import { Tool, ToolResponse, ToolErrorCodes, withErrorHandling } from 'functional-agent-framework';

const myTool: Tool<{ input: string }, MyContext> = {
  schema: {
    name: "my_tool",
    description: "Description of what this tool does",
    parameters: z.object({
      input: z.string().describe("Input parameter description")
    }),
  },
  execute: withErrorHandling('my_tool', async (args, context) => {
    // Input validation
    if (!args.input || args.input.trim().length === 0) {
      return ToolResponse.validationError("Input cannot be empty", { providedInput: args.input });
    }
    
    try {
      // Tool logic here
      const result = processInput(args.input);
      
      return ToolResponse.success(`Processed: ${result}`, {
        originalInput: args.input,
        processedResult: result,
        processingType: 'standard'
      });
    } catch (error) {
      return ToolResponse.error(
        ToolErrorCodes.EXECUTION_FAILED,
        `Processing failed: ${error.message}`,
        { input: args.input, errorDetails: error }
      );
    }
  }),
};
```

#### Tool with Validation Policies

```typescript
import { withValidation, createPathValidator, composeValidations } from 'functional-agent-framework';

// Create validators
const pathValidator = createPathValidator(['/safe', '/public']);
const permissionValidator = (args: any, ctx: MyContext) => {
  if (!ctx.permissions.includes('tool_access')) {
    return { isValid: false, errorMessage: 'Insufficient permissions' };
  }
  return { isValid: true };
};

// Compose validators
const combinedValidator = composeValidations(pathValidator, permissionValidator);

// Apply to tool
const secureFileTool = withValidation(baseFileTool, combinedValidator);
```

### Pattern 2: Multi-Agent Workflows

#### Agent Handoff Implementation

```typescript
import { handoffTool, Agent } from 'functional-agent-framework';

const triageAgent: Agent<Context, { agentName: string }> = {
  name: 'TriageAgent',
  instructions: () => 'Route requests to specialized agents based on user needs',
  tools: [handoffTool],
  handoffs: ['MathTutor', 'FileManager', 'RAGAgent'], // Allowed handoff targets
  outputCodec: z.object({
    agentName: z.enum(['MathTutor', 'FileManager', 'RAGAgent'])
  }),
};
```

#### Workflow Orchestration

```typescript
const workflowConfig: RunConfig<MyContext> = {
  agentRegistry: new Map([
    ['TriageAgent', triageAgent],
    ['MathTutor', mathAgent],
    ['FileManager', fileAgent],
    ['RAGAgent', ragAgent]
  ]),
  modelProvider,
  maxTurns: 10,
  onEvent: (event) => {
    if (event.type === 'handoff') {
      console.log(`🔄 Handoff: ${event.data.from} → ${event.data.to}`);
    }
  }
};
```

### Pattern 3: Memory and Persistence

#### Custom Memory Provider

```typescript
import { MemoryProvider, ConversationMemory, Result } from 'functional-agent-framework';

class CustomMemoryProvider implements MemoryProvider {
  async storeMessages(
    conversationId: string,
    messages: readonly Message[],
    metadata?: any
  ): Promise<Result<void>> {
    try {
      // Custom storage logic
      await this.storage.store(conversationId, messages, metadata);
      return { success: true, data: undefined };
    } catch (error) {
      return { 
        success: false, 
        error: createMemoryStorageError('store', 'custom', error) 
      };
    }
  }

  async getConversation(conversationId: string): Promise<Result<ConversationMemory | null>> {
    try {
      const conversation = await this.storage.get(conversationId);
      return { success: true, data: conversation };
    } catch (error) {
      return { 
        success: false, 
        error: createMemoryNotFoundError(conversationId, 'custom') 
      };
    }
  }

  // Implement other required methods...
}
```

#### Memory Configuration Patterns

```typescript
// In-memory for development
const devMemoryConfig = {
  provider: await createInMemoryProvider(),
  autoStore: true,
  maxMessages: 50
};

// Redis for production
const prodMemoryConfig = {
  provider: await createRedisProvider({
    url: process.env.REDIS_URL,
    keyPrefix: 'myapp:conversations:',
    ttl: 86400 // 24 hours
  }),
  autoStore: true,
  maxMessages: 500,
  compressionThreshold: 100
};
```

### Pattern 4: Error Handling and Observability

#### Custom Trace Collector

```typescript
import { TraceEvent, ConsoleTraceCollector } from 'functional-agent-framework';

class CustomTraceCollector {
  constructor(private logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info') {}

  collect(event: TraceEvent) {
    switch (event.type) {
      case 'run_start':
        console.log(`🚀 [${event.data.runId}] Starting conversation`);
        break;
      
      case 'llm_call_start':
        console.log(`🤖 [${event.data.agentName}] Calling ${event.data.model}`);
        break;
      
      case 'tool_call_start':
        console.log(`🔧 [${event.data.toolName}] Executing with args:`, event.data.args);
        break;
      
      case 'tool_call_end':
        const status = event.data.status || 'completed';
        console.log(`✅ [${event.data.toolName}] ${status}`);
        break;
      
      case 'handoff':
        console.log(`🔄 Handoff: ${event.data.from} → ${event.data.to}`);
        break;
      
      case 'run_end':
        const outcome = event.data.outcome;
        if (outcome.status === 'completed') {
          console.log(`🎉 Conversation completed`);
        } else {
          console.error(`❌ Conversation failed:`, outcome.error);
        }
        break;
    }
  }
}
```

#### Error Handling Strategies

```typescript
import { JAFErrorHandler, RunResult } from 'functional-agent-framework';

async function handleRunResult<T>(result: RunResult<T>): Promise<T> {
  if (result.outcome.status === 'completed') {
    return result.outcome.output;
  }

  const error = result.outcome.error;
  const formattedError = JAFErrorHandler.format(error);
  const isRetryable = JAFErrorHandler.isRetryable(error);
  const severity = JAFErrorHandler.getSeverity(error);
  
  console.error(`[${severity}] ${formattedError} (retryable: ${isRetryable})`);
  
  // Custom error handling based on error type
  switch (error._tag) {
    case 'MaxTurnsExceeded':
      throw new Error(`Conversation exceeded ${error.turns} turns`);
    
    case 'ToolCallError':
      if (isRetryable) {
        console.log(`Retrying tool call: ${error.tool}`);
        // Implement retry logic
      }
      throw new Error(`Tool ${error.tool} failed: ${error.detail}`);
    
    case 'AgentNotFound':
      throw new Error(`Agent ${error.agentName} not found`);
    
    default:
      throw new Error(`Unexpected error: ${formattedError}`);
  }
}
```

### Pattern 5: Guardrails and Security

#### Content Filtering

```typescript
import { Guardrail, createContentFilter, createRateLimiter } from 'functional-agent-framework';

const contentFilter: Guardrail<string> = createContentFilter({
  blockedWords: ['spam', 'abuse'],
  maxLength: 1000,
  allowEmptyInput: false
});

const rateLimiter: Guardrail<string> = createRateLimiter(
  10,      // 10 requests
  60000,   // per 60 seconds
  (input) => 'global' // rate limit key
);

const config: RunConfig<MyContext> = {
  // ... other config
  initialInputGuardrails: [contentFilter, rateLimiter],
  finalOutputGuardrails: [contentFilter],
};
```

#### Custom Guardrails

```typescript
const customGuardrail: Guardrail<string> = async (input: string) => {
  // Check for sensitive information
  const sensitivePatterns = [
    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/, // Credit card
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  ];
  
  for (const pattern of sensitivePatterns) {
    if (pattern.test(input)) {
      return {
        isValid: false,
        errorMessage: 'Input contains sensitive information'
      };
    }
  }
  
  return { isValid: true };
};
```

## Integration Patterns

### MCP (Model Context Protocol) Integration

#### Setting Up MCP Tools

```typescript
import { makeMCPClient, mcpToolToJAFTool } from 'functional-agent-framework';

// Connect to MCP server
const mcpClient = await makeMCPClient('python', ['-m', 'mcp_server']);

// Get available tools
const mcpTools = await mcpClient.listTools();

// Convert to JAF tools with validation
const jafTools = mcpTools.map(tool => 
  mcpToolToJAFTool(mcpClient, tool, myValidationPolicy)
);

// Use in agent
const mcpAgent: Agent<MyContext, string> = {
  name: 'MCPAgent',
  instructions: () => 'You have access to external tools via MCP',
  tools: jafTools,
};
```

#### MCP Tool Validation

```typescript
const mcpValidationPolicy = (args: any, context: MyContext) => {
  // Check permissions for MCP tool access
  if (!context.permissions.includes('mcp_access')) {
    return {
      isValid: false,
      errorMessage: 'MCP access requires special permissions'
    };
  }
  
  // Validate specific tool arguments
  if (args.command && args.command.includes('rm')) {
    return {
      isValid: false,
      errorMessage: 'Destructive commands not allowed'
    };
  }
  
  return { isValid: true };
};
```

### External API Integration

#### HTTP Client Tool

```typescript
const httpClientTool: Tool<{ url: string; method: string; body?: any }, MyContext> = {
  schema: {
    name: "http_request",
    description: "Make HTTP requests to external APIs",
    parameters: z.object({
      url: z.string().url(),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
      body: z.any().optional()
    }),
  },
  execute: withErrorHandling('http_request', async (args, context) => {
    // Validate URL against allowlist
    const allowedDomains = ['api.example.com', 'service.mycompany.com'];
    const urlObj = new URL(args.url);
    
    if (!allowedDomains.includes(urlObj.hostname)) {
      return ToolResponse.validationError(
        `Domain ${urlObj.hostname} not in allowlist`,
        { requestedDomain: urlObj.hostname, allowedDomains }
      );
    }
    
    try {
      const response = await fetch(args.url, {
        method: args.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${context.apiToken}` // from context
        },
        body: args.body ? JSON.stringify(args.body) : undefined
      });
      
      const result = await response.json();
      
      return ToolResponse.success(`HTTP ${args.method} completed`, {
        status: response.status,
        url: args.url,
        response: result
      });
    } catch (error) {
      return ToolResponse.error(
        ToolErrorCodes.NETWORK_ERROR,
        `HTTP request failed: ${error.message}`,
        { url: args.url, method: args.method }
      );
    }
  }),
};
```

### Database Integration

#### Database Tool Pattern

```typescript
const databaseTool: Tool<{ query: string; params?: any[] }, MyContext> = {
  schema: {
    name: "database_query",
    description: "Execute safe database queries",
    parameters: z.object({
      query: z.string(),
      params: z.array(z.any()).optional()
    }),
  },
  execute: withErrorHandling('database_query', async (args, context) => {
    // Validate query safety
    const prohibitedKeywords = ['DROP', 'DELETE', 'UPDATE', 'INSERT'];
    const upperQuery = args.query.toUpperCase();
    
    for (const keyword of prohibitedKeywords) {
      if (upperQuery.includes(keyword)) {
        return ToolResponse.validationError(
          `Query contains prohibited keyword: ${keyword}`,
          { query: args.query, prohibitedKeyword: keyword }
        );
      }
    }
    
    try {
      const result = await this.db.query(args.query, args.params);
      
      return ToolResponse.success(`Query executed successfully`, {
        rowCount: result.rows.length,
        columns: result.fields?.map(f => f.name) || [],
        data: result.rows
      });
    } catch (error) {
      return ToolResponse.error(
        ToolErrorCodes.DATABASE_ERROR,
        `Database query failed: ${error.message}`,
        { query: args.query, params: args.params }
      );
    }
  }),
};
```

## Advanced Use Cases

### Use Case 1: Multi-Modal Agent System

#### File Processing Agent

```typescript
const fileProcessingAgent: Agent<FileContext, ProcessingResult> = {
  name: 'FileProcessor',
  instructions: (state) => `Process files based on type and user requirements.
    
Available operations:
- Image processing (resize, format conversion)
- Document analysis (PDF, Word, Excel)
- Data transformation (CSV, JSON)
- Archive extraction (ZIP, TAR)`,
  
  tools: [
    imageProcessingTool,
    documentAnalysisTool,
    dataTransformationTool,
    archiveExtractionTool
  ],
  
  outputCodec: z.object({
    processedFiles: z.array(z.object({
      originalPath: z.string(),
      processedPath: z.string(),
      operation: z.string(),
      metadata: z.any()
    }))
  })
};
```

#### Image Processing Tool

```typescript
const imageProcessingTool: Tool<ImageProcessingArgs, FileContext> = {
  schema: {
    name: "process_image",
    description: "Process images with various operations",
    parameters: z.object({
      imagePath: z.string(),
      operation: z.enum(['resize', 'convert', 'enhance', 'compress']),
      parameters: z.object({
        width: z.number().optional(),
        height: z.number().optional(),
        format: z.enum(['jpg', 'png', 'webp']).optional(),
        quality: z.number().min(1).max(100).optional()
      })
    })
  },
  execute: withErrorHandling('process_image', async (args, context) => {
    // Validate file access
    if (!context.permissions.includes('file_access')) {
      return ToolResponse.permissionError('File access required');
    }
    
    // Validate file exists and is an image
    const fileInfo = await validateImageFile(args.imagePath);
    if (!fileInfo.isValid) {
      return ToolResponse.validationError(fileInfo.error);
    }
    
    try {
      const result = await processImage(args);
      
      return ToolResponse.success('Image processed successfully', {
        originalPath: args.imagePath,
        processedPath: result.outputPath,
        operation: args.operation,
        originalSize: fileInfo.size,
        newSize: result.size,
        processingTime: result.processingTime
      });
    } catch (error) {
      return ToolResponse.error(
        ToolErrorCodes.PROCESSING_FAILED,
        `Image processing failed: ${error.message}`,
        { imagePath: args.imagePath, operation: args.operation }
      );
    }
  })
};
```

### Use Case 2: Real-time Streaming Responses

#### Streaming Chat Implementation

```typescript
import { EventSource } from 'eventsource';

const streamingChatTool: Tool<StreamingArgs, StreamingContext> = {
  schema: {
    name: "streaming_chat",
    description: "Initiate streaming conversation",
    parameters: z.object({
      message: z.string(),
      sessionId: z.string()
    })
  },
  execute: async (args, context) => {
    const streamId = generateStreamId();
    
    // Start streaming in background
    startStreamingResponse(streamId, args.message, context);
    
    return ToolResponse.success('Streaming started', {
      streamId,
      streamUrl: `/stream/${streamId}`,
      message: 'Connect to stream URL for real-time responses'
    });
  }
};

async function startStreamingResponse(streamId: string, message: string, context: StreamingContext) {
  const stream = createResponseStream(streamId);
  
  try {
    stream.write({ type: 'start', data: { streamId } });
    
    // Simulate streaming LLM response
    const response = await streamLLMResponse(message);
    
    for await (const chunk of response) {
      stream.write({ type: 'chunk', data: { content: chunk } });
      await delay(50); // Simulate realistic streaming delay
    }
    
    stream.write({ type: 'end', data: { completed: true } });
  } catch (error) {
    stream.write({ type: 'error', data: { error: error.message } });
  } finally {
    stream.close();
  }
}
```

### Use Case 3: Workflow Automation

#### Workflow Orchestration Agent

```typescript
const workflowAgent: Agent<WorkflowContext, WorkflowResult> = {
  name: 'WorkflowOrchestrator',
  instructions: (state) => `Orchestrate complex workflows by coordinating multiple agents and tools.

Available workflow patterns:
- Sequential processing (step-by-step execution)
- Parallel processing (concurrent execution)
- Conditional branching (if-then-else logic)
- Loop processing (iterative operations)
- Error recovery (retry and fallback strategies)`,
  
  tools: [
    sequentialProcessorTool,
    parallelProcessorTool,
    conditionalBranchTool,
    loopProcessorTool,
    errorRecoveryTool
  ],
  
  outputCodec: z.object({
    workflowId: z.string(),
    status: z.enum(['completed', 'failed', 'partial']),
    steps: z.array(z.object({
      stepId: z.string(),
      status: z.enum(['completed', 'failed', 'skipped']),
      output: z.any(),
      executionTime: z.number()
    })),
    totalExecutionTime: z.number(),
    errorCount: z.number()
  })
};
```

#### Sequential Workflow Tool

```typescript
const sequentialProcessorTool: Tool<SequentialWorkflowArgs, WorkflowContext> = {
  schema: {
    name: "execute_sequential_workflow",
    description: "Execute a sequence of steps in order",
    parameters: z.object({
      workflowId: z.string(),
      steps: z.array(z.object({
        stepId: z.string(),
        agentName: z.string(),
        input: z.any(),
        retryCount: z.number().default(3),
        timeout: z.number().default(30000)
      }))
    })
  },
  execute: withErrorHandling('execute_sequential_workflow', async (args, context) => {
    const results: WorkflowStepResult[] = [];
    const startTime = Date.now();
    
    for (const step of args.steps) {
      const stepStartTime = Date.now();
      
      try {
        const stepResult = await executeWorkflowStep(step, context);
        
        results.push({
          stepId: step.stepId,
          status: 'completed',
          output: stepResult,
          executionTime: Date.now() - stepStartTime
        });
        
        // Pass output to next step as context
        context.previousStepOutput = stepResult;
        
      } catch (error) {
        results.push({
          stepId: step.stepId,
          status: 'failed',
          output: error.message,
          executionTime: Date.now() - stepStartTime
        });
        
        // Decide whether to continue or abort workflow
        if (step.critical) {
          break; // Abort workflow on critical step failure
        }
      }
    }
    
    const totalExecutionTime = Date.now() - startTime;
    const errorCount = results.filter(r => r.status === 'failed').length;
    const overallStatus = errorCount === 0 ? 'completed' : 
                         errorCount < results.length ? 'partial' : 'failed';
    
    return ToolResponse.success('Sequential workflow completed', {
      workflowId: args.workflowId,
      status: overallStatus,
      steps: results,
      totalExecutionTime,
      errorCount
    });
  })
};
```

## Troubleshooting

### Common Issues and Solutions

#### 1. LiteLLM Connection Issues

**Problem**: `Connection refused` or `401 Authentication Error`

**Solutions**:
```bash
# Check if LiteLLM proxy is running
curl http://localhost:4000/health

# Verify API key format (must start with 'sk-')
echo $LITELLM_API_KEY | grep -E '^sk-'

# Check available models
curl http://localhost:4000/v1/models

# Restart LiteLLM with correct configuration
litellm --model gpt-3.5-turbo --port 4000
```

#### 2. Memory Provider Issues

**Problem**: `Memory provider connection failed`

**Redis Solutions**:
```bash
# Check Redis connection
redis-cli ping

# Check Redis logs
redis-cli monitor

# Restart Redis
brew services restart redis  # macOS
sudo systemctl restart redis # Linux
```

**PostgreSQL Solutions**:
```bash
# Check PostgreSQL connection
psql -h localhost -U postgres -d jaf_memory -c "SELECT 1;"

# Create database if missing
createdb jaf_memory

# Check PostgreSQL logs
tail -f /usr/local/var/log/postgresql.log  # macOS
journalctl -u postgresql -f               # Linux
```

#### 3. RAG Demo Issues

**Problem**: `Google Cloud authentication not found`

**Solutions**:
```bash
# Check current authentication
gcloud auth list

# Re-authenticate with correct scopes
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform

# Verify project access
gcloud projects describe $GOOGLE_CLOUD_PROJECT

# Check Vertex AI API enablement
gcloud services list --enabled | grep aiplatform
```

**Problem**: `RAG corpus not found`

**Solutions**:
```bash
# List available RAG corpora
gcloud ai indexes list --region=us-central1

# Verify corpus ID format
echo $RAG_CORPUS_ID | grep -E '^projects/.*/locations/.*/ragCorpora/.*$'

# Check corpus permissions
gcloud projects get-iam-policy $GOOGLE_CLOUD_PROJECT
```

#### 4. Agent Tool Execution Issues

**Problem**: Tool validation failures

**Debug Steps**:
```typescript
// Enable debug logging for tools
const debugTool = {
  ...originalTool,
  execute: async (args, context) => {
    console.log('Tool input:', { args, context });
    
    try {
      const result = await originalTool.execute(args, context);
      console.log('Tool output:', result);
      return result;
    } catch (error) {
      console.error('Tool error:', error);
      throw error;
    }
  }
};
```

#### 5. Server Demo Port Issues

**Problem**: `Port already in use`

**Solutions**:
```bash
# Find process using port
lsof -i :3000

# Kill process if needed
kill -9 <PID>

# Use different port
PORT=3001 npm run dev

# Check available ports
netstat -tulpn | grep LISTEN
```

#### 6. Type Safety Issues

**Problem**: TypeScript compilation errors

**Solutions**:
```bash
# Check TypeScript version compatibility
npm list typescript

# Update dependencies
npm update

# Clear build cache
rm -rf dist/ node_modules/.cache/

# Rebuild
npm run build
```

### Performance Optimization

#### 1. Memory Usage Optimization

```typescript
// Configure memory limits
const memoryConfig = {
  provider: memoryProvider,
  autoStore: true,
  maxMessages: 100,        // Limit message history
  compressionThreshold: 50 // Compress older messages
};

// Implement message compression
const compressMessages = (messages: Message[]): Message[] => {
  if (messages.length <= 50) return messages;
  
  // Keep first 10 and last 40 messages, compress middle
  const start = messages.slice(0, 10);
  const end = messages.slice(-40);
  const middle = [{
    role: 'assistant' as const,
    content: `[Compressed ${messages.length - 50} messages]`
  }];
  
  return [...start, ...middle, ...end];
};
```

#### 2. Response Time Optimization

```typescript
// Configure reasonable timeouts
const optimizedConfig = {
  maxTurns: 5,              // Limit conversation length
  modelOverride: 'gpt-3.5-turbo-16k', // Use faster model
  timeout: 30000,           // 30 second timeout
  
  // Parallel tool execution where possible
  parallelToolExecution: true,
  
  // Cache model responses
  responseCache: {
    enabled: true,
    ttl: 300000, // 5 minutes
    maxSize: 1000
  }
};
```

#### 3. Error Recovery Strategies

```typescript
// Implement exponential backoff for retries
const retryWithBackoff = async (
  operation: () => Promise<any>,
  maxRetries: number = 3,
  baseDelay: number = 1000
) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`Retry attempt ${attempt} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};
```

### Debugging Techniques

#### 1. Enable Comprehensive Tracing

```typescript
import { DetailedTraceCollector } from './custom-trace-collector';

const detailedTracer = new DetailedTraceCollector({
  logLevel: 'debug',
  includeArgs: true,
  includeResults: true,
  includeTimings: true,
  outputFile: './debug-trace.log'
});

const config = {
  // ... other config
  onEvent: detailedTracer.collect.bind(detailedTracer)
};
```

#### 2. Tool-Level Debugging

```typescript
const createDebuggingWrapper = <A, Ctx>(tool: Tool<A, Ctx>) => ({
  ...tool,
  execute: async (args: A, context: Ctx) => {
    const startTime = Date.now();
    console.log(`🔧 [${tool.schema.name}] Starting with:`, {
      args: JSON.stringify(args, null, 2),
      context: {
        userId: context.userId,
        permissions: context.permissions
      }
    });
    
    try {
      const result = await tool.execute(args, context);
      const duration = Date.now() - startTime;
      
      console.log(`✅ [${tool.schema.name}] Completed in ${duration}ms`);
      console.log(`📤 [${tool.schema.name}] Result:`, result);
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error(`❌ [${tool.schema.name}] Failed after ${duration}ms:`, error);
      throw error;
    }
  }
});
```

#### 3. Memory Debugging

```typescript
// Monitor memory provider health
setInterval(async () => {
  const healthResult = await memoryProvider.healthCheck();
  
  if (!healthResult.success) {
    console.error('Memory provider unhealthy:', healthResult.error);
  } else {
    console.log('Memory provider status:', healthResult.data);
  }
}, 30000); // Check every 30 seconds

// Log memory statistics
const stats = await memoryProvider.getStats();
if (stats.success) {
  console.log('Memory statistics:', stats.data);
}
```

---

This guide provides comprehensive coverage of the JAF framework examples, from basic usage to advanced patterns and troubleshooting. Each section includes practical code examples and real-world implementation strategies to help developers build robust AI agent systems using the Juspay Agent Framework.