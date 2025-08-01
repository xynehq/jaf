/**
 * A2A In-Memory Provider Tests
 * Comprehensive tests for the A2A in-memory task provider
 */

import { createA2AInMemoryTaskProvider } from '../providers/in-memory.js';
import { A2AInMemoryTaskConfig, A2ATaskQuery } from '../types.js';
import { A2ATask, TaskState } from '../../types.js';

describe('A2A In-Memory Provider', () => {
  // Helper function to create a test task
  const createTestTask = (id: string = 'task_123', contextId: string = 'ctx_456', state: TaskState = 'working'): A2ATask => ({
    id,
    contextId,
    kind: 'task',
    status: {
      state,
      message: {
        role: 'agent',
        parts: [{ kind: 'text', text: `Processing task ${id}` }],
        messageId: `msg_${id}`,
        contextId,
        kind: 'message'
      },
      timestamp: new Date().toISOString()
    },
    history: [
      {
        role: 'user',
        parts: [{ kind: 'text', text: `User request for ${id}` }],
        messageId: `msg_user_${id}`,
        contextId,
        kind: 'message'
      }
    ],
    metadata: {
      createdAt: new Date().toISOString(),
      priority: 'normal'
    }
  });

  const defaultConfig: A2AInMemoryTaskConfig = {
    type: 'memory',
    maxTasks: 1000,
    maxTasksPerContext: 100,
    keyPrefix: 'test:',
    defaultTtl: 3600,
    cleanupInterval: 300,
    enableHistory: true,
    enableArtifacts: true
  };

  describe('Provider Creation', () => {
    it('should create provider with default config', async () => {
      const provider = await createA2AInMemoryTaskProvider(defaultConfig);
      expect(provider).toBeDefined();
      expect(typeof provider.storeTask).toBe('function');
      expect(typeof provider.getTask).toBe('function');
      expect(typeof provider.updateTask).toBe('function');
    });

    it('should create provider with minimal config', async () => {
      const minimalConfig: A2AInMemoryTaskConfig = {
        type: 'memory',
        maxTasks: 100,
        maxTasksPerContext: 50,
        keyPrefix: 'test:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const provider = await createA2AInMemoryTaskProvider(minimalConfig);
      expect(provider).toBeDefined();
    });
  });

  describe('Task Storage', () => {
    let provider: Awaited<ReturnType<typeof createA2AInMemoryTaskProvider>>;

    beforeEach(async () => {
      provider = await createA2AInMemoryTaskProvider(defaultConfig);
    });

    it('should store and retrieve a task', async () => {
      const task = createTestTask();
      
      const storeResult = await provider.storeTask(task);
      expect(storeResult.success).toBe(true);

      const getResult = await provider.getTask(task.id);
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data).toBeDefined();
        expect(getResult.data!.id).toBe(task.id);
        expect(getResult.data!.contextId).toBe(task.contextId);
      }
    });

    it('should store task with metadata', async () => {
      const task = createTestTask();
      const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
      const metadata = { expiresAt, custom: 'value' };

      const storeResult = await provider.storeTask(task, metadata);
      expect(storeResult.success).toBe(true);

      const getResult = await provider.getTask(task.id);
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data).toBeDefined();
      }
    });

    it('should return null for non-existent task', async () => {
      const getResult = await provider.getTask('non_existent');
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data).toBeNull();
      }
    });

    it('should not return expired tasks', async () => {
      const task = createTestTask();
      const expiredDate = new Date(Date.now() - 1000); // 1 second ago
      const metadata = { expiresAt: expiredDate };

      const storeResult = await provider.storeTask(task, metadata);
      expect(storeResult.success).toBe(true);

      const getResult = await provider.getTask(task.id);
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data).toBeNull();
      }
    });

    it('should reject duplicate task IDs', async () => {
      const task = createTestTask();

      const firstStore = await provider.storeTask(task);
      expect(firstStore.success).toBe(true);

      const secondStore = await provider.storeTask(task);
      expect(secondStore.success).toBe(false);
    });

    it('should enforce storage limits', async () => {
      const limitedConfig: A2AInMemoryTaskConfig = {
        ...defaultConfig,
        maxTasks: 2
      };
      const limitedProvider = await createA2AInMemoryTaskProvider(limitedConfig);

      // Store up to limit
      const task1 = createTestTask('task1');
      const task2 = createTestTask('task2');
      
      const store1 = await limitedProvider.storeTask(task1);
      const store2 = await limitedProvider.storeTask(task2);
      
      expect(store1.success).toBe(true);
      expect(store2.success).toBe(true);

      // Should reject when limit exceeded
      const task3 = createTestTask('task3');
      const store3 = await limitedProvider.storeTask(task3);
      expect(store3.success).toBe(false);
    });
  });

  describe('Task Updates', () => {
    let provider: Awaited<ReturnType<typeof createA2AInMemoryTaskProvider>>;

    beforeEach(async () => {
      provider = await createA2AInMemoryTaskProvider(defaultConfig);
    });

    it('should update an existing task', async () => {
      const originalTask = createTestTask();
      await provider.storeTask(originalTask);

      const updatedTask = { ...originalTask, status: { ...originalTask.status, state: 'completed' as TaskState } };
      const updateResult = await provider.updateTask(updatedTask);
      expect(updateResult.success).toBe(true);

      const getResult = await provider.getTask(originalTask.id);
      expect(getResult.success).toBe(true);
      if (getResult.success && getResult.data) {
        expect(getResult.data.status.state).toBe('completed');
      }
    });

    it('should update task status only', async () => {
      const task = createTestTask();
      await provider.storeTask(task);

      const updateResult = await provider.updateTaskStatus(task.id, 'completed', { result: 'success' });
      expect(updateResult.success).toBe(true);

      const getResult = await provider.getTask(task.id);
      expect(getResult.success).toBe(true);
      if (getResult.success && getResult.data) {
        expect(getResult.data.status.state).toBe('completed');
      }
    });

    it('should fail to update non-existent task', async () => {
      const nonExistentTask = createTestTask('non_existent');
      const updateResult = await provider.updateTask(nonExistentTask);
      expect(updateResult.success).toBe(false);
    });

    it('should fail to update status of non-existent task', async () => {
      const updateResult = await provider.updateTaskStatus('non_existent', 'completed');
      expect(updateResult.success).toBe(false);
    });
  });

  describe('Task Queries', () => {
    let provider: Awaited<ReturnType<typeof createA2AInMemoryTaskProvider>>;

    beforeEach(async () => {
      provider = await createA2AInMemoryTaskProvider(defaultConfig);
      
      // Set up test data
      const tasks = [
        createTestTask('task1', 'ctx1', 'working'),
        createTestTask('task2', 'ctx1', 'completed'),
        createTestTask('task3', 'ctx2', 'working'),
        createTestTask('task4', 'ctx2', 'failed')
      ];

      for (const task of tasks) {
        await provider.storeTask(task);
      }
    });

    it('should find all tasks', async () => {
      const result = await provider.findTasks({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(4);
      }
    });

    it('should find tasks by context ID', async () => {
      const result = await provider.findTasks({ contextId: 'ctx1' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data.every(task => task.contextId === 'ctx1')).toBe(true);
      }
    });

    it('should find tasks by state', async () => {
      const result = await provider.findTasks({ state: 'working' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data.every(task => task.status.state === 'working')).toBe(true);
      }
    });

    it('should find tasks by specific task ID', async () => {
      const result = await provider.findTasks({ taskId: 'task1' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].id).toBe('task1');
      }
    });

    it('should support pagination with limit', async () => {
      const result = await provider.findTasks({ limit: 2 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
      }
    });

    it('should support pagination with offset', async () => {
      const result = await provider.findTasks({ limit: 2, offset: 2 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
      }
    });

    it('should find tasks by date range', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600000);
      const oneHourFromNow = new Date(now.getTime() + 3600000);

      const result = await provider.findTasks({ 
        since: oneHourAgo, 
        until: oneHourFromNow 
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
      }
    });

    it('should get tasks by context with limit', async () => {
      const result = await provider.getTasksByContext('ctx1', 1);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].contextId).toBe('ctx1');
      }
    });
  });

  describe('Task Deletion', () => {
    let provider: Awaited<ReturnType<typeof createA2AInMemoryTaskProvider>>;

    beforeEach(async () => {
      provider = await createA2AInMemoryTaskProvider(defaultConfig);
    });

    it('should delete an existing task', async () => {
      const task = createTestTask();
      await provider.storeTask(task);

      const deleteResult = await provider.deleteTask(task.id);
      expect(deleteResult.success).toBe(true);
      if (deleteResult.success) {
        expect(deleteResult.data).toBe(true);
      }

      const getResult = await provider.getTask(task.id);
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data).toBeNull();
      }
    });

    it('should return false when deleting non-existent task', async () => {
      const deleteResult = await provider.deleteTask('non_existent');
      expect(deleteResult.success).toBe(true);
      if (deleteResult.success) {
        expect(deleteResult.data).toBe(false);
      }
    });

    it('should delete tasks by context', async () => {
      const tasks = [
        createTestTask('task1', 'ctx1'),
        createTestTask('task2', 'ctx1'),
        createTestTask('task3', 'ctx2')
      ];

      for (const task of tasks) {
        await provider.storeTask(task);
      }

      const deleteResult = await provider.deleteTasksByContext('ctx1');
      expect(deleteResult.success).toBe(true);
      if (deleteResult.success) {
        expect(deleteResult.data).toBe(2); // Should delete 2 tasks
      }

      const remainingTasks = await provider.findTasks({});
      expect(remainingTasks.success).toBe(true);
      if (remainingTasks.success) {
        expect(remainingTasks.data).toHaveLength(1);
        expect(remainingTasks.data[0].contextId).toBe('ctx2');
      }
    });
  });

  describe('Task Statistics', () => {
    let provider: Awaited<ReturnType<typeof createA2AInMemoryTaskProvider>>;

    beforeEach(async () => {
      provider = await createA2AInMemoryTaskProvider(defaultConfig);
      
      // Set up test data with various states
      const tasks = [
        createTestTask('task1', 'ctx1', 'working'),
        createTestTask('task2', 'ctx1', 'completed'),
        createTestTask('task3', 'ctx2', 'working'),
        createTestTask('task4', 'ctx2', 'failed'),
        createTestTask('task5', 'ctx1', 'completed')
      ];

      for (const task of tasks) {
        await provider.storeTask(task);
      }
    });

    it('should get global task statistics', async () => {
      const statsResult = await provider.getTaskStats();
      expect(statsResult.success).toBe(true);
      if (statsResult.success) {
        const stats = statsResult.data;
        expect(stats.totalTasks).toBe(5);
        expect(stats.tasksByState.working).toBe(2);
        expect(stats.tasksByState.completed).toBe(2);
        expect(stats.tasksByState.failed).toBe(1);
        expect(stats.oldestTask).toBeDefined();
        expect(stats.newestTask).toBeDefined();
      }
    });

    it('should get context-specific task statistics', async () => {
      const statsResult = await provider.getTaskStats('ctx1');
      expect(statsResult.success).toBe(true);
      if (statsResult.success) {
        const stats = statsResult.data;
        expect(stats.totalTasks).toBe(3); // ctx1 has 3 tasks
        expect(stats.tasksByState.working).toBe(1);
        expect(stats.tasksByState.completed).toBe(2);
        expect(stats.tasksByState.failed).toBe(0);
      }
    });
  });

  describe('Cleanup Operations', () => {
    let provider: Awaited<ReturnType<typeof createA2AInMemoryTaskProvider>>;

    beforeEach(async () => {
      provider = await createA2AInMemoryTaskProvider(defaultConfig);
    });

    it('should clean up expired tasks', async () => {
      const task1 = createTestTask('task1');
      const task2 = createTestTask('task2');
      
      // Store one task with expiration in the past
      const expiredDate = new Date(Date.now() - 1000);
      await provider.storeTask(task1, { expiresAt: expiredDate });
      await provider.storeTask(task2); // No expiration

      const cleanupResult = await provider.cleanupExpiredTasks();
      expect(cleanupResult.success).toBe(true);
      if (cleanupResult.success) {
        expect(cleanupResult.data).toBe(1); // Should clean up 1 expired task
      }

      const remainingTasks = await provider.findTasks({});
      expect(remainingTasks.success).toBe(true);
      if (remainingTasks.success) {
        expect(remainingTasks.data).toHaveLength(1);
        expect(remainingTasks.data[0].id).toBe('task2');
      }
    });

    it('should return 0 when no tasks need cleanup', async () => {
      const task = createTestTask();
      await provider.storeTask(task); // No expiration

      const cleanupResult = await provider.cleanupExpiredTasks();
      expect(cleanupResult.success).toBe(true);
      if (cleanupResult.success) {
        expect(cleanupResult.data).toBe(0);
      }
    });
  });

  describe('Health Check', () => {
    let provider: Awaited<ReturnType<typeof createA2AInMemoryTaskProvider>>;

    beforeEach(async () => {
      provider = await createA2AInMemoryTaskProvider(defaultConfig);
    });

    it('should return healthy status', async () => {
      const healthResult = await provider.healthCheck();
      expect(healthResult.success).toBe(true);
      if (healthResult.success) {
        expect(healthResult.data.healthy).toBe(true);
        expect(healthResult.data.latencyMs).toBeDefined();
        expect(typeof healthResult.data.latencyMs).toBe('number');
      }
    });
  });

  describe('Provider Lifecycle', () => {
    it('should close gracefully', async () => {
      const provider = await createA2AInMemoryTaskProvider(defaultConfig);
      const closeResult = await provider.close();
      expect(closeResult.success).toBe(true);
    });
  });

  describe('Concurrent Operations', () => {
    let provider: Awaited<ReturnType<typeof createA2AInMemoryTaskProvider>>;

    beforeEach(async () => {
      provider = await createA2AInMemoryTaskProvider(defaultConfig);
    });

    it('should handle concurrent task storage', async () => {
      const tasks = Array.from({ length: 10 }, (_, i) => createTestTask(`concurrent_task_${i}`));
      
      const storePromises = tasks.map(task => provider.storeTask(task));
      const results = await Promise.all(storePromises);
      
      // All stores should succeed
      expect(results.every(result => result.success)).toBe(true);
      
      // All tasks should be retrievable
      const getPromises = tasks.map(task => provider.getTask(task.id));
      const getResults = await Promise.all(getPromises);
      
      expect(getResults.every(result => result.success && result.data !== null)).toBe(true);
    });

    it('should handle concurrent updates safely', async () => {
      const task = createTestTask();
      await provider.storeTask(task);

      // Try to update the same task concurrently
      const updatePromises = Array.from({ length: 5 }, (_, i) => 
        provider.updateTaskStatus(task.id, 'working', { iteration: i })
      );
      
      const results = await Promise.all(updatePromises);
      
      // All updates should succeed (last one wins)
      expect(results.every(result => result.success)).toBe(true);
      
      // Task should still exist and be valid
      const finalTask = await provider.getTask(task.id);
      expect(finalTask.success).toBe(true);
      if (finalTask.success) {
        expect(finalTask.data).toBeDefined();
      }
    });
  });

  describe('Edge Cases', () => {
    let provider: Awaited<ReturnType<typeof createA2AInMemoryTaskProvider>>;

    beforeEach(async () => {
      provider = await createA2AInMemoryTaskProvider(defaultConfig);
    });

    it('should handle malformed task data gracefully', async () => {
      // This tests internal resilience - serialization errors should be caught
      const taskWithCircularRef = createTestTask();
      (taskWithCircularRef as any).circular = taskWithCircularRef;

      const storeResult = await provider.storeTask(taskWithCircularRef);
      expect(storeResult.success).toBe(false);
    });

    it('should handle empty query parameters', async () => {
      const emptyQuery: A2ATaskQuery = {};
      const result = await provider.findTasks(emptyQuery);
      expect(result.success).toBe(true);
    });

    it('should handle invalid date ranges in queries', async () => {
      const invalidQuery: A2ATaskQuery = {
        since: new Date('2025-01-01'),  // Future date
        until: new Date('2020-01-01')   // Past date
      };
      
      const result = await provider.findTasks(invalidQuery);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(0); // Should return empty array
      }
    });
  });
});