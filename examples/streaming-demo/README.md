# JAF Streaming Demo (SSE)

This example demonstrates event-level streaming from the JAF engine both directly (no server) and over Server‑Sent Events (SSE) using the built‑in development server.

## Features

- Live `TraceEvent` stream per run: model calls, tool requests, tool execution, final output
- Simple agent with tools to trigger tool events
- Minimal Node client that consumes the SSE over a POST request

## Setup

1) Install deps (from repo root or this folder):

```bash
npm install
```

2) Ensure a LiteLLM proxy is running and set env:

```bash
export LITELLM_URL=http://localhost:4000
export LITELLM_API_KEY=sk-xxxx   # if required by your proxy
export LITELLM_MODEL=gpt-3.5-turbo
```

## Run

Start the server on port 3004:

```bash
npm run server
```

In another terminal, stream events with curl:

```bash
curl -N -H "Content-Type: application/json" \
  -X POST http://localhost:3004/chat \
  -d '{
    "agentName": "StreamerBot",
    "stream": true,
    "messages": [{ "role": "user", "content": "Hi, I am Alice. What time is it?" }],
    "context": { "userId": "demo" }
  }'
```

Direct engine streaming (no server):

```bash
npm run direct -- "Hi, I'm Bob. Please greet me then tell the time."
```

## Observing Events

You should see events such as:
- `run_start`
- `llm_call_start` / `llm_call_end`
- `assistant_message`
- `tool_requests`
- `tool_call_start` / `tool_call_end`
- `tool_results_to_llm`
- `final_output`
- `run_end`

Each event is a JSON object in the `data:` field of the SSE.

## Files

- `server.ts`: Starts the JAF server with a single agent and tools (SSE streaming)
- `stream-direct.ts`: Streams events directly from the engine (no server)
- `package.json`: Scripts to run server and direct engine streaming

## Notes

- This example streams event‑level updates, not token‑level LLM deltas.
- If your model doesn’t call tools automatically, prompt it to do so in your message.
- You can change the port with `PORT=3004 npm run server`.
