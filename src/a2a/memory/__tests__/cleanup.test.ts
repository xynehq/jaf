/**
 * A2A Cleanup Service Tests
 * Comprehensive tests for A2A task cleanup and expiration policies
 */

import {
  performTaskCleanup,
  createTaskCleanupScheduler,
  validateCleanupConfig,
  createCleanupConfigFromEnv,
  defaultCleanupConfig,
  A2ATaskCleanupConfig
} from '../cleanup.js';
import { createA2AInMemoryTaskProvider } from '../providers/in-memory.js';
import { A2ATaskProvider, A2AInMemoryTaskConfig } from '../types.js';
import { A2ATask, TaskState } from '../../types.js';

describe('A2A Cleanup Service', () => {
  // Helper function to create a test task
  const createTestTask = (
    id: string = 'task_123',
    contextId: string = 'ctx_456',
    state: TaskState = 'working',
    timestamp?: string
  ): A2ATask => ({
    id,
    contextId,
    kind: 'task',
    status: {
      state,
      timestamp: timestamp || new Date().toISOString()
    },
    metadata: {
      createdAt: timestamp || new Date().toISOString()
    }
  });

  // Helper to create a provider with test data
  const createProviderWithTestData = async (): Promise<A2ATaskProvider> => {
    const config: A2AInMemoryTaskConfig = {
      type: 'memory',
      maxTasks: 1000,
      maxTasksPerContext: 100,
      keyPrefix: 'test:',
      defaultTtl: 3600,
      cleanupInterval: 300,
      enableHistory: true,
      enableArtifacts: true
    };

    const provider = await createA2AInMemoryTaskProvider(config);
    
    // Add test tasks with different ages and states
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const oneDayAgo = new Date(now.getTime() - 86400000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 86400000);

    const testTasks = [
      // Recent tasks
      createTestTask('recent_working_1', 'ctx1', 'working', now.toISOString()),
      createTestTask('recent_completed_1', 'ctx1', 'completed', now.toISOString()),
      
      // One hour old tasks
      createTestTask('hour_old_working_1', 'ctx2', 'working', oneHourAgo.toISOString()),
      createTestTask('hour_old_completed_1', 'ctx2', 'completed', oneHourAgo.toISOString()),
      createTestTask('hour_old_failed_1', 'ctx2', 'failed', oneHourAgo.toISOString()),
      
      // One day old tasks
      createTestTask('day_old_completed_1', 'ctx3', 'completed', oneDayAgo.toISOString()),
      createTestTask('day_old_completed_2', 'ctx3', 'completed', oneDayAgo.toISOString()),
      createTestTask('day_old_failed_1', 'ctx3', 'failed', oneDayAgo.toISOString()),
      
      // One week old tasks
      createTestTask('week_old_completed_1', 'ctx4', 'completed', oneWeekAgo.toISOString()),
      createTestTask('week_old_completed_2', 'ctx4', 'completed', oneWeekAgo.toISOString()),
      createTestTask('week_old_failed_1', 'ctx4', 'failed', oneWeekAgo.toISOString()),
      createTestTask('week_old_failed_2', 'ctx4', 'failed', oneWeekAgo.toISOString())
    ];

    for (const task of testTasks) {
      await provider.storeTask(task);
    }

    return provider;
  };

  describe('Default Configuration', () => {
    it('should have sensible default cleanup configuration', () => {
      expect(defaultCleanupConfig.enabled).toBe(true);
      expect(defaultCleanupConfig.interval).toBeGreaterThan(0);
      expect(defaultCleanupConfig.maxAge).toBeGreaterThan(0);
      expect(defaultCleanupConfig.maxCompletedTasks).toBeGreaterThan(0);
      expect(defaultCleanupConfig.maxFailedTasks).toBeGreaterThan(0);
      expect(defaultCleanupConfig.retainStates).toContain('working');
      expect(defaultCleanupConfig.batchSize).toBeGreaterThan(0);
      expect(defaultCleanupConfig.dryRun).toBe(false);
    });
  });

  describe('Cleanup Configuration Validation', () => {
    it('should validate valid cleanup configuration', () => {
      const validConfig: Partial<A2ATaskCleanupConfig> = {
        enabled: true,
        interval: 3600000,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        maxCompletedTasks: 1000,
        maxFailedTasks: 500,
        batchSize: 100
      };

      const result = validateCleanupConfig(validConfig);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid interval', () => {
      const invalidConfig: Partial<A2ATaskCleanupConfig> = {
        interval: -1
      };

      const result = validateCleanupConfig(invalidConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Cleanup interval must be greater than 0');
    });

    it('should reject invalid max age', () => {
      const invalidConfig: Partial<A2ATaskCleanupConfig> = {
        maxAge: -1
      };

      const result = validateCleanupConfig(invalidConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Max age must be greater than 0');
    });

    it('should reject negative task limits', () => {
      const invalidConfig: Partial<A2ATaskCleanupConfig> = {
        maxCompletedTasks: -1,
        maxFailedTasks: -1
      };

      const result = validateCleanupConfig(invalidConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Max completed tasks must be non-negative');
      expect(result.errors).toContain('Max failed tasks must be non-negative');
    });

    it('should reject invalid batch size', () => {
      const invalidConfig: Partial<A2ATaskCleanupConfig> = {
        batchSize: 0
      };

      const result = validateCleanupConfig(invalidConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Batch size must be greater than 0');
    });
  });

  describe('Environment Configuration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should create config from environment variables', () => {
      process.env.JAF_A2A_CLEANUP_ENABLED = 'true';
      process.env.JAF_A2A_CLEANUP_INTERVAL = '7200000';
      process.env.JAF_A2A_CLEANUP_MAX_AGE = '1209600000';
      process.env.JAF_A2A_CLEANUP_MAX_COMPLETED = '2000';
      process.env.JAF_A2A_CLEANUP_MAX_FAILED = '1000';
      process.env.JAF_A2A_CLEANUP_RETAIN_STATES = 'working,submitted';
      process.env.JAF_A2A_CLEANUP_BATCH_SIZE = '200';
      process.env.JAF_A2A_CLEANUP_DRY_RUN = 'true';

      const config = createCleanupConfigFromEnv();

      expect(config.enabled).toBe(true);
      expect(config.interval).toBe(7200000);
      expect(config.maxAge).toBe(1209600000);
      expect(config.maxCompletedTasks).toBe(2000);
      expect(config.maxFailedTasks).toBe(1000);
      expect(config.retainStates).toEqual(['working', 'submitted']);
      expect(config.batchSize).toBe(200);
      expect(config.dryRun).toBe(true);
    });

    it('should use defaults when environment variables are not set', () => {
      const config = createCleanupConfigFromEnv();

      expect(config.enabled).toBe(true);
      expect(config.interval).toBe(3600000);
      expect(config.maxAge).toBe(604800000);
      expect(config.maxCompletedTasks).toBe(1000);
      expect(config.maxFailedTasks).toBe(500);
      expect(config.dryRun).toBe(false);
    });

    it('should handle disabled cleanup', () => {
      process.env.JAF_A2A_CLEANUP_ENABLED = 'false';

      const config = createCleanupConfigFromEnv();
      expect(config.enabled).toBe(false);
    });
  });

  describe('Task Cleanup Execution', () => {
    let provider: A2ATaskProvider;

    beforeEach(async () => {
      provider = await createProviderWithTestData();
    });

    it('should perform cleanup with default configuration', async () => {
      const config: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        maxAge: 3600000, // 1 hour
        maxCompletedTasks: 2,
        maxFailedTasks: 2
      };

      const result = await performTaskCleanup(provider, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalCleaned).toBeGreaterThan(0);
        expect(result.data.errors).toHaveLength(0);
      }
    });

    it('should clean up old completed tasks beyond max count', async () => {
      const config: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        maxAge: 0, // Disable age-based cleanup
        maxCompletedTasks: 2, // Keep only 2 completed tasks
        maxFailedTasks: 1000 // Don't limit failed tasks
      };

      const result = await performTaskCleanup(provider, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.excessCompletedCleaned).toBeGreaterThan(0);
        
        // Verify that only 2 completed tasks remain
        const remainingCompleted = await provider.findTasks({ state: 'completed' });
        expect(remainingCompleted.success).toBe(true);
        if (remainingCompleted.success) {
          expect(remainingCompleted.data.length).toBeLessThanOrEqual(2);
        }
      }
    });

    it('should clean up old failed tasks beyond max count', async () => {
      const config: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        maxAge: 0, // Disable age-based cleanup
        maxCompletedTasks: 1000, // Don't limit completed tasks
        maxFailedTasks: 1 // Keep only 1 failed task
      };

      const result = await performTaskCleanup(provider, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.excessFailedCleaned).toBeGreaterThan(0);
        
        // Verify that only 1 failed task remains
        const remainingFailed = await provider.findTasks({ state: 'failed' });
        expect(remainingFailed.success).toBe(true);
        if (remainingFailed.success) {
          expect(remainingFailed.data.length).toBeLessThanOrEqual(1);
        }
      }
    });

    it('should clean up tasks beyond max age', async () => {
      const config: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        maxAge: 3600000, // 1 hour - should clean week-old and day-old tasks
        maxCompletedTasks: 1000, // Don't limit by count
        maxFailedTasks: 1000
      };

      const result = await performTaskCleanup(provider, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalCleaned).toBeGreaterThan(0);
        
        // Verify that old tasks are gone
        const allTasks = await provider.findTasks({});
        expect(allTasks.success).toBe(true);
        if (allTasks.success) {
          const oldTasksRemaining = allTasks.data.filter(task => {
            const taskDate = new Date(task.status.timestamp || task.metadata?.createdAt || 0);
            const ageInMs = Date.now() - taskDate.getTime();
            return ageInMs > config.maxAge && 
                   ['completed', 'failed', 'canceled'].includes(task.status.state);
          });
          expect(oldTasksRemaining).toHaveLength(0);
        }
      }
    });

    it('should respect retain states configuration', async () => {
      const config: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        maxAge: 1, // Very short age to clean everything
        retainStates: ['working'], // Retain working tasks
        maxCompletedTasks: 0,
        maxFailedTasks: 0
      };

      const result = await performTaskCleanup(provider, config);

      expect(result.success).toBe(true);
      if (result.success) {
        // Verify that working tasks are retained
        const workingTasks = await provider.findTasks({ state: 'working' });
        expect(workingTasks.success).toBe(true);
        if (workingTasks.success) {
          expect(workingTasks.data.length).toBeGreaterThan(0);
        }
      }
    });

    it('should handle dry run mode', async () => {
      const config: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        maxAge: 1, // Very short age
        maxCompletedTasks: 0,
        maxFailedTasks: 0,
        dryRun: true
      };

      // Count tasks before cleanup
      const tasksBefore = await provider.findTasks({});
      expect(tasksBefore.success).toBe(true);
      const taskCountBefore = tasksBefore.success ? tasksBefore.data.length : 0;

      const result = await performTaskCleanup(provider, config);

      expect(result.success).toBe(true);
      
      // Verify that no tasks were actually deleted in dry run
      const tasksAfter = await provider.findTasks({});
      expect(tasksAfter.success).toBe(true);
      const taskCountAfter = tasksAfter.success ? tasksAfter.data.length : 0;
      
      expect(taskCountAfter).toBe(taskCountBefore);
    });

    it('should handle cleanup when no tasks need cleaning', async () => {
      // Create provider with only recent working tasks
      const config: A2AInMemoryTaskConfig = {
        type: 'memory',
        maxTasks: 1000,
        maxTasksPerContext: 100,
        keyPrefix: 'test:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const emptyProvider = await createA2AInMemoryTaskProvider(config);
      await emptyProvider.storeTask(createTestTask('recent_working', 'ctx1', 'working'));

      const cleanupConfig: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        maxCompletedTasks: 1000,
        maxFailedTasks: 1000
      };

      const result = await performTaskCleanup(emptyProvider, cleanupConfig);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalCleaned).toBe(0);
        expect(result.data.errors).toHaveLength(0);
      }
    });

    it('should handle cleanup with disabled configuration', async () => {
      const config: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        enabled: false
      };

      const result = await performTaskCleanup(provider, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalCleaned).toBe(0);
      }
    });
  });

  describe('Cleanup Scheduler', () => {
    let provider: A2ATaskProvider;

    beforeEach(async () => {
      provider = await createProviderWithTestData();
    });

    it('should create cleanup scheduler', () => {
      const config: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        interval: 100 // Short interval for testing
      };

      const scheduler = createTaskCleanupScheduler(provider, config);

      expect(scheduler).toBeDefined();
      expect(typeof scheduler.start).toBe('function');
      expect(typeof scheduler.stop).toBe('function');
      expect(typeof scheduler.runOnce).toBe('function');
      expect(typeof scheduler.isRunning).toBe('function');
      expect(scheduler.config).toEqual(config);
    });

    it('should start and stop scheduler', (done) => {
      const config: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        interval: 50, // Very short interval
        maxCompletedTasks: 0 // Clean all completed tasks
      };

      const scheduler = createTaskCleanupScheduler(provider, config);

      expect(scheduler.isRunning()).toBe(false);

      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);

      // Let it run for a short time
      setTimeout(() => {
        scheduler.stop();
        expect(scheduler.isRunning()).toBe(false);
        done();
      }, 150);
    });

    it('should not start when already running', () => {
      const config: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        interval: 1000
      };

      const scheduler = createTaskCleanupScheduler(provider, config);

      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);

      // Second start should not change anything
      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();
    });

    it('should not start when cleanup is disabled', () => {
      const config: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        enabled: false
      };

      const scheduler = createTaskCleanupScheduler(provider, config);

      scheduler.start();
      expect(scheduler.isRunning()).toBe(false);
    });

    it('should run cleanup once on demand', async () => {
      const config: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        maxCompletedTasks: 1
      };

      const scheduler = createTaskCleanupScheduler(provider, config);

      const result = await scheduler.runOnce();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalCleaned).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle provider errors gracefully', async () => {
      // Create a mock provider that throws errors
      const errorProvider: A2ATaskProvider = {
        storeTask: jest.fn().mockRejectedValue(new Error('Storage error')),
        getTask: jest.fn().mockRejectedValue(new Error('Retrieval error')),
        updateTask: jest.fn().mockRejectedValue(new Error('Update error')),
        updateTaskStatus: jest.fn().mockRejectedValue(new Error('Status update error')),
        findTasks: jest.fn().mockRejectedValue(new Error('Query error')),
        getTasksByContext: jest.fn().mockRejectedValue(new Error('Context query error')),
        deleteTask: jest.fn().mockRejectedValue(new Error('Delete error')),
        deleteTasksByContext: jest.fn().mockRejectedValue(new Error('Bulk delete error')),
        cleanupExpiredTasks: jest.fn().mockRejectedValue(new Error('Cleanup error')),
        getTaskStats: jest.fn().mockRejectedValue(new Error('Stats error')),
        healthCheck: jest.fn().mockRejectedValue(new Error('Health check error')),
        close: jest.fn().mockRejectedValue(new Error('Close error'))
      };

      const config: A2ATaskCleanupConfig = {
        ...defaultCleanupConfig,
        maxCompletedTasks: 1,
        maxFailedTasks: 1
      };

      const result = await performTaskCleanup(errorProvider, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.errors.length).toBeGreaterThan(0);
        expect(result.data.totalCleaned).toBe(0);
      }
    });

    it('should handle malformed provider responses', async () => {
      // Create a mock provider with malformed responses
      const malformedProvider: A2ATaskProvider = {
        storeTask: jest.fn().mockResolvedValue({ success: false, error: 'Not a proper error object' }),
        getTask: jest.fn().mockResolvedValue({ success: false, error: 'Not a proper error object' }),
        updateTask: jest.fn().mockResolvedValue({ success: false, error: 'Not a proper error object' }),
        updateTaskStatus: jest.fn().mockResolvedValue({ success: false, error: 'Not a proper error object' }),
        findTasks: jest.fn().mockResolvedValue({ success: false, error: { message: 'Query failed' } }),
        getTasksByContext: jest.fn().mockResolvedValue({ success: true, data: [] }),
        deleteTask: jest.fn().mockResolvedValue({ success: false, error: { message: 'Delete failed' } }),
        deleteTasksByContext: jest.fn().mockResolvedValue({ success: true, data: 0 }),
        cleanupExpiredTasks: jest.fn().mockResolvedValue({ success: false, error: { message: 'Cleanup failed' } }),
        getTaskStats: jest.fn().mockResolvedValue({ success: true, data: { totalTasks: 0, tasksByState: {} } }),
        healthCheck: jest.fn().mockResolvedValue({ success: true, data: { healthy: true } }),
        close: jest.fn().mockResolvedValue({ success: true, data: undefined })
      };

      const result = await performTaskCleanup(malformedProvider, defaultCleanupConfig);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.errors.length).toBeGreaterThan(0);
      }
    });
  });
});