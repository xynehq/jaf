/**
 * A2A Task Provider Factory for FAF
 * Pure functional factory for creating A2A task providers
 */

import { 
  A2ATaskProvider, 
  A2ATaskProviderConfig, 
  A2AInMemoryTaskConfig, 
  A2ARedisTaskConfig, 
  A2APostgresTaskConfig,
  createA2ATaskStorageError
} from './types.js';
import { createA2AInMemoryTaskProvider } from './providers/in-memory.js';
import { createA2ARedisTaskProvider } from './providers/redis.js';
import { createA2APostgresTaskProvider } from './providers/postgres.js';

/**
 * Create an A2A task provider from configuration
 */
export const createA2ATaskProvider = async (
  config: A2ATaskProviderConfig,
  externalClients?: {
    redis?: any; // Redis client instance
    postgres?: any; // PostgreSQL client instance
  }
): Promise<A2ATaskProvider> => {
  switch (config.type) {
    case 'memory':
      return createA2AInMemoryTaskProvider(config as A2AInMemoryTaskConfig);

    case 'redis':
      if (!externalClients?.redis) {
        throw createA2ATaskStorageError(
          'create-provider',
          'redis',
          undefined,
          new Error('Redis client instance required. Please provide a Redis client in externalClients.redis')
        );
      }
      return await createA2ARedisTaskProvider(config as A2ARedisTaskConfig, externalClients.redis);

    case 'postgres':
      if (!externalClients?.postgres) {
        throw createA2ATaskStorageError(
          'create-provider',
          'postgres',
          undefined,
          new Error('PostgreSQL client instance required. Please provide a PostgreSQL client in externalClients.postgres')
        );
      }
      return await createA2APostgresTaskProvider(config as A2APostgresTaskConfig, externalClients.postgres);

    default:
      throw new Error(`Unknown A2A task provider type: ${(config as any).type}`);
  }
};

/**
 * Create A2A task provider from environment variables
 */
export const createA2ATaskProviderFromEnv = async (
  externalClients?: {
    redis?: any;
    postgres?: any;
  }
): Promise<A2ATaskProvider> => {
  const taskMemoryType = process.env.FAF_A2A_MEMORY_TYPE || 'memory';

  switch (taskMemoryType) {
    case 'memory':
      return createA2AInMemoryTaskProvider({
        type: 'memory',
        keyPrefix: process.env.FAF_A2A_KEY_PREFIX || 'faf:a2a:tasks:',
        defaultTtl: process.env.FAF_A2A_DEFAULT_TTL ? parseInt(process.env.FAF_A2A_DEFAULT_TTL) : undefined,
        cleanupInterval: parseInt(process.env.FAF_A2A_CLEANUP_INTERVAL || '3600'),
        maxTasks: parseInt(process.env.FAF_A2A_MAX_TASKS || '10000'),
        maxTasksPerContext: parseInt(process.env.FAF_A2A_MAX_TASKS_PER_CONTEXT || '1000'),
        enableHistory: process.env.FAF_A2A_ENABLE_HISTORY !== 'false',
        enableArtifacts: process.env.FAF_A2A_ENABLE_ARTIFACTS !== 'false'
      });

    case 'redis':
      if (!externalClients?.redis) {
        throw createA2ATaskStorageError(
          'create-provider-from-env',
          'redis',
          undefined,
          new Error('Redis client required for Redis A2A task provider')
        );
      }
      return await createA2ARedisTaskProvider({
        type: 'redis',
        keyPrefix: process.env.FAF_A2A_KEY_PREFIX || 'faf:a2a:tasks:',
        defaultTtl: process.env.FAF_A2A_DEFAULT_TTL ? parseInt(process.env.FAF_A2A_DEFAULT_TTL) : undefined,
        cleanupInterval: parseInt(process.env.FAF_A2A_CLEANUP_INTERVAL || '3600'),
        maxTasks: parseInt(process.env.FAF_A2A_MAX_TASKS || '10000'),
        enableHistory: process.env.FAF_A2A_ENABLE_HISTORY !== 'false',
        enableArtifacts: process.env.FAF_A2A_ENABLE_ARTIFACTS !== 'false',
        host: process.env.FAF_A2A_REDIS_HOST || 'localhost',
        port: parseInt(process.env.FAF_A2A_REDIS_PORT || '6379'),
        password: process.env.FAF_A2A_REDIS_PASSWORD,
        db: parseInt(process.env.FAF_A2A_REDIS_DB || '0')
      }, externalClients.redis);

    case 'postgres':
      if (!externalClients?.postgres) {
        throw createA2ATaskStorageError(
          'create-provider-from-env',
          'postgres',
          undefined,
          new Error('PostgreSQL client required for PostgreSQL A2A task provider')
        );
      }
      return await createA2APostgresTaskProvider({
        type: 'postgres',
        keyPrefix: process.env.FAF_A2A_KEY_PREFIX || 'faf:a2a:tasks:',
        defaultTtl: process.env.FAF_A2A_DEFAULT_TTL ? parseInt(process.env.FAF_A2A_DEFAULT_TTL) : undefined,
        cleanupInterval: parseInt(process.env.FAF_A2A_CLEANUP_INTERVAL || '3600'),
        maxTasks: parseInt(process.env.FAF_A2A_MAX_TASKS || '10000'),
        enableHistory: process.env.FAF_A2A_ENABLE_HISTORY !== 'false',
        enableArtifacts: process.env.FAF_A2A_ENABLE_ARTIFACTS !== 'false',
        host: process.env.FAF_A2A_POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.FAF_A2A_POSTGRES_PORT || '5432'),
        database: process.env.FAF_A2A_POSTGRES_DB || 'faf_a2a',
        username: process.env.FAF_A2A_POSTGRES_USER || 'postgres',
        password: process.env.FAF_A2A_POSTGRES_PASSWORD,
        ssl: process.env.FAF_A2A_POSTGRES_SSL === 'true',
        tableName: process.env.FAF_A2A_POSTGRES_TABLE || 'a2a_tasks',
        maxConnections: parseInt(process.env.FAF_A2A_POSTGRES_MAX_CONNECTIONS || '10')
      }, externalClients.postgres);

    default:
      throw new Error(`Unknown A2A task provider type: ${taskMemoryType}`);
  }
};

