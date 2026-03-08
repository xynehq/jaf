
<result>
# Main Loop Explanation: LLM Interaction and Tool Execution in JAF

I found the main loop in **`src/core/engine.ts`**. Here's how it works:

## **Core Architecture**

### **1. Entry Point: `run()` function**
- Initializes the run with event tracking (`run_start`)
- Loads conversation history from memory if configured
- Calls the internal recursive loop `runInternal()`
- Stores conversation history on completion
- Emits `run_end` event

### **2. Main Loop: `runInternal()` function**

This is the **heart of the system** - a recursive function that implements the agentic loop:

```
┌─────────────────────────────────────────────────────┐
│                  START runInternal()                │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
         ┌─────────────────────┐
         │ Check max turns     │
         │ Get current agent   │
         └─────────┬───────────┘
                   │
                   ▼
         ┌─────────────────────┐
         │ Run input guardrails│  (on turn 0)
         └─────────┬───────────┘
                   │
                   ▼
         ┌─────────────────────┐
         │ Call LLM            │  ← MODEL PROVIDER
         │ (streaming/non)     │
         └─────────┬───────────┘
                   │
                   ▼
         ┌─────────────────────┐
         │ Process response    │
         └─────────┬───────────┘
                   │
         ┌─────────┴──────────┐
         │                    │
         ▼                    ▼
    Has tool_calls?      Has content?
         │                    │
         ▼                    ▼
  ┌──────────────┐    ┌──────────────┐
  │Execute tools │    │Parse output  │
  │(parallel)    │    │Run guardrails│
  └──────┬───────┘    └──────┬───────┘
         │                   │
         ▼                   ▼
  ┌──────────────┐    ┌──────────────┐
  │Check for:    │    │Return final  │
  │- Interrupts  │    │result        │
  │- Handoffs    │    │(COMPLETED)   │
  └──────┬───────┘    └──────────────┘
         │
         ▼
  Add tool results
  to messages
         │
         ▼
  ┌──────────────┐
  │RECURSIVE CALL│  ← LOOP BACK
  │runInternal() │
  └──────────────┘
```

### **3. Tool Execution: `executeToolCalls()` function**

When the LLM requests tools, this happens in parallel:

**For each tool call:**

1. **Before Execution Events**
   - Emit `before_tool_execution` event (can modify args!)
   - Emit `tool_call_start` event

2. **Validation**
   - Find tool in agent's tool list
   - Parse and validate arguments using Zod schema
   - Check if tool needs approval

3. **Approval Handling**
   - If needs approval and not approved → return interruption
   - If rejected → return rejection message
   - If approved → proceed with additional context

4. **Execution**
   - Execute tool with parsed args + context
   - Apply `onAfterToolExecution` callback if configured

5. **Post-Execution**
   - Emit `tool_call_end` event
   - Check for handoff (special tool result)
   - Format result as tool message

6. **Error Handling**
   - Tool not found
   - Validation errors
   - Execution errors
   - All wrapped in structured JSON responses

### **4. Key Flow Patterns**

**Pattern 1: Tool Loop**
```
User message → LLM → Tool calls → Execute tools → 
Add results to messages → LLM (again) → ...
```

**Pattern 2: Completion**
```
User message → LLM → Content with outputCodec → 
Validate & parse → Return result
```

**Pattern 3: Handoff**
```
Tool execution returns handoff → Switch agent → 
Continue with new agent (recursive call)
```

**Pattern 4: Interruption**
```
Tool needs approval → Return interruption → 
Resume later with approval status
```

### **5. Important Features**

- **Turn Counting**: Prevents infinite loops (default max: 50 turns)
- **Streaming Support**: `runStream()` wraps `run()` with async generator
- **Event System**: 15+ event types for observability
- **Guardrails**: Input (turn 0) and output validation
- **Memory**: Auto-load/store conversation history
- **Approval Flow**: HITL (Human-in-the-Loop) for sensitive tools
- **Token Tracking**: Usage metrics via events
- **Error Recovery**: Resume pending tool calls after interruption

### **6. State Management**

Each iteration carries:
- `messages`: Full conversation history
- `turnCount`: Number of LLM calls
- `currentAgentName`: Active agent
- `approvals`: Map of tool approval statuses
- `context`: User-defined context object
- `runId` & `traceId`: For tracking

### **7. The Recursive Nature**

The loop is **recursive** rather than iterative:
- After tool execution, it calls `runInternal()` again
- This allows natural backtracking and state updates
- Each recursive call has updated messages array
- Handoffs work naturally by changing agent name

This design makes JAF a powerful **agentic framework** where the LLM can iteratively use tools, hand off between specialized agents, and maintain conversation context across multiple turns until it produces a final structured output.
</result>
<task_progress>
- [x] Examine src/core/engine.ts for the main loop
- [x] Identify tool execution logic
- [x] Identify LLM interaction logic
- [x] Explain the flow and architecture
</task_progress>
</attempt_completion>

---

**User:**

[TASK RESUMPTION] This task was interrupted 10 minutes ago. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '/Users/aayush.shah/Desktop/projects/jaf'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.

Note: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.
New instructions for task continuation:
<user_message>
explain how handoff works so for a main agent we will have multiple tools and subagents .. at the same hierarchy ? we select if tools are useful or an agent at a particular point ... ?
handoff is a tool ?
what happens when we save a sub agent having a sub agent ?
Explain
</user_message>

# TODO LIST RECOMMENDED

When starting a new task, it is recommended to create a todo list.


1. Include the task_progress parameter in your next tool call
2. Create a comprehensive checklist of all steps needed
3. Use markdown format: - [ ] for incomplete, - [x] for complete

**Benefits of creating a todo list now:**
	- Clear roadmap for implementation
	- Progress tracking throughout the task
	- Nothing gets forgotten or missed
	- Users can see, monitor, and edit the plan

**Example structure:**```
- [ ] Analyze requirements
- [ ] Set up necessary files
- [ ] Implement main functionality
- [ ] Handle edge cases
- [ ] Test the implementation
- [ ] Verify results```

Keeping the todo list updated helps track progress and ensures nothing is missed.

**Assistant:**


I'll help you understand how handoffs work in JAF. Let me examine the relevant code to explain the architecture.

<read_file>
<path>src/core/types.ts</path>
<task_progress>
- [ ] Examine Agent type definition and handoff structure
- [ ] Look at agent-as-tool implementation
- [ ] Check handoff examples
- [ ] Explain the handoff mechanism and hierarchy
</task_progress>
</read_file>

---

/**
 * Comprehensive trace event system with discriminated unions
 * All events follow the pattern: { type: string, data: {...properties} }
 */
export type TraceEvent =
  | { type: 'run_start'; data: { runId: RunId; traceId: TraceId; context?: any; userId?: string; sessionId?: string; messages?: readonly Message[]; } }
  | { type: 'turn_start'; data: { turn: number; agentName: string } }
  | { type: 'llm_call_start'; data: { agentName: string; model: string; traceId: TraceId; runId: RunId; messages?: readonly Message[]; tools?: any[]; modelConfig?: any; turnCount?: number; context?: any; } }
  | { type: 'llm_call_end'; data: { choice: any; fullResponse?: any; prompt?: any; traceId: TraceId; runId: RunId; agentName?: string; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; }; estimatedCost?: { promptCost: number; completionCost: number; totalCost: number; }; } }
  | { type: 'token_usage'; data: { prompt?: number; completion?: number; total?: number; model?: string } }
  | { type: 'before_tool_execution'; data: { toolName: string; args: any; toolCall: ToolCall; traceId: TraceId; runId: RunId; toolSchema?: any; context?: any; state?: any; agentName?: string; } }
  | { type: 'tool_call_start'; data: { toolName: string; args: any; traceId: TraceId; runId: RunId; toolSchema?: any; context?: any; agentName?: string; } }
  | { type: 'tool_call_end'; data: { toolName: string; result: string; toolResult?: any; status?: string; traceId: TraceId; runId: RunId; executionTime?: number; error?: any; metadata?: any; } }
  | { type: 'agent_processing'; data: { agentName: string; traceId: TraceId; runId: RunId; turnCount: number; messageCount: number; toolsAvailable: Array<{ name: string; description: string }>; handoffsAvailable: readonly string[]; modelConfig?: any; hasOutputCodec: boolean; context: any; currentState: any; } }
  | { type: 'handoff'; data: { from: string; to: string; } }
  | { type: 'tool_requests'; data: { toolCalls: Array<{ id: string; name: string; args: any }>; } }
  | { type: 'tool_results_to_llm'; data: { results: Message[] } }
  | { type: 'assistant_message'; data: { message: Message } }
  | { type: 'final_output'; data: { output: any } }
  | { type: 'handoff_denied'; data: { from: string; to: string; reason: string } }
  | { type: 'guardrail_violation'; data: { stage: 'input' | 'output'; reason: string } }
  | { type: 'guardrail_check'; data: { guardrailName: string; content: any; isValid?: boolean; errorMessage?: string; } }
  | { type: 'memory_operation'; data: { operation: 'load' | 'store'; conversationId: string; status: 'start' | 'end' | 'fail'; error?: string; messageCount?: number; } }
  | { type: 'output_parse'; data: { content: string; status: 'start' | 'end' | 'fail'; parsedOutput?: any; error?: string; } }
  | { type: 'decode_error'; data: { errors: z.ZodIssue[] } }
  | { type: 'turn_end'; data: { turn: number; agentName: string } }
  | { type: 'run_end'; data: { outcome: RunResult<any>['outcome']; traceId: TraceId; runId: RunId; } };

/**
 * Helper type to extract event data by event type
 * @example EventData<'llm_call_end'> -> { choice: any, fullResponse?: any, ... }
 */
export type EventData<T extends TraceEvent['type']> = Extract<TraceEvent, { type: T }>['data'];

/**
 * Token usage information from LLM calls
 */
export type TokenUsage = {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
};

/**
 * Cost estimation for LLM calls
 */
export type CostEstimate = {
  readonly promptCost: number;
  readonly completionCost: number;
  readonly totalCost: number;
};

/**
 * Simplified event handler interface for common use cases
 * This provides an alternative to handling raw TraceEvent discriminated unions
 *
 * @example
 * ```typescript
 * const handler = createSimpleEventHandler({
 *   onAssistantMessage: (content, thinking) => {
 *     console.log('Assistant:', content);
 *   },
 *   onToolCalls: (calls) => {
 *     console.log('Tools requested:', calls.map(c => c.name));
 *   },
 *   onToolResult: (toolName, result) => {
 *     console.log(`${toolName} completed:`, result);
 *   }
 * });
 * ```
 */
export type SimpleEventHandlers = {
  /** Called when assistant generates a message */
  onAssistantMessage?: (content: string, thinking?: string) => void;

  /** Called when tool calls are requested */
  onToolCalls?: (toolCalls: Array<{ id: string; name: string; args: any }>) => void;

  /** Called when a tool execution completes */
  onToolResult?: (toolName: string, result: string, error?: any) => void;

  /** Called when an error occurs */
  onError?: (error: any, context?: any) => void;

  /** Called when run starts */
  onRunStart?: (runId: RunId, traceId: TraceId) => void;

  /** Called when run ends */
  onRunEnd?: (outcome: RunResult<any>['outcome']) => void;

  /** Called on token usage updates */
  onTokenUsage?: (usage: TokenUsage) => void;

  /** Called when agent hands off to another agent */
  onHandoff?: (from: string, to: string) => void;
};

/**
 * Create a TraceEvent handler from simple event handlers
 * Converts the simplified handler API to a full TraceEvent handler
 *
 * @param handlers - Object with optional event handler callbacks
 * @returns A function that handles TraceEvent discriminated unions
 *
 * @example
 * ```typescript
 * const config: RunConfig<MyContext> = {
 *   // ... other config
 *   onEvent: createSimpleEventHandler({
 *     onAssistantMessage: (content) => console.log(content),
 *     onToolCalls: (calls) => console.log('Tools:', calls),
 *   })
 * };
 * ```
 */
export function createSimpleEventHandler(handlers: SimpleEventHandlers): (event: TraceEvent) => void {
  return (event: TraceEvent) => {
    switch (event.type) {
      case 'run_start':
        handlers.onRunStart?.(event.data.runId, event.data.traceId);
        break;

      case 'run_end':
        handlers.onRunEnd?.(event.data.outcome);
        break;

      case 'assistant_message':
        if (event.data.message.role === 'assistant') {
          const content = getTextContent(event.data.message.content);
          handlers.onAssistantMessage?.(content);
        }
        break;

      case 'llm_call_end':
        // Extract assistant message from LLM response
        if (event.data.choice?.message) {
          const content = getTextContent(event.data.choice.message.content || '');
          if (content) {
            handlers.onAssistantMessage?.(content);
          }
        }
        // Handle token usage
        if (event.data.usage) {
          handlers.onTokenUsage?.(event.data.usage);
        }
        break;

      case 'tool_requests':
        handlers.onToolCalls?.(event.data.toolCalls);
        break;

      case 'tool_call_end':
        handlers.onToolResult?.(
          event.data.toolName,
          event.data.result,
          event.data.error
        );
        break;

      case 'handoff':
        handlers.onHandoff?.(event.data.from, event.data.to);
        break;

      case 'token_usage':
        if (event.data.total || event.data.prompt || event.data.completion) {
          handlers.onTokenUsage?.({
            prompt_tokens: event.data.prompt,
            completion_tokens: event.data.completion,
            total_tokens: event.data.total,
          });
        }
        break;

      case 'decode_error':
      case 'guardrail_violation':
        handlers.onError?.(event.data);
        break;
    }
  };
}

export type CompletionStreamChunk = {
  readonly delta?: string;
  readonly toolCallDelta?: {
    readonly index: number;
    readonly id?: string;
    readonly type: 'function';
    readonly function?: {
      readonly name?: string;
      readonly argumentsDelta?: string;
    };
  };
  readonly isDone?: boolean;
  readonly finishReason?: string | null;
  readonly raw?: any;
};

export interface ModelProvider<Ctx> {
  isAiSdkProvider?: boolean;
  getCompletion: (
    state: Readonly<RunState<Ctx>>,
    agent: Readonly<Agent<Ctx, any>>,
    config: Readonly<RunConfig<Ctx>>
  ) => Promise<{
    message?: {
      content?: string | null;
      tool_calls?: readonly ToolCall[];
    };
  }>;
  getCompletionStream?: (
    state: Readonly<RunState<Ctx>>,
    agent: Readonly<Agent<Ctx, any>>,
    config: Readonly<RunConfig<Ctx>>
  ) => AsyncGenerator<CompletionStreamChunk, void, unknown>;
}

export type RunConfig<Ctx> = {
  readonly agentRegistry: ReadonlyMap<string, Agent<Ctx, any>>;
  readonly modelProvider: ModelProvider<Ctx>;
  readonly maxTurns?: number;
  readonly modelOverride?: string;
  readonly initialInputGuardrails?: readonly Guardrail<string>[];
  readonly finalOutputGuardrails?: readonly Guardrail<any>[];
  readonly onEvent?: (event: TraceEvent) => void | any | Promise<void | any>;
  readonly onAfterToolExecution?: (
    toolName: string,
    result: string | import('./tool-results').ToolResult,
    context: {
      toolCall: ToolCall;
      args: any;
      state: RunState<Ctx>;
      agentName: string;
      executionTime: number;
      status: string | import('./tool-results').ToolResult;
    }
  ) => Promise<string|  import('./tool-results').ToolResult | null> ;
  readonly memory?: MemoryConfig;
  readonly conversationId?: string;
  readonly approvalStorage?: ApprovalStorage;
  readonly defaultFastModel?: string;
};

export const jsonParseLLMOutput = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};


<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 11:57:34 AM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
36,278 / 200K tokens used (18%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<read_file>
<path>src/tools/agent-as-tool.ts</path>
<task_progress>
- [x] Examine Agent type definition and handoff structure
- [ ] Look at agent-as-tool implementation
- [ ] Check handoff examples
- [ ] Explain the handoff mechanism and hierarchy
</task_progress>
</read_file>

---

**User:**

[read_file for 'src/tools/agent-as-tool.ts'] Result:
The tool execution failed with the following error:
<error>
Error executing read_file: File not found: /Users/aayush.shah/Desktop/projects/jaf/src/tools/agent-as-tool.ts
</error>
<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 11:57:42 AM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
41,522 / 200K tokens used (21%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<list_files>
<path>src/tools</path>
<recursive>false</recursive>
<task_progress>
- [x] Examine Agent type definition and handoff structure
- [ ] Look at agent-as-tool implementation
- [ ] Check handoff examples
- [ ] Explain the handoff mechanism and hierarchy
</task_progress>
</list_files>

---

**User:**

[list_files for 'src/tools'] Result:
index.ts
math.ts
<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 11:57:48 AM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
41,878 / 200K tokens used (21%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<read_file>
<path>examples/agent-as-tool-demo/index.ts</path>
<task_progress>
- [x] Examine Agent type definition and handoff structure
- [ ] Look at agent-as-tool implementation
- [ ] Check handoff examples
- [ ] Explain the handoff mechanism and hierarchy
</task_progress>
</read_file>

---

**User:**

[read_file for 'examples/agent-as-tool-demo/index.ts'] Result:
import 'dotenv/config';
import {
  runServer,
  ConsoleTraceCollector,
  makeLiteLLMProvider,
  Agent,
  agentAsTool,
  createMemoryProviderFromEnv,
} from '@xynehq/jaf';

type AppContext = {
  userId: string;
  permissions: string[];
};

// Sub-agent that summarizes input text
const summarizerAgent: Agent<AppContext, string> = {
  name: 'Summarizer',
  instructions: () =>
    [
      'You are a precise summarization assistant.',
      'Summarize the supplied text concisely in 2-3 sentences.',
      'Do not add commentary. Output only the summary.',
    ].join(' '),
  // No outputCodec: we want free-form text output
  modelConfig: {
    name: process.env.LITELLM_MODEL || 'gpt-4o-mini',
    temperature: 0.2,
  },
};

// Wrap as a tool consumable by other agents
const summarizeTool = agentAsTool<AppContext, string>(summarizerAgent, {
  toolName: 'summarize_text',
  toolDescription: 'Generate a concise summary of the supplied text.',
  // Keep a conservative turn cap for the child run
  maxTurns: 4,
});

// Parent agent that can decide to use the summarizer tool
const mainAgent: Agent<AppContext, string> = {
  name: 'MainAgent',
  instructions: () =>
    [
      'You are a research assistant. You can use tools to help you.',
      'When asked to summarize or condense text, call the summarize_text tool with the full text.',
      'Otherwise, respond directly.',
    ].join(' '),
  tools: [summarizeTool],
  modelConfig: {
    name: process.env.LITELLM_MODEL || 'gpt-4o-mini',
    temperature: 0.3,
  },
};

async function startServer() {
  console.log('🚀 Starting JAF Agents-as-Tools Server Demo...\n');

  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000';
  const litellmApiKey = process.env.LITELLM_API_KEY;

  console.log(`📡 LiteLLM URL: ${litellmUrl}`);
  console.log(`🔑 API Key: ${litellmApiKey ? 'Set' : 'Not set'}`);
  console.log(`⚠️  Note: Chat endpoints will fail without a running LiteLLM server\n`);

  const modelProvider = makeLiteLLMProvider<AppContext>(litellmUrl, litellmApiKey);
  const traceCollector = new ConsoleTraceCollector();

  // Memory provider from env (defaults to in-memory)
  const memoryProvider = await createMemoryProviderFromEnv();

  const server = await runServer<AppContext>(
    [mainAgent],
    {
      modelProvider,
      maxTurns: 8,
      modelOverride: process.env.LITELLM_MODEL || 'gpt-4o-mini',
      onEvent: traceCollector.collect.bind(traceCollector),
      memory: {
        provider: memoryProvider,
        autoStore: true,
        maxMessages: 100,
      },
    },
    {
      port: parseInt(process.env.PORT || '3000'),
      host: '127.0.0.1',
      cors: false,
      defaultMemoryProvider: memoryProvider,
    }
  );

  console.log('\n✅ Server started! Try these requests:\n');
  console.log('1) Simple chat with MainAgent (will call summarize_text tool):');
  console.log('   curl -X POST http://localhost:3000/agents/MainAgent/chat \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"messages":[{"role":"user","content":"Summarize: JAF is a framework for agents with immutable state and strong tooling"}],"conversationId":"agent-tool-demo-1","context":{"userId":"demo","permissions":["user"]}}\'');
  console.log('');
  console.log('2) Use /chat with explicit agentName:');
  console.log('   curl -X POST http://localhost:3000/chat \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"messages":[{"role":"user","content":"Please summarize this: Agents can be composed as tools."}],"agentName":"MainAgent","conversationId":"agent-tool-demo-2","context":{"userId":"demo","permissions":["user"]}}\'');

  const gracefulShutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}, shutting down...`);
    await server.stop();
    console.log('✅ Shutdown complete');
    process.exit(0);
  };
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  });
}

<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 11:57:54 AM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
42,288 / 200K tokens used (21%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<search_files>
<path>src</path>
<regex>agentAsTool</regex>
<file_pattern>*.ts</file_pattern>
<task_progress>
- [x] Examine Agent type definition and handoff structure
- [ ] Look at agent-as-tool implementation
- [ ] Check handoff examples
- [ ] Explain the handoff mechanism and hierarchy
</task_progress>
</search_files>

---

**User:**

[search_files for 'agentAsTool' in '*.ts'] Result:
Found 4 results.

src/__tests__/agent-as-tool.test.ts
│----
│  agentAsTool,
│  getTextContent
│
│----
│  const summarizeTool = agentAsTool<Ctx, string>(summarizer, {
│    toolName: 'summarize_text',
│  test('respects customOutputExtractor', async () => {
│----
│ */
│    const extractedTool = agentAsTool<Ctx, string>(summarizer, {
│      toolName: 'summarize_text_custom',
│----

src/core/agent-as-tool.ts
│----
│export function agentAsTool<Ctx, Out = any>(
│  childAgent: Agent<Ctx, Out>,
│----
<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 11:58:01 AM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
44,039 / 200K tokens used (22%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<read_file>
<path>src/core/agent-as-tool.ts</path>
<task_progress>
- [x] Examine Agent type definition and handoff structure
- [x] Look at agent-as-tool implementation
- [ ] Check handoff examples
- [ ] Explain the handoff mechanism and hierarchy
</task_progress>
</read_file>

---

**User:**

[read_file for 'src/core/agent-as-tool.ts'] Result:
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { run } from './engine.js';
import {
  Agent,
  RunConfig,
  RunResult,
  RunState,
  Tool,
  createRunId,
} from './types.js';
import { ToolResponse, ToolResult } from './tool-results.js';
import { getToolRuntime } from './tool-runtime.js';

type AgentAsToolOptions<Ctx, Out> = {
  readonly toolName?: string;
  readonly toolDescription?: string;
  readonly customOutputExtractor?: (output: Out, finalState: RunState<Ctx>) => string | Promise<string>;
  readonly maxTurns?: number; // default 5
  readonly registry?: ReadonlyMap<string, Agent<Ctx, any>>; // default: only child agent
  readonly propagateEvents?: 'summary' | 'all' | 'none'; // default summary
  readonly memoryMode?: 'none' | 'inherit'; // default none
};

/**
 * Wrap an Agent as a Tool so it can be invoked by another agent.
 * The child agent runs in an isolated sub-run, receives only the input text,
 * and returns its final output as a string (or via custom extractor).
 */
export function agentAsTool<Ctx, Out = any>(
  childAgent: Agent<Ctx, Out>,
  options: AgentAsToolOptions<Ctx, Out> = {}
): Tool<{ input: string }, Ctx> {
  const {
    toolName = childAgent.name,
    toolDescription = `Run the '${childAgent.name}' agent on the supplied input and return its result`,
    customOutputExtractor,
    maxTurns = 5,
    registry,
    propagateEvents = 'summary',
    memoryMode = 'none',
  } = options;

  const paramsSchema = z.object({
    input: z.string().describe('Input text passed to the sub-agent as a user message')
  });

  return {
    schema: {
      name: toolName,
      description: toolDescription,
      parameters: paramsSchema,
    },
    execute: async (args, context): Promise<string | ToolResult> => {
      // Retrieve current runtime (state + config) from engine bridge
      const runtime = getToolRuntime(context);
      if (!runtime) {
        return ToolResponse.error(
          'EXECUTION_FAILED',
          'Agent tool cannot access runtime. Ensure engine installs tool runtime before execution.'
        );
      }

      const parentState = runtime.state as RunState<Ctx>;
      const parentConfig = runtime.config as RunConfig<Ctx>;

      // Build child run state: new runId, same traceId, single user message
      const childState: RunState<Ctx> = {
        runId: createRunId(uuidv4()),
        traceId: parentState.traceId,
        messages: [
          { role: 'user', content: args.input }
        ],
        currentAgentName: childAgent.name,
        context: parentState.context,
        turnCount: 0,
        approvals: new Map(),
      };

      // Build child config derived from parent
      const childRegistry: ReadonlyMap<string, Agent<Ctx, any>> = registry ?? new Map([[childAgent.name, childAgent]]);

      const childConfig: RunConfig<Ctx> = {
        ...parentConfig,
        agentRegistry: childRegistry,
        maxTurns,
        // Memory isolation by default
        ...(memoryMode === 'none' ? { memory: undefined, conversationId: undefined } : {}),
        onEvent: (event) => {
          if (propagateEvents === 'all') {
            parentConfig.onEvent?.(event);
          } else if (propagateEvents === 'summary') {
            // For summary, we still forward important boundaries
            if (event.type === 'run_start' || event.type === 'run_end' || event.type === 'final_output' || event.type === 'handoff') {
              parentConfig.onEvent?.(event);
            }
          }
        }
      };

      try {
        const result = await run<Ctx, Out>(childState, childConfig);
        const childRunId = childState.runId;

        if (result.outcome.status === 'completed') {
          const output = result.outcome.output as Out;
          let text: string;
          if (customOutputExtractor) {
            text = await customOutputExtractor(output, result.finalState as RunState<Ctx>);
          } else {
            // Default conversion: strings as-is, objects to JSON
            text = typeof output === 'string' ? output : JSON.stringify(output);
          }
          return ToolResponse.success(text, {
            toolName,
            childRunId,
            childAgent: childAgent.name,
            turns: result.finalState.turnCount,
          });
        }

        // Error path
        let message: string;
        if (result.outcome.status === 'error') {
          const err = result.outcome.error as any;
          message = `${err._tag}${'detail' in err ? `: ${err.detail}` : ''}`;
        } else {
          message = 'Sub-agent interrupted';
        }
        return ToolResponse.error('EXECUTION_FAILED', message, {
          toolName,
          childRunId,
          childAgent: childAgent.name,
        });
      } catch (e) {
        return ToolResponse.error(
          'EXECUTION_FAILED',
          e instanceof Error ? e.message : String(e),
          { toolName, childAgent: childAgent.name }
        );
      }
    }
  };
}

<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 11:58:06 AM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
44,611 / 200K tokens used (22%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<read_file>
<path>examples/flight-booking/multi-agent.ts</path>
<task_progress>
- [x] Examine Agent type definition and handoff structure
- [x] Look at agent-as-tool implementation
- [x] Check handoff examples
- [ ] Explain the handoff mechanism and hierarchy
</task_progress>
</read_file>

---

**User:**

[read_file for 'examples/flight-booking/multi-agent.ts'] Result:
/**
 * Multi-Agent Flight Booking System
 * 
 * Demonstrates how multiple specialized agents work together
 * to handle complex flight booking scenarios.
 */

import 'dotenv/config';
import {
  createAgent,
  createMultiAgent,
  createFunctionTool,
  createInMemorySessionProvider,
  createRunnerConfig,
  runAgent,
  createUserMessage,
  Model,
  ToolParameterType,
  AgentConfig
} from '@xynehq/jaf/adk';

// Import tools from main example
import {
  searchFlightsTool,
  checkSeatAvailabilityTool,
  calculatePriceTool,
  bookFlightTool
} from './index';

// ========== Additional Specialized Tools ==========

const checkWeatherTool = createFunctionTool({
  name: 'check_weather',
  description: 'Check weather conditions at airports',
  execute: async (params) => {
    const { location, date } = params as { location: string; date: string };
    
    // Mock weather data
    const weatherConditions = {
      'NYC': { temp: 45, condition: 'cloudy', windSpeed: 15 },
      'LAX': { temp: 72, condition: 'sunny', windSpeed: 8 },
      'ORD': { temp: 28, condition: 'snow', windSpeed: 25 },
      'MIA': { temp: 85, condition: 'thunderstorms', windSpeed: 20 }
    };

    const weather = weatherConditions[location as keyof typeof weatherConditions] || 
      { temp: 65, condition: 'clear', windSpeed: 10 };

    const warnings = [];
    if (weather.condition === 'snow' || weather.condition === 'thunderstorms') {
      warnings.push(`⚠️ Potential delays due to ${weather.condition}`);
    }
    if (weather.windSpeed > 20) {
      warnings.push('⚠️ High winds may affect flight schedules');
    }

    return {
      location,
      date,
      temperature: weather.temp,
      condition: weather.condition,
      windSpeed: weather.windSpeed,
      warnings,
      recommendation: warnings.length > 0 
        ? 'Consider flexible booking options' 
        : 'Good weather conditions for travel'
    };
  },
  parameters: [
    {
      name: 'location',
      type: ToolParameterType.STRING,
      description: 'Airport code',
      required: true
    },
    {
      name: 'date',
      type: ToolParameterType.STRING,
      description: 'Date to check weather',
      required: true
    }
  ]
});

const findAlternateRoutesTool = createFunctionTool({
  name: 'find_alternate_routes',
  description: 'Find alternate routes with connections',
  execute: async (params) => {
    const { origin, destination, date } = params as { 
      origin: string; 
      destination: string; 
      date: string;
    };

    // Mock alternate routes
    const alternateRoutes = [
      {
        route: `${origin} → ORD → ${destination}`,
        totalDuration: '7h 45m',
        stops: 1,
        airlines: ['United Airlines'],
        price: 425,
        layoverTime: '1h 30m'
      },
      {
        route: `${origin} → DFW → ${destination}`,
        totalDuration: '8h 15m',
        stops: 1,
        airlines: ['American Airlines'],
        price: 395,
        layoverTime: '2h'
      }
    ];

    return {
      origin,
      destination,
      date,
      directFlightsAvailable: false,
      alternateRoutes,
      recommendation: 'Consider flights with one connection for more options'
    };
  },
  parameters: [
    {
      name: 'origin',
      type: ToolParameterType.STRING,
      description: 'Origin airport',
      required: true
    },
    {
      name: 'destination',
      type: ToolParameterType.STRING,
      description: 'Destination airport',
      required: true
    },
    {
      name: 'date',
      type: ToolParameterType.STRING,
      description: 'Travel date',
      required: true
    }
  ]
});

const manageLoyaltyPointsTool = createFunctionTool({
  name: 'manage_loyalty_points',
  description: 'Check and apply loyalty program benefits',
  execute: async (params) => {
    const { customerId, airline, action } = params as {
      customerId: string;
      airline: string;
      action: 'check' | 'apply';
    };

    // Mock loyalty data
    const loyaltyData = {
      points: 45000,
      status: 'Gold',
      benefits: [
        'Priority boarding',
        'Free seat selection',
        '2 free checked bags',
        'Lounge access'
      ],
      upgradeAvailable: true,
      pointsForUpgrade: 15000
    };

    if (action === 'check') {
      return {
        customerId,
        airline,
        ...loyaltyData,
        message: `You have ${loyaltyData.points} points with ${loyaltyData.status} status`
      };
    } else {
      return {
        customerId,
        airline,
        applied: true,
        discount: 50,
        pointsUsed: 5000,
        remainingPoints: loyaltyData.points - 5000,
        message: 'Loyalty discount applied successfully'
      };
    }
  },
  parameters: [
    {
      name: 'customerId',
      type: ToolParameterType.STRING,
      description: 'Customer ID',
      required: true
    },
    {
      name: 'airline',
      type: ToolParameterType.STRING,
      description: 'Airline name',
      required: true
    },
    {
      name: 'action',
      type: ToolParameterType.STRING,
      description: 'Action to perform (check or apply)',
      required: true
    }
  ]
});

// ========== Specialized Agents ==========

const createFlightSearchSpecialist = (): AgentConfig => ({
  name: 'flight_search_specialist',
  model: Model.GEMINI_2_5_FLASH_LITE,
  instruction: `You are a flight search specialist. Your role is to:
  - Find the best flight options based on customer preferences
  - Check direct and connecting flights
  - Consider weather conditions that might affect travel
  - Provide comprehensive flight options`,
  tools: [searchFlightsTool, checkWeatherTool, findAlternateRoutesTool]
});

const createPricingSpecialist = (): AgentConfig => ({
  name: 'pricing_specialist',
  model: Model.GEMINI_2_5_FLASH_LITE,
  instruction: `You are a pricing and loyalty specialist. Your role is to:
  - Calculate accurate pricing with all fees
  - Apply loyalty program benefits
  - Find the best deals and discounts
  - Explain pricing breakdowns clearly`,
  tools: [calculatePriceTool, manageLoyaltyPointsTool]
});

const createBookingSpecialist = (): AgentConfig => ({
  name: 'booking_specialist',
  model: Model.GEMINI_2_5_FLASH_LITE,
  instruction: `You are a booking specialist. Your role is to:
  - Verify seat availability before booking
  - Process bookings accurately
  - Ensure all passenger information is complete
  - Provide confirmation details`,
  tools: [checkSeatAvailabilityTool, bookFlightTool]
});

// ========== Multi-Agent Coordinator ==========

export const createFlightBookingTeam = () => {
  const searchSpecialist = createFlightSearchSpecialist();
  const pricingSpecialist = createPricingSpecialist();
  const bookingSpecialist = createBookingSpecialist();

  const coordinator = createMultiAgent(
    'flight_booking_coordinator',
    Model.GEMINI_2_5_FLASH_LITE,
    `You are the lead flight booking coordinator managing a team of specialists.
    
    Your team includes:
    - Flight Search Specialist: Finds flights and checks weather
    - Pricing Specialist: Handles pricing and loyalty programs
    - Booking Specialist: Manages availability and bookings
    
    Delegation strategy:
    1. Route flight search requests to the search specialist
    2. Send pricing and loyalty queries to the pricing specialist
    3. Direct booking and availability checks to the booking specialist
    
    For complex requests that need multiple specialists:
    - Coordinate between specialists to provide comprehensive service
    - Ensure smooth handoffs between team members
    - Summarize results from multiple specialists clearly`,
    [searchSpecialist, pricingSpecialist, bookingSpecialist],
    'conditional'
  );

  const sessionProvider = createInMemorySessionProvider();
  const runnerConfig = createRunnerConfig(coordinator, sessionProvider);

  return { coordinator, sessionProvider, runnerConfig };
};

// ========== Example Usage ==========

async function runMultiAgentBookingExample() {
  console.log('=== Multi-Agent Flight Booking System ===\n');

  const { runnerConfig } = createFlightBookingTeam();

  // Example 1: Complex search with weather consideration
  console.log('1. Complex Search Request:');
  const complexSearchMessage = createUserMessage(
    `I need to fly from NYC to LAX next Friday. I'm flexible with dates if the weather is bad. 
    Also, can you check if there are any connecting flights that might be cheaper?`
  );

  const searchResponse = await runAgent(runnerConfig, {
    userId: 'premium_customer',
    sessionId: 'multi_booking_1'
  }, complexSearchMessage);

  console.log('Customer:', complexSearchMessage.parts[0].text);
  console.log('Coordinator:', searchResponse.content.parts[0].text);

  // Example 2: Loyalty program integration
  console.log('\n2. Loyalty Program Request:');
  const loyaltyMessage = createUserMessage(
    `I have a loyalty account with American Airlines (ID: AA123456). 
    Can you check my points and see if I can get any discounts on the AA101 flight?`
  );

  const loyaltyResponse = await runAgent(runnerConfig, {
    userId: 'premium_customer',
    sessionId: 'multi_booking_1'
  }, loyaltyMessage);

  console.log('Customer:', loyaltyMessage.parts[0].text);
  console.log('Coordinator:', loyaltyResponse.content.parts[0].text);

  // Example 3: End-to-end booking with all specialists
  console.log('\n3. Complete Booking Process:');
  const fullBookingMessage = createUserMessage(
    `I'd like to book the best option you found. Please:
    1. Verify availability for 2 passengers
    2. Apply my loyalty discount
    3. Book the flight for John Doe (john@example.com, DOB: 1985-06-15) 
       and Jane Doe (jane@example.com, DOB: 1987-09-20)
    4. I'll pay with credit card`
  );

  const bookingResponse = await runAgent(runnerConfig, {
    userId: 'premium_customer',
    sessionId: 'multi_booking_1'
  }, fullBookingMessage);

  console.log('Customer:', fullBookingMessage.parts[0].text);
  console.log('Coordinator:', bookingResponse.content.parts[0].text);
}

// Run example if this file is executed directly
if (require.main === module) {
  runMultiAgentBookingExample().catch(console.error);
}

// ========== Export Components ==========

export {
  checkWeatherTool,
  findAlternateRoutesTool,
  manageLoyaltyPointsTool,
  createFlightSearchSpecialist,
  createPricingSpecialist,
  createBookingSpecialist,
  runMultiAgentBookingExample
};
<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 11:58:14 AM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
46,428 / 200K tokens used (23%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<search_files>
<path>src</path>
<regex>handoff_to|handoffs</regex>
<file_pattern>*.ts</file_pattern>
<task_progress>
- [x] Examine Agent type definition and handoff structure
- [x] Look at agent-as-tool implementation
- [x] Check handoff examples
- [ ] Explain the handoff mechanism and hierarchy
</task_progress>
</search_files>

---

**User:**

[search_files for 'handoff_to|handoffs' in '*.ts'] Result:
Found 12 results.

src/policies/handoff.ts
│----
│    name: "handoff_to_agent",
│    description: "Delegate the task to a different, more specialized agent.",
│    return JSON.stringify({
│----
│      handoff_to: args.agentName,
│      reason: args.reason,
│        },
│----

src/adk/providers/__tests__/type-converters.test.ts
│----
│    },
│        handoffs: []
│      };
│----

src/adk/providers/type-converters.ts
│----
│    handoffs: [],
│    outputCodec: adkAgent.config.outputSchema ? createZodFromAdkSchema(adkAgent.config.outputSchema) : undefined
│    },
│----

src/adk/providers/llm-service.ts
│----
│  readonly outputCodec?: z.ZodType<Out>;
│    handoffs: [],
│    outputCodec: adkAgent.config.outputSchema ? {
│----

src/core/types.ts
│----
│  readonly handoffs?: readonly string[];
│  readonly modelConfig?: ModelConfig;
│  | { type: 'tool_call_end'; data: { toolName: string; result: string; toolResult?: any; status?: string; traceId: TraceId; runId: RunId; executionTime?: number; error?: any; metadata?: any; } }
│----
│  | { type: 'agent_processing'; data: { agentName: string; traceId: TraceId; runId: RunId; turnCount: number; messageCount: number; toolsAvailable: Array<{ name: string; description: string }>; handoffsAvailable: readonly string[]; modelConfig?: any; hasOutputCodec: boolean; context: any; currentState: any; } }
│  | { type: 'handoff'; data: { from: string; to: string; } }
│                'tools_available': JSON.stringify((data as any).toolsAvailable || []),
│----

src/core/tracing.ts
│----
│      })) || [],
│                'handoffs_available': JSON.stringify((data as any).handoffsAvailable || []),
│                'framework': 'jaf',
│----

src/core/engine.ts
│----
│      handoffsAvailable: currentAgent.handoffs || [],
│      modelConfig: currentAgent.modelConfig,
│
│----
│        if (!currentAgent.handoffs?.includes(targetAgent)) {
│          config.onEvent?.({
│        const handoffCheck = tryParseJSON(resultString);
│----
│        if (handoffCheck && typeof handoffCheck === 'object' && 'handoff_to' in handoffCheck) {
│          return {
│            isHandoff: true,
│----
│            targetAgent: handoffCheck.handoff_to as string
│          };
│----
<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 11:58:21 AM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
49,900 / 200K tokens used (25%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<read_file>
<path>src/policies/handoff.ts</path>
<task_progress>
- [x] Examine Agent type definition and handoff structure
- [x] Look at agent-as-tool implementation
- [x] Check handoff examples
- [ ] Explain the handoff mechanism and hierarchy
</task_progress>
</read_file>

---

**User:**

[read_file for 'src/policies/handoff.ts'] Result:
import { z } from 'zod';
import { Tool } from '../core/types.js';

const handoffArgsSchema = z.object({
  agentName: z.string().describe("The name of the agent to handoff to."),
  reason: z.string().describe("The reason for the handoff."),
});

type HandoffArgs = z.infer<typeof handoffArgsSchema>;

export const handoffTool: Tool<HandoffArgs, any> = {
  schema: {
    name: "handoff_to_agent",
    description: "Delegate the task to a different, more specialized agent.",
    parameters: handoffArgsSchema,
  },
  execute: async (args, _) => {
    return JSON.stringify({ 
      handoff_to: args.agentName,
      reason: args.reason,
      timestamp: new Date().toISOString()
    });
  },
};
<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 11:58:28 AM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
50,993 / 200K tokens used (25%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<attempt_completion>
<result>
# JAF Handoff Mechanism Explained

Based on the code analysis, here's how handoffs work in JAF and how they differ from agents-as-tools:

## **1. Two Different Mechanisms for Multi-Agent Composition**

### **A. Handoff (Horizontal Delegation)**

**What it is:**
- Agents at the **same hierarchy level** transfer control to each other
- Original agent **stops** and the new agent **takes over** the conversation
- Conversation history is **preserved** across the handoff
- Think: "I can't handle this, let me pass you to a specialist"

**How it works:**

```typescript
// In Agent definition (from types.ts)
type Agent<Ctx, Out> = {
  name: string;
  instructions: (state: RunState<Ctx>) => string;
  tools?: readonly Tool<any, Ctx>[];
  handoffs?: readonly string[];  // ← List of allowed handoff targets
  // ...
}
```

**Implementation:**
1. Agent declares which agents it can hand off to:
   ```typescript
   const triageAgent = {
     name: 'triage',
     handoffs: ['billing_specialist', 'tech_support', 'sales']
   }
   ```

2. Agent uses the `handoffTool` (from `src/policies/handoff.ts`):
   ```typescript
   // Built-in handoff tool returns:
   { 
     handoff_to: "billing_specialist",
     reason: "Customer has billing question",
     timestamp: "2024-..."
   }
   ```

3. Engine detects handoff in `executeToolCalls()`:
   ```typescript
   // From engine.ts line ~897
   const handoffCheck = tryParseJSON(resultString);
   if (handoffCheck && 'handoff_to' in handoffCheck) {
     // Verify handoff is allowed
     if (!currentAgent.handoffs?.includes(targetAgent)) {
       // Handoff denied!
     }
     // Switch to new agent, keep conversation history
     return runInternal(nextState, config);
   }
   ```

**Example Flow:**
```
User: "I have a billing question"
  ↓
Triage Agent: [uses handoff_to_agent tool]
  ↓ (hands off control)
Billing Agent: "I'll help with your billing question..."
  ↓ (continues conversation)
Billing Agent: [completes task]
```

### **B. Agent-as-Tool (Vertical Composition)**

**What it is:**
- Agents in a **parent-child relationship**
- Parent agent **calls** child agent and **waits** for result
- Child runs in **isolated sub-run**, then **returns** to parent
- Think: "Let me ask my specialist for help, then I'll get back to you"

**How it works:**

```typescript
// From agent-as-tool.ts
export function agentAsTool<Ctx, Out>(
  childAgent: Agent<Ctx, Out>,
  options?: AgentAsToolOptions<Ctx, Out>
): Tool<{ input: string }, Ctx>
```

**Implementation:**
1. Wrap child agent as a tool:
   ```typescript
   const summarizerAgent = { name: 'Summarizer', ... };
   
   const summarizeTool = agentAsTool(summarizerAgent, {
     toolName: 'summarize_text',
     maxTurns: 4  // limits child agent's iterations
   });
   ```

2. Parent uses it like any other tool:
   ```typescript
   const mainAgent = {
     name: 'MainAgent',
     tools: [summarizeTool, otherTools...]
   }
   ```

3. When invoked, child agent:
   - Gets a new isolated `runId` (same `traceId`)
   - Receives only the input text as a user message
   - Runs independently with its own tools/handoffs
   - Returns final output as string to parent

**Example Flow:**
```
User: "Summarize this long article: [text]"
  ↓
Main Agent: [calls summarize_text tool]
  ↓ (enters sub-run)
  Summarizer Agent: [processes in isolation]
  Summarizer Agent: [returns summary]
  ↓ (exits sub-run)
Main Agent: "Here's the summary: [result]"
```

## **2. Agent Hierarchy and Selection**

### **From LLM's Perspective:**

**At the same level**, the LLM sees:
- Regular tools: `search_web()`, `calculate()`, etc.
- Agent-as-tools: `summarize_text()`, `analyze_data()`, etc.
- Handoff tool: `handoff_to_agent(agentName)`

The LLM **chooses** which to use based on the task:

```
Agent's available actions:
├── Regular Tools
│   ├── search_flights
│   ├── book_ticket
│   └── calculate_price
├── Agent-as-Tools (sub-agents)
│   ├── summarize_text (runs Summarizer agent)
│   └── analyze_sentiment (runs Sentiment agent)
└── Handoffs (peer agents)
    ├── handoff_to billing_specialist
    ├── handoff_to tech_support
    └── handoff_to sales
```

**Decision logic (from LLM's reasoning):**
- Use **regular tool** for simple operations
- Use **agent-as-tool** when you need complex processing but want to continue
- Use **handoff** when the other agent should take over completely

## **3. Nested Sub-Agents: What Happens?**

When you have **a sub-agent that has its own sub-agents**:

```typescript
// Level 1: Main Agent
const dataProcessor = agentAsTool(dataProcessorAgent, {...});

const mainAgent = {
  name: 'MainAgent',
  tools: [dataProcessor, ...]
}

// Level 2: Data Processor (itself has sub-agents)
const statisticsCalculator = agentAsTool(statsAgent, {...});

const dataProcessorAgent = {
  name: 'DataProcessor',
  tools: [statisticsCalculator, ...]  // ← Nested!
}

// Level 3: Statistics Agent
const statsAgent = {
  name: 'StatsCalculator',
  tools: [mathTools, ...]
}
```

**What happens:**
```
User → Main Agent
        ↓ calls dataProcessor
        Data Processor Agent (sub-run #1)
            ↓ calls statisticsCalculator  
            Stats Agent (sub-run #2)
                ↓ uses math tools
                ← returns stats
            ← returns processed data
        ← returns final result
Main Agent → User
```

**Each nested level:**
- Has its own `runId` (but shares `traceId`)
- Has its own turn counter and max turns limit
- Can have its own tools, handoffs, and sub-agents
- Runs completely isolated (unless memory is inherited)
- Must complete and return before parent continues

**From `agent-as-tool.ts` (line ~60):**
```typescript
// Child gets isolated state
const childState: RunState<Ctx> = {
  runId: createRunId(uuidv4()),  // NEW run ID
  traceId: parentState.traceId,   // SAME trace ID
  messages: [{ role: 'user', content: args.input }], // FRESH messages
  currentAgentName: childAgent.name,
  context: parentState.context,  // SHARED context
  turnCount: 0,  // RESET turn counter
}
```

## **4. Key Differences Summary**

| Aspect | Handoff | Agent-as-Tool |
|--------|---------|---------------|
| **Relationship** | Peer-to-peer | Parent-child |
| **Control Flow** | Transfer ownership | Temporary delegation |
| **Conversation** | Continues in new agent | Isolated sub-conversation |
| **Return Path** | No return | Returns to caller |
| **State** | Shared run state | Isolated run state |
| **Use Case** | "You handle this now" | "Help me with this step" |
| **Declaration** | `handoffs: ['agent1', 'agent2']` | `tools: [agentAsTool(...)]` |
| **Trigger** | Returns `{handoff_to: '...'}` | LLM calls the tool |

## **5. Real-World Example**

**Scenario: Customer support system**

```typescript
// Peer agents (handoff relationship)
const triageAgent = {
  name: 'triage',
  handoffs: ['billing', 'technical', 'sales'],
  tools: [extractIntentTool]
}

const billingAgent = {
  name: 'billing', 
  handoffs: ['refunds_specialist'],  // Can further hand off
  tools: [
    queryInvoiceTool,
    summarizeTransactionsTool,  // ← This is agent-as-tool!
  ]
}

// Sub-agent (agent-as-tool relationship)
const transactionSummarizerAgent = {
  name: 'transaction_summarizer',
  tools: [analyzeTool, formatTool]
}

const summarizeTransactionsTool = agentAsTool(transactionSummarizerAgent, {
  toolName: 'summarize_transactions'
});
```

**Flow:**
```
User: "What did I spend last month?"
  ↓
Triage: [handoff_to_agent("billing")]
  ↓ HANDOFF
Billing: [calls queryInvoiceTool] → gets 50 transactions
Billing: [calls summarize_transactions tool]
  ↓ SUB-RUN
  Transaction Summarizer: [analyzes + formats]
  ↓ RETURNS
Billing: "You spent $X across Y categories..."
```

The system elegantly combines both mechanisms:
- **Handoffs** for routing to the right specialist
- **Agent-as-tools** for complex processing tasks within an agent's workflow

This creates a flexible, composable multi-agent architecture where agents can both delegate horizontally and compose vertically!
</result>
<task_progress>
- [x] Examine Agent type definition and handoff structure
- [x] Look at agent-as-tool implementation
- [x] Check handoff examples
- [x] Explain the handoff mechanism and hierarchy
</task_progress>
</attempt_completion>

---

**User:**

[TASK RESUMPTION] This task was interrupted 37 minutes ago. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '/Users/aayush.shah/Desktop/projects/jaf'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.

Note: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.
New instructions for task continuation:
<user_message>
I want to know about the LLM calls and prompts that are being passed so , we have a agent we have the description of the agent . (Please note I'm  questioning based on my understanding , it may be wrong refer to codebase for right logic and information for my assumptions in this question too) 
when a query comes to the agent we add it to the mesage array as user message type then what prompt goes to the LLM do we pass the main agent instructions , description ? what exactly ?
Also does JAF adds anything to the prompt ? if yes what ??
and this same prompt goes to the LLM at each iteration of the loop

I am thinkning we may get response of tools / agent to use  from LLM Do we get it in  a speicific format ? If yes where are we mentioning the schema in which LLM must return ? should It be on the agent's end  or JAF takes care of this ??

Let's say we go to a sub agent via handoff or agent -as - a -tool what happens then  Do we pass both main agent and sub agent instructions / description as prompt ??
Will it be counted as a turn (in sub agent context) 
What is One turn ? Explain with examples

Also does JAF have some logic / prompts that states to plan first then create a Todo try achieving each sub task/goal update toDos etc ...? or the agent instructions must do this ?

Answer in detail create md files if reuired explaining these questions ..
</user_message>

# TODO LIST RECOMMENDED

When starting a new task, it is recommended to create a todo list.


1. Include the task_progress parameter in your next tool call
2. Create a comprehensive checklist of all steps needed
3. Use markdown format: - [ ] for incomplete, - [x] for complete

**Benefits of creating a todo list now:**
	- Clear roadmap for implementation
	- Progress tracking throughout the task
	- Nothing gets forgotten or missed
	- Users can see, monitor, and edit the plan

**Example structure:**```
- [ ] Analyze requirements
- [ ] Set up necessary files
- [ ] Implement main functionality
- [ ] Handle edge cases
- [ ] Test the implementation
- [ ] Verify results```

Keeping the todo list updated helps track progress and ensures nothing is missed.

<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 12:36:49 PM (Asia/Calcutta, UTC+5.5:00)

# Current Working Directory (/Users/aayush.shah/Desktop/projects/jaf) Files
.env.test
.eslintrc.js
.gitignore
.npmignore
CHANGELOG_EVENT_IMPROVEMENTS.md
docker-compose.test.yml
jest.config.js
jest.setup.js
LICENSE
mkdocs.yml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
QUICK_REFERENCE_EVENT_HANDLERS.md
README.md
requirements.txt
tsconfig.json
dependencies/
dependencies/pdf-parse/
dependencies/pdf-parse/.editorconfig
dependencies/pdf-parse/.gitignore
dependencies/pdf-parse/.gitlab-ci.yml
dependencies/pdf-parse/.jsbeautifyrc
dependencies/pdf-parse/.npmrc
dependencies/pdf-parse/CHANGELOG
dependencies/pdf-parse/CONTRIBUTING.md
dependencies/pdf-parse/index.d.ts
dependencies/pdf-parse/index.js
dependencies/pdf-parse/LICENSE
dependencies/pdf-parse/NOTES.md
dependencies/pdf-parse/package.json
dependencies/pdf-parse/QUICKSTART.js
dependencies/pdf-parse/README.md
dependencies/pdf-parse/lib/
dependencies/pdf-parse/test/
docs/
docs/a2a-integration.md
docs/a2a-protocol.md
docs/adk-analysis.md
docs/adk-layer.md
docs/agents-as-tools.md
docs/api-reference.md
docs/CONTRIBUTING.md
docs/core-concepts.md
docs/cover.png
docs/deployment.md
docs/event-handling-guide.md
docs/examples.md
docs/favicon.png
docs/getting-started.md
docs/jaf-adk-layer-plan.md
docs/logo.png
docs/memory-system.md
docs/model-providers.md
docs/new-features.md
docs/README.md
docs/safe-logging.md
docs/sanitization.md
docs/serve.sh
docs/server-api.md
docs/tools.md
docs/trace-events-reference.md
docs/tracing.md
docs/troubleshooting.md
docs/visualization.md
docs/stylesheets/
docs/stylesheets/extra.css
examples/
examples/attachment-demo-server.ts
examples/custom-sanitization-example.ts
examples/guardrails-demo.ts
examples/safe-logging-example.ts
examples/verify-param-modification.ts
examples/agent-as-tool-demo/
examples/agent-as-tool-demo/.env.example
examples/agent-as-tool-demo/index.ts
examples/agent-as-tool-demo/package.json
examples/agent-as-tool-demo/README.md
examples/agent-as-tool-demo/tsconfig.json
examples/ai-sdk-provider-demo/
examples/ai-sdk-provider-demo/.env.example
examples/ai-sdk-provider-demo/package.json
examples/ai-sdk-provider-demo/reasoning-ui-example.tsx
examples/ai-sdk-provider-demo/server.ts
examples/ai-sdk-provider-demo/test-vertex.ts
examples/ai-sdk-provider-demo/test.ts
examples/ai-sdk-provider-demo/tsconfig.json
examples/flight-booking/
examples/flight-booking/.env.example
examples/flight-booking/index.ts
examples/flight-booking/jaf-server.ts
examples/flight-booking/multi-agent.ts
examples/flight-booking/package.json
examples/flight-booking/README.md
examples/flight-booking/tsconfig.json
examples/hitl-demo/
examples/hitl-demo/.env.example
examples/hitl-demo/api-demo.ts
examples/hitl-demo/index.ts
examples/hitl-demo/package.json
examples/hitl-demo/README.md
examples/hitl-demo/run-server.ts
examples/hitl-demo/tsconfig.json
examples/hitl-demo/shared/
examples/math-tool-demo/
examples/math-tool-demo/index.ts
examples/math-tool-demo/package.json
examples/math-tool-demo/README.md
examples/math-tool-demo/tsconfig.json
examples/mcp-demo/
examples/mcp-demo/.env.example
examples/mcp-demo/.gitignore
examples/mcp-demo/mcp-filesystem-server.ts
examples/mcp-demo/package.json
examples/mcp-demo/README.md
examples/mcp-demo/tsconfig.json
examples/mcp-http-demo/
examples/mcp-http-demo/index.ts
examples/mcp-http-demo/package.json
examples/mcp-http-demo/README.md
examples/mcp-http-demo/run-server.ts
examples/mcp-http-demo/tsconfig.json
examples/mcp-sse-demo/
examples/mcp-sse-demo/index.ts
examples/mcp-sse-demo/package.json
examples/mcp-sse-demo/README.md
examples/mcp-sse-demo/run-server.ts
examples/mcp-sse-demo/tsconfig.json
examples/otel-tracing-demo/
examples/otel-tracing-demo/.env.example
examples/otel-tracing-demo/otel-demo.ts
examples/otel-tracing-demo/package.json
examples/rag-demo/
examples/rag-demo/.env.example
examples/rag-demo/.gitignore
examples/rag-demo/DEMO_SUMMARY.md
examples/rag-demo/index.ts
examples/rag-demo/package.json
examples/rag-demo/rag-agent.ts
examples/rag-demo/rag-tool.ts
examples/rag-demo/README.md
examples/rag-demo/tsconfig.json
examples/server-demo/
examples/server-demo/.env.example
examples/server-demo/index.ts
examples/server-demo/package.json
examples/server-demo/README.md
examples/server-demo/tsconfig.json
examples/simple-event-handler-demo/
examples/simple-event-handler-demo/.env.example
examples/simple-event-handler-demo/.gitignore
examples/simple-event-handler-demo/DEMO_OUTPUT.md
examples/simple-event-handler-demo/index.ts
examples/simple-event-handler-demo/package.json
examples/simple-event-handler-demo/README.md
examples/simple-event-handler-demo/tsconfig.json
examples/streaming-demo/
examples/streaming-demo/package.json
examples/streaming-demo/README.md
examples/streaming-demo/server.ts
examples/streaming-demo/stream-direct.ts
examples/streaming-demo/stream-plain.ts
examples/streaming-demo/tsconfig.json
examples/visualization-demo/
examples/visualization-demo/index.ts
examples/visualization-demo/package.json
examples/visualization-demo/README.md
scripts/
scripts/setup-test-db.sh
scripts/teardown-test-db.sh
src/
src/index.ts
src/__tests__/
src/__tests__/agent-as-tool.test.ts
src/__tests__/engine.test.ts
src/__tests__/hitl.test.ts
src/__tests__/validation.test.ts
src/a2a/
src/a2a/agent-card.ts
src/a2a/agent.ts
src/a2a/client.ts
src/a2a/executor.ts
src/a2a/index.ts
src/a2a/protocol.ts
src/a2a/server.ts
src/a2a/types.ts
src/a2a/__tests__/
src/a2a/examples/
src/a2a/memory/
src/adk/
src/core/
src/memory/
src/policies/
src/providers/
src/server/
src/test-utils/
src/tools/
src/types/
src/utils/
src/visualization/

(File list truncated. Use list_files on specific subdirectories if you need to explore further.)

# Workspace Configuration
{
  "workspaces": {
    "/Users/aayush.shah/Desktop/projects/jaf": {
      "hint": "jaf",
      "associatedRemoteUrls": [
        "origin: https://github.com/xynehq/jaf.git"
      ],
      "latestGitCommitHash": "6b97fee9bf8ff6c6bd5970d1c4969597c3e36860"
    }
  }
}

# Detected CLI Tools
These are some of the tools on the user's machine, and may be useful if needed to accomplish the task: git, docker, kubectl, gcloud, npm, pnpm, pip, curl, jq, make, python, node, mysql, sqlite3, code, grep, sed, awk, brew, bundle. This list is not exhaustive, and other tools may be available.

# Context Window Usage
54,606 / 200K tokens used (27%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


I'll create a comprehensive analysis of JAF's LLM prompting and turn mechanics. Let me examine the model provider implementations to understand the prompt construction.

<read_file>
<path>src/providers/litellm.ts</path>
<task_progress>
- [ ] Examine how prompts are constructed for LLM calls
- [ ] Check what JAF adds to prompts
- [ ] Understand tool calling format and schema
- [ ] Analyze handoff/sub-agent prompt behavior
- [ ] Define "turn" concept with examples
- [ ] Check for built-in planning logic
- [ ] Create comprehensive documentation
</task_progress>
</read_file>

---

**User:**

[read_file for 'src/providers/litellm.ts'] Result:
The tool execution failed with the following error:
<error>
Error executing read_file: File not found: /Users/aayush.shah/Desktop/projects/jaf/src/providers/litellm.ts
</error>

# TODO LIST RECOMMENDED

When starting a new task, it is recommended to create a todo list.


1. Include the task_progress parameter in your next tool call
2. Create a comprehensive checklist of all steps needed
3. Use markdown format: - [ ] for incomplete, - [x] for complete

**Benefits of creating a todo list now:**
	- Clear roadmap for implementation
	- Progress tracking throughout the task
	- Nothing gets forgotten or missed
	- Users can see, monitor, and edit the plan

**Example structure:**```
- [ ] Analyze requirements
- [ ] Set up necessary files
- [ ] Implement main functionality
- [ ] Handle edge cases
- [ ] Test the implementation
- [ ] Verify results```

Keeping the todo list updated helps track progress and ensures nothing is missed.

<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 12:37:02 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
57,535 / 200K tokens used (29%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<list_files>
<path>src/providers</path>
<recursive>false</recursive>
<task_progress>
- [ ] Examine how prompts are constructed for LLM calls
- [ ] Check what JAF adds to prompts
- [ ] Understand tool calling format and schema
- [ ] Analyze handoff/sub-agent prompt behavior
- [ ] Define "turn" concept with examples
- [ ] Check for built-in planning logic
- [ ] Create comprehensive documentation
</task_progress>
</list_files>

---

**User:**

[list_files for 'src/providers'] Result:
ai-sdk.ts
index.ts
mcp.ts
model_prices.json
model.ts
<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 12:37:07 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
58,061 / 200K tokens used (29%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<read_file>
<path>src/providers/ai-sdk.ts</path>
<task_progress>
- [ ] Examine how prompts are constructed for LLM calls
- [ ] Check what JAF adds to prompts
- [ ] Understand tool calling format and schema
- [ ] Analyze handoff/sub-agent prompt behavior
- [ ] Define "turn" concept with examples
- [ ] Check for built-in planning logic
- [ ] Create comprehensive documentation
</task_progress>
</read_file>

---

**User:**

[read_file for 'src/providers/ai-sdk.ts'] Result:
import {
  LanguageModel,
  generateText,
  generateObject,
  ModelMessage,
  JSONValue,
  Schema,
  ToolSet,
  ToolCallPart,
  ToolResultPart,
  TextPart,
  tool,
  zodSchema,
} from 'ai';
import { ModelProvider, Message, getTextContent } from '../core/types.js';
import { safeConsole } from '../utils/logger.js';

export type AiSdkFunctionTool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: unknown;
  };
};

function safeParseJson(text: string): JSONValue {
  try {
    return JSON.parse(text) as JSONValue;
  } catch {
    return text;
  }
}

export type AiSdkChatMessageParam =
  | { role: 'system'; content: string }
  | {
      role: 'user' | 'assistant' | 'tool';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string | any;
        };
      }>;
      tool_call_id?: string;
    };

export type AiSdkChatRequest = {
  model: string;
  messages: AiSdkChatMessageParam[];
  temperature?: number;
  // Support both OpenAI-style and AI SDK-style naming for token limits
  max_tokens?: number;
  maxTokens?: number;
  tools?: AiSdkFunctionTool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'json_object' };
  // Allow arbitrary provider-specific fields
  [key: string]: unknown;
};

export type AiSdkChatResponse = {
  // Prefer a single normalized message if provided by the client
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string | any;
      };
    }>;
  };
  // Fallbacks for OpenAI-compatible responses
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string | any;
        };
      }>;
    };
  }>;
  // Fallback for plain-text responses (e.g., ai SDK generateText)
  text?: string | null;

  // Optional metadata if available
  id?: string;
  model?: string;
  created?: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };

  [key: string]: unknown;
};

export interface AiSdkClient {
  chat: (request: AiSdkChatRequest) => Promise<AiSdkChatResponse>;
}

export const createAiSdkProvider = <Ctx>(
  model: unknown,
): ModelProvider<Ctx> => {
  const lm = model as LanguageModel;
  return {
    async getCompletion(state, agent) {
      const system = agent.instructions(state);

      // Convert JAF messages to AI SDK ModelMessages using standard OpenAI format
      const messages: ModelMessage[] = [];
      const toolNameById = new Map<string, string>();

      for (const msg of state.messages) {
        switch (msg.role) {
          case 'user':
            messages.push({ role: 'user', content: getTextContent(msg.content) });
            break;
          case 'assistant':
            if (msg.tool_calls && msg.tool_calls.length > 0) {
              // Assistant message with tool calls as content parts
              const parts: Array<TextPart | ToolCallPart> = [];
              const text = getTextContent(msg.content);
              if (text) parts.push({ type: 'text', text });
              for (const tc of msg.tool_calls) {
                toolNameById.set(tc.id, tc.function.name);
                parts.push({
                  type: 'tool-call',
                  toolCallId: tc.id,
                  toolName: tc.function.name,
                  input: safeParseJson(tc.function.arguments),
                });
              }
              messages.push({ role: 'assistant', content: parts });
            } else {
              messages.push({ role: 'assistant', content: getTextContent(msg.content) });
            }
            break;
          case 'tool': {
            const toolCallId = msg.tool_call_id!;
            const toolName = toolNameById.get(toolCallId) ?? 'unknown';
            const parsed = safeParseJson(getTextContent(msg.content));
            const output: ToolResultPart['output'] =
              typeof parsed === 'string'
                ? { type: 'text', value: parsed }
                : { type: 'json', value: parsed };
            const content: ToolResultPart[] = [
              { type: 'tool-result', toolCallId, toolName, output },
            ];
            messages.push({ role: 'tool', content });
            break;
          }
        }
      }

      // Decide whether to enable tool calls or produce final structured output
      const lastJafMessage = state.messages[state.messages.length - 1];
      const hasCompletedTools = lastJafMessage?.role === 'tool';

      const toolsForAiSDK: ToolSet | undefined =
        !hasCompletedTools && agent.tools && agent.tools.length > 0
          ? agent.tools.reduce(
              (acc, jafTool) => {
                const toSchema = zodSchema as unknown as (s: unknown) => Schema;
                acc[jafTool.schema.name] = tool({
                  description: jafTool.schema.description,
                  inputSchema: toSchema(jafTool.schema.parameters),
                });
                return acc;
              },
              {} as ToolSet,
            )
          : undefined;

      const shouldGenerateObject = Boolean(agent.outputCodec) && !toolsForAiSDK;

      if (shouldGenerateObject) {
        const toSchema = zodSchema as unknown as (s: unknown) => Schema;
        const go = generateObject as unknown as (opts: unknown) => Promise<unknown>;
        const resultUnknown = await go({
          model: lm,
          schema: toSchema((agent.outputCodec as unknown) as import('zod').ZodType<unknown>),
          system,
          messages,
          temperature: agent.modelConfig?.temperature,
          maxOutputTokens: agent.modelConfig?.maxTokens,
        });
        const object = (resultUnknown as { object: unknown }).object;

        return { message: { content: JSON.stringify(object) } };
      }

      safeConsole.log(`[DEBUG] Tools passed to AI SDK: ${toolsForAiSDK ? Object.keys(toolsForAiSDK).length : 0} (hasCompletedTools: ${hasCompletedTools})`);
      try {
        safeConsole.log('[DEBUG] Messages being passed to AI SDK:', JSON.stringify(messages, null, 2));

        const completeResponse = await generateText({
          model: lm,
          system,
          messages,
          tools: toolsForAiSDK,
          temperature: agent.modelConfig?.temperature,
          maxOutputTokens: agent.modelConfig?.maxTokens,
        });

        safeConsole.log('[DEBUG] AI SDK generateText response summary:', {
          text: completeResponse.text?.slice(0, 100),
          toolCallsCount: completeResponse.toolCalls?.length ?? 0,
        });

        return {
          message: {
            content: completeResponse.text,
            tool_calls: completeResponse.toolCalls?.map((tc) => ({
              id: tc.toolCallId,
              type: 'function' as const,
              function: { name: tc.toolName, arguments: JSON.stringify(tc.input) },
            })),
          },
        };
      } catch (error) {
        safeConsole.error('[DEBUG] AI SDK generateText error:', error);
        throw error;
      }
    },
  };
};

<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 12:37:13 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
58,509 / 200K tokens used (29%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<read_file>
<path>src/adk/providers/llm-service.ts</path>
<task_progress>
- [ ] Examine how prompts are constructed for LLM calls
- [ ] Check what JAF adds to prompts
- [ ] Understand tool calling format and schema
- [ ] Analyze handoff/sub-agent prompt behavior
- [ ] Define "turn" concept with examples
- [ ] Check for built-in planning logic
- [ ] Create comprehensive documentation
</task_progress>
</read_file>

---

**User:**

[read_file for 'src/adk/providers/llm-service.ts'] Result:
/**
 * JAF ADK Layer - LLM Service Bridge
 *
 * Bridges ADK types to Core ModelProvider interface following functional patterns
 */

import { ModelProvider } from '../../core/types.js';
import { makeLiteLLMProvider } from '../../providers/model.js';
import { withLLMRetry, withLLMTimeout, classifyLLMError, createLLMErrorLogger } from './error-handler.js';
import { convertAdkToolToCoreTool, convertAdkModelToCoreModel as convertModelToCoreModel, safeJsonParse } from './type-converters.js';
import {
  Agent,
  Content,
  Session,
  Model,
  FunctionCall,
  Part,
  PartType,
  ContentRole,
  ToolParameter
} from '../types.js';
import OpenAI from 'openai';
import { safeConsole } from '../../utils/logger.js';

// ========== ADK LLM Service Types ==========

export interface AdkLLMServiceConfig {
  provider: 'litellm' | 'openai' | 'anthropic' | 'google';
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
}

export interface AdkLLMResponse {
  content: Content;
  functionCalls: FunctionCall[];
  metadata: {
    model: string;
    tokensUsed?: number;
    finishReason?: string;
  };
}

export interface AdkLLMStreamChunk {
  delta: string;
  functionCall?: Partial<FunctionCall>;
  isDone: boolean;
}

export type AdkLLMService = {
  generateResponse: (
    agent: Agent,
    session: Session,
    message: Content,
    requestConfig?: { modelOverride?: string; temperature?: number; maxTokens?: number }
  ) => Promise<AdkLLMResponse>;
  
  generateStreamingResponse: (
    agent: Agent,
    session: Session,
    message: Content,
    requestConfig?: { modelOverride?: string; temperature?: number; maxTokens?: number }
  ) => AsyncGenerator<AdkLLMStreamChunk>;
};

// ========== LLM Service Factory ==========

export const createAdkLLMService = (config: AdkLLMServiceConfig): AdkLLMService => {
  // Create the underlying Core ModelProvider
  const coreProvider = createCoreProvider(config);
  const errorLogger = createLLMErrorLogger();
  
  // Wrap with error handling
  const generateResponseWithErrorHandling = withLLMTimeout(
    withLLMRetry(
      createGenerateResponse(coreProvider),
      { maxRetries: 3, baseDelay: 1000, maxDelay: 30000 },
      config.provider,
      config.defaultModel || 'unknown'
    ),
    30000, // 30 second timeout
    config.provider,
    config.defaultModel || 'unknown'
  );
  
  const generateStreamingResponseWithErrorHandling = async function* (
    agent: Agent,
    session: Session,
    message: Content,
    requestConfig?: { modelOverride?: string; temperature?: number; maxTokens?: number }
  ): AsyncGenerator<AdkLLMStreamChunk> {
    try {
      const streamGenerator = createGenerateStreamingResponse(coreProvider);
      yield* streamGenerator(agent, session, message, requestConfig);
    } catch (error) {
      const llmError = error instanceof Error 
        ? classifyLLMError(error, config.provider, requestConfig?.modelOverride || config.defaultModel || 'unknown')
        : new Error('Unknown streaming error');
      
      errorLogger.logError(llmError as any, { agent: agent.config.name, streaming: true });
      throw llmError;
    }
  };
  
  return {
    generateResponse: async (agent, session, message, requestConfig) => {
      try {
        return await generateResponseWithErrorHandling(agent, session, message, requestConfig);
      } catch (error) {
        const llmError = error instanceof Error 
          ? classifyLLMError(error, config.provider, requestConfig?.modelOverride || config.defaultModel || 'unknown')
          : new Error('Unknown error');
        
        errorLogger.logError(llmError as any, { agent: agent.config.name });
        throw llmError;
      }
    },
    generateStreamingResponse: generateStreamingResponseWithErrorHandling
  };
};

// ========== Core Provider Creation ==========

const createCoreProvider = (config: AdkLLMServiceConfig): ModelProvider<any> => {

  // Store config for streaming
  (global as any).__adk_llm_config = config;

  switch (config.provider) {
    case 'litellm': {
      const litellmUrl = config.baseUrl || process.env.LITELLM_URL || 'http://localhost:4000';
      const litellmKey = config.apiKey || process.env.LITELLM_API_KEY || 'anything';
      // console.log('🔗 [LLM-DEBUG] Creating LiteLLM provider with:', { url: litellmUrl, key: `${litellmKey.substring(0, 10)}...` });
      return makeLiteLLMProvider(litellmUrl, litellmKey);
    }
    
    case 'openai': {
      const openaiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
      return makeLiteLLMProvider('https://api.openai.com/v1', openaiKey);
    }
    
    case 'anthropic': {
      const anthropicKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
      return makeLiteLLMProvider('https://api.anthropic.com', anthropicKey);
    }
    
    case 'google': {
      const googleKey = config.apiKey || process.env.GOOGLE_API_KEY || '';
      return makeLiteLLMProvider('https://generativelanguage.googleapis.com/v1beta', googleKey);
    }
    
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
};

// ========== Response Generation ==========

const createGenerateResponse = (coreProvider: ModelProvider<any>) => {
  return async (
    agent: Agent,
    session: Session,
    message: Content,
    config?: { modelOverride?: string; temperature?: number; maxTokens?: number }
  ): Promise<AdkLLMResponse> => {
    // console.log('🚀 [LLM-DEBUG] Starting API call...');
    // console.log('📤 [LLM-DEBUG] Agent:', { name: agent.config.name, model: agent.config.model });
    // console.log('📤 [LLM-DEBUG] Message:', { role: message.role, text: message.parts.map(p => p.text).join('') });
    // console.log('📤 [LLM-DEBUG] Config:', config);
    
    // Convert ADK types to Core types
    const coreState = convertAdkSessionToCoreState(session, message);
    const coreAgent = convertAdkAgentToCoreAgent(agent);
    const coreConfig = convertAdkConfigToCoreConfig(config, agent);
    
    // console.log('📡 [LLM-DEBUG] Calling coreProvider.getCompletion...');
    
    // Call Core ModelProvider
    const coreResponse = await coreProvider.getCompletion(coreState, coreAgent, coreConfig);
    
    // console.log('📥 [LLM-DEBUG] Raw Core Response:', coreResponse);
    // console.log('✅ [LLM-DEBUG] API call successful!');
    
    // Convert Core response back to ADK format
    const adkResponse = convertCoreResponseToAdkResponse(coreResponse, config?.modelOverride || agent.config.model.toString());
    
    return adkResponse;
  };
};

// ========== Streaming Response Generation ==========

const createGenerateStreamingResponse = (coreProvider: ModelProvider<any>) => {
  return async function* (
    agent: Agent,
    session: Session,
    message: Content,
    config?: { modelOverride?: string; temperature?: number; maxTokens?: number }
  ): AsyncGenerator<AdkLLMStreamChunk> {
    // console.log('🌊 [LLM-DEBUG] Starting streaming API call...');
    
    // Get OpenAI client directly for streaming support
    const { client, model } = await getStreamingClient(config, agent);
    
    // Convert ADK types to OpenAI format
    const coreState = convertAdkSessionToCoreState(session, message);
    const coreAgent = convertAdkAgentToCoreAgent(agent);
    
    // Prepare messages for OpenAI
    const systemMessage = {
      role: 'system' as const,
      content: agent.config.instruction
    };
    
    const messages = [
      systemMessage,
      ...coreState.messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
        ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {})
      }))
    ];
    
    // Prepare tools if any
    const tools = agent.config.tools.length > 0 ? agent.config.tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: convertAdkParametersToJsonSchema(t.parameters)
      }
    })) : undefined;
    
    // Create streaming completion
    const stream = await client.chat.completions.create({
      model: model,
      messages: messages as any,
      temperature: config?.temperature ?? 0.7,
      max_tokens: config?.maxTokens ?? 2000,
      tools: tools,
      stream: true
    });
    
    let accumulatedText = '';
      let currentFunctionCall: Partial<FunctionCall> | null = null;
      
      // Process the stream
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        
        if (!delta) continue;
        
        // Handle text content
        if (delta.content) {
          accumulatedText += delta.content;
          yield {
            delta: delta.content,
            isDone: false
          };
        }
        
        // Handle function calls
        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            if (toolCall.function?.name) {
              currentFunctionCall = {
                id: toolCall.id || '',
                name: toolCall.function.name,
                args: {}
              };
            }
            
            if (toolCall.function?.arguments) {
              if (currentFunctionCall) {
                // Accumulate arguments
                const argString = (currentFunctionCall.args as any).__raw_args || '';
                (currentFunctionCall.args as any).__raw_args = argString + toolCall.function.arguments;
                
                // Try to parse complete arguments
                try {
                  currentFunctionCall.args = JSON.parse((currentFunctionCall.args as any).__raw_args);
                  delete (currentFunctionCall.args as any).__raw_args;
                } catch {
                  // Arguments not complete yet
                }
              }
            }
          }
        }
        
        // Check if we have a complete function call
        if (currentFunctionCall && currentFunctionCall.id && currentFunctionCall.name && 
            currentFunctionCall.args && !(currentFunctionCall.args as any).__raw_args) {
          yield {
            delta: '',
            functionCall: currentFunctionCall as FunctionCall,
            isDone: false
          };
          currentFunctionCall = null;
        }
      }
      
      // Final chunk
      yield {
        delta: '',
        isDone: true
      };
    
    // console.log('✅ [LLM-DEBUG] Streaming completed successfully');
  };
};

// ========== Type Conversion Functions ==========

const convertAdkSessionToCoreState = (session: Session, newMessage: Content): any => {
  // Convert ADK session messages to Core format
  const coreMessages = session.messages.map(convertAdkContentToCoreMessage);
  coreMessages.push(convertAdkContentToCoreMessage(newMessage));
  
  return {
    runId: session.id,
    traceId: session.id, // Use session ID as trace ID for now
    messages: coreMessages,
    currentAgentName: 'default', // ADK doesn't have explicit agent names
    context: {
      userId: session.userId,
      sessionId: session.id,
      artifacts: session.artifacts
    },
    turnCount: session.messages.length
  };
};

const convertAdkContentToCoreMessage = (content: Content): any => {
  const role = convertAdkRoleToCoreRole(content.role);
  
  // Handle text content
  const textParts = content.parts.filter(p => p.type === PartType.TEXT);
  const textContent = textParts.map(p => p.text || '').join(' ');
  
  // Handle function calls
  const functionCalls = content.parts
    .filter(p => p.type === PartType.FUNCTION_CALL)
    .map(p => p.functionCall)
    .filter(fc => fc !== undefined);
  
  // Handle function responses
  const functionResponses = content.parts
    .filter(p => p.type === PartType.FUNCTION_RESPONSE)
    .map(p => p.functionResponse)
    .filter(fr => fr !== undefined);
  
  const message: any = {
    role,
    content: textContent
  };
  
  if (functionCalls.length > 0) {
    message.tool_calls = functionCalls.map(fc => ({
      id: fc!.id,
      type: 'function' as const,
      function: {
        name: fc!.name,
        arguments: JSON.stringify(fc!.args)
      }
    }));
  }
  
  if (functionResponses.length > 0 && role === 'tool') {
    const fr = functionResponses[0]!;
    message.tool_call_id = fr.id;
    message.content = typeof fr.response === 'string' ? fr.response : JSON.stringify(fr.response);
  }
  
  return message;
};

const convertAdkRoleToCoreRole = (adkRole: ContentRole | string): string => {
  switch (adkRole) {
    case ContentRole.USER:
    case 'user':
      return 'user';
    case ContentRole.MODEL:
    case 'model':
      return 'assistant';
    case ContentRole.SYSTEM:
    case 'system':
      return 'system';
    case 'tool':
      return 'tool';
    default:
      return 'user';
  }
};

const convertAdkAgentToCoreAgent = (adkAgent: Agent): any => {
  return {
    name: adkAgent.config.name,
    instructions: () => adkAgent.config.instruction,
    tools: adkAgent.config.tools.map(convertAdkToolToCoreTool),
    modelConfig: {
      name: convertModelToCoreModel(adkAgent.config.model),
      temperature: 0.7, // Default temperature
      maxTokens: 2000   // Default max tokens
    },
    handoffs: [],
    outputCodec: adkAgent.config.outputSchema ? {
      safeParse: (data: any) => adkAgent.config.outputSchema!.validate(data)
    } : undefined
  };
};

const convertAdkToolToCoreool = (adkTool: any): any => {
  return {
    schema: {
      name: adkTool.name,
      description: adkTool.description,
      parameters: convertAdkParametersToCoreParameters(adkTool.parameters)
    },
    execute: async (params: any, context: any) => {
      // Call the ADK tool executor and convert context
      const adkContext = convertCoreContextToAdkContext(context);
      return await adkTool.execute(params, adkContext);
    }
  };
};

const convertAdkParametersToCoreParameters = (adkParams: any[]): any => {
  // Convert ADK parameters to Zod-like schema
  const properties: any = {};
  const required: string[] = [];
  
  for (const param of adkParams) {
    properties[param.name] = {
      type: param.type,
      description: param.description
    };
    
    if (param.required) {
      required.push(param.name);
    }
  }
  
  return {
    safeParse: (data: any) => {
      // Simple validation
      const errors: string[] = [];
      
      for (const req of required) {
        if (!(req in data)) {
          errors.push(`Missing required parameter: ${req}`);
        }
      }
      
      if (errors.length > 0) {
        return { success: false, error: { issues: errors.map(e => ({ message: e })) } };
      }
      
      return { success: true, data };
    }
  };
};

const convertAdkModelToCoreModel = (adkModel: Model | string): string => {
  if (typeof adkModel === 'string') {
    return adkModel;
  }
  
  switch (adkModel) {
    case Model.GEMINI_2_0_FLASH:
      return 'gemini-2.0-flash';
    case Model.GEMINI_1_5_PRO:
      return 'gemini-1.5-pro';
    case Model.GEMINI_1_5_FLASH:
      return 'gemini-1.5-flash';
    case Model.GPT_4_TURBO:
      return 'gpt-4-turbo';
    case Model.GPT_4:
      return 'gpt-4';
    case Model.GPT_3_5_TURBO:
      return 'gpt-3.5-turbo';
    case Model.CLAUDE_3_OPUS_20240229:
      return 'claude-3-opus-20240229';
    case Model.CLAUDE_3_5_SONNET_LATEST:
      return 'claude-3-5-sonnet-latest';
    case Model.CLAUDE_3_HAIKU_20240307:
      return 'claude-3-haiku-20240307';
    default:
      return 'gpt-4o';
  }
};

const convertAdkConfigToCoreConfig = (
  adkConfig?: { modelOverride?: string; temperature?: number; maxTokens?: number },
  agent?: Agent
): any => {
  return {
    agentRegistry: new Map(), // Empty for now
    modelProvider: null as any, // Will be set by caller
    modelOverride: adkConfig?.modelOverride,
    maxTurns: 50,
    temperature: adkConfig?.temperature,
    maxTokens: adkConfig?.maxTokens
  };
};

const convertCoreResponseToAdkResponse = (coreResponse: any, model: string): AdkLLMResponse => {
  const content = convertCoreMessageToAdkContent(coreResponse);
  const functionCalls = extractFunctionCallsFromCoreResponse(coreResponse);
  
  return {
    content,
    functionCalls,
    metadata: {
      model,
      finishReason: 'stop'
    }
  };
};

const convertCoreMessageToAdkContent = (coreResponse: any): Content => {
  const parts: Part[] = [];
  
  // Add text content if present
  if (coreResponse.message?.content) {
    parts.push({
      type: PartType.TEXT,
      text: coreResponse.message.content
    });
  }
  
  // Add function calls if present
  if (coreResponse.message?.tool_calls) {
    for (const toolCall of coreResponse.message.tool_calls) {
      parts.push({
        type: PartType.FUNCTION_CALL,
        functionCall: {
          id: toolCall.id,
          name: toolCall.function.name,
          args: safeJsonParse(toolCall.function.arguments)
        }
      });
    }
  }
  
  return {
    role: ContentRole.MODEL,
    parts,
    metadata: {}
  };
};

const extractFunctionCallsFromCoreResponse = (coreResponse: any): FunctionCall[] => {
  if (!coreResponse.message?.tool_calls) {
    return [];
  }
  
  return coreResponse.message.tool_calls.map((toolCall: any) => ({
    id: toolCall.id,
    name: toolCall.function.name,
    args: safeJsonParse(toolCall.function.arguments)
  }));
};

const convertCoreContextToAdkContext = (coreContext: any): any => {
  // Convert Core tool context to ADK tool context
  return {
    agent: coreContext.agent, // Will need proper conversion
    session: coreContext.session, // Will need proper conversion
    message: coreContext.message, // Will need proper conversion
    actions: coreContext.actions,
    metadata: coreContext.metadata
  };
};

// ========== Streaming Helpers ==========

const getStreamingClient = async (
  config?: { modelOverride?: string },
  agent?: Agent
): Promise<{ client: OpenAI, model: string }> => {
  // Get the stored config from service creation
  const serviceConfig = (global as any).__adk_llm_config as AdkLLMServiceConfig;
  if (!serviceConfig) {
    throw new Error('LLM service not properly initialized');
  }
  
  let client: OpenAI;
  let model: string;
  
  switch (serviceConfig.provider) {
    case 'openai': {
      const openaiKey = serviceConfig.apiKey || process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        throw new Error('OPENAI_API_KEY is required for OpenAI streaming');
      }
      
      client = new OpenAI({ 
        apiKey: openaiKey,
        dangerouslyAllowBrowser: true 
      });
      
      model = config?.modelOverride || serviceConfig.defaultModel || (agent ? convertModelToCoreModel(agent.config.model) : 'gpt-4o');
      break;
    }
      
    case 'litellm': {
      const litellmUrl = serviceConfig.baseUrl || process.env.LITELLM_URL || 'http://localhost:4000';
      const litellmKey = serviceConfig.apiKey || process.env.LITELLM_API_KEY || 'anything';
      
      client = new OpenAI({ 
        baseURL: litellmUrl,
        apiKey: litellmKey,
        dangerouslyAllowBrowser: true 
      });
      
      model = config?.modelOverride || serviceConfig.defaultModel || (agent ? convertModelToCoreModel(agent.config.model) : 'gpt-4o');
      break;
    }
      
    case 'anthropic': {
      // For Anthropic via LiteLLM proxy
      const anthropicUrl = serviceConfig.baseUrl || process.env.LITELLM_URL || 'http://localhost:4000';
      const anthropicKey = serviceConfig.apiKey || process.env.ANTHROPIC_API_KEY || process.env.LITELLM_API_KEY || 'anything';
      
      client = new OpenAI({ 
        baseURL: anthropicUrl,
        apiKey: anthropicKey,
        dangerouslyAllowBrowser: true 
      });
      
      // Use claude model for Anthropic
      model = config?.modelOverride || serviceConfig.defaultModel || 'claude-3-sonnet';
      break;
    }
      
    case 'google': {
      // For Google via LiteLLM proxy
      const googleUrl = serviceConfig.baseUrl || process.env.LITELLM_URL || 'http://localhost:4000';
      const googleKey = serviceConfig.apiKey || process.env.GOOGLE_API_KEY || process.env.LITELLM_API_KEY || 'anything';
      
      client = new OpenAI({ 
        baseURL: googleUrl,
        apiKey: googleKey,
        dangerouslyAllowBrowser: true 
      });
      
      // Use gemini model for Google
      model = config?.modelOverride || serviceConfig.defaultModel || 'gemini-1.5-pro';
      break;
    }
      
    default:
      throw new Error(`Unsupported streaming provider: ${serviceConfig.provider}`);
  }
  
  return { client, model };
};

const convertAdkParametersToJsonSchema = (parameters: ToolParameter[]): any => {
  const properties: any = {};
  const required: string[] = [];
  
  for (const param of parameters) {
    properties[param.name] = {
      type: param.type,
      description: param.description,
      ...(param.enum ? { enum: param.enum } : {}),
      ...(param.properties ? { properties: convertAdkParametersToJsonSchema(Object.values(param.properties)) } : {}),
      ...(param.items ? { items: convertAdkParametersToJsonSchema([param.items])[param.items.name] } : {})
    };
    
    if (param.required !== false) {
      required.push(param.name);
    }
  }
  
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false
  };
};

// ========== Default Service Instance ==========

export const createDefaultAdkLLMService = (): AdkLLMService => {
  return createAdkLLMService({
    provider: 'litellm',
    baseUrl: process.env.LITELLM_URL || 'http://localhost:4000',
    apiKey: process.env.LITELLM_API_KEY || 'anything',
    defaultModel: process.env.LITELLM_MODEL || 'gpt-4o'
  });
};
<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 12:37:22 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
61,149 / 200K tokens used (31%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<read_file>
<path>src/providers/model.ts</path>
<task_progress>
- [x] Examine how prompts are constructed for LLM calls
- [ ] Check what JAF adds to prompts
- [ ] Understand tool calling format and schema
- [ ] Analyze handoff/sub-agent prompt behavior
- [ ] Define "turn" concept with examples
- [ ] Check for built-in planning logic
- [ ] Create comprehensive documentation
</task_progress>
</read_file>

---

**User:**

[read_file for 'src/providers/model.ts'] Result:
import OpenAI from "openai";
import tunnel from 'tunnel';
import { ModelProvider, Message, MessageContentPart, getTextContent, type RunState, type Agent, type RunConfig } from '../core/types.js';
import { extractDocumentContent, isDocumentSupported, getDocumentDescription } from '../utils/document-processor.js';
import { safeConsole } from '../utils/logger.js';

interface ProxyConfig {
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

function createProxyAgent(url?: any,proxyConfig?: ProxyConfig) {
  const httpProxy = proxyConfig?.httpProxy || process.env.HTTP_PROXY;
  const noProxy = proxyConfig?.noProxy || process.env.NO_PROXY;
  
  if (noProxy?.includes(url)  || !httpProxy ) {
    return undefined;
  }

  try {
    safeConsole.log(`[JAF:PROXY] Configuring proxy agents:`);
    if (httpProxy) safeConsole.log(`HTTP_PROXY: ${httpProxy}`);
    if (noProxy) safeConsole.log(`NO_PROXY: ${noProxy}`);

    return {
      httpAgent: httpProxy ? createTunnelAgent(httpProxy) : undefined,
    };
  } catch (error) {
    safeConsole.warn(`[JAF:PROXY] Failed to create proxy agents. Install 'https-proxy-agent' and 'http-proxy-agent' packages for proxy support:`, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}


const createTunnelAgent = (proxyUrl: string) => {
  const url = new URL(proxyUrl);
  
  // Create tunnel agent for HTTPS through HTTP proxy
  return tunnel.httpsOverHttp({
    proxy: {
      host: url.hostname,
      port: parseInt(url.port)
    },
    rejectUnauthorized: false
  });
};

export const makeLiteLLMProvider = <Ctx>(
  baseURL: string,
  apiKey = "anything",
  proxyConfig?: ProxyConfig
): ModelProvider<Ctx> => {
  const clientConfig: any = { 
    baseURL, 
    apiKey, 
    dangerouslyAllowBrowser: true
  };

  const hostname = new URL(baseURL).hostname;
  const proxyAgents = createProxyAgent(hostname,proxyConfig);
  if (proxyAgents) {
    if (proxyAgents.httpAgent) {
      clientConfig.httpAgent = proxyAgents.httpAgent;
    }
    safeConsole.log(`[JAF:PROXY] LiteLLM provider configured with proxy support`);
  } else {
    safeConsole.log(`[JAF:PROXY] LiteLLM provider configured without proxy (direct connection)`);
  }

  const client = new OpenAI(clientConfig);

  return {
    async getCompletion(state, agent, config) {
      const { model, params } = await buildChatCompletionParams(state, agent, config, baseURL);

      safeConsole.log(`📞 Calling model: ${model} with params: ${JSON.stringify(params, null, 2)}`);
      const resp = await client.chat.completions.create(
        params as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
      );

      // Return the choice with usage data attached for tracing
      return {
        ...resp.choices[0],
        usage: resp.usage,
        model: resp.model,
        id: resp.id,
        created: resp.created
      };
    },

    async *getCompletionStream(state, agent, config) {
      const { model, params: baseParams } = await buildChatCompletionParams(state, agent, config, baseURL);

      safeConsole.log(`📡 Streaming model: ${model} with params: ${JSON.stringify(baseParams, null, 2)}`);

      // Enable streaming on request
      const streamParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        ...baseParams,
        stream: true,
      };
      const stream = await client.chat.completions.create(streamParams);

      // Iterate OpenAI streaming chunks (choices[].delta.*)
      for await (const chunk of stream) {
        const choice = chunk?.choices?.[0];
        const delta = choice?.delta;

        if (!delta) {
          // Some keep-alive frames may not contain deltas
          const finish = choice?.finish_reason;
          if (finish) {
            yield { isDone: true, finishReason: finish, raw: chunk };
          }
          continue;
        }

        // Text content delta
        if (delta.content) {
          yield { delta: delta.content, raw: chunk };
        }

        // Tool call delta(s)
        if (Array.isArray(delta.tool_calls)) {
          for (const toolCall of delta.tool_calls) {
            const fn = toolCall.function || {};
            yield {
              toolCallDelta: {
                index: toolCall.index ?? 0,
                id: toolCall.id,
                type: 'function',
                function: {
                  name: fn.name,
                  argumentsDelta: fn.arguments,
                },
              },
              raw: chunk,
            };
          }
        }

        // Completion ended
        const finish = choice?.finish_reason;
        if (finish) {
          yield { isDone: true, finishReason: finish, raw: chunk };
        }
      }
    },
  };
};

const VISION_MODEL_CACHE_TTL = 5 * 60 * 1000;
const VISION_API_TIMEOUT = 3000;
const visionModelCache = new Map<string, { supports: boolean; timestamp: number }>();

async function isVisionModel(model: string, baseURL: string): Promise<boolean> {
  const cacheKey = `${baseURL}:${model}`;
  const cached = visionModelCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < VISION_MODEL_CACHE_TTL) {
    return cached.supports;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VISION_API_TIMEOUT);
    
    const response = await fetch(`${baseURL}/model_group/info`, {
      headers: {
        'accept': 'application/json'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data: any = await response.json();
      const modelInfo = data.data?.find((m: any) => 
        m.model_group === model || model.includes(m.model_group)
      );
      
      if (modelInfo?.supports_vision !== undefined) {
        const result = modelInfo.supports_vision;
        visionModelCache.set(cacheKey, { supports: result, timestamp: Date.now() });
        return result;
      }
    } else {
      safeConsole.warn(`Vision API returned status ${response.status} for model ${model}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        safeConsole.warn(`Vision API timeout for model ${model}`);
      } else {
        safeConsole.warn(`Vision API error for model ${model}: ${error.message}`);
      }
    } else {
      safeConsole.warn(`Unknown error checking vision support for model ${model}`);
    }
  }

  const knownVisionModels = [
    'gpt-4-vision-preview',
    'gpt-4o',
    'gpt-4o-mini', 
    'claude-sonnet-4',
    'claude-sonnet-4-20250514', 
    'gemini-2.5-flash',
    'gemini-2.5-pro'
  ];
  
  const isKnownVisionModel = knownVisionModels.some(visionModel => 
    model.toLowerCase().includes(visionModel.toLowerCase())
  );
  
  visionModelCache.set(cacheKey, { supports: isKnownVisionModel, timestamp: Date.now() });
  
  return isKnownVisionModel;
}

/**
 * Build common Chat Completions request parameters shared by both
 * getCompletion and getCompletionStream to avoid logic duplication.
 */
async function buildChatCompletionParams<Ctx>(
  state: Readonly<RunState<Ctx>>,
  agent: Readonly<Agent<Ctx, any>>,
  config: Readonly<RunConfig<Ctx>>,
  baseURL: string,
): Promise<{ model: string; params: OpenAI.Chat.Completions.ChatCompletionCreateParams }> {
  const model = agent.modelConfig?.name ?? config.modelOverride;

  if (!model) {
    throw new Error(`Model not specified for agent ${agent.name}`);
  }

  // Vision capability check if any image payload present
  const hasImageContent = state.messages.some(msg =>
    (Array.isArray(msg.content) && msg.content.some(part => (part as any).type === 'image_url')) ||
    (!!msg.attachments && msg.attachments.some(att => att.kind === 'image'))
  );
  if (hasImageContent) {
    const supportsVision = await isVisionModel(model, baseURL);
    if (!supportsVision) {
      throw new Error(
        `Model ${model} does not support vision capabilities. Please use a vision-capable model like gpt-4o, claude-3-5-sonnet, or gemini-1.5-pro.`
      );
    }
  }

  const systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
    role: 'system',
    content: agent.instructions(state),
  };

  const convertedMessages = await Promise.all(state.messages.map(convertMessage));
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    systemMessage,
    ...convertedMessages,
  ];

  const tools = agent.tools?.map(t => ({
    type: 'function' as const,
    function: {
      name: t.schema.name,
      description: t.schema.description,
      parameters: zodSchemaToJsonSchema(t.schema.parameters),
    },
  }));

  const lastMessage = state.messages[state.messages.length - 1];
  const isAfterToolCall = lastMessage?.role === 'tool';

  const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
    model,
    messages,
    temperature: agent.modelConfig?.temperature,
    max_tokens: agent.modelConfig?.maxTokens,
    tools: tools && tools.length > 0 ? tools : undefined,
    tool_choice: tools && tools.length > 0 ? (isAfterToolCall ? 'auto' : undefined) : undefined,
    response_format: agent.outputCodec ? { type: 'json_object' } : undefined,
  };

  return { model, params };
}

async function convertMessage(msg: Message): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
  switch (msg.role) {
    case 'user':
      if (Array.isArray(msg.content)) {
        return {
          role: 'user',
          content: msg.content.map(convertContentPart)
        };
      } else {
        return await buildChatMessageWithAttachments('user', msg);
      }
    case 'assistant':
      return {
        role: 'assistant',
        content: getTextContent(msg.content),
        tool_calls: msg.tool_calls as any
      };
    case 'tool':
      return {
        role: 'tool',
        content: getTextContent(msg.content),
        tool_call_id: msg.tool_call_id!
      };
    default:
      throw new Error(`Unknown message role: ${(msg as any).role}`);
  }
}

function convertContentPart(part: MessageContentPart): OpenAI.Chat.Completions.ChatCompletionContentPart {
  switch (part.type) {
    case 'text':
      return {
        type: 'text',
        text: part.text
      };
    case 'image_url':
      return {
        type: 'image_url',
        image_url: {
          url: part.image_url.url,
          detail: part.image_url.detail
        }
      };
    case 'file':
      return {
        type: 'file',
        file: {
          file_id: part.file.file_id,
          format: part.file.format
        }
      } as any;
    default:
      throw new Error(`Unknown content part type: ${(part as any).type}`);
  }
}

/**
 * If attachments exist, build multi-part content for Chat Completions.
 * Supports images via `image_url` and documents via content extraction.
 */
async function buildChatMessageWithAttachments(
  role: 'user' | 'assistant',
  msg: Message
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
  const hasAttachments = Array.isArray(msg.attachments) && msg.attachments.length > 0;
  if (!hasAttachments) {
    if (role === 'assistant') {
      return { role: 'assistant', content: getTextContent(msg.content), tool_calls: msg.tool_calls as any };
    }
    return { role: 'user', content: getTextContent(msg.content) };
  }

  const parts: any[] = [];
  const textContent = getTextContent(msg.content);
  if (textContent && textContent.trim().length > 0) {
    parts.push({ type: 'text', text: textContent });
  }

  for (const att of msg.attachments || []) {
    if (att.kind === 'image') {
      // Prefer explicit URL; otherwise construct a data URL from base64
      const url = att.url
        ? att.url
        : (att.data && att.mimeType)
          ? `data:${att.mimeType};base64,${att.data}`
          : undefined;
      if (url) {
        parts.push({ type: 'image_url', image_url: { url } });
      }
    } else if (att.kind === 'document' || att.kind === 'file') {
      // Check if attachment has useLiteLLMFormat flag or is a large document
      const useLiteLLMFormat = att.useLiteLLMFormat === true;
      
      if (useLiteLLMFormat && (att.url || att.data)) {
        // Use LiteLLM native file format for better handling of large documents
        const file_id = att.url || (att.data && att.mimeType ? `data:${att.mimeType};base64,${att.data}` : '');
        if (file_id) {
          parts.push({
            type: 'file',
            file: {
              file_id,
              format: att.mimeType || att.format
            }
          });
        }
      } else {
        // Extract document content if supported and we have data or URL
        if (isDocumentSupported(att.mimeType) && (att.data || att.url)) {
          try {
            const processed = await extractDocumentContent(att);
            const fileName = att.name || 'document';
            const description = getDocumentDescription(att.mimeType);
            
            parts.push({
              type: 'text',
              text: `DOCUMENT: ${fileName} (${description}):\n\n${processed.content}`
            });
          } catch (error) {
            // Fallback to filename if extraction fails
            const label = att.name || att.format || att.mimeType || 'attachment';
            parts.push({
              type: 'text',
              text: `ERROR: Failed to process ${att.kind}: ${label} (${error instanceof Error ? error.message : 'Unknown error'})`
            });
          }
        } else {
          // Unsupported document type - show placeholder
          const label = att.name || att.format || att.mimeType || 'attachment';
          parts.push({
            type: 'text',
            text: `ATTACHMENT: ${att.kind}: ${label}${att.url ? ` (${att.url})` : ''}`
          });
        }
      }
    }
  }

  const base: any = { role, content: parts };
  if (role === 'assistant' && msg.tool_calls) {
    base.tool_calls = msg.tool_calls as any;
  }
  return base as OpenAI.Chat.Completions.ChatCompletionMessageParam;
}

function zodSchemaToJsonSchema(zodSchema: any): any {
  if (zodSchema._def?.typeName === 'ZodObject') {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    
    for (const [key, value] of Object.entries(zodSchema._def.shape())) {
      properties[key] = zodSchemaToJsonSchema(value);
      if (!(value as any).isOptional()) {
        required.push(key);
      }
    }
    
    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false
    };
  }
  
  if (zodSchema._def?.typeName === 'ZodString') {
    const schema: any = { type: 'string' };
    if (zodSchema._def.description) {
      schema.description = zodSchema._def.description;
    }
    return schema;
  }
  
  if (zodSchema._def?.typeName === 'ZodNumber') {
    return { type: 'number' };
  }
  
  if (zodSchema._def?.typeName === 'ZodBoolean') {
    return { type: 'boolean' };
  }
  
  if (zodSchema._def?.typeName === 'ZodArray') {
    return {
      type: 'array',
      items: zodSchemaToJsonSchema(zodSchema._def.type)
    };
  }
  
  if (zodSchema._def?.typeName === 'ZodOptional') {
    return zodSchemaToJsonSchema(zodSchema._def.innerType);
  }
  
  if (zodSchema._def?.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: zodSchema._def.values
    };
  }
  
  return { type: 'string', description: 'Unsupported schema type' };
}

<environment_details>
# Visual Studio Code Visible Files
src/core/engine.ts

# Visual Studio Code Open Tabs
src/core/engine.ts
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 12:37:30 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
68,245 / 200K tokens used (34%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


Now I have all the information I need. Let me create a comprehensive documentation file explaining JAF's LLM interaction mechanics.

<write_to_file>
<path>docs/llm-prompting-and-turns.md</path>
<content># JAF LLM Prompting and Turn Mechanics

**A comprehensive guide to understanding how JAF constructs prompts, manages conversations, and defines execution turns.**

---

## Table of Contents
1. [Prompt Construction](#prompt-construction)
2. [What JAF Adds to Prompts](#what-jaf-adds-to-prompts)
3. [Tool Calling Format](#tool-calling-format)
4. [Turn Definition and Examples](#turn-definition-and-examples)
5. [Handoff and Sub-Agent Prompting](#handoff-and-sub-agent-prompting)
6. [Planning Logic](#planning-logic)

---

## 1. Prompt Construction

### How a Prompt is Built

When a query comes to an agent, JAF constructs the LLM prompt using the **OpenAI Chat Completions format**:

```typescript
// From src/providers/model.ts - buildChatCompletionParams()

{
  model: "gpt-4o",
  messages: [
    {
      role: "system",
      content: agent.instructions(state)  // ← Agent's instructions
    },
    {
      role: "user",
      content: "User's query here"        // ← User message
    }
  ],
  tools: [...],      // ← Available tools
  temperature: 0.7,
  max_tokens: 2000
}
```

### Message Flow

**Initial Request:**
```javascript
// User sends a message
const userMessage = { role: 'user', content: 'Book a flight to NYC' };

// JAF adds it to the message array
state.messages = [userMessage];

// JAF builds the prompt:
const prompt = {
  messages: [
    { role: 'system', content: agent.instructions(state) },
    { role: 'user', content: 'Book a flight to NYC' }
  ]
}
```

**After Each Turn:**
```javascript
// State accumulates conversation history
state.messages = [
  { role: 'user', content: 'Book a flight to NYC' },
  { role: 'assistant', content: 'Let me search flights...', tool_calls: [...] },
  { role: 'tool', tool_call_id: 'call_123', content: '{"flights": [...]}' },
  { role: 'assistant', content: 'I found 3 flights...' }
];

// ENTIRE history goes to LLM on EVERY call
```

---

## 2. What JAF Adds to Prompts

### System Message: Agent Instructions

JAF **always** prepends a system message with the agent's instructions:

```typescript
// From src/core/types.ts
type Agent = {
  name: string;
  instructions: (state: RunState<Ctx>) => string;  // ← Function that returns instructions
  // ...
}

// Example agent:
const bookingAgent = {
  name: 'booking_agent',
  instructions: (state) => `
    You are a flight booking assistant.
    Current user: ${state.context.userId}
    Available tools: search_flights, book_flight
    
    Instructions:
    1. First search for available flights
    2. Present options to user
    3. Only book after user confirms
  `,
  tools: [searchFlightsTool, bookFlightTool]
}
```

**What gets sent to LLM:**
```json
{
  "role": "system",
  "content": "You are a flight booking assistant.\nCurrent user: user_123\nAvailable tools: search_flights, book_flight\n\nInstructions:\n1. First search for available flights\n2. Present options to user\n3. Only book after user confirms"
}
```

### Tools Array

JAF converts your tools to OpenAI's function calling format:

```typescript
// From src/providers/model.ts
const tools = agent.tools?.map(t => ({
  type: 'function',
  function: {
    name: t.schema.name,
    description: t.schema.description,
    parameters: zodSchemaToJsonSchema(t.schema.parameters)  // ← Zod to JSON Schema
  }
}));
```

**Example Conversion:**
```typescript
// JAF Tool Definition
const searchFlightsTool = {
  schema: {
    name: 'search_flights',
    description: 'Search for available flights',
    parameters: z.object({
      origin: z.string().describe('Departure airport code'),
      destination: z.string().describe('Arrival airport code'),
      date: z.string().describe('Travel date in YYYY-MM-DD format')
    })
  },
  execute: async (args, context) => { /* ... */ }
}

// Becomes (sent to LLM):
{
  type: "function",
  function: {
    name: "search_flights",
    description: "Search for available flights",
    parameters: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Departure airport code" },
        destination: { type: "string", description: "Arrival airport code" },
        date: { type: "string", description: "Travel date in YYYY-MM-DD format" }
      },
      required: ["origin", "destination", "date"],
      additionalProperties: false
    }
  }
}
```

### Complete Prompt Example

```typescript
// What actually gets sent to the LLM:
{
  model: "gpt-4o",
  messages: [
    {
      role: "system",
      content: "You are a flight booking assistant..."  // Agent instructions
    },
    {
      role: "user",
      content: "Book a flight from NYC to LAX on 2024-12-25"
    }
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "search_flights",
        description: "Search for available flights",
        parameters: { /* JSON Schema */ }
      }
    },
    {
      type: "function",
      function: {
        name: "book_flight",
        description: "Book a specific flight",
        parameters: { /* JSON Schema */ }
      }
    }
  ],
  temperature: 0.7,
  max_tokens: 2000,
  tool_choice: "auto"  // LLM decides whether to use tools
}
```

### JAF Does NOT Add:

❌ **No planning prompts** - JAF does not inject prompts like "First create a plan" or "Break down into steps"
❌ **No todo list management** - No automatic task tracking
❌ **No chain-of-thought** - No forced reasoning format
❌ **No reflection loops** - No self-critique mechanisms

**The agent's `instructions` function is YOUR responsibility** - you control the entire system message.

---

## 3. Tool Calling Format

### LLM Response Format

The LLM returns tool calls in a specific format that JAF expects:

```json
// LLM Response
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "search_flights",
        "arguments": "{\"origin\":\"NYC\",\"destination\":\"LAX\",\"date\":\"2024-12-25\"}"
      }
    }
  ]
}
```

### Schema Definition

**JAF handles this automatically** - you don't specify the output format for tool calls. The schema is defined by:

1. **Zod schemas in tool definitions** (converted to JSON Schema)
2. **OpenAI's function calling protocol** (standard format)

```typescript
// You define this:
const tool = {
  schema: {
    name: 'my_tool',
    description: 'Does something',
    parameters: z.object({       // ← Zod schema
      param1: z.string(),
      param2: z.number()
    })
  }
}

// JAF converts to JSON Schema automatically
// LLM returns in OpenAI function calling format automatically
// JAF validates using the Zod schema automatically
```

### Validation Flow

```typescript
// From src/core/engine.ts - executeToolCalls()

// 1. LLM returns tool call
const toolCall = {
  id: "call_123",
  function: {
    name: "search_flights",
    arguments: '{"origin":"NYC","destination":"LAX"}'
  }
}

// 2. JAF parses arguments
const rawArgs = JSON.parse(toolCall.function.arguments);

// 3. JAF validates against Zod schema
const parseResult = tool.schema.parameters.safeParse(rawArgs);

if (!parseResult.success) {
  // Return validation error to LLM
  return {
    role: 'tool',
    content: JSON.stringify({
      status: "validation_error",
      message: `Invalid arguments: ${parseResult.error.message}`
    }),
    tool_call_id: toolCall.id
  };
}

// 4. Execute tool with validated args
const result = await tool.execute(parseResult.data, context);
```

---

## 4. Turn Definition and Examples

### What is a "Turn"?

**A turn is a single LLM call** (one request-response cycle with the LLM).

```typescript
// From src/core/types.ts
type RunState = {
  turnCount: number;  // Incremented after each LLM call
  // ...
}
```

### Turn Flow

```
Turn 1: User message → LLM → Assistant response with tool call
Turn 2: Tool results → LLM → Assistant response with another tool call
Turn 3: Tool results → LLM → Final answer
```

### Example: Multi-Turn Conversation

```typescript
// TURN 0 - Initial State
state = {
  messages: [],
  turnCount: 0
}

// User sends message
state.messages.push({ role: 'user', content: 'Book flight NYC to LAX Dec 25' });

// ============ TURN 1 ============
// Engine calls LLM with:
// - System: agent instructions
// - User: "Book flight NYC to LAX Dec 25"

// LLM Response:
{
  role: 'assistant',
  content: 'Let me search for flights',
  tool_calls: [{ 
    id: 'call_1',
    function: { name: 'search_flights', arguments: '{"origin":"NYC",...}' }
  }]
}

// State updated:
state = {
  messages: [
    { role: 'user', content: 'Book flight NYC to LAX Dec 25' },
    { role: 'assistant', content: 'Let me search...', tool_calls: [...] }
  ],
  turnCount: 1  // ← Incremented
}

// Tool executes, result added:
state.messages.push({
  role: 'tool',
  tool_call_id: 'call_1',
  content: '{"flights": [...], "status": "executed"}'
});

// ============ TURN 2 ============
// Engine calls LLM again with ALL messages:
// - System: agent instructions
// - User: "Book flight NYC to LAX Dec 25"
// - Assistant: "Let me search..." + tool_calls
// - Tool: search results

// LLM Response:
{
  role: 'assistant',
  content: 'I found 3 flights. Would you like to book flight AA101 for $450?'
}

// State updated:
state = {
  messages: [
    { role: 'user', content: 'Book flight NYC to LAX Dec 25' },
    { role: 'assistant', content: 'Let me search...', tool_calls: [...] },
    { role: 'tool', content: '{"flights": [...]}' },
    { role: 'assistant', content: 'I found 3 flights...' }
  ],
  turnCount: 2  // ← Incremented again
}

// No tool calls → Completed!
```

### Turn Counting Rules

```typescript
// From src/core/engine.ts
const maxTurns = config.maxTurns ?? 50;  // Default: 50 turns

if (state.turnCount >= maxTurns) {
  return {
    outcome: {
      status: 'error',
      error: { _tag: 'MaxTurnsExceeded', turns: state.turnCount }
    }
  };
}
```

**Important:**
- ✅ Each LLM call = 1 turn
- ✅ Tool execution does NOT count as a turn
- ✅ Multiple tool calls in one LLM response = still 1 turn
- ✅ The next LLM call after tool execution = new turn

### Example: Complex Multi-Turn

```
User: "Find cheapest flight NYC to LAX, check weather, book if good"

Turn 1: LLM → Calls search_flights + check_weather (parallel)
        Tool executes both → Results added to messages
        
Turn 2: LLM → Analyzes results, decides to book
        LLM → Calls book_flight
        Tool executes → Booking confirmed
        
Turn 3: LLM → Reads booking result
        LLM → Returns final confirmation message
        No tool calls → DONE

Total turns: 3
Total tool executions: 3 (but spread across 2 turns)
```

---

## 5. Handoff and Sub-Agent Prompting

### Handoff: Same-Level Agent Transfer

When an agent hands off to another agent:

```typescript
// From src/core/engine.ts

// Agent A's messages:
const stateBeforeHandoff = {
  messages: [
    { role: 'user', content: 'I need billing help' },
    { role: 'assistant', content: 'Let me connect you...', tool_calls: [...] },
    { role: 'tool', content: '{"handoff_to": "billing_agent"}' }
  ],
  currentAgentName: 'triage_agent',
  turnCount: 1
}

// After handoff:
const stateAfterHandoff = {
  messages: [
    { role: 'user', content: 'I need billing help' },
    { role: 'assistant', content: 'Let me connect you...', tool_calls: [...] },
    { role: 'tool', content: '{"handoff_to": "billing_agent"}' }
  ],
  currentAgentName: 'billing_agent',  // ← Changed!
  turnCount: 1  // ← Same! Handoff is NOT a turn
}
```

**What prompt does billing_agent see?**

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a billing specialist..."  // ← billing_agent's instructions
    },
    {
      "role": "user",
      "content": "I need billing help"
    },
    {
      "role": "assistant",
      "content": "Let me connect you to billing...",
      "tool_calls": [...]
    },
    {
      "role": "tool",
      "content": "{\"handoff_to\": \"billing_agent\"}"
    }
  ]
}
```

**Key points:**
- ✅ **Conversation history is preserved** - all messages passed to new agent
- ✅ **System message changes** - new agent's instructions replace old ones
- ✅ **Tools change** - new agent's tools are now available
- ❌ **Previous agent's instructions are NOT included** - only current agent's system message

### Agent-as-Tool: Parent-Child Execution

When using a sub-agent as a tool:

```typescript
// From src/core/agent-as-tool.ts

// Parent agent state:
const parentState = {
  messages: [
    { role: 'user', content: 'Summarize this article: [long text]' }
  ],
  currentAgentName: 'main_agent',
  turnCount: 0
}

// Parent calls summarize_text tool (which is a wrapped agent)
// Child gets ISOLATED state:
const childState = {
  runId: 'new-run-123',        // ← New run ID
  traceId: parentState.traceId, // ← Same trace (for tracking)
  messages: [
    { role: 'user', content: '[long text]' }  // ← ONLY the input!
  ],
  currentAgentName: 'summarizer',
  context: parentState.context,  // ← Shared context
  turnCount: 0,                  // ← Reset!
  approvals: new Map()           // ← Fresh approvals
}
```

**What prompt does the child agent see?**

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a summarization expert..."  // ← Child's instructions
    },
    {
      "role": "user",
      "content": "[long article text]"  // ← ONLY the input passed to tool
    }
  ]
}
```

**Key differences from handoff:**
- ❌ **No parent conversation history** - child starts fresh
- ❌ **Parent's instructions NOT included** - only child's system message
- ✅ **Isolated execution** - child has own turn limit (default: 5 for agent-as-tool)
- ✅ **Returns to parent** - child's output becomes tool result

### Turn Counting with Sub-Agents

```typescript
// Parent agent execution:
Turn 1: User message → Parent LLM → Calls summarize_text tool
        ↓
        Child agent sub-run starts:
          Child Turn 1: Input → Child LLM → Returns summary
        Child returns result
        ↓
        Parent receives: "Summary: The article discusses..."

Turn 2: Tool result → Parent LLM → Final response
        Parent responds: "Here's the summary I created..."

// Parent turn count: 2
// Child turn count: 1 (separate counter, doesn't affect parent)
```

### Nested Sub-Agents Example

```typescript
// Level 1: Main Agent (turnCount: 0)
User: "Analyze this data and create visualizations"
  ↓ Turn 1: Calls data_processor tool (agent-as-tool)
  
    // Level 2: Data Processor (turnCount: 0, isolated)
    Input: [raw data]
      ↓ Turn 1: Calls statistics_calculator tool (nested agent-as-tool!)
      
        // Level 3: Stats Calculator (turnCount: 0, isolated)
        Input: [numbers]
          ↓ Turn 1: Uses math tools, returns stats
        Returns: {"mean": 42, "median": 40}
      
      ↓ Turn 2: Receives stats, processes data
    Returns: {"processed": [...], "stats": {...}}
  
  ↓ Turn 2: Receives processed data, creates visualizations
Returns: "Here are your visualizations..."

// Each level has independent turn counters!
```

---

## 6. Planning Logic

### JAF Does NOT Provide Built-in Planning

JAF is a **low-level framework** - it does NOT automatically:
- ❌ Create plans
- ❌ Generate todo lists
- ❌ Break tasks into subtasks
- ❌ Track progress
- ❌ Reflect on performance

### You Must Implement Planning in Agent Instructions

If you want planning behavior, add it to your agent's instructions:

```typescript
const planningAgent = {
  name: 'planner',
  instructions: (state) => `
    You are a task planning assistant.
    
    ALWAYS follow this process:
    1. ANALYZE: Understand the user's request
    2. PLAN: Break down into clear steps
    3. EXECUTE: Complete each step using available tools
    4. VERIFY: Check if the goal is achieved
    
    For each task, create a plan in this format:
    ## Plan
    - [ ] Step 1: Description
    - [ ] Step 2: Description
    - [ ] Step 3: Description
    
    Then execute each step and update the checklist.
    
    Available tools: ${state.context.tools.join(', ')}
  `,
  tools: [...]
}
```

### Example: Multi-Step Planning Agent

```typescript
const complexTaskAgent = {
  name: 'complex_task_agent',
  instructions: (state) => `
    You are an advanced task executor with planning capabilities.
    
    ## Your Process:
    
    ### Phase 1: Planning
    - Analyze the user's request
    - Identify all required steps
    - Determine dependencies between steps
    - Create a numbered plan
    
    ### Phase 2: Execution
    - Execute steps in order
    - Use tools as needed
    - Track completion status
    - Handle errors gracefully
    
    ### Phase 3: Verification
    - Verify each step's output
    - Check if the overall goal is met
    - Provide a summary
    
    ## Response Format:
    
    When given a complex task, ALWAYS start with:
    
    "Let me break this down into steps:
    1. [Step 1 description]
    2. [Step 2 description]
    3. [Step 3 description]
    
    Now executing..."
    
    Then proceed to use tools and report progress.
    
    Current task context: ${JSON.stringify(state.context)}
  `,
  tools: [searchTool, analyzeTool, createTool, verifyTool]
}
```

### Alternative: Use Agent-as-Tool for Planning

You can create a dedicated planning agent and use it as a tool:

```typescript
// Planning sub-agent
const plannerAgent = {
  name: 'planner',
  instructions: () => `
    You are a planning specialist.
    
    Given a task, create a detailed execution plan with:
    - Clear steps
    - Resource requirements
    - Expected outcomes
    - Risk factors
    
    Output format:
    {
      "steps": [
        {"id": 1, "action": "...", "tools": [...], "expected_outcome": "..."},
        {"id": 2, "action": "...", "tools": [...], "expected_outcome": "..."}
      ],
      "dependencies": [[1, 2]],  // Step 2 depends on step 1
      "estimated_turns": 5
    }
  `,
  outputCodec: z.object({
    steps: z.array(z.object({
      id: z.number(),
      action: z.string(),
      tools: z.array(z.string()),
      expected_outcome: z.string()
    })),
    dependencies: z.array(z.array(z.number())),
    estimated_turns: z.number()
  })
}

// Main agent uses planner
const mainAgent = {
  name: 'executor',
  instructions: () => 'Execute tasks using the create_plan tool first',
  tools: [
    agentAsTool(plannerAgent, { toolName: 'create_plan' }),
    actualExecutionTools...
  ]
}
```

---

## Summary

### Key Takeaways

**Prompt Construction:**
- System message = `agent.instructions(state)`
- Conversation history = entire `state.messages` array
- Tools = auto-converted from Zod to JSON Schema
- Same prompt structure goes to LLM **every turn**

**JAF Additions:**
- ✅ System message (agent instructions)
- ✅ Tools array (function definitions)
- ✅ Message formatting (OpenAI Chat format)
- ❌ NO planning prompts
- ❌ NO todo management
- ❌ NO automatic reasoning

**Tool Calling:**
- Schema defined via Zod in tool definition
- LLM returns OpenAI function calling format
- JAF validates automatically
- You don't specify output format

**Turns:**
- 1 turn = 1 LLM call
- Tool execution ≠ turn
- Multiple tools in one response = 1 turn
- Default max: 50 turns

**Handoffs:**
- Same conversation history
- New agent's instructions replace old ones
- New agent's tools replace old ones
- NOT counted as a turn

**Sub-Agents:**
- Isolated execution (new messages array)
- Only receives tool input
- Independent turn counter
- Returns result to parent

**Planning:**
- YOU implement it in `instructions`
- OR create dedicated planner agent
- OR use agent-as-tool pattern
- JAF doesn't enforce any structure

---

## References

- [Core Engine](../src/core/engine.ts) - Main execution loop
- [Model Provider](../src/providers/model.ts) - Prompt construction
- [Agent-as-Tool](../src/core/agent-as-tool.ts) - Sub-agent mechanics
- [Types](../src/core/types.ts) - Core type definitions
</content>
<task_progress>
- [x] Examine how prompts are constructed for LLM calls
- [x] Check what JAF adds to prompts
- [x] Understand tool calling format and schema
- [x] Analyze handoff/sub-agent prompt behavior
- [x] Define "turn" concept with examples
- [x] Check for built-in planning logic
- [x] Create comprehensive documentation
</task_progress>
</write_to_file>

---

**User:**

[write_to_file for 'docs/llm-prompting-and-turns.md'] Result:
The content was successfully saved to docs/llm-prompting-and-turns.md.

Here is the full, updated content of the file that was saved:

<final_file_content path="docs/llm-prompting-and-turns.md">
# JAF LLM Prompting and Turn Mechanics

**A comprehensive guide to understanding how JAF constructs prompts, manages conversations, and defines execution turns.**

---

## Table of Contents
1. [Prompt Construction](#prompt-construction)
2. [What JAF Adds to Prompts](#what-jaf-adds-to-prompts)
3. [Tool Calling Format](#tool-calling-format)
4. [Turn Definition and Examples](#turn-definition-and-examples)
5. [Handoff and Sub-Agent Prompting](#handoff-and-sub-agent-prompting)
6. [Planning Logic](#planning-logic)

---

## 1. Prompt Construction

### How a Prompt is Built

When a query comes to an agent, JAF constructs the LLM prompt using the **OpenAI Chat Completions format**:

```typescript
// From src/providers/model.ts - buildChatCompletionParams()

{
  model: "gpt-4o",
  messages: [
    {
      role: "system",
      content: agent.instructions(state)  // ← Agent's instructions
    },
    {
      role: "user",
      content: "User's query here"        // ← User message
    }
  ],
  tools: [...],      // ← Available tools
  temperature: 0.7,
  max_tokens: 2000
}
```

### Message Flow

**Initial Request:**
```javascript
// User sends a message
const userMessage = { role: 'user', content: 'Book a flight to NYC' };

// JAF adds it to the message array
state.messages = [userMessage];

// JAF builds the prompt:
const prompt = {
  messages: [
    { role: 'system', content: agent.instructions(state) },
    { role: 'user', content: 'Book a flight to NYC' }
  ]
}
```

**After Each Turn:**
```javascript
// State accumulates conversation history
state.messages = [
  { role: 'user', content: 'Book a flight to NYC' },
  { role: 'assistant', content: 'Let me search flights...', tool_calls: [...] },
  { role: 'tool', tool_call_id: 'call_123', content: '{"flights": [...]}' },
  { role: 'assistant', content: 'I found 3 flights...' }
];

// ENTIRE history goes to LLM on EVERY call
```

---

## 2. What JAF Adds to Prompts

### System Message: Agent Instructions

JAF **always** prepends a system message with the agent's instructions:

```typescript
// From src/core/types.ts
type Agent = {
  name: string;
  instructions: (state: RunState<Ctx>) => string;  // ← Function that returns instructions
  // ...
}

// Example agent:
const bookingAgent = {
  name: 'booking_agent',
  instructions: (state) => `
    You are a flight booking assistant.
    Current user: ${state.context.userId}
    Available tools: search_flights, book_flight
    
    Instructions:
    1. First search for available flights
    2. Present options to user
    3. Only book after user confirms
  `,
  tools: [searchFlightsTool, bookFlightTool]
}
```

**What gets sent to LLM:**
```json
{
  "role": "system",
  "content": "You are a flight booking assistant.\nCurrent user: user_123\nAvailable tools: search_flights, book_flight\n\nInstructions:\n1. First search for available flights\n2. Present options to user\n3. Only book after user confirms"
}
```

### Tools Array

JAF converts your tools to OpenAI's function calling format:

```typescript
// From src/providers/model.ts
const tools = agent.tools?.map(t => ({
  type: 'function',
  function: {
    name: t.schema.name,
    description: t.schema.description,
    parameters: zodSchemaToJsonSchema(t.schema.parameters)  // ← Zod to JSON Schema
  }
}));
```

**Example Conversion:**
```typescript
// JAF Tool Definition
const searchFlightsTool = {
  schema: {
    name: 'search_flights',
    description: 'Search for available flights',
    parameters: z.object({
      origin: z.string().describe('Departure airport code'),
      destination: z.string().describe('Arrival airport code'),
      date: z.string().describe('Travel date in YYYY-MM-DD format')
    })
  },
  execute: async (args, context) => { /* ... */ }
}

// Becomes (sent to LLM):
{
  type: "function",
  function: {
    name: "search_flights",
    description: "Search for available flights",
    parameters: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Departure airport code" },
        destination: { type: "string", description: "Arrival airport code" },
        date: { type: "string", description: "Travel date in YYYY-MM-DD format" }
      },
      required: ["origin", "destination", "date"],
      additionalProperties: false
    }
  }
}
```

### Complete Prompt Example

```typescript
// What actually gets sent to the LLM:
{
  model: "gpt-4o",
  messages: [
    {
      role: "system",
      content: "You are a flight booking assistant..."  // Agent instructions
    },
    {
      role: "user",
      content: "Book a flight from NYC to LAX on 2024-12-25"
    }
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "search_flights",
        description: "Search for available flights",
        parameters: { /* JSON Schema */ }
      }
    },
    {
      type: "function",
      function: {
        name: "book_flight",
        description: "Book a specific flight",
        parameters: { /* JSON Schema */ }
      }
    }
  ],
  temperature: 0.7,
  max_tokens: 2000,
  tool_choice: "auto"  // LLM decides whether to use tools
}
```

### JAF Does NOT Add:

❌ **No planning prompts** - JAF does not inject prompts like "First create a plan" or "Break down into steps"
❌ **No todo list management** - No automatic task tracking
❌ **No chain-of-thought** - No forced reasoning format
❌ **No reflection loops** - No self-critique mechanisms

**The agent's `instructions` function is YOUR responsibility** - you control the entire system message.

---

## 3. Tool Calling Format

### LLM Response Format

The LLM returns tool calls in a specific format that JAF expects:

```json
// LLM Response
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "search_flights",
        "arguments": "{\"origin\":\"NYC\",\"destination\":\"LAX\",\"date\":\"2024-12-25\"}"
      }
    }
  ]
}
```

### Schema Definition

**JAF handles this automatically** - you don't specify the output format for tool calls. The schema is defined by:

1. **Zod schemas in tool definitions** (converted to JSON Schema)
2. **OpenAI's function calling protocol** (standard format)

```typescript
// You define this:
const tool = {
  schema: {
    name: 'my_tool',
    description: 'Does something',
    parameters: z.object({       // ← Zod schema
      param1: z.string(),
      param2: z.number()
    })
  }
}

// JAF converts to JSON Schema automatically
// LLM returns in OpenAI function calling format automatically
// JAF validates using the Zod schema automatically
```

### Validation Flow

```typescript
// From src/core/engine.ts - executeToolCalls()

// 1. LLM returns tool call
const toolCall = {
  id: "call_123",
  function: {
    name: "search_flights",
    arguments: '{"origin":"NYC","destination":"LAX"}'
  }
}

// 2. JAF parses arguments
const rawArgs = JSON.parse(toolCall.function.arguments);

// 3. JAF validates against Zod schema
const parseResult = tool.schema.parameters.safeParse(rawArgs);

if (!parseResult.success) {
  // Return validation error to LLM
  return {
    role: 'tool',
    content: JSON.stringify({
      status: "validation_error",
      message: `Invalid arguments: ${parseResult.error.message}`
    }),
    tool_call_id: toolCall.id
  };
}

// 4. Execute tool with validated args
const result = await tool.execute(parseResult.data, context);
```

---

## 4. Turn Definition and Examples

### What is a "Turn"?

**A turn is a single LLM call** (one request-response cycle with the LLM).

```typescript
// From src/core/types.ts
type RunState = {
  turnCount: number;  // Incremented after each LLM call
  // ...
}
```

### Turn Flow

```
Turn 1: User message → LLM → Assistant response with tool call
Turn 2: Tool results → LLM → Assistant response with another tool call
Turn 3: Tool results → LLM → Final answer
```

### Example: Multi-Turn Conversation

```typescript
// TURN 0 - Initial State
state = {
  messages: [],
  turnCount: 0
}

// User sends message
state.messages.push({ role: 'user', content: 'Book flight NYC to LAX Dec 25' });

// ============ TURN 1 ============
// Engine calls LLM with:
// - System: agent instructions
// - User: "Book flight NYC to LAX Dec 25"

// LLM Response:
{
  role: 'assistant',
  content: 'Let me search for flights',
  tool_calls: [{ 
    id: 'call_1',
    function: { name: 'search_flights', arguments: '{"origin":"NYC",...}' }
  }]
}

// State updated:
state = {
  messages: [
    { role: 'user', content: 'Book flight NYC to LAX Dec 25' },
    { role: 'assistant', content: 'Let me search...', tool_calls: [...] }
  ],
  turnCount: 1  // ← Incremented
}

// Tool executes, result added:
state.messages.push({
  role: 'tool',
  tool_call_id: 'call_1',
  content: '{"flights": [...], "status": "executed"}'
});

// ============ TURN 2 ============
// Engine calls LLM again with ALL messages:
// - System: agent instructions
// - User: "Book flight NYC to LAX Dec 25"
// - Assistant: "Let me search..." + tool_calls
// - Tool: search results

// LLM Response:
{
  role: 'assistant',
  content: 'I found 3 flights. Would you like to book flight AA101 for $450?'
}

// State updated:
state = {
  messages: [
    { role: 'user', content: 'Book flight NYC to LAX Dec 25' },
    { role: 'assistant', content: 'Let me search...', tool_calls: [...] },
    { role: 'tool', content: '{"flights": [...]}' },
    { role: 'assistant', content: 'I found 3 flights...' }
  ],
  turnCount: 2  // ← Incremented again
}

// No tool calls → Completed!
```

### Turn Counting Rules

```typescript
// From src/core/engine.ts
const maxTurns = config.maxTurns ?? 50;  // Default: 50 turns

if (state.turnCount >= maxTurns) {
  return {
    outcome: {
      status: 'error',
      error: { _tag: 'MaxTurnsExceeded', turns: state.turnCount }
    }
  };
}
```

**Important:**
- ✅ Each LLM call = 1 turn
- ✅ Tool execution does NOT count as a turn
- ✅ Multiple tool calls in one LLM response = still 1 turn
- ✅ The next LLM call after tool execution = new turn

### Example: Complex Multi-Turn

```
User: "Find cheapest flight NYC to LAX, check weather, book if good"

Turn 1: LLM → Calls search_flights + check_weather (parallel)
        Tool executes both → Results added to messages
        
Turn 2: LLM → Analyzes results, decides to book
        LLM → Calls book_flight
        Tool executes → Booking confirmed
        
Turn 3: LLM → Reads booking result
        LLM → Returns final confirmation message
        No tool calls → DONE

Total turns: 3
Total tool executions: 3 (but spread across 2 turns)
```

---

## 5. Handoff and Sub-Agent Prompting

### Handoff: Same-Level Agent Transfer

When an agent hands off to another agent:

```typescript
// From src/core/engine.ts

// Agent A's messages:
const stateBeforeHandoff = {
  messages: [
    { role: 'user', content: 'I need billing help' },
    { role: 'assistant', content: 'Let me connect you...', tool_calls: [...] },
    { role: 'tool', content: '{"handoff_to": "billing_agent"}' }
  ],
  currentAgentName: 'triage_agent',
  turnCount: 1
}

// After handoff:
const stateAfterHandoff = {
  messages: [
    { role: 'user', content: 'I need billing help' },
    { role: 'assistant', content: 'Let me connect you...', tool_calls: [...] },
    { role: 'tool', content: '{"handoff_to": "billing_agent"}' }
  ],
  currentAgentName: 'billing_agent',  // ← Changed!
  turnCount: 1  // ← Same! Handoff is NOT a turn
}
```

**What prompt does billing_agent see?**

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a billing specialist..."  // ← billing_agent's instructions
    },
    {
      "role": "user",
      "content": "I need billing help"
    },
    {
      "role": "assistant",
      "content": "Let me connect you to billing...",
      "tool_calls": [...]
    },
    {
      "role": "tool",
      "content": "{\"handoff_to\": \"billing_agent\"}"
    }
  ]
}
```

**Key points:**
- ✅ **Conversation history is preserved** - all messages passed to new agent
- ✅ **System message changes** - new agent's instructions replace old ones
- ✅ **Tools change** - new agent's tools are now available
- ❌ **Previous agent's instructions are NOT included** - only current agent's system message

### Agent-as-Tool: Parent-Child Execution

When using a sub-agent as a tool:

```typescript
// From src/core/agent-as-tool.ts

// Parent agent state:
const parentState = {
  messages: [
    { role: 'user', content: 'Summarize this article: [long text]' }
  ],
  currentAgentName: 'main_agent',
  turnCount: 0
}

// Parent calls summarize_text tool (which is a wrapped agent)
// Child gets ISOLATED state:
const childState = {
  runId: 'new-run-123',        // ← New run ID
  traceId: parentState.traceId, // ← Same trace (for tracking)
  messages: [
    { role: 'user', content: '[long text]' }  // ← ONLY the input!
  ],
  currentAgentName: 'summarizer',
  context: parentState.context,  // ← Shared context
  turnCount: 0,                  // ← Reset!
  approvals: new Map()           // ← Fresh approvals
}
```

**What prompt does the child agent see?**

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a summarization expert..."  // ← Child's instructions
    },
    {
      "role": "user",
      "content": "[long article text]"  // ← ONLY the input passed to tool
    }
  ]
}
```

**Key differences from handoff:**
- ❌ **No parent conversation history** - child starts fresh
- ❌ **Parent's instructions NOT included** - only child's system message
- ✅ **Isolated execution** - child has own turn limit (default: 5 for agent-as-tool)
- ✅ **Returns to parent** - child's output becomes tool result

### Turn Counting with Sub-Agents

```typescript
// Parent agent execution:
Turn 1: User message → Parent LLM → Calls summarize_text tool
        ↓
        Child agent sub-run starts:
          Child Turn 1: Input → Child LLM → Returns summary
        Child returns result
        ↓
        Parent receives: "Summary: The article discusses..."

Turn 2: Tool result → Parent LLM → Final response
        Parent responds: "Here's the summary I created..."

// Parent turn count: 2
// Child turn count: 1 (separate counter, doesn't affect parent)
```

### Nested Sub-Agents Example

```typescript
// Level 1: Main Agent (turnCount: 0)
User: "Analyze this data and create visualizations"
  ↓ Turn 1: Calls data_processor tool (agent-as-tool)
  
    // Level 2: Data Processor (turnCount: 0, isolated)
    Input: [raw data]
      ↓ Turn 1: Calls statistics_calculator tool (nested agent-as-tool!)
      
        // Level 3: Stats Calculator (turnCount: 0, isolated)
        Input: [numbers]
          ↓ Turn 1: Uses math tools, returns stats
        Returns: {"mean": 42, "median": 40}
      
      ↓ Turn 2: Receives stats, processes data
    Returns: {"processed": [...], "stats": {...}}
  
  ↓ Turn 2: Receives processed data, creates visualizations
Returns: "Here are your visualizations..."

// Each level has independent turn counters!
```

---

## 6. Planning Logic

### JAF Does NOT Provide Built-in Planning

JAF is a **low-level framework** - it does NOT automatically:
- ❌ Create plans
- ❌ Generate todo lists
- ❌ Break tasks into subtasks
- ❌ Track progress
- ❌ Reflect on performance

### You Must Implement Planning in Agent Instructions

If you want planning behavior, add it to your agent's instructions:

```typescript
const planningAgent = {
  name: 'planner',
  instructions: (state) => `
    You are a task planning assistant.
    
    ALWAYS follow this process:
    1. ANALYZE: Understand the user's request
    2. PLAN: Break down into clear steps
    3. EXECUTE: Complete each step using available tools
    4. VERIFY: Check if the goal is achieved
    
    For each task, create a plan in this format:
    ## Plan
    - [ ] Step 1: Description
    - [ ] Step 2: Description
    - [ ] Step 3: Description
    
    Then execute each step and update the checklist.
    
    Available tools: ${state.context.tools.join(', ')}
  `,
  tools: [...]
}
```

### Example: Multi-Step Planning Agent

```typescript
const complexTaskAgent = {
  name: 'complex_task_agent',
  instructions: (state) => `
    You are an advanced task executor with planning capabilities.
    
    ## Your Process:
    
    ### Phase 1: Planning
    - Analyze the user's request
    - Identify all required steps
    - Determine dependencies between steps
    - Create a numbered plan
    
    ### Phase 2: Execution
    - Execute steps in order
    - Use tools as needed
    - Track completion status
    - Handle errors gracefully
    
    ### Phase 3: Verification
    - Verify each step's output
    - Check if the overall goal is met
    - Provide a summary
    
    ## Response Format:
    
    When given a complex task, ALWAYS start with:
    
    "Let me break this down into steps:
    1. [Step 1 description]
    2. [Step 2 description]
    3. [Step 3 description]
    
    Now executing..."
    
    Then proceed to use tools and report progress.
    
    Current task context: ${JSON.stringify(state.context)}
  `,
  tools: [searchTool, analyzeTool, createTool, verifyTool]
}
```

### Alternative: Use Agent-as-Tool for Planning

You can create a dedicated planning agent and use it as a tool:

```typescript
// Planning sub-agent
const plannerAgent = {
  name: 'planner',
  instructions: () => `
    You are a planning specialist.
    
    Given a task, create a detailed execution plan with:
    - Clear steps
    - Resource requirements
    - Expected outcomes
    - Risk factors
    
    Output format:
    {
      "steps": [
        {"id": 1, "action": "...", "tools": [...], "expected_outcome": "..."},
        {"id": 2, "action": "...", "tools": [...], "expected_outcome": "..."}
      ],
      "dependencies": [[1, 2]],  // Step 2 depends on step 1
      "estimated_turns": 5
    }
  `,
  outputCodec: z.object({
    steps: z.array(z.object({
      id: z.number(),
      action: z.string(),
      tools: z.array(z.string()),
      expected_outcome: z.string()
    })),
    dependencies: z.array(z.array(z.number())),
    estimated_turns: z.number()
  })
}

// Main agent uses planner
const mainAgent = {
  name: 'executor',
  instructions: () => 'Execute tasks using the create_plan tool first',
  tools: [
    agentAsTool(plannerAgent, { toolName: 'create_plan' }),
    actualExecutionTools...
  ]
}
```

---

## Summary

### Key Takeaways

**Prompt Construction:**
- System message = `agent.instructions(state)`
- Conversation history = entire `state.messages` array
- Tools = auto-converted from Zod to JSON Schema
- Same prompt structure goes to LLM **every turn**

**JAF Additions:**
- ✅ System message (agent instructions)
- ✅ Tools array (function definitions)
- ✅ Message formatting (OpenAI Chat format)
- ❌ NO planning prompts
- ❌ NO todo management
- ❌ NO automatic reasoning

**Tool Calling:**
- Schema defined via Zod in tool definition
- LLM returns OpenAI function calling format
- JAF validates automatically
- You don't specify output format

**Turns:**
- 1 turn = 1 LLM call
- Tool execution ≠ turn
- Multiple tools in one response = 1 turn
- Default max: 50 turns

**Handoffs:**
- Same conversation history
- New agent's instructions replace old ones
- New agent's tools replace old ones
- NOT counted as a turn

**Sub-Agents:**
- Isolated execution (new messages array)
- Only receives tool input
- Independent turn counter
- Returns result to parent

**Planning:**
- YOU implement it in `instructions`
- OR create dedicated planner agent
- OR use agent-as-tool pattern
- JAF doesn't enforce any structure

---

## References

- [Core Engine](../src/core/engine.ts) - Main execution loop
- [Model Provider](../src/providers/model.ts) - Prompt construction
- [Agent-as-Tool](../src/core/agent-as-tool.ts) - Sub-agent mechanics
- [Types](../src/core/types.ts) - Core type definitions

</final_file_content>

IMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference. This content reflects the current state of the file, including any auto-formatting (e.g., if you used single quotes but the formatter converted them to double quotes). Always base your SEARCH/REPLACE operations on this final version to ensure accuracy.


<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 12:39:26 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
79,751 / 200K tokens used (40%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<attempt_completion>
<result>
# Comprehensive Documentation Created: LLM Prompting and Turn Mechanics

I've created a detailed documentation file at **`docs/llm-prompting-and-turns.md`** that comprehensively answers all your questions about JAF's LLM interaction mechanics.

## Key Findings:

### 1. **Prompt Construction**
- **System Message**: Always includes `agent.instructions(state)` - this is YOUR responsibility
- **Conversation History**: ENTIRE `state.messages` array goes to LLM on EVERY call
- **Tools**: Auto-converted from Zod to JSON Schema
- The same structure is sent every turn with accumulated history

### 2. **What JAF Adds to Prompts**
✅ **JAF DOES add:**
- System message (agent instructions)
- Tools array (function definitions)
- Message formatting (OpenAI Chat format)

❌ **JAF does NOT add:**
- NO planning prompts
- NO todo list management
- NO chain-of-thought forcing
- NO reflection loops

**The agent's `instructions` function is entirely YOUR control** - you define the entire system message.

### 3. **Tool Calling Format**
- **Schema**: Defined via Zod in your tool definition, auto-converted to JSON Schema
- **LLM Response**: Returns in OpenAI function calling format (standardized)
- **Validation**: JAF validates automatically using the Zod schema
- **You don't specify output format** - it's handled by OpenAI's protocol

### 4. **What is a "Turn"?**
**1 Turn = 1 LLM Call**

Example flow:
```
Turn 1: User message → LLM → Tool calls
        (Tool executes - NOT a turn)
Turn 2: Tool results → LLM → Another tool call
        (Tool executes - NOT a turn)
Turn 3: Tool results → LLM → Final answer
```

- ✅ Each LLM call = 1 turn
- ✅ Multiple tools in one response = still 1 turn
- ❌ Tool execution ≠ turn
- Default max: 50 turns

### 5. **Handoff vs Agent-as-Tool Prompting**

**Handoff (horizontal):**
- ✅ Conversation history preserved
- ✅ New agent's instructions REPLACE old ones
- ✅ New agent sees ALL previous messages
- ❌ Previous agent's instructions NOT included

**Agent-as-Tool (vertical):**
- ❌ NO parent conversation history
- ❌ Parent's instructions NOT included
- ✅ Child gets ONLY the tool input as a fresh user message
- ✅ Isolated execution with own turn counter
- Child's prompt: Just system message + tool input

### 6. **Planning Logic**
**JAF has NO built-in planning!**

You must implement planning in your agent's `instructions`:
```typescript
const planningAgent = {
  instructions: (state) => `
    ALWAYS follow this process:
    1. ANALYZE: Understand the request
    2. PLAN: Break into steps
    3. EXECUTE: Use tools
    4. VERIFY: Check results
    
    Create a plan:
    - [ ] Step 1
    - [ ] Step 2
    ...
  `
}
```

## Documentation Contents:

1. **Prompt Construction** - Detailed examples of how messages are formatted
2. **What JAF Adds** - Complete breakdown with examples
3. **Tool Calling Format** - Schema definition, validation flow
4. **Turn Definition** - Multiple examples with turn counting
5. **Handoff/Sub-Agent Prompting** - Side-by-side comparison with examples
6. **Planning Logic** - How to implement your own planning

The documentation includes code examples, flow diagrams, and comparisons to make everything crystal clear. Check out the file for the complete details!
</result>
<task_progress>
- [x] Examine how prompts are constructed for LLM calls
- [x] Check what JAF adds to prompts
- [x] Understand tool calling format and schema
- [x] Analyze handoff/sub-agent prompt behavior
- [x] Define "turn" concept with examples
- [x] Check for built-in planning logic
- [x] Create comprehensive documentation
</task_progress>
</attempt_completion>

---

**User:**

[TASK RESUMPTION] This task was interrupted 2 hours ago. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '/Users/aayush.shah/Desktop/projects/jaf'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.

Note: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.
New instructions for task continuation:
<user_message>
Then how does the LLM know about handOff tool ,since users won't be writing description about handOff-tool , still LLm uses this tool correctly .

let's say in a turn , post LLM response , LLm gave 3 tool calls to execute with its parameters
then will we have all 3 tool calls executed and then pass their results as one or separatelly acorssmultipple turns . Answer by looking into the code
</user_message>

# TODO LIST RECOMMENDED

When starting a new task, it is recommended to create a todo list.


1. Include the task_progress parameter in your next tool call
2. Create a comprehensive checklist of all steps needed
3. Use markdown format: - [ ] for incomplete, - [x] for complete

**Benefits of creating a todo list now:**
	- Clear roadmap for implementation
	- Progress tracking throughout the task
	- Nothing gets forgotten or missed
	- Users can see, monitor, and edit the plan

**Example structure:**```
- [ ] Analyze requirements
- [ ] Set up necessary files
- [ ] Implement main functionality
- [ ] Handle edge cases
- [ ] Test the implementation
- [ ] Verify results```

Keeping the todo list updated helps track progress and ensures nothing is missed.

<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:41:14 PM (Asia/Calcutta, UTC+5.5:00)

# Current Working Directory (/Users/aayush.shah/Desktop/projects/jaf) Files
.env.test
.eslintrc.js
.gitignore
.npmignore
CHANGELOG_EVENT_IMPROVEMENTS.md
docker-compose.test.yml
jest.config.js
jest.setup.js
LICENSE
mkdocs.yml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
QUICK_REFERENCE_EVENT_HANDLERS.md
README.md
requirements.txt
tsconfig.json
dependencies/
dependencies/pdf-parse/
dependencies/pdf-parse/.editorconfig
dependencies/pdf-parse/.gitignore
dependencies/pdf-parse/.gitlab-ci.yml
dependencies/pdf-parse/.jsbeautifyrc
dependencies/pdf-parse/.npmrc
dependencies/pdf-parse/CHANGELOG
dependencies/pdf-parse/CONTRIBUTING.md
dependencies/pdf-parse/index.d.ts
dependencies/pdf-parse/index.js
dependencies/pdf-parse/LICENSE
dependencies/pdf-parse/NOTES.md
dependencies/pdf-parse/package.json
dependencies/pdf-parse/QUICKSTART.js
dependencies/pdf-parse/README.md
dependencies/pdf-parse/lib/
dependencies/pdf-parse/test/
docs/
docs/a2a-integration.md
docs/a2a-protocol.md
docs/adk-analysis.md
docs/adk-layer.md
docs/agents-as-tools.md
docs/api-reference.md
docs/CONTRIBUTING.md
docs/core-concepts.md
docs/cover.png
docs/deployment.md
docs/event-handling-guide.md
docs/examples.md
docs/favicon.png
docs/getting-started.md
docs/jaf-adk-layer-plan.md
docs/llm-prompting-and-turns.md
docs/logo.png
docs/memory-system.md
docs/model-providers.md
docs/new-features.md
docs/README.md
docs/safe-logging.md
docs/sanitization.md
docs/serve.sh
docs/server-api.md
docs/tools.md
docs/trace-events-reference.md
docs/tracing.md
docs/troubleshooting.md
docs/visualization.md
docs/stylesheets/
docs/stylesheets/extra.css
examples/
examples/attachment-demo-server.ts
examples/custom-sanitization-example.ts
examples/guardrails-demo.ts
examples/safe-logging-example.ts
examples/verify-param-modification.ts
examples/agent-as-tool-demo/
examples/agent-as-tool-demo/.env.example
examples/agent-as-tool-demo/index.ts
examples/agent-as-tool-demo/package.json
examples/agent-as-tool-demo/README.md
examples/agent-as-tool-demo/tsconfig.json
examples/ai-sdk-provider-demo/
examples/ai-sdk-provider-demo/.env.example
examples/ai-sdk-provider-demo/package.json
examples/ai-sdk-provider-demo/reasoning-ui-example.tsx
examples/ai-sdk-provider-demo/server.ts
examples/ai-sdk-provider-demo/test-vertex.ts
examples/ai-sdk-provider-demo/test.ts
examples/ai-sdk-provider-demo/tsconfig.json
examples/flight-booking/
examples/flight-booking/.env.example
examples/flight-booking/index.ts
examples/flight-booking/jaf-server.ts
examples/flight-booking/multi-agent.ts
examples/flight-booking/package.json
examples/flight-booking/README.md
examples/flight-booking/tsconfig.json
examples/hitl-demo/
examples/hitl-demo/.env.example
examples/hitl-demo/api-demo.ts
examples/hitl-demo/index.ts
examples/hitl-demo/package.json
examples/hitl-demo/README.md
examples/hitl-demo/run-server.ts
examples/hitl-demo/tsconfig.json
examples/hitl-demo/shared/
examples/math-tool-demo/
examples/math-tool-demo/index.ts
examples/math-tool-demo/package.json
examples/math-tool-demo/README.md
examples/math-tool-demo/tsconfig.json
examples/mcp-demo/
examples/mcp-demo/.env.example
examples/mcp-demo/.gitignore
examples/mcp-demo/mcp-filesystem-server.ts
examples/mcp-demo/package.json
examples/mcp-demo/README.md
examples/mcp-demo/tsconfig.json
examples/mcp-http-demo/
examples/mcp-http-demo/index.ts
examples/mcp-http-demo/package.json
examples/mcp-http-demo/README.md
examples/mcp-http-demo/run-server.ts
examples/mcp-http-demo/tsconfig.json
examples/mcp-sse-demo/
examples/mcp-sse-demo/index.ts
examples/mcp-sse-demo/package.json
examples/mcp-sse-demo/README.md
examples/mcp-sse-demo/run-server.ts
examples/mcp-sse-demo/tsconfig.json
examples/otel-tracing-demo/
examples/otel-tracing-demo/.env.example
examples/otel-tracing-demo/otel-demo.ts
examples/otel-tracing-demo/package.json
examples/rag-demo/
examples/rag-demo/.env.example
examples/rag-demo/.gitignore
examples/rag-demo/DEMO_SUMMARY.md
examples/rag-demo/index.ts
examples/rag-demo/package.json
examples/rag-demo/rag-agent.ts
examples/rag-demo/rag-tool.ts
examples/rag-demo/README.md
examples/rag-demo/tsconfig.json
examples/server-demo/
examples/server-demo/.env.example
examples/server-demo/index.ts
examples/server-demo/package.json
examples/server-demo/README.md
examples/server-demo/tsconfig.json
examples/simple-event-handler-demo/
examples/simple-event-handler-demo/.env.example
examples/simple-event-handler-demo/.gitignore
examples/simple-event-handler-demo/DEMO_OUTPUT.md
examples/simple-event-handler-demo/index.ts
examples/simple-event-handler-demo/package.json
examples/simple-event-handler-demo/README.md
examples/simple-event-handler-demo/tsconfig.json
examples/streaming-demo/
examples/streaming-demo/package.json
examples/streaming-demo/README.md
examples/streaming-demo/server.ts
examples/streaming-demo/stream-direct.ts
examples/streaming-demo/stream-plain.ts
examples/streaming-demo/tsconfig.json
examples/visualization-demo/
examples/visualization-demo/index.ts
examples/visualization-demo/package.json
examples/visualization-demo/README.md
scripts/
scripts/setup-test-db.sh
scripts/teardown-test-db.sh
src/
src/index.ts
src/__tests__/
src/__tests__/agent-as-tool.test.ts
src/__tests__/engine.test.ts
src/__tests__/hitl.test.ts
src/__tests__/validation.test.ts
src/a2a/
src/a2a/agent-card.ts
src/a2a/agent.ts
src/a2a/client.ts
src/a2a/executor.ts
src/a2a/index.ts
src/a2a/protocol.ts
src/a2a/server.ts
src/a2a/__tests__/
src/a2a/examples/
src/a2a/memory/
src/adk/
src/core/
src/memory/
src/policies/
src/providers/
src/server/
src/test-utils/
src/tools/
src/types/
src/utils/
src/visualization/

(File list truncated. Use list_files on specific subdirectories if you need to explore further.)

# Workspace Configuration
{
  "workspaces": {
    "/Users/aayush.shah/Desktop/projects/jaf": {
      "hint": "jaf",
      "associatedRemoteUrls": [
        "origin: https://github.com/xynehq/jaf.git"
      ],
      "latestGitCommitHash": "6b97fee9bf8ff6c6bd5970d1c4969597c3e36860"
    }
  }
}

# Detected CLI Tools
These are some of the tools on the user's machine, and may be useful if needed to accomplish the task: git, docker, kubectl, gcloud, npm, pnpm, pip, curl, jq, make, python, node, mysql, sqlite3, code, grep, sed, awk, brew, bundle. This list is not exhaustive, and other tools may be available.

# Context Window Usage
87,621 / 200K tokens used (44%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


I'll answer both questions by examining the code. Let me search for how the handoff tool is provided and how multiple tool calls are executed.

<search_files>
<path>src</path>
<regex>handoffTool|handoff_to_agent</regex>
<file_pattern>*.ts</file_pattern>
<task_progress>
- [ ] Find how handoff tool is provided to agents
- [ ] Examine multiple tool call execution logic
- [ ] Document findings clearly
</task_progress>
</search_files>

---

**User:**

[search_files for 'handoffTool|handoff_to_agent' in '*.ts'] Result:
Found 2 results.

src/policies/handoff.ts
│----
│export const handoffTool: Tool<HandoffArgs, any> = {
│  schema: {
│----
│    name: "handoff_to_agent",
│    description: "Delegate the task to a different, more specialized agent.",
│----
<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:41:30 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
90,656 / 200K tokens used (45%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<search_files>
<path>src</path>
<regex>agent\.tools.*handoff|tools.*=.*\[.*handoff</regex>
<file_pattern>*.ts</file_pattern>
<task_progress>
- [ ] Find how handoff tool is provided to agents
- [ ] Examine multiple tool call execution logic
- [ ] Document findings clearly
</task_progress>
</search_files>

---

**User:**

[search_files for 'agent\.tools.*handoff|tools.*=.*\[.*handoff' in '*.ts'] Result:
Found 0 results.
<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:41:38 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
91,066 / 200K tokens used (46%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<search_files>
<path>src</path>
<regex>buildAgent|registerAgent|createAgent.*handoff</regex>
<file_pattern>*.ts</file_pattern>
<task_progress>
- [ ] Find how handoff tool is provided to agents
- [ ] Examine multiple tool call execution logic
- [ ] Document findings clearly
</task_progress>
</search_files>

---

**User:**

[search_files for 'buildAgent|registerAgent|createAgent.*handoff' in '*.ts'] Result:
Found 0 results.
<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:41:44 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
91,412 / 200K tokens used (46%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<search_files>
<path>src/adk</path>
<regex>handoff</regex>
<file_pattern>*.ts</file_pattern>
<task_progress>
- [ ] Find how handoff tool is provided to agents
- [ ] Examine multiple tool call execution logic
- [ ] Document findings clearly
</task_progress>
</search_files>

---

**User:**

[search_files for 'handoff' in '*.ts'] Result:
Found 5 results.

src/adk/providers/type-converters.ts
│----
│    handoffs: [],
│    outputCodec: adkAgent.config.outputSchema ? createZodFromAdkSchema(adkAgent.config.outputSchema) : undefined
│    },
│----

src/adk/providers/llm-service.ts
│----
│        },
│    handoffs: [],
│    outputCodec: adkAgent.config.outputSchema ? {
│----

src/adk/providers/__tests__/type-converters.test.ts
│----
│        handoffs: []
│      };
│  // Look for delegation patterns
│----

src/adk/runners/index.ts
│----
│  const delegatePattern = /delegate to (\w+)|transfer to (\w+)|handoff to (\w+)/i;
│  const match = responseText.match(delegatePattern);
│      const funcName = toolCall.functionCall.name;
│----
│      if (funcName === 'delegate' || funcName === 'handoff') {
│        return { targetAgent: (toolCall.functionCall.args as any)?.targetAgent };
│----
<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:41:53 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
91,947 / 200K tokens used (46%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<search_files>
<path>examples</path>
<regex>handoff</regex>
<file_pattern>*.ts</file_pattern>
<task_progress>
- [ ] Find how handoff tool is provided to agents
- [ ] Examine multiple tool call execution logic
- [ ] Document findings clearly
</task_progress>
</search_files>

---

**User:**

[search_files for 'handoff' in '*.ts'] Result:
Found 3 results.

examples/flight-booking/multi-agent.ts
│----
│          break;
│    - Ensure smooth handoffs between team members
│    - Summarize results from multiple specialists clearly`,
│----

examples/streaming-demo/stream-direct.ts
│----
│        case 'handoff':
│----
│          console.log('event: handoff', event.data);
│          break;
│----
<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:41:59 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
92,499 / 200K tokens used (46%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<read_file>
<path>src/index.ts</path>
<task_progress>
- [ ] Find how handoff tool is provided to agents
- [ ] Examine multiple tool call execution logic
- [ ] Document findings clearly
</task_progress>
</read_file>

---

**User:**

[read_file for 'src/index.ts'] Result:
export * from './core/types';
export * from './core/engine';
export * from './core/tracing';
export * from './core/errors';
export * from './core/tool-results';
export * from './core/agent-as-tool';

export * from './providers/model';
// export * from './providers/mcp'; // Commented out for test compatibility

export * from './policies/validation';
export * from './policies/handoff';

export * from './server';

// Built-in tools
export * from './tools';

// Memory providers
export * from './memory/types';
export * from './memory/factory';
export * from './memory/providers/in-memory';
export * from './memory/providers/redis';
export * from './memory/providers/postgres';

// A2A Protocol Support
export * from './a2a';

// ADK Layer - Functional Agent Development Kit
// Re-export specific ADK modules to avoid conflicts
export * as ADK from './adk';

import { v4 as uuidv4 } from 'uuid';
import { TraceId, RunId, createTraceId, createRunId } from './core/types';

export function generateTraceId(): TraceId {
  return createTraceId(uuidv4());
}

export function generateRunId(): RunId {
  return createRunId(uuidv4());
}

<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:42:05 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
92,986 / 200K tokens used (46%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<search_files>
<path>src/__tests__</path>
<regex>handoff</regex>
<file_pattern>*.ts</file_pattern>
<task_progress>
- [ ] Find how handoff tool is provided to agents
- [ ] Examine multiple tool call execution logic
- [ ] Document findings clearly
</task_progress>
</search_files>

---

**User:**

[search_files for 'handoff' in '*.ts'] Result:
Found 0 results.
<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:42:11 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
93,724 / 200K tokens used (47%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


Let me examine the code more carefully. I need to check if handoff tool is automatically added and how multiple tool calls are executed.

<read_file>
<path>src/providers/model.ts</path>
<task_progress>
- [ ] Find how handoff tool is provided to agents
- [ ] Examine multiple tool call execution logic
- [ ] Document findings clearly
</task_progress>
</read_file>

---

**User:**

[read_file for 'src/providers/model.ts'] Result:
import OpenAI from "openai";
import tunnel from 'tunnel';
import { ModelProvider, Message, MessageContentPart, getTextContent, type RunState, type Agent, type RunConfig } from '../core/types.js';
import { extractDocumentContent, isDocumentSupported, getDocumentDescription } from '../utils/document-processor.js';
import { safeConsole } from '../utils/logger.js';

interface ProxyConfig {
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

function createProxyAgent(url?: any,proxyConfig?: ProxyConfig) {
  const httpProxy = proxyConfig?.httpProxy || process.env.HTTP_PROXY;
  const noProxy = proxyConfig?.noProxy || process.env.NO_PROXY;
  
  if (noProxy?.includes(url)  || !httpProxy ) {
    return undefined;
  }

  try {
    safeConsole.log(`[JAF:PROXY] Configuring proxy agents:`);
    if (httpProxy) safeConsole.log(`HTTP_PROXY: ${httpProxy}`);
    if (noProxy) safeConsole.log(`NO_PROXY: ${noProxy}`);

    return {
      httpAgent: httpProxy ? createTunnelAgent(httpProxy) : undefined,
    };
  } catch (error) {
    safeConsole.warn(`[JAF:PROXY] Failed to create proxy agents. Install 'https-proxy-agent' and 'http-proxy-agent' packages for proxy support:`, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}


const createTunnelAgent = (proxyUrl: string) => {
  const url = new URL(proxyUrl);
  
  // Create tunnel agent for HTTPS through HTTP proxy
  return tunnel.httpsOverHttp({
    proxy: {
      host: url.hostname,
      port: parseInt(url.port)
    },
    rejectUnauthorized: false
  });
};

export const makeLiteLLMProvider = <Ctx>(
  baseURL: string,
  apiKey = "anything",
  proxyConfig?: ProxyConfig
): ModelProvider<Ctx> => {
  const clientConfig: any = { 
    baseURL, 
    apiKey, 
    dangerouslyAllowBrowser: true
  };

  const hostname = new URL(baseURL).hostname;
  const proxyAgents = createProxyAgent(hostname,proxyConfig);
  if (proxyAgents) {
    if (proxyAgents.httpAgent) {
      clientConfig.httpAgent = proxyAgents.httpAgent;
    }
    safeConsole.log(`[JAF:PROXY] LiteLLM provider configured with proxy support`);
  } else {
    safeConsole.log(`[JAF:PROXY] LiteLLM provider configured without proxy (direct connection)`);
  }

  const client = new OpenAI(clientConfig);

  return {
    async getCompletion(state, agent, config) {
      const { model, params } = await buildChatCompletionParams(state, agent, config, baseURL);

      safeConsole.log(`📞 Calling model: ${model} with params: ${JSON.stringify(params, null, 2)}`);
      const resp = await client.chat.completions.create(
        params as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
      );

      // Return the choice with usage data attached for tracing
      return {
        ...resp.choices[0],
        usage: resp.usage,
        model: resp.model,
        id: resp.id,
        created: resp.created
      };
    },

    async *getCompletionStream(state, agent, config) {
      const { model, params: baseParams } = await buildChatCompletionParams(state, agent, config, baseURL);

      safeConsole.log(`📡 Streaming model: ${model} with params: ${JSON.stringify(baseParams, null, 2)}`);

      // Enable streaming on request
      const streamParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        ...baseParams,
        stream: true,
      };
      const stream = await client.chat.completions.create(streamParams);

      // Iterate OpenAI streaming chunks (choices[].delta.*)
      for await (const chunk of stream) {
        const choice = chunk?.choices?.[0];
        const delta = choice?.delta;

        if (!delta) {
          // Some keep-alive frames may not contain deltas
          const finish = choice?.finish_reason;
          if (finish) {
            yield { isDone: true, finishReason: finish, raw: chunk };
          }
          continue;
        }

        // Text content delta
        if (delta.content) {
          yield { delta: delta.content, raw: chunk };
        }

        // Tool call delta(s)
        if (Array.isArray(delta.tool_calls)) {
          for (const toolCall of delta.tool_calls) {
            const fn = toolCall.function || {};
            yield {
              toolCallDelta: {
                index: toolCall.index ?? 0,
                id: toolCall.id,
                type: 'function',
                function: {
                  name: fn.name,
                  argumentsDelta: fn.arguments,
                },
              },
              raw: chunk,
            };
          }
        }

        // Completion ended
        const finish = choice?.finish_reason;
        if (finish) {
          yield { isDone: true, finishReason: finish, raw: chunk };
        }
      }
    },
  };
};

const VISION_MODEL_CACHE_TTL = 5 * 60 * 1000;
const VISION_API_TIMEOUT = 3000;
const visionModelCache = new Map<string, { supports: boolean; timestamp: number }>();

async function isVisionModel(model: string, baseURL: string): Promise<boolean> {
  const cacheKey = `${baseURL}:${model}`;
  const cached = visionModelCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < VISION_MODEL_CACHE_TTL) {
    return cached.supports;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VISION_API_TIMEOUT);
    
    const response = await fetch(`${baseURL}/model_group/info`, {
      headers: {
        'accept': 'application/json'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data: any = await response.json();
      const modelInfo = data.data?.find((m: any) => 
        m.model_group === model || model.includes(m.model_group)
      );
      
      if (modelInfo?.supports_vision !== undefined) {
        const result = modelInfo.supports_vision;
        visionModelCache.set(cacheKey, { supports: result, timestamp: Date.now() });
        return result;
      }
    } else {
      safeConsole.warn(`Vision API returned status ${response.status} for model ${model}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        safeConsole.warn(`Vision API timeout for model ${model}`);
      } else {
        safeConsole.warn(`Vision API error for model ${model}: ${error.message}`);
      }
    } else {
      safeConsole.warn(`Unknown error checking vision support for model ${model}`);
    }
  }

  const knownVisionModels = [
    'gpt-4-vision-preview',
    'gpt-4o',
    'gpt-4o-mini', 
    'claude-sonnet-4',
    'claude-sonnet-4-20250514', 
    'gemini-2.5-flash',
    'gemini-2.5-pro'
  ];
  
  const isKnownVisionModel = knownVisionModels.some(visionModel => 
    model.toLowerCase().includes(visionModel.toLowerCase())
  );
  
  visionModelCache.set(cacheKey, { supports: isKnownVisionModel, timestamp: Date.now() });
  
  return isKnownVisionModel;
}

/**
 * Build common Chat Completions request parameters shared by both
 * getCompletion and getCompletionStream to avoid logic duplication.
 */
async function buildChatCompletionParams<Ctx>(
  state: Readonly<RunState<Ctx>>,
  agent: Readonly<Agent<Ctx, any>>,
  config: Readonly<RunConfig<Ctx>>,
  baseURL: string,
): Promise<{ model: string; params: OpenAI.Chat.Completions.ChatCompletionCreateParams }> {
  const model = agent.modelConfig?.name ?? config.modelOverride;

  if (!model) {
    throw new Error(`Model not specified for agent ${agent.name}`);
  }

  // Vision capability check if any image payload present
  const hasImageContent = state.messages.some(msg =>
    (Array.isArray(msg.content) && msg.content.some(part => (part as any).type === 'image_url')) ||
    (!!msg.attachments && msg.attachments.some(att => att.kind === 'image'))
  );
  if (hasImageContent) {
    const supportsVision = await isVisionModel(model, baseURL);
    if (!supportsVision) {
      throw new Error(
        `Model ${model} does not support vision capabilities. Please use a vision-capable model like gpt-4o, claude-3-5-sonnet, or gemini-1.5-pro.`
      );
    }
  }

  const systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
    role: 'system',
    content: agent.instructions(state),
  };

  const convertedMessages = await Promise.all(state.messages.map(convertMessage));
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    systemMessage,
    ...convertedMessages,
  ];

  const tools = agent.tools?.map(t => ({
    type: 'function' as const,
    function: {
      name: t.schema.name,
      description: t.schema.description,
      parameters: zodSchemaToJsonSchema(t.schema.parameters),
    },
  }));

  const lastMessage = state.messages[state.messages.length - 1];
  const isAfterToolCall = lastMessage?.role === 'tool';

  const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
    model,
    messages,
    temperature: agent.modelConfig?.temperature,
    max_tokens: agent.modelConfig?.maxTokens,
    tools: tools && tools.length > 0 ? tools : undefined,
    tool_choice: tools && tools.length > 0 ? (isAfterToolCall ? 'auto' : undefined) : undefined,
    response_format: agent.outputCodec ? { type: 'json_object' } : undefined,
  };

  return { model, params };
}

async function convertMessage(msg: Message): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
  switch (msg.role) {
    case 'user':
      if (Array.isArray(msg.content)) {
        return {
          role: 'user',
          content: msg.content.map(convertContentPart)
        };
      } else {
        return await buildChatMessageWithAttachments('user', msg);
      }
    case 'assistant':
      return {
        role: 'assistant',
        content: getTextContent(msg.content),
        tool_calls: msg.tool_calls as any
      };
    case 'tool':
      return {
        role: 'tool',
        content: getTextContent(msg.content),
        tool_call_id: msg.tool_call_id!
      };
    default:
      throw new Error(`Unknown message role: ${(msg as any).role}`);
  }
}

function convertContentPart(part: MessageContentPart): OpenAI.Chat.Completions.ChatCompletionContentPart {
  switch (part.type) {
    case 'text':
      return {
        type: 'text',
        text: part.text
      };
    case 'image_url':
      return {
        type: 'image_url',
        image_url: {
          url: part.image_url.url,
          detail: part.image_url.detail
        }
      };
    case 'file':
      return {
        type: 'file',
        file: {
          file_id: part.file.file_id,
          format: part.file.format
        }
      } as any;
    default:
      throw new Error(`Unknown content part type: ${(part as any).type}`);
  }
}

/**
 * If attachments exist, build multi-part content for Chat Completions.
 * Supports images via `image_url` and documents via content extraction.
 */
async function buildChatMessageWithAttachments(
  role: 'user' | 'assistant',
  msg: Message
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
  const hasAttachments = Array.isArray(msg.attachments) && msg.attachments.length > 0;
  if (!hasAttachments) {
    if (role === 'assistant') {
      return { role: 'assistant', content: getTextContent(msg.content), tool_calls: msg.tool_calls as any };
    }
    return { role: 'user', content: getTextContent(msg.content) };
  }

  const parts: any[] = [];
  const textContent = getTextContent(msg.content);
  if (textContent && textContent.trim().length > 0) {
    parts.push({ type: 'text', text: textContent });
  }

  for (const att of msg.attachments || []) {
    if (att.kind === 'image') {
      // Prefer explicit URL; otherwise construct a data URL from base64
      const url = att.url
        ? att.url
        : (att.data && att.mimeType)
          ? `data:${att.mimeType};base64,${att.data}`
          : undefined;
      if (url) {
        parts.push({ type: 'image_url', image_url: { url } });
      }
    } else if (att.kind === 'document' || att.kind === 'file') {
      // Check if attachment has useLiteLLMFormat flag or is a large document
      const useLiteLLMFormat = att.useLiteLLMFormat === true;
      
      if (useLiteLLMFormat && (att.url || att.data)) {
        // Use LiteLLM native file format for better handling of large documents
        const file_id = att.url || (att.data && att.mimeType ? `data:${att.mimeType};base64,${att.data}` : '');
        if (file_id) {
          parts.push({
            type: 'file',
            file: {
              file_id,
              format: att.mimeType || att.format
            }
          });
        }
      } else {
        // Extract document content if supported and we have data or URL
        if (isDocumentSupported(att.mimeType) && (att.data || att.url)) {
          try {
            const processed = await extractDocumentContent(att);
            const fileName = att.name || 'document';
            const description = getDocumentDescription(att.mimeType);
            
            parts.push({
              type: 'text',
              text: `DOCUMENT: ${fileName} (${description}):\n\n${processed.content}`
            });
          } catch (error) {
            // Fallback to filename if extraction fails
            const label = att.name || att.format || att.mimeType || 'attachment';
            parts.push({
              type: 'text',
              text: `ERROR: Failed to process ${att.kind}: ${label} (${error instanceof Error ? error.message : 'Unknown error'})`
            });
          }
        } else {
          // Unsupported document type - show placeholder
          const label = att.name || att.format || att.mimeType || 'attachment';
          parts.push({
            type: 'text',
            text: `ATTACHMENT: ${att.kind}: ${label}${att.url ? ` (${att.url})` : ''}`
          });
        }
      }
    }
  }

  const base: any = { role, content: parts };
  if (role === 'assistant' && msg.tool_calls) {
    base.tool_calls = msg.tool_calls as any;
  }
  return base as OpenAI.Chat.Completions.ChatCompletionMessageParam;
}

function zodSchemaToJsonSchema(zodSchema: any): any {
  if (zodSchema._def?.typeName === 'ZodObject') {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    
    for (const [key, value] of Object.entries(zodSchema._def.shape())) {
      properties[key] = zodSchemaToJsonSchema(value);
      if (!(value as any).isOptional()) {
        required.push(key);
      }
    }
    
    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false
    };
  }
  
  if (zodSchema._def?.typeName === 'ZodString') {
    const schema: any = { type: 'string' };
    if (zodSchema._def.description) {
      schema.description = zodSchema._def.description;
    }
    return schema;
  }
  
  if (zodSchema._def?.typeName === 'ZodNumber') {
    return { type: 'number' };
  }
  
  if (zodSchema._def?.typeName === 'ZodBoolean') {
    return { type: 'boolean' };
  }
  
  if (zodSchema._def?.typeName === 'ZodArray') {
    return {
      type: 'array',
      items: zodSchemaToJsonSchema(zodSchema._def.type)
    };
  }
  
  if (zodSchema._def?.typeName === 'ZodOptional') {
    return zodSchemaToJsonSchema(zodSchema._def.innerType);
  }
  
  if (zodSchema._def?.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: zodSchema._def.values
    };
  }
  
  return { type: 'string', description: 'Unsupported schema type' };
}

<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:42:22 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
94,277 / 200K tokens used (47%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


Now let me check the engine to see how multiple tool calls are handled:

<read_file>
<path>src/core/engine.ts</path>
<task_progress>
- [x] Find how handoff tool is provided to agents
- [ ] Examine multiple tool call execution logic
- [ ] Document findings clearly
</task_progress>
</read_file>

---

**User:**

[read_file for 'src/core/engine.ts'] Result:
import { z } from 'zod';
import {
  RunState,
  RunConfig,
  RunResult,
  Message,
  TraceEvent,
  Agent,
  ToolCall,
  Interruption,
  getTextContent,
  Guardrail,
} from './types.js';
import { setToolRuntime } from './tool-runtime.js';
import { buildEffectiveGuardrails, executeInputGuardrailsParallel, executeInputGuardrailsSequential, executeOutputGuardrails } from './guardrails.js';
import { safeConsole } from '../utils/logger.js';


export async function run<Ctx, Out>(
  initialState: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<RunResult<Out>> {
  try {
    config.onEvent?.({
      type: 'run_start',
      data: { 
        runId: initialState.runId, 
        traceId: initialState.traceId,
        context: initialState.context,
        userId: (initialState.context as any)?.userId,
        sessionId: (initialState.context as any)?.sessionId || (initialState.context as any)?.conversationId,
        messages: initialState.messages
      }
    });

    let stateWithMemory = initialState;
    if (config.memory?.autoStore && config.conversationId) {
      safeConsole.log(`[JAF:ENGINE] Loading conversation history for ${config.conversationId}`);
      stateWithMemory = await loadConversationHistory(initialState, config);
    } else {
      safeConsole.log(`[JAF:ENGINE] Skipping memory load - autoStore: ${config.memory?.autoStore}, conversationId: ${config.conversationId}`);
    }

    if (config.approvalStorage) {
      safeConsole.log(`[JAF:ENGINE] Loading approvals for runId ${stateWithMemory.runId}`);
      const { loadApprovalsIntoState } = await import('./state');
      stateWithMemory = await loadApprovalsIntoState(stateWithMemory, config);
    }

    const result = await runInternal<Ctx, Out>(stateWithMemory, config);

    if (config.memory?.autoStore && config.conversationId && result.outcome.status === 'completed' && config.memory.storeOnCompletion) {
      safeConsole.log(`[JAF:ENGINE] Storing final completed conversation for ${config.conversationId}`);
      await storeConversationHistory(result.finalState, config);
    } else if (result.outcome.status === 'interrupted') {
      safeConsole.log(`[JAF:ENGINE] Conversation interrupted - storage already handled during interruption`);
    } else {
      safeConsole.log(`[JAF:ENGINE] Skipping memory store - status: ${result.outcome.status}, storeOnCompletion: ${config.memory?.storeOnCompletion}`);
    }

    config.onEvent?.({
      type: 'run_end',
      data: { outcome: result.outcome, traceId: initialState.traceId, runId: initialState.runId }
    });

    return result;
  } catch (error) {
    const errorResult: RunResult<Out> = {
      finalState: initialState,
      outcome: {
        status: 'error',
        error: {
          _tag: 'ModelBehaviorError',
          detail: error instanceof Error ? error.message : String(error)
        }
      }
    } as RunResult<Out>;

    config.onEvent?.({
      type: 'run_end',
      data: { outcome: errorResult.outcome, traceId: initialState.traceId, runId: initialState.runId }
    });

    return errorResult;
  }
}

function createAsyncEventStream<T>() {
  const queue: T[] = [];
  let resolveNext: ((value: IteratorResult<T>) => void) | null = null;
  let done = false;

  return {
    push(event: T) {
      if (done) return;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: event, done: false });
      } else {
        queue.push(event);
      }
    },
    end() {
      if (done) return;
      done = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: undefined as any, done: true });
      }
    },
    iterator: {
      [Symbol.asyncIterator]() {
        return this;
      },
      next(): Promise<IteratorResult<T>> {
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift() as T, done: false });
        }
        if (done) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          resolveNext = resolve;
        });
      },
    },
  } as const;
}

/**
 * Stream run events as they happen via an async generator.
 * Consumers can iterate events to build live UIs or forward via SSE.
 *
 * @param initialState - The initial run state
 * @param config - Run configuration
 * @param streamEventHandler - Optional event handler for the stream consumer to handle/modify events
 */
export async function* runStream<Ctx, Out>(
  initialState: RunState<Ctx>,
  config: RunConfig<Ctx>,
  streamEventHandler?: (event: TraceEvent) => void | any | Promise<void | any>
): AsyncGenerator<TraceEvent, void, unknown> {
  const stream = createAsyncEventStream<TraceEvent>();

  const onEvent = async (event: TraceEvent) => {
    // First, let the stream consumer handle it (can modify before events)
    let eventResult: any;
    if (streamEventHandler) {
      try {
        eventResult = await streamEventHandler(event);
      } catch { /* ignore */ }
    }

    // Then push to stream for observation
    try { stream.push(event); } catch { /* ignore */ }

    // Also call config.onEvent if provided
    try {
      const configResult = await config.onEvent?.(event);
      // If config.onEvent returns a value and streamEventHandler didn't, use config result
      if (configResult !== undefined && eventResult === undefined) {
        eventResult = configResult;
      }
    } catch { /* ignore */ }

    // Return the result (for before events)
    return eventResult;
  };

  const runPromise = run<Ctx, Out>(initialState, { ...config, onEvent });
  void runPromise.finally(() => {
    stream.end();
  });

  try {
    for await (const event of stream.iterator as AsyncGenerator<TraceEvent>) {
      yield event;
    }
  } finally {
    await runPromise.catch(() => undefined);
  }
}

async function tryResumePendingToolCalls<Ctx, Out>(
  state: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<RunResult<Out> | null> {
  try {
    const messages = state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        const ids = new Set(msg.tool_calls.map(tc => tc.id));

        const executed = new Set<string>();
        for (let j = i + 1; j < messages.length; j++) {
          const m = messages[j];
          if (m.role === 'tool' && m.tool_call_id && ids.has(m.tool_call_id)) {
            executed.add(m.tool_call_id);
          }
        }

        const pendingToolCalls = msg.tool_calls.filter(tc => !executed.has(tc.id));
        if (pendingToolCalls.length === 0) {
          return null; // Nothing to resume
        }

        const currentAgent = config.agentRegistry.get(state.currentAgentName);
        if (!currentAgent) {
          return {
            finalState: state,
            outcome: {
              status: 'error',
              error: {
                _tag: 'AgentNotFound',
                agentName: state.currentAgentName,
              }
            }
          } as RunResult<Out>;
        }

        try {
          const requests = pendingToolCalls.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            args: tryParseJSON(tc.function.arguments)
          }));
          config.onEvent?.({ type: 'tool_requests', data: { toolCalls: requests } });
        } catch { /* ignore */ }

        const toolResults = await executeToolCalls(pendingToolCalls, currentAgent, state, config);

        const interruptions = toolResults
          .map(r => r.interruption)
          .filter((it): it is Interruption<Ctx> => it !== undefined);
        if (interruptions.length > 0) {
          const nonInterruptedResults = toolResults.filter(r => !r.interruption);
          return {
            finalState: {
              ...state,
              messages: [...state.messages, ...nonInterruptedResults.map(r => r.message)],
              turnCount: state.turnCount,
            },
            outcome: {
              status: 'interrupted',
              interruptions,
            },
          } as RunResult<Out>;
        }

        config.onEvent?.({
          type: 'tool_results_to_llm',
          data: { results: toolResults.map(r => r.message) }
        });

        const nextState: RunState<Ctx> = {
          ...state,
          messages: [...state.messages, ...toolResults.map(r => r.message)],
          turnCount: state.turnCount,
          approvals: state.approvals ?? new Map(),
        };
        return await runInternal<Ctx, Out>(nextState, config);
      }
    }
  } catch {
    // Ignore resume errors and continue with normal flow
  }
  return null;
}

async function runInternal<Ctx, Out>(
  state: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<RunResult<Out>> {
  const resumed = await tryResumePendingToolCalls<Ctx, Out>(state, config);
  if (resumed) return resumed;

  const maxTurns = config.maxTurns ?? 50;
  if (state.turnCount >= maxTurns) {
    return {
      finalState: state,
      outcome: {
        status: 'error',
        error: {
          _tag: 'MaxTurnsExceeded',
          turns: state.turnCount
        }
      }
    };
  }

  const currentAgent = config.agentRegistry.get(state.currentAgentName);
  if (!currentAgent) {
    return {
      finalState: state,
      outcome: {
        status: 'error',
        error: {
          _tag: 'AgentNotFound',
          agentName: state.currentAgentName
        }
      }
    };
  }

  const hasAdvancedGuardrails = !!(currentAgent.advancedConfig?.guardrails &&
    (currentAgent.advancedConfig.guardrails.inputPrompt ||
     currentAgent.advancedConfig.guardrails.outputPrompt ||
     currentAgent.advancedConfig.guardrails.requireCitations));

  safeConsole.log('[JAF:ENGINE] Debug guardrails setup:', {
    agentName: currentAgent.name,
    hasAdvancedConfig: !!currentAgent.advancedConfig,
    hasAdvancedGuardrails,
    initialInputGuardrails: config.initialInputGuardrails?.length || 0,
    finalOutputGuardrails: config.finalOutputGuardrails?.length || 0
  });

  let effectiveInputGuardrails: Guardrail<string>[] = [];
  let effectiveOutputGuardrails: Guardrail<any>[] = [];
  
  if (hasAdvancedGuardrails) {
    const result = await buildEffectiveGuardrails(currentAgent, config);
    effectiveInputGuardrails = result.inputGuardrails;
    effectiveOutputGuardrails = result.outputGuardrails;
  } else {
    effectiveInputGuardrails = [...(config.initialInputGuardrails || [])];
    effectiveOutputGuardrails = [...(config.finalOutputGuardrails || [])];
  }

  const inputGuardrailsToRun = (state.turnCount === 0 && effectiveInputGuardrails.length > 0)
    ? effectiveInputGuardrails
    : [];

  safeConsole.log('[JAF:ENGINE] Input guardrails to run:', {
    turnCount: state.turnCount,
    effectiveInputLength: effectiveInputGuardrails.length,
    inputGuardrailsToRunLength: inputGuardrailsToRun.length,
    hasAdvancedGuardrails
  });

  safeConsole.log(`[JAF:ENGINE] Using agent: ${currentAgent.name}`);
  safeConsole.log(`[JAF:ENGINE] Agent has ${currentAgent.tools?.length || 0} tools available`);
  if (currentAgent.tools) {
    safeConsole.log(`[JAF:ENGINE] Available tools:`, currentAgent.tools.map(t => t.schema.name));
  }

  config.onEvent?.({
    type: 'agent_processing',
    data: {
      agentName: currentAgent.name,
      traceId: state.traceId,
      runId: state.runId,
      turnCount: state.turnCount,
      messageCount: state.messages.length,
      toolsAvailable: currentAgent.tools?.map(t => ({
        name: t.schema.name,
        description: t.schema.description
      })) || [],
      handoffsAvailable: currentAgent.handoffs || [],
      modelConfig: currentAgent.modelConfig,
      hasOutputCodec: !!currentAgent.outputCodec,
      context: state.context,
      currentState: {
        messages: state.messages.map(m => ({
          role: m.role,
          contentLength: m.content?.length || 0,
          hasToolCalls: !!m.tool_calls?.length
        }))
      }
    }
  });


  const model = currentAgent.modelConfig?.name ?? config.modelOverride;

  if (!model && !(config.modelProvider as any).isAiSdkProvider) {
    return {
      finalState: state,
      outcome: {
        status: 'error',
        error: {
          _tag: 'ModelBehaviorError',
          detail: 'No model configured for agent'
        }
      }
    };
  }
  
  const turnNumber = state.turnCount + 1;
  config.onEvent?.({ type: 'turn_start', data: { turn: turnNumber, agentName: currentAgent.name } });

  const llmCallData = {
    agentName: currentAgent.name,
    model: model || 'unknown',
    traceId: state.traceId,
    runId: state.runId,
    messages: state.messages,
    tools: currentAgent.tools?.map(tool => ({
      name: tool.schema.name,
      description: tool.schema.description,
      parameters: tool.schema.parameters
    })),
    modelConfig: {
      ...currentAgent.modelConfig,
      modelOverride: config.modelOverride
    },
    turnCount: state.turnCount,
    context: state.context
  };

  config.onEvent?.({
    type: 'llm_call_start',
    data: llmCallData
  });

  let llmResponse: any;
  let streamingUsed = false;
  let assistantEventStreamed = false;
  
  if (inputGuardrailsToRun.length > 0 && state.turnCount === 0) {
    const firstUserMessage = state.messages.find(m => m.role === 'user');
    if (firstUserMessage) {
      if (hasAdvancedGuardrails) {
        const executionMode = currentAgent.advancedConfig?.guardrails?.executionMode || 'parallel';
      
      if (executionMode === 'sequential') {
        const guardrailResult = await executeInputGuardrailsSequential(inputGuardrailsToRun, firstUserMessage, config);
        if (!guardrailResult.isValid) {
          return {
            finalState: state,
            outcome: {
              status: 'error',
              error: {
                _tag: 'InputGuardrailTripwire',
                reason: guardrailResult.errorMessage
              }
            }
          };
        }

        safeConsole.log(`✅ All input guardrails passed. Starting LLM call.`);
        llmResponse = await config.modelProvider.getCompletion(state, currentAgent, config);
      } else {
        const guardrailPromise = executeInputGuardrailsParallel(inputGuardrailsToRun, firstUserMessage, config);
        const llmPromise = config.modelProvider.getCompletion(state, currentAgent, config);
        
        const [guardrailResult, llmResult] = await Promise.all([
          guardrailPromise,
          llmPromise
        ]);
        
        llmResponse = llmResult;

        if (!guardrailResult.isValid) {
          safeConsole.log(`🚨 Input guardrail violation: ${guardrailResult.errorMessage}`);
          safeConsole.log(`[JAF:GUARDRAILS] Discarding LLM response due to input guardrail violation`);
          return {
            finalState: state,
            outcome: {
              status: 'error',
              error: {
                _tag: 'InputGuardrailTripwire',
                reason: guardrailResult.errorMessage
              }
            }
          };
        }

        safeConsole.log(`✅ All input guardrails passed. Using LLM response.`);
        }
      } else {
        safeConsole.log('[JAF:ENGINE] Using LEGACY guardrails path with', inputGuardrailsToRun.length, 'guardrails');
        for (const guardrail of inputGuardrailsToRun) {
          const result = await guardrail(getTextContent(firstUserMessage.content));
          if (!result.isValid) {
            const errorMessage = !result.isValid ? result.errorMessage : '';
            config.onEvent?.({
              type: 'guardrail_violation',
              data: { stage: 'input', reason: errorMessage }
            });
            return {
              finalState: state,
              outcome: {
                status: 'error',
                error: {
                  _tag: 'InputGuardrailTripwire',
                  reason: errorMessage
                }
              }
            };
          }
        }
        llmResponse = await config.modelProvider.getCompletion(state, currentAgent, config);
      }
    } else {
      if (typeof config.modelProvider.getCompletionStream === 'function') {
        try {
          streamingUsed = true;
          const stream = config.modelProvider.getCompletionStream(state, currentAgent, config);
          let aggregatedText = '';
          const toolCalls: Array<{ id?: string; type: 'function'; function: { name?: string; arguments: string } }> = [];

          for await (const chunk of stream) {
            if (chunk?.delta) {
              aggregatedText += chunk.delta;
            }
            if (chunk?.toolCallDelta) {
              const idx = chunk.toolCallDelta.index ?? 0;
              while (toolCalls.length <= idx) {
                toolCalls.push({ id: undefined, type: 'function', function: { name: undefined, arguments: '' } });
              }
              const target = toolCalls[idx];
              if (chunk.toolCallDelta.id) target.id = chunk.toolCallDelta.id;
              if (chunk.toolCallDelta.function?.name) target.function.name = chunk.toolCallDelta.function.name;
              if (chunk.toolCallDelta.function?.argumentsDelta) {
                target.function.arguments += chunk.toolCallDelta.function.argumentsDelta;
              }
            }

            if (chunk?.delta || chunk?.toolCallDelta) {
              assistantEventStreamed = true;
              const partialMessage: Message = {
                role: 'assistant',
                content: aggregatedText,
                ...(toolCalls.length > 0
                  ? {
                      tool_calls: toolCalls.map((tc, i) => ({
                        id: tc.id ?? `call_${i}`,
                        type: 'function' as const,
                        function: {
                          name: tc.function.name ?? '',
                          arguments: tc.function.arguments
                        }
                      }))
                    }
                  : {})
              };
              try { config.onEvent?.({ type: 'assistant_message', data: { message: partialMessage } }); } catch (err) { safeConsole.error('Error in config.onEvent:', err); }
            }
          }

          llmResponse = {
            message: {
              content: aggregatedText || undefined,
              ...(toolCalls.length > 0
                ? {
                    tool_calls: toolCalls.map((tc, i) => ({
                      id: tc.id ?? `call_${i}`,
                      type: 'function' as const,
                      function: {
                        name: tc.function.name ?? '',
                        arguments: tc.function.arguments
                      }
                    }))
                  }
                : {})
            }
          };
        } catch (e) {
          streamingUsed = false;
          assistantEventStreamed = false;
          llmResponse = await config.modelProvider.getCompletion(state, currentAgent, config);
        }
      } else {
        llmResponse = await config.modelProvider.getCompletion(state, currentAgent, config);
      }
    }
  } else {
    if (typeof config.modelProvider.getCompletionStream === 'function') {
      try {
        streamingUsed = true;
        const stream = config.modelProvider.getCompletionStream(state, currentAgent, config);
        let aggregatedText = '';
        const toolCalls: Array<{ id?: string; type: 'function'; function: { name?: string; arguments: string } }> = [];

        for await (const chunk of stream) {
          if (chunk?.delta) {
            aggregatedText += chunk.delta;
          }
          if (chunk?.toolCallDelta) {
            const idx = chunk.toolCallDelta.index ?? 0;
            while (toolCalls.length <= idx) {
              toolCalls.push({ id: undefined, type: 'function', function: { name: undefined, arguments: '' } });
            }
            const target = toolCalls[idx];
            if (chunk.toolCallDelta.id) target.id = chunk.toolCallDelta.id;
            if (chunk.toolCallDelta.function?.name) target.function.name = chunk.toolCallDelta.function.name;
            if (chunk.toolCallDelta.function?.argumentsDelta) {
              target.function.arguments += chunk.toolCallDelta.function.argumentsDelta;
            }
          }

          if (chunk?.delta || chunk?.toolCallDelta) {
            assistantEventStreamed = true;
            const partialMessage: Message = {
              role: 'assistant',
              content: aggregatedText,
              ...(toolCalls.length > 0
                ? {
                    tool_calls: toolCalls.map((tc, i) => ({
                      id: tc.id ?? `call_${i}`,
                      type: 'function' as const,
                      function: {
                        name: tc.function.name ?? '',
                        arguments: tc.function.arguments
                      }
                    }))
                  }
                : {})
            };
            try { config.onEvent?.({ type: 'assistant_message', data: { message: partialMessage } }); } catch (err) { safeConsole.error('Error in config.onEvent:', err); }
          }
        }

        llmResponse = {
          message: {
            content: aggregatedText || undefined,
            ...(toolCalls.length > 0
              ? {
                  tool_calls: toolCalls.map((tc, i) => ({
                    id: tc.id ?? `call_${i}`,
                    type: 'function' as const,
                    function: {
                      name: tc.function.name ?? '',
                      arguments: tc.function.arguments
                    }
                  }))
                }
              : {})
          }
        };
      } catch (e) {
        streamingUsed = false;
        assistantEventStreamed = false;
        llmResponse = await config.modelProvider.getCompletion(state, currentAgent, config);
      }
    } else {
      llmResponse = await config.modelProvider.getCompletion(state, currentAgent, config);
    }
  }
  
  const usage = (llmResponse as any)?.usage;
  const prompt = (llmResponse as any)?.prompt;
  
  config.onEvent?.({
    type: 'llm_call_end',
    data: { 
      choice: llmResponse,
      fullResponse: llmResponse, // Include complete response
      prompt: prompt, // Include the prompt that was sent
      traceId: state.traceId, 
      runId: state.runId,
      agentName: currentAgent.name,
      model: model || 'unknown',
      usage: usage ? {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens
      } : undefined
    }
  });

  try {
    const usage = (llmResponse as any)?.usage;
    if (usage && (usage.prompt_tokens || usage.completion_tokens || usage.total_tokens)) {
      config.onEvent?.({
        type: 'token_usage',
        data: {
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens,
          model: model || 'unknown'
        }
      });
    }
  } catch { /* ignore */ }

  if (!llmResponse.message) {
    config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
    return {
      finalState: state,
      outcome: {
        status: 'error',
        error: {
          _tag: 'ModelBehaviorError',
          detail: 'No message in model response'
        }
      }
    };
  }

  const assistantMessage: Message = {
    role: 'assistant',
    content: llmResponse.message.content || '',
    tool_calls: llmResponse.message.tool_calls
  };

  if (!assistantEventStreamed) {
    config.onEvent?.({
      type: 'assistant_message',
      data: { message: assistantMessage }
    });
  }

  const newMessages = [...state.messages, assistantMessage];
  const updatedTurnCount = state.turnCount + 1;

  if (llmResponse.message.tool_calls && llmResponse.message.tool_calls.length > 0) {
    safeConsole.log(`[JAF:ENGINE] Processing ${llmResponse.message.tool_calls.length} tool calls`);
    safeConsole.log(`[JAF:ENGINE] Tool calls:`, llmResponse.message.tool_calls);
    
    try {
      const requests = llmResponse.message.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        args: tryParseJSON(tc.function.arguments)
      }));
      config.onEvent?.({ type: 'tool_requests', data: { toolCalls: requests } });
    } catch { /* ignore */ }
    
    const toolResults = await executeToolCalls(
      llmResponse.message.tool_calls,
      currentAgent,
      state,
      config,
    );

    const interruptions = toolResults
      .map(r => r.interruption)
      .filter((interruption): interruption is Interruption<Ctx> => interruption !== undefined);
    if (interruptions.length > 0) {
      const completedToolResults = toolResults.filter(r => !r.interruption);
      const approvalRequiredResults = toolResults.filter(r => r.interruption);
      
      const updatedApprovals = new Map(state.approvals ?? []);
      for (const interruption of interruptions) {
        if (interruption.type === 'tool_approval') {
          updatedApprovals.set(interruption.toolCall.id, {
            status: 'pending',
            approved: false,
            additionalContext: { status: 'pending', timestamp: new Date().toISOString() }
          });
        }
      }
      
      const interruptedState = {
        ...state,
        messages: [...newMessages, ...completedToolResults.map(r => r.message)],
        turnCount: updatedTurnCount,
        approvals: updatedApprovals,
      };

      if (config.memory?.autoStore && config.conversationId) {
        safeConsole.log(`[JAF:ENGINE] Storing conversation state due to interruption for ${config.conversationId}`);
        const stateForStorage = {
          ...interruptedState,
          messages: [...interruptedState.messages, ...approvalRequiredResults.map(r => r.message)]
        };
        await storeConversationHistory(stateForStorage, config);
      }

      return {
        finalState: interruptedState,
        outcome: {
          status: 'interrupted',
          interruptions,
        },
      };
    }

    safeConsole.log(`[JAF:ENGINE] Tool execution completed. Results count:`, toolResults.length);

    config.onEvent?.({
      type: 'tool_results_to_llm',
      data: { results: toolResults.map(r => r.message) }
    });

    if (toolResults.some(r => r.isHandoff)) {
      const handoffResult = toolResults.find(r => r.isHandoff);
      if (handoffResult) {
        const targetAgent = handoffResult.targetAgent!;
        
        if (!currentAgent.handoffs?.includes(targetAgent)) {
          config.onEvent?.({
            type: 'handoff_denied',
            data: { from: currentAgent.name, to: targetAgent, reason: `Agent ${currentAgent.name} cannot handoff to ${targetAgent}` }
          });
          return {
            finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
            outcome: {
              status: 'error',
              error: {
                _tag: 'HandoffError',
                detail: `Agent ${currentAgent.name} cannot handoff to ${targetAgent}`
              }
            }
          };
        }

        config.onEvent?.({
          type: 'handoff',
          data: { from: currentAgent.name, to: targetAgent }
        });

        // Remove any halted messages that are being replaced by actual execution results
        const cleanedNewMessages = newMessages.filter(msg => {
          if (msg.role !== 'tool') return true;
          try {
            const content = JSON.parse(getTextContent(msg.content));
            if (content.status === 'halted') {
              // Remove this halted message if we have a new result for the same tool_call_id
              return !toolResults.some(result => result.message.tool_call_id === msg.tool_call_id);
            }
            return true;
          } catch {
            return true;
          }
        });

        const nextState: RunState<Ctx> = {
          ...state,
          messages: [...cleanedNewMessages, ...toolResults.map(r => r.message)],
          currentAgentName: targetAgent,
          turnCount: updatedTurnCount,
          approvals: state.approvals ?? new Map(),
        };
        config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
        return runInternal(nextState, config);
      }
    }

    // Remove any halted messages that are being replaced by actual execution results
    const cleanedNewMessages = newMessages.filter(msg => {
      if (msg.role !== 'tool') return true;
      try {
        const content = JSON.parse(getTextContent(msg.content));
        if (content.status === 'halted') {
          // Remove this halted message if we have a new result for the same tool_call_id
          return !toolResults.some(result => result.message.tool_call_id === msg.tool_call_id);
        }
        return true;
      } catch {
        return true;
      }
    });

    const nextState: RunState<Ctx> = {
      ...state,
      messages: [...cleanedNewMessages, ...toolResults.map(r => r.message)],
      turnCount: updatedTurnCount,
      approvals: state.approvals ?? new Map(),
    };
    config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
    return runInternal(nextState, config);
  }

  if (llmResponse.message.content) {
    if (currentAgent.outputCodec) {
      const parseResult = currentAgent.outputCodec.safeParse(
        tryParseJSON(llmResponse.message.content)
      );
      
      if (!parseResult.success) {
        config.onEvent?.({ type: 'decode_error', data: { errors: parseResult.error.issues } });
        config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
        return {
          finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
          outcome: {
            status: 'error',
            error: {
              _tag: 'DecodeError',
              errors: parseResult.error.issues
            }
          }
        };
      }

      let outputGuardrailResult;
      if (hasAdvancedGuardrails) {
        // Use new advanced system
        outputGuardrailResult = await executeOutputGuardrails(effectiveOutputGuardrails, parseResult.data, config);
      } else {
        outputGuardrailResult = { isValid: true };
        if (effectiveOutputGuardrails && effectiveOutputGuardrails.length > 0) {
          for (const guardrail of effectiveOutputGuardrails) {
            const result = await guardrail(parseResult.data);
            if (!result.isValid) {
              const errorMessage = 'errorMessage' in result ? result.errorMessage : 'Guardrail violation';
              config.onEvent?.({ type: 'guardrail_violation', data: { stage: 'output', reason: errorMessage } });
              outputGuardrailResult = { isValid: false, errorMessage };
              break;
            }
          }
        }
      }
      if (!outputGuardrailResult.isValid) {
        config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
        return {
          finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
          outcome: {
            status: 'error',
            error: {
              _tag: 'OutputGuardrailTripwire',
              reason: outputGuardrailResult.errorMessage || 'Output guardrail violation'
            }
          }
        };
      }

      config.onEvent?.({ type: 'final_output', data: { output: parseResult.data } });
      // End of turn
      config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });

      return {
        finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
        outcome: {
          status: 'completed',
          output: parseResult.data as Out
        }
      };
    } else {
      let outputGuardrailResult;
      if (hasAdvancedGuardrails) {
        // Use new advanced system
        outputGuardrailResult = await executeOutputGuardrails(effectiveOutputGuardrails, llmResponse.message.content, config);
      } else {
        outputGuardrailResult = { isValid: true };
        if (effectiveOutputGuardrails && effectiveOutputGuardrails.length > 0) {
          for (const guardrail of effectiveOutputGuardrails) {
            const result = await guardrail(llmResponse.message.content);
            if (!result.isValid) {
              const errorMessage = 'errorMessage' in result ? result.errorMessage : 'Guardrail violation';
              config.onEvent?.({ type: 'guardrail_violation', data: { stage: 'output', reason: errorMessage } });
              outputGuardrailResult = { isValid: false, errorMessage };
              break;
            }
          }
        }
      }
      if (!outputGuardrailResult.isValid) {
        config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });
        return {
          finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
          outcome: {
            status: 'error',
            error: {
              _tag: 'OutputGuardrailTripwire',
              reason: outputGuardrailResult.errorMessage || 'Output guardrail violation'
            }
          }
        };
      }

      config.onEvent?.({ type: 'final_output', data: { output: llmResponse.message.content } });
      // End of turn
      config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });

      return {
        finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
        outcome: {
          status: 'completed',
          output: llmResponse.message.content as Out
        }
      };
    }
  }

  config.onEvent?.({ type: 'turn_end', data: { turn: turnNumber, agentName: currentAgent.name } });

  safeConsole.error(`[JAF:ENGINE] No tool calls or content returned by model. LLMResponse: `, llmResponse);
  return {
    finalState: { ...state, messages: newMessages, turnCount: updatedTurnCount },
    outcome: {
      status: 'error',
      error: {
        _tag: 'ModelBehaviorError',
        detail: 'Model produced neither content nor tool calls'
      }
    }
  };
}

type ToolCallResult = {
  message: Message;
  isHandoff?: boolean;
  targetAgent?: string;
  interruption?: Interruption<any>;
};

async function executeToolCalls<Ctx>(
  toolCalls: readonly ToolCall[],
  agent: Agent<Ctx, any>,
  state: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<ToolCallResult[]> {
  try { setToolRuntime(state.context, { state, config }); } catch { /* ignore */ }
  const results = await Promise.all(
    toolCalls.map(async (toolCall): Promise<ToolCallResult> => {
      const tool = agent.tools?.find(t => t.schema.name === toolCall.function.name);
      const startTime = Date.now();
      
      let rawArgs = tryParseJSON(toolCall.function.arguments);

      // Emit before_tool_execution event - handler can return modified args
      if (config.onEvent) {
        try {
          const beforeEventResponse = await config.onEvent({
            type: 'before_tool_execution',
            data: {
              toolName: toolCall.function.name,
              args: rawArgs,
              toolCall,
              traceId: state.traceId,
              runId: state.runId,
              toolSchema: tool ? {
                name: tool.schema.name,
                description: tool.schema.description,
                parameters: tool.schema.parameters
              } : undefined,
              context: state.context,
              state,
              agentName: agent.name
            }
          });

          // If event handler returns a value, use it to override the args
          if (beforeEventResponse !== undefined && beforeEventResponse !== null) {
            console.log(`[JAF:ENGINE] Tool args modified by before_tool_execution event handler for ${toolCall.function.name}`);
            console.log(`[JAF:ENGINE] Original args:`, rawArgs);
            console.log(`[JAF:ENGINE] Modified args:`, beforeEventResponse);
            rawArgs = beforeEventResponse;
          }
        } catch (eventError) {
          console.error(`[JAF:ENGINE] Error in before_tool_execution event handler:`, eventError);
          // Continue with original args if event handler fails
        }
      }

      // Emit tool_call_start event (for observation) with potentially modified args
      config.onEvent?.({
        type: 'tool_call_start',
        data: {
          toolName: toolCall.function.name,
          args: rawArgs,
          traceId: state.traceId,
          runId: state.runId,
          toolSchema: tool ? {
            name: tool.schema.name,
            description: tool.schema.description,
            parameters: tool.schema.parameters
          } : undefined,
          context: state.context,
          agentName: agent.name
        }
      });

      try {
        if (!tool) {
          const errorResult = JSON.stringify({
            status: "tool_not_found",
            message: `Tool ${toolCall.function.name} not found`,
            tool_name: toolCall.function.name,
          });

          config.onEvent?.({
            type: 'tool_call_end',
            data: {
              toolName: toolCall.function.name,
              result: errorResult,
              traceId: state.traceId,
              runId: state.runId,
              status: 'error',
              toolResult: { error: 'tool_not_found' },
              executionTime: Date.now() - startTime,
              error: { type: 'tool_not_found', message: `Tool ${toolCall.function.name} not found` }
            }
          });

          return {
            message: {
              role: 'tool',
              content: errorResult,
              tool_call_id: toolCall.id
            }
          };
        }

        const parseResult = tool.schema.parameters.safeParse(rawArgs);

        if (!parseResult.success) {
          const errorResult = JSON.stringify({
            status: "validation_error",
            message: `Invalid arguments for ${toolCall.function.name}: ${parseResult.error.message}`,
            tool_name: toolCall.function.name,
            validation_errors: parseResult.error.issues
          });

          config.onEvent?.({
            type: 'tool_call_end',
            data: { 
              toolName: toolCall.function.name, 
              result: errorResult,
              traceId: state.traceId,
              runId: state.runId,
              status: 'error',
              toolResult: { error: 'validation_error', details: parseResult.error.issues },
              executionTime: Date.now() - startTime,
              error: { type: 'validation_error', message: `Invalid arguments for ${toolCall.function.name}`, details: parseResult.error.issues }
            }
          });

          return {
            message: {
              role: 'tool',
              content: errorResult,
              tool_call_id: toolCall.id
            }
          };
        }

        let needsApproval = false;
        if (typeof tool.needsApproval === 'function') {
          needsApproval = await tool.needsApproval(state.context, parseResult.data);
        } else {
          needsApproval = !!tool.needsApproval;
        }

        const approvalStatus = state.approvals?.get(toolCall.id);
        const derivedStatus: 'approved' | 'rejected' | 'pending' | undefined =
          approvalStatus?.status ?? (
            approvalStatus?.approved === true
              ? 'approved'
              : approvalStatus?.approved === false
                ? ((approvalStatus?.additionalContext as any)?.status === 'pending' ? 'pending' : 'rejected')
                : undefined
          );

        const isPending = derivedStatus === 'pending';

        if (needsApproval && (approvalStatus === undefined || isPending)) {
          return {
            interruption: {
              type: 'tool_approval',
              toolCall,
              agent,
              sessionId: state.runId,
            },
            message: {
              role: 'tool',
              content: JSON.stringify({
                status: 'halted',
                message: `Tool ${toolCall.function.name} requires approval.`,
              }),
              tool_call_id: toolCall.id,
            },
          };
        }

        const additionalContext = approvalStatus?.additionalContext;

        if (derivedStatus === 'rejected') {
          const rejectionReason = additionalContext?.rejectionReason || 'User declined the action';
          return {
            message: {
              role: 'tool',
              content: JSON.stringify({
                status: 'approval_denied',
                message: `Action was not approved. ${rejectionReason}. Please ask if you can help with something else or suggest an alternative approach.`,
                tool_name: toolCall.function.name,
                rejection_reason: rejectionReason,
                additionalContext,
              }),
              tool_call_id: toolCall.id,
            },
          };
        }

        safeConsole.log(`[JAF:ENGINE] About to execute tool: ${toolCall.function.name}`);
        safeConsole.log(`[JAF:ENGINE] Tool args:`, parseResult.data);
        safeConsole.log(`[JAF:ENGINE] Tool context:`, state.context);
        
        const contextWithAdditional = additionalContext 
          ? { ...state.context, ...additionalContext }
          : state.context;
        
        let toolResult = await tool.execute(parseResult.data, contextWithAdditional);
        
        // Apply onAfterToolExecution callback if configured
        if (config.onAfterToolExecution) {
          try {
            const toolResultStatus = typeof toolResult === 'string' ? 'success' : (toolResult?.status || 'success');
            
            const modifiedResult = await config.onAfterToolExecution(
              toolCall.function.name,
              toolResult,
              {
                toolCall,
                args: parseResult.data,
                state,
                agentName: agent.name,
                executionTime: Date.now() - startTime,
                status: toolResultStatus
              }
            );
            if (modifiedResult !== undefined && modifiedResult !== null) {
              toolResult = modifiedResult;
            }
          } catch (callbackError) {
            console.error(`[JAF:ENGINE] Error in onAfterToolExecution callback for ${toolCall.function.name}:`, callbackError);
            // Continue with original result if callback fails
          }
        }
        let resultString: string;
        let toolResultObj: any = null;
        
        if (typeof toolResult === 'string') {
          resultString = toolResult;
          safeConsole.log(`[JAF:ENGINE] Tool ${toolCall.function.name} returned string:`, resultString);
        } else {
          toolResultObj = toolResult;
          const { toolResultToString } = await import('./tool-results');
          resultString = toolResultToString(toolResult);
          safeConsole.log(`[JAF:ENGINE] Tool ${toolCall.function.name} returned ToolResult:`, toolResult);
          safeConsole.log(`[JAF:ENGINE] Converted to string:`, resultString);
        }

        config.onEvent?.({
          type: 'tool_call_end',
          data: { 
            toolName: toolCall.function.name, 
            result: resultString,
            traceId: state.traceId,
            runId: state.runId,
            toolResult: toolResultObj,
            status: toolResultObj?.status || 'success',
            executionTime: Date.now() - startTime,
            metadata: {
              agentName: agent.name,
              parsedArgs: parseResult.data,
              context: state.context,
              resultType: typeof toolResult === 'string' ? 'string' : 'object'
            }
          }
        });

        const handoffCheck = tryParseJSON(resultString);
        if (handoffCheck && typeof handoffCheck === 'object' && 'handoff_to' in handoffCheck) {
          return {
            message: {
              role: 'tool',
              content: resultString,
              tool_call_id: toolCall.id
            },
            isHandoff: true,
            targetAgent: handoffCheck.handoff_to as string
          };
        }

        let finalContent;
        if (additionalContext && Object.keys(additionalContext).length > 0) {
          finalContent = JSON.stringify({
            status: 'approved_and_executed',
            result: resultString,
            tool_name: toolCall.function.name,
            approval_context: additionalContext,
            message: 'Tool was approved and executed successfully with additional context.'
          });
        } else if (needsApproval) {
          finalContent = JSON.stringify({
            status: 'approved_and_executed',
            result: resultString,
            tool_name: toolCall.function.name,
            message: 'Tool was approved and executed successfully.'
          });
        } else {
          finalContent = JSON.stringify({
            status: 'executed',
            result: resultString,
            tool_name: toolCall.function.name,
            message: 'Tool executed successfully.'
          });
        }

        return {
          message: {
            role: 'tool',
            content: finalContent,
            tool_call_id: toolCall.id
          }
        };

      } catch (error) {
        const errorResult = JSON.stringify({
          status: "execution_error",
          message: error instanceof Error ? error.message : String(error),
          tool_name: toolCall.function.name,
        });

        config.onEvent?.({
          type: 'tool_call_end',
          data: { 
            toolName: toolCall.function.name, 
            result: errorResult,
            traceId: state.traceId,
            runId: state.runId,
            status: 'error',
            toolResult: { error: 'execution_error', detail: error instanceof Error ? error.message : String(error) },
            executionTime: Date.now() - startTime,
            error: { 
              type: 'execution_error', 
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined
            }
          }
        });

        return {
          message: {
            role: 'tool',
            content: errorResult,
            tool_call_id: toolCall.id
          }
        };
      }
    })
  );

  return results;
}

function tryParseJSON(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

/**
 * Load conversation history from memory and merge with initial state
 */
async function loadConversationHistory<Ctx>(
  initialState: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<RunState<Ctx>> {
  if (!config.memory?.provider || !config.conversationId) {
    return initialState;
  }

  const result = await config.memory.provider.getConversation(config.conversationId);
  if (!result.success) {
    safeConsole.warn(`[JAF:MEMORY] Failed to load conversation history: ${result.error}`);
    return initialState;
  }

  if (!result.data) {
    safeConsole.log(`[JAF:MEMORY] No existing conversation found for ${config.conversationId}`);
    return initialState;
  }

  const maxMessages = config.memory.maxMessages || result.data.messages.length;
  const allMemoryMessages = result.data.messages.slice(-maxMessages);
  
  const memoryMessages = allMemoryMessages.filter(msg => {
    if (msg.role !== 'tool') return true;
    try {
      const content = JSON.parse(getTextContent(msg.content));
      return content.status !== 'halted';
    } catch {
      return true; // Keep non-JSON tool messages
    }
  });
  
  const combinedMessages = memoryMessages.length > 0 
    ? [...memoryMessages, ...initialState.messages.filter(msg => 
        !memoryMessages.some(memMsg => 
          memMsg.role === msg.role && 
          memMsg.content === msg.content && 
          JSON.stringify(memMsg.tool_calls) === JSON.stringify(msg.tool_calls)
        )
      )]
    : initialState.messages;
  
  const storedApprovals = result.data.metadata?.approvals;
  const approvalsMap = storedApprovals 
    ? new Map(Object.entries(storedApprovals) as [string, any][])
    : (initialState.approvals ?? new Map());

  safeConsole.log(`[JAF:MEMORY] Loaded ${allMemoryMessages.length} messages from memory, filtered to ${memoryMessages.length} for LLM context (removed halted messages)`);
  if (storedApprovals) {
    safeConsole.log(`[JAF:MEMORY] Loaded ${Object.keys(storedApprovals).length} approvals from memory`);
  }
  safeConsole.log(`[JAF:MEMORY] Memory messages:`, memoryMessages.map(m => ({ role: m.role, content: getTextContent(m.content)?.substring(0, 100) + '...' })));
  safeConsole.log(`[JAF:MEMORY] New messages:`, initialState.messages.map(m => ({ role: m.role, content: getTextContent(m.content)?.substring(0, 100) + '...' })));
  safeConsole.log(`[JAF:MEMORY] Combined messages (${combinedMessages.length} total):`, combinedMessages.map(m => ({ role: m.role, content: getTextContent(m.content)?.substring(0, 100) + '...' })));
  
  return {
    ...initialState,
    messages: combinedMessages,
    approvals: approvalsMap
  };
}

/**
 * Store conversation history to memory
 */
async function storeConversationHistory<Ctx>(
  finalState: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<void> {
  if (!config.memory?.provider || !config.conversationId) {
    return;
  }

  let messagesToStore = finalState.messages;
  if (config.memory.compressionThreshold && messagesToStore.length > config.memory.compressionThreshold) {
    const keepFirst = Math.floor(config.memory.compressionThreshold * 0.2);
    const keepRecent = config.memory.compressionThreshold - keepFirst;
    
    messagesToStore = [
      ...messagesToStore.slice(0, keepFirst),
      ...messagesToStore.slice(-keepRecent)
    ];

    safeConsole.log(`[JAF:MEMORY] Compressed conversation from ${finalState.messages.length} to ${messagesToStore.length} messages`);
  }

  const metadata = {
    userId: (finalState.context as any)?.userId,
    traceId: finalState.traceId,
    runId: finalState.runId,
    agentName: finalState.currentAgentName,
    turnCount: finalState.turnCount,
    approvals: Object.fromEntries(finalState.approvals ?? new Map()) // Store approvals in metadata
  };

  const result = await config.memory.provider.storeMessages(config.conversationId, messagesToStore, metadata);
  if (!result.success) {
    safeConsole.warn(`[JAF:MEMORY] Failed to store conversation history: ${JSON.stringify(result.error)}`);
    return;
  }

  safeConsole.log(`[JAF:MEMORY] Stored ${messagesToStore.length} messages for conversation ${config.conversationId}`);
}

<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:42:31 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
99,451 / 200K tokens used (50%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


Perfect! I can now answer both questions definitively by examining the code. Let me create a comprehensive explanation.

<attempt_completion>
<result>
# Answers to Your Questions About JAF

## Question 1: How Does the LLM Know About the Handoff Tool?

**Answer: The handoff tool is NOT automatically added to agents. You must manually include it in your agent's tools array.**

### Evidence from Code:

From `src/policies/handoff.ts`:
```typescript
export const handoffTool: Tool<HandoffArgs, any> = {
  schema: {
    name: "handoff_to_agent",
    description: "Delegate the task to a different, more specialized agent.",
    parameters: handoffArgsSchema,
  },
  execute: async (args, _) => {
    return JSON.stringify({ 
      handoff_to: args.agentName,
      reason: args.reason,
      timestamp: new Date().toISOString()
    });
  },
}
```

**The handoff tool is just a regular tool exported from JAF.** You must add it to your agent definition:

```typescript
import { handoffTool } from '@xynehq/jaf';

const triageAgent = {
  name: 'triage',
  instructions: () => 'You triage customer requests...',
  tools: [
    handoffTool,  // ← YOU must add this!
    otherTools...
  ],
  handoffs: ['billing', 'technical']  // ← Allowed handoff targets
}
```

### How It Appears to the LLM:

From `src/providers/model.ts` (line ~271):
```typescript
const tools = agent.tools?.map(t => ({
  type: 'function' as const,
  function: {
    name: t.schema.name,
    description: t.schema.description,
    parameters: zodSchemaToJsonSchema(t.schema.parameters),
  },
}));
```

**The LLM sees it like this:**
```json
{
  "type": "function",
  "function": {
    "name": "handoff_to_agent",
    "description": "Delegate the task to a different, more specialized agent.",
    "parameters": {
      "type": "object",
      "properties": {
        "agentName": {
          "type": "string",
          "description": "The name of the agent to handoff to."
        },
        "reason": {
          "type": "string",
          "description": "The reason for the handoff."
        }
      },
      "required": ["agentName", "reason"]
    }
  }
}
```

**The LLM doesn't know it's "special" - it's just another tool!** The magic happens in JAF's engine when it detects the `handoff_to` field in the tool result.

### How JAF Detects Handoffs:

From `src/core/engine.ts` (line ~1049):
```typescript
const handoffCheck = tryParseJSON(resultString);
if (handoffCheck && typeof handoffCheck === 'object' && 'handoff_to' in handoffCheck) {
  return {
    message: {
      role: 'tool',
      content: resultString,
      tool_call_id: toolCall.id
    },
    isHandoff: true,  // ← JAF marks this as a handoff
    targetAgent: handoffCheck.handoff_to as string
  };
}
```

**Summary for Question 1:**
- ❌ Handoff tool is NOT automatically added
- ✅ You must manually add `handoffTool` to `agent.tools` array
- ✅ LLM sees it as a normal function with name and description
- ✅ JAF detects handoff by looking for `handoff_to` field in tool result
- ✅ You also need to define `agent.handoffs` array to authorize which agents can be handed off to

---

## Question 2: Multiple Tool Calls - Parallel or Sequential?

**Answer: ALL tool calls from a single LLM response are executed IN PARALLEL, and ALL results are passed back to the LLM in the NEXT turn (not across multiple turns).**

### Evidence from Code:

From `src/core/engine.ts` (line ~697):
```typescript
if (llmResponse.message.tool_calls && llmResponse.message.tool_calls.length > 0) {
  safeConsole.log(`[JAF:ENGINE] Processing ${llmResponse.message.tool_calls.length} tool calls`);
  
  // Execute ALL tool calls
  const toolResults = await executeToolCalls(
    llmResponse.message.tool_calls,  // ← ALL tool calls passed at once
    currentAgent,
    state,
    config,
  );
  
  // ... handle results ...
  
  // Add ALL results to messages and recurse
  const nextState: RunState<Ctx> = {
    ...state,
    messages: [...cleanedNewMessages, ...toolResults.map(r => r.message)],  // ← ALL results
    turnCount: updatedTurnCount,
    approvals: state.approvals ?? new Map(),
  };
  return runInternal(nextState, config);  // ← Next turn with ALL results
}
```

### The Execution Function:

From `src/core/engine.ts` (line ~769-771):
```typescript
async function executeToolCalls<Ctx>(
  toolCalls: readonly ToolCall[],  // ← Array of ALL tool calls
  agent: Agent<Ctx, any>,
  state: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<ToolCallResult[]> {
  try { setToolRuntime(state.context, { state, config }); } catch { /* ignore */ }
  
  // KEY: Promise.all = PARALLEL execution!
  const results = await Promise.all(
    toolCalls.map(async (toolCall): Promise<ToolCallResult> => {
      // Execute each tool call
      const tool = agent.tools?.find(t => t.schema.name === toolCall.function.name);
      // ... validation, approval checks, execution ...
    })
  );

  return results;  // ← ALL results returned together
}
```

**`Promise.all` is the key!** This means:
- ✅ All 3 tool calls execute **simultaneously** (parallel)
- ✅ JAF waits for **all of them** to complete
- ✅ All 3 results are collected into one array
- ✅ All 3 results are added to messages **at once**
- ✅ The next LLM call sees **all 3 results** in one turn

### Example Flow:

```typescript
// TURN 1: LLM Response
{
  role: 'assistant',
  tool_calls: [
    { id: 'call_1', function: { name: 'search_flights', arguments: '...' } },
    { id: 'call_2', function: { name: 'check_weather', arguments: '...' } },
    { id: 'call_3', function: { name: 'calculate_price', arguments: '...' } }
  ]
}

// JAF executes ALL 3 in parallel using Promise.all:
const toolResults = await Promise.all([
  executeToolCall('search_flights'),  // Executes simultaneously
  executeToolCall('check_weather'),   // Executes simultaneously  
  executeToolCall('calculate_price')  // Executes simultaneously
]);

// State after execution:
state.messages = [
  { role: 'user', content: 'Book me a flight...' },
  { role: 'assistant', tool_calls: [...] },
  { role: 'tool', tool_call_id: 'call_1', content: '{"flights": [...]}' },
  { role: 'tool', tool_call_id: 'call_2', content: '{"weather": {...}}' },
  { role: 'tool', tool_call_id: 'call_3', content: '{"price": 450}' }
];

// TURN 2: LLM sees ALL 3 results
// Next LLM call gets:
// - System: agent instructions
// - User: original message
// - Assistant: with 3 tool calls
// - Tool: result 1
// - Tool: result 2
// - Tool: result 3
```

### What Gets Sent to LLM in Next Turn:

From `src/providers/model.ts` (line ~257-262):
```typescript
const systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
  role: 'system',
  content: agent.instructions(state),
};

const convertedMessages = await Promise.all(state.messages.map(convertMessage));
const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
  systemMessage,
  ...convertedMessages,  // ← Contains ALL tool results
];
```

**The LLM receives:**
```json
[
  { "role": "system", "content": "You are a flight booking agent..." },
  { "role": "user", "content": "Book me a flight to NYC" },
  { 
    "role": "assistant", 
    "tool_calls": [
      {"id": "call_1", "function": {"name": "search_flights", "arguments": "..."}},
      {"id": "call_2", "function": {"name": "check_weather", "arguments": "..."}},
      {"id": "call_3", "function": {"name": "calculate_price", "arguments": "..."}}
    ]
  },
  { "role": "tool", "tool_call_id": "call_1", "content": "{\"flights\": [...]}" },
  { "role": "tool", "tool_call_id": "call_2", "content": "{\"weather\": {...}}" },
  { "role": "tool", "tool_call_id": "call_3", "content": "{\"price\": 450}" }
]
```

**Summary for Question 2:**
- ✅ Multiple tool calls execute **IN PARALLEL** (using `Promise.all`)
- ✅ ALL tool results are collected together
- ✅ ALL results are added to messages **at once**
- ✅ ALL results go to LLM in the **NEXT SINGLE TURN**
- ❌ NOT spread across multiple turns
- ❌ NOT executed sequentially one-by-one

### Performance Implications:

**Parallel execution means:**
- 🚀 Faster execution (tools run simultaneously)
- ⚡ All I/O operations happen at once
- 📊 Better utilization of async operations

**Example timing:**
```
Sequential would be:
  Tool 1: 2 seconds
  Tool 2: 3 seconds  
  Tool 3: 1 second
  Total: 6 seconds

Parallel (current implementation):
  All tools: max(2, 3, 1) = 3 seconds!
```

---

## Complete Picture

**Turn 1:**
```
User message 
  → LLM call 
  → Returns 3 tool calls 
  → Execute ALL 3 in parallel (Promise.all)
  → Collect ALL 3 results
  → Add ALL to messages
```

**Turn 2:**
```
ALL 3 tool results 
  → LLM call (sees all results)
  → Returns final answer or more tool calls
```

This design is efficient and aligns with OpenAI's function calling paradigm where the LLM can request multiple parallel operations.
</result>
<task_progress>
- [x] Find how handoff tool is provided to agents
- [x] Examine multiple tool call execution logic
- [x] Document findings clearly
</task_progress>
</attempt_completion>

---

**User:**

[TASK RESUMPTION] This task was interrupted 9 minutes ago. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '/Users/aayush.shah/Desktop/projects/jaf'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.

Note: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.
New instructions for task continuation:
<user_message>
what if LLM selected 3 tools . 2nd and 3rd tools are dependant on 1st so 2nd and 3rd must start after 1st . IS IT POSSIBLE with JAF?
</user_message>

# TODO LIST RECOMMENDED

When starting a new task, it is recommended to create a todo list.


1. Include the task_progress parameter in your next tool call
2. Create a comprehensive checklist of all steps needed
3. Use markdown format: - [ ] for incomplete, - [x] for complete

**Benefits of creating a todo list now:**
	- Clear roadmap for implementation
	- Progress tracking throughout the task
	- Nothing gets forgotten or missed
	- Users can see, monitor, and edit the plan

**Example structure:**```
- [ ] Analyze requirements
- [ ] Set up necessary files
- [ ] Implement main functionality
- [ ] Handle edge cases
- [ ] Test the implementation
- [ ] Verify results```

Keeping the todo list updated helps track progress and ensures nothing is missed.

<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:52:56 PM (Asia/Calcutta, UTC+5.5:00)

# Current Working Directory (/Users/aayush.shah/Desktop/projects/jaf) Files
.env.test
.eslintrc.js
.gitignore
.npmignore
CHANGELOG_EVENT_IMPROVEMENTS.md
docker-compose.test.yml
jest.config.js
jest.setup.js
LICENSE
mkdocs.yml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
QUICK_REFERENCE_EVENT_HANDLERS.md
README.md
requirements.txt
tsconfig.json
dependencies/
dependencies/pdf-parse/
dependencies/pdf-parse/.editorconfig
dependencies/pdf-parse/.gitignore
dependencies/pdf-parse/.gitlab-ci.yml
dependencies/pdf-parse/.jsbeautifyrc
dependencies/pdf-parse/.npmrc
dependencies/pdf-parse/CHANGELOG
dependencies/pdf-parse/CONTRIBUTING.md
dependencies/pdf-parse/index.d.ts
dependencies/pdf-parse/index.js
dependencies/pdf-parse/LICENSE
dependencies/pdf-parse/NOTES.md
dependencies/pdf-parse/package.json
dependencies/pdf-parse/QUICKSTART.js
dependencies/pdf-parse/README.md
dependencies/pdf-parse/lib/
dependencies/pdf-parse/test/
docs/
docs/a2a-integration.md
docs/a2a-protocol.md
docs/adk-analysis.md
docs/adk-layer.md
docs/agents-as-tools.md
docs/api-reference.md
docs/CONTRIBUTING.md
docs/core-concepts.md
docs/cover.png
docs/deployment.md
docs/event-handling-guide.md
docs/examples.md
docs/favicon.png
docs/getting-started.md
docs/jaf-adk-layer-plan.md
docs/llm-prompting-and-turns.md
docs/logo.png
docs/memory-system.md
docs/model-providers.md
docs/new-features.md
docs/README.md
docs/safe-logging.md
docs/sanitization.md
docs/serve.sh
docs/server-api.md
docs/tools.md
docs/trace-events-reference.md
docs/tracing.md
docs/troubleshooting.md
docs/visualization.md
docs/stylesheets/
docs/stylesheets/extra.css
examples/
examples/attachment-demo-server.ts
examples/custom-sanitization-example.ts
examples/guardrails-demo.ts
examples/safe-logging-example.ts
examples/verify-param-modification.ts
examples/agent-as-tool-demo/
examples/agent-as-tool-demo/.env.example
examples/agent-as-tool-demo/index.ts
examples/agent-as-tool-demo/package.json
examples/agent-as-tool-demo/README.md
examples/agent-as-tool-demo/tsconfig.json
examples/ai-sdk-provider-demo/
examples/ai-sdk-provider-demo/.env.example
examples/ai-sdk-provider-demo/package.json
examples/ai-sdk-provider-demo/reasoning-ui-example.tsx
examples/ai-sdk-provider-demo/server.ts
examples/ai-sdk-provider-demo/test-vertex.ts
examples/ai-sdk-provider-demo/test.ts
examples/ai-sdk-provider-demo/tsconfig.json
examples/flight-booking/
examples/flight-booking/.env.example
examples/flight-booking/index.ts
examples/flight-booking/jaf-server.ts
examples/flight-booking/multi-agent.ts
examples/flight-booking/package.json
examples/flight-booking/README.md
examples/flight-booking/tsconfig.json
examples/hitl-demo/
examples/hitl-demo/.env.example
examples/hitl-demo/api-demo.ts
examples/hitl-demo/index.ts
examples/hitl-demo/package.json
examples/hitl-demo/README.md
examples/hitl-demo/run-server.ts
examples/hitl-demo/tsconfig.json
examples/hitl-demo/shared/
examples/math-tool-demo/
examples/math-tool-demo/index.ts
examples/math-tool-demo/package.json
examples/math-tool-demo/README.md
examples/math-tool-demo/tsconfig.json
examples/mcp-demo/
examples/mcp-demo/.env.example
examples/mcp-demo/.gitignore
examples/mcp-demo/mcp-filesystem-server.ts
examples/mcp-demo/package.json
examples/mcp-demo/README.md
examples/mcp-demo/tsconfig.json
examples/mcp-http-demo/
examples/mcp-http-demo/index.ts
examples/mcp-http-demo/package.json
examples/mcp-http-demo/README.md
examples/mcp-http-demo/run-server.ts
examples/mcp-http-demo/tsconfig.json
examples/mcp-sse-demo/
examples/mcp-sse-demo/index.ts
examples/mcp-sse-demo/package.json
examples/mcp-sse-demo/README.md
examples/mcp-sse-demo/run-server.ts
examples/mcp-sse-demo/tsconfig.json
examples/otel-tracing-demo/
examples/otel-tracing-demo/.env.example
examples/otel-tracing-demo/otel-demo.ts
examples/otel-tracing-demo/package.json
examples/rag-demo/
examples/rag-demo/.env.example
examples/rag-demo/.gitignore
examples/rag-demo/DEMO_SUMMARY.md
examples/rag-demo/index.ts
examples/rag-demo/package.json
examples/rag-demo/rag-agent.ts
examples/rag-demo/rag-tool.ts
examples/rag-demo/README.md
examples/rag-demo/tsconfig.json
examples/server-demo/
examples/server-demo/.env.example
examples/server-demo/index.ts
examples/server-demo/package.json
examples/server-demo/README.md
examples/server-demo/tsconfig.json
examples/simple-event-handler-demo/
examples/simple-event-handler-demo/.env.example
examples/simple-event-handler-demo/.gitignore
examples/simple-event-handler-demo/DEMO_OUTPUT.md
examples/simple-event-handler-demo/index.ts
examples/simple-event-handler-demo/package.json
examples/simple-event-handler-demo/README.md
examples/simple-event-handler-demo/tsconfig.json
examples/streaming-demo/
examples/streaming-demo/package.json
examples/streaming-demo/README.md
examples/streaming-demo/server.ts
examples/streaming-demo/stream-direct.ts
examples/streaming-demo/stream-plain.ts
examples/streaming-demo/tsconfig.json
examples/visualization-demo/
examples/visualization-demo/index.ts
examples/visualization-demo/package.json
examples/visualization-demo/README.md
scripts/
scripts/setup-test-db.sh
scripts/teardown-test-db.sh
src/
src/index.ts
src/__tests__/
src/__tests__/agent-as-tool.test.ts
src/__tests__/engine.test.ts
src/__tests__/hitl.test.ts
src/__tests__/validation.test.ts
src/a2a/
src/a2a/agent-card.ts
src/a2a/agent.ts
src/a2a/client.ts
src/a2a/executor.ts
src/a2a/index.ts
src/a2a/protocol.ts
src/a2a/server.ts
src/a2a/__tests__/
src/a2a/examples/
src/a2a/memory/
src/adk/
src/core/
src/memory/
src/policies/
src/providers/
src/server/
src/test-utils/
src/tools/
src/types/
src/utils/
src/visualization/

(File list truncated. Use list_files on specific subdirectories if you need to explore further.)

# Workspace Configuration
{
  "workspaces": {
    "/Users/aayush.shah/Desktop/projects/jaf": {
      "hint": "jaf",
      "associatedRemoteUrls": [
        "origin: https://github.com/xynehq/jaf.git"
      ],
      "latestGitCommitHash": "6b97fee9bf8ff6c6bd5970d1c4969597c3e36860"
    }
  }
}

# Detected CLI Tools
These are some of the tools on the user's machine, and may be useful if needed to accomplish the task: git, docker, kubectl, gcloud, npm, pnpm, pip, curl, jq, make, python, node, mysql, sqlite3, code, grep, sed, awk, brew, bundle. This list is not exhaustive, and other tools may be available.

# Context Window Usage
117,399 / 200K tokens used (59%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<attempt_completion>
<result>
# Sequential Tool Execution with Dependencies in JAF

## Direct Answer: **NO, JAF Cannot Enforce Sequential Execution Natively**

**JAF executes all tool calls from the same LLM response in parallel using `Promise.all()`**, which means tools 2 and 3 will start at the same time as tool 1, not after it completes.

### Evidence from Code:

```typescript
// From src/core/engine.ts (line ~771)
async function executeToolCalls<Ctx>(
  toolCalls: readonly ToolCall[],
  agent: Agent<Ctx, any>,
  state: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<ToolCallResult[]> {
  const results = await Promise.all(  // ← PARALLEL execution
    toolCalls.map(async (toolCall): Promise<ToolCallResult> => {
      // Each tool executes simultaneously
    })
  );
  return results;
}
```

## Why This Design?

1. **Performance**: Parallel execution is faster for independent operations
2. **LLM Function Calling Standard**: OpenAI and other providers expect parallel execution
3. **Simplicity**: No complex dependency management needed in the framework

## Workarounds for Sequential Dependencies

### **Solution 1: Rely on the LLM's Intelligence** ✅ **RECOMMENDED**

The LLM is smart enough to call tools sequentially across multiple turns when it understands dependencies.

**Example Agent Instructions:**
```typescript
const smartAgent = {
  name: 'sequential_executor',
  instructions: (state) => `
    You are a task executor that understands tool dependencies.
    
    IMPORTANT: When tools depend on each other's results:
    1. Call the first tool and WAIT for the result
    2. Analyze the result
    3. Then call dependent tools with the information from step 1
    
    Example:
    - First call: search_flights
    - Wait for results
    - Then call: calculate_price (using flight IDs from search results)
    - Then call: check_seat_availability (using flight IDs)
    
    NEVER call dependent tools in the same turn if they need data from previous tools.
  `,
  tools: [searchFlightsTool, calculatePriceTool, checkSeatsTool]
}
```

**What Happens:**

```typescript
// Turn 1: LLM calls only the first tool
{
  role: 'assistant',
  tool_calls: [
    { id: 'call_1', function: { name: 'search_flights', arguments: '{"origin":"NYC"}' } }
  ]
}
// Tool executes → Returns flight IDs

// Turn 2: LLM receives flight results, then calls dependent tools
{
  role: 'assistant',
  tool_calls: [
    { id: 'call_2', function: { name: 'calculate_price', arguments: '{"flight_id":"FL123"}' } },
    { id: 'call_3', function: { name: 'check_seats', arguments: '{"flight_id":"FL123"}' } }
  ]
}
// Tools 2 and 3 execute in parallel (which is fine since they both use FL123)
```

**Pros:**
- ✅ No code changes needed
- ✅ Works with JAF's design
- ✅ LLM handles logic naturally
- ✅ Flexible - LLM can parallelize when safe

**Cons:**
- ❌ Relies on LLM understanding
- ❌ Uses more turns
- ❌ More LLM calls = higher cost

---

### **Solution 2: Create a Composite Tool** ✅ **BEST FOR STRICT REQUIREMENTS**

Wrap the sequential logic in a single tool that handles the dependency internally.

```typescript
const bookFlightSequentialTool = {
  schema: {
    name: 'book_flight_sequential',
    description: 'Search for flights, calculate price, and check availability in sequence',
    parameters: z.object({
      origin: z.string(),
      destination: z.string(),
      date: z.string()
    })
  },
  execute: async (args, context) => {
    // Step 1: Search flights
    const flights = await searchFlights(args);
    
    if (!flights || flights.length === 0) {
      return JSON.stringify({
        status: 'no_flights',
        message: 'No flights found'
      });
    }
    
    // Step 2: Calculate prices (depends on Step 1)
    const flightsWithPrices = await Promise.all(
      flights.map(async (flight) => ({
        ...flight,
        price: await calculatePrice(flight.id)
      }))
    );
    
    // Step 3: Check seat availability (depends on Step 1)
    const flightsWithSeats = await Promise.all(
      flightsWithPrices.map(async (flight) => ({
        ...flight,
        seatsAvailable: await checkSeatAvailability(flight.id)
      }))
    );
    
    return JSON.stringify({
      status: 'success',
      flights: flightsWithSeats
    });
  }
}

const agent = {
  name: 'booking_agent',
  instructions: () => 'Use book_flight_sequential to search and analyze flights',
  tools: [bookFlightSequentialTool]  // Single tool does everything
}
```

**Pros:**
- ✅ Guaranteed sequential execution
- ✅ Single LLM turn
- ✅ No dependency on LLM understanding
- ✅ Full control over execution order

**Cons:**
- ❌ Less flexible (hardcoded sequence)
- ❌ Can't handle dynamic dependencies
- ❌ Larger, more complex tools

---

### **Solution 3: Use Before Tool Execution Event Hook** ⚠️ **ADVANCED**

Intercept tool calls and enforce sequential execution manually.

```typescript
const config: RunConfig<Context> = {
  agentRegistry,
  modelProvider,
  onEvent: async (event) => {
    if (event.type === 'before_tool_execution') {
      const toolName = event.data.toolName;
      
      // Check if this is a dependent tool
      const dependentTools = ['calculate_price', 'check_seats'];
      if (dependentTools.includes(toolName)) {
        // Check if search_flights has been called yet
        const searchResult = await checkIfToolWasExecuted('search_flights', state);
        
        if (!searchResult) {
          // Return error - dependency not met
          throw new Error(`${toolName} requires search_flights to be executed first`);
        }
      }
    }
  }
}
```

**Pros:**
- ✅ Framework-level enforcement
- ✅ Can implement complex dependency logic

**Cons:**
- ❌ Very complex to implement correctly
- ❌ Still won't change parallel execution (just fails dependent tools)
- ❌ Not recommended - better to use other solutions

---

### **Solution 4: Agent-as-Tool Pattern for Complex Workflows**

Create specialized sub-agents that handle sequential logic.

```typescript
// Step 1: Create a workflow coordinator agent
const workflowAgent = {
  name: 'workflow_coordinator',
  instructions: () => `
    You coordinate complex workflows with dependencies.
    Always execute steps in order:
    1. Search
    2. Analyze results
    3. Process based on analysis
  `,
  tools: [
    searchTool,
    analyzeTool,
    processTool
  ]
}

// Step 2: Wrap it as a tool
const workflowTool = agentAsTool(workflowAgent, {
  toolName: 'execute_flight_workflow',
  maxTurns: 10  // Allow multiple turns for sequential execution
});

// Step 3: Main agent uses the workflow tool
const mainAgent = {
  name: 'main',
  instructions: () => 'Use execute_flight_workflow for flight bookings',
  tools: [workflowTool]
}
```

**How it works:**
1. Main agent calls `execute_flight_workflow` tool
2. Sub-agent (workflowAgent) starts isolated execution
3. Sub-agent calls tools sequentially across multiple turns:
   - Turn 1: calls `search`
   - Turn 2: calls `analyze` with search results
   - Turn 3: calls `process` with analysis
4. Sub-agent returns final result to main agent

**Pros:**
- ✅ Clean separation of concerns
- ✅ Reusable workflow logic
- ✅ Sub-agent handles complexity
- ✅ Natural sequential execution

**Cons:**
- ❌ More complex architecture
- ❌ Additional turns inside sub-agent

---

## Comparison Table

| Solution | Sequential Guarantee | Complexity | Flexibility | LLM Calls |
|----------|---------------------|------------|-------------|-----------|
| LLM Intelligence | ⚠️ High (relies on LLM) | Low | High | Multiple |
| Composite Tool | ✅ 100% | Medium | Low | Single |
| Event Hook | ⚠️ Medium (can fail) | Very High | Medium | Multiple |
| Agent-as-Tool | ✅ High | High | High | Multiple (sub-agent) |

## Recommendation

**For your scenario (tools 2 & 3 depend on tool 1):**

### **Use Solution 1 (LLM Intelligence) if:**
- ✅ Dependencies are logical (LLM can understand)
- ✅ You want flexibility
- ✅ Cost is not a primary concern

**Example:**
```typescript
const agent = {
  name: 'flight_agent',
  instructions: (state) => `
    When booking flights:
    1. FIRST: Call search_flights to get flight options
    2. WAIT for results
    3. THEN: Call calculate_price and check_seats using flight IDs from step 1
    
    NEVER skip step 1 or call steps 2-3 without flight IDs!
  `,
  tools: [searchFlightsTool, calculatePriceTool, checkSeatsTool]
}
```

### **Use Solution 2 (Composite Tool) if:**
- ✅ Sequence is always the same
- ✅ You need guaranteed execution order
- ✅ You want single-turn execution

**Example:**
```typescript
const flightWorkflowTool = {
  schema: {
    name: 'complete_flight_search',
    description: 'Search flights, calculate prices, and check availability',
    parameters: z.object({ origin: z.string(), destination: z.string() })
  },
  execute: async (args, ctx) => {
    const flights = await searchFlights(args);
    const withPrices = await addPrices(flights);
    const withSeats = await checkAvailability(withPrices);
    return JSON.stringify(withSeats);
  }
}
```

## Bottom Line

**JAF's parallel execution is by design and cannot be changed without modifying the framework.** However, you have multiple effective workarounds depending on your needs. The LLM intelligence approach is usually sufficient and aligns with how modern LLM agents work naturally.
</result>
<task_progress>
- [x] Analyze JAF's tool execution mechanism
- [x] Explain why sequential execution isn't native
- [x] Provide multiple workaround solutions
- [x] Compare solutions and provide recommendations
</task_progress>
</attempt_completion>

---

**User:**

[TASK RESUMPTION] This task was interrupted 2 minutes ago. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '/Users/aayush.shah/Desktop/projects/jaf'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.

Note: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.
New instructions for task continuation:
<user_message>
- auto compaction is present in JAF ?
- what happens related to context memory management
</user_message>

# TODO LIST RECOMMENDED

When starting a new task, it is recommended to create a todo list.


1. Include the task_progress parameter in your next tool call
2. Create a comprehensive checklist of all steps needed
3. Use markdown format: - [ ] for incomplete, - [x] for complete

**Benefits of creating a todo list now:**
	- Clear roadmap for implementation
	- Progress tracking throughout the task
	- Nothing gets forgotten or missed
	- Users can see, monitor, and edit the plan

**Example structure:**```
- [ ] Analyze requirements
- [ ] Set up necessary files
- [ ] Implement main functionality
- [ ] Handle edge cases
- [ ] Test the implementation
- [ ] Verify results```

Keeping the todo list updated helps track progress and ensures nothing is missed.

<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:56:36 PM (Asia/Calcutta, UTC+5.5:00)

# Current Working Directory (/Users/aayush.shah/Desktop/projects/jaf) Files
.env.test
.eslintrc.js
.gitignore
.npmignore
CHANGELOG_EVENT_IMPROVEMENTS.md
docker-compose.test.yml
jest.config.js
jest.setup.js
LICENSE
mkdocs.yml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
QUICK_REFERENCE_EVENT_HANDLERS.md
README.md
requirements.txt
tsconfig.json
dependencies/
dependencies/pdf-parse/
dependencies/pdf-parse/.editorconfig
dependencies/pdf-parse/.gitignore
dependencies/pdf-parse/.gitlab-ci.yml
dependencies/pdf-parse/.jsbeautifyrc
dependencies/pdf-parse/.npmrc
dependencies/pdf-parse/CHANGELOG
dependencies/pdf-parse/CONTRIBUTING.md
dependencies/pdf-parse/index.d.ts
dependencies/pdf-parse/index.js
dependencies/pdf-parse/LICENSE
dependencies/pdf-parse/NOTES.md
dependencies/pdf-parse/package.json
dependencies/pdf-parse/QUICKSTART.js
dependencies/pdf-parse/README.md
dependencies/pdf-parse/lib/
dependencies/pdf-parse/test/
docs/
docs/a2a-integration.md
docs/a2a-protocol.md
docs/adk-analysis.md
docs/adk-layer.md
docs/agents-as-tools.md
docs/api-reference.md
docs/CONTRIBUTING.md
docs/core-concepts.md
docs/cover.png
docs/deployment.md
docs/event-handling-guide.md
docs/examples.md
docs/favicon.png
docs/getting-started.md
docs/jaf-adk-layer-plan.md
docs/llm-prompting-and-turns.md
docs/logo.png
docs/memory-system.md
docs/model-providers.md
docs/new-features.md
docs/README.md
docs/safe-logging.md
docs/sanitization.md
docs/serve.sh
docs/server-api.md
docs/tools.md
docs/trace-events-reference.md
docs/tracing.md
docs/troubleshooting.md
docs/visualization.md
docs/stylesheets/
docs/stylesheets/extra.css
examples/
examples/attachment-demo-server.ts
examples/custom-sanitization-example.ts
examples/guardrails-demo.ts
examples/safe-logging-example.ts
examples/verify-param-modification.ts
examples/agent-as-tool-demo/
examples/agent-as-tool-demo/.env.example
examples/agent-as-tool-demo/index.ts
examples/agent-as-tool-demo/package.json
examples/agent-as-tool-demo/README.md
examples/agent-as-tool-demo/tsconfig.json
examples/ai-sdk-provider-demo/
examples/ai-sdk-provider-demo/.env.example
examples/ai-sdk-provider-demo/package.json
examples/ai-sdk-provider-demo/reasoning-ui-example.tsx
examples/ai-sdk-provider-demo/server.ts
examples/ai-sdk-provider-demo/test-vertex.ts
examples/ai-sdk-provider-demo/test.ts
examples/ai-sdk-provider-demo/tsconfig.json
examples/flight-booking/
examples/flight-booking/.env.example
examples/flight-booking/index.ts
examples/flight-booking/jaf-server.ts
examples/flight-booking/multi-agent.ts
examples/flight-booking/package.json
examples/flight-booking/README.md
examples/flight-booking/tsconfig.json
examples/hitl-demo/
examples/hitl-demo/.env.example
examples/hitl-demo/api-demo.ts
examples/hitl-demo/index.ts
examples/hitl-demo/package.json
examples/hitl-demo/README.md
examples/hitl-demo/run-server.ts
examples/hitl-demo/tsconfig.json
examples/hitl-demo/shared/
examples/math-tool-demo/
examples/math-tool-demo/index.ts
examples/math-tool-demo/package.json
examples/math-tool-demo/README.md
examples/math-tool-demo/tsconfig.json
examples/mcp-demo/
examples/mcp-demo/.env.example
examples/mcp-demo/.gitignore
examples/mcp-demo/mcp-filesystem-server.ts
examples/mcp-demo/package.json
examples/mcp-demo/README.md
examples/mcp-demo/tsconfig.json
examples/mcp-http-demo/
examples/mcp-http-demo/index.ts
examples/mcp-http-demo/package.json
examples/mcp-http-demo/README.md
examples/mcp-http-demo/run-server.ts
examples/mcp-http-demo/tsconfig.json
examples/mcp-sse-demo/
examples/mcp-sse-demo/index.ts
examples/mcp-sse-demo/package.json
examples/mcp-sse-demo/README.md
examples/mcp-sse-demo/run-server.ts
examples/mcp-sse-demo/tsconfig.json
examples/otel-tracing-demo/
examples/otel-tracing-demo/.env.example
examples/otel-tracing-demo/otel-demo.ts
examples/otel-tracing-demo/package.json
examples/rag-demo/
examples/rag-demo/.env.example
examples/rag-demo/.gitignore
examples/rag-demo/DEMO_SUMMARY.md
examples/rag-demo/index.ts
examples/rag-demo/package.json
examples/rag-demo/rag-agent.ts
examples/rag-demo/rag-tool.ts
examples/rag-demo/README.md
examples/rag-demo/tsconfig.json
examples/server-demo/
examples/server-demo/.env.example
examples/server-demo/index.ts
examples/server-demo/package.json
examples/server-demo/README.md
examples/server-demo/tsconfig.json
examples/simple-event-handler-demo/
examples/simple-event-handler-demo/.env.example
examples/simple-event-handler-demo/.gitignore
examples/simple-event-handler-demo/DEMO_OUTPUT.md
examples/simple-event-handler-demo/index.ts
examples/simple-event-handler-demo/package.json
examples/simple-event-handler-demo/README.md
examples/simple-event-handler-demo/tsconfig.json
examples/streaming-demo/
examples/streaming-demo/package.json
examples/streaming-demo/README.md
examples/streaming-demo/server.ts
examples/streaming-demo/stream-direct.ts
examples/streaming-demo/stream-plain.ts
examples/streaming-demo/tsconfig.json
examples/visualization-demo/
examples/visualization-demo/index.ts
examples/visualization-demo/package.json
examples/visualization-demo/README.md
scripts/
scripts/setup-test-db.sh
scripts/teardown-test-db.sh
src/
src/index.ts
src/__tests__/
src/__tests__/agent-as-tool.test.ts
src/__tests__/engine.test.ts
src/__tests__/hitl.test.ts
src/__tests__/validation.test.ts
src/a2a/
src/a2a/agent-card.ts
src/a2a/agent.ts
src/a2a/client.ts
src/a2a/executor.ts
src/a2a/index.ts
src/a2a/protocol.ts
src/a2a/server.ts
src/a2a/__tests__/
src/a2a/examples/
src/a2a/memory/
src/adk/
src/core/
src/memory/
src/policies/
src/providers/
src/server/
src/test-utils/
src/tools/
src/types/
src/utils/
src/visualization/

(File list truncated. Use list_files on specific subdirectories if you need to explore further.)

# Workspace Configuration
{
  "workspaces": {
    "/Users/aayush.shah/Desktop/projects/jaf": {
      "hint": "jaf",
      "associatedRemoteUrls": [
        "origin: https://github.com/xynehq/jaf.git"
      ],
      "latestGitCommitHash": "6b97fee9bf8ff6c6bd5970d1c4969597c3e36860"
    }
  }
}

# Detected CLI Tools
These are some of the tools on the user's machine, and may be useful if needed to accomplish the task: git, docker, kubectl, gcloud, npm, pnpm, pip, curl, jq, make, python, node, mysql, sqlite3, code, grep, sed, awk, brew, bundle. This list is not exhaustive, and other tools may be available.

# Context Window Usage
123,088 / 200K tokens used (62%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


Let me search for memory-related configuration and compression features in JAF.

<search_files>
<path>src/memory</path>
<regex>compressionThreshold|maxMessages|compaction</regex>
<file_pattern>*.ts</file_pattern>
<task_progress>
- [ ] Examine memory compression/compaction features
- [ ] Check memory configuration options
- [ ] Explain context management strategies
- [ ] Document findings
</task_progress>
</search_files>

---

**User:**

[search_files for 'compressionThreshold|maxMessages|compaction' in '*.ts'] Result:
Found 10 results.

src/memory/factory.ts
│----
│        maxMessagesPerConversation: parseInt(process.env.JAF_MEMORY_MAX_MESSAGES || '1000')
│      });
│  readonly autoStore?: boolean; // Automatically store conversation history
│----

src/memory/types.ts
│----
│  readonly maxMessages?: number; // Maximum messages to keep in memory
│  readonly ttl?: number; // Time-to-live in seconds for conversations
│----
│  readonly compressionThreshold?: number; // Compress conversations after N messages
│  readonly storeOnCompletion?: boolean; // Store conversation on completion (in addition to interruptions)
│  maxConversations: z.number().default(1000),
│----
│ */
│  maxMessagesPerConversation: z.number().default(1000)
│});
│----

src/memory/providers/in-memory.ts
│----
│export function createInMemoryProvider(config: InMemoryConfig = { type: 'memory', maxConversations: 1000, maxMessagesPerConversation: 1000 }): MemoryProvider {
│----
│  const fullConfig: InMemoryConfig & { maxConversations: number; maxMessagesPerConversation: number } = {
│    ...config,
│    maxConversations: config.maxConversations ?? 1000,
│----
│    maxMessagesPerConversation: config.maxMessagesPerConversation ?? 1000
│  };
│
│----
│  safeConsole.log(`[MEMORY:InMemory] Initialized with max ${fullConfig.maxConversations} conversations, ${fullConfig.maxMessagesPerConversation} messages each`);
│
│      // Enforce per-conversation message limit
│----
│      const finalMessages = updatedMessages.length > fullConfig.maxMessagesPerConversation
│----
│        ? updatedMessages.slice(-fullConfig.maxMessagesPerConversation)
│        : updatedMessages;
│----
<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:56:52 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
126,267 / 200K tokens used (63%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<read_file>
<path>src/memory/types.ts</path>
<task_progress>
- [ ] Examine memory compression/compaction features
- [ ] Check memory configuration options
- [ ] Explain context management strategies
- [ ] Document findings
</task_progress>
</read_file>

---

**User:**

[read_file for 'src/memory/types.ts'] Result:
import { z } from 'zod';
import { Message, TraceId, RunId } from '../core/types';

// Conversation status types
export type ConversationStatus = 
  | 'completed'   // Conversation finished successfully
  | 'halted';     // Stuck on approval/interruption (HITL)

// Result type for functional error handling
export type Result<T, E = MemoryErrorUnion> = 
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

/**
 * Memory management types for the JAF framework
 */

export interface ConversationMemory {
  readonly conversationId: string;
  readonly userId?: string;
  readonly messages: readonly Message[];
  readonly metadata?: {
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly totalMessages: number;
    readonly lastActivity: Date;
    readonly [key: string]: any;
  };
}

export interface MemoryQuery {
  readonly conversationId?: string;
  readonly userId?: string;
  readonly traceId?: TraceId;
  readonly limit?: number;
  readonly offset?: number;
  readonly since?: Date;
  readonly until?: Date;
}

export type MemoryProvider = {
  /**
   * Store messages for a conversation
   */
  readonly storeMessages: (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { userId?: string; traceId?: TraceId; [key: string]: any }
  ) => Promise<Result<void>>;

  /**
   * Retrieve conversation history
   */
  readonly getConversation: (conversationId: string) => Promise<Result<ConversationMemory | null>>;

  /**
   * Append new messages to existing conversation
   */
  readonly appendMessages: (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { traceId?: TraceId; [key: string]: any }
  ) => Promise<Result<void>>;

  /**
   * Search conversations by query
   */
  readonly findConversations: (query: MemoryQuery) => Promise<Result<ConversationMemory[]>>;

  /**
   * Get recent messages from a conversation
   */
  readonly getRecentMessages: (
    conversationId: string,
    limit?: number
  ) => Promise<Result<readonly Message[]>>;

  /**
   * Delete conversation
   */
  readonly deleteConversation: (conversationId: string) => Promise<Result<boolean>>;

  /**
   * Clear all conversations for a user
   */
  readonly clearUserConversations: (userId: string) => Promise<Result<number>>;

  /**
   * Get conversation statistics
   */
  readonly getStats: (userId?: string) => Promise<Result<{
    totalConversations: number;
    totalMessages: number;
    oldestConversation?: Date;
    newestConversation?: Date;
  }>>;

  /**
   * Health check for the memory provider
   */
  readonly healthCheck: () => Promise<Result<{ healthy: boolean; latencyMs?: number; error?: string }>>;

  /**
   * Close/cleanup the provider
   */
  readonly close: () => Promise<Result<void>>;
};

export interface MemoryConfig {
  readonly provider: MemoryProvider;
  readonly autoStore?: boolean; // Automatically store conversation history
  readonly maxMessages?: number; // Maximum messages to keep in memory
  readonly ttl?: number; // Time-to-live in seconds for conversations
  readonly compressionThreshold?: number; // Compress conversations after N messages
  readonly storeOnCompletion?: boolean; // Store conversation on completion (in addition to interruptions)
}

// Configuration schemas for different providers
export const InMemoryConfigSchema = z.object({
  type: z.literal('memory'),
  maxConversations: z.number().default(1000),
  maxMessagesPerConversation: z.number().default(1000)
});

export const RedisConfigSchema = z.object({
  type: z.literal('redis'),
  url: z.string().optional(),
  host: z.string().default('localhost'),
  port: z.number().default(6379),
  password: z.string().optional(),
  db: z.number().default(0),
  keyPrefix: z.string().default('jaf:memory:'),
  ttl: z.number().optional() // seconds
});

export const PostgresConfigSchema = z.object({
  type: z.literal('postgres'),
  connectionString: z.string().optional(),
  host: z.string().default('localhost'),
  port: z.number().default(5432),
  database: z.string().default('jaf_memory'),
  username: z.string().default('postgres'),
  password: z.string().optional(),
  ssl: z.boolean().default(false),
  tableName: z.string().default('conversations'),
  maxConnections: z.number().default(10)
});

export const MemoryProviderConfigSchema = z.union([
  InMemoryConfigSchema,
  RedisConfigSchema,
  PostgresConfigSchema
]);

export type InMemoryConfig = z.infer<typeof InMemoryConfigSchema>;
export type RedisConfig = z.infer<typeof RedisConfigSchema>;
export type PostgresConfig = z.infer<typeof PostgresConfigSchema>;
export type MemoryProviderConfig = z.infer<typeof MemoryProviderConfigSchema>;

// Functional error types
export type MemoryError = {
  readonly _tag: 'MemoryError';
  readonly message: string;
  readonly code: string;
  readonly provider: string;
  readonly cause?: Error;
};

export type MemoryConnectionError = {
  readonly _tag: 'MemoryConnectionError';
  readonly message: string;
  readonly provider: string;
  readonly cause?: Error;
};

export type MemoryNotFoundError = {
  readonly _tag: 'MemoryNotFoundError';
  readonly message: string;
  readonly conversationId: string;
  readonly provider: string;
};

export type MemoryStorageError = {
  readonly _tag: 'MemoryStorageError';
  readonly message: string;
  readonly operation: string;
  readonly provider: string;
  readonly cause?: Error;
};

export type MemoryErrorUnion = 
  | MemoryConnectionError 
  | MemoryNotFoundError 
  | MemoryStorageError;

// Error factory functions
export const createMemoryError = (
  message: string,
  code: string,
  provider: string,
  cause?: Error
): MemoryError => ({
  _tag: 'MemoryError',
  message,
  code,
  provider,
  cause
});

export const createMemoryConnectionError = (
  provider: string,
  cause?: Error
): MemoryConnectionError => ({
  _tag: 'MemoryConnectionError',
  message: `Failed to connect to ${provider} memory provider`,
  provider,
  cause
});

export const createMemoryNotFoundError = (
  conversationId: string,
  provider: string
): MemoryNotFoundError => ({
  _tag: 'MemoryNotFoundError',
  message: `Conversation ${conversationId} not found`,
  conversationId,
  provider
});

export const createMemoryStorageError = (
  operation: string,
  provider: string,
  cause?: Error
): MemoryStorageError => ({
  _tag: 'MemoryStorageError',
  message: `Failed to ${operation} in ${provider}`,
  operation,
  provider,
  cause
});

// Error checking functions
export const isMemoryError = (error: any): error is MemoryErrorUnion => {
  return error && typeof error === 'object' && '_tag' in error && 
    (error._tag === 'MemoryConnectionError' || 
     error._tag === 'MemoryNotFoundError' || 
     error._tag === 'MemoryStorageError');
};

export const isMemoryConnectionError = (error: any): error is MemoryConnectionError => {
  return error && error._tag === 'MemoryConnectionError';
};

export const isMemoryNotFoundError = (error: any): error is MemoryNotFoundError => {
  return error && error._tag === 'MemoryNotFoundError';
};

export const isMemoryStorageError = (error: any): error is MemoryStorageError => {
  return error && error._tag === 'MemoryStorageError';
};

// Result helper functions
export const createSuccess = <T>(data: T): Result<T> => ({
  success: true,
  data
});

export const createFailure = <E extends MemoryErrorUnion>(error: E): Result<never, E> => ({
  success: false,
  error
});

export const isSuccess = <T, E>(result: Result<T, E>): result is { success: true; data: T } => {
  return result.success;
};

export const isFailure = <T, E>(result: Result<T, E>): result is { success: false; error: E } => {
  return !result.success;
};
<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:56:59 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
126,858 / 200K tokens used (63%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<search_files>
<path>src/core</path>
<regex>compressionThreshold|storeConversationHistory</regex>
<file_pattern>*.ts</file_pattern>
<task_progress>
- [x] Examine memory compression/compaction features
- [ ] Check how compression is implemented in engine
- [ ] Explain context management strategies
- [ ] Document findings
</task_progress>
</search_files>

---

**User:**

[search_files for 'compressionThreshold|storeConversationHistory' in '*.ts'] Result:
Found 6 results.

src/core/engine.ts
│----
│      await storeConversationHistory(result.finalState, config);
│    } else if (result.outcome.status === 'interrupted') {
│        };
│----
│        await storeConversationHistory(stateForStorage, config);
│      }
│ */
│----
│async function storeConversationHistory<Ctx>(
│  finalState: RunState<Ctx>,
│  let messagesToStore = finalState.messages;
│----
│  if (config.memory.compressionThreshold && messagesToStore.length > config.memory.compressionThreshold) {
│----
│    const keepFirst = Math.floor(config.memory.compressionThreshold * 0.2);
│----
│    const keepRecent = config.memory.compressionThreshold - keepFirst;
│
│----
<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 2:57:07 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
129,530 / 200K tokens used (65%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<attempt_completion>
<result>
# JAF Memory Management and Auto-Compaction

## Question 1: Is Auto-Compaction Present in JAF?

**YES**, JAF has auto-compaction/compression for conversation history, but it's:
- ✅ **Optional** - Not enabled by default
- ✅ **Configurable** - You control when it triggers
- ✅ **Automatic** - Happens during storage, not during runtime

### How It Works

From `src/core/engine.ts` (lines ~1159-1171):

```typescript
async function storeConversationHistory<Ctx>(
  finalState: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<void> {
  if (!config.memory?.provider || !config.conversationId) {
    return;
  }

  let messagesToStore = finalState.messages;
  
  // AUTO-COMPACTION LOGIC
  if (config.memory.compressionThreshold && 
      messagesToStore.length > config.memory.compressionThreshold) {
    
    // Keep first 20% of messages
    const keepFirst = Math.floor(config.memory.compressionThreshold * 0.2);
    
    // Keep most recent messages
    const keepRecent = config.memory.compressionThreshold - keepFirst;
    
    // Create compressed message array
    messagesToStore = [
      ...messagesToStore.slice(0, keepFirst),           // First 20%
      ...messagesToStore.slice(-keepRecent)             // Most recent 80%
    ];

    safeConsole.log(
      `[JAF:MEMORY] Compressed conversation from ${finalState.messages.length} to ${messagesToStore.length} messages`
    );
  }
  
  // Store the (possibly compressed) messages
  await config.memory.provider.storeMessages(conversationId, messagesToStore, metadata);
}
```

### Compression Strategy

**JAF uses a "bookend" strategy:**

```
Original: 100 messages with compressionThreshold: 50

Keeps:
├─ First 10 messages (20% of 50)  ← Important context
├─ [... 40 messages discarded ...]
└─ Last 40 messages (80% of 50)   ← Recent conversation

Result: 50 messages total
```

**Why this strategy?**
- ✅ Preserves initial context (user goals, setup)
- ✅ Keeps recent conversation flow
- ✅ Removes middle messages (likely less important)

---

## Question 2: Context/Memory Management in JAF

JAF has **TWO separate concerns** for memory management:

### A. **Runtime Context** (During Execution)

**What happens:** Messages accumulate in `state.messages` during a single run

```typescript
// From src/core/engine.ts
type RunState = {
  messages: readonly Message[];  // ← Grows each turn
  turnCount: number;
  // ...
}
```

**How it grows:**
```
Turn 1: [user_message, assistant_response, tool_result_1, tool_result_2]
Turn 2: [...previous, assistant_response_2, tool_result_3]
Turn 3: [...previous, assistant_response_3]
```

**ALL messages sent to LLM on EVERY turn** - from `src/providers/model.ts`:
```typescript
const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
  systemMessage,
  ...convertedMessages,  // ← ALL messages from state.messages
];
```

**Protection mechanisms:**
1. **maxTurns limit** (default: 50)
   - Prevents infinite loops
   - Stops execution before context explodes
   
2. **No automatic trimming during runtime**
   - All messages stay for the duration of the run
   - Context window errors will occur if too many messages

### B. **Persistent Memory** (Between Runs)

**Two layers of management:**

#### Layer 1: Load-Time Filtering

From `src/core/engine.ts` (`loadConversationHistory` function):

```typescript
async function loadConversationHistory<Ctx>(
  initialState: RunState<Ctx>,
  config: RunConfig<Ctx>
): Promise<RunState<Ctx>> {
  const result = await config.memory.provider.getConversation(config.conversationId);
  
  // Apply maxMessages limit when loading
  const maxMessages = config.memory.maxMessages || result.data.messages.length;
  const allMemoryMessages = result.data.messages.slice(-maxMessages);  // ← Take most recent
  
  // Filter out "halted" tool messages
  const memoryMessages = allMemoryMessages.filter(msg => {
    if (msg.role !== 'tool') return true;
    try {
      const content = JSON.parse(getTextContent(msg.content));
      return content.status !== 'halted';  // ← Remove pending approval messages
    } catch {
      return true;
    }
  });
  
  return {
    ...initialState,
    messages: [...memoryMessages, ...initialState.messages]  // ← Combine with new messages
  };
}
```

**What this does:**
- ✅ Loads only last N messages (configurable via `maxMessages`)
- ✅ Filters out halted/pending approval messages
- ✅ Merges with new user message

#### Layer 2: Store-Time Compression

When storing conversations (shown above in `storeConversationHistory`):
- ✅ Applies `compressionThreshold` if configured
- ✅ Uses bookend strategy (first 20% + last 80%)
- ✅ Stores compressed version to database

#### Layer 3: Provider-Level Limits

From `src/memory/providers/in-memory.ts`:

```typescript
const fullConfig = {
  maxConversations: 1000,           // ← Max conversations to keep
  maxMessagesPerConversation: 1000  // ← Hard limit per conversation
};

// When storing messages
const finalMessages = updatedMessages.length > fullConfig.maxMessagesPerConversation
  ? updatedMessages.slice(-fullConfig.maxMessagesPerConversation)  // ← Keep most recent
  : updatedMessages;
```

---

## Configuration Guide

### Memory Configuration Options

From `src/memory/types.ts`:

```typescript
export interface MemoryConfig {
  readonly provider: MemoryProvider;
  readonly autoStore?: boolean;              // Auto-save after each run
  readonly maxMessages?: number;             // Max messages to LOAD from memory
  readonly ttl?: number;                     // Time-to-live in seconds
  readonly compressionThreshold?: number;    // Compress when storing if > N messages
  readonly storeOnCompletion?: boolean;      // Store on success (not just interruptions)
}
```

### Example Usage

```typescript
import { createInMemoryProvider } from '@xynehq/jaf';

const memoryProvider = createInMemoryProvider({
  type: 'memory',
  maxConversations: 1000,
  maxMessagesPerConversation: 1000
});

const config: RunConfig<MyContext> = {
  agentRegistry,
  modelProvider,
  conversationId: 'user-123-session-456',
  
  memory: {
    provider: memoryProvider,
    autoStore: true,                    // ✅ Auto-save conversations
    maxMessages: 50,                    // ✅ Load only last 50 messages
    compressionThreshold: 100,          // ✅ Compress if > 100 messages when storing
    storeOnCompletion: true             // ✅ Store on successful completion
  }
};
```

### What Happens

**Run 1: First Conversation**
```
1. Load: No existing conversation
2. Execute: 10 turns = 30 messages
3. Store: 30 messages < 100 → No compression
   Stored: All 30 messages
```

**Run 2: Continued Conversation**
```
1. Load: Last 50 messages (maxMessages=50) from previous run
2. Execute: 5 turns = 15 new messages
3. Total in memory: 50 + 15 = 65 messages
4. Store: 65 messages < 100 → No compression
   Stored: All 65 messages
```

**Run 3: Long Conversation**
```
1. Load: Last 50 messages
2. Execute: 60 turns = 180 new messages
3. Total in memory: 50 + 180 = 230 messages (all used during execution!)
4. Store: 230 > 100 (compressionThreshold)
   → Compress to 100 messages:
     - Keep first 20: messages[0:20]
     - Keep last 80: messages[-80:]
   Stored: 100 compressed messages
```

**Run 4: After Compression**
```
1. Load: 100 messages (from compressed storage)
   → Actually loads 50 (maxMessages=50)
   → Takes last 50 from the 100 stored
2. Execute: New messages...
```

---

## Key Differences: Runtime vs Storage

| Aspect | Runtime (During Execution) | Storage (Between Runs) |
|--------|---------------------------|------------------------|
| **Location** | `state.messages` in memory | Database/Redis/Memory provider |
| **Management** | No trimming - all messages kept | Compression + maxMessages limit |
| **When Applied** | Never during a run | At load time & store time |
| **Protection** | `maxTurns` limit only | Multiple layers of limits |
| **Impact** | Can hit context window limits | Saves storage & improves load time |

---

## Best Practices

### 1. **Set Appropriate Limits**
```typescript
memory: {
  maxMessages: 50,              // Keep context window manageable
  compressionThreshold: 100,    // Prevent unbounded growth
  maxTurns: 20                  // Prevent runaway execution
}
```

### 2. **Monitor Context Size**
```typescript
config.onEvent = (event) => {
  if (event.type === 'llm_call_start') {
    const messageCount = event.data.messages?.length || 0;
    if (messageCount > 100) {
      console.warn(`Large context: ${messageCount} messages`);
    }
  }
}
```

### 3. **Use Compression for Long Conversations**
```typescript
memory: {
  compressionThreshold: 50,  // Compress aggressively for chat apps
  maxMessages: 30            // Load even less for new runs
}
```

### 4. **Consider Agent Design**
- Use agent-as-tool for sub-tasks (isolated context)
- Design agents to complete tasks in fewer turns
- Include summarization in agent instructions

---

## Summary

**Auto-Compaction:**
- ✅ YES, JAF has it via `compressionThreshold`
- ✅ Bookend strategy: keeps first 20% + last 80%
- ✅ Applied when storing, not during execution
- ❌ NOT automatic by default - you must configure it

**Memory Management:**
- **Runtime**: All messages accumulate, no automatic trimming
- **Load-Time**: `maxMessages` limit + filter halted messages
- **Store-Time**: `compressionThreshold` compression
- **Provider-Level**: Hard limits per conversation (e.g., 1000 messages)

**Protection Layers:**
1. `maxTurns` - Prevents infinite execution
2. `maxMessages` - Limits what's loaded from storage
3. `compressionThreshold` - Compresses when storing
4. Provider limits - Hard caps per conversation
</result>
<task_progress>
- [x] Examine memory compression/compaction features
- [x] Check how compression is implemented in engine
- [x] Explain context management strategies
- [x] Document findings
</task_progress>
</attempt_completion>

---

**User:**

[TASK RESUMPTION] This task was interrupted 1 hour ago. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '/Users/aayush.shah/Desktop/projects/jaf'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.

Note: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.
New instructions for task continuation:
<user_message>
do we sotre state of the task or tool execution via states ?
</user_message>

# TODO LIST RECOMMENDED

When starting a new task, it is recommended to create a todo list.


1. Include the task_progress parameter in your next tool call
2. Create a comprehensive checklist of all steps needed
3. Use markdown format: - [ ] for incomplete, - [x] for complete

**Benefits of creating a todo list now:**
	- Clear roadmap for implementation
	- Progress tracking throughout the task
	- Nothing gets forgotten or missed
	- Users can see, monitor, and edit the plan

**Example structure:**```
- [ ] Analyze requirements
- [ ] Set up necessary files
- [ ] Implement main functionality
- [ ] Handle edge cases
- [ ] Test the implementation
- [ ] Verify results```

Keeping the todo list updated helps track progress and ensures nothing is missed.

<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 4:13:19 PM (Asia/Calcutta, UTC+5.5:00)

# Current Working Directory (/Users/aayush.shah/Desktop/projects/jaf) Files
.env.test
.eslintrc.js
.gitignore
.npmignore
CHANGELOG_EVENT_IMPROVEMENTS.md
docker-compose.test.yml
jest.config.js
jest.setup.js
LICENSE
mkdocs.yml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
QUICK_REFERENCE_EVENT_HANDLERS.md
README.md
requirements.txt
tsconfig.json
dependencies/
dependencies/pdf-parse/
dependencies/pdf-parse/.editorconfig
dependencies/pdf-parse/.gitignore
dependencies/pdf-parse/.gitlab-ci.yml
dependencies/pdf-parse/.jsbeautifyrc
dependencies/pdf-parse/.npmrc
dependencies/pdf-parse/CHANGELOG
dependencies/pdf-parse/CONTRIBUTING.md
dependencies/pdf-parse/index.d.ts
dependencies/pdf-parse/index.js
dependencies/pdf-parse/LICENSE
dependencies/pdf-parse/NOTES.md
dependencies/pdf-parse/package.json
dependencies/pdf-parse/QUICKSTART.js
dependencies/pdf-parse/README.md
dependencies/pdf-parse/lib/
dependencies/pdf-parse/test/
docs/
docs/a2a-integration.md
docs/a2a-protocol.md
docs/adk-analysis.md
docs/adk-layer.md
docs/agents-as-tools.md
docs/api-reference.md
docs/CONTRIBUTING.md
docs/core-concepts.md
docs/cover.png
docs/deployment.md
docs/event-handling-guide.md
docs/examples.md
docs/favicon.png
docs/getting-started.md
docs/jaf-adk-layer-plan.md
docs/llm-prompting-and-turns.md
docs/logo.png
docs/memory-system.md
docs/model-providers.md
docs/new-features.md
docs/README.md
docs/safe-logging.md
docs/sanitization.md
docs/serve.sh
docs/server-api.md
docs/tools.md
docs/trace-events-reference.md
docs/tracing.md
docs/troubleshooting.md
docs/visualization.md
docs/stylesheets/
docs/stylesheets/extra.css
examples/
examples/attachment-demo-server.ts
examples/custom-sanitization-example.ts
examples/guardrails-demo.ts
examples/safe-logging-example.ts
examples/verify-param-modification.ts
examples/agent-as-tool-demo/
examples/agent-as-tool-demo/.env.example
examples/agent-as-tool-demo/index.ts
examples/agent-as-tool-demo/package.json
examples/agent-as-tool-demo/README.md
examples/agent-as-tool-demo/tsconfig.json
examples/ai-sdk-provider-demo/
examples/ai-sdk-provider-demo/.env.example
examples/ai-sdk-provider-demo/package.json
examples/ai-sdk-provider-demo/reasoning-ui-example.tsx
examples/ai-sdk-provider-demo/server.ts
examples/ai-sdk-provider-demo/test-vertex.ts
examples/ai-sdk-provider-demo/test.ts
examples/ai-sdk-provider-demo/tsconfig.json
examples/flight-booking/
examples/flight-booking/.env.example
examples/flight-booking/index.ts
examples/flight-booking/jaf-server.ts
examples/flight-booking/multi-agent.ts
examples/flight-booking/package.json
examples/flight-booking/README.md
examples/flight-booking/tsconfig.json
examples/hitl-demo/
examples/hitl-demo/.env.example
examples/hitl-demo/api-demo.ts
examples/hitl-demo/index.ts
examples/hitl-demo/package.json
examples/hitl-demo/README.md
examples/hitl-demo/run-server.ts
examples/hitl-demo/tsconfig.json
examples/hitl-demo/shared/
examples/math-tool-demo/
examples/math-tool-demo/index.ts
examples/math-tool-demo/package.json
examples/math-tool-demo/README.md
examples/math-tool-demo/tsconfig.json
examples/mcp-demo/
examples/mcp-demo/.env.example
examples/mcp-demo/.gitignore
examples/mcp-demo/mcp-filesystem-server.ts
examples/mcp-demo/package.json
examples/mcp-demo/README.md
examples/mcp-demo/tsconfig.json
examples/mcp-http-demo/
examples/mcp-http-demo/index.ts
examples/mcp-http-demo/package.json
examples/mcp-http-demo/README.md
examples/mcp-http-demo/run-server.ts
examples/mcp-http-demo/tsconfig.json
examples/mcp-sse-demo/
examples/mcp-sse-demo/index.ts
examples/mcp-sse-demo/package.json
examples/mcp-sse-demo/README.md
examples/mcp-sse-demo/run-server.ts
examples/mcp-sse-demo/tsconfig.json
examples/otel-tracing-demo/
examples/otel-tracing-demo/.env.example
examples/otel-tracing-demo/otel-demo.ts
examples/otel-tracing-demo/package.json
examples/rag-demo/
examples/rag-demo/.env.example
examples/rag-demo/.gitignore
examples/rag-demo/DEMO_SUMMARY.md
examples/rag-demo/index.ts
examples/rag-demo/package.json
examples/rag-demo/rag-agent.ts
examples/rag-demo/rag-tool.ts
examples/rag-demo/README.md
examples/rag-demo/tsconfig.json
examples/server-demo/
examples/server-demo/.env.example
examples/server-demo/index.ts
examples/server-demo/package.json
examples/server-demo/README.md
examples/server-demo/tsconfig.json
examples/simple-event-handler-demo/
examples/simple-event-handler-demo/.env.example
examples/simple-event-handler-demo/.gitignore
examples/simple-event-handler-demo/DEMO_OUTPUT.md
examples/simple-event-handler-demo/index.ts
examples/simple-event-handler-demo/package.json
examples/simple-event-handler-demo/README.md
examples/simple-event-handler-demo/tsconfig.json
examples/streaming-demo/
examples/streaming-demo/package.json
examples/streaming-demo/README.md
examples/streaming-demo/server.ts
examples/streaming-demo/stream-direct.ts
examples/streaming-demo/stream-plain.ts
examples/streaming-demo/tsconfig.json
examples/visualization-demo/
examples/visualization-demo/index.ts
examples/visualization-demo/package.json
examples/visualization-demo/README.md
scripts/
scripts/setup-test-db.sh
scripts/teardown-test-db.sh
src/
src/index.ts
src/__tests__/
src/__tests__/agent-as-tool.test.ts
src/__tests__/engine.test.ts
src/__tests__/hitl.test.ts
src/__tests__/validation.test.ts
src/a2a/
src/a2a/agent-card.ts
src/a2a/agent.ts
src/a2a/client.ts
src/a2a/executor.ts
src/a2a/index.ts
src/a2a/protocol.ts
src/a2a/server.ts
src/a2a/__tests__/
src/a2a/examples/
src/a2a/memory/
src/adk/
src/core/
src/memory/
src/policies/
src/providers/
src/server/
src/test-utils/
src/tools/
src/types/
src/utils/
src/visualization/

(File list truncated. Use list_files on specific subdirectories if you need to explore further.)

# Workspace Configuration
{
  "workspaces": {
    "/Users/aayush.shah/Desktop/projects/jaf": {
      "hint": "jaf",
      "associatedRemoteUrls": [
        "origin: https://github.com/xynehq/jaf.git"
      ],
      "latestGitCommitHash": "6b97fee9bf8ff6c6bd5970d1c4969597c3e36860"
    }
  }
}

# Detected CLI Tools
These are some of the tools on the user's machine, and may be useful if needed to accomplish the task: git, docker, kubectl, gcloud, npm, pnpm, pip, curl, jq, make, python, node, mysql, sqlite3, code, grep, sed, awk, brew, bundle. This list is not exhaustive, and other tools may be available.

# Context Window Usage
133,108 / 200K tokens used (67%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


Let me search for state management and persistence in JAF to answer your question.

<search_files>
<path>src/core</path>
<regex>RunState|approvals|state\.ts</regex>
<file_pattern>*.ts</file_pattern>
<task_progress>
- [ ] Examine what's stored in RunState
- [ ] Check approval/interruption state storage
- [ ] Look at state persistence mechanisms
- [ ] Document findings
</task_progress>
</search_files>

---

**User:**

[search_files for 'RunState|approvals|state\.ts' in '*.ts'] Result:
Found 56 results.

src/core/agent-as-tool.ts
│----
│  RunState,
│  Tool,
│  readonly toolDescription?: string;
│----
│  readonly customOutputExtractor?: (output: Out, finalState: RunState<Ctx>) => string | Promise<string>;
│  readonly maxTurns?: number; // default 5
│
│----
│      const parentState = runtime.state as RunState<Ctx>;
│      const parentConfig = runtime.config as RunConfig<Ctx>;
│      // Build child run state: new runId, same traceId, single user message
│----
│      const childState: RunState<Ctx> = {
│        runId: createRunId(uuidv4()),
│        turnCount: 0,
│----
│        approvals: new Map(),
│      };
│          if (customOutputExtractor) {
│----
│            text = await customOutputExtractor(output, result.finalState as RunState<Ctx>);
│          } else {
│----

src/core/tool-runtime.ts
│----
│import { RunConfig, RunState } from './types.js';
│
│export type ToolRuntime<Ctx> = {
│----
│  readonly state: RunState<Ctx>;
│  readonly config: RunConfig<Ctx>;
│  readonly name: string;
│----

src/core/types.ts
│----
│  readonly instructions: (state: Readonly<RunState<Ctx>>) => string;
│  readonly tools?: readonly Tool<any, Ctx>[];
│
│----
│export type RunState<Ctx> = {
│  readonly runId: RunId;
│  readonly turnCount: number;
│----
│  readonly approvals?: ReadonlyMap<string, ApprovalValue>;
│};
│export type RunResult<Out> = {
│----
│  readonly finalState: RunState<any>;
│  readonly outcome:
│  getCompletion: (
│----
│    state: Readonly<RunState<Ctx>>,
│    agent: Readonly<Agent<Ctx, any>>,
│  getCompletionStream?: (
│----
│    state: Readonly<RunState<Ctx>>,
│    agent: Readonly<Agent<Ctx, any>>,
│      args: any;
│----
│  RunConfig,
│      state: RunState<Ctx>;
│      agentName: string;
│----

src/core/guardrails.ts
│----
│  RunState,
│  ValidationResult,
│    try {
│----
│      const tempState: RunState<Ctx> = {
│        runId: createRunId('guardrail-eval'),
│----

src/core/state.ts
│----
│import { RunState, Interruption, RunConfig } from './types';
│import { safeConsole } from '../utils/logger.js';
│export async function approve<Ctx>(
│----
│  state: RunState<Ctx>,
│  interruption: Interruption<Ctx>,
│  config?: RunConfig<Ctx>
│----
│): Promise<RunState<Ctx>> {
│  if (interruption.type === 'tool_approval') {
│    // Update in-memory state
│----
│    const newApprovals = new Map(state.approvals ?? []);
│    newApprovals.set(interruption.toolCall.id, approvalValue);
│      ...state,
│----
│      approvals: newApprovals,
│    };
│export async function reject<Ctx>(
│----
│  state: RunState<Ctx>,
│  interruption: Interruption<Ctx>,
│  config?: RunConfig<Ctx>
│----
│): Promise<RunState<Ctx>> {
│  if (interruption.type === 'tool_approval') {
│    // Update in-memory state
│----
│    const newApprovals = new Map(state.approvals ?? []);
│    newApprovals.set(interruption.toolCall.id, approvalValue);
│      ...state,
│----
│      approvals: newApprovals,
│    };
│
│----
│// Helper function to load approvals from storage into state
│export async function loadApprovalsIntoState<Ctx>(
│----
│  state: RunState<Ctx>,
│  config?: RunConfig<Ctx>
│----
│): Promise<RunState<Ctx>> {
│  if (!config?.approvalStorage) {
│      ...state,
│----
│      approvals: result.data,
│    };
│  } else {
│----
│import {
│    safeConsole.warn('Failed to load approvals:', result.error);
│    return state;
│----

src/core/engine.ts
│----
│  RunState,
│  RunConfig,
│export async function run<Ctx, Out>(
│----
│  initialState: RunState<Ctx>,
│  config: RunConfig<Ctx>
│    if (config.approvalStorage) {
│----
│      safeConsole.log(`[JAF:ENGINE] Loading approvals for runId ${stateWithMemory.runId}`);
│      const { loadApprovalsIntoState } = await import('./state');
│export async function* runStream<Ctx, Out>(
│----
│  initialState: RunState<Ctx>,
│  config: RunConfig<Ctx>,
│async function tryResumePendingToolCalls<Ctx, Out>(
│----
│  state: RunState<Ctx>,
│  config: RunConfig<Ctx>
│
│----
│        const nextState: RunState<Ctx> = {
│          ...state,
│          turnCount: state.turnCount,
│----
│          approvals: state.approvals ?? new Map(),
│        };
│async function runInternal<Ctx, Out>(
│----
│  state: RunState<Ctx>,
│  config: RunConfig<Ctx>
│
│----
│      const updatedApprovals = new Map(state.approvals ?? []);
│      for (const interruption of interruptions) {
│        turnCount: updatedTurnCount,
│----
│        approvals: updatedApprovals,
│      };
│
│----
│        const nextState: RunState<Ctx> = {
│          ...state,
│          turnCount: updatedTurnCount,
│----
│          approvals: state.approvals ?? new Map(),
│        };
│
│----
│    const nextState: RunState<Ctx> = {
│      ...state,
│      turnCount: updatedTurnCount,
│----
│      approvals: state.approvals ?? new Map(),
│    };
│  agent: Agent<Ctx, any>,
│----
│  state: RunState<Ctx>,
│  config: RunConfig<Ctx>
│
│----
│        const approvalStatus = state.approvals?.get(toolCall.id);
│        const derivedStatus: 'approved' | 'rejected' | 'pending' | undefined =
│async function loadConversationHistory<Ctx>(
│----
│  initialState: RunState<Ctx>,
│  config: RunConfig<Ctx>
│----
│): Promise<RunState<Ctx>> {
│  if (!config.memory?.provider || !config.conversationId) {
│
│----
│  const storedApprovals = result.data.metadata?.approvals;
│----
│  const approvalsMap = storedApprovals
│    ? new Map(Object.entries(storedApprovals) as [string, any][])
│----
│    : (initialState.approvals ?? new Map());
│
│  if (storedApprovals) {
│----
│    safeConsole.log(`[JAF:MEMORY] Loaded ${Object.keys(storedApprovals).length} approvals from memory`);
│  }
│    messages: combinedMessages,
│----
│    approvals: approvalsMap
│  };
│async function storeConversationHistory<Ctx>(
│----
│  finalState: RunState<Ctx>,
│  config: RunConfig<Ctx>
│    turnCount: finalState.turnCount,
│----
│    approvals: Object.fromEntries(finalState.approvals ?? new Map()) // Store approvals in metadata
│  };
│----
<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 4:13:33 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
136,081 / 200K tokens used (68%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<read_file>
<path>src/core/state.ts</path>
<task_progress>
- [ ] Examine what's stored in RunState
- [ ] Check approval/interruption state storage
- [ ] Look at state persistence mechanisms
- [ ] Document findings
</task_progress>
</read_file>

---

**User:**

[read_file for 'src/core/state.ts'] Result:
import { RunState, Interruption, RunConfig } from './types';
import { safeConsole } from '../utils/logger.js';

export async function approve<Ctx>(
  state: RunState<Ctx>,
  interruption: Interruption<Ctx>,
  additionalContext?: Record<string, any>,
  config?: RunConfig<Ctx>
): Promise<RunState<Ctx>> {
  if (interruption.type === 'tool_approval') {
    const approvalValue = {
      status: 'approved',
      approved: true,
      additionalContext: { ...(additionalContext || {}), status: 'approved' },
    } as const;

    // Store in approval storage if available
    if (config?.approvalStorage) {
      const result = await config.approvalStorage.storeApproval(
        state.runId,
        interruption.toolCall.id,
        approvalValue
      );
      if (!result.success) {
        safeConsole.warn('Failed to store approval:', result.error);
        // Continue with in-memory fallback
      }
    }

    // Update in-memory state
    const newApprovals = new Map(state.approvals ?? []);
    newApprovals.set(interruption.toolCall.id, approvalValue);
    return {
      ...state,
      approvals: newApprovals,
    };
  }
  return state;
}

export async function reject<Ctx>(
  state: RunState<Ctx>,
  interruption: Interruption<Ctx>,
  additionalContext?: Record<string, any>,
  config?: RunConfig<Ctx>
): Promise<RunState<Ctx>> {
  if (interruption.type === 'tool_approval') {
    const approvalValue = {
      status: 'rejected',
      approved: false,
      additionalContext: { ...(additionalContext || {}), status: 'rejected' },
    } as const;

    // Store in approval storage if available
    if (config?.approvalStorage) {
      const result = await config.approvalStorage.storeApproval(
        state.runId,
        interruption.toolCall.id,
        approvalValue
      );
      if (!result.success) {
        safeConsole.warn('Failed to store approval:', result.error);
        // Continue with in-memory fallback
      }
    }

    // Update in-memory state
    const newApprovals = new Map(state.approvals ?? []);
    newApprovals.set(interruption.toolCall.id, approvalValue);
    return {
      ...state,
      approvals: newApprovals,
    };
  }
  return state;
}

// Helper function to load approvals from storage into state
export async function loadApprovalsIntoState<Ctx>(
  state: RunState<Ctx>,
  config?: RunConfig<Ctx>
): Promise<RunState<Ctx>> {
  if (!config?.approvalStorage) {
    return state;
  }

  const result = await config.approvalStorage.getRunApprovals(state.runId);
  if (result.success) {
    return {
      ...state,
      approvals: result.data,
    };
  } else {
    safeConsole.warn('Failed to load approvals:', result.error);
    return state;
  }
}

<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 4:13:43 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
138,584 / 200K tokens used (69%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<attempt_completion>
<result>
# Does JAF Store Task/Tool Execution State?

## Short Answer

JAF stores **conversation state** (messages + approvals), but does NOT automatically store granular task execution state or tool intermediate results. State management is **conversation-oriented**, not **task-oriented**.

---

## What JAF Actually Stores

### 1. **RunState Structure** (In-Memory During Execution)

From `src/core/types.ts`:

```typescript
export type RunState<Ctx> = {
  readonly runId: RunId;              // Unique run identifier
  readonly traceId: TraceId;          // Trace identifier (can span multiple runs)
  readonly messages: readonly Message[];  // ← PRIMARY STATE: conversation history
  readonly currentAgentName: string;  // Active agent
  readonly context: Readonly<Ctx>;    // User-provided context (arbitrary data)
  readonly turnCount: number;         // Number of LLM calls
  readonly approvals?: ReadonlyMap<string, ApprovalValue>;  // HITL approval states
};
```

**What this means:**
- ✅ Stores conversation (all messages)
- ✅ Stores which agent is active
- ✅ Stores approval decisions
- ❌ Does NOT store task progress
- ❌ Does NOT store tool execution state beyond messages

### 2. **What Gets Persisted** (Between Runs)

From `src/core/engine.ts` - `storeConversationHistory()`:

```typescript
const metadata = {
  userId: (finalState.context as any)?.userId,
  traceId: finalState.traceId,
  runId: finalState.runId,
  agentName: finalState.currentAgentName,
  turnCount: finalState.turnCount,
  approvals: Object.fromEntries(finalState.approvals ?? new Map())  // ← Approvals stored!
};

await config.memory.provider.storeMessages(
  config.conversationId,
  messagesToStore,  // ← Messages stored!
  metadata
);
```

**Persisted to database/storage:**
1. ✅ **Messages** - Full conversation history
2. ✅ **Approvals** - Tool approval states (for HITL)
3. ✅ **Metadata** - userId, traceId, runId, agentName, turnCount

**NOT persisted:**
- ❌ Tool execution intermediate state
- ❌ Task progress/subtasks
- ❌ Custom application state (unless in context)

---

## Message-Based State Model

### Tool Execution State is Captured in Messages

JAF's philosophy: **Tool execution state = conversation messages**

```typescript
// After tool execution, state is captured as messages
state.messages = [
  { role: 'user', content: 'Book a flight to NYC' },
  { 
    role: 'assistant', 
    content: 'Let me search flights',
    tool_calls: [{ id: 'call_1', function: { name: 'search_flights', ... } }]
  },
  {
    role: 'tool',
    tool_call_id: 'call_1',
    content: '{"status": "executed", "result": "Found 5 flights", "flights": [...]}'
  }
];
```

**The tool result IS the state!**
- Tool results are stored as `role: 'tool'` messages
- These messages persist across runs
- LLM can "remember" previous tool results

---

## Approval State Storage

### Separate Storage for Human-in-the-Loop

From `src/core/state.ts`:

```typescript
export async function approve<Ctx>(
  state: RunState<Ctx>,
  interruption: Interruption<Ctx>,
  additionalContext?: Record<string, any>,
  config?: RunConfig<Ctx>
): Promise<RunState<Ctx>> {
  const approvalValue = {
    status: 'approved',
    approved: true,
    additionalContext: { ...(additionalContext || {}), status: 'approved' }
  };

  // 1. Store in approval storage (database)
  if (config?.approvalStorage) {
    await config.approvalStorage.storeApproval(
      state.runId,
      interruption.toolCall.id,
      approvalValue
    );
  }

  // 2. Update in-memory state
  const newApprovals = new Map(state.approvals ?? []);
  newApprovals.set(interruption.toolCall.id, approvalValue);
  
  return {
    ...state,
    approvals: newApprovals
  };
}
```

**Approval storage tracks:**
- ✅ Which tools were approved/rejected
- ✅ Additional context provided during approval
- ✅ Persists across runs (can resume after interruption)

---

## State Resumption

### How JAF Resumes After Interruption

From `src/core/engine.ts`:

```typescript
// 1. Load conversation messages
let stateWithMemory = initialState;
if (config.memory?.autoStore && config.conversationId) {
  stateWithMemory = await loadConversationHistory(initialState, config);
  // Loads: messages + approvals from metadata
}

// 2. Load approval states
if (config.approvalStorage) {
  const { loadApprovalsIntoState } = await import('./state');
  stateWithMemory = await loadApprovalsIntoState(stateWithMemory, config);
  // Loads: approval decisions for pending tool calls
}

// 3. Try to resume pending tool calls
const resumed = await tryResumePendingToolCalls(state, config);
```

**Resumption process:**
1. ✅ Loads previous conversation from memory
2. ✅ Loads approval states
3. ✅ Checks for pending tool calls in conversation
4. ✅ Executes approved tools
5. ✅ Continues execution

---

## What About Task Progress?

### JAF Does NOT Have Built-in Task State Management

**There is NO:**
- ❌ Task/subtask tracking
- ❌ Workflow state machines
- ❌ Progress indicators
- ❌ Checkpoint/rollback mechanism

**Why?**
JAF is a **low-level framework** focused on agent-LLM-tool orchestration, not task management.

### How to Implement Task State

You have several options:

#### **Option 1: Store in Context**

```typescript
type MyContext = {
  userId: string;
  taskState: {
    currentStep: number;
    completedSteps: string[];
    pendingSteps: string[];
    data: Record<string, any>;
  };
};

const initialState: RunState<MyContext> = {
  runId: generateRunId(),
  traceId: generateTraceId(),
  messages: [{ role: 'user', content: 'Start task' }],
  currentAgentName: 'task_agent',
  context: {
    userId: 'user123',
    taskState: {
      currentStep: 1,
      completedSteps: [],
      pendingSteps: ['step1', 'step2', 'step3'],
      data: {}
    }
  },
  turnCount: 0
};

// Context persists throughout the run
// But you must save it yourself between runs!
```

**Pros:**
- ✅ Available to all tools
- ✅ Can be modified by tools
- ✅ Simple to implement

**Cons:**
- ❌ Not automatically persisted
- ❌ Lost between runs unless you save it
- ❌ Manual management required

#### **Option 2: Store in Messages**

```typescript
// Tool returns structured progress
const progressTool = {
  schema: {
    name: 'update_progress',
    parameters: z.object({
      step: z.string(),
      status: z.enum(['completed', 'in_progress', 'failed']),
      data: z.any()
    })
  },
  execute: async (args, context) => {
    return JSON.stringify({
      status: 'executed',
      result: 'Progress updated',
      task_state: {
        step: args.step,
        status: args.status,
        timestamp: new Date().toISOString(),
        data: args.data
      }
    });
  }
};

// Progress is now in conversation history!
// Persists automatically with messages
```

**Pros:**
- ✅ Automatically persisted with conversation
- ✅ LLM can see progress
- ✅ Survives interruptions

**Cons:**
- ❌ Embedded in conversation (harder to query)
- ❌ Takes up context window space
- ❌ Not structured for external access

#### **Option 3: External State Store**

```typescript
// Use your own database
class TaskStateManager {
  async saveTaskState(taskId: string, state: TaskState) {
    await db.tasks.update(taskId, state);
  }
  
  async getTaskState(taskId: string): Promise<TaskState> {
    return await db.tasks.findOne(taskId);
  }
}

// In tool execution
const myTool = {
  execute: async (args, context) => {
    const taskManager = new TaskStateManager();
    
    // Load current task state
    const taskState = await taskManager.getTaskState(context.taskId);
    
    // Do work...
    
    // Save updated state
    await taskManager.saveTaskState(context.taskId, {
      ...taskState,
      currentStep: taskState.currentStep + 1
    });
    
    return 'Step completed';
  }
};
```

**Pros:**
- ✅ Full control over state structure
- ✅ Can query/update independently
- ✅ Doesn't affect conversation size
- ✅ Supports complex workflows

**Cons:**
- ❌ More infrastructure required
- ❌ Must manage sync manually
- ❌ JAF doesn't know about it

---

## Summary

### What JAF Stores

| What | Where | Persisted | Resumable |
|------|-------|-----------|-----------|
| **Conversation messages** | `state.messages` | ✅ Memory provider | ✅ Yes |
| **Tool results** | Messages (role: 'tool') | ✅ With messages | ✅ Yes |
| **Approval decisions** | `state.approvals` + storage | ✅ ApprovalStorage | ✅ Yes |
| **Agent context** | `state.context` | ❌ No (runtime only) | ❌ No |
| **Turn count** | `state.turnCount` | ✅ In metadata | ℹ️ Info only |
| **Current agent** | `state.currentAgentName` | ✅ In metadata | ℹ️ Info only |

### What JAF Does NOT Store

| What | Why | Solution |
|------|-----|----------|
| **Task progress** | Not task-oriented | Store in context or messages |
| **Workflow state** | Not workflow framework | Use external state manager |
| **Tool intermediate state** | Stateless tools | Return state in tool results |
| **Custom app state** | Framework agnostic | Manage yourself |
| **Checkpoints** | Continuous execution | Implement yourself if needed |

### Key Principles

1. **Conversation-Centric**: State = messages + approvals
2. **Immutable Runs**: Each run is independent (unless using memory)
3. **Tool Results as State**: Tool execution state captured in messages
4. **Context is Transient**: Only lasts for one run
5. **You Control Task State**: JAF doesn't impose task management

### Best Practices

✅ **DO:**
- Use conversation messages for state that LLM needs
- Store approvals for human-in-the-loop workflows
- Use memory provider for multi-turn conversations
- Implement external state for complex task workflows

❌ **DON'T:**
- Expect JAF to manage task state automatically
- Rely on context persisting between runs
- Store large state in conversation (use external DB)
- Assume tool execution state survives beyond messages
</result>
<task_progress>
- [x] Examine what's stored in RunState
- [x] Check approval/interruption state storage
- [x] Look at state persistence mechanisms
- [x] Document findings
</task_progress>
</attempt_completion>

---

**User:**

[TASK RESUMPTION] This task was interrupted 4 minutes ago. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '/Users/aayush.shah/Desktop/projects/jaf'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.

Note: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.
New instructions for task continuation:
<user_message>
we want to prevent LLM using the same tool with same parameters across different turns . To do this we can store previous params somehow of tools and pass it to LLM while deciding ... How to do so withJAF ?
</user_message>

# TODO LIST RECOMMENDED

When starting a new task, it is recommended to create a todo list.


1. Include the task_progress parameter in your next tool call
2. Create a comprehensive checklist of all steps needed
3. Use markdown format: - [ ] for incomplete, - [x] for complete

**Benefits of creating a todo list now:**
	- Clear roadmap for implementation
	- Progress tracking throughout the task
	- Nothing gets forgotten or missed
	- Users can see, monitor, and edit the plan

**Example structure:**```
- [ ] Analyze requirements
- [ ] Set up necessary files
- [ ] Implement main functionality
- [ ] Handle edge cases
- [ ] Test the implementation
- [ ] Verify results```

Keeping the todo list updated helps track progress and ensures nothing is missed.

<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 4:18:53 PM (Asia/Calcutta, UTC+5.5:00)

# Current Working Directory (/Users/aayush.shah/Desktop/projects/jaf) Files
.env.test
.eslintrc.js
.gitignore
.npmignore
CHANGELOG_EVENT_IMPROVEMENTS.md
docker-compose.test.yml
jest.config.js
jest.setup.js
LICENSE
mkdocs.yml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
QUICK_REFERENCE_EVENT_HANDLERS.md
README.md
requirements.txt
tsconfig.json
dependencies/
dependencies/pdf-parse/
dependencies/pdf-parse/.editorconfig
dependencies/pdf-parse/.gitignore
dependencies/pdf-parse/.gitlab-ci.yml
dependencies/pdf-parse/.jsbeautifyrc
dependencies/pdf-parse/.npmrc
dependencies/pdf-parse/CHANGELOG
dependencies/pdf-parse/CONTRIBUTING.md
dependencies/pdf-parse/index.d.ts
dependencies/pdf-parse/index.js
dependencies/pdf-parse/LICENSE
dependencies/pdf-parse/NOTES.md
dependencies/pdf-parse/package.json
dependencies/pdf-parse/QUICKSTART.js
dependencies/pdf-parse/README.md
dependencies/pdf-parse/lib/
dependencies/pdf-parse/test/
docs/
docs/a2a-integration.md
docs/a2a-protocol.md
docs/adk-analysis.md
docs/adk-layer.md
docs/agents-as-tools.md
docs/api-reference.md
docs/CONTRIBUTING.md
docs/core-concepts.md
docs/cover.png
docs/deployment.md
docs/event-handling-guide.md
docs/examples.md
docs/favicon.png
docs/getting-started.md
docs/jaf-adk-layer-plan.md
docs/llm-prompting-and-turns.md
docs/logo.png
docs/memory-system.md
docs/model-providers.md
docs/new-features.md
docs/README.md
docs/safe-logging.md
docs/sanitization.md
docs/serve.sh
docs/server-api.md
docs/tools.md
docs/trace-events-reference.md
docs/tracing.md
docs/troubleshooting.md
docs/visualization.md
docs/stylesheets/
docs/stylesheets/extra.css
examples/
examples/attachment-demo-server.ts
examples/custom-sanitization-example.ts
examples/guardrails-demo.ts
examples/safe-logging-example.ts
examples/verify-param-modification.ts
examples/agent-as-tool-demo/
examples/agent-as-tool-demo/.env.example
examples/agent-as-tool-demo/index.ts
examples/agent-as-tool-demo/package.json
examples/agent-as-tool-demo/README.md
examples/agent-as-tool-demo/tsconfig.json
examples/ai-sdk-provider-demo/
examples/ai-sdk-provider-demo/.env.example
examples/ai-sdk-provider-demo/package.json
examples/ai-sdk-provider-demo/reasoning-ui-example.tsx
examples/ai-sdk-provider-demo/server.ts
examples/ai-sdk-provider-demo/test-vertex.ts
examples/ai-sdk-provider-demo/test.ts
examples/ai-sdk-provider-demo/tsconfig.json
examples/flight-booking/
examples/flight-booking/.env.example
examples/flight-booking/index.ts
examples/flight-booking/jaf-server.ts
examples/flight-booking/multi-agent.ts
examples/flight-booking/package.json
examples/flight-booking/README.md
examples/flight-booking/tsconfig.json
examples/hitl-demo/
examples/hitl-demo/.env.example
examples/hitl-demo/api-demo.ts
examples/hitl-demo/index.ts
examples/hitl-demo/package.json
examples/hitl-demo/README.md
examples/hitl-demo/run-server.ts
examples/hitl-demo/tsconfig.json
examples/hitl-demo/shared/
examples/math-tool-demo/
examples/math-tool-demo/index.ts
examples/math-tool-demo/package.json
examples/math-tool-demo/README.md
examples/math-tool-demo/tsconfig.json
examples/mcp-demo/
examples/mcp-demo/.env.example
examples/mcp-demo/.gitignore
examples/mcp-demo/mcp-filesystem-server.ts
examples/mcp-demo/package.json
examples/mcp-demo/README.md
examples/mcp-demo/tsconfig.json
examples/mcp-http-demo/
examples/mcp-http-demo/index.ts
examples/mcp-http-demo/package.json
examples/mcp-http-demo/README.md
examples/mcp-http-demo/run-server.ts
examples/mcp-http-demo/tsconfig.json
examples/mcp-sse-demo/
examples/mcp-sse-demo/index.ts
examples/mcp-sse-demo/package.json
examples/mcp-sse-demo/README.md
examples/mcp-sse-demo/run-server.ts
examples/mcp-sse-demo/tsconfig.json
examples/otel-tracing-demo/
examples/otel-tracing-demo/.env.example
examples/otel-tracing-demo/otel-demo.ts
examples/otel-tracing-demo/package.json
examples/rag-demo/
examples/rag-demo/.env.example
examples/rag-demo/.gitignore
examples/rag-demo/DEMO_SUMMARY.md
examples/rag-demo/index.ts
examples/rag-demo/package.json
examples/rag-demo/rag-agent.ts
examples/rag-demo/rag-tool.ts
examples/rag-demo/README.md
examples/rag-demo/tsconfig.json
examples/server-demo/
examples/server-demo/.env.example
examples/server-demo/index.ts
examples/server-demo/package.json
examples/server-demo/README.md
examples/server-demo/tsconfig.json
examples/simple-event-handler-demo/
examples/simple-event-handler-demo/.env.example
examples/simple-event-handler-demo/.gitignore
examples/simple-event-handler-demo/DEMO_OUTPUT.md
examples/simple-event-handler-demo/index.ts
examples/simple-event-handler-demo/package.json
examples/simple-event-handler-demo/README.md
examples/simple-event-handler-demo/tsconfig.json
examples/streaming-demo/
examples/streaming-demo/package.json
examples/streaming-demo/README.md
examples/streaming-demo/server.ts
examples/streaming-demo/stream-direct.ts
examples/streaming-demo/stream-plain.ts
examples/streaming-demo/tsconfig.json
examples/visualization-demo/
examples/visualization-demo/index.ts
examples/visualization-demo/package.json
examples/visualization-demo/README.md
scripts/
scripts/setup-test-db.sh
scripts/teardown-test-db.sh
src/
src/index.ts
src/__tests__/
src/__tests__/agent-as-tool.test.ts
src/__tests__/engine.test.ts
src/__tests__/hitl.test.ts
src/__tests__/validation.test.ts
src/a2a/
src/a2a/agent-card.ts
src/a2a/agent.ts
src/a2a/client.ts
src/a2a/executor.ts
src/a2a/index.ts
src/a2a/protocol.ts
src/a2a/server.ts
src/a2a/__tests__/
src/a2a/examples/
src/a2a/memory/
src/adk/
src/core/
src/memory/
src/policies/
src/providers/
src/server/
src/test-utils/
src/tools/
src/types/
src/utils/
src/visualization/

(File list truncated. Use list_files on specific subdirectories if you need to explore further.)

# Workspace Configuration
{
  "workspaces": {
    "/Users/aayush.shah/Desktop/projects/jaf": {
      "hint": "jaf",
      "associatedRemoteUrls": [
        "origin: https://github.com/xynehq/jaf.git"
      ],
      "latestGitCommitHash": "6b97fee9bf8ff6c6bd5970d1c4969597c3e36860"
    }
  }
}

# Detected CLI Tools
These are some of the tools on the user's machine, and may be useful if needed to accomplish the task: git, docker, kubectl, gcloud, npm, pnpm, pip, curl, jq, make, python, node, mysql, sqlite3, code, grep, sed, awk, brew, bundle. This list is not exhaustive, and other tools may be available.

# Context Window Usage
142,928 / 200K tokens used (71%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<attempt_completion>
<result>
# Preventing Duplicate Tool Calls with Same Parameters in JAF

## The Problem

LLMs sometimes call the same tool with identical parameters across different turns, leading to:
- ❌ Wasted API calls and costs
- ❌ Infinite loops
- ❌ No progress toward the goal

## Solution Strategies

JAF provides multiple ways to prevent this. Here are 4 approaches, from simplest to most robust:

---

## Solution 1: Agent Instructions (Simplest)

**Leverage the LLM's ability to read conversation history.**

Since JAF sends **all messages** (including previous tool calls) to the LLM on every turn, you can instruct the agent not to repeat:

```typescript
const smartAgent: Agent<MyContext, string> = {
  name: 'smart_agent',
  instructions: (state) => {
    // Extract previous tool calls from conversation
    const previousToolCalls = state.messages
      .filter(msg => msg.role === 'assistant' && msg.tool_calls)
      .flatMap(msg => msg.tool_calls || [])
      .map(tc => ({
        name: tc.function.name,
        args: tc.function.arguments
      }));

    return `
      You are an intelligent assistant that learns from previous attempts.
      
      CRITICAL RULE: NEVER call the same tool with the exact same parameters twice.
      
      Previous tool calls in this conversation:
      ${previousToolCalls.map(tc => `- ${tc.name}(${tc.args})`).join('\n')}
      
      If you need to retry a tool:
      1. Modify the parameters based on previous results
      2. Try a different approach
      3. Or explain why you cannot proceed
      
      DO NOT waste time repeating failed approaches with identical parameters.
    `;
  },
  tools: [searchTool, analyzeTool, processTool]
};
```

**Pros:**
- ✅ Simple to implement
- ✅ No code changes needed
- ✅ LLM can understand context

**Cons:**
- ❌ Relies on LLM following instructions
- ❌ Not guaranteed to work 100%
- ❌ Uses extra tokens in system message

---

## Solution 2: Context-Based Tracking (Recommended)

**Store previous tool calls in context and validate before execution.**

```typescript
// Define context with tracking
type MyContext = {
  userId: string;
  toolCallHistory: Array<{
    toolName: string;
    args: any;
    timestamp: string;
  }>;
};

// Initialize context
const initialContext: MyContext = {
  userId: 'user123',
  toolCallHistory: []
};

// Create tracking tool wrapper
function createDeduplicatedTool<A, Ctx extends { toolCallHistory: any[] }>(
  baseTool: Tool<A, Ctx>
): Tool<A, Ctx> {
  return {
    schema: baseTool.schema,
    execute: async (args, context) => {
      // Check if this exact call was made before
      const argsString = JSON.stringify(args);
      const duplicate = context.toolCallHistory.find(
        call => call.toolName === baseTool.schema.name && 
                JSON.stringify(call.args) === argsString
      );

      if (duplicate) {
        // Return error instead of executing
        return JSON.stringify({
          status: 'duplicate_call_detected',
          message: `You already called ${baseTool.schema.name} with these exact parameters at ${duplicate.timestamp}. Please try different parameters or a different approach.`,
          previous_call: duplicate,
          suggestion: 'Modify your parameters or try a different tool'
        });
      }

      // Record this call
      context.toolCallHistory.push({
        toolName: baseTool.schema.name,
        args,
        timestamp: new Date().toISOString()
      });

      // Execute the actual tool
      return await baseTool.execute(args, context);
    }
  };
}

// Usage
const searchFlightsTool = {
  schema: {
    name: 'search_flights',
    description: 'Search for flights',
    parameters: z.object({
      origin: z.string(),
      destination: z.string(),
      date: z.string()
    })
  },
  execute: async (args, context) => {
    // Actual search logic
    return JSON.stringify({ flights: [...] });
  }
};

// Wrap with deduplication
const deduplicatedSearchTool = createDeduplicatedTool(searchFlightsTool);

// Use in agent
const agent: Agent<MyContext, string> = {
  name: 'flight_agent',
  instructions: () => 'Search for flights. Avoid repeating failed searches.',
  tools: [deduplicatedSearchTool]  // ← Wrapped tool
};
```

**Pros:**
- ✅ Guaranteed prevention
- ✅ Provides clear feedback to LLM
- ✅ Tracks across entire conversation
- ✅ Context persists during run

**Cons:**
- ❌ Context doesn't persist between runs (unless you save it)
- ❌ Needs wrapper for each tool
- ❌ Extra memory usage

---

## Solution 3: Event Hook Validation (Most Flexible)

**Use `before_tool_execution` event to intercept and validate.**

```typescript
// Track tool calls in a Map
const toolCallTracker = new Map<string, Set<string>>();

function hashToolCall(toolName: string, args: any): string {
  return `${toolName}:${JSON.stringify(args)}`;
}

const config: RunConfig<MyContext> = {
  agentRegistry,
  modelProvider,
  
  onEvent: async (event) => {
    if (event.type === 'before_tool_execution') {
      const { toolName, args, toolCall } = event.data;
      
      // Create hash of this tool call
      const callHash = hashToolCall(toolName, args);
      
      // Check if we've seen this exact call before
      const conversationId = event.data.state?.runId || 'default';
      
      if (!toolCallTracker.has(conversationId)) {
        toolCallTracker.set(conversationId, new Set());
      }
      
      const seenCalls = toolCallTracker.get(conversationId)!;
      
      if (seenCalls.has(callHash)) {
        // Duplicate detected! Modify args to indicate error
        console.warn(`[DEDUP] Duplicate call detected: ${toolName}`);
        
        // Option 1: Throw error to halt execution
        throw new Error(
          `Duplicate tool call: ${toolName} with same parameters. ` +
          `Try different parameters or a different approach.`
        );
        
        // Option 2: Return modified args (JAF will use these)
        // return {
        //   ...args,
        //   __duplicate_detected: true,
        //   __original_args: args
        // };
      }
      
      // Record this call
      seenCalls.add(callHash);
    }
  }
};
```

**Advanced: Return error message directly**

```typescript
onEvent: async (event) => {
  if (event.type === 'before_tool_execution') {
    const { toolName, args, toolCall } = event.data;
    const callHash = hashToolCall(toolName, args);
    
    // ... check for duplicate ...
    
    if (seenCalls.has(callHash)) {
      // Trick: Modify the tool call to fail gracefully
      // We can't return a tool result here, but we can throw
      throw new Error(
        `DUPLICATE: ${toolName} was already called with these parameters. ` +
        `Previous attempts with same params didn't help. Try modifying parameters.`
      );
    }
    
    seenCalls.add(callHash);
  }
}
```

**Pros:**
- ✅ Centralized logic
- ✅ Works for all tools automatically
- ✅ No tool wrapper needed
- ✅ Can implement complex deduplication logic

**Cons:**
- ❌ Throwing errors stops execution
- ❌ Can't directly return tool result from event
- ❌ Need to manage tracker lifecycle

---

## Solution 4: Smart Tool with Built-in Deduplication

**Build deduplication directly into tool logic.**

```typescript
const createSmartTool = <A, Ctx>(config: {
  name: string;
  description: string;
  parameters: z.ZodType<A>;
  execute: (args: A, context: Ctx) => Promise<string>;
  deduplicationKey?: (args: A) => string;  // Custom hash function
  deduplicationWindow?: number;  // Time window in ms
}) => {
  const callHistory = new Map<string, { timestamp: number; result: string }>();
  
  return {
    schema: {
      name: config.name,
      description: config.description,
      parameters: config.parameters
    },
    execute: async (args: A, context: Ctx) => {
      // Generate deduplication key
      const key = config.deduplicationKey 
        ? config.deduplicationKey(args)
        : JSON.stringify(args);
      
      const fullKey = `${config.name}:${key}`;
      const now = Date.now();
      
      // Check if we've seen this call recently
      const previous = callHistory.get(fullKey);
      if (previous) {
        const timeSince = now - previous.timestamp;
        const window = config.deduplicationWindow || Infinity;
        
        if (timeSince < window) {
          return JSON.stringify({
            status: 'duplicate_detected',
            message: `This exact ${config.name} call was made ${Math.floor(timeSince / 1000)}s ago.`,
            previous_result: previous.result,
            suggestion: 'Try different parameters or wait before retrying'
          });
        }
      }
      
      // Execute the tool
      const result = await config.execute(args, context);
      
      // Record this call
      callHistory.set(fullKey, {
        timestamp: now,
        result
      });
      
      // Clean up old entries (optional)
      if (callHistory.size > 1000) {
        const oldestKey = Array.from(callHistory.entries())
          .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
        callHistory.delete(oldestKey);
      }
      
      return result;
    }
  };
};

// Usage
const searchFlightsTool = createSmartTool({
  name: 'search_flights',
  description: 'Search for available flights',
  parameters: z.object({
    origin: z.string(),
    destination: z.string(),
    date: z.string()
  }),
  execute: async (args, context) => {
    // Actual search logic
    const flights = await searchFlights(args);
    return JSON.stringify({ flights });
  },
  deduplicationWindow: 60000,  // 60 seconds
  deduplicationKey: (args) => `${args.origin}-${args.destination}-${args.date}`
});
```

**Pros:**
- ✅ Encapsulated in tool
- ✅ Can customize per tool
- ✅ Time-based deduplication
- ✅ Returns cached results

**Cons:**
- ❌ Need to implement for each tool
- ❌ Memory grows with calls
- ❌ Doesn't persist across restarts

---

## Solution 5: Conversation History Analysis

**Analyze message history and inject into instructions dynamically.**

```typescript
const agent: Agent<MyContext, string> = {
  name: 'smart_agent',
  instructions: (state) => {
    // Analyze conversation for repeated patterns
    const toolCallAnalysis = analyzeToolCalls(state.messages);
    
    let warnings = '';
    if (toolCallAnalysis.duplicates.length > 0) {
      warnings = `
        
        ⚠️ IMPORTANT - You have made these duplicate tool calls:
        ${toolCallAnalysis.duplicates.map(d => 
          `- ${d.toolName}(${JSON.stringify(d.args)}) - called ${d.count} times`
        ).join('\n')}
        
        This suggests you may be stuck. Consider:
        1. Trying a completely different approach
        2. Asking the user for clarification
        3. Explaining why you cannot proceed
      `;
    }
    
    return `
      You are a flight booking assistant.
      ${warnings}
      
      When tools fail or don't produce useful results:
      - DO NOT retry with the exact same parameters
      - Modify your approach based on previous results
      - If stuck, ask the user for help
    `;
  },
  tools: [searchFlightsTool, bookFlightTool]
};

function analyzeToolCalls(messages: readonly Message[]) {
  const toolCalls = new Map<string, number>();
  const duplicates: Array<{ toolName: string; args: any; count: number }> = [];
  
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        const key = `${tc.function.name}:${tc.function.arguments}`;
        const count = (toolCalls.get(key) || 0) + 1;
        toolCalls.set(key, count);
        
        if (count > 1) {
          duplicates.push({
            toolName: tc.function.name,
            args: JSON.parse(tc.function.arguments),
            count
          });
        }
      }
    }
  }
  
  return { duplicates };
}
```

**Pros:**
- ✅ Dynamic feedback based on actual behavior
- ✅ No tool modification needed
- ✅ Provides context to LLM

**Cons:**
- ❌ Still relies on LLM compliance
- ❌ Adds to system message size
- ❌ Computational overhead

---

## Comparison Table

| Solution | Prevention Guarantee | Complexity | Flexibility | Recommended For |
|----------|---------------------|------------|-------------|-----------------|
| **Agent Instructions** | ⚠️ Low | Low | High | Simple cases, well-behaved LLMs |
| **Context Tracking** | ✅ High | Medium | Medium | Most use cases |
| **Event Hook** | ✅ High | High | Very High | Complex deduplication logic |
| **Smart Tool** | ✅ High | Medium | High | Tool-specific rules |
| **History Analysis** | ⚠️ Low | Low | Medium | Providing feedback |

---

## Recommended Implementation

**Combine Solution 2 (Context Tracking) + Solution 1 (Instructions):**

```typescript
// 1. Define context with tracking
type Context = {
  userId: string;
  toolCallHistory: Array<{
    toolName: string;
    args: any;
    result: string;
    timestamp: string;
  }>;
};

// 2. Create deduplication wrapper
function preventDuplicates<A, Ctx extends { toolCallHistory: any[] }>(
  tool: Tool<A, Ctx>
): Tool<A, Ctx> {
  return {
    schema: tool.schema,
    execute: async (args, context) => {
      const argsHash = JSON.stringify(args);
      const duplicate = context.toolCallHistory.find(
        h => h.toolName === tool.schema.name && JSON.stringify(h.args) === argsHash
      );

      if (duplicate) {
        const message = [
          `⛔ Duplicate call prevented!`,
          `You already called ${tool.schema.name} with these exact parameters.`,
          `Previous result: ${duplicate.result.substring(0, 200)}...`,
          ``,
          `Please try:`,
          `- Different parameters`,
          `- A different tool`,
          `- Asking the user for clarification`
        ].join('\n');
        
        return message;
      }

      const result = await tool.execute(args, context);
      
      context.toolCallHistory.push({
        toolName: tool.schema.name,
        args,
        result: typeof result === 'string' ? result : JSON.stringify(result),
        timestamp: new Date().toISOString()
      });

      return result;
    }
  };
}

// 3. Agent with smart instructions
const agent: Agent<Context, string> = {
  name: 'smart_agent',
  instructions: (state) => {
    const recentCalls = state.context.toolCallHistory.slice(-5);
    
    return `
      You are an intelligent assistant that learns from previous attempts.
      
      ${recentCalls.length > 0 ? `
      Recent tool calls you made:
      ${recentCalls.map(c => `- ${c.toolName}(${JSON.stringify(c.args).substring(0, 100)})`).join('\n')}
      ` : ''}
      
      Rules:
      1. NEVER call the same tool with exact same parameters twice
      2. If a tool fails, try different parameters or a different approach
      3. Learn from previous results
      4. If stuck after 3 attempts, ask the user for help
    `;
  },
  tools: [
    preventDuplicates(searchFlightsTool),
    preventDuplicates(bookFlightTool)
  ]
};
```

This gives you:
- ✅ **Guaranteed** prevention (tool wrapper)
- ✅ **LLM awareness** (instructions with history)
- ✅ **Clear feedback** (error messages explain the issue)
- ✅ **Simple to use** (just wrap your tools)

Perfect balance of safety and usability!
</result>
<task_progress>
- [x] Understand the duplicate tool call problem
- [x] Analyze JAF's architecture for solutions
- [x] Provide multiple implementation strategies
- [x] Create working code examples
- [x] Compare approaches and recommend best solution
</task_progress>
</attempt_completion>

---

**User:**

[TASK RESUMPTION] This task was interrupted 4 minutes ago. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '/Users/aayush.shah/Desktop/projects/jaf'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.

Note: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.
New instructions for task continuation:
<user_message>
I want to understand the hooks usage .Let's say on beforeTollCall hook I decide to skip the tool call and go to LLM with feedback that This tool call was made previously with the same parameters . Access results from messages history or try new approaches How do I do that >
If i say throw an error then whaat happens ? how things work then ? does loop break ?
</user_message>

# TODO LIST RECOMMENDED

When starting a new task, it is recommended to create a todo list.


1. Include the task_progress parameter in your next tool call
2. Create a comprehensive checklist of all steps needed
3. Use markdown format: - [ ] for incomplete, - [x] for complete

**Benefits of creating a todo list now:**
	- Clear roadmap for implementation
	- Progress tracking throughout the task
	- Nothing gets forgotten or missed
	- Users can see, monitor, and edit the plan

**Example structure:**```
- [ ] Analyze requirements
- [ ] Set up necessary files
- [ ] Implement main functionality
- [ ] Handle edge cases
- [ ] Test the implementation
- [ ] Verify results```

Keeping the todo list updated helps track progress and ensures nothing is missed.

<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 4:24:30 PM (Asia/Calcutta, UTC+5.5:00)

# Current Working Directory (/Users/aayush.shah/Desktop/projects/jaf) Files
.env.test
.eslintrc.js
.gitignore
.npmignore
CHANGELOG_EVENT_IMPROVEMENTS.md
docker-compose.test.yml
jest.config.js
jest.setup.js
LICENSE
mkdocs.yml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
QUICK_REFERENCE_EVENT_HANDLERS.md
README.md
requirements.txt
tsconfig.json
dependencies/
dependencies/pdf-parse/
dependencies/pdf-parse/.editorconfig
dependencies/pdf-parse/.gitignore
dependencies/pdf-parse/.gitlab-ci.yml
dependencies/pdf-parse/.jsbeautifyrc
dependencies/pdf-parse/.npmrc
dependencies/pdf-parse/CHANGELOG
dependencies/pdf-parse/CONTRIBUTING.md
dependencies/pdf-parse/index.d.ts
dependencies/pdf-parse/index.js
dependencies/pdf-parse/LICENSE
dependencies/pdf-parse/NOTES.md
dependencies/pdf-parse/package.json
dependencies/pdf-parse/QUICKSTART.js
dependencies/pdf-parse/README.md
dependencies/pdf-parse/lib/
dependencies/pdf-parse/test/
docs/
docs/a2a-integration.md
docs/a2a-protocol.md
docs/adk-analysis.md
docs/adk-layer.md
docs/agents-as-tools.md
docs/api-reference.md
docs/CONTRIBUTING.md
docs/core-concepts.md
docs/cover.png
docs/deployment.md
docs/event-handling-guide.md
docs/examples.md
docs/favicon.png
docs/getting-started.md
docs/jaf-adk-layer-plan.md
docs/llm-prompting-and-turns.md
docs/logo.png
docs/memory-system.md
docs/model-providers.md
docs/new-features.md
docs/README.md
docs/safe-logging.md
docs/sanitization.md
docs/serve.sh
docs/server-api.md
docs/tools.md
docs/trace-events-reference.md
docs/tracing.md
docs/troubleshooting.md
docs/visualization.md
docs/stylesheets/
docs/stylesheets/extra.css
examples/
examples/attachment-demo-server.ts
examples/custom-sanitization-example.ts
examples/guardrails-demo.ts
examples/safe-logging-example.ts
examples/verify-param-modification.ts
examples/agent-as-tool-demo/
examples/agent-as-tool-demo/.env.example
examples/agent-as-tool-demo/index.ts
examples/agent-as-tool-demo/package.json
examples/agent-as-tool-demo/README.md
examples/agent-as-tool-demo/tsconfig.json
examples/ai-sdk-provider-demo/
examples/ai-sdk-provider-demo/.env.example
examples/ai-sdk-provider-demo/package.json
examples/ai-sdk-provider-demo/reasoning-ui-example.tsx
examples/ai-sdk-provider-demo/server.ts
examples/ai-sdk-provider-demo/test-vertex.ts
examples/ai-sdk-provider-demo/test.ts
examples/ai-sdk-provider-demo/tsconfig.json
examples/flight-booking/
examples/flight-booking/.env.example
examples/flight-booking/index.ts
examples/flight-booking/jaf-server.ts
examples/flight-booking/multi-agent.ts
examples/flight-booking/package.json
examples/flight-booking/README.md
examples/flight-booking/tsconfig.json
examples/hitl-demo/
examples/hitl-demo/.env.example
examples/hitl-demo/api-demo.ts
examples/hitl-demo/index.ts
examples/hitl-demo/package.json
examples/hitl-demo/README.md
examples/hitl-demo/run-server.ts
examples/hitl-demo/tsconfig.json
examples/hitl-demo/shared/
examples/math-tool-demo/
examples/math-tool-demo/index.ts
examples/math-tool-demo/package.json
examples/math-tool-demo/README.md
examples/math-tool-demo/tsconfig.json
examples/mcp-demo/
examples/mcp-demo/.env.example
examples/mcp-demo/.gitignore
examples/mcp-demo/mcp-filesystem-server.ts
examples/mcp-demo/package.json
examples/mcp-demo/README.md
examples/mcp-demo/tsconfig.json
examples/mcp-http-demo/
examples/mcp-http-demo/index.ts
examples/mcp-http-demo/package.json
examples/mcp-http-demo/README.md
examples/mcp-http-demo/run-server.ts
examples/mcp-http-demo/tsconfig.json
examples/mcp-sse-demo/
examples/mcp-sse-demo/index.ts
examples/mcp-sse-demo/package.json
examples/mcp-sse-demo/README.md
examples/mcp-sse-demo/run-server.ts
examples/mcp-sse-demo/tsconfig.json
examples/otel-tracing-demo/
examples/otel-tracing-demo/.env.example
examples/otel-tracing-demo/otel-demo.ts
examples/otel-tracing-demo/package.json
examples/rag-demo/
examples/rag-demo/.env.example
examples/rag-demo/.gitignore
examples/rag-demo/DEMO_SUMMARY.md
examples/rag-demo/index.ts
examples/rag-demo/package.json
examples/rag-demo/rag-agent.ts
examples/rag-demo/rag-tool.ts
examples/rag-demo/README.md
examples/rag-demo/tsconfig.json
examples/server-demo/
examples/server-demo/.env.example
examples/server-demo/index.ts
examples/server-demo/package.json
examples/server-demo/README.md
examples/server-demo/tsconfig.json
examples/simple-event-handler-demo/
examples/simple-event-handler-demo/.env.example
examples/simple-event-handler-demo/.gitignore
examples/simple-event-handler-demo/DEMO_OUTPUT.md
examples/simple-event-handler-demo/index.ts
examples/simple-event-handler-demo/package.json
examples/simple-event-handler-demo/README.md
examples/simple-event-handler-demo/tsconfig.json
examples/streaming-demo/
examples/streaming-demo/package.json
examples/streaming-demo/README.md
examples/streaming-demo/server.ts
examples/streaming-demo/stream-direct.ts
examples/streaming-demo/stream-plain.ts
examples/streaming-demo/tsconfig.json
examples/visualization-demo/
examples/visualization-demo/index.ts
examples/visualization-demo/package.json
examples/visualization-demo/README.md
scripts/
scripts/setup-test-db.sh
scripts/teardown-test-db.sh
src/
src/index.ts
src/__tests__/
src/__tests__/agent-as-tool.test.ts
src/__tests__/engine.test.ts
src/__tests__/hitl.test.ts
src/__tests__/validation.test.ts
src/a2a/
src/a2a/agent-card.ts
src/a2a/agent.ts
src/a2a/client.ts
src/a2a/executor.ts
src/a2a/index.ts
src/a2a/protocol.ts
src/a2a/server.ts
src/a2a/__tests__/
src/a2a/examples/
src/a2a/memory/
src/adk/
src/core/
src/memory/
src/policies/
src/providers/
src/server/
src/test-utils/
src/tools/
src/types/
src/utils/
src/visualization/

(File list truncated. Use list_files on specific subdirectories if you need to explore further.)

# Workspace Configuration
{
  "workspaces": {
    "/Users/aayush.shah/Desktop/projects/jaf": {
      "hint": "jaf",
      "associatedRemoteUrls": [
        "origin: https://github.com/xynehq/jaf.git"
      ],
      "latestGitCommitHash": "6b97fee9bf8ff6c6bd5970d1c4969597c3e36860"
    }
  }
}

# Detected CLI Tools
These are some of the tools on the user's machine, and may be useful if needed to accomplish the task: git, docker, kubectl, gcloud, npm, pnpm, pip, curl, jq, make, python, node, mysql, sqlite3, code, grep, sed, awk, brew, bundle. This list is not exhaustive, and other tools may be available.

# Context Window Usage
150,477 / 200K tokens used (75%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<search_files>
<path>src/core</path>
<regex>before_tool_execution|beforeEventResponse</regex>
<file_pattern>engine.ts</file_pattern>
<task_progress>
- [ ] Examine before_tool_execution hook implementation
- [ ] Understand what happens when hook throws error
- [ ] Understand what happens when hook returns value
- [ ] Document the complete flow
- [ ] Provide working examples
</task_progress>
</search_files>

---

**User:**

[search_files for 'before_tool_execution|beforeEventResponse' in 'engine.ts'] Result:
Found 8 results.

src/core/engine.ts
│----
│      // Emit before_tool_execution event - handler can return modified args
│      if (config.onEvent) {
│        try {
│----
│          const beforeEventResponse = await config.onEvent({
│----
│            type: 'before_tool_execution',
│            data: {
│          // If event handler returns a value, use it to override the args
│----
│          if (beforeEventResponse !== undefined && beforeEventResponse !== null) {
│----
│            console.log(`[JAF:ENGINE] Tool args modified by before_tool_execution event handler for ${toolCall.function.name}`);
│            console.log(`[JAF:ENGINE] Original args:`, rawArgs);
│----
│            console.log(`[JAF:ENGINE] Modified args:`, beforeEventResponse);
│----
│            rawArgs = beforeEventResponse;
│          }
│        } catch (eventError) {
│----
│          console.error(`[JAF:ENGINE] Error in before_tool_execution event handler:`, eventError);
│          // Continue with original args if event handler fails
│----
<environment_details>
# Visual Studio Code Visible Files
docs/llm-prompting-and-turns.md

# Visual Studio Code Open Tabs
src/core/engine.ts
docs/llm-prompting-and-turns.md
examples/ai-sdk-provider-demo/.env
examples/ai-sdk-provider-demo/test-vertex.ts
src/a2a/examples/weather-agent.ts
src/a2a/examples/server-example.ts
src/a2a/agent.ts
src/providers/model_prices.json
../../../MinerU/juspay.pdf-63fedba3-847e-467c-8e79-629d602f318d/full.md
src/adk/index.ts
src/providers/index.ts
examples/ai-sdk-provider-demo/test.ts
examples/streaming-demo/stream-plain.ts

# Current Time
11/7/2025, 4:24:41 PM (Asia/Calcutta, UTC+5.5:00)

# Context Window Usage
153,409 / 200K tokens used (77%)

# Current Mode
ACT MODE
</environment_details>

---

**Assistant:**


<attempt_completion>
<result>
# Understanding JAF's `before_tool_execution` Hook

Based on the JAF source code, here's **exactly** how the hook works and what you can do with it:

---

## How the Hook Works

From `src/core/engine.ts` (lines ~793-817):

```typescript
async function executeToolCalls<Ctx>(...) {
  const results = await Promise.all(
    toolCalls.map(async (toolCall): Promise<ToolCallResult> => {
      let rawArgs = tryParseJSON(toolCall.function.arguments);

      // 1. BEFORE_TOOL_EXECUTION EVENT FIRES HERE
      if (config.onEvent) {
        try {
          const beforeEventResponse = await config.onEvent({
            type: 'before_tool_execution',
            data: {
              toolName: toolCall.function.name,
              args: rawArgs,
              toolCall,
              traceId: state.traceId,
              runId: state.runId,
              toolSchema: tool?.schema,
              context: state.context,
              state,  // ← Full state with messages!
              agentName: agent.name
            }
          });

          // 2. IF HANDLER RETURNS A VALUE: Use it to override args
          if (beforeEventResponse !== undefined && beforeEventResponse !== null) {
            console.log(`[JAF:ENGINE] Tool args modified`);
            rawArgs = beforeEventResponse;  // ← Args replaced!
          }
        } catch (eventError) {
          // 3. IF HANDLER THROWS: Error is caught, logged, execution continues
          console.error(`[JAF:ENGINE] Error in before_tool_execution event handler:`, eventError);
          // Continue with original args if event handler fails
        }
      }

      // 4. TOOL EXECUTION CONTINUES (with original or modified args)
      const parseResult = tool.schema.parameters.safeParse(rawArgs);
      // ... validation and execution ...
    })
  );
}
```

---

## Key Behaviors

### ✅ What You CAN Do

**1. Modify Arguments**
```typescript
onEvent: async (event) => {
  if (event.type === 'before_tool_execution') {
    // Return modified args
    return {
      ...event.data.args,
      modified: true
    };
  }
}
```

**2. Access Full State (Including Message History)**
```typescript
onEvent: async (event) => {
  if (event.type === 'before_tool_execution') {
    const { state, toolName, args } = event.data;
    
    // Access all messages
    console.log('Messages:', state.messages);
    
    // Find previous tool calls
    const previousCalls = state.messages
      .filter(msg => msg.role === 'assistant' && msg.tool_calls)
      .flatMap(msg => msg.tool_calls || []);
  }
}
```

### ❌ What You CANNOT Do Directly

**1. Skip Tool Execution**
- There's no way to signal "don't execute this tool"
- Throwing an error just logs it and continues
- The tool WILL execute

**2. Return a Tool Result**
- You can only return modified args
- You cannot return a fake tool result directly

---

## What Happens When You Throw an Error

### Current Behavior (From Code)

```typescript
try {
  const beforeEventResponse = await config.onEvent({...});
  if (beforeEventResponse !== undefined && beforeEventResponse !== null) {
    rawArgs = beforeEventResponse;
  }
} catch (eventError) {
  console.error(`[JAF:ENGINE] Error in before_tool_execution event handler:`, eventError);
  // Continue with original args if event handler fails ← CONTINUES!
}
```

**When you throw an error:**
1. ❌ Error is **caught and logged**
2. ❌ Execution **does NOT stop**
3. ❌ Loop **does NOT break**
4. ✅ Tool executes with **original args**
5. ✅ **No impact** on the overall flow

**Example:**
```typescript
onEvent: async (event) => {
  if (event.type === 'before_tool_execution') {
    throw new Error('STOP THIS TOOL!');  // ← This does NOTHING useful!
  }
}

// Result:
// Console output: "Error in before_tool_execution event handler: STOP THIS TOOL!"
// Tool still executes normally
```

---

## How to Actually Skip a Tool and Provide Feedback

Since you **cannot skip execution**, the solution is to **make the tool detect and handle the duplicate itself**.

### Solution: Return Special Args That Tool Recognizes

```typescript
// Track previous tool calls
const toolCallHistory = new Map<string, any[]>();

const config: RunConfig<MyContext> = {
  onEvent: async (event) => {
    if (event.type === 'before_tool_execution') {
      const { toolName, args, state } = event.data;
      
      // Create hash of this tool call
      const callKey = `${toolName}:${JSON.stringify(args)}`;
      
      // Initialize tracking for this conversation
      const conversationId = state.runId;
      if (!toolCallHistory.has(conversationId)) {
        toolCallHistory.set(conversationId, []);
      }
      
      const history = toolCallHistory.get(conversationId)!;
      
      // Check for duplicates
      const duplicate = history.find(h => h.callKey === callKey);
      
      if (duplicate) {
        console.log(`[DEDUP] Duplicate detected: ${toolName}`);
        
        // Find previous result from message history
        const previousResult = findPreviousToolResult(
          state.messages, 
          toolName, 
          args
        );
        
        // OPTION 1: Return special args that tool will recognize
        return {
          __SKIP_EXECUTION: true,
          __DUPLICATE_DETECTED: true,
          __TOOL_NAME: toolName,
          __ORIGINAL_ARGS: args,
          __PREVIOUS_RESULT: previousResult,
          __MESSAGE: `This exact ${toolName} call was made before. Previous result: ${previousResult?.substring(0, 200)}...`
        };
      }
      
      // Record this call
      history.push({ callKey, args, timestamp: Date.now() });
    }
  }
};

// Helper function to find previous result
function findPreviousToolResult(
  messages: readonly Message[], 
  toolName: string, 
  args: any
): string | null {
  const argsString = JSON.stringify(args);
  
  // Find assistant messages with matching tool calls
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.function.name === toolName && 
            tc.function.arguments === argsString) {
          // Found matching call, now find its result
          for (let j = i + 1; j < messages.length; j++) {
            const resultMsg = messages[j];
            if (resultMsg.role === 'tool' && 
                resultMsg.tool_call_id === tc.id) {
              return getTextContent(resultMsg.content);
            }
          }
        }
      }
    }
  }
  
  return null;
}
```

### Then Modify Your Tool to Handle the Skip Signal

```typescript
const smartTool = {
  schema: {
    name: 'search_flights',
    description: 'Search for flights',
    parameters: z.object({
      origin: z.string(),
      destination: z.string(),
      date: z.string(),
      // Allow the special skip fields
      __SKIP_EXECUTION: z.boolean().optional(),
      __DUPLICATE_DETECTED: z.boolean().optional(),
      __MESSAGE: z.string().optional(),
      __PREVIOUS_RESULT: z.string().optional()
    }).passthrough()  // ← Allow extra fields
  },
  execute: async (args, context) => {
    // Check if this is a skip signal
    if (args.__SKIP_EXECUTION) {
      return JSON.stringify({
        status: 'duplicate_call_prevented',
        message: args.__MESSAGE || 'Duplicate call detected',
        previous_result: args.__PREVIOUS_RESULT,
        tool_name: args.__TOOL_NAME,
        suggestion: 'Try different parameters or a different approach. The previous result is provided above for your reference.'
      });
    }
    
    // Normal execution
    const flights = await actualSearchFlights(args);
    return JSON.stringify({ flights });
  }
};
```

---

## Complete Working Example

```typescript
import { z } from 'zod';
import { RunConfig, Agent, getTextContent } from '@xynehq/jaf';

// ========== TRACKING ==========
const toolCallHistory = new Map<string, any[]>();

function hashToolCall(toolName: string, args: any): string {
  return `${toolName}:${JSON.stringify(args)}`;
}

function findPreviousResult(
  messages: readonly Message[], 
  toolName: string, 
  args: any
): { result: string; timestamp: string } | null {
  const argsString = JSON.stringify(args);
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.tool_calls) {
      const matchingCall = msg.tool_calls.find(
        tc => tc.function.name === toolName && 
              tc.function.arguments === argsString
      );
      
      if (matchingCall) {
        // Find the tool result
        for (let j = i + 1; j < messages.length; j++) {
          const resultMsg = messages[j];
          if (resultMsg.role === 'tool' && 
              resultMsg.tool_call_id === matchingCall.id) {
            return {
              result: getTextContent(resultMsg.content),
              timestamp: new Date().toISOString()  // You could extract from metadata
            };
          }
        }
      }
    }
  }
  
  return null;
}

// ========== CONFIG WITH HOOK ==========
const config: RunConfig<MyContext> = {
  agentRegistry,
  modelProvider,
  
  onEvent: async (event) => {
    if (event.type === 'before_tool_execution') {
      const { toolName, args, state, toolCall } = event.data;
      
      const callHash = hashToolCall(toolName, args);
      const conversationId = state.runId;
      
      // Initialize tracking
      if (!toolCallHistory.has(conversationId)) {
        toolCallHistory.set(conversationId, []);
      }
      
      const history = toolCallHistory.get(conversationId)!;
      
      // Check for duplicate
      const isDuplicate = history.some(h => h.callHash === callHash);
      
      if (isDuplicate) {
        console.log(`🚫 [DEDUP] Blocking duplicate: ${toolName}`);
        
        // Find previous result
        const previous = findPreviousResult(state.messages, toolName, args);
        
        // Return special args to signal skip
        return {
          __SKIP_EXECUTION: true,
          __DUPLICATE_DETECTED: true,
          __TOOL_NAME: toolName,
          __ORIGINAL_ARGS: args,
          __PREVIOUS_RESULT: previous?.result || 'Result not found',
          __PREVIOUS_TIMESTAMP: previous?.timestamp || 'Unknown',
          __MESSAGE: [
            `⚠️ Duplicate call detected for ${toolName}`,
            `You already called this with the same parameters.`,
            previous ? `Previous result:\n${previous.result.substring(0, 300)}...` : '',
            `\nPlease try:`,
            `- Different parameters`,
            `- A different tool`, 
            `- Asking the user for clarification`
          ].filter(Boolean).join('\n')
        };
      }
      
      // Record this call
      history.push({
        callHash,
        toolName,
        args,
        timestamp: Date.now()
      });
      
      // Return undefined to use original args
      return undefined;
    }
  }
};

// ========== SMART TOOL WRAPPER ==========
function createDeduplicatableTool<A>(baseTool: {
  schema: { name: string; description: string; parameters: z.ZodType<A> };
  execute: (args: A, context: any) => Promise<string>;
}) {
  return {
    schema: {
      ...baseTool.schema,
      // Extend schema to accept skip signals
      parameters: baseTool.schema.parameters.and(
        z.object({
          __SKIP_EXECUTION: z.boolean().optional(),
          __DUPLICATE_DETECTED: z.boolean().optional(),
          __TOOL_NAME: z.string().optional(),
          __MESSAGE: z.string().optional(),
          __PREVIOUS_RESULT: z.string().optional(),
          __PREVIOUS_TIMESTAMP: z.string().optional()
        }).passthrough()
      )
    },
    execute: async (args: any, context: any) => {
      // Handle skip signal
      if (args.__SKIP_EXECUTION) {
        console.log(`⏭️ [TOOL] Skipping execution: ${args.__MESSAGE}`);
        return args.__MESSAGE;
      }
      
      // Normal execution
      return await baseTool.execute(args, context);
    }
  };
}

// ========== USAGE ==========
const searchFlightsTool = createDeduplicatableTool({
  schema: {
    name: 'search_flights',
    description: 'Search for flights',
    parameters: z.object({
      origin: z.string(),
      destination: z.string(),
      date: z.string()
    })
  },
  execute: async (args, context) => {
    // Actual search logic
    const flights = await searchFlights(args);
    return JSON.stringify({ flights });
  }
});

const agent: Agent<MyContext, string> = {
  name: 'flight_agent',
  instructions: () => 'Search for flights. Avoid repeating failed searches.',
  tools: [searchFlightsTool]
};
```

---

## What Actually Happens

### Scenario: LLM Calls Same Tool Twice

**Turn 1:**
```typescript
LLM: search_flights({ origin: 'NYC', destination: 'LAX', date: '2024-12-25' })
  ↓
before_tool_execution fires → No duplicate → Returns undefined
  ↓
Tool executes → Returns flight results
  ↓
LLM receives: "Found 5 flights..."
```

**Turn 2 (LLM makes same call again):**
```typescript
LLM: search_flights({ origin: 'NYC', destination: 'LAX', date: '2024-12-25' })  // ← SAME!
  ↓
before_tool_execution fires → Duplicate detected!
  ↓
Returns: { __SKIP_EXECUTION: true, __MESSAGE: "⚠️ Duplicate call...", __PREVIOUS_RESULT: "..." }
  ↓
Tool receives modified args
  ↓
Tool detects __SKIP_EXECUTION → Returns message instead of executing
  ↓
LLM receives: "⚠️ Duplicate call detected. Previous result: ..."
  ↓
LLM should try different approach
```

---

## Summary

### ✅ What Works

| Action | Result |
|--------|--------|
| Return modified args | ✅ Tool receives modified args |
| Return `undefined` | ✅ Tool receives original args |
| Access state/messages | ✅ Full access to conversation history |
| Track across calls | ✅ Can use external Map/storage |

### ❌ What Doesn't Work

| Action | Result |
|--------|--------|
| Throw error to skip | ❌ Error logged, tool still executes |
| Return tool result | ❌ Can only return modified args |
| Break execution loop | ❌ No mechanism to stop |

### 💡 The Pattern

**To "skip" a tool call:**
1. Return special args in `before_tool_execution`
2. Tool checks for special args
3. Tool returns message instead of executing
4. LLM sees the message and tries different approach

This is the **only** way to effectively prevent duplicate tool execution while providing feedback to the LLM!
</result>
<task_progress>
- [x] Examine before_tool_execution hook implementation
- [x] Understand what happens when hook throws error
- [x] Understand what happens when hook returns value
- [x] Document the complete flow
- [x] Provide working examples
</task_progress>
</attempt_completion>

