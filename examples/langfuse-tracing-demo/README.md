# JAF Langfuse Tracing Demo

This example demonstrates how to use JAF with Langfuse tracing.

## Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Set up Langfuse (Local development):**
   
   You can run Langfuse locally using the provided docker-compose.yml:
   ```bash
   # From the root of the JAF repo
   docker-compose up -d
   ```
   
   Then visit http://localhost:3000 to access Langfuse and create your API keys.

3. **Set environment variables:**
   ```bash
   # Required for LLM provider
   export LITELLM_API_KEY="your_api_key_here"
   
   # Required for Langfuse
   export LANGFUSE_PUBLIC_KEY="pk-lf-your-public-key-here"
   export LANGFUSE_SECRET_KEY="sk-lf-your-secret-key-here"
   
   # Optional: Set Langfuse host (defaults to https://cloud.langfuse.com)
   export LANGFUSE_HOST="http://localhost:3000"
   ```

## Run

```bash
pnpm start
```

## View Traces

Open your Langfuse instance (http://localhost:3000 for local setup) to view the traces.

## How it works

- The demo sets up a weather agent with Langfuse tracing enabled
- When `createCompositeTraceCollector` is called, it automatically detects the `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` environment variables and adds a Langfuse collector
- All JAF events are converted to Langfuse traces:
  - `run_start`/`run_end` → Langfuse traces
  - `llm_call_start`/`llm_call_end` → Langfuse generations (with usage data)
  - `tool_call_start`/`tool_call_end` → Langfuse spans
  - Other events → Langfuse events
- User and session context from the agent state is automatically included in traces