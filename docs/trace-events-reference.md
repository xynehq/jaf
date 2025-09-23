# JAF Trace Event Reference

This reference summarizes every trace/streaming event emitted from `src/core/engine.ts`. Events are delivered through the `onEvent` callback and the `runStream` async generator.

## Quick Reference

| Event | Trigger | Highlights |
| --- | --- | --- |
| `run_start` | Beginning of `run()` | Includes run/trace IDs, initial context, first message set |
| `llm_call_start` | Immediately before calling model provider | Full request context: agent, model, messages, tool schemas |
| `llm_call_end` | After model provider returns | Attaches raw provider response, prompt echo, token usage snapshot |
| `token_usage` | When the model response exposes usage numbers | Normalized token counts keyed by phase + model name |
| `assistant_message` | Whenever assistant output is available | Streams partial outputs during SSE; final message emitted if no stream |
| `tool_requests` | When tool calls are requested or resumed | Parsed arguments per call; fired for fresh and resumed calls |
| `tool_call_start` | Before each tool execution | Carries parsed args, tool schema metadata, agent + trace context |
| `tool_call_end` | After each tool execution finishes or errors | Includes serialized result, optional ToolResult payload, timing + error data |
| `tool_results_to_llm` | When tool outputs are appended to the transcript | Provides tool messages batched for next LLM turn |
| `handoff` | Tool signals `handoff_to` another agent and is allowed | Names current agent and destination agent |
| `handoff_denied` | Tool attempts handoff to disallowed agent | Adds rejection reason |
| `guardrail_violation` | Input/output guardrail fails | Specifies stage (`input`/`output`) and reason |
| `decode_error` | Agent output codec fails to parse LLM content | Emits zod issues from the failed parse |
| `turn_start` | Start of each agent turn (before LLM call) | 1-based turn counter + agent name |
| `turn_end` | End of turn (on completion, error, or handoff) | Same turn counter + agent name |
| `final_output` | Just before returning a successful result | Emits decoded or raw final output payload |
| `run_end` | Terminal event for `run()` | Contains `RunResult.outcome` (completed / interrupted / error) |

## Event Payloads and Semantics

### `run_start`
- **Emitted from:** Top of `run()` before any work is performed.
- **When:** Immediately after entering the engine with the supplied `initialState`.
- **Payload:**
  - `runId`: Unique run identifier from state.
  - `traceId`: Correlation ID for downstream events.
  - `context`: The full runtime context object.
  - `userId`: Convenience copy of `context.userId` (if present).
  - `sessionId`: `context.sessionId` or `context.conversationId` fallback.
  - `messages`: Initial conversation history array.
- **Notes:** If memory loading is enabled, this fires *before* any history is merged in, so collectors can see the raw starting point.

### `llm_call_start`
- **Emitted from:** `runInternal()` prior to invoking the model provider.
- **When:** After guardrails pass and the current agent is resolved.
- **Payload:**
  - `agentName`: Name of the agent making the request.
  - `model`: Selected model name (honors `config.modelOverride`).
  - `traceId`, `runId`: Identifiers for correlation.
  - `messages`: Full message list passed to the provider.
  - `tools`: Array of tool schemas (name, description, parameters) available to the model.
  - `modelConfig`: Agent model configuration plus any override metadata.
  - `turnCount`: Prior turn count (0-based before increment).
  - `context`: Current execution context forwarded to the provider.
- **Notes:** Mirrors exactly what the provider receives, enabling request replay/debugging.

### `llm_call_end`
- **Emitted from:** `runInternal()` after the provider yields a response (streaming or standard).
- **Payload:**
  - `choice`: Alias of the full provider response.
  - `fullResponse`: Same as `choice` (maintained for compatibility).
  - `prompt`: Provider echo of the prompt request when available.
  - `traceId`, `runId`, `agentName`, `model`.
  - `usage`: Optional token usage snapshot `{ prompt_tokens, completion_tokens, total_tokens }` when present on the provider response.
- **Notes:** Fires even if the model result is malformed; downstream logic uses it before throwing errors.

### `token_usage`
- **Emitted from:** `runInternal()` immediately after `llm_call_end`.
- **When:** Only if the provider response exposes token counts.
- **Payload:**
  - `prompt`, `completion`, `total`: Token counts by phase.
  - `model`: Model name associated with the counts.
- **Notes:** Provides a stable shape regardless of provider-specific field names.

### `assistant_message`
- **Emitted from:**
  - Streaming loop inside `runInternal()` for each delta chunk.
  - After `llm_call_end` when streaming is unavailable or fails.
- **Payload:**
  - `message`: Standard assistant `Message` object containing the aggregated text and any tool call descriptors gathered so far.
- **Notes:**
  - During streaming, multiple incremental events fire with growing `message.content` and evolving `tool_calls` entries.
  - When streaming is not used, a single event fires with the final assistant message.
  - Collectors should treat later payloads as supersets of earlier ones.

### `tool_requests`
- **Emitted from:**
  - `runInternal()` after an assistant message includes `tool_calls`.
  - `tryResumePendingToolCalls()` when resuming previously requested tools.
