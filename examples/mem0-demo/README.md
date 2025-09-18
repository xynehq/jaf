# JAF Mem0 Memory Provider Demo

This demo showcases the Mem0 memory provider integration with JAF, demonstrating AI-powered semantic memory functionality with real API integration.

## Features Demonstrated

- **addToMemory**: Store memories with semantic understanding
- **searchMemory**: Search memories using natural language queries  
- **Health Monitoring**: Provider health checks and performance metrics
- **Conversation Storage**: Standard JAF memory provider interface
- **Error Handling**: Robust error management and timeouts
- **Real API Integration**: Uses actual Mem0 service with live API calls

## What is Mem0?

Mem0 is an AI-powered memory service that provides:
- Semantic memory storage and retrieval
- Automatic memory extraction from conversations
- Natural language search capabilities
- Custom instructions and metadata support
- Vector-based memory search with relevance scoring

## Prerequisites

- Node.js 18+ or compatible runtime
- pnpm (this project uses pnpm workspaces)
- Mem0 API key (get from [app.mem0.ai](https://app.mem0.ai))

## Setup

### Installation

This demo uses the JAF workspace setup. Install dependencies using pnpm:

```bash
# From the demo directory
pnpm install

# Or from the JAF root to install all workspace dependencies
cd /path/to/jaf && pnpm install
```

### Running the Demo

The demo is pre-configured with a real Mem0 API key and uses the actual Mem0 service:

```bash
pnpm start
```

### Using Your Own API Key

To use your own Mem0 API key:

1. Get your API key from [app.mem0.ai/dashboard/api-keys](https://app.mem0.ai/dashboard/api-keys)
2. Replace the hardcoded API key in `index.ts`:

```typescript
// Replace this line in index.ts
const mem0Client = new MemoryClient({ 
  apiKey: 'your-api-key-here' 
});
```

## Demo Flow

1. **Memory Addition**: Adds sample user preferences and background information
2. **Semantic Search**: Searches memories using natural language queries
3. **Health Check**: Validates provider connectivity and performance
4. **Conversation Storage**: Tests standard JAF memory interface
5. **Cleanup**: Properly closes the provider

## Key Concepts

### Semantic Memory
Unlike traditional keyword search, Mem0 understands context and meaning:

```typescript
// Stores: "The user prefers Python for machine learning"
await provider.addToMemory(
  "The user prefers Python for machine learning",
  "user@example.com"
);

// Finds the above memory with related queries:
await provider.searchMemory("programming languages", "user@example.com");
await provider.searchMemory("ML frameworks", "user@example.com");
```

### Custom Instructions
Guide how memories are processed:

```typescript
await provider.addToMemory(
  "User completed advanced React course",
  "user@example.com", 
  "Focus on technical skills and learning progress"
);
```

### Metadata Support
Attach structured data to memories:

```typescript
await provider.addToMemory(
  "User works at TechCorp as Senior Engineer",
  "user@example.com",
  undefined,
  { 
    category: "employment", 
    level: "senior",
    company: "TechCorp" 
  }
);
```

## Integration with JAF Framework

The Mem0 provider seamlessly integrates with JAF's memory system:

### Standard MemoryProvider Interface
```typescript
// Import from JAF package
import { createMem0Provider, Message } from '@xynehq/jaf';
import { MemoryClient } from 'mem0ai';

// Create provider with real Mem0 client
const mem0Client = new MemoryClient({ apiKey: 'your-api-key' });
const provider = await createMem0Provider({
  type: 'mem0',
  apiKey: 'your-api-key',
  baseUrl: 'https://api.mem0.ai',
  timeout: 30000,
  maxRetries: 3
}, mem0Client);

// Standard JAF memory operations
await provider.storeMessages(conversationId, messages);
await provider.getConversation(conversationId);
await provider.appendMessages(conversationId, newMessages);
```

### Mem0-Specific Extensions
```typescript
// Semantic memory operations
const searchResults = await provider.searchMemory(
  "user preferences", 
  "user@example.com", 
  10
);

const addResult = await provider.addToMemory(
  "User loves TypeScript and functional programming",
  "user@example.com",
  "Focus on technical preferences",
  { category: "programming", skill_level: "advanced" }
);
```

### Factory Integration
The provider integrates with JAF's memory factory:

```typescript
import { createMemoryProvider } from '@xynehq/jaf';
import { MemoryClient } from 'mem0ai';

const mem0Client = new MemoryClient({ apiKey: 'your-key' });
const provider = await createMemoryProvider({
  type: 'mem0',
  apiKey: 'your-key',
  baseUrl: 'https://api.mem0.ai'
}, { mem0: mem0Client });
```

### Environment Variable Support
```bash
# Set environment variables for automatic configuration
export JAF_MEMORY_TYPE=mem0
export JAF_MEM0_API_KEY=your-api-key
export JAF_MEM0_BASE_URL=https://api.mem0.ai
export JAF_MEM0_TIMEOUT=30000
export JAF_MEM0_MAX_RETRIES=3
```

```typescript
// Use environment-based factory
import { createMemoryProviderFromEnv } from '@xynehq/jaf';

const provider = await createMemoryProviderFromEnv({ 
  mem0: mem0Client 
});
```

## Architecture

### Dual Memory System
The Mem0 provider implements a hybrid approach:

1. **Semantic Memory (Mem0 API)**: Stores extractable insights and knowledge
   - User preferences and context
   - Key facts and relationships
   - Searchable with natural language queries

2. **Conversation Cache (In-Memory)**: Stores full conversation history
   - Complete message sequences
   - Standard JAF MemoryProvider operations
   - Fast retrieval for recent conversations

### Real-Time Memory Extraction
When messages are stored, the provider:
1. Stores full conversation in local cache
2. Extracts semantic content automatically
3. Sends insights to Mem0 for semantic storage
4. Associates metadata (conversation ID, user ID, timestamps)

## API Compatibility

### Real MemoryClient Integration
The provider works with the actual `mem0ai` package:

```typescript
// Correct method signatures
client.search(query: string, options?: SearchOptions): Promise<Memory[]>
client.add(messages: Message[], options?: MemoryOptions): Promise<Memory[]>
client.ping(): Promise<void>
```

### Type Safety
All interactions are fully typed with TypeScript interfaces matching the real API:

```typescript
interface Mem0Memory {
  id: string;
  memory?: string;
  score?: number;
  metadata?: any;
}

interface MemoryResponse {
  user_email: string;
  query: string;
  total_results: number;
  memories: MemoryItem[];
  search_time_ms: number;
  search_time_seconds: number;
}
```

## Error Handling & Resilience

### Comprehensive Error Management
- **Connection Errors**: Automatic retry with exponential backoff
- **API Timeouts**: Configurable timeout with graceful degradation
- **Rate Limiting**: Built-in retry logic for rate limit responses
- **Partial Failures**: Semantic memory failures don't break conversation storage

### Graceful Degradation
```typescript
// If Mem0 API fails, conversation storage continues working
const result = await provider.storeMessages(id, messages, { userId });
// ✅ Always succeeds - stores in local cache
// ⚠️  May warn if Mem0 semantic extraction fails
```

## Performance Characteristics

- **Search Latency**: ~100-500ms for semantic queries
- **Storage Latency**: ~200-800ms for memory extraction
- **Local Cache**: ~1-5ms for conversation retrieval
- **Concurrent Operations**: Thread-safe with async/await patterns

## Use Cases & Applications

### AI-Powered Customer Support
```typescript
// Store customer interaction
await provider.storeMessages(ticketId, conversation, { 
  userId: customer.email 
});

// Search for related customer context
const context = await provider.searchMemory(
  "previous issues billing", 
  customer.email
);
```

### Personalized Learning Systems
```typescript
// Track learning progress
await provider.addToMemory(
  "Completed advanced React hooks tutorial with 95% score",
  student.id,
  "Focus on skill progression and learning milestones"
);

// Adaptive content recommendation
const knowledge = await provider.searchMemory(
  "React skills completed", 
  student.id
);
```

### Contextual AI Assistants
```typescript
// Remember user preferences across sessions
await provider.addToMemory(
  "Prefers concise explanations, works in fintech, uses TypeScript",
  user.id,
  "Tailor communication style and technical examples"
);

// Provide contextualized responses
const userContext = await provider.searchMemory(
  "communication preferences", 
  user.id
);
```