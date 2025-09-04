# Agents as Tools

Sometimes you want an agent to assist another agent for a focused task without handing off the whole conversation. In JAF you can wrap an existing agent as a tool using `agentAsTool`, then include that tool in another agent’s tool list.

This pattern enables agent-to-agent composition where the parent agent stays in control, while the sub‑agent runs as a callable tool that returns its output.

## Quick Start

```ts
import { Agent, agentAsTool } from '@xynehq/jaf';

// 1) Define a sub-agent
const summarizer: Agent<MyCtx, string> = {
  name: 'Summarizer',
  instructions: () => 'Generate a concise 2–3 sentence summary of the user input.'
};

// 2) Wrap it as a tool
const summarizeTool = agentAsTool<MyCtx, string>(summarizer, {
  toolName: 'summarize_text',
  toolDescription: 'Generate a concise summary of the supplied text.'
});

// 3) Use from a parent agent
const mainAgent: Agent<MyCtx, string> = {
  name: 'ResearchAssistant',
  instructions: () => 'Help the user. Use tools when appropriate.',
  tools: [summarizeTool]
};
```

From here, run your agent using either `run` (single-run) or `runServer` (HTTP server). When the model calls `summarize_text`, the sub-agent executes and returns a string back to the parent agent as a normal tool result.

## API

```ts
agentAsTool<Ctx, Out = any>(
  agent: Agent<Ctx, Out>,
  options?: {
    toolName?: string;
    toolDescription?: string;
    customOutputExtractor?: (output: Out, finalState: RunState<Ctx>) => string | Promise<string>;
    maxTurns?: number;               // default: 5
    registry?: ReadonlyMap<string, Agent<Ctx, any>>; // default: only the sub-agent
    propagateEvents?: 'summary' | 'all' | 'none';     // default: 'summary'
    memoryMode?: 'none' | 'inherit';                  // default: 'none'
  }
): Tool<{ input: string }, Ctx>
```

- toolName: Defaults to the sub-agent’s `name`.
- toolDescription: Human-readable guidance for the model on when to use the tool.
- customOutputExtractor: Convert the sub-agent’s final output to the string returned to the parent. Defaults to string or JSON-stringified value.
- maxTurns: Safety cap for the sub-run. Defaults to 5 to keep calls fast and bounded.
- registry: Agent registry to use inside the sub-run. Defaults to a registry containing only the wrapped agent. Provide a larger registry to allow sub-agent handoffs.
- propagateEvents: Controls which trace events from the sub-run are forwarded to the parent run’s `onEvent`.
  - summary: Forward run boundaries and final output (default)
  - all: Forward every event
  - none: Forward nothing
- memoryMode:
  - none (default): Sub-run does not read/write conversation memory
  - inherit: Use the same memory configuration as the parent run

## Behavior

- Parent control: The parent agent continues the conversation; the sub-agent is only invoked as a tool.
- Input shape: The tool has a single parameter `{ input: string }` and the sub-agent receives this as its sole `user` message.
- Context: The sub-run uses the same immutable context object as the parent run.
- Memory: By default (`memoryMode: 'none'`), the sub-run is isolated from memory. Set `inherit` to opt into parent memory usage.
- Turns: Sub-run is limited by `maxTurns` (default 5) to prevent long or recursive calls.
- Errors: Sub-run errors are returned to the parent as `ToolResult.error('EXECUTION_FAILED', ...)` and will be visible in tool traces.

## When to use vs. Handoffs

Use Agents as Tools when:
- You want a focused helper (e.g., summarizer, translator) that returns a value but does not take over the conversation.
- You want to avoid sharing the full conversation history with the helper.

Use Handoffs when:
- You want another agent to take over the conversation and receive the history.
- You want a long-running or multi-step delegation where the new agent becomes active.

Handoffs remain available via the `handoff_to_agent` tool and agent `handoffs` configuration.

## Tracing & Observability

- The sub-run shares the same `traceId` but a different `runId`.
- Events from the sub-run can be forwarded to the parent’s `onEvent` based on `propagateEvents`.
- Tool results include metadata (e.g., `childRunId`, `childAgent`, `turns`).

## Example (Server)

```ts
import 'dotenv/config';
import { runServer, makeLiteLLMProvider, ConsoleTraceCollector, agentAsTool, Agent } from '@xynehq/jaf';

type Ctx = { userId: string; permissions: string[] };

const summarizer: Agent<Ctx, string> = {
  name: 'Summarizer',
  instructions: () => 'Summarize the user input in 2-3 sentences.'
};

const summarizeTool = agentAsTool<Ctx, string>(summarizer, {
  toolName: 'summarize_text',
  toolDescription: 'Summarize the supplied text.'
});

const mainAgent: Agent<Ctx, string> = {
  name: 'MainAgent',
  instructions: () => 'Answer the user; call summarize_text when asked to summarize.',
  tools: [summarizeTool]
};

const modelProvider = makeLiteLLMProvider(process.env.LITELLM_URL!, process.env.LITELLM_API_KEY!);
const traces = new ConsoleTraceCollector();

await runServer<Ctx>([mainAgent], {
  modelProvider,
  modelOverride: process.env.LITELLM_MODEL || 'gpt-4o-mini',
  maxTurns: 8,
  onEvent: traces.collect.bind(traces),
});
```

Send a chat request to the server and the model will call `summarize_text` as needed; the result is returned to the parent agent and the conversation continues.

## Tips

- Keep sub-run `maxTurns` low for speed and cost control.
- For structured sub-agent outputs, add an `outputCodec` on the sub-agent and provide a `customOutputExtractor` to pick the fields you need.
- If the sub-agent needs its own tools or handoffs, pass a `registry` containing all required agents.
- To avoid recursion between agents, keep track of call depth in your context or add usage guardrails.

