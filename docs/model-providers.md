# Model Providers and LLM Integration

The Functional Agent Framework (FAF) provides a flexible and extensible model provider abstraction that enables integration with various Large Language Models (LLMs) through a unified interface. This guide covers everything you need to know about model providers, configuration, and best practices.

## Table of Contents

- [Overview](#overview)
- [Model Provider Interface](#model-provider-interface)
- [LiteLLM Provider Implementation](#litellm-provider-implementation)
- [Model Configuration](#model-configuration)
- [Environment Variables and Setup](#environment-variables-and-setup)
- [Supported Models and Providers](#supported-models-and-providers)
- [Error Handling and Fallbacks](#error-handling-and-fallbacks)
- [Rate Limiting and Retries](#rate-limiting-and-retries)
- [Cost Optimization](#cost-optimization)
- [Custom Model Provider Creation](#custom-model-provider-creation)
- [Debugging Model Interactions](#debugging-model-interactions)
- [Examples](#examples)
- [Best Practices](#best-practices)

## Overview

FAF's model provider system abstracts away the complexity of interacting with different LLM APIs while providing:

- **Unified Interface**: Single API for all LLM providers
- **Type Safety**: Full TypeScript support with strict typing
- **Flexible Configuration**: Per-agent and global model settings
- **Tool Support**: Automatic tool schema conversion and execution
- **Error Handling**: Standardized error handling across providers
- **Tracing**: Built-in observability and debugging support

## Model Provider Interface

The core `ModelProvider` interface defines the contract that all model providers must implement:

```typescript
export interface ModelProvider<Ctx> {
  getCompletion: (
    state: Readonly<RunState<Ctx>>,
    agent: Readonly<Agent<Ctx, any>>,
    config: Readonly<RunConfig<Ctx>>
  ) => Promise<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
}
```

### Parameters

- **`state`**: The current run state containing messages, context, and metadata
- **`agent`**: The agent configuration including instructions, tools, and model config
- **`config`**: The run configuration with global settings and overrides

### Return Value

The provider must return a response object with an optional `message` containing:
- **`content`**: The LLM's text response
- **`tool_calls`**: Array of function calls the LLM wants to execute

## LiteLLM Provider Implementation

FAF includes a built-in LiteLLM provider that supports 100+ LLM providers through a unified interface.

### Creating a LiteLLM Provider

```typescript
import { makeLiteLLMProvider } from 'functional-agent-framework';

const modelProvider = makeLiteLLMProvider(
  'http://localhost:4000',  // LiteLLM server URL
  'sk-your-api-key'         // API key (can be "anything" for local LiteLLM)
);
```

### LiteLLM Server Setup

1. **Install LiteLLM**:
   ```bash
   pip install litellm[proxy]
   ```

2. **Create configuration file** (`litellm.yaml`):
   ```yaml
   model_list:
     - model_name: gpt-4o
       litellm_params:
         model: openai/gpt-4o
         api_key: os.environ/OPENAI_API_KEY
     
     - model_name: claude-3-sonnet
       litellm_params:
         model: anthropic/claude-3-sonnet-20240229
         api_key: os.environ/ANTHROPIC_API_KEY
     
     - model_name: gemini-pro
       litellm_params:
         model: gemini/gemini-pro
         api_key: os.environ/GOOGLE_API_KEY
   ```

3. **Start LiteLLM server**:
   ```bash
   litellm --config litellm.yaml --port 4000
   ```

### Provider Features

The LiteLLM provider automatically handles:

- **Model Selection**: Uses `modelOverride`, agent `modelConfig.name`, or defaults to `gpt-4o`
- **Message Conversion**: Converts FAF messages to OpenAI-compatible format
- **Tool Schema Conversion**: Transforms Zod schemas to JSON Schema for function calling
- **Temperature Control**: Applies temperature settings from agent configuration
- **Token Limits**: Enforces max token limits from agent configuration
- **Response Format**: Handles JSON mode for structured outputs

## Model Configuration

### Agent-Level Configuration

Configure models at the agent level using the `modelConfig` property:

```typescript
const agent: Agent<MyContext, string> = {
  name: 'MathTutor',
  instructions: () => 'You are a helpful math tutor.',
  tools: [calculatorTool],
  modelConfig: {
    name: 'gpt-4o',           // Model to use
    temperature: 0.1,         // Lower for more deterministic responses
    maxTokens: 2000          // Maximum response length
  }
};
```

### Global Configuration

Override model settings globally in the run configuration:

```typescript
const config: RunConfig<MyContext> = {
  agentRegistry,
  modelProvider,
  modelOverride: 'claude-3-sonnet',  // Override all agent model settings
  maxTurns: 10,
  // ... other config
};
```

### Model Selection Priority

FAF follows this priority order for model selection:

1. **Global Override**: `config.modelOverride`
2. **Agent Config**: `agent.modelConfig.name`
3. **Default**: `gpt-4o`

## Environment Variables and Setup

### LiteLLM Configuration

```bash
# LiteLLM server configuration
LITELLM_URL=http://localhost:4000
LITELLM_API_KEY=sk-your-api-key
LITELLM_MODEL=gpt-4o

# Provider-specific API keys
OPENAI_API_KEY=sk-your-openai-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
GOOGLE_API_KEY=your-google-api-key
AZURE_API_KEY=your-azure-key
AZURE_API_BASE=https://your-resource.openai.azure.com/
```

### Agent-Specific Environment Variables

```bash
# Model configuration
RAG_TEMPERATURE=0.1
RAG_MAX_TOKENS=2000
RAG_MAX_TURNS=5
RAG_MODEL=gemini-2.5-flash-lite
```

### Complete Setup Example

```typescript
// Load environment variables
import 'dotenv/config';

// Validate required variables
if (!process.env.LITELLM_URL) {
  throw new Error('LITELLM_URL environment variable is required');
}

if (!process.env.LITELLM_API_KEY) {
  throw new Error('LITELLM_API_KEY environment variable is required');
}

// Create model provider
const modelProvider = makeLiteLLMProvider(
  process.env.LITELLM_URL,
  process.env.LITELLM_API_KEY
);
```

## Supported Models and Providers

LiteLLM supports 100+ models from major providers:

### OpenAI Models
- `gpt-4o`, `gpt-4o-mini`
- `gpt-4-turbo`, `gpt-4`
- `gpt-3.5-turbo`

### Anthropic Models
- `claude-3-5-sonnet-20241022`
- `claude-3-opus-20240229`
- `claude-3-sonnet-20240229`
- `claude-3-haiku-20240307`

### Google Models
- `gemini-2.5-flash-lite`
- `gemini-1.5-pro-latest`
- `gemini-1.5-flash-latest`

### Azure OpenAI
- `azure/gpt-4o`
- `azure/gpt-4-turbo`

### AWS Bedrock
- `bedrock/anthropic.claude-3-sonnet-20240229-v1:0`
- `bedrock/anthropic.claude-3-haiku-20240307-v1:0`

### Others
- Cohere, Replicate, Hugging Face, Ollama, and more

### Provider Configuration Examples

```yaml
# OpenAI
- model_name: gpt-4o
  litellm_params:
    model: openai/gpt-4o
    api_key: os.environ/OPENAI_API_KEY

# Anthropic
- model_name: claude-3-sonnet
  litellm_params:
    model: anthropic/claude-3-sonnet-20240229
    api_key: os.environ/ANTHROPIC_API_KEY

# Azure OpenAI
- model_name: azure-gpt-4
  litellm_params:
    model: azure/gpt-4
    api_key: os.environ/AZURE_API_KEY
    api_base: os.environ/AZURE_API_BASE
    api_version: "2024-02-15-preview"

# Local Ollama
- model_name: llama2-local
  litellm_params:
    model: ollama/llama2
    api_base: http://localhost:11434
```

## Error Handling and Fallbacks

### Built-in Error Types

FAF defines comprehensive error types for model interactions:

```typescript
export type FAFError =
  | { readonly _tag: "MaxTurnsExceeded"; readonly turns: number }
  | { readonly _tag: "ModelBehaviorError"; readonly detail: string }
  | { readonly _tag: "DecodeError"; readonly errors: z.ZodIssue[] }
  | { readonly _tag: "InputGuardrailTripwire"; readonly reason: string }
  | { readonly _tag: "OutputGuardrailTripwire"; readonly reason: string }
  | { readonly _tag: "ToolCallError"; readonly tool: string; readonly detail: string }
  | { readonly _tag: "HandoffError"; readonly detail: string }
  | { readonly _tag: "AgentNotFound"; readonly agentName: string };
```

### Error Handling Example

```typescript
const result = await run(initialState, config);

if (result.outcome.status === 'error') {
  const error = result.outcome.error;
  
  switch (error._tag) {
    case 'ModelBehaviorError':
      console.error(`Model error: ${error.detail}`);
      // Retry logic, fallback model, etc.
      break;
      
    case 'MaxTurnsExceeded':
      console.error(`Conversation too long: ${error.turns} turns`);
      break;
      
    case 'ToolCallError':
      console.error(`Tool ${error.tool} failed: ${error.detail}`);
      break;
  }
}
```

### Model Fallback Implementation

```typescript
class FallbackModelProvider implements ModelProvider<any> {
  constructor(
    private primary: ModelProvider<any>,
    private fallback: ModelProvider<any>
  ) {}

  async getCompletion(state: any, agent: any, config: any) {
    try {
      return await this.primary.getCompletion(state, agent, config);
    } catch (error) {
      console.warn('Primary model failed, trying fallback:', error);
      return await this.fallback.getCompletion(state, agent, config);
    }
  }
}

// Usage
const primaryProvider = makeLiteLLMProvider('http://localhost:4000', 'key1');
const fallbackProvider = makeLiteLLMProvider('http://backup:4000', 'key2');
const modelProvider = new FallbackModelProvider(primaryProvider, fallbackProvider);
```

## Rate Limiting and Retries

### LiteLLM Built-in Features

LiteLLM provides built-in rate limiting and retry logic:

```yaml
# litellm.yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY
      rpm: 60              # Requests per minute
      tpm: 100000          # Tokens per minute

general_settings:
  max_retries: 3
  timeout: 30
  retry_delay: 1
```

### Custom Retry Logic

```typescript
class RetryModelProvider implements ModelProvider<any> {
  constructor(
    private inner: ModelProvider<any>,
    private maxRetries: number = 3,
    private baseDelay: number = 1000
  ) {}

  async getCompletion(state: any, agent: any, config: any) {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.inner.getCompletion(state, agent, config);
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.maxRetries) {
          const delay = this.baseDelay * Math.pow(2, attempt);
          console.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError!;
  }
}
```

## Cost Optimization

### Model Selection Strategy

Choose models based on your use case:

```typescript
// High-reasoning tasks
const reasoningAgent = {
  // ...
  modelConfig: { name: 'gpt-4o', temperature: 0.1 }
};

// Simple chat tasks
const chatAgent = {
  // ...
  modelConfig: { name: 'gpt-3.5-turbo', temperature: 0.7 }
};

// Fast, lightweight tasks
const quickAgent = {
  // ...
  modelConfig: { name: 'gpt-4o-mini', temperature: 0.3 }
};
```

### Token Management

```typescript
const tokenOptimizedAgent = {
  // ...
  modelConfig: {
    name: 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 500  // Limit response length
  }
};

// Compress conversation history
const config: RunConfig<any> = {
  // ...
  memory: {
    provider: memoryProvider,
    autoStore: true,
    maxMessages: 20,           // Keep only recent messages
    compressionThreshold: 50   // Compress when > 50 messages
  }
};
```

### Cost Monitoring

```typescript
class CostTrackingProvider implements ModelProvider<any> {
  private totalCost = 0;
  
  constructor(private inner: ModelProvider<any>) {}

  async getCompletion(state: any, agent: any, config: any) {
    const startTime = Date.now();
    const result = await this.inner.getCompletion(state, agent, config);
    const duration = Date.now() - startTime;
    
    // Estimate cost based on tokens and model
    const estimatedCost = this.estimateCost(agent.modelConfig?.name, result);
    this.totalCost += estimatedCost;
    
    console.log(`Model call cost: $${estimatedCost.toFixed(4)}, Total: $${this.totalCost.toFixed(4)}`);
    
    return result;
  }
  
  private estimateCost(model: string = 'gpt-4o', result: any): number {
    // Implement cost estimation logic based on your LLM pricing
    return 0.001; // Placeholder
  }
}
```

## Custom Model Provider Creation

### Basic Custom Provider

```typescript
class CustomModelProvider implements ModelProvider<any> {
  constructor(private apiKey: string, private baseUrl: string) {}

  async getCompletion(state: RunState<any>, agent: Agent<any, any>, config: RunConfig<any>) {
    const model = config.modelOverride ?? agent.modelConfig?.name ?? 'default-model';
    
    // Convert FAF messages to your API format
    const messages = [
      { role: 'system', content: agent.instructions(state) },
      ...state.messages.map(this.convertMessage)
    ];

    // Prepare API request
    const requestBody = {
      model,
      messages,
      temperature: agent.modelConfig?.temperature ?? 0.7,
      max_tokens: agent.modelConfig?.maxTokens ?? 1000,
      tools: this.convertTools(agent.tools)
    };

    // Make API call
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      message: {
        content: data.choices[0]?.message?.content,
        tool_calls: data.choices[0]?.message?.tool_calls
      }
    };
  }

  private convertMessage(msg: Message) {
    // Convert FAF message format to your API format
    return {
      role: msg.role,
      content: msg.content,
      tool_call_id: msg.tool_call_id,
      tool_calls: msg.tool_calls
    };
  }

  private convertTools(tools?: readonly Tool<any, any>[]) {
    if (!tools) return undefined;
    
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.schema.name,
        description: tool.schema.description,
        parameters: this.zodToJsonSchema(tool.schema.parameters)
      }
    }));
  }

  private zodToJsonSchema(schema: any): any {
    // Implement Zod to JSON Schema conversion
    // (FAF provides zodSchemaToJsonSchema utility)
    return { type: 'object' };
  }
}
```

### Advanced Provider with Streaming

```typescript
class StreamingModelProvider implements ModelProvider<any> {
  async getCompletion(state: RunState<any>, agent: Agent<any, any>, config: RunConfig<any>) {
    // Implement streaming response handling
    const stream = await this.createStream(state, agent, config);
    let content = '';
    
    for await (const chunk of stream) {
      if (chunk.choices?.[0]?.delta?.content) {
        content += chunk.choices[0].delta.content;
        
        // Optional: emit streaming events
        config.onEvent?.({
          type: 'llm_call_start',  // Reuse existing event types or define new ones
          data: { agentName: agent.name, model: 'streaming', content }
        });
      }
    }
    
    return {
      message: { content }
    };
  }

  private async* createStream(state: any, agent: any, config: any) {
    // Implement your streaming API call
    yield { choices: [{ delta: { content: 'Hello' } }] };
    yield { choices: [{ delta: { content: ' World!' } }] };
  }
}
```

## Debugging Model Interactions

### Enable Tracing

```typescript
import { ConsoleTraceCollector } from 'functional-agent-framework';

const traceCollector = new ConsoleTraceCollector();

const config: RunConfig<any> = {
  // ...
  onEvent: traceCollector.collect.bind(traceCollector)
};
```

### Trace Events

FAF emits detailed trace events for model interactions:

```typescript
// LLM call start
{ 
  type: 'llm_call_start', 
  data: { agentName: 'MathTutor', model: 'gpt-4o' } 
}

// LLM call end
{ 
  type: 'llm_call_end', 
  data: { choice: { message: { content: 'The answer is 42' } } } 
}
```

### Custom Debug Provider

```typescript
class DebugModelProvider implements ModelProvider<any> {
  constructor(private inner: ModelProvider<any>) {}

  async getCompletion(state: RunState<any>, agent: Agent<any, any>, config: RunConfig<any>) {
    console.log('🤖 Model Request:');
    console.log('  Agent:', agent.name);
    console.log('  Model:', config.modelOverride ?? agent.modelConfig?.name ?? 'default');
    console.log('  Messages:', state.messages.length);
    console.log('  Tools:', agent.tools?.length || 0);
    console.log('  Context:', Object.keys(state.context));

    const startTime = Date.now();
    
    try {
      const result = await this.inner.getCompletion(state, agent, config);
      const duration = Date.now() - startTime;
      
      console.log('✅ Model Response:');
      console.log('  Duration:', `${duration}ms`);
      console.log('  Content:', result.message?.content?.substring(0, 100) + '...');
      console.log('  Tool calls:', result.message?.tool_calls?.length || 0);
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error('❌ Model Error:');
      console.error('  Duration:', `${duration}ms`);
      console.error('  Error:', error);
      
      throw error;
    }
  }
}
```

### Response Validation

```typescript
class ValidatingModelProvider implements ModelProvider<any> {
  constructor(private inner: ModelProvider<any>) {}

  async getCompletion(state: RunState<any>, agent: Agent<any, any>, config: RunConfig<any>) {
    const result = await this.inner.getCompletion(state, agent, config);
    
    // Validate response structure
    if (!result.message) {
      throw new Error('Model provider returned invalid response: missing message');
    }
    
    // Validate tool calls if present
    if (result.message.tool_calls) {
      for (const toolCall of result.message.tool_calls) {
        if (!toolCall.id || !toolCall.function?.name) {
          throw new Error('Model provider returned invalid tool call structure');
        }
        
        // Validate tool exists
        const tool = agent.tools?.find(t => t.schema.name === toolCall.function.name);
        if (!tool) {
          console.warn(`Model called unknown tool: ${toolCall.function.name}`);
        }
      }
    }
    
    return result;
  }
}
```

## Examples

### Basic Setup

```typescript
import 'dotenv/config';
import { 
  run, 
  RunConfig, 
  RunState, 
  createTraceId, 
  createRunId,
  makeLiteLLMProvider 
} from 'functional-agent-framework';

// Set up model provider
const modelProvider = makeLiteLLMProvider(
  process.env.LITELLM_URL!,
  process.env.LITELLM_API_KEY!
);

// Define agent
const agent = {
  name: 'Assistant',
  instructions: () => 'You are a helpful assistant.',
  modelConfig: {
    name: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 1000
  }
};

// Run configuration
const config: RunConfig<any> = {
  agentRegistry: new Map([['Assistant', agent]]),
  modelProvider,
  maxTurns: 10
};

// Execute
const result = await run({
  runId: createRunId(crypto.randomUUID()),
  traceId: createTraceId(crypto.randomUUID()),
  messages: [{ role: 'user', content: 'Hello!' }],
  currentAgentName: 'Assistant',
  context: {},
  turnCount: 0
}, config);
```

### Multi-Model Setup

```typescript
// Different models for different tasks
const agents = {
  reasoner: {
    name: 'Reasoner',
    instructions: () => 'You solve complex problems step by step.',
    modelConfig: { name: 'gpt-4o', temperature: 0.1 }
  },
  
  creative: {
    name: 'Creative',
    instructions: () => 'You write creative content.',
    modelConfig: { name: 'claude-3-sonnet', temperature: 0.9 }
  },
  
  fast: {
    name: 'Fast',
    instructions: () => 'You provide quick answers.',
    modelConfig: { name: 'gpt-4o-mini', temperature: 0.3 }
  }
};
```

### Production Setup with Error Handling

```typescript
class ProductionModelProvider implements ModelProvider<any> {
  private retryProvider: RetryModelProvider;
  private debugProvider: DebugModelProvider;
  private costTracker: CostTrackingProvider;

  constructor(baseUrl: string, apiKey: string) {
    const baseProvider = makeLiteLLMProvider(baseUrl, apiKey);
    this.retryProvider = new RetryModelProvider(baseProvider, 3, 1000);
    this.debugProvider = new DebugModelProvider(this.retryProvider);
    this.costTracker = new CostTrackingProvider(this.debugProvider);
  }

  async getCompletion(state: RunState<any>, agent: Agent<any, any>, config: RunConfig<any>) {
    try {
      return await this.costTracker.getCompletion(state, agent, config);
    } catch (error) {
      // Log error to monitoring system
      console.error('Model provider error:', error);
      
      // Report to error tracking
      // errorTracker.report(error, { agent: agent.name, model: agent.modelConfig?.name });
      
      throw error;
    }
  }
}
```

## Best Practices

### 1. Model Selection

- **Use appropriate models for tasks**: GPT-4o for reasoning, GPT-4o-mini for simple tasks
- **Consider cost vs. quality tradeoffs**: Start with smaller models and upgrade as needed
- **Test different models**: Benchmark performance across your specific use cases

### 2. Configuration Management

- **Environment-based config**: Use environment variables for different environments
- **Centralized settings**: Keep model configurations in a central location
- **Validation**: Validate all configuration values at startup

### 3. Error Handling

- **Implement retries**: Handle transient failures with exponential backoff
- **Fallback models**: Have backup models for critical applications
- **Graceful degradation**: Handle model failures without breaking user experience

### 4. Performance Optimization

- **Token management**: Monitor and optimize token usage
- **Caching**: Cache responses for repeated queries
- **Parallel processing**: Use concurrent processing where possible

### 5. Monitoring and Observability

- **Cost tracking**: Monitor usage and costs across models
- **Performance metrics**: Track response times and success rates
- **Error analysis**: Analyze error patterns and optimize accordingly

### 6. Security

- **API key management**: Use secure key storage and rotation
- **Input validation**: Validate all inputs before sending to models
- **Output sanitization**: Sanitize model outputs before use

### 7. Development Workflow

- **Local testing**: Use local models (Ollama) for development
- **Staging environment**: Test with production models in staging
- **A/B testing**: Compare model performance with real users

Remember that model providers are a critical component of your FAF application, and proper implementation ensures reliable, cost-effective, and performant AI functionality.