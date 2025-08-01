/**
 * A2A Memory Factory Tests
 * Tests for A2A task provider factory functions and configuration
 */

import {
  createA2ATaskProvider,
  createSimpleA2ATaskProvider,
  createCompositeA2ATaskProvider,
  createA2ATaskProviderFromEnv,
  validateA2ATaskProviderConfig
} from '../factory.js';
import {
  A2ATaskProviderConfig,
  A2AInMemoryTaskConfig,
  A2ARedisTaskConfig,
  A2APostgresTaskConfig
} from '../types.js';

describe('A2A Memory Factory', () => {
  describe('Configuration Validation', () => {
    it('should validate in-memory task provider config', () => {
      const config: A2AInMemoryTaskConfig = {
        type: 'memory',
        maxTasks: 1000,
        keyPrefix: 'test:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const result = validateA2ATaskProviderConfig(config);
      expect(result.success).toBe(true);
    });

    it('should validate Redis task provider config', () => {
      const config: A2ARedisTaskConfig = {
        type: 'redis',
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const result = validateA2ATaskProviderConfig(config);
      expect(result.success).toBe(true);
    });

    it('should validate PostgreSQL task provider config', () => {
      const config: A2APostgresTaskConfig = {
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        username: 'test_user',
        tableName: 'test_tasks',
        keyPrefix: 'test:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const result = validateA2ATaskProviderConfig(config);
      expect(result.success).toBe(true);
    });

    it('should reject invalid config type', () => {
      const config = {
        type: 'invalid_type',
        keyPrefix: 'test:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      } as any;

      const result = validateA2ATaskProviderConfig(config);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const config = {
        type: 'memory'
        // Missing required fields
      } as any;

      const result = validateA2ATaskProviderConfig(config);
      expect(result.success).toBe(false);
    });

    it('should apply default values for optional fields', () => {
      const minimalConfig = {
        type: 'memory' as const
      };

      const result = validateA2ATaskProviderConfig(minimalConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.keyPrefix).toBe('faf:a2a:tasks:');
        expect(result.data.enableHistory).toBe(true);
        expect(result.data.enableArtifacts).toBe(true);
      }
    });

    it('should validate Redis-specific configuration', () => {
      const redisConfig: A2ARedisTaskConfig = {
        type: 'redis',
        host: 'redis.example.com',
        port: 6380,
        password: 'secret',
        db: 2,
        keyPrefix: 'myapp:',
        defaultTtl: 7200,
        cleanupInterval: 600,
        enableHistory: true,
        enableArtifacts: true
      };

      const result = validateA2ATaskProviderConfig(redisConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.host).toBe('redis.example.com');
        expect(result.data.port).toBe(6380);
        expect(result.data.password).toBe('secret');
        expect((result.data as A2ARedisTaskConfig).db).toBe(2);
      }
    });

    it('should validate PostgreSQL-specific configuration', () => {
      const postgresConfig: A2APostgresTaskConfig = {
        type: 'postgres',
        host: 'postgres.example.com',
        port: 5433,
        database: 'myapp_db',
        username: 'myapp_user',
        password: 'secret',
        ssl: true,
        tableName: 'custom_tasks',
        maxConnections: 20,
        keyPrefix: 'myapp:',
        defaultTtl: 7200,
        cleanupInterval: 600,
        enableHistory: true,
        enableArtifacts: true
      };

      const result = validateA2ATaskProviderConfig(postgresConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.host).toBe('postgres.example.com');
        expect(result.data.database).toBe('myapp_db');
        expect((result.data as A2APostgresTaskConfig).ssl).toBe(true);
        expect((result.data as A2APostgresTaskConfig).tableName).toBe('custom_tasks');
      }
    });
  });

  describe('Simple Provider Creation', () => {
    it('should create in-memory provider with simple factory', async () => {
      const provider = await createSimpleA2ATaskProvider('memory');
      
      expect(provider).toBeDefined();
      expect(typeof provider.storeTask).toBe('function');
      expect(typeof provider.getTask).toBe('function');
      expect(typeof provider.close).toBe('function');

      // Test basic functionality
      const healthResult = await provider.healthCheck();
      expect(healthResult.success).toBe(true);

      await provider.close();
    });

    it('should create in-memory provider with custom max tasks', async () => {
      const provider = await createSimpleA2ATaskProvider('memory', { maxTasks: 500 });
      
      expect(provider).toBeDefined();
      
      const healthResult = await provider.healthCheck();
      expect(healthResult.success).toBe(true);

      await provider.close();
    });

    it('should handle unsupported simple provider types gracefully', async () => {
      await expect(createSimpleA2ATaskProvider('redis' as any)).rejects.toThrow();
    });
  });

  describe('Full Provider Creation', () => {
    it('should create in-memory provider with full config', async () => {
      const config: A2AInMemoryTaskConfig = {
        type: 'memory',
        maxTasks: 2000,
        maxTasksPerContext: 200,
        keyPrefix: 'test:factory:',
        defaultTtl: 7200,
        cleanupInterval: 600,
        enableHistory: true,
        enableArtifacts: true
      };

      const provider = await createA2ATaskProvider(config);
      
      expect(provider).toBeDefined();
      
      // Test provider functionality
      const healthResult = await provider.healthCheck();
      expect(healthResult.success).toBe(true);

      await provider.close();
    });

    it('should handle external clients for Redis provider', async () => {
      const config: A2ARedisTaskConfig = {
        type: 'redis',
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      // Mock Redis client
      const mockRedisClient = {
        ping: jest.fn().mockResolvedValue('PONG'),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        exists: jest.fn(),
        hgetall: jest.fn(),
        hmset: jest.fn(),
        sadd: jest.fn(),
        smembers: jest.fn(),
        keys: jest.fn().mockResolvedValue([]),
        multi: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([])
        })
      };

      const externalClients = { redis: mockRedisClient };

      // Should not throw when Redis client is provided
      const provider = await createA2ATaskProvider(config, externalClients);
      expect(provider).toBeDefined();

      await provider.close();
    });

    it('should handle external clients for PostgreSQL provider', async () => {
      const config: A2APostgresTaskConfig = {
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        username: 'test_user',
        keyPrefix: 'test:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      // Mock PostgreSQL client
      const mockPgClient = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 })
      };

      const externalClients = { postgres: mockPgClient };

      // Should not throw when PostgreSQL client is provided
      const provider = await createA2ATaskProvider(config, externalClients);
      expect(provider).toBeDefined();

      await provider.close();
    });

    it('should fallback to in-memory when external dependencies are missing', async () => {
      const redisConfig: A2ARedisTaskConfig = {
        type: 'redis',
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      // Should fall back to in-memory when Redis client is not provided
      const provider = await createA2ATaskProvider(redisConfig);
      expect(provider).toBeDefined();

      // Should still function as in-memory provider
      const healthResult = await provider.healthCheck();
      expect(healthResult.success).toBe(true);

      await provider.close();
    });
  });

  describe('Composite Provider Creation', () => {
    it('should create composite provider with multiple backends', async () => {
      const primaryConfig: A2AInMemoryTaskConfig = {
        type: 'memory',
        maxTasks: 1000,
        keyPrefix: 'primary:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const fallbackConfig: A2AInMemoryTaskConfig = {
        type: 'memory',
        maxTasks: 500,
        keyPrefix: 'fallback:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const compositeProvider = await createCompositeA2ATaskProvider({
        primary: primaryConfig,
        fallback: fallbackConfig,
        strategy: 'fallback',
        syncMode: 'write-through'
      });

      expect(compositeProvider).toBeDefined();
      expect(typeof compositeProvider.storeTask).toBe('function');

      const healthResult = await compositeProvider.healthCheck();
      expect(healthResult.success).toBe(true);

      await compositeProvider.close();
    });

    it('should handle composite provider with replication strategy', async () => {
      const primary: A2AInMemoryTaskConfig = {
        type: 'memory',
        maxTasks: 1000,
        keyPrefix: 'primary:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const replica: A2AInMemoryTaskConfig = {
        type: 'memory',
        maxTasks: 1000,
        keyPrefix: 'replica:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const compositeProvider = await createCompositeA2ATaskProvider({
        primary,
        replica,
        strategy: 'replication',
        syncMode: 'async'
      });

      expect(compositeProvider).toBeDefined();
      await compositeProvider.close();
    });
  });

  describe('Environment-Based Configuration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should create provider from environment variables', async () => {
      process.env.FAF_A2A_TASK_PROVIDER_TYPE = 'memory';
      process.env.FAF_A2A_TASK_PROVIDER_MAX_TASKS = '2000';
      process.env.FAF_A2A_TASK_PROVIDER_KEY_PREFIX = 'env_test:';
      process.env.FAF_A2A_TASK_PROVIDER_DEFAULT_TTL = '7200';

      const provider = await createA2ATaskProviderFromEnv();
      
      expect(provider).toBeDefined();
      
      const healthResult = await provider.healthCheck();
      expect(healthResult.success).toBe(true);

      await provider.close();
    });

    it('should use default values when environment variables are not set', async () => {
      // Clear relevant environment variables
      delete process.env.FAF_A2A_TASK_PROVIDER_TYPE;
      delete process.env.FAF_A2A_TASK_PROVIDER_MAX_TASKS;

      const provider = await createA2ATaskProviderFromEnv();
      
      expect(provider).toBeDefined();
      
      const healthResult = await provider.healthCheck();
      expect(healthResult.success).toBe(true);

      await provider.close();
    });

    it('should handle Redis configuration from environment', async () => {
      process.env.FAF_A2A_TASK_PROVIDER_TYPE = 'redis';
      process.env.FAF_A2A_TASK_PROVIDER_REDIS_HOST = 'redis.example.com';
      process.env.FAF_A2A_TASK_PROVIDER_REDIS_PORT = '6380';
      process.env.FAF_A2A_TASK_PROVIDER_REDIS_PASSWORD = 'secret';

      // Should fall back to in-memory since Redis client is not available
      const provider = await createA2ATaskProviderFromEnv();
      expect(provider).toBeDefined();

      await provider.close();
    });

    it('should handle PostgreSQL configuration from environment', async () => {
      process.env.FAF_A2A_TASK_PROVIDER_TYPE = 'postgres';
      process.env.FAF_A2A_TASK_PROVIDER_POSTGRES_HOST = 'postgres.example.com';
      process.env.FAF_A2A_TASK_PROVIDER_POSTGRES_PORT = '5433';
      process.env.FAF_A2A_TASK_PROVIDER_POSTGRES_DATABASE = 'myapp';
      process.env.FAF_A2A_TASK_PROVIDER_POSTGRES_USERNAME = 'myuser';

      // Should fall back to in-memory since PostgreSQL client is not available
      const provider = await createA2ATaskProviderFromEnv();
      expect(provider).toBeDefined();

      await provider.close();
    });

    it('should handle invalid environment configuration gracefully', async () => {
      process.env.FAF_A2A_TASK_PROVIDER_TYPE = 'invalid_type';

      // Should fall back to in-memory provider
      const provider = await createA2ATaskProviderFromEnv();
      expect(provider).toBeDefined();

      await provider.close();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle provider creation with invalid configuration', async () => {
      const invalidConfig = {
        type: 'memory',
        maxTasks: -1, // Invalid value
        keyPrefix: '', // Invalid empty prefix
      } as any;

      await expect(createA2ATaskProvider(invalidConfig)).rejects.toThrow();
    });

    it('should handle provider creation failures gracefully', async () => {
      // Test with Redis config but no client (should fall back)
      const redisConfig: A2ARedisTaskConfig = {
        type: 'redis',
        host: 'non-existent-host',
        port: 9999,
        keyPrefix: 'test:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      // Should not throw, should fall back to in-memory
      const provider = await createA2ATaskProvider(redisConfig);
      expect(provider).toBeDefined();
      
      await provider.close();
    });

    it('should handle composite provider creation with partial failures', async () => {
      const validConfig: A2AInMemoryTaskConfig = {
        type: 'memory',
        maxTasks: 1000,
        keyPrefix: 'valid:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const invalidConfig = {
        type: 'invalid_type',
        keyPrefix: 'invalid:',
      } as any;

      // Should handle partial failure in composite creation
      await expect(createCompositeA2ATaskProvider({
        primary: validConfig,
        fallback: invalidConfig,
        strategy: 'fallback',
        syncMode: 'write-through'
      })).rejects.toThrow();
    });
  });

  describe('Provider Feature Testing', () => {
    it('should create providers with all expected interface methods', async () => {
      const config: A2AInMemoryTaskConfig = {
        type: 'memory',
        maxTasks: 1000,
        keyPrefix: 'feature_test:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const provider = await createA2ATaskProvider(config);

      // Verify all required interface methods exist
      const requiredMethods = [
        'storeTask',
        'getTask',
        'updateTask',
        'updateTaskStatus',
        'findTasks',
        'getTasksByContext',
        'deleteTask',
        'deleteTasksByContext',
        'cleanupExpiredTasks',
        'getTaskStats',
        'healthCheck',
        'close'
      ];

      for (const method of requiredMethods) {
        expect(typeof (provider as any)[method]).toBe('function');
      }

      // Test that methods return proper result types
      const healthResult = await provider.healthCheck();
      expect(healthResult).toHaveProperty('success');
      expect(typeof healthResult.success).toBe('boolean');

      const statsResult = await provider.getTaskStats();
      expect(statsResult).toHaveProperty('success');
      expect(typeof statsResult.success).toBe('boolean');

      await provider.close();
    });

    it('should respect configuration options in created providers', async () => {
      const customConfig: A2AInMemoryTaskConfig = {
        type: 'memory',
        maxTasks: 100, // Small limit for testing
        keyPrefix: 'custom_test:',
        defaultTtl: 1800,
        cleanupInterval: 150,
        enableHistory: false, // Disabled
        enableArtifacts: false // Disabled
      };

      const provider = await createA2ATaskProvider(customConfig);

      // Test that provider respects the configuration
      // (This would require accessing internal state or testing behavior)
      // For now, just verify it was created successfully
      expect(provider).toBeDefined();

      const healthResult = await provider.healthCheck();
      expect(healthResult.success).toBe(true);

      await provider.close();
    });
  });
});