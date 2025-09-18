import { 
  MemoryProvider, 
  MemoryProviderConfig, 
  InMemoryConfig, 
  RedisConfig, 
  PostgresConfig,
  Mem0Config,
  createMemoryConnectionError
} from './types';
import { createInMemoryProvider } from './providers/in-memory';
import { createRedisProvider } from './providers/redis';
import { createPostgresProvider } from './providers/postgres';
import { createMem0Provider } from './providers/mem0';

/**
 * Create a memory provider from configuration
 */
export async function createMemoryProvider(
  config: MemoryProviderConfig,
  externalClients?: {
    redis?: any; // Redis client instance
    postgres?: any; // PostgreSQL client instance
    mem0?: any; // Mem0 client instance
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

    case 'mem0':
      if (!externalClients?.mem0) {
        throw createMemoryConnectionError(
          'Mem0',
          new Error('Mem0 client instance required. Please provide a Mem0 client in externalClients.mem0')
        );
      }
      return await createMem0Provider(config as Mem0Config, externalClients.mem0);

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
    mem0?: any;
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

    case 'mem0':
      if (!externalClients?.mem0) {
        throw createMemoryConnectionError(
          'Mem0',
          new Error('Mem0 client required for Mem0 memory provider')
        );
      }
      return await createMem0Provider({
        type: 'mem0',
        apiKey: process.env.JAF_MEM0_API_KEY!,
        projectId: process.env.JAF_MEM0_PROJECT_ID,
        baseUrl: process.env.JAF_MEM0_BASE_URL || 'https://api.mem0.ai',
        timeout: parseInt(process.env.JAF_MEM0_TIMEOUT || '30000'),
        maxRetries: parseInt(process.env.JAF_MEM0_MAX_RETRIES || '3')
      }, externalClients.mem0);

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
  type: 'mem0',
  mem0Client: any,
  config?: Partial<Mem0Config>
): Promise<MemoryProvider>;
export async function createSimpleMemoryProvider(
  type: 'memory' | 'redis' | 'postgres' | 'mem0',
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

    case 'mem0':
      if (!client) {
        throw new Error('Mem0 client required for Mem0 memory provider');
      }
      return await createMem0Provider({ type: 'mem0', ...config }, client);

    default:
      throw new Error(`Unknown memory provider type: ${type}`);
  }
}