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
