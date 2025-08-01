/**
 * A2A External Providers Tests
 * Mock tests for Redis and PostgreSQL providers to test logic without external dependencies
 */

import { createA2ARedisTaskProvider } from '../providers/redis.js';
import { createA2APostgresTaskProvider } from '../providers/postgres.js';
import { A2ARedisTaskConfig, A2APostgresTaskConfig } from '../types.js';
import { A2ATask, TaskState } from '../../types.js';

describe('A2A External Providers', () => {
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

  describe('Redis Provider', () => {
    const defaultRedisConfig: A2ARedisTaskConfig = {
      type: 'redis',
      host: 'localhost',
      port: 6379,
      db: 0,
      maxTasks: 10000,
      keyPrefix: 'test:redis:',
      defaultTtl: 3600,
      cleanupInterval: 300,
      enableHistory: true,
      enableArtifacts: true
    };

    // Mock Redis client
    let mockRedisClient: any;
    let mockMulti: any;

    beforeEach(() => {
      mockMulti = {
        hmset: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        sadd: jest.fn().mockReturnThis(),
        hincrby: jest.fn().mockReturnThis(),
        del: jest.fn().mockReturnThis(),
        srem: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      };

      mockRedisClient = {
        ping: jest.fn().mockResolvedValue('PONG'),
        exists: jest.fn().mockResolvedValue(1),
        hgetall: jest.fn().mockResolvedValue({}),
        hmset: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
        sadd: jest.fn().mockResolvedValue(1),
        smembers: jest.fn().mockResolvedValue([]),
        srem: jest.fn().mockResolvedValue(1),
        keys: jest.fn().mockResolvedValue([]),
        hincrby: jest.fn().mockResolvedValue(1),
        multi: jest.fn().mockReturnValue(mockMulti)
      };
    });

    it('should create Redis provider with mock client', async () => {
      const provider = await createA2ARedisTaskProvider(defaultRedisConfig, mockRedisClient);
      expect(provider).toBeDefined();
      expect(typeof provider.storeTask).toBe('function');
    });

    it('should store task in Redis', async () => {
      const provider = await createA2ARedisTaskProvider(defaultRedisConfig, mockRedisClient);
      const task = createTestTask();

      // Mock successful storage
      mockRedisClient.exists.mockResolvedValueOnce(0); // Task doesn't exist
      mockMulti.exec.mockResolvedValueOnce(['OK', 1, 1, 1]); // All operations succeed

      const result = await provider.storeTask(task);
      expect(result.success).toBe(true);

      // Verify Redis operations were called
      expect(mockRedisClient.multi).toHaveBeenCalled();
      expect(mockMulti.hmset).toHaveBeenCalled();
      expect(mockMulti.sadd).toHaveBeenCalledTimes(2); // Context and state indices
      expect(mockMulti.hincrby).toHaveBeenCalledTimes(2); // Total and state stats
    });

    it('should retrieve task from Redis', async () => {
      const provider = await createA2ARedisTaskProvider(defaultRedisConfig, mockRedisClient);
      const task = createTestTask();

      // Mock task exists and return serialized data
      mockRedisClient.exists.mockResolvedValueOnce(1);
      mockRedisClient.hgetall.mockResolvedValueOnce({
        taskId: task.id,
        contextId: task.contextId,
        state: task.status.state,
        taskData: JSON.stringify(task),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const result = await provider.getTask(task.id);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.data!.id).toBe(task.id);
      }

      expect(mockRedisClient.exists).toHaveBeenCalledWith(`test:redis:task:${task.id}`);
      expect(mockRedisClient.hgetall).toHaveBeenCalledWith(`test:redis:task:${task.id}`);
    });

    it('should return null for non-existent task', async () => {
      const provider = await createA2ARedisTaskProvider(defaultRedisConfig, mockRedisClient);

      mockRedisClient.exists.mockResolvedValueOnce(0);

      const result = await provider.getTask('non_existent');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('should update task in Redis', async () => {
      const provider = await createA2ARedisTaskProvider(defaultRedisConfig, mockRedisClient);
      const task = createTestTask();

      // Mock task exists
      mockRedisClient.exists.mockResolvedValueOnce(1);
      mockRedisClient.hgetall.mockResolvedValueOnce({
        state: 'submitted', // Old state
        metadata: JSON.stringify({ existing: 'data' })
      });
      mockMulti.exec.mockResolvedValueOnce(['OK']);

      const result = await provider.updateTask(task);
      expect(result.success).toBe(true);

      expect(mockRedisClient.exists).toHaveBeenCalled();
      expect(mockMulti.hmset).toHaveBeenCalled();
    });

    it('should update task status in Redis', async () => {
      const provider = await createA2ARedisTaskProvider(defaultRedisConfig, mockRedisClient);
      const taskId = 'task_status_test';

      // Mock existing task
      mockRedisClient.exists.mockResolvedValueOnce(1);
      mockRedisClient.hgetall.mockResolvedValueOnce({
        taskId,
        contextId: 'ctx_test',
        state: 'working',
        taskData: JSON.stringify(createTestTask(taskId, 'ctx_test', 'working')),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Mock updateTask operations (called by updateTaskStatus)
      mockRedisClient.exists.mockResolvedValueOnce(1); // Second exists check in updateTask
      mockRedisClient.hgetall.mockResolvedValueOnce({
        state: 'working',
        metadata: '{}'
      });
      mockMulti.exec.mockResolvedValueOnce(['OK']); // Multi exec for update operations

      const result = await provider.updateTaskStatus(taskId, 'completed', { result: 'success' });
      expect(result.success).toBe(true);

      expect(mockRedisClient.exists).toHaveBeenCalled();
      expect(mockRedisClient.hgetall).toHaveBeenCalled();
    });

    it('should find tasks by query', async () => {
      const provider = await createA2ARedisTaskProvider(defaultRedisConfig, mockRedisClient);
      const contextId = 'test_context';

      // Mock context index
      mockRedisClient.smembers.mockResolvedValueOnce(['task1', 'task2']);
      
      // Mock task data for each task
      mockRedisClient.exists.mockResolvedValue(1);
      mockRedisClient.hgetall
        .mockResolvedValueOnce({
          taskId: 'task1',
          contextId,
          state: 'working',
          taskData: JSON.stringify(createTestTask('task1', contextId, 'working')),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .mockResolvedValueOnce({
          taskId: 'task2',
          contextId,
          state: 'completed',
          taskData: JSON.stringify(createTestTask('task2', contextId, 'completed')),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

      const result = await provider.findTasks({ contextId });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
      }

      expect(mockRedisClient.smembers).toHaveBeenCalledWith(`test:redis:context:${contextId}`);
    });

    it('should delete task from Redis', async () => {
      const provider = await createA2ARedisTaskProvider(defaultRedisConfig, mockRedisClient);
      const taskId = 'task_to_delete';

      // Mock task exists
      mockRedisClient.exists.mockResolvedValueOnce(1);
      mockRedisClient.hgetall.mockResolvedValueOnce({
        contextId: 'ctx_delete',
        state: 'completed'
      });
      mockMulti.exec.mockResolvedValueOnce([1, 1, 1]); // All deletes succeed

      const result = await provider.deleteTask(taskId);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(true);
      }

      expect(mockMulti.del).toHaveBeenCalledWith(`test:redis:task:${taskId}`);
      expect(mockMulti.srem).toHaveBeenCalledTimes(2); // Context and state indices
      expect(mockMulti.hincrby).toHaveBeenCalledWith('test:redis:stats', 'totalTasks', -1);
    });

    it('should get task statistics from Redis', async () => {
      const provider = await createA2ARedisTaskProvider(defaultRedisConfig, mockRedisClient);

      // Mock global stats
      mockRedisClient.hgetall.mockResolvedValueOnce({
        totalTasks: '10',
        'state:working': '3',
        'state:completed': '5',
        'state:failed': '2'
      });

      const result = await provider.getTaskStats();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalTasks).toBe(10);
        expect(result.data.tasksByState.working).toBe(3);
        expect(result.data.tasksByState.completed).toBe(5);
        expect(result.data.tasksByState.failed).toBe(2);
      }
    });

    it('should perform health check on Redis', async () => {
      const provider = await createA2ARedisTaskProvider(defaultRedisConfig, mockRedisClient);

      const result = await provider.healthCheck();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.healthy).toBe(true);
        expect(typeof result.data.latencyMs).toBe('number');
      }

      expect(mockRedisClient.ping).toHaveBeenCalled();
    });

    it('should handle Redis connection errors gracefully', async () => {
      const provider = await createA2ARedisTaskProvider(defaultRedisConfig, mockRedisClient);

      // Mock Redis error
      mockRedisClient.ping.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await provider.healthCheck();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.healthy).toBe(false);
        expect(result.data.error).toBe('Connection failed');
      }
    });

    it('should cleanup expired tasks in Redis', async () => {
      const provider = await createA2ARedisTaskProvider(defaultRedisConfig, mockRedisClient);

      // Mock expired tasks cleanup (Redis handles TTL automatically)
      mockRedisClient.keys.mockResolvedValueOnce(['test:redis:task:expired1']);
      mockRedisClient.exists.mockResolvedValueOnce(0); // Task expired
      
      // Mock deleteTask operations (called by cleanupExpiredTasks)
      mockRedisClient.exists.mockResolvedValueOnce(0); // Task doesn't exist (expired)

      const result = await provider.cleanupExpiredTasks();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data).toBe('number');
      }
    });
  });

  describe('PostgreSQL Provider', () => {
    const defaultPostgresConfig: A2APostgresTaskConfig = {
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'test_db',
      username: 'test_user',
      tableName: 'test_a2a_tasks',
      ssl: false,
      maxConnections: 10,
      maxTasks: 10000,
      keyPrefix: 'test:postgres:',
      defaultTtl: 3600,
      cleanupInterval: 300,
      enableHistory: true,
      enableArtifacts: true
    };

    // Mock PostgreSQL client
    let mockPgClient: any;

    beforeEach(() => {
      mockPgClient = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 })
      };
    });

    it('should create PostgreSQL provider with mock client', async () => {
      const provider = await createA2APostgresTaskProvider(defaultPostgresConfig, mockPgClient);
      expect(provider).toBeDefined();
      expect(typeof provider.storeTask).toBe('function');

      // Verify table creation was attempted
      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS')
      );
    });

    it('should store task in PostgreSQL', async () => {
      const provider = await createA2APostgresTaskProvider(defaultPostgresConfig, mockPgClient);
      const task = createTestTask();

      // Mock successful insert
      mockPgClient.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await provider.storeTask(task);
      expect(result.success).toBe(true);

      // Verify INSERT query was called
      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining([task.id, task.contextId])
      );
    });

    it('should retrieve task from PostgreSQL', async () => {
      const provider = await createA2APostgresTaskProvider(defaultPostgresConfig, mockPgClient);
      const task = createTestTask();

      // Mock task found
      mockPgClient.query.mockResolvedValueOnce({
        rows: [{
          task_id: task.id,
          context_id: task.contextId,
          state: task.status.state,
          task_data: task,
          created_at: new Date(),
          updated_at: new Date()
        }],
        rowCount: 1
      });

      const result = await provider.getTask(task.id);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
      }

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [task.id]
      );
    });

    it('should return null for non-existent task in PostgreSQL', async () => {
      const provider = await createA2APostgresTaskProvider(defaultPostgresConfig, mockPgClient);

      // Mock no rows found
      mockPgClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await provider.getTask('non_existent');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('should update task in PostgreSQL', async () => {
      const provider = await createA2APostgresTaskProvider(defaultPostgresConfig, mockPgClient);
      const task = createTestTask();

      // Mock getTask call (called by updateTask to check existence)
      mockPgClient.query
        .mockResolvedValueOnce({
          rows: [{
            task_id: task.id,
            context_id: task.contextId,
            state: task.status.state,
            task_data: task,
            created_at: new Date(),
            updated_at: new Date()
          }],
          rowCount: 1
        }) // getTask call
        .mockResolvedValueOnce({ 
          rows: [{ metadata: {} }], 
          rowCount: 1 
        }) // Get existing metadata
        .mockResolvedValueOnce({ 
          rows: [], 
          rowCount: 1 
        }); // Update query

      const result = await provider.updateTask(task);
      expect(result.success).toBe(true);

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE'),
        expect.arrayContaining([task.id])
      );
    });

    it('should find tasks with SQL query', async () => {
      const provider = await createA2APostgresTaskProvider(defaultPostgresConfig, mockPgClient);

      // Mock query results
      mockPgClient.query.mockResolvedValueOnce({
        rows: [
          {
            task_id: 'task1',
            context_id: 'ctx1',
            state: 'working',
            task_data: createTestTask('task1', 'ctx1', 'working'),
            created_at: new Date(),
            updated_at: new Date()
          },
          {
            task_id: 'task2',
            context_id: 'ctx1',
            state: 'completed',
            task_data: createTestTask('task2', 'ctx1', 'completed'),
            created_at: new Date(),
            updated_at: new Date()
          }
        ],
        rowCount: 2
      });

      const result = await provider.findTasks({ contextId: 'ctx1' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
      }

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining(['ctx1'])
      );
    });

    it('should delete task from PostgreSQL', async () => {
      const provider = await createA2APostgresTaskProvider(defaultPostgresConfig, mockPgClient);
      const taskId = 'task_to_delete';

      // Mock successful deletion
      mockPgClient.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await provider.deleteTask(taskId);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(true);
      }

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM'),
        [taskId]
      );
    });

    it('should get task statistics from PostgreSQL', async () => {
      const provider = await createA2APostgresTaskProvider(defaultPostgresConfig, mockPgClient);

      // Mock state statistics
      mockPgClient.query
        .mockResolvedValueOnce({
          rows: [
            { state: 'working', count: '3' },
            { state: 'completed', count: '5' },
            { state: 'failed', count: '2' }
          ],
          rowCount: 3
        })
        .mockResolvedValueOnce({
          rows: [{ 
            oldest: new Date('2024-01-01'), 
            newest: new Date('2024-01-10') 
          }],
          rowCount: 1
        });

      const result = await provider.getTaskStats();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalTasks).toBe(10); // 3 + 5 + 2
        expect(result.data.tasksByState.working).toBe(3);
        expect(result.data.tasksByState.completed).toBe(5);
        expect(result.data.tasksByState.failed).toBe(2);
        expect(result.data.oldestTask).toBeDefined();
        expect(result.data.newestTask).toBeDefined();
      }
    });

    it('should perform health check on PostgreSQL', async () => {
      const provider = await createA2APostgresTaskProvider(defaultPostgresConfig, mockPgClient);

      // Mock successful connection test
      mockPgClient.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const result = await provider.healthCheck();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.healthy).toBe(true);
        expect(typeof result.data.latencyMs).toBe('number');
      }

      expect(mockPgClient.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('should handle PostgreSQL connection errors gracefully', async () => {
      const provider = await createA2APostgresTaskProvider(defaultPostgresConfig, mockPgClient);

      // Mock connection error
      mockPgClient.query.mockRejectedValueOnce(new Error('Connection timeout'));

      const result = await provider.healthCheck();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.healthy).toBe(false);
        expect(result.data.error).toBe('Connection timeout');
      }
    });

    it('should cleanup expired tasks in PostgreSQL', async () => {
      const provider = await createA2APostgresTaskProvider(defaultPostgresConfig, mockPgClient);

      // Mock cleanup query
      mockPgClient.query.mockResolvedValueOnce({ rows: [], rowCount: 5 });

      const result = await provider.cleanupExpiredTasks();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(5);
      }

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM')
      );
    });

    it('should handle complex queries with pagination and filters', async () => {
      const provider = await createA2APostgresTaskProvider(defaultPostgresConfig, mockPgClient);

      // Mock paginated query
      mockPgClient.query.mockResolvedValueOnce({
        rows: [
          {
            task_id: 'task1',
            context_id: 'ctx1',
            state: 'working',
            task_data: createTestTask('task1', 'ctx1', 'working'),
            created_at: new Date(),
            updated_at: new Date()
          }
        ],
        rowCount: 1
      });

      const result = await provider.findTasks({
        contextId: 'ctx1',
        state: 'working',
        limit: 10,
        offset: 0,
        since: new Date('2024-01-01'),
        until: new Date('2024-12-31')
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
      }

      // Verify complex WHERE clause was constructed
      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 10'),
        expect.arrayContaining(['ctx1', 'working'])
      );
    });
  });

  describe('Error Handling for External Providers', () => {
    it('should handle Redis client errors gracefully', async () => {
      const testRedisConfig: A2ARedisTaskConfig = {
        type: 'redis',
        host: 'localhost',
        port: 6379,
        db: 0,
        maxTasks: 1000,
        keyPrefix: 'test:redis:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const mockErrorClient = {
        ping: jest.fn().mockRejectedValue(new Error('Redis connection failed')),
        exists: jest.fn().mockRejectedValue(new Error('Redis error')),
        hgetall: jest.fn().mockRejectedValue(new Error('Redis error')),
        multi: jest.fn().mockReturnValue({
          exec: jest.fn().mockRejectedValue(new Error('Transaction failed'))
        })
      };

      const provider = await createA2ARedisTaskProvider(testRedisConfig, mockErrorClient);
      
      // Operations should fail gracefully
      const storeResult = await provider.storeTask(createTestTask());
      expect(storeResult.success).toBe(false);

      const getResult = await provider.getTask('test');
      expect(getResult.success).toBe(false);
    });

    it('should handle PostgreSQL client errors gracefully', async () => {
      const testPostgresConfig: A2APostgresTaskConfig = {
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        username: 'test_user',
        tableName: 'test_a2a_tasks',
        ssl: false,
        maxConnections: 10,
        maxTasks: 1000,
        keyPrefix: 'test:postgres:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const mockErrorClient = {
        query: jest.fn().mockRejectedValue(new Error('PostgreSQL connection failed'))
      };

      try {
        const provider = await createA2APostgresTaskProvider(testPostgresConfig, mockErrorClient);
        
        // Operations should fail gracefully
        const storeResult = await provider.storeTask(createTestTask());
        expect(storeResult.success).toBe(false);

        const getResult = await provider.getTask('test');
        expect(getResult.success).toBe(false);
      } catch (error) {
        // Provider creation itself should fail gracefully with connection errors
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('PostgreSQL connection failed');
      }
    });

    it('should handle malformed data from external systems', async () => {
      const testRedisConfig: A2ARedisTaskConfig = {
        type: 'redis',
        host: 'localhost',
        port: 6379,
        db: 0,
        maxTasks: 1000,
        keyPrefix: 'test:redis:',
        defaultTtl: 3600,
        cleanupInterval: 300,
        enableHistory: true,
        enableArtifacts: true
      };

      const mockRedisClient = {
        ping: jest.fn().mockResolvedValue('PONG'),
        exists: jest.fn().mockResolvedValue(1),
        hgetall: jest.fn().mockResolvedValue({
          taskData: 'invalid json {{{',
          taskId: 'malformed_task'
        }),
        multi: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([])
        })
      };

      const provider = await createA2ARedisTaskProvider(testRedisConfig, mockRedisClient);
      
      const result = await provider.getTask('malformed_task');
      expect(result.success).toBe(false);
    });
  });
});