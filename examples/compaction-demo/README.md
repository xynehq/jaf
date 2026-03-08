# JAF Compaction Demo

This example shows the new core compaction flow with deterministic providers, so it runs without LiteLLM or any external API keys.

## What it demonstrates

- Agent-level compaction enablement through `agent.compaction`
- Thresholds coming from `modelProvider.getTokenLimits(...)`
- A separate compaction provider override through `runConfig.compaction.modelProvider`
- Additive token tracking across assistant output, tool calls, and tool results
- Compaction events emitted before the follow-up LLM turn
- The rebuilt transcript containing a `[JAF COMPACTION SUMMARY]` assistant message
- Full request/response logging for the main model and the compaction model

The flow is:

1. The main model asks for a tool.
2. The tool result inflates the live transcript.
3. JAF detects the context is now above the configured threshold.
4. A separate compaction provider summarizes the older prefix.
5. JAF rebuilds the transcript and continues the normal run.

## Run

From the repo root:

```bash
pnpm exec tsx examples/compaction-demo/index.ts
```

Or from the example directory:

```bash
pnpm dev
```

## What to look for

- `Compaction started` and `Compaction success` in the console output
- `overrideProvider=true`, showing the dedicated compaction provider was used
- The full first-turn system prompt and message array before the initial LLM call
- The full compaction request payload and compaction model response
- A final transcript where the older history has been replaced by a compaction summary
- The final assistant answer still using the preserved recent suffix and tool output
