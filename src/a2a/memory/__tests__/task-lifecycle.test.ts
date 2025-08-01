/**
 * A2A Task Lifecycle Integration Tests
 * End-to-end tests for A2A task management through complete lifecycle
 */

import { createA2AInMemoryTaskProvider } from '../providers/in-memory.js';
import { performTaskCleanup, defaultCleanupConfig } from '../cleanup.js';
import { A2ATaskProvider, A2AInMemoryTaskConfig } from '../types.js';
import { A2ATask, TaskState } from '../../types.js';

describe('A2A Task Lifecycle Integration', () => {
  // Helper to create test task
  const createTestTask = (
    id: string = 'task_123',
    contextId: string = 'ctx_456',
    state: TaskState = 'submitted'
  ): A2ATask => ({
    id,
    contextId,
    kind: 'task',
    status: {
      state,
      message: {
        role: 'agent' as const,
        parts: [{ kind: 'text', text: `Task ${id} is ${state}` }],
        messageId: `msg_${id}`,
        contextId,
        kind: 'message'
      },
      timestamp: new Date().toISOString()
    },
    history: [
      {
        role: 'user' as const,
        parts: [{ kind: 'text', text: `Please process ${id}` }],
        messageId: `msg_user_${id}`,
        contextId,
        kind: 'message'
      }
    ],
    artifacts: [],
    metadata: {
      createdAt: new Date().toISOString(),
      priority: 'normal'
    }
  });

  let provider: A2ATaskProvider;

  beforeEach(async () => {
    const config: A2AInMemoryTaskConfig = {
      type: 'memory',
      maxTasks: 1000,
      maxTasksPerContext: 100,
      keyPrefix: 'lifecycle_test:',
      defaultTtl: 3600,
      cleanupInterval: 300,
      enableHistory: true,
      enableArtifacts: true
    };

    provider = await createA2AInMemoryTaskProvider(config);
  });

  afterEach(async () => {
    await provider.close();
  });

  describe('Complete Task Lifecycle', () => {
    it('should handle complete task lifecycle from submission to completion', async () => {
      const taskId = 'lifecycle_task_1';
      const contextId = 'lifecycle_ctx_1';

      // Step 1: Submit task
      const submittedTask = createTestTask(taskId, contextId, 'submitted');
      const storeResult = await provider.storeTask(submittedTask);
      expect(storeResult.success).toBe(true);

      // Verify task is stored and retrievable
      const getResult1 = await provider.getTask(taskId);
      expect(getResult1.success).toBe(true);
      if (getResult1.success) {
        expect(getResult1.data?.status.state).toBe('submitted');
      }

      // Step 2: Task starts working
      const updateWorkingResult = await provider.updateTaskStatus(
        taskId, 
        'working', 
        { 
          role: 'agent' as const,
          parts: [{ kind: 'text', text: 'Starting to process your request...' }],
          messageId: 'msg_working',
          contextId,
          kind: 'message'
        }
      );
      expect(updateWorkingResult.success).toBe(true);

      // Verify state change
      const getResult2 = await provider.getTask(taskId);
      expect(getResult2.success).toBe(true);
      if (getResult2.success) {
        expect(getResult2.data?.status.state).toBe('working');
      }

      // Step 3: Add intermediate status updates
      for (let i = 1; i <= 3; i++) {
        const intermediateUpdate = await provider.updateTaskStatus(
          taskId,
          'working',
          {
            role: 'agent' as const,
            parts: [{ kind: 'text', text: `Processing step ${i} of 3...` }],
            messageId: `msg_step_${i}`,
            contextId,
            kind: 'message'
          }
        );
        expect(intermediateUpdate.success).toBe(true);
      }

      // Step 4: Complete the task
      const completedTask = { 
        ...submittedTask, 
        status: { 
          ...submittedTask.status, 
          state: 'completed' as TaskState,
          message: {
            role: 'agent' as const,
            parts: [{ kind: 'text' as const, text: 'Task completed successfully!' }],
            messageId: 'msg_completed',
            contextId,
            kind: 'message'
          }
        },
        artifacts: [
          {
            artifactId: 'result_artifact',
            name: 'Task Result',
            description: 'The final result of the task',
            parts: [{ kind: 'text' as const, text: 'Task completed with success!' }],
            kind: 'artifact'
          }
        ]
      };

      const updateCompletedResult = await provider.updateTask(completedTask);
      expect(updateCompletedResult.success).toBe(true);

      // Step 5: Verify final state
      const finalResult = await provider.getTask(taskId);
      expect(finalResult.success).toBe(true);
      if (finalResult.success && finalResult.data) {
        expect(finalResult.data.status.state).toBe('completed');
        expect(finalResult.data.artifacts).toHaveLength(1);
        expect(finalResult.data.artifacts![0].name).toBe('Task Result');
      }

      // Step 6: Verify task appears in queries
      const contextTasks = await provider.getTasksByContext(contextId);
      expect(contextTasks.success).toBe(true);
      if (contextTasks.success) {
        expect(contextTasks.data).toHaveLength(1);
      }

      const completedTasks = await provider.findTasks({ state: 'completed' });
      expect(completedTasks.success).toBe(true);
      if (completedTasks.success) {
        expect(completedTasks.data.some((task: any) => task.id === taskId)).toBe(true);
      }
    });

    it('should handle task failure scenario', async () => {
      const taskId = 'failed_task_1';
      const contextId = 'failed_ctx_1';

      // Submit and start working
      const task = createTestTask(taskId, contextId, 'submitted');
      await provider.storeTask(task);
      await provider.updateTaskStatus(taskId, 'working');

      // Simulate failure
      const failureMessage = {
        role: 'agent' as const,
        parts: [{ kind: 'text', text: 'Task failed due to invalid input' }],
        messageId: 'msg_failed',
        contextId,
        kind: 'message'
      };

      const failResult = await provider.updateTaskStatus(taskId, 'failed', failureMessage);
      expect(failResult.success).toBe(true);

      // Verify failure state
      const getResult = await provider.getTask(taskId);
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data?.status.state).toBe('failed');
      }

      // Verify appears in failed tasks query
      const failedTasks = await provider.findTasks({ state: 'failed' });
      expect(failedTasks.success).toBe(true);
      if (failedTasks.success) {
        expect(failedTasks.data.some((task: any) => task.id === taskId)).toBe(true);
      }
    });

    it('should handle task cancellation', async () => {
      const taskId = 'canceled_task_1';
      const contextId = 'canceled_ctx_1';

      // Submit and start working
      const task = createTestTask(taskId, contextId, 'working');
      await provider.storeTask(task);

      // Cancel the task
      const cancelResult = await provider.updateTaskStatus(taskId, 'canceled', {
        role: 'system' as const,
        parts: [{ kind: 'text', text: 'Task was canceled by user request' }],
        messageId: 'msg_canceled',
        contextId,
        kind: 'message'
      });
      expect(cancelResult.success).toBe(true);

      // Verify cancellation
      const getResult = await provider.getTask(taskId);
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data?.status.state).toBe('canceled');
      }
    });
  });

  describe('Multi-Task Context Management', () => {
    it('should manage multiple tasks within same context', async () => {
      const contextId = 'multi_task_ctx';
      const taskIds = ['task_1', 'task_2', 'task_3', 'task_4', 'task_5'];

      // Create multiple tasks in same context
      for (let i = 0; i < taskIds.length; i++) {
        const task = createTestTask(taskIds[i], contextId, 'submitted');
        const storeResult = await provider.storeTask(task);
        expect(storeResult.success).toBe(true);
      }

      // Process tasks through different states
      await provider.updateTaskStatus(taskIds[0], 'working');
      await provider.updateTaskStatus(taskIds[1], 'completed');
      await provider.updateTaskStatus(taskIds[2], 'failed');
      await provider.updateTaskStatus(taskIds[3], 'working');
      // Leave taskIds[4] as submitted

      // Verify all tasks are in context
      const contextTasks = await provider.getTasksByContext(contextId);
      expect(contextTasks.success).toBe(true);
      if (contextTasks.success) {
        expect(contextTasks.data).toHaveLength(5);
      }

      // Verify task distribution by state
      const stats = await provider.getTaskStats(contextId);
      expect(stats.success).toBe(true);
      if (stats.success) {
        expect(stats.data.totalTasks).toBe(5);
        expect(stats.data.tasksByState.submitted).toBe(1);
        expect(stats.data.tasksByState.working).toBe(2);
        expect(stats.data.tasksByState.completed).toBe(1);
        expect(stats.data.tasksByState.failed).toBe(1);
      }
    });

    it('should handle bulk operations on context', async () => {
      const contextId = 'bulk_ctx';
      const taskCount = 10;

      // Create multiple tasks
      for (let i = 1; i <= taskCount; i++) {
        const task = createTestTask(`bulk_task_${i}`, contextId, 'working');
        await provider.storeTask(task);
      }

      // Verify all tasks exist
      const allTasks = await provider.getTasksByContext(contextId);
      expect(allTasks.success).toBe(true);
      if (allTasks.success) {
        expect(allTasks.data).toHaveLength(taskCount);
      }

      // Bulk delete by context
      const deleteResult = await provider.deleteTasksByContext(contextId);
      expect(deleteResult.success).toBe(true);
      if (deleteResult.success) {
        expect(deleteResult.data).toBe(taskCount);
      }

      // Verify all tasks are gone
      const remainingTasks = await provider.getTasksByContext(contextId);
      expect(remainingTasks.success).toBe(true);
      if (remainingTasks.success) {
        expect(remainingTasks.data).toHaveLength(0);
      }
    });
  });

  describe('Task Expiration and Cleanup Integration', () => {
    it('should handle task expiration throughout lifecycle', async () => {
      const taskId = 'expiring_task';
      const contextId = 'expiring_ctx';

      // Create task with short expiration
      const task = createTestTask(taskId, contextId, 'working');
      const shortExpiration = new Date(Date.now() + 100); // 100ms from now
      
      const storeResult = await provider.storeTask(task, { expiresAt: shortExpiration });
      expect(storeResult.success).toBe(true);

      // Task should be retrievable immediately
      const getResult1 = await provider.getTask(taskId);
      expect(getResult1.success).toBe(true);
      if (getResult1.success) {
        expect(getResult1.data).toBeDefined();
      }

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      // Task should no longer be retrievable
      const getResult2 = await provider.getTask(taskId);
      expect(getResult2.success).toBe(true);
      if (getResult2.success) {
        expect(getResult2.data).toBeNull();
      }

      // Cleanup should handle expired tasks
      const cleanupResult = await provider.cleanupExpiredTasks();
      expect(cleanupResult.success).toBe(true);
      if (cleanupResult.success) {
        expect(typeof cleanupResult.data).toBe('number');
      }
    });

    it('should integrate with cleanup service', async () => {
      const contextId = 'cleanup_integration_ctx';

      // Create tasks with different ages (simulated)
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000); // 8 days ago

      // Create recent tasks
      for (let i = 1; i <= 3; i++) {
        const task = createTestTask(`recent_task_${i}`, contextId, 'completed');
        await provider.storeTask(task);
      }

      // Create old tasks (simulate by modifying after storage)
      for (let i = 1; i <= 5; i++) {
        const task = createTestTask(`old_task_${i}`, contextId, 'completed');
        task.status.timestamp = oldTimestamp.toISOString();
        task.metadata!.createdAt = oldTimestamp.toISOString();
        await provider.storeTask(task);
      }

      // Verify all tasks exist
      const allTasksBefore = await provider.getTasksByContext(contextId);
      expect(allTasksBefore.success).toBe(true);
      if (allTasksBefore.success) {
        expect(allTasksBefore.data).toHaveLength(8);
      }

      // Run cleanup with 7-day max age
      const cleanupConfig = {
        ...defaultCleanupConfig,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        maxCompletedTasks: 1000, // Don't limit by count
        maxFailedTasks: 1000
      };

      const cleanupResult = await performTaskCleanup(provider, cleanupConfig);
      expect(cleanupResult.success).toBe(true);

      // Verify old tasks are cleaned up
      const allTasksAfter = await provider.getTasksByContext(contextId);
      expect(allTasksAfter.success).toBe(true);
      if (allTasksAfter.success) {
        expect(allTasksAfter.data.length).toBeLessThan(8);
      }
    });
  });

  describe('Concurrent Task Operations', () => {
    it('should handle concurrent task lifecycle operations', async () => {
      const contextId = 'concurrent_ctx';
      const taskCount = 20;
      const tasks: A2ATask[] = [];

      // Create tasks concurrently
      for (let i = 1; i <= taskCount; i++) {
        tasks.push(createTestTask(`concurrent_task_${i}`, contextId, 'submitted'));
      }

      const storePromises = tasks.map(task => provider.storeTask(task));
      const storeResults = await Promise.all(storePromises);

      // All stores should succeed
      expect(storeResults.every(result => result.success)).toBe(true);

      // Update tasks to different states concurrently
      const updatePromises = tasks.map((task, index) => {
        const state: TaskState = index % 4 === 0 ? 'working' :
                                 index % 4 === 1 ? 'completed' :
                                 index % 4 === 2 ? 'failed' : 'submitted';
        return provider.updateTaskStatus(task.id, state);
      });

      const updateResults = await Promise.all(updatePromises);
      expect(updateResults.every(result => result.success)).toBe(true);

      // Verify final state distribution
      const stats = await provider.getTaskStats(contextId);
      expect(stats.success).toBe(true);
      if (stats.success) {
        expect(stats.data.totalTasks).toBe(taskCount);
        expect(stats.data.tasksByState.working).toBe(5);
        expect(stats.data.tasksByState.completed).toBe(5);
        expect(stats.data.tasksByState.failed).toBe(5);
        expect(stats.data.tasksByState.submitted).toBe(5);
      }
    });

    it('should handle rapid state transitions', async () => {
      const taskId = 'rapid_transition_task';
      const contextId = 'rapid_ctx';

      // Create task
      const task = createTestTask(taskId, contextId, 'submitted');
      await provider.storeTask(task);

      // Perform rapid state transitions
      const states: TaskState[] = ['working', 'working', 'working', 'completed'];
      
      for (const state of states) {
        const updateResult = await provider.updateTaskStatus(
          taskId, 
          state, 
          {
            role: 'agent' as const,
            parts: [{ kind: 'text', text: `Transitioning to ${state}` }],
            messageId: `msg_${state}_${Date.now()}`,
            contextId,
            kind: 'message'
          }
        );
        expect(updateResult.success).toBe(true);
      }

      // Verify final state
      const finalResult = await provider.getTask(taskId);
      expect(finalResult.success).toBe(true);
      if (finalResult.success) {
        expect(finalResult.data?.status.state).toBe('completed');
      }
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from partial update failures', async () => {
      const taskId = 'recovery_task';
      const contextId = 'recovery_ctx';

      // Create task
      const task = createTestTask(taskId, contextId, 'working');
      await provider.storeTask(task);

      // Attempt to update non-existent task (should fail gracefully)
      const invalidUpdate = await provider.updateTaskStatus('non_existent_task', 'completed');
      expect(invalidUpdate.success).toBe(false);

      // Valid task should still be unaffected
      const getResult = await provider.getTask(taskId);
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data?.status.state).toBe('working');
      }

      // Should still be able to update the valid task
      const validUpdate = await provider.updateTaskStatus(taskId, 'completed');
      expect(validUpdate.success).toBe(true);
    });

    it('should maintain data integrity under stress', async () => {
      const contextId = 'stress_ctx';
      const taskCount = 50;

      // Create many tasks rapidly
      const createPromises = Array.from({ length: taskCount }, (_, i) => {
        const task = createTestTask(`stress_task_${i}`, contextId, 'submitted');
        return provider.storeTask(task);
      });

      await Promise.all(createPromises);

      // Perform random operations
      const operations = [];
      for (let i = 0; i < 100; i++) {
        const taskIndex = Math.floor(Math.random() * taskCount);
        const taskId = `stress_task_${taskIndex}`;
        
        if (Math.random() < 0.5) {
          // Update task status
          const state: TaskState = Math.random() < 0.5 ? 'working' : 'completed';
          operations.push(provider.updateTaskStatus(taskId, state));
        } else {
          // Get task
          operations.push(provider.getTask(taskId));
        }
      }

      const results = await Promise.all(operations);
      
      // Most operations should succeed (some updates might fail if task doesn't exist)
      const successRate = results.filter(result => result.success).length / results.length;
      expect(successRate).toBeGreaterThan(0.8);

      // Final verification - all tasks should still be queryable
      const finalTasks = await provider.getTasksByContext(contextId);
      expect(finalTasks.success).toBe(true);
      if (finalTasks.success) {
        expect(finalTasks.data.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Query Performance and Pagination', () => {
    it('should handle large-scale queries efficiently', async () => {
      const contextId = 'large_scale_ctx';
      const taskCount = 100;

      // Create many tasks with different states
      for (let i = 1; i <= taskCount; i++) {
        const state: TaskState = i % 4 === 0 ? 'completed' :
                                 i % 4 === 1 ? 'working' :
                                 i % 4 === 2 ? 'failed' : 'submitted';
        const task = createTestTask(`large_task_${i}`, contextId, state);
        await provider.storeTask(task);
      }

      // Test paginated queries
      const pageSize = 20;
      let allTasks: A2ATask[] = [];
      let offset = 0;

      while (true) {
        const pageResult = await provider.findTasks({ 
          contextId, 
          limit: pageSize, 
          offset 
        });
        
        expect(pageResult.success).toBe(true);
        if (!pageResult.success || pageResult.data.length === 0) break;

        allTasks = allTasks.concat(pageResult.data);
        offset += pageSize;

        // Prevent infinite loop
        if (offset > taskCount * 2) break;
      }

      expect(allTasks.length).toBe(taskCount);

      // Test state-specific queries
      const completedTasks = await provider.findTasks({ 
        contextId, 
        state: 'completed' 
      });
      expect(completedTasks.success).toBe(true);
      if (completedTasks.success) {
        expect(completedTasks.data.length).toBe(25); // 25% are completed
      }

      // Test global statistics
      const globalStats = await provider.getTaskStats();
      expect(globalStats.success).toBe(true);
      if (globalStats.success) {
        expect(globalStats.data.totalTasks).toBeGreaterThanOrEqual(taskCount);
      }
    });
  });
});