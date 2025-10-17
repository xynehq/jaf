# JAF Simple Event Handler Demo

This example demonstrates how to use `createSimpleEventHandler()` for cleaner, type-safe event handling in JAF.

## What it shows

- **Simple Event Handlers**: Use declarative handlers instead of manual switch statements
- **Type Safety**: Fully typed event callbacks without `(event as any)` casts
- **Better DX**: Reduce event handling code by ~80%
- **Tool Integration**: See how events work with real tool execution

## Key Features Demonstrated

### Before (Raw TraceEvent)
```typescript
onEvent: (event: TraceEvent) => {
  switch (event.type) {
    case 'llm_call_end':
      const content = (event as any).response?.content;  // ❌ Type casting
      console.log(content);
      break;
    // ... many more cases
  }
}
```

### After (Simple Event Handler)
```typescript
onEvent: createSimpleEventHandler({
  onAssistantMessage: (content) => console.log(content),  // ✅ Fully typed!
  onToolCalls: (calls) => console.log('Tools:', calls),
  onTokenUsage: (usage) => console.log('Tokens:', usage.total_tokens),
})
```

## Prerequisites

From repo root:

```bash
pnpm -w install
pnpm -w build  # ensure @xynehq/jaf exports are up-to-date
```

## Setup

Create a `.env` file in this directory:

```env
LITELLM_URL=http://localhost:4000
LITELLM_API_KEY=your-api-key
LITELLM_MODEL=gpt-4o-mini
```

Or use any LiteLLM-compatible endpoint.

## Run

```bash
pnpm --filter jaf-simple-event-handler-demo run dev
```

Or from this directory:

```bash
pnpm dev
```

## What you'll see

The demo will:
1. Start an agent run with a math question
2. Display events as they happen using simple handlers:
   - 🚀 Run started
   - 💬 Assistant messages
   - 🔧 Tool calls requested
   - ✅ Tool results
   - 💰 Token usage
   - ✨ Run completed

## Event Handlers Used

This demo uses the following simplified event handlers:

- `onRunStart` - When the run begins
- `onAssistantMessage` - When AI generates text
- `onToolCalls` - When tools are requested
- `onToolResult` - When tool execution completes
- `onTokenUsage` - Token usage tracking
- `onError` - Error handling
- `onRunEnd` - When the run completes

## Learn More

- [Event Handling Guide](../../docs/event-handling-guide.md)
- [Quick Reference](../../QUICK_REFERENCE_EVENT_HANDLERS.md)
- [JAF Documentation](https://xynehq.github.io/jaf/)

## Benefits

✅ **80% less code** - From ~100 lines of switch statements to ~20 lines
✅ **100% type safe** - No more `(event as any)` casts
✅ **Better DX** - Clear, declarative handlers with IDE autocomplete
✅ **Easy to maintain** - Add/remove handlers without complex logic
