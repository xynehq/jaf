# JAF ADK Session Providers

Production-ready session providers for the JAF ADK (Agent Development Kit) layer.

## Overview

Session providers handle persistent storage of agent conversations and artifacts. JAF includes three implementations:

1. **In-Memory Provider** - For development and testing
2. **Redis Provider** - For distributed, high-performance scenarios
3. **PostgreSQL Provider** - For persistent, queryable storage

## Installation

### Redis Provider

```bash
npm install ioredis
```

### PostgreSQL Provider

```bash
npm install pg
```

## Usage

### In-Memory Provider

Always available, no dependencies required:

```typescript
import { createInMemorySessionProvider } from '@xynehq/jaf/adk';

const provider = createInMemorySessionProvider();
```

### Redis Provider

Requires `ioredis` to be installed. Will throw an error if the library is not available:

```typescript
import { createRedisSessionProvider } from '@xynehq/jaf/adk';

const provider = createRedisSessionProvider({
  host: 'localhost',
  port: 6379,
  password: 'optional',
  database: 0,
  keyPrefix: 'myapp:sessions:',
  ttl: 86400 // 24 hours in seconds
});
```

### PostgreSQL Provider

Requires `pg` to be installed. Will throw an error if the library is not available:

```typescript
import { createPostgresSessionProvider } from '@xynehq/jaf/adk';

const provider = createPostgresSessionProvider({
  connectionString: 'postgresql://user:password@localhost/dbname',
  tableName: 'sessions', // optional, defaults to 'jaf_sessions'
  poolSize: 10,         // optional, defaults to 10
  idleTimeoutMillis: 30000,     // optional
  connectionTimeoutMillis: 2000  // optional
});
```

## Features

### Common Features

All providers implement the `SessionProvider` interface:

```typescript
interface SessionProvider {
  createSession(context: SessionContext): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  updateSession(session: Session): Promise<Session>;
  listSessions(userId: string): Promise<Session[]>;
  deleteSession(sessionId: string): Promise<boolean>;
}
```

### Redis-Specific Features

- **TTL Support**: Sessions automatically expire after the configured TTL
- **Atomic Operations**: Uses Redis MULTI for atomic updates
- **Set-based User Sessions**: Efficient user session listing
- **Connection Pooling**: Built-in connection retry and pooling
- **Event Handling**: Connection events for monitoring

### PostgreSQL-Specific Features

- **Automatic Schema Creation**: Tables and indexes created on first use
- **JSONB Storage**: Flexible storage for messages and artifacts
- **Transaction Support**: ACID compliance for data integrity
- **Connection Pooling**: Configurable pool size and timeouts
- **Migration Helper**: Utility to migrate from Redis to PostgreSQL

## Error Handling

Both Redis and PostgreSQL providers will throw errors if their respective libraries are not installed:

```typescript
try {
  const provider = createRedisSessionProvider({ ... });
} catch (error) {
  // Error: Redis session provider requires ioredis to be installed. 
  // Please install it with: npm install ioredis
}
```

## Testing

The session providers include comprehensive test suites:

```bash
# Run all session provider tests
npm test -- src/adk/sessions/__tests__/

# Run specific provider tests
npm test -- src/adk/sessions/__tests__/redis-provider.test.ts
npm test -- src/adk/sessions/__tests__/postgres-provider.test.ts
```

Tests will automatically skip database-specific tests if the required libraries are not installed.

## Migration

### Migrating from Redis to PostgreSQL

```typescript
import { 
  createRedisSessionProvider,
  createPostgresSessionProvider,
  migrateFromRedisToPostgres 
} from '@xynehq/jaf/adk';

const redisProvider = createRedisSessionProvider({ ... });
const pgProvider = createPostgresSessionProvider({ ... });

const userIds = ['user1', 'user2', 'user3'];
const { migrated, errors } = await migrateFromRedisToPostgres(
  redisProvider,
  pgProvider,
  userIds
);

console.log(`Migrated ${migrated} sessions`);
if (errors.length > 0) {
  console.error('Migration errors:', errors);
}
```

## Best Practices

1. **Choose the Right Provider**:
   - Use In-Memory for development and testing
   - Use Redis for high-performance, distributed scenarios
   - Use PostgreSQL for long-term storage and complex queries

2. **Handle Connection Errors**:
   - Always wrap provider creation in try-catch blocks
   - Implement proper error handling for session operations

3. **Configure TTL Appropriately**:
   - Redis sessions expire by default after 24 hours
   - Adjust TTL based on your application's needs

4. **Monitor Connections**:
   - Both Redis and PostgreSQL providers emit connection events
   - Use these for monitoring and alerting

## Architecture Notes

All session providers follow JAF's functional programming principles:
- No classes - pure functions only
- Immutable state management
- Type-safe interfaces
- Composable operations

The providers are designed to be production-ready with proper:
- Error handling and recovery
- Connection pooling
- Transaction support
- Performance optimization