/**
 * Helper function to create A2A task provider with sensible defaults
 */
export async function createSimpleA2ATaskProvider(
  type: 'memory'
): Promise<A2ATaskProvider>;
export async function createSimpleA2ATaskProvider(
  type: 'redis',
  redisClient: any,
  config?: Partial<A2ARedisTaskConfig>
): Promise<A2ATaskProvider>;
export async function createSimpleA2ATaskProvider(
  type: 'postgres',
  postgresClient: any,
  config?: Partial<A2APostgresTaskConfig>
): Promise<A2ATaskProvider>;
export async function createSimpleA2ATaskProvider(
  type: 'memory' | 'redis' | 'postgres',
  client?: any,
  config?: any
): Promise<A2ATaskProvider> {
  switch (type) {
    case 'memory':
      return createA2AInMemoryTaskProvider({ 
        type: 'memory',
        keyPrefix: 'faf:a2a:tasks:',
        defaultTtl: undefined,
        cleanupInterval: 3600,
        maxTasks: 10000,
        maxTasksPerContext: 1000,
        enableHistory: true,
        enableArtifacts: true,
        ...config 
      });

    case 'redis':
      if (!client) {
        throw new Error('Redis client required for Redis A2A task provider');
      }
      return await createA2ARedisTaskProvider({ 
        type: 'redis',
        keyPrefix: 'faf:a2a:tasks:',
        defaultTtl: undefined,
        cleanupInterval: 3600,
        maxTasks: 10000,
        enableHistory: true,
        enableArtifacts: true,
        host: 'localhost',
        port: 6379,
        password: undefined,
        db: 0,
        ...config 
      }, client);

    case 'postgres':
      if (!client) {
        throw new Error('PostgreSQL client required for PostgreSQL A2A task provider');
      }
      return await createA2APostgresTaskProvider({ 
        type: 'postgres',
        keyPrefix: 'faf:a2a:tasks:',
        defaultTtl: undefined,
        cleanupInterval: 3600,
        maxTasks: 10000,
        enableHistory: true,
        enableArtifacts: true,
        host: 'localhost',
        port: 5432,
        database: 'faf_a2a',
        username: 'postgres',
        password: undefined,
        ssl: false,
        tableName: 'a2a_tasks',
        maxConnections: 10,
        ...config 
      }, client);

    default:
      throw new Error(`Unknown A2A task provider type: ${type}`);
  }
}

/**
 * Create a composite A2A task provider that can use multiple backends
 * Useful for implementing failover or read/write splitting
 */
