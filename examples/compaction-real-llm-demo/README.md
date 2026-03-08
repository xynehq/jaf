# JAF Real LiteLLM Compaction Demo

This example uses real LiteLLM-backed chat completion calls for both:

- the normal JAF turn LLM calls
- the compaction LLM call

It is intended for a LiteLLM proxy endpoint and keeps the example contract aligned with the rest of the repo.

The outbound requests are standard LiteLLM `/v1/chat/completions` calls and include the `x-litellm-disable-logging: true` header, so they line up with requests of the form:

```bash
curl --location 'https://grid.ai.juspay.net/v1/chat/completions' \
  --header 'Authorization: Bearer ...' \
  --header 'Content-Type: application/json' \
  --header 'x-litellm-disable-logging: true'
```

## What it demonstrates

- A custom `ModelProvider` that makes real chat completion requests
- `getTokenLimits(...)` supplied by the caller instead of `model_prices.json`
- A separate compaction provider override through `runConfig.compaction.modelProvider`
- Full request/response logging for both the main turn model and the compaction model
- Core compaction happening before the main turn because the seeded transcript is intentionally long
- A plain chat-completions request shape without tool-calling, so raw LiteLLM model names such as `glm-flash-experimental` work cleanly

## Required environment

Copy `.env.example` to `.env` and fill in:

```bash
LITELLM_URL=https://grid.ai.juspay.net/v1
LITELLM_API_KEY=your-key
LITELLM_MODEL=glm-flash-experimental
LITELLM_COMPACTION_MODEL=glm-flash-experimental
LITELLM_MAX_INPUT_TOKENS=800
LITELLM_MAX_OUTPUT_TOKENS=300
COMPACTION_TRIGGER_PERCENTAGE=0.32
```

Important:

- `LITELLM_MAX_INPUT_TOKENS` is required because core compaction uses the provider-supplied context window.
- `LITELLM_PROVIDER` is optional. Use it only when your LiteLLM setup expects provider-prefixed model names such as `openai/gpt-4o-mini`. Leave it unset for raw model names like `glm-flash-experimental`.
- `LITELLM_URL` should point at the LiteLLM base path that serves `/chat/completions`. If you pass `https://host/v1`, the example uses it as-is. If you pass `https://host`, the example normalizes it to `https://host/v1`.
- The example intentionally uses a low trigger percentage so compaction reliably happens during the demo.

## Run

From the repo root:

```bash
pnpm exec tsx examples/compaction-real-llm-demo/index.ts
```

Or from the example directory:

```bash
pnpm dev
```

## What to look for

- The compaction request payload sent first
- The normal turn request payload sent after compaction
- The LiteLLM header dump, including `x-litellm-disable-logging: true`
- `compaction_start` / `compaction_end` logs from JAF
- The final transcript with `[JAF COMPACTION SUMMARY]` inserted
