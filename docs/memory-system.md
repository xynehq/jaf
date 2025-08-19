# JAF Memory System Documentation

The Juspay Agent Framework (JAF) provides a comprehensive memory system for persisting and managing conversation history across agent interactions. This document covers the memory provider architecture, configuration options, and best practices.

## Table of Contents

- [Overview](#overview)
- [Memory Provider Architecture](#memory-provider-architecture)
- [Memory Providers](#memory-providers)
  - [In-Memory Provider](#in-memory-provider)
  - [Redis Provider](#redis-provider)  
  - [PostgreSQL Provider](#postgresql-provider)
- [Configuration](#configuration)
- [Usage Examples](#usage-examples)
- [Auto-Store Functionality](#auto-store-functionality)
- [Error Handling](#error-handling)
- [Performance and Best Practices](#performance-and-best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

The JAF memory system enables agents to maintain conversation context across multiple interactions. It supports three storage backends:

- **In-Memory**: Fast, non-persistent storage for development and testing
- **Redis**: High-performance caching for production environments
- **PostgreSQL**: Full persistence with advanced querying capabilities

All providers implement the same `MemoryProvider` interface, ensuring consistent behavior regardless of the underlying storage mechanism.

## Memory Provider Architecture

### Core Types

```typescript
interface ConversationMemory {
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

interface MemoryProvider {
  // Store complete conversation
  readonly storeMessages: (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { userId?: string; traceId?: TraceId; [key: string]: any }
  ) => Promise<Result<void>>;

  // Retrieve conversation history
  readonly getConversation: (conversationId: string) => Promise<Result<ConversationMemory | null>>;

  // Append new messages to existing conversation
  readonly appendMessages: (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { traceId?: TraceId; [key: string]: any }
  ) => Promise<Result<void>>;

  // Search conversations
  readonly findConversations: (query: MemoryQuery) => Promise<Result<ConversationMemory[]>>;

  // Get recent messages
  readonly getRecentMessages: (
    conversationId: string,
    limit?: number
  ) => Promise<Result<readonly Message[]>>;

  // Management operations
  readonly deleteConversation: (conversationId: string) => Promise<Result<boolean>>;
  readonly clearUserConversations: (userId: string) => Promise<Result<number>>;
  readonly getStats: (userId?: string) => Promise<Result<MemoryStats>>;
  readonly healthCheck: () => Promise<Result<HealthStatus>>;
  readonly close: () => Promise<Result<void>>;
}
```

### Functional Error Handling

The memory system uses functional error handling with `Result<T, E>` types:

```typescript
type Result<T, E = MemoryErrorUnion> = 
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };
```

Error types include:
- `MemoryConnectionError`: Connection failures
- `MemoryNotFoundError`: Conversation not found
- `MemoryStorageError`: Storage operation failures

## Memory Providers

### In-Memory Provider

**Best for**: Development, testing, temporary conversations

**Characteristics**:
- No persistence across server restarts
- Extremely fast read/write operations (<1ms)
- Automatic memory management with configurable limits
- Zero external dependencies

#### Configuration

```typescript
import { createInMemoryProvider } from '@xynehq/jaf';

const provider = createInMemoryProvider({
  type: 'memory',
  maxConversations: 1000,        // Maximum conversations to keep
  maxMessagesPerConversation: 1000  // Maximum messages per conversation
});
```

#### Environment Variables

```bash
JAF_MEMORY_TYPE=memory
JAF_MEMORY_MAX_CONVERSATIONS=1000
JAF_MEMORY_MAX_MESSAGES=1000
```

#### Memory Management

The in-memory provider automatically manages memory limits:

1. **Conversation Limit**: When `maxConversations` is exceeded, oldest conversations (by last activity) are removed
2. **Message Limit**: When `maxMessagesPerConversation` is exceeded during append operations, oldest messages are trimmed
3. **Activity Tracking**: Conversations are sorted by `lastActivity` for eviction purposes

### Redis Provider

**Best for**: Production environments requiring high-performance caching with persistence

**Characteristics**:
- Full persistence across server restarts
- Fast read/write operations (~2-3ms)
- TTL support for automatic cleanup
- Horizontal scaling support
- JSON serialization for complex data structures

#### Prerequisites

```bash
# Using Docker (recommended)
docker run -d --name jaf-redis -p 6379:6379 redis:alpine

# Or local installation
brew install redis && brew services start redis  # macOS
sudo apt install redis-server && sudo systemctl start redis-server  # Ubuntu
```

#### Configuration

```typescript
import { createRedisProvider } from '@xynehq/jaf';
import { createClient } from 'redis';

// Create Redis client
const redisClient = createClient({
  url: 'redis://localhost:6379',
  password: 'your-password',  // if authentication is enabled
  database: 0
});
await redisClient.connect();

// Create memory provider
const provider = await createRedisProvider({
  type: 'redis',
  host: 'localhost',
  port: 6379,
  password: 'your-password',
  db: 0,
  keyPrefix: 'jaf:memory:',
  ttl: 7200  // 2 hours TTL (optional)
}, redisClient);
```

#### Environment Variables

```bash
JAF_MEMORY_TYPE=redis
JAF_REDIS_HOST=localhost
JAF_REDIS_PORT=6379
JAF_REDIS_PASSWORD=your-password
JAF_REDIS_DB=0
JAF_REDIS_PREFIX=jaf:memory:
JAF_REDIS_TTL=7200  # Optional TTL in seconds
```

#### Key Management

Redis keys follow the pattern: `${keyPrefix}${conversationId}`

- Conversations are stored as JSON strings
- TTL is automatically refreshed on conversation access
- User-specific operations use pattern matching: `${keyPrefix}user:${userId}:*`

#### Redis Client Compatibility

The Redis provider supports multiple Redis client libraries:

```typescript
// Compatible with ioredis
import Redis from 'ioredis';
const client = new Redis('redis://localhost:6379');

// Compatible with node-redis
import { createClient } from 'redis';
const client = createClient({ url: 'redis://localhost:6379' });
await client.connect();
```

### PostgreSQL Provider

**Best for**: Production environments requiring full persistence, advanced querying, and analytics

**Characteristics**:
- Full ACID compliance and persistence
- Complex querying capabilities with SQL
- Advanced analytics and reporting features
- Automatic schema initialization
- JSONB support for efficient metadata queries

#### Prerequisites

```bash
# Using Docker (recommended)
docker run -d --name jaf-postgres \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=jaf_memory \
  -p 5432:5432 \
  postgres:15

# Or local installation
brew install postgresql && brew services start postgresql  # macOS
createdb jaf_memory  # macOS

sudo apt install postgresql postgresql-contrib  # Ubuntu
sudo systemctl start postgresql  # Ubuntu
sudo -u postgres createdb jaf_memory  # Ubuntu
```

#### Configuration

```typescript
import { createPostgresProvider } from '@xynehq/jaf';
import { Client } from 'pg';

// Create PostgreSQL client
const postgresClient = new Client({
  host: 'localhost',
  port: 5432,
  database: 'jaf_memory',
  user: 'postgres',
  password: 'testpass',
  ssl: false
});
await postgresClient.connect();

// Create memory provider
const provider = await createPostgresProvider({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'jaf_memory',
  username: 'postgres',
  password: 'testpass',
  ssl: false,
  tableName: 'conversations',
  maxConnections: 10
}, postgresClient);
```

#### Environment Variables

```bash
JAF_MEMORY_TYPE=postgres
JAF_POSTGRES_HOST=localhost
JAF_POSTGRES_PORT=5432
JAF_POSTGRES_DB=jaf_memory
JAF_POSTGRES_USER=postgres
JAF_POSTGRES_PASSWORD=testpass
JAF_POSTGRES_SSL=false
JAF_POSTGRES_TABLE=conversations
JAF_POSTGRES_MAX_CONNECTIONS=10
```

#### Database Schema

The PostgreSQL provider automatically creates the following schema:

```sql
CREATE TABLE conversations (
  conversation_id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255),
  messages JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_conversations_user_id ON conversations (user_id);
CREATE INDEX idx_conversations_created_at ON conversations (created_at);
CREATE INDEX idx_conversations_last_activity ON conversations (last_activity);
CREATE INDEX idx_conversations_metadata_gin ON conversations USING GIN (metadata);
CREATE INDEX idx_conversations_trace_id ON conversations ((metadata->>'traceId'));
```

#### Advanced Features

The PostgreSQL provider includes additional methods for production use:

```typescript
// Cleanup old conversations
const deletedCount = await provider.cleanupOldConversations(30); // 30 days

// Get analytics
const analytics = await provider.getAnalytics('user123');
// Returns: averageMessagesPerConversation, conversationsLastWeek, etc.
```

## Configuration

### Factory Functions

#### Create from Configuration Object

```typescript
import { createMemoryProvider } from '@xynehq/jaf';

const provider = await createMemoryProvider(
  {
    type: 'redis',
    host: 'localhost',
    port: 6379,
    keyPrefix: 'myapp:memory:'
  },
  {
    redis: redisClient  // Required for Redis
    // postgres: postgresClient  // Required for PostgreSQL
  }
);
```

#### Create from Environment Variables

```typescript
import { createMemoryProviderFromEnv } from '@xynehq/jaf';

const provider = await createMemoryProviderFromEnv({
  redis: redisClient,  // Only needed if JAF_MEMORY_TYPE=redis
  postgres: postgresClient  // Only needed if JAF_MEMORY_TYPE=postgres
});
```

#### Simple Provider Creation

```typescript
import { createSimpleMemoryProvider } from '@xynehq/jaf';

// In-memory
const memoryProvider = await createSimpleMemoryProvider('memory');

// Redis with defaults
const redisProvider = await createSimpleMemoryProvider('redis', redisClient);

// PostgreSQL with custom config
const postgresProvider = await createSimpleMemoryProvider('postgres', postgresClient, {
  tableName: 'custom_conversations',
  maxConnections: 20
});
```

### Memory Configuration in Engine

```typescript
import { runServer } from '@xynehq/jaf';

const server = await runServer(
  agents,
  {
    modelProvider,
    memory: {
      provider: memoryProvider,
      autoStore: true,           // Automatically store conversation history
      maxMessages: 100,          // Keep last 100 messages per conversation
      ttl: 3600,                // TTL in seconds (provider-dependent)
      compressionThreshold: 50   // Compress conversations after 50 messages
    }
  },
  {
    port: 3000,
    defaultMemoryProvider: memoryProvider
  }
);
```

## Usage Examples

### Basic Conversation Management

```typescript
// Store initial conversation
const storeResult = await provider.storeMessages(
  'conv-123',
  [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' }
  ],
  { userId: 'user-456', traceId: 'trace-789' }
);

if (!storeResult.success) {
  console.error('Failed to store:', storeResult.error);
  return;
}

// Retrieve conversation
const getResult = await provider.getConversation('conv-123');
if (getResult.success && getResult.data) {
  console.log(`Found ${getResult.data.messages.length} messages`);
  console.log(`Last activity: ${getResult.data.metadata?.lastActivity}`);
}

// Append new messages
const appendResult = await provider.appendMessages(
  'conv-123',
  [{ role: 'user', content: 'How are you?' }],
  { traceId: 'trace-790' }
);
```

### Conversation Search

```typescript
// Find conversations by user
const userConversations = await provider.findConversations({
  userId: 'user-456',
  limit: 10,
  offset: 0
});

// Find conversations by date range
const recentConversations = await provider.findConversations({
  since: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
  limit: 20
});

// Find conversations by trace ID
const traceConversations = await provider.findConversations({
  traceId: 'trace-789'
});
```

### Memory Management

```typescript
// Get recent messages only
const recentMessages = await provider.getRecentMessages('conv-123', 10);

// Get conversation statistics
const stats = await provider.getStats('user-456');
if (stats.success) {
  console.log(`Total conversations: ${stats.data.totalConversations}`);
  console.log(`Total messages: ${stats.data.totalMessages}`);
  console.log(`Oldest conversation: ${stats.data.oldestConversation}`);
}

// Health check
const health = await provider.healthCheck();
if (health.success) {
  console.log(`Provider healthy: ${health.data.healthy}`);
  console.log(`Latency: ${health.data.latencyMs}ms`);
}

// Cleanup
const deleted = await provider.deleteConversation('conv-123');
const userDeleted = await provider.clearUserConversations('user-456');
```

## Auto-Store Functionality

The JAF engine can automatically manage conversation persistence when `autoStore` is enabled:

```typescript
const runConfig = {
  memory: {
    provider: memoryProvider,
    autoStore: true,
    maxMessages: 100
  },
  conversationId: 'conv-123'
};

// The engine will:
// 1. Load existing conversation history before processing
// 2. Append new messages after successful completion
// 3. Respect maxMessages limit during storage
```

### Auto-Store Behavior

1. **Load Phase**: Before agent execution, existing conversation history is loaded and merged with incoming messages
2. **Process Phase**: Agent processes the complete conversation history
3. **Store Phase**: After successful completion, new messages are appended to the conversation
4. **Error Handling**: Failed conversations are not stored to prevent corruption

### Memory Limits and Compression

```typescript
const config = {
  memory: {
    provider: memoryProvider,
    autoStore: true,
    maxMessages: 100,           // Trim to last 100 messages
    compressionThreshold: 50    // Future: compress after 50 messages
  }
};
```

## Error Handling

### Functional Error Types

```typescript
import { 
  isMemoryConnectionError,
  isMemoryNotFoundError,
  isMemoryStorageError 
} from '@xynehq/jaf';

const result = await provider.getConversation('conv-123');

if (!result.success) {
  if (isMemoryConnectionError(result.error)) {
    console.error('Connection failed:', result.error.provider);
    // Retry logic or fallback to different provider
  } else if (isMemoryNotFoundError(result.error)) {
    console.log('Conversation not found, starting new conversation');
    // Initialize new conversation
  } else if (isMemoryStorageError(result.error)) {
    console.error('Storage operation failed:', result.error.operation);
    // Log error and potentially retry
  }
}
```

### Error Recovery Patterns

```typescript
// Retry with exponential backoff
async function storeWithRetry(
  conversationId: string, 
  messages: Message[], 
  maxRetries = 3
): Promise<Result<void>> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await provider.storeMessages(conversationId, messages);
    
    if (result.success) {
      return result;
    }
    
    if (isMemoryConnectionError(result.error)) {
      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    
    // Non-retryable error
    return result;
  }
  
  return createFailure(createMemoryStorageError('store messages', 'Retry exhausted'));
}

// Graceful degradation
async function getConversationWithFallback(
  conversationId: string
): Promise<Message[]> {
  const result = await provider.getConversation(conversationId);
  
  if (result.success && result.data) {
    return result.data.messages;
  }
  
  console.warn('Failed to load conversation history, starting fresh');
  return [];
}
```

## Performance and Best Practices

### Provider Selection Guidelines

| Use Case | Recommended Provider | Rationale |
|----------|---------------------|-----------|
| Development/Testing | In-Memory | Zero setup, fast iteration |
| Production (Stateless) | Redis | High performance, simple deployment |
| Production (Analytics) | PostgreSQL | Advanced querying, full ACID compliance |
| Multi-tenant SaaS | PostgreSQL | User isolation, reporting capabilities |
| Microservices | Redis | Shared state across services |

### Performance Optimization

#### In-Memory Provider
```typescript
// Optimize for high-frequency access
const provider = createInMemoryProvider({
  type: 'memory',
  maxConversations: 10000,      // Higher limit for busy servers
  maxMessagesPerConversation: 200  // Reasonable message history
});
```

#### Redis Provider
```typescript
// Optimize for production workloads
const provider = await createRedisProvider({
  type: 'redis',
  host: 'redis-cluster.internal',
  port: 6379,
  keyPrefix: 'prod:jaf:memory:',
  ttl: 86400  // 24 hour TTL to prevent memory bloat
}, redisClient);

// Use Redis clustering for high availability
const redisClient = createClient({
  cluster: {
    enableAutoPipelining: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 3
  }
});
```

#### PostgreSQL Provider
```typescript
// Optimize for analytical workloads
const provider = await createPostgresProvider({
  type: 'postgres',
  host: 'postgres-primary.internal',
  port: 5432,
  database: 'jaf_memory_prod',
  username: 'jaf_user',
  ssl: true,
  tableName: 'conversations',
  maxConnections: 20  // Connection pooling
}, postgresClient);

// Regular maintenance
setInterval(async () => {
  // Cleanup conversations older than 90 days
  await provider.cleanupOldConversations(90);
}, 24 * 60 * 60 * 1000); // Daily cleanup
```

### Memory Usage Patterns

#### Conversation Lifecycle Management
```typescript
// Start conversation
const conversationId = `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Use conversation with auto-store
const result = await run(initialState, {
  memory: { provider, autoStore: true },
  conversationId,
  maxTurns: 10
});

// Archive long conversations
const conversation = await provider.getConversation(conversationId);
if (conversation.success && conversation.data?.messages.length > 500) {
  // Archive to long-term storage and clear from active memory
  await archiveConversation(conversation.data);
  await provider.deleteConversation(conversationId);
}
```

#### Batch Operations
```typescript
// Efficient user cleanup
async function cleanupUserData(userId: string): Promise<void> {
  const conversations = await provider.findConversations({ userId });
  
  if (conversations.success) {
    // Archive before deletion
    await Promise.all(
      conversations.data.map(conv => archiveConversation(conv))
    );
    
    // Bulk delete
    await provider.clearUserConversations(userId);
  }
}
```

### Monitoring and Observability

```typescript
// Health monitoring
setInterval(async () => {
  const health = await provider.healthCheck();
  
  if (health.success) {
    console.log(`Memory provider health: ${health.data.healthy}, latency: ${health.data.latencyMs}ms`);
    
    // Alert on high latency
    if (health.data.latencyMs && health.data.latencyMs > 1000) {
      console.warn('High memory provider latency detected');
    }
  } else {
    console.error('Memory provider health check failed');
  }
}, 30000); // Every 30 seconds

// Usage statistics
setInterval(async () => {
  const stats = await provider.getStats();
  
  if (stats.success) {
    console.log(`Memory usage: ${stats.data.totalConversations} conversations, ${stats.data.totalMessages} messages`);
  }
}, 300000); // Every 5 minutes
```

## Troubleshooting

### Common Issues

#### In-Memory Provider

**Issue**: Conversations disappearing unexpectedly
```typescript
// Check memory limits
const provider = createInMemoryProvider({
  type: 'memory',
  maxConversations: 10000,  // Increase if needed
  maxMessagesPerConversation: 1000
});

// Monitor evictions
provider.on('conversation_evicted', (conversationId) => {
  console.warn(`Conversation ${conversationId} evicted due to memory limits`);
});
```

#### Redis Provider

**Issue**: Connection timeouts
```bash
# Check Redis connectivity
redis-cli -h localhost -p 6379 ping
# Expected: PONG

# Check Redis memory usage
redis-cli -h localhost -p 6379 info memory

# Monitor Redis logs
docker logs jaf-redis -f
```

**Issue**: Authentication failures
```typescript
const redisClient = createClient({
  url: 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD,
  retry_unfulfilled_commands: true,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
  }
});
```

#### PostgreSQL Provider

**Issue**: Connection pool exhaustion
```typescript
// Monitor connection usage
const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'jaf_memory',
  user: 'postgres',
  password: 'testpass',
  max: 20,  // Maximum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});
```

**Issue**: Schema initialization failures
```sql
-- Manually verify schema
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'conversations';

-- Check indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'conversations';
```

### Debugging Tools

#### Memory Provider Diagnostics
```typescript
async function diagnoseMemoryProvider(provider: MemoryProvider): Promise<void> {
  console.log('=== Memory Provider Diagnostics ===');
  
  // Health check
  const health = await provider.healthCheck();
  console.log('Health:', health);
  
  // Statistics
  const stats = await provider.getStats();
  console.log('Stats:', stats);
  
  // Test basic operations
  const testId = `test-${Date.now()}`;
  
  try {
    // Test store
    const storeResult = await provider.storeMessages(testId, [
      { role: 'user', content: 'test message' }
    ]);
    console.log('Store test:', storeResult.success ? '✅' : '❌', storeResult);
    
    // Test retrieve
    const getResult = await provider.getConversation(testId);
    console.log('Get test:', getResult.success ? '✅' : '❌', getResult);
    
    // Test append
    const appendResult = await provider.appendMessages(testId, [
      { role: 'assistant', content: 'test response' }
    ]);
    console.log('Append test:', appendResult.success ? '✅' : '❌', appendResult);
    
    // Cleanup
    await provider.deleteConversation(testId);
    
  } catch (error) {
    console.error('Diagnostic error:', error);
  }
}
```

#### Environment Validation
```typescript
function validateMemoryEnvironment(): void {
  const memoryType = process.env.JAF_MEMORY_TYPE || 'memory';
  
  console.log(`Memory type: ${memoryType}`);
  
  switch (memoryType) {
    case 'redis':
      const requiredRedisVars = ['JAF_REDIS_HOST', 'JAF_REDIS_PORT'];
      requiredRedisVars.forEach(varName => {
        if (!process.env[varName]) {
          console.warn(`Missing environment variable: ${varName}`);
        }
      });
      break;
      
    case 'postgres':
      const requiredPgVars = ['JAF_POSTGRES_HOST', 'JAF_POSTGRES_DB', 'JAF_POSTGRES_USER'];
      requiredPgVars.forEach(varName => {
        if (!process.env[varName]) {
          console.warn(`Missing environment variable: ${varName}`);
        }
      });
      break;
  }
}
```

### Performance Monitoring

```typescript
// Measure memory operation latency
class MemoryPerformanceMonitor {
  private metrics = new Map<string, number[]>();
  
  async measureOperation<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = process.hrtime.bigint();
    
    try {
      const result = await fn();
      return result;
    } finally {
      const end = process.hrtime.bigint();
      const latencyMs = Number(end - start) / 1_000_000;
      
      if (!this.metrics.has(operation)) {
        this.metrics.set(operation, []);
      }
      
      this.metrics.get(operation)!.push(latencyMs);
      
      // Keep only last 100 measurements
      const measurements = this.metrics.get(operation)!;
      if (measurements.length > 100) {
        measurements.shift();
      }
    }
  }
  
  getStats(operation: string) {
    const measurements = this.metrics.get(operation) || [];
    if (measurements.length === 0) return null;
    
    const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length;
    const max = Math.max(...measurements);
    const min = Math.min(...measurements);
    
    return { avg, max, min, count: measurements.length };
  }
}

// Usage
const monitor = new MemoryPerformanceMonitor();

const result = await monitor.measureOperation('getConversation', async () => {
  return provider.getConversation('conv-123');
});

console.log('Performance stats:', monitor.getStats('getConversation'));
```

---

This comprehensive memory system enables robust conversation management across development and production environments, with the flexibility to choose the appropriate storage backend based on your specific requirements.