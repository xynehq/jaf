import { 
  MemoryProvider, 
  MemoryProviderConfig, 
  InMemoryConfig, 
  RedisConfig, 
  PostgresConfig,
  createMemoryConnectionError
} from './types';
import { createInMemoryProvider } from './providers/in-memory';
import { createRedisProvider } from './providers/redis';
import { createPostgresProvider } from './providers/postgres';

/**
 * Create a memory provider from configuration
 */
export async function createMemoryProvider(
  config: MemoryProviderConfig,
  externalClients?: {
    redis?: any; // Redis client instance
    postgres?: any; // PostgreSQL client instance
  }
): Promise<MemoryProvider> {
  switch (config.type) {
    case 'memory':
      return createInMemoryProvider(config as InMemoryConfig);

    case 'redis':
      if (!externalClients?.redis) {
        throw createMemoryConnectionError(
          'Redis', 
          new Error('Redis client instance required. Please provide a Redis client in externalClients.redis')
        );
      }
      return await createRedisProvider(config as RedisConfig, externalClients.redis);

    case 'postgres':
      if (!externalClients?.postgres) {
        throw createMemoryConnectionError(
          'PostgreSQL',
          new Error('PostgreSQL client instance required. Please provide a PostgreSQL client in externalClients.postgres')
        );
      }
      return await createPostgresProvider(config as PostgresConfig, externalClients.postgres);

    default:
      throw new Error(`Unknown memory provider type: ${(config as any).type}`);
  }
}

/**
 * Create provider from environment variables
 */
export async function createMemoryProviderFromEnv(
  externalClients?: {
    redis?: any;
    postgres?: any;
  }
): Promise<MemoryProvider> {
  const memoryType = process.env.JAF_MEMORY_TYPE || 'memory';

  switch (memoryType) {
    case 'memory':
      return createInMemoryProvider({
        type: 'memory',
        maxConversations: parseInt(process.env.JAF_MEMORY_MAX_CONVERSATIONS || '1000'),
        maxMessagesPerConversation: parseInt(process.env.JAF_MEMORY_MAX_MESSAGES || '1000')
      });

    case 'redis':
      if (!externalClients?.redis) {
        throw createMemoryConnectionError(
          'Redis',
          new Error('Redis client required for Redis memory provider')
        );
      }
      return await createRedisProvider({
        type: 'redis',
        host: process.env.JAF_REDIS_HOST || 'localhost',
        port: parseInt(process.env.JAF_REDIS_PORT || '6379'),
        password: process.env.JAF_REDIS_PASSWORD,
        db: parseInt(process.env.JAF_REDIS_DB || '0'),
        keyPrefix: process.env.JAF_REDIS_PREFIX || 'jaf:memory:',
        ttl: process.env.JAF_REDIS_TTL ? parseInt(process.env.JAF_REDIS_TTL) : undefined
      }, externalClients.redis);

    case 'postgres':
      if (!externalClients?.postgres) {
        throw createMemoryConnectionError(
          'PostgreSQL',
          new Error('PostgreSQL client required for PostgreSQL memory provider')
        );
      }
      return await createPostgresProvider({
        type: 'postgres',
        host: process.env.JAF_POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.JAF_POSTGRES_PORT || '5432'),
        database: process.env.JAF_POSTGRES_DB || 'jaf_memory',
        username: process.env.JAF_POSTGRES_USER || 'postgres',
        password: process.env.JAF_POSTGRES_PASSWORD,
        ssl: process.env.JAF_POSTGRES_SSL === 'true',
        tableName: process.env.JAF_POSTGRES_TABLE || 'conversations',
        maxConnections: parseInt(process.env.JAF_POSTGRES_MAX_CONNECTIONS || '10')
      }, externalClients.postgres);

    default:
      throw new Error(`Unknown memory provider type: ${memoryType}`);
  }
}

/**
 * Helper function to create memory provider with sensible defaults
 */
export async function createSimpleMemoryProvider(
  type: 'memory'
): Promise<MemoryProvider>;
export async function createSimpleMemoryProvider(
  type: 'redis',
  redisClient: any,
  config?: Partial<RedisConfig>
): Promise<MemoryProvider>;
export async function createSimpleMemoryProvider(
  type: 'postgres',
  postgresClient: any,
  config?: Partial<PostgresConfig>
): Promise<MemoryProvider>;
export async function createSimpleMemoryProvider(
  type: 'memory' | 'redis' | 'postgres',
  client?: any,
  config?: any
): Promise<MemoryProvider> {
  switch (type) {
    case 'memory':
      return createInMemoryProvider({ type: 'memory', ...config });

    case 'redis':
      if (!client) {
        throw new Error('Redis client required for Redis memory provider');
      }
      return await createRedisProvider({ type: 'redis', ...config }, client);

    case 'postgres':
      if (!client) {
        throw new Error('PostgreSQL client required for PostgreSQL memory provider');
      }
      return await createPostgresProvider({ type: 'postgres', ...config }, client);

    default:
      throw new Error(`Unknown memory provider type: ${type}`);
  }
}