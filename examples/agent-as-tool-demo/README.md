## JAF Agents-as-Tools Demo

This example shows how to wrap one agent as a tool and use it from another agent to perform a focused sub-task without handing off the full conversation.

### Prerequisites

- A LiteLLM proxy endpoint and API key

Set these environment variables:

```
LITELLM_URL=...            # e.g. http://localhost:4000/v1
LITELLM_API_KEY=...        # e.g. sk-...
LITELLM_MODEL=gpt-4o-mini  # or any model supported by your proxy
```

### Run

```
pnpm -F jaf-agent-as-tool-demo dev
```

You should see the main agent call the `summarize_text` tool (a wrapped sub-agent) and return a concise summary.

