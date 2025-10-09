# Tracing and Observability

JAF provides comprehensive tracing and observability capabilities to help you monitor, debug, and optimize your agent workflows. This documentation covers the built-in tracing system and integrations with popular observability platforms.

## Table of Contents

1. [Overview](#overview)
2. [Built-in Trace Collectors](#built-in-trace-collectors)
3. [OpenTelemetry Integration](#opentelemetry-integration)
4. [Langfuse Integration](#langfuse-integration)
5. [Event Types and Data](#event-types-and-data)
6. [Custom Trace Collectors](#custom-trace-collectors)
7. [Best Practices](#best-practices)

## Overview

JAF's tracing system is built around the concept of **TraceEvents** that are emitted throughout the agent execution lifecycle. These events provide detailed insight into:

- Agent runs and outcomes
- LLM calls and responses (with usage data)
- Tool executions and results
- Agent handoffs
- Guardrail checks
- Memory operations
- Output parsing

All events include trace and run identifiers for correlation across distributed systems and agent handoffs.

## Built-in Trace Collectors

### ConsoleTraceCollector

Logs events to the console with structured formatting:

```typescript
import { ConsoleTraceCollector } from '@xynehq/jaf/core';

const collector = new ConsoleTraceCollector();

const config = {
  // ... other config
  onEvent: collector.collect.bind(collector)
};
```

### InMemoryTraceCollector

Stores events in memory for programmatic access:

```typescript
import { InMemoryTraceCollector } from '@xynehq/jaf/core';

const collector = new InMemoryTraceCollector();

// Use the collector...

// Access traces later
const allTraces = collector.getAllTraces();
const specificTrace = collector.getTrace(traceId);
```

### FileTraceCollector

Writes events to a file in JSON Lines format:

```typescript
import { FileTraceCollector } from '@xynehq/jaf/core';

const collector = new FileTraceCollector('/path/to/traces.jsonl');
```

### Composite Collector

Combine multiple collectors and automatically enable external integrations:

```typescript
import { createCompositeTraceCollector, ConsoleTraceCollector } from '@xynehq/jaf/core';

// Automatically includes OpenTelemetry and Langfuse collectors if configured
const collector = createCompositeTraceCollector(
  new ConsoleTraceCollector()
);
```

## OpenTelemetry Integration

JAF supports OpenTelemetry for integration with observability platforms like Jaeger, Zipkin, and cloud-based solutions.

### Setup

1. **Install optional dependencies:**
   ```bash
   npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/exporter-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions
   ```

2. **Configure environment:**
   ```bash
   export TRACE_COLLECTOR_URL="http://localhost:4318/v1/traces"
   ```

3. **Enable tracing:**
   ```typescript
   import { createCompositeTraceCollector, ConsoleTraceCollector } from '@xynehq/jaf/core';

   // OpenTelemetry collector is automatically added when TRACE_COLLECTOR_URL is set
   const collector = createCompositeTraceCollector(new ConsoleTraceCollector());
   ```

### Local Development with Jaeger

Run Jaeger locally for trace visualization:

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 14250:14250 \
  -p 14268:14268 \
  -p 6831:6831/udp \
  -p 6832:6832/udp \
  -p 5778:5778 \
  -p 4317:4317 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Access the UI at http://localhost:16686

### Trace Structure

- **Root Span**: `jaf.run.{traceId}` - spans the entire agent run
- **Child Spans**: `jaf.{eventType}` - individual operations like LLM calls, tool executions

### Proxy Support

JAF provides flexible proxy support for routing OpenTelemetry traces through HTTP/HTTPS proxies. Choose between programmatic configuration or environment variables.

#### Method 1: Programmatic Configuration (Recommended)

Configure proxy settings directly in your code:

```typescript
import { configureProxy, OpenTelemetryTraceCollector } from '@xynehq/jaf';

// Configure proxy BEFORE creating trace collectors
configureProxy({
  httpProxy: 'http://proxy.example.com:8080',
  httpsProxy: 'http://proxy.example.com:8080',
  noProxy: 'localhost,127.0.0.1,*.local'
});

// Now create your trace collector
const collector = new OpenTelemetryTraceCollector();
```

**With Authentication:**

```typescript
configureProxy({
  httpProxy: 'http://username:password@proxy.example.com:8080',
  httpsProxy: 'http://username:password@proxy.example.com:8080'
});
```

#### Method 2: Environment Variables

Set proxy environment variables before running your application:

```bash
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=http://proxy.example.com:8080
export NO_PROXY=localhost,127.0.0.1
export TRACE_COLLECTOR_URL=http://your-collector:4318/v1/traces
```

#### Priority

Manual configuration via `configureProxy()` takes priority over environment variables.

#### Bypass Specific Hosts

Use `noProxy` / `NO_PROXY` to bypass the proxy for specific hosts:

```typescript
configureProxy({
  httpsProxy: 'http://proxy.example.com:8080',
  noProxy: 'localhost,127.0.0.1,*.internal.company.com,langfuse.local'
});
```

#### Reset Configuration

For testing or reconfiguration:

```typescript
import { resetProxyConfig } from '@xynehq/jaf';

resetProxyConfig();  // Reset proxy configuration
configureProxy({ ... });  // Reconfigure
```

See `examples/proxy-config-demo.ts` for complete examples.

## Langfuse Integration

JAF integrates with [Langfuse](https://langfuse.com/) for LLM observability and analytics.

### Setup

1. **Install Langfuse:**
   ```bash
   npm install langfuse
   ```

2. **Configure environment:**
   ```bash
   export LANGFUSE_PUBLIC_KEY="pk-lf-your-public-key"
   export LANGFUSE_SECRET_KEY="sk-lf-your-secret-key"
   export LANGFUSE_HOST="https://cloud.langfuse.com"  # or your self-hosted instance
   ```

3. **Enable tracing:**
   ```typescript
   import { createCompositeTraceCollector, ConsoleTraceCollector } from '@xynehq/jaf/core';

   // Langfuse collector is automatically added when API keys are set
   const collector = createCompositeTraceCollector(new ConsoleTraceCollector());
   ```

### Local Development with Langfuse

Use the provided docker-compose.yml to run Langfuse locally:

```bash
# From the JAF root directory
docker-compose up -d
```

Access the UI at http://localhost:3000

### Trace Mapping

- **Runs** → Langfuse Traces
- **LLM Calls** → Langfuse Generations (with usage/cost data)
- **Tool Calls** → Langfuse Spans
- **Other Events** → Langfuse Events

## Event Types and Data

### Core Events

| Event Type | Description | Data Fields |
|------------|-------------|-------------|
| `run_start` | Agent run begins | `runId`, `traceId` |
| `run_end` | Agent run completes | `outcome`, `traceId`, `runId` |
| `llm_call_start` | LLM call initiated | `agentName`, `model`, `traceId`, `runId` |
| `llm_call_end` | LLM call completed | `choice`, `usage`, `traceId`, `runId` |
| `tool_call_start` | Tool execution begins | `toolName`, `args`, `traceId`, `runId` |
| `tool_call_end` | Tool execution completes | `toolName`, `result`, `toolResult`, `status`, `traceId`, `runId` |

### Additional Events

- `turn_start` / `turn_end`: Agent turn lifecycle
- `handoff`: Agent-to-agent handoffs
- `guardrail_check`: Input/output validation
- `memory_operation`: Memory load/store operations
- `output_parse`: Output parsing events
- `token_usage`: Token consumption tracking

### Usage Data

LLM usage data is automatically captured and includes:

```typescript
{
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
```

## Custom Trace Collectors

Implement the `TraceCollector` interface for custom integrations:

```typescript
import { TraceCollector, TraceEvent, TraceId } from '@xynehq/jaf/core';

class CustomTraceCollector implements TraceCollector {
  collect(event: TraceEvent): void {
    // Process the event
    console.log('Custom collector:', event.type, event.data);
  }

  getTrace(traceId: TraceId): TraceEvent[] {
    // Return events for a specific trace
    return [];
  }

  getAllTraces(): Map<TraceId, TraceEvent[]> {
    // Return all traces
    return new Map();
  }

  clear(traceId?: TraceId): void {
    // Clear traces
  }
}
```

### Database Integration Example

```typescript
class DatabaseTraceCollector implements TraceCollector {
  constructor(private db: Database) {}

  async collect(event: TraceEvent): Promise<void> {
    await this.db.query(
      'INSERT INTO traces (trace_id, event_type, data, timestamp) VALUES (?, ?, ?, ?)',
      [event.data.traceId, event.type, JSON.stringify(event.data), new Date()]
    );
  }

  // ... implement other methods
}
```

## Best Practices

### 1. Use Composite Collectors

Always use `createCompositeTraceCollector` to enable automatic integration detection:

```typescript
const collector = createCompositeTraceCollector(
  new ConsoleTraceCollector(),
  new FileTraceCollector('./traces.jsonl')
);
```

### 2. Include Context Information

Add user and session context to your agent state for better trace correlation:

```typescript
const initialState = {
  // ... other fields
  context: {
    userId: 'user-123',
    sessionId: 'session-456',
    organizationId: 'org-789'
  }
};
```

### 3. Handle Errors Gracefully

The tracing system is designed to fail silently to avoid disrupting agent execution. However, monitor your logs for tracing issues.

### 4. Use Trace and Run IDs

Leverage trace and run IDs for correlation:

- **Trace ID**: Consistent across agent handoffs in the same workflow
- **Run ID**: Unique to each individual agent execution

### 5. Monitor Resource Usage

For high-volume applications:

- Use sampling for OpenTelemetry traces
- Configure Langfuse with appropriate batching
- Consider using file-based collectors with log rotation

### 6. Security Considerations

- Keep Langfuse API keys secure
- Be mindful of sensitive data in trace events
- Use environment variables for configuration
- Consider data retention policies

## Examples

Complete examples are available in the `examples/` directory:

- `examples/otel-tracing-demo/` - OpenTelemetry integration
- `examples/langfuse-tracing-demo/` - Langfuse integration

Both examples include setup instructions and environment configuration guides.