export const createCompositeA2ATaskProvider = (
  primary: A2ATaskProvider,
  fallback?: A2ATaskProvider
): A2ATaskProvider => {
  return {
    storeTask: async (task, metadata) => {
      const result = await primary.storeTask(task, metadata);
      if (!result.success && fallback) {
        return await fallback.storeTask(task, metadata);
      }
      return result;
    },

    getTask: async (taskId) => {
      const result = await primary.getTask(taskId);
      if (!result.success && fallback) {
        return await fallback.getTask(taskId);
      }
      return result;
    },

    updateTask: async (task, metadata) => {
      const result = await primary.updateTask(task, metadata);
      if (!result.success && fallback) {
        return await fallback.updateTask(task, metadata);
      }
      return result;
    },

    updateTaskStatus: async (taskId, state, statusMessage, timestamp) => {
      const result = await primary.updateTaskStatus(taskId, state, statusMessage, timestamp);
      if (!result.success && fallback) {
        return await fallback.updateTaskStatus(taskId, state, statusMessage, timestamp);
      }
      return result;
    },

    findTasks: async (query) => {
      const result = await primary.findTasks(query);
      if (!result.success && fallback) {
        return await fallback.findTasks(query);
      }
      return result;
    },

    getTasksByContext: async (contextId, limit) => {
      const result = await primary.getTasksByContext(contextId, limit);
      if (!result.success && fallback) {
        return await fallback.getTasksByContext(contextId, limit);
      }
      return result;
    },

    deleteTask: async (taskId) => {
      const result = await primary.deleteTask(taskId);
      // For delete operations, try both providers regardless of success
      if (fallback) {
        await fallback.deleteTask(taskId);
      }
      return result;
    },

    deleteTasksByContext: async (contextId) => {
      const result = await primary.deleteTasksByContext(contextId);
      // For delete operations, try both providers regardless of success
      if (fallback) {
        await fallback.deleteTasksByContext(contextId);
      }
      return result;
    },

    cleanupExpiredTasks: async () => {
      const primaryResult = await primary.cleanupExpiredTasks();
      let totalCleaned = primaryResult.success ? primaryResult.data : 0;

      if (fallback) {
        const fallbackResult = await fallback.cleanupExpiredTasks();
        if (fallbackResult.success) {
          totalCleaned += fallbackResult.data;
        }
      }

      return primaryResult.success 
        ? { success: true, data: totalCleaned } as const
        : primaryResult;
    },

    getTaskStats: async (contextId) => {
      const result = await primary.getTaskStats(contextId);
      if (!result.success && fallback) {
        return await fallback.getTaskStats(contextId);
      }
      return result;
    },

    healthCheck: async () => {
      const primaryHealth = await primary.healthCheck();
      const fallbackHealth = fallback ? await fallback.healthCheck() : { success: true, data: { healthy: true } };

      const isPrimaryHealthy = primaryHealth.success && primaryHealth.data.healthy;
      const isFallbackHealthy = fallbackHealth.success && fallbackHealth.data.healthy;

      return {
        success: true,
        data: {
          healthy: isPrimaryHealthy || isFallbackHealthy,
          latencyMs: primaryHealth.success ? primaryHealth.data.latencyMs : undefined,
          error: isPrimaryHealthy ? undefined : (primaryHealth.success ? primaryHealth.data.error : 'Primary provider failed')
        }
      };
    },

    close: async () => {
      const results = await Promise.allSettled([
        primary.close(),
        fallback ? fallback.close() : Promise.resolve({ success: true, data: undefined })
      ]);

      const primaryResult = results[0];
      if (primaryResult.status === 'fulfilled' && primaryResult.value.success) {
        return primaryResult.value;
      }

      throw new Error('Failed to close composite A2A task provider');
    }
  };
};

/**
 * Pure function to validate A2A task provider configuration
 */
export const validateA2ATaskProviderConfig = (config: A2ATaskProviderConfig): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!config.type) {
    errors.push('Provider type is required');
  } else if (!['memory', 'redis', 'postgres'].includes(config.type)) {
    errors.push(`Invalid provider type: ${config.type}`);
  }

  if (config.maxTasks && config.maxTasks <= 0) {
    errors.push('maxTasks must be greater than 0');
  }

  if (config.cleanupInterval && config.cleanupInterval <= 0) {
    errors.push('cleanupInterval must be greater than 0');
  }

  if (config.defaultTtl && config.defaultTtl <= 0) {
    errors.push('defaultTtl must be greater than 0');
  }

  // Type-specific validation
  switch (config.type) {
    case 'memory':
      const memoryConfig = config as A2AInMemoryTaskConfig;
      if (memoryConfig.maxTasksPerContext && memoryConfig.maxTasksPerContext <= 0) {
        errors.push('maxTasksPerContext must be greater than 0');
      }
      break;

    case 'redis':
      const redisConfig = config as A2ARedisTaskConfig;
      if (redisConfig.port && (redisConfig.port < 1 || redisConfig.port > 65535)) {
        errors.push('Redis port must be between 1 and 65535');
      }
      if (redisConfig.db && redisConfig.db < 0) {
        errors.push('Redis database index must be non-negative');
      }
      break;

    case 'postgres':
      const pgConfig = config as A2APostgresTaskConfig;
      if (pgConfig.port && (pgConfig.port < 1 || pgConfig.port > 65535)) {
        errors.push('PostgreSQL port must be between 1 and 65535');
      }
      if (pgConfig.maxConnections && pgConfig.maxConnections <= 0) {
        errors.push('maxConnections must be greater than 0');
      }
      break;
  }

  return {
    valid: errors.length === 0,
    errors
  };
};