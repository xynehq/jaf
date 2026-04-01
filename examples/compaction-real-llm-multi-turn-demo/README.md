# JAF Real LiteLLM Multi-Turn Compaction Demo

This example uses real LiteLLM-backed chat completion calls for both:

- the normal JAF turn LLM calls
- the compaction LLM call

Unlike the single-run real compaction demo, this one keeps the conversation going across multiple `run(...)` calls so you can see compaction happen after several normal turns, then continue the chat, and only answer at the end.

## What it demonstrates

- A custom `ModelProvider` that makes real chat completion requests
- A slightly larger model context window than the basic real compaction demo
- Four normal turns before compaction is expected to kick in
- Two more post-compaction turns that keep using the rebuilt transcript
- A final answer on the last turn instead of answering immediately
- Full request and response logging for both the main turn model and the compaction model

## Required environment

Copy `.env.example` to `.env` and fill in:

```bash
LITELLM_URL=https://grid.ai.juspay.net/v1
LITELLM_API_KEY=your-key
LITELLM_MODEL=glm-flash-experimental
LITELLM_COMPACTION_MODEL=glm-flash-experimental
LITELLM_MAX_INPUT_TOKENS=2400
LITELLM_MAX_OUTPUT_TOKENS=260
COMPACTION_TRIGGER_PERCENTAGE=0.52
```

Important:

- `LITELLM_MAX_INPUT_TOKENS` is intentionally higher than the single-turn demo, but still low enough that the scripted conversation should compact around turn 5.
- `COMPACTION_TRIGGER_PERCENTAGE=0.52` is tuned so the default transcript usually grows through four turns before compaction.
- `LITELLM_PROVIDER` is optional. Use it only when your LiteLLM setup expects provider-prefixed model names such as `openai/gpt-4o-mini`.
- `LITELLM_URL` should point at the LiteLLM base path that serves `/chat/completions`. If you pass `https://host/v1`, the example uses it as-is. If you pass `https://host`, the example normalizes it to `https://host/v1`.

## Run

From the repo root:

```bash
pnpm exec tsx examples/compaction-real-llm-multi-turn-demo/index.ts
```

Or from the example directory:

```bash
pnpm dev
```

## Expected flow

1. Turns 1 to 4 add realistic account-planning notes to the transcript.
2. Before turn 5, JAF should compact the older prefix.
3. Turns 5 and 6 continue on top of the compacted transcript.
4. Turn 7 asks for the final executive-ready brief.

## What to look for

- `Compaction started before scripted turn 5` in the console output
- The compaction request payload appearing between normal turn requests
- The final transcript containing a `[JAF COMPACTION SUMMARY]` assistant message
- The last answer still preserving key names, metrics, timing, and commercial commitments
