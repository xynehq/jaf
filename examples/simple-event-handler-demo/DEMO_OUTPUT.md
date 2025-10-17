# Expected Demo Output

When you run this demo, you should see output like this:

```
=== Simple Event Handler Demo ===

This demo shows how to use createSimpleEventHandler() for cleaner event handling.

🚀 Run started: 1a2b3c4d...

🔧 Tools requested: math

✅ math completed: {"result":12}

💬 Assistant: The result of 144 divided by 12 is **12**.

💰 Tokens used: 156 (prompt: 89, completion: 67)

✨ Run completed successfully

--- Final Result ---
Status: completed
Output: The result of 144 divided by 12 is **12**.
```

## What Each Event Shows

- **🚀 Run started** - From `onRunStart()` handler
- **🔧 Tools requested** - From `onToolCalls()` handler
- **✅ Tool completed** - From `onToolResult()` handler
- **💬 Assistant** - From `onAssistantMessage()` handler
- **💰 Tokens used** - From `onTokenUsage()` handler
- **✨ Run completed** - From `onRunEnd()` handler

## Comparison with Raw Events

### Without createSimpleEventHandler (Raw Events)

You would need ~100 lines like this:

```typescript
onEvent: (event: TraceEvent) => {
  switch (event.type) {
    case 'run_start':
      console.log(`Run started: ${event.data.runId}`);
      break;
    case 'llm_call_end':
      if ((event as any).response?.content) {  // ❌ Type casting
        const content = (event as any).response.content;
        console.log('Assistant:', content);
      }
      break;
    case 'tool_requests':
      const calls = (event as any).toolCalls;  // ❌ Type casting
      console.log('Tools:', calls?.map(c => c.name));
      break;
    // ... many more cases
  }
}
```

### With createSimpleEventHandler

Just ~30 lines of clean, typed handlers:

```typescript
onEvent: createSimpleEventHandler({
  onRunStart: (runId) => console.log(`Run started: ${runId}`),
  onAssistantMessage: (content) => console.log('Assistant:', content),
  onToolCalls: (calls) => console.log('Tools:', calls.map(c => c.name)),
  // ... other handlers
})
```

**Result**: 70% less code, 100% type safe, infinitely more readable! ✨
