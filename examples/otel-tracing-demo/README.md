# JAF OpenTelemetry Tracing Demo

This example demonstrates how to use JAF with OpenTelemetry tracing.

## Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Set up OpenTelemetry Collector (Optional):**
   
   You can run Jaeger locally to collect and view traces:
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

3. **Set environment variables:**
   ```bash
   # Required for LLM provider
   export LITELLM_API_KEY="your_api_key_here"
   
   # Optional: Set OTLP endpoint (defaults to http://localhost:4318/v1/traces)
   export TRACE_COLLECTOR_URL="http://localhost:4318/v1/traces"
   ```

## Run

```bash
pnpm start
```

## View Traces

If you're running Jaeger locally, open http://localhost:16686 in your browser to view the traces.

## How it works

- The demo sets up a weather agent with OpenTelemetry tracing enabled
- When `createCompositeTraceCollector` is called, it automatically detects the `TRACE_COLLECTOR_URL` environment variable and adds an OpenTelemetry collector
- All JAF events (runs, LLM calls, tool calls) are converted to OpenTelemetry spans
- Traces are sent to the configured OTLP endpoint