# Practical Tips for `runStream` and Raw Engine Runs

Use this guide whenever you bypass the ADK runner and talk directly to the JAF core (`run`/`runStream`). Callouts cite the exact lines in this repo so you can verify the behavior.

## 1. Owning `state.context`
- **Where it lives:** `RunState` carries an arbitrary `context` object alongside ids, agent name, and history (`src/core/types.ts:150-158`). Treat it as the shared scratchpad for planners, reviewers, MCP inventories, cost trackers, etc.
- **What touches it:**
  - Agent instructions receive the full state every turn, so anything you stash in `context` can change instructions dynamically (`src/providers/model.ts:251-282`).
  - Every tool gets the same context when `execute` is called, meaning tools can inspect previous choices or cached data before doing work (`src/core/types.ts:72-88`).
  - Trace events such as `before_tool_execution` include `context`/`state`, so external supervisors can mutate or read it mid-run (`src/core/types.ts:190-216`).
- **Mutating safely:** `RunState.context` is typed as `Readonly`, but it points to whatever object you passed into the run. If you need immutability, clone before handing it to the engine. Otherwise, keep a mutable object (e.g., `{ toolHistory: [] }`) and push updates from hooks or tool code, then persist after the run finishes by grabbing `result.finalState.context`.
- **Example workflow:**
  1. Seed `context.toolHistory = []` before calling `runStream`.
  2. In `config.onEvent`, watch for `tool_call_end` and append `{ name, params, status }` to the history.
  3. Inside the next turn’s instructions, reference `state.context.toolHistory.slice(-3)` to remind the model what already ran.
  4. When `runStream` yields `run_end`, read `event.data.outcome.finalState.context` to persist or reuse elsewhere.

## 2. Managing the `messages` Array
- **Entire history is resent:** Every LLM call is rebuilt from scratch: system instructions + the whole `state.messages` array (`src/providers/model.ts:251-282`). The docs reiterate the same rule: “Conversation history = entire `state.messages` array; same structure each turn” (`docs/llm-prompting-and-turns.md:750-775`).
- **Why it matters:**
  - Tool outputs are surfaced as `role: 'tool'` entries (`src/providers/model.ts:287-313`), so the LLM always sees the exact JSON payload it produced earlier.
  - If you inject synthetic messages (e.g., reviewer commentary or user approval replies), add them to `state.messages` before the next turn so the LLM reasons over them automatically.
  - To trim history, preprocess `state.messages` yourself (e.g., keep only the last N) before invoking another run.
- **Pattern:** After a run finishes (or you stop mid-way), copy the returned `finalState.messages`, append any new user instructions, and call `run`/`runStream` again to continue with updated history.

## 3. Using Hooks with the Raw Engine
- **`config.onEvent`:** The core way to intercept execution. Pass it in the `RunConfig`; it receives every `TraceEvent` produced by the engine (`src/core/types.ts:406-430`).
- **`streamEventHandler`:** `runStream` allows a second handler for the streaming consumer. Events first go through `streamEventHandler`, then `config.onEvent`, and the handler’s return value is reused for "before" events (e.g., you can swap tool args) (`src/core/engine.ts:140-184`).
- **`onAfterToolExecution`:** Use this optional hook in `RunConfig` to inspect/modify tool results before they become conversation messages (memoization, reviewers, normalization) (`src/core/types.ts:406-430`).
- **Approval interruptions:** Mark tools with `needsApproval` and wire `approvalStorage`; the engine will emit interruptions you can surface to a human before resuming (`src/core/types.ts:72-88`, `src/core/types.ts:170-188`).

## 4. Trace Events Cheat Sheet (with ideas)
All events come from the `TraceEvent` union (`src/core/types.ts:190-216`). Here’s how to use them effectively:

