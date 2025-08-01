/**
 * A2A Redis Task Provider for FAF
 * Pure functional Redis-based storage for A2A tasks
 */

import { A2ATask, TaskState } from '../../types.js';
import { 
  A2ATaskProvider, 
  A2ATaskQuery, 
  A2ARedisTaskConfig,
  createA2ATaskNotFoundError,
  createA2ATaskStorageError,
  createSuccess,
  createFailure
} from '../types.js';
import { 
  serializeA2ATask, 
  deserializeA2ATask, 
  validateTaskIntegrity,
  sanitizeTask,
  A2ATaskSerialized
} from '../serialization.js';

/**
 * Create a Redis-based A2A task provider
 */
export const createA2ARedisTaskProvider = async (
  config: A2ARedisTaskConfig,
  redisClient: any
): Promise<A2ATaskProvider> => {
  const keyPrefix = config.keyPrefix || 'faf:a2a:tasks:';
  
  // Pure functions for key generation
  const getTaskKey = (taskId: string): string => `${keyPrefix}task:${taskId}`;
  const getContextIndexKey = (contextId: string): string => `${keyPrefix}context:${contextId}`;
  const getStateIndexKey = (state: TaskState): string => `${keyPrefix}state:${state}`;
  const getStatsKey = (): string => `${keyPrefix}stats`;
  const getMetaKey = (taskId: string): string => `${keyPrefix}meta:${taskId}`;

  // Pure function to convert Redis hash to serialized task
  const hashToSerializedTask = (hash: Record<string, string>): A2ATaskSerialized => ({
    taskId: hash.taskId,
    contextId: hash.contextId,
    state: hash.state,
    taskData: hash.taskData,
    statusMessage: hash.statusMessage,
    createdAt: hash.createdAt,
    updatedAt: hash.updatedAt,
    metadata: hash.metadata
  });

  // Pure function to convert serialized task to Redis hash
  const serializedTaskToHash = (serialized: A2ATaskSerialized): Record<string, string> => {
    const hash: Record<string, string> = {
      taskId: serialized.taskId,
      contextId: serialized.contextId,
      state: serialized.state,
      taskData: serialized.taskData,
      createdAt: serialized.createdAt,
      updatedAt: serialized.updatedAt
    };

    if (serialized.statusMessage) hash.statusMessage = serialized.statusMessage;
    if (serialized.metadata) hash.metadata = serialized.metadata;

    return hash;
  };

  return {
    storeTask: async (task: A2ATask, metadata?: { expiresAt?: Date; [key: string]: any }) => {
      try {
        // Validate and sanitize task
        const sanitizeResult = sanitizeTask(task);
        if (!sanitizeResult.success) {
          return sanitizeResult as any;
        }

        // Serialize task
        const serializeResult = serializeA2ATask(sanitizeResult.data, metadata);
        if (!serializeResult.success) {
          return serializeResult as any;
        }

        const serialized = serializeResult.data;
        const taskKey = getTaskKey(task.id);
        const contextIndexKey = getContextIndexKey(task.contextId);
        const stateIndexKey = getStateIndexKey(task.status.state);

        // Use Redis transaction for atomicity
        const multi = redisClient.multi();

        // Store task data as hash
        const taskHash = serializedTaskToHash(serialized);
        multi.hmset(taskKey, taskHash);

        // Set TTL if specified
        if (metadata?.expiresAt) {
          const ttlSeconds = Math.floor((metadata.expiresAt.getTime() - Date.now()) / 1000);
          if (ttlSeconds > 0) {
            multi.expire(taskKey, ttlSeconds);
          }
        } else if (config.defaultTtl) {
          multi.expire(taskKey, config.defaultTtl);
        }

        // Add to indices
        multi.sadd(contextIndexKey, task.id);
        multi.sadd(stateIndexKey, task.id);

        // Update stats
        multi.hincrby(getStatsKey(), 'totalTasks', 1);
        multi.hincrby(getStatsKey(), `state:${task.status.state}`, 1);

        await multi.exec();

        return createSuccess(undefined);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('store', 'redis', task.id, error as Error)
        );
      }
    },

    getTask: async (taskId: string) => {
      try {
        const taskKey = getTaskKey(taskId);
        const exists = await redisClient.exists(taskKey);
        
        if (!exists) {
          return createSuccess(null);
        }

        const hash = await redisClient.hgetall(taskKey);
        if (!hash || !hash.taskData) {
          return createSuccess(null);
        }

        const serialized = hashToSerializedTask(hash);
        const deserializeResult = deserializeA2ATask(serialized);
        
        if (!deserializeResult.success) {
          return deserializeResult;
        }

        return createSuccess(deserializeResult.data);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('get', 'redis', taskId, error as Error)
        );
      }
    },

    updateTask: async (task: A2ATask, metadata?: { [key: string]: any }) => {
      try {
        const taskKey = getTaskKey(task.id);
        const exists = await redisClient.exists(taskKey);
        
        if (!exists) {
          return createFailure(createA2ATaskNotFoundError(task.id, 'redis'));
        }

        // Get existing task to check for state changes
        const existingHash = await redisClient.hgetall(taskKey);
        const oldState = existingHash.state as TaskState;

        // Validate and sanitize task
        const sanitizeResult = sanitizeTask(task);
        if (!sanitizeResult.success) {
          return sanitizeResult as any;
        }

        // Merge metadata
        const existingMetadata = existingHash.metadata ? JSON.parse(existingHash.metadata) : {};
        const mergedMetadata = { ...existingMetadata, ...metadata };

        // Serialize updated task
        const serializeResult = serializeA2ATask(sanitizeResult.data, mergedMetadata);
        if (!serializeResult.success) {
          return serializeResult as any;
        }

        const serialized = serializeResult.data;
        const multi = redisClient.multi();

        // Update task data
        const taskHash = serializedTaskToHash(serialized);
        multi.hmset(taskKey, taskHash);

        // Update indices if state changed
        if (oldState !== task.status.state) {
          const oldStateIndexKey = getStateIndexKey(oldState);
          const newStateIndexKey = getStateIndexKey(task.status.state);
          
          multi.srem(oldStateIndexKey, task.id);
          multi.sadd(newStateIndexKey, task.id);

          // Update stats
          multi.hincrby(getStatsKey(), `state:${oldState}`, -1);
          multi.hincrby(getStatsKey(), `state:${task.status.state}`, 1);
        }

        await multi.exec();

        return createSuccess(undefined);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('update', 'redis', task.id, error as Error)
        );
      }
    },

    updateTaskStatus: async (taskId: string, newState: TaskState, statusMessage?: any, timestamp?: string) => {
      try {
        const taskKey = getTaskKey(taskId);
        const exists = await redisClient.exists(taskKey);
        
        if (!exists) {
          return createFailure(createA2ATaskNotFoundError(taskId, 'redis'));
        }

        // Get existing task
        const hash = await redisClient.hgetall(taskKey);
        const serialized = hashToSerializedTask(hash);
        const deserializeResult = deserializeA2ATask(serialized);
        
        if (!deserializeResult.success) {
          return deserializeResult;
        }

        const task = deserializeResult.data;

        // Update task status
        const updatedTask: A2ATask = {
          ...task,
          status: {
            ...task.status,
            state: newState,
            message: statusMessage || task.status.message,
            timestamp: timestamp || new Date().toISOString()
          }
        };

        return provider.updateTask(updatedTask);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('update-status', 'redis', taskId, error as Error)
        );
      }
    },

    findTasks: async (query: A2ATaskQuery) => {
      try {
        let taskIds: string[] = [];

        if (query.contextId) {
          // Get tasks by context
          const contextIndexKey = getContextIndexKey(query.contextId);
          taskIds = await redisClient.smembers(contextIndexKey);
        } else if (query.state) {
          // Get tasks by state
          const stateIndexKey = getStateIndexKey(query.state);
          taskIds = await redisClient.smembers(stateIndexKey);
        } else {
          // Get all task keys and extract IDs
          const pattern = `${keyPrefix}task:*`;
          const keys = await redisClient.keys(pattern);
          taskIds = keys.map((key: string) => key.replace(`${keyPrefix}task:`, ''));
        }

        // Filter by specific task ID if provided
        if (query.taskId) {
          taskIds = taskIds.filter(id => id === query.taskId);
        }

        // Fetch tasks and apply additional filters
        const results: A2ATask[] = [];
        
        for (const taskId of taskIds) {
          const taskKey = getTaskKey(taskId);
          const exists = await redisClient.exists(taskKey);
          
          if (!exists) continue;

          const hash = await redisClient.hgetall(taskKey);
          if (!hash || !hash.taskData) continue;

          // Apply date filters
          if (query.since) {
            const createdAt = new Date(hash.createdAt);
            if (createdAt < query.since) continue;
          }
          if (query.until) {
            const createdAt = new Date(hash.createdAt);
            if (createdAt > query.until) continue;
          }

          const serialized = hashToSerializedTask(hash);
          const deserializeResult = deserializeA2ATask(serialized);
          
          if (deserializeResult.success) {
            results.push(deserializeResult.data);
          }
        }

        // Sort by timestamp (newest first)
        results.sort((a, b) => {
          const timeA = new Date(a.status.timestamp || '').getTime();
          const timeB = new Date(b.status.timestamp || '').getTime();
          return timeB - timeA;
        });

        // Apply pagination
        const offset = query.offset || 0;
        const limit = query.limit || results.length;
        const paginatedResults = results.slice(offset, offset + limit);

        return createSuccess(paginatedResults);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('find', 'redis', undefined, error as Error)
        );
      }
    },

    getTasksByContext: async (contextId: string, limit?: number) => {
      return provider.findTasks({ contextId, limit });
    },

    deleteTask: async (taskId: string) => {
      try {
        const taskKey = getTaskKey(taskId);
        const exists = await redisClient.exists(taskKey);
        
        if (!exists) {
          return createSuccess(false);
        }

        // Get task data for index cleanup
        const hash = await redisClient.hgetall(taskKey);
        const contextId = hash.contextId;
        const state = hash.state as TaskState;

        const multi = redisClient.multi();

        // Delete task
        multi.del(taskKey);

        // Remove from indices
        if (contextId) {
          const contextIndexKey = getContextIndexKey(contextId);
          multi.srem(contextIndexKey, taskId);
        }

        if (state) {
          const stateIndexKey = getStateIndexKey(state);
          multi.srem(stateIndexKey, taskId);
        }

        // Update stats
        multi.hincrby(getStatsKey(), 'totalTasks', -1);
        if (state) {
          multi.hincrby(getStatsKey(), `state:${state}`, -1);
        }

        await multi.exec();

        return createSuccess(true);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('delete', 'redis', taskId, error as Error)
        );
      }
    },

    deleteTasksByContext: async (contextId: string) => {
      try {
        const contextIndexKey = getContextIndexKey(contextId);
        const taskIds = await redisClient.smembers(contextIndexKey);
        
        if (taskIds.length === 0) {
          return createSuccess(0);
        }

        let deletedCount = 0;
        
        for (const taskId of taskIds) {
          const deleteResult = await provider.deleteTask(taskId);
          if (deleteResult.success && deleteResult.data) {
            deletedCount++;
          }
        }

        return createSuccess(deletedCount);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('delete-by-context', 'redis', undefined, error as Error)
        );
      }
    },

    cleanupExpiredTasks: async () => {
      try {
        // Redis automatically handles TTL expiration, but we can clean up orphaned indices
        const pattern = `${keyPrefix}task:*`;
        const taskKeys = await redisClient.keys(pattern);
        let cleanedCount = 0;

        for (const taskKey of taskKeys) {
          const exists = await redisClient.exists(taskKey);
          if (!exists) {
            // This shouldn't happen with Redis TTL, but clean up if needed
            const taskId = taskKey.replace(`${keyPrefix}task:`, '');
            const deleteResult = await provider.deleteTask(taskId);
            if (deleteResult.success && deleteResult.data) {
              cleanedCount++;
            }
          }
        }

        return createSuccess(cleanedCount);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('cleanup', 'redis', undefined, error as Error)
        );
      }
    },

    getTaskStats: async (contextId?: string) => {
      try {
        const tasksByState: Record<TaskState, number> = {
          submitted: 0,
          working: 0,
          'input-required': 0,
          completed: 0,
          canceled: 0,
          failed: 0,
          rejected: 0,
          'auth-required': 0,
          unknown: 0
        };

        let totalTasks = 0;
        let oldestTask: Date | undefined;
        let newestTask: Date | undefined;

        if (contextId) {
          // Get tasks for specific context
          const contextIndexKey = getContextIndexKey(contextId);
          const taskIds = await redisClient.smembers(contextIndexKey);
          
          for (const taskId of taskIds) {
            const taskKey = getTaskKey(taskId);
            const exists = await redisClient.exists(taskKey);
            
            if (!exists) continue;

            const hash = await redisClient.hgetall(taskKey);
            if (!hash) continue;

            totalTasks++;
            const state = hash.state as TaskState;
            if (state) {
              tasksByState[state]++;
            }

            const createdAt = new Date(hash.createdAt);
            if (!oldestTask || createdAt < oldestTask) {
              oldestTask = createdAt;
            }
            if (!newestTask || createdAt > newestTask) {
              newestTask = createdAt;
            }
          }
        } else {
          // Get global stats from Redis hash
          const statsKey = getStatsKey();
          const stats = await redisClient.hgetall(statsKey);
          
          totalTasks = parseInt(stats.totalTasks || '0');
          
          // Get state counts
          for (const state of Object.keys(tasksByState) as TaskState[]) {
            tasksByState[state] = parseInt(stats[`state:${state}`] || '0');
          }

          // For global stats, we'd need to scan all tasks to get date ranges
          // This is expensive, so we'll leave them undefined for now
        }

        return createSuccess({
          totalTasks,
          tasksByState,
          oldestTask,
          newestTask
        });
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('stats', 'redis', undefined, error as Error)
        );
      }
    },

    healthCheck: async () => {
      try {
        const startTime = Date.now();
        
        // Simple ping to Redis
        await redisClient.ping();
        
        const latencyMs = Date.now() - startTime;

        return createSuccess({
          healthy: true,
          latencyMs
        });
      } catch (error) {
        return createSuccess({
          healthy: false,
          error: (error as Error).message
        });
      }
    },

    close: async () => {
      try {
        // Redis client cleanup is typically handled externally
        // We don't close the client here as it might be shared
        return createSuccess(undefined);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('close', 'redis', undefined, error as Error)
        );
      }
    }
  };

  // Create the provider object
  const provider: A2ATaskProvider = {
    storeTask: async (task: A2ATask, metadata?: { expiresAt?: Date; [key: string]: any }) => {
      // Implementation is in the returned object above
      return createSuccess(undefined);
    },
    getTask: async (taskId: string) => createSuccess(null),
    updateTask: async (task: A2ATask, metadata?: { [key: string]: any }) => createSuccess(undefined),
    updateTaskStatus: async (taskId: string, state: TaskState, statusMessage?: any, timestamp?: string) => createSuccess(undefined),
    findTasks: async (query: A2ATaskQuery) => createSuccess([]),
    getTasksByContext: async (contextId: string, limit?: number) => createSuccess([]),
    deleteTask: async (taskId: string) => createSuccess(false),
    deleteTasksByContext: async (contextId: string) => createSuccess(0),
    cleanupExpiredTasks: async () => createSuccess(0),
    getTaskStats: async (contextId?: string) => createSuccess({
      totalTasks: 0,
      tasksByState: {
        submitted: 0, working: 0, 'input-required': 0, completed: 0,
        canceled: 0, failed: 0, rejected: 0, 'auth-required': 0, unknown: 0
      }
    }),
    healthCheck: async () => createSuccess({ healthy: true }),
    close: async () => createSuccess(undefined)
  };

  // Return the actual implementation
  const actualProvider = {
    storeTask: async (task: A2ATask, metadata?: { expiresAt?: Date; [key: string]: any }) => {
      try {
        const sanitizeResult = sanitizeTask(task);
        if (!sanitizeResult.success) return sanitizeResult as any;

        const serializeResult = serializeA2ATask(sanitizeResult.data, metadata);
        if (!serializeResult.success) return serializeResult as any;

        const serialized = serializeResult.data;
        const taskKey = getTaskKey(task.id);
        const contextIndexKey = getContextIndexKey(task.contextId);
        const stateIndexKey = getStateIndexKey(task.status.state);

        const multi = redisClient.multi();
        const taskHash = serializedTaskToHash(serialized);
        multi.hmset(taskKey, taskHash);

        if (metadata?.expiresAt) {
          const ttlSeconds = Math.floor((metadata.expiresAt.getTime() - Date.now()) / 1000);
          if (ttlSeconds > 0) multi.expire(taskKey, ttlSeconds);
        } else if (config.defaultTtl) {
          multi.expire(taskKey, config.defaultTtl);
        }

        multi.sadd(contextIndexKey, task.id);
        multi.sadd(stateIndexKey, task.id);
        multi.hincrby(getStatsKey(), 'totalTasks', 1);
        multi.hincrby(getStatsKey(), `state:${task.status.state}`, 1);

        await multi.exec();
        return createSuccess(undefined);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('store', 'redis', task.id, error as Error));
      }
    },

    getTask: async (taskId: string) => {
      try {
        const taskKey = getTaskKey(taskId);
        const exists = await redisClient.exists(taskKey);
        if (!exists) return createSuccess(null);

        const hash = await redisClient.hgetall(taskKey);
        if (!hash || !hash.taskData) return createSuccess(null);

        const serialized = hashToSerializedTask(hash);
        const deserializeResult = deserializeA2ATask(serialized);
        return deserializeResult.success ? createSuccess(deserializeResult.data) : deserializeResult;
      } catch (error) {
        return createFailure(createA2ATaskStorageError('get', 'redis', taskId, error as Error));
      }
    },

    updateTask: async (task: A2ATask, metadata?: { [key: string]: any }) => {
      try {
        const taskKey = getTaskKey(task.id);
        const exists = await redisClient.exists(taskKey);
        if (!exists) return createFailure(createA2ATaskNotFoundError(task.id, 'redis'));

        const existingHash = await redisClient.hgetall(taskKey);
        const oldState = existingHash.state as TaskState;

        const sanitizeResult = sanitizeTask(task);
        if (!sanitizeResult.success) return sanitizeResult as any;

        const existingMetadata = existingHash.metadata ? JSON.parse(existingHash.metadata) : {};
        const mergedMetadata = { ...existingMetadata, ...metadata };

        const serializeResult = serializeA2ATask(sanitizeResult.data, mergedMetadata);
        if (!serializeResult.success) return serializeResult as any;

        const serialized = serializeResult.data;
        const multi = redisClient.multi();
        const taskHash = serializedTaskToHash(serialized);
        multi.hmset(taskKey, taskHash);

        if (oldState !== task.status.state) {
          const oldStateIndexKey = getStateIndexKey(oldState);
          const newStateIndexKey = getStateIndexKey(task.status.state);
          multi.srem(oldStateIndexKey, task.id);
          multi.sadd(newStateIndexKey, task.id);
          multi.hincrby(getStatsKey(), `state:${oldState}`, -1);
          multi.hincrby(getStatsKey(), `state:${task.status.state}`, 1);
        }

        await multi.exec();
        return createSuccess(undefined);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('update', 'redis', task.id, error as Error));
      }
    },

    updateTaskStatus: async (taskId: string, newState: TaskState, statusMessage?: any, timestamp?: string) => {
      try {
        const taskKey = getTaskKey(taskId);
        const exists = await redisClient.exists(taskKey);
        if (!exists) return createFailure(createA2ATaskNotFoundError(taskId, 'redis'));

        const hash = await redisClient.hgetall(taskKey);
        const serialized = hashToSerializedTask(hash);
        const deserializeResult = deserializeA2ATask(serialized);
        if (!deserializeResult.success) return deserializeResult;

        const task = deserializeResult.data;
        const updatedTask: A2ATask = {
          ...task,
          status: {
            ...task.status,
            state: newState,
            message: statusMessage || task.status.message,
            timestamp: timestamp || new Date().toISOString()
          }
        };

        return actualProvider.updateTask(updatedTask);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('update-status', 'redis', taskId, error as Error));
      }
    },

    findTasks: async (query: A2ATaskQuery) => {
      try {
        let taskIds: string[] = [];

        if (query.contextId) {
          const contextIndexKey = getContextIndexKey(query.contextId);
          taskIds = await redisClient.smembers(contextIndexKey);
        } else if (query.state) {
          const stateIndexKey = getStateIndexKey(query.state);
          taskIds = await redisClient.smembers(stateIndexKey);
        } else {
          const pattern = `${keyPrefix}task:*`;
          const keys = await redisClient.keys(pattern);
          taskIds = keys.map((key: string) => key.replace(`${keyPrefix}task:`, ''));
        }

        if (query.taskId) taskIds = taskIds.filter(id => id === query.taskId);

        const results: A2ATask[] = [];
        for (const taskId of taskIds) {
          const taskKey = getTaskKey(taskId);
          const exists = await redisClient.exists(taskKey);
          if (!exists) continue;

          const hash = await redisClient.hgetall(taskKey);
          if (!hash || !hash.taskData) continue;

          if (query.since && new Date(hash.createdAt) < query.since) continue;
          if (query.until && new Date(hash.createdAt) > query.until) continue;

          const serialized = hashToSerializedTask(hash);
          const deserializeResult = deserializeA2ATask(serialized);
          if (deserializeResult.success) results.push(deserializeResult.data);
        }

        results.sort((a, b) => {
          const timeA = new Date(a.status.timestamp || '').getTime();
          const timeB = new Date(b.status.timestamp || '').getTime();
          return timeB - timeA;
        });

        const offset = query.offset || 0;
        const limit = query.limit || results.length;
        const paginatedResults = results.slice(offset, offset + limit);

        return createSuccess(paginatedResults);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('find', 'redis', undefined, error as Error));
      }
    },

    getTasksByContext: async (contextId: string, limit?: number) => {
      return actualProvider.findTasks({ contextId, limit });
    },

    deleteTask: async (taskId: string) => {
      try {
        const taskKey = getTaskKey(taskId);
        const exists = await redisClient.exists(taskKey);
        if (!exists) return createSuccess(false);

        const hash = await redisClient.hgetall(taskKey);
        const contextId = hash.contextId;
        const state = hash.state as TaskState;

        const multi = redisClient.multi();
        multi.del(taskKey);

        if (contextId) {
          const contextIndexKey = getContextIndexKey(contextId);
          multi.srem(contextIndexKey, taskId);
        }

        if (state) {
          const stateIndexKey = getStateIndexKey(state);
          multi.srem(stateIndexKey, taskId);
        }

        multi.hincrby(getStatsKey(), 'totalTasks', -1);
        if (state) multi.hincrby(getStatsKey(), `state:${state}`, -1);

        await multi.exec();
        return createSuccess(true);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('delete', 'redis', taskId, error as Error));
      }
    },

    deleteTasksByContext: async (contextId: string) => {
      try {
        const contextIndexKey = getContextIndexKey(contextId);
        const taskIds = await redisClient.smembers(contextIndexKey);
        if (taskIds.length === 0) return createSuccess(0);

        let deletedCount = 0;
        for (const taskId of taskIds) {
          const deleteResult = await actualProvider.deleteTask(taskId);
          if (deleteResult.success && deleteResult.data) deletedCount++;
        }

        return createSuccess(deletedCount);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('delete-by-context', 'redis', undefined, error as Error));
      }
    },

    cleanupExpiredTasks: async () => {
      try {
        const pattern = `${keyPrefix}task:*`;
        const taskKeys = await redisClient.keys(pattern);
        let cleanedCount = 0;

        for (const taskKey of taskKeys) {
          const exists = await redisClient.exists(taskKey);
          if (!exists) {
            const taskId = taskKey.replace(`${keyPrefix}task:`, '');
            const deleteResult = await actualProvider.deleteTask(taskId);
            if (deleteResult.success && deleteResult.data) cleanedCount++;
          }
        }

        return createSuccess(cleanedCount);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('cleanup', 'redis', undefined, error as Error));
      }
    },

    getTaskStats: async (contextId?: string) => {
      try {
        const tasksByState: Record<TaskState, number> = {
          submitted: 0, working: 0, 'input-required': 0, completed: 0,
          canceled: 0, failed: 0, rejected: 0, 'auth-required': 0, unknown: 0
        };

        let totalTasks = 0;
        let oldestTask: Date | undefined;
        let newestTask: Date | undefined;

        if (contextId) {
          const contextIndexKey = getContextIndexKey(contextId);
          const taskIds = await redisClient.smembers(contextIndexKey);
          
          for (const taskId of taskIds) {
            const taskKey = getTaskKey(taskId);
            const exists = await redisClient.exists(taskKey);
            if (!exists) continue;

            const hash = await redisClient.hgetall(taskKey);
            if (!hash) continue;

            totalTasks++;
            const state = hash.state as TaskState;
            if (state) tasksByState[state]++;

            const createdAt = new Date(hash.createdAt);
            if (!oldestTask || createdAt < oldestTask) oldestTask = createdAt;
            if (!newestTask || createdAt > newestTask) newestTask = createdAt;
          }
        } else {
          const statsKey = getStatsKey();
          const stats = await redisClient.hgetall(statsKey);
          
          totalTasks = parseInt(stats.totalTasks || '0');
          for (const state of Object.keys(tasksByState) as TaskState[]) {
            tasksByState[state] = parseInt(stats[`state:${state}`] || '0');
          }
        }

        return createSuccess({ totalTasks, tasksByState, oldestTask, newestTask });
      } catch (error) {
        return createFailure(createA2ATaskStorageError('stats', 'redis', undefined, error as Error));
      }
    },

    healthCheck: async () => {
      try {
        const startTime = Date.now();
        await redisClient.ping();
        const latencyMs = Date.now() - startTime;
        return createSuccess({ healthy: true, latencyMs });
      } catch (error) {
        return createSuccess({ healthy: false, error: (error as Error).message });
      }
    },

    close: async () => {
      try {
        return createSuccess(undefined);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('close', 'redis', undefined, error as Error));
      }
    }
  };

  return actualProvider;
};