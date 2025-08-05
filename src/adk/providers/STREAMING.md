# Real LLM Streaming Implementation

## Overview

The FAF ADK now supports real streaming from LLM providers, replacing the previous simulated chunking approach. This provides a better user experience with faster time-to-first-token and real-time response display.

## Supported Providers

### 1. OpenAI Direct
- Uses OpenAI's native streaming API
- Requires `OPENAI_API_KEY` environment variable
- Supports all OpenAI models with streaming capability

### 2. LiteLLM Proxy
- Streams through LiteLLM proxy server
- Supports 100+ LLM providers via unified interface
- Configure with `LITELLM_URL` and optional `LITELLM_API_KEY`

### 3. Anthropic via LiteLLM
- Stream Claude models through LiteLLM proxy
- Requires `ANTHROPIC_API_KEY` or LiteLLM configuration

### 4. Google via LiteLLM
- Stream Gemini models through LiteLLM proxy
- Requires `GOOGLE_API_KEY` or LiteLLM configuration

## Usage

### Basic Streaming

```typescript
import { createAdkLLMService, createAgent } from '@xynehq/faf/adk';

// Create service with provider
const service = createAdkLLMService({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY
});

// Create agent
const agent = createAgent({
  name: 'assistant',
  model: 'gpt-3.5-turbo',
  instruction: 'You are a helpful assistant.',
  tools: []
});

// Stream response
const stream = service.generateStreamingResponse(agent, session, message);

for await (const chunk of stream) {
  if (chunk.delta) {
    process.stdout.write(chunk.delta); // Display as it arrives
  }
  
  if (chunk.functionCall) {
    console.log('Function call:', chunk.functionCall);
  }
  
  if (chunk.isDone) {
    break;
  }
}
```

### Streaming with Function Calls

The streaming implementation properly handles tool/function calls:

```typescript
const agent = createAgent({
  name: 'assistant',
  model: 'gpt-4',
  instruction: 'Use tools when appropriate.',
  tools: [weatherTool, calculatorTool]
});

const stream = service.generateStreamingResponse(agent, session, message);

for await (const chunk of stream) {
  // Function calls are streamed as they complete
  if (chunk.functionCall) {
    const result = await executeTool(
      chunk.functionCall.name,
      chunk.functionCall.args
    );
    // Handle tool result...
  }
}
```

## Configuration

### Environment Variables

```bash
# For OpenAI direct streaming
export OPENAI_API_KEY=sk-...

# For LiteLLM proxy streaming
export LITELLM_URL=http://localhost:4000
export LITELLM_API_KEY=optional-key

# Provider selection (defaults to openai if key is set)
export LLM_PROVIDER=openai|litellm|anthropic|google
```

### Service Configuration

```typescript
// OpenAI Direct
const service = createAdkLLMService({
  provider: 'openai',
  apiKey: 'sk-...',
  defaultModel: 'gpt-4-turbo'
});

// LiteLLM Proxy
const service = createAdkLLMService({
  provider: 'litellm',
  baseUrl: 'http://localhost:4000',
  apiKey: 'optional',
  defaultModel: 'gpt-3.5-turbo'
});

// Anthropic via LiteLLM
const service = createAdkLLMService({
  provider: 'anthropic',
  baseUrl: 'http://localhost:4000', // LiteLLM URL
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultModel: 'claude-3-sonnet'
});
```

## Implementation Details

### Architecture

1. **Direct OpenAI SDK Usage**: For streaming support, we bypass the Core provider layer and use the OpenAI SDK directly
2. **Unified Interface**: All providers use the OpenAI-compatible API format
3. **Incremental Parsing**: Function call arguments are parsed incrementally as they stream

### Stream Format

```typescript
interface AdkLLMStreamChunk {
  delta: string;           // Text content delta
  functionCall?: FunctionCall; // Complete function call
  isDone: boolean;         // Stream completion flag
}
```

### Error Handling

Streaming errors are properly propagated:

```typescript
try {
  for await (const chunk of stream) {
    // Process chunks
  }
} catch (error) {
  // Handle streaming errors
  console.error('Streaming failed:', error);
}
```

## Performance Benefits

1. **Faster Time-to-First-Token**: Users see responses immediately
2. **Better UX**: Progressive display of long responses
3. **Reduced Memory**: No need to buffer entire response
4. **Real Parallelism**: Can process chunks while streaming

## Migration from Simulated Streaming

Previous code using simulated streaming will continue to work without changes:

```typescript
// This code works with both old and new implementation
const stream = service.generateStreamingResponse(agent, session, message);
for await (const chunk of stream) {
  // Handle chunks...
}
```

The only difference is that responses now stream in real-time rather than being chunked artificially.

## Testing

Run streaming tests:

```bash
# Requires OPENAI_API_KEY
npm test -- src/adk/providers/__tests__/streaming.test.ts
```

Run streaming examples:

```bash
# Set your API key
export OPENAI_API_KEY=sk-...

# Run examples
npx tsx src/adk/examples/streaming-example.ts
```

## Troubleshooting

### No Streaming Output
- Verify API key is set correctly
- Check provider configuration
- Ensure model supports streaming

### Slow Streaming
- Check network connectivity
- Verify LiteLLM proxy is running (if using)
- Consider using a faster model

### Function Call Issues
- Ensure tools are properly defined
- Check that model supports function calling
- Verify tool parameters match schema