| Event | Usage Idea |
| --- | --- |
| `run_start` / `run_end` | Spin up / tear down tracing spans; persist final context and tool history when `run_end` fires. |
| `turn_start` / `turn_end` | Monitor latency per turn; trigger planning/eval checkpoints aligned with LLM calls. |
| `llm_call_start` / `llm_call_end` | Log prompts/responses, capture token counts (`llm_call_end.usage`) to update budget dashboards. |
| `tool_requests` | Before tools execute, show pending calls in a UI for human approval or dedupe them against `context.toolHistory`. |
| `before_tool_execution` | Modify arguments (e.g., fill missing defaults, enforce deterministic casing) before the tool sees them. Returning a new args object from your handler replaces the payload. |
| `tool_call_start` / `tool_call_end` | Emit observability metrics; on `tool_call_end`, update caches or reviewers with `{ result, status, executionTime }`. |
| `tool_results_to_llm` | Record exactly what the LLM will read next (handy for debugging hallucinations). |
| `assistant_message` | Stream plain-language reasoning to clients without waiting for `llm_call_end`. |
| `handoff` / `handoff_denied` | Track multi-agent orchestrations; alert operators when transfers fail. |
| `guardrail_violation`, `decode_error`, `output_parse` | Escalate to fallback models or safe completions when policies trigger. |
| `token_usage` | Keep lightweight counters even when model provider responses omit detailed usage. |
| `memory_operation` | Audit long-running memories/conversations if you supply a `memory` config. |

Use `createSimpleEventHandler` to map these events into ergonomic callbacks without writing a giant switch (`src/core/types.ts:260-360`).

## 5. Tracing and Visibility
- **Trace collectors:** The docs provide ready-made collectors (console, in-memory, file) that consume `TraceEvent`s. See `docs/api-reference.md:900-980` for the event list, `TraceCollector` interface, and sample usage.
- **Streaming UI:** Because `runStream` yields events as they happen, you can pipe them directly to Server-Sent Events or WebSockets (same doc section, `docs/api-reference.md:921-944`).
- **Context snapshots:** `run_start`/`agent_processing` events include the current context and state snapshot (`src/core/types.ts:190-216`), so log them if you need after-the-fact audits of what the LLM actually knew at each turn.
- **Message reconstruction:** If you lose the in-memory state, you can rebuild it from `assistant_message` + `tool_results_to_llm` events because they mirror what was appended to `state.messages` each step.

## 6. Extra Tips for Agentic Systems on JAF
- **Plan/Act/Review loops:** Drive the loop yourself—JAF doesn’t auto-plan (`docs/llm-prompting-and-turns.md:750-793`). Store plan progress inside `context` and update it after every tool call so the next turn’s instructions describe remaining sub-goals.
- **Tool result normalization:** Enforce a fixed JSON envelope in each tool. If the tool returns a structured object, the engine converts it to a string before storing in messages (`src/core/engine.ts:1181-1285`); keep the format consistent so downstream reviewers can parse reliably.
- **Duplicate-call avoidance:** Maintain `{ name, params }` hashes in `context.toolHistory`. When the LLM proposes the same payload, use `before_tool_execution` or `needsApproval` to skip or warn instead of wasting money.
- **Parallel vs sequential tools:** The engine `Promise.all`s every tool call requested in a single assistant response (`src/core/engine.ts:993-1285`). If you need sequential dependencies, force the model to request them in separate turns so previous outputs are available first.
- **Human-in-the-loop:** Couple tool approvals with HITL prompts—emit a `tool_approval` interruption (`src/core/types.ts:170-188`), pause the run, collect user feedback, add it as a `user` message, and resume.
- **Persistence:** Always capture `finalState` from `RunResult`. That’s how you resume a run later (e.g., continue iteration i+1) or spawn a reviewer agent armed with the exact transcript that produced the last output.

Keep this checklist handy when you architect orchestrator/reviewer stacks directly on the engine—the more you lean on `context`, `messages`, and `TraceEvent`s, the easier it is to debug complex agent behavior.