- **Payload:**
  - `toolCalls`: Array of `{ id, name, args }` where `args` is JSON-parsed when possible, otherwise the raw string.
- **Notes:** Useful for approval workflows and tool auditing before execution begins.

### `tool_call_start`
- **Emitted from:** `executeToolCalls()` before invoking each tool.
- **Payload:**
  - `toolName`, `args`: Tool identifier and parsed arguments.
  - `traceId`, `runId`, `agentName`.
  - `toolSchema`: Optional metadata (`name`, `description`, `parameters`) when the tool definition is found.
  - `context`: Current run context.
  - `executionTime` is *not* present here (only on `tool_call_end`).
- **Notes:** Fires even if the tool cannot be found; the subsequent `tool_call_end` will carry the failure details.

### `tool_call_end`
- **Emitted from:** `executeToolCalls()` after tool completion or failure.
- **Payload:**
  - `toolName`, `result`: Serialized string result that is appended to the transcript.
  - `traceId`, `runId`.
  - `toolResult`: Original ToolResult object when the tool used the ToolResult API; otherwise `undefined`.
  - `status`: `'success'`, `'error'`, or a ToolResult-specific status value.
  - `executionTime`: Milliseconds taken by the tool call.
  - `metadata`: Diagnostic bundle including `agentName`, `parsedArgs`, `context`, and `resultType` (`'string'` or `'object'`).
  - `error`: Present when execution fails or the tool is missing/invalid, including `type`, `message`, and optional `details`/`stack`.
- **Notes:** Always fires, even on validation errors or missing tools, ensuring collectors can log end states symmetrically with starts.

### `tool_results_to_llm`
- **Emitted from:**
  - `runInternal()` after successful tool executions.
  - `tryResumePendingToolCalls()` when pending tool calls are resumed and executed.
- **Payload:**
  - `results`: Array of tool `Message` objects that are appended to the conversation before the next LLM turn.
- **Notes:** Signals what the next LLM invocation will see; useful for replaying agent transcripts.

### `handoff`
- **Emitted from:** `runInternal()` when a tool result includes `handoff_to` and the target agent is permitted.
- **Payload:**
  - `from`: Current agent name.
  - `to`: Target agent name.
- **Notes:** Fired before the engine switches `currentAgentName` and continues the run with the new agent.

### `handoff_denied`
- **Emitted from:** `runInternal()` when a tool returns `handoff_to` but the current agent is not allowed to hand off to that target.
- **Payload:**
  - `from`, `to`: Agent names.
  - `reason`: Human-readable explanation of the denial.
- **Notes:** The run transitions into an error outcome after this event.

### `guardrail_violation`
- **Emitted from:** Guardrail checks in `runInternal()`.
- **When:**
  - Stage `'input'`: Initial user message fails `initialInputGuardrails` before the first turn.
  - Stage `'output'`: Final output fails `finalOutputGuardrails`.
- **Payload:**
  - `stage`: `'input' | 'output'`.
  - `reason`: Message supplied by the failing guardrail.
- **Notes:** Immediately followed by error termination for the current run.

### `decode_error`
- **Emitted from:** `runInternal()` when an agent `outputCodec` cannot parse the assistant response.
- **Payload:**
  - `errors`: Array of `z.ZodIssue` objects from the failed `safeParse`.
- **Notes:** Leads directly to an error outcome; no `final_output` event follows.

### `turn_start`
- **Emitted from:** `runInternal()` right before each LLM invocation.
- **Payload:**
  - `turn`: 1-based turn number (incremented before emission).
  - `agentName`: Agent executing the turn.
- **Notes:** Fires even for turns that later end with errors or interruptions.

### `turn_end`
- **Emitted from:** Multiple points in `runInternal()` whenever a turn concludes.
- **When:** After tool processing, guardrail failures, decode errors, or final result generation.
- **Payload:**
  - `turn`: Same 1-based counter as the matching `turn_start`.
  - `agentName`: Agent that just completed the turn.
- **Notes:** May fire multiple times per run; always paired with a prior `turn_start`.

### `final_output`
- **Emitted from:** `runInternal()` just before returning a successful `RunResult`.
- **Payload:**
  - `output`: Parsed value from the agent (codec result or raw string content).
- **Notes:** Only emitted on completed runs; skipped for interruptions and errors.

### `run_end`
- **Emitted from:**
  - Normal completion path in `run()`.
  - Error catch block in `run()` if an exception escapes.
- **Payload:**
  - `outcome`: The `RunResult['outcome']` object (`completed`, `interrupted`, or `error`).
  - `traceId`, `runId`.
- **Notes:** Guaranteed final event for every run, even when upstream execution throws synchronously.

## Related Events

While not part of the requested list, `engine.ts` also emits an `agent_processing` event before each turn with extended diagnostic data (message stats, model config, available tools, handoff options). Collectors that need richer telemetry can subscribe to it alongside the events above.

## Streaming Considerations

- The `runStream()` helper wraps `run()` and emits the same `TraceEvent` payloads through an async iterator, making it suitable for Server-Sent Events or WebSockets.
- Events are pushed in the order they occur; consumers should handle multiple `assistant_message` events per turn and rely on `turn_end`/`run_end` to detect completion.

