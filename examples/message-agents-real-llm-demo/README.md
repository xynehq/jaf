# JAF Real LiteLLM Message-Agents Demo

This example is the closest JAF analogue in the repo to Xyne's `MessageAgents` flow.

It uses real LiteLLM-backed chat completion calls for:

- the parent orchestrator turns
- delegated specialist sub-runs via `agentAsTool`
- the compaction LLM call
- the explicit final synthesis step

Unlike `examples/compaction-real-llm-multi-turn-demo/`, this example is not just a tool-backed multi-turn conversation. It demonstrates the more opinionated control flow of a message-agents run:

1. create or revise a sequential plan
2. delegate focused work to specialists
3. update the working brief as evidence arrives
4. compact the transcript when it grows
5. finish through a dedicated synthesis step

## What it demonstrates

- A parent orchestrator that stays in control across the full conversation
- Specialist delegation via `agentAsTool`
- Example-local planning with an `update_plan` tool
- An explicit `synthesize_final_brief` step for the final answer
- Real compaction under a more realistic orchestration flow
- Full request and response logging for the parent model and the compaction model

## Comparison to the existing compaction demo

| Example | Primary focus |
|---|---|
| `compaction-real-llm-multi-turn-demo` | Multi-turn tool-backed compaction with one main agent |
| `message-agents-real-llm-demo` | Parent orchestrator + delegated specialists + explicit final synthesis under compaction |

## Required environment

Copy `.env.example` to `.env` and fill in:

```bash
LITELLM_URL=https://grid.ai.juspay.net/v1
LITELLM_API_KEY=your-key
LITELLM_MODEL=glm-flash-experimental
LITELLM_COMPACTION_MODEL=glm-flash-experimental
LITELLM_MAX_INPUT_TOKENS=3200
LITELLM_MAX_OUTPUT_TOKENS=500
COMPACTION_TRIGGER_PERCENTAGE=0.48
```

Important:

- `COMPACTION_TRIGGER_PERCENTAGE=0.48` is tuned so the example usually gets through planning plus at least part of delegation before compaction starts.
- `LITELLM_PROVIDER` is optional. Use it only when your LiteLLM setup expects provider-prefixed model names such as `openai/gpt-4o-mini`.
- `LITELLM_URL` should point at the LiteLLM base path that serves `/chat/completions`. If you pass `https://host/v1`, the example uses it as-is. If you pass `https://host`, the example normalizes it to `https://host/v1`.

## Run

From the repo root:

```bash
pnpm exec tsx examples/message-agents-real-llm-demo/index.ts
```

Or from the example directory:

```bash
pnpm dev
```

## Expected flow

1. Turn 1 creates the initial plan.
2. Turns 2 to 4 delegate operational, commercial, and delivery analysis.
3. The parent keeps revising the working brief and plan as specialist outputs arrive.
4. Compaction should trigger once the transcript grows enough.
5. The final turn calls `synthesize_final_brief` and returns the board-ready brief.

## What to look for

- `update_plan(...)` appearing early in the run
- `delegate_operational_analysis`, `delegate_commercial_analysis`, and `delegate_delivery_strategy` appearing as tool calls
- `Compaction started before scripted turn ...` in the console output
- The final transcript containing both delegated tool messages and a `[JAF COMPACTION SUMMARY]` assistant message
- The final answer preserving names, metrics, owners, discounts, and readiness gates after compaction
