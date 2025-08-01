/**
 * A2A In-Memory Task Provider for FAF
 * Pure functional in-memory storage for A2A tasks
 */

import { A2ATask, TaskState } from '../../types.js';
import { 
  A2ATaskProvider, 
  A2ATaskQuery, 
  A2ATaskStorage,
  A2AInMemoryTaskConfig,
  createA2ATaskNotFoundError,
  createA2ATaskStorageError,
  createSuccess,
  createFailure
} from '../types.js';
import { 
  serializeA2ATask, 
  deserializeA2ATask, 
  validateTaskIntegrity,
  sanitizeTask
} from '../serialization.js';

/**
 * Helper function to convert A2ATaskStorage to A2ATaskSerialized
 */
const convertStorageToSerialized = (stored: A2ATaskStorage) => ({
  taskId: stored.taskId,
  contextId: stored.contextId,
  state: stored.state,
  taskData: stored.taskData,
  statusMessage: stored.statusMessage,
  createdAt: stored.createdAt.toISOString(),
  updatedAt: stored.updatedAt.toISOString(),
  metadata: stored.metadata ? JSON.stringify(stored.metadata) : undefined
});

/**
 * In-memory storage state
 */
interface InMemoryTaskState {
  readonly tasks: ReadonlyMap<string, A2ATaskStorage>;
  readonly contextIndex: ReadonlyMap<string, ReadonlySet<string>>; // contextId -> Set<taskId>
  readonly stateIndex: ReadonlyMap<TaskState, ReadonlySet<string>>; // state -> Set<taskId>
  readonly config: A2AInMemoryTaskConfig;
  readonly stats: {
    readonly totalTasks: number;
    readonly createdAt: Date;
  };
}

/**
 * Create an in-memory A2A task provider
 */
export const createA2AInMemoryTaskProvider = (
  config: A2AInMemoryTaskConfig
): A2ATaskProvider => {
  // Initialize immutable state
  let state: InMemoryTaskState = {
    tasks: new Map(),
    contextIndex: new Map(),
    stateIndex: new Map(),
    config,
    stats: {
      totalTasks: 0,
      createdAt: new Date()
    }
  };

  // Pure function to update state
  const updateState = (newState: InMemoryTaskState): void => {
    state = newState;
  };

  // Pure function to add task to indices
  const addToIndices = (
    contextIndex: ReadonlyMap<string, ReadonlySet<string>>,
    stateIndex: ReadonlyMap<TaskState, ReadonlySet<string>>,
    taskId: string,
    contextId: string,
    taskState: TaskState
  ): { 
    contextIndex: ReadonlyMap<string, ReadonlySet<string>>;
    stateIndex: ReadonlyMap<TaskState, ReadonlySet<string>>;
  } => {
    // Update context index
    const contextTasks = contextIndex.get(contextId) || new Set();
    const newContextIndex = new Map(contextIndex);
    newContextIndex.set(contextId, new Set([...contextTasks, taskId]));

    // Update state index
    const stateTasks = stateIndex.get(taskState) || new Set();
    const newStateIndex = new Map(stateIndex);
    newStateIndex.set(taskState, new Set([...stateTasks, taskId]));

    return { contextIndex: newContextIndex, stateIndex: newStateIndex };
  };

  // Pure function to remove task from indices
  const removeFromIndices = (
    contextIndex: ReadonlyMap<string, ReadonlySet<string>>,
    stateIndex: ReadonlyMap<TaskState, ReadonlySet<string>>,
    taskId: string,
    contextId: string,
    taskState: TaskState
  ): { 
    contextIndex: ReadonlyMap<string, ReadonlySet<string>>;
    stateIndex: ReadonlyMap<TaskState, ReadonlySet<string>>;
  } => {
    // Update context index
    const contextTasks = contextIndex.get(contextId);
    const newContextIndex = new Map(contextIndex);
    if (contextTasks) {
      const updatedContextTasks = new Set(contextTasks);
      updatedContextTasks.delete(taskId);
      if (updatedContextTasks.size > 0) {
        newContextIndex.set(contextId, updatedContextTasks);
      } else {
        newContextIndex.delete(contextId);
      }
    }

    // Update state index
    const stateTasks = stateIndex.get(taskState);
    const newStateIndex = new Map(stateIndex);
    if (stateTasks) {
      const updatedStateTasks = new Set(stateTasks);
      updatedStateTasks.delete(taskId);
      if (updatedStateTasks.size > 0) {
        newStateIndex.set(taskState, updatedStateTasks);
      } else {
        newStateIndex.delete(taskState);
      }
    }

    return { contextIndex: newContextIndex, stateIndex: newStateIndex };
  };

  // Pure function to check storage limits
  const checkStorageLimits = (currentTasks: ReadonlyMap<string, A2ATaskStorage>) => {
    if (currentTasks.size >= config.maxTasks) {
      return createFailure(
        createA2ATaskStorageError(
          'store',
          'in-memory',
          undefined,
          new Error(`Maximum task limit reached: ${config.maxTasks}`)
        )
      );
    }
    return createSuccess(undefined);
  };

  return {
    storeTask: async (task: A2ATask, metadata?: { expiresAt?: Date; [key: string]: any }) => {
      try {
        // Validate and sanitize task
        const sanitizeResult = sanitizeTask(task);
        if (!sanitizeResult.success) {
          return sanitizeResult as any;
        }

        // Check storage limits
        const limitsResult = checkStorageLimits(state.tasks);
        if (!limitsResult.success) {
          return limitsResult;
        }

        // Serialize task
        const serializeResult = serializeA2ATask(sanitizeResult.data, metadata);
        if (!serializeResult.success) {
          return serializeResult as any;
        }

        const serializedTask = serializeResult.data;
        const taskStorage: A2ATaskStorage = {
          taskId: serializedTask.taskId,
          contextId: serializedTask.contextId,
          state: serializedTask.state as TaskState,
          taskData: serializedTask.taskData,
          createdAt: new Date(serializedTask.createdAt),
          updatedAt: new Date(serializedTask.updatedAt),
          expiresAt: metadata?.expiresAt,
          metadata: metadata ? { ...metadata } : undefined
        };

        // Add to storage and indices
        const newTasks = new Map(state.tasks);
        newTasks.set(task.id, taskStorage);

        const { contextIndex, stateIndex } = addToIndices(
          state.contextIndex,
          state.stateIndex,
          task.id,
          task.contextId,
          task.status.state
        );

        updateState({
          ...state,
          tasks: newTasks,
          contextIndex,
          stateIndex,
          stats: {
            ...state.stats,
            totalTasks: newTasks.size
          }
        });

        return createSuccess(undefined);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('store', 'in-memory', task.id, error as Error)
        );
      }
    },

    getTask: async (taskId: string) => {
      try {
        const stored = state.tasks.get(taskId);
        if (!stored) {
          return createSuccess(null);
        }

        // Check expiration
        if (stored.expiresAt && stored.expiresAt < new Date()) {
          return createSuccess(null);
        }

        const deserializeResult = deserializeA2ATask(convertStorageToSerialized(stored));
        if (!deserializeResult.success) {
          return deserializeResult;
        }

        return createSuccess(deserializeResult.data);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('get', 'in-memory', taskId, error as Error)
        );
      }
    },

    updateTask: async (task: A2ATask, metadata?: { [key: string]: any }) => {
      try {
        const existing = state.tasks.get(task.id);
        if (!existing) {
          return createFailure(createA2ATaskNotFoundError(task.id, 'in-memory'));
        }

        // Validate and sanitize task
        const sanitizeResult = sanitizeTask(task);
        if (!sanitizeResult.success) {
          return sanitizeResult as any;
        }

        // Serialize updated task
        const mergedMetadata = { ...existing.metadata, ...metadata };
        const serializeResult = serializeA2ATask(sanitizeResult.data, mergedMetadata);
        if (!serializeResult.success) {
          return serializeResult as any;
        }

        const serializedTask = serializeResult.data;
        const updatedStorage: A2ATaskStorage = {
          ...existing,
          state: serializedTask.state as TaskState,
          taskData: serializedTask.taskData,
          updatedAt: new Date(serializedTask.updatedAt),
          metadata: mergedMetadata
        };

        // Update storage
        const newTasks = new Map(state.tasks);
        newTasks.set(task.id, updatedStorage);

        // Update indices if state changed
        let contextIndex = state.contextIndex;
        let stateIndex = state.stateIndex;

        if (existing.state !== task.status.state) {
          // Remove from old state index and add to new
          const removeResult = removeFromIndices(
            contextIndex,
            stateIndex,
            task.id,
            task.contextId,
            existing.state
          );
          const addResult = addToIndices(
            removeResult.contextIndex,
            removeResult.stateIndex,
            task.id,
            task.contextId,
            task.status.state
          );
          contextIndex = addResult.contextIndex;
          stateIndex = addResult.stateIndex;
        }

        updateState({
          ...state,
          tasks: newTasks,
          contextIndex,
          stateIndex
        });

        return createSuccess(undefined);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('update', 'in-memory', task.id, error as Error)
        );
      }
    },

    updateTaskStatus: async (taskId: string, newState: TaskState, statusMessage?: any, timestamp?: string) => {
      try {
        const existing = state.tasks.get(taskId);
        if (!existing) {
          return createFailure(createA2ATaskNotFoundError(taskId, 'in-memory'));
        }

        // Deserialize existing task
        const deserializeResult = deserializeA2ATask(convertStorageToSerialized(existing));
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

        // Use updateTask for the actual update
        return await provider.updateTask(updatedTask);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('update-status', 'in-memory', taskId, error as Error)
        );
      }
    },

    findTasks: async (query: A2ATaskQuery) => {
      try {
        let taskIds: Set<string> = new Set();

        // Start with all tasks or filter by context/state
        if (query.contextId) {
          const contextTasks = state.contextIndex.get(query.contextId);
          if (contextTasks) {
            taskIds = new Set(contextTasks);
          }
        } else if (query.state) {
          const stateTasks = state.stateIndex.get(query.state);
          if (stateTasks) {
            taskIds = new Set(stateTasks);
          }
        } else {
          taskIds = new Set(state.tasks.keys());
        }

        // Filter by additional criteria
        const results: A2ATask[] = [];
        for (const taskId of taskIds) {
          if (query.taskId && taskId !== query.taskId) continue;

          const stored = state.tasks.get(taskId);
          if (!stored) continue;

          // Check expiration
          if (stored.expiresAt && stored.expiresAt < new Date()) continue;

          // Date filtering
          if (query.since && stored.createdAt < query.since) continue;
          if (query.until && stored.createdAt > query.until) continue;

          const deserializeResult = deserializeA2ATask(convertStorageToSerialized(stored));
          if (deserializeResult.success) {
            results.push(deserializeResult.data);
          }
        }

        // Apply pagination
        const offset = query.offset || 0;
        const limit = query.limit || results.length;
        const paginatedResults = results
          .sort((a, b) => new Date(b.status.timestamp || '').getTime() - new Date(a.status.timestamp || '').getTime())
          .slice(offset, offset + limit);

        return createSuccess(paginatedResults);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('find', 'in-memory', undefined, error as Error)
        );
      }
    },

    getTasksByContext: async (contextId: string, limit?: number) => {
      return provider.findTasks({ contextId, limit });
    },

    deleteTask: async (taskId: string) => {
      try {
        const existing = state.tasks.get(taskId);
        if (!existing) {
          return createSuccess(false);
        }

        // Remove from storage
        const newTasks = new Map(state.tasks);
        newTasks.delete(taskId);

        // Remove from indices
        const { contextIndex, stateIndex } = removeFromIndices(
          state.contextIndex,
          state.stateIndex,
          taskId,
          existing.contextId,
          existing.state
        );

        updateState({
          ...state,
          tasks: newTasks,
          contextIndex,
          stateIndex,
          stats: {
            ...state.stats,
            totalTasks: newTasks.size
          }
        });

        return createSuccess(true);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('delete', 'in-memory', taskId, error as Error)
        );
      }
    },

    deleteTasksByContext: async (contextId: string) => {
      try {
        const contextTasks = state.contextIndex.get(contextId);
        if (!contextTasks) {
          return createSuccess(0);
        }

        let deletedCount = 0;
        for (const taskId of contextTasks) {
          const deleteResult = await provider.deleteTask(taskId);
          if (deleteResult.success && deleteResult.data) {
            deletedCount++;
          }
        }

        return createSuccess(deletedCount);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('delete-by-context', 'in-memory', undefined, error as Error)
        );
      }
    },

    cleanupExpiredTasks: async () => {
      try {
        const now = new Date();
        let cleanedCount = 0;

        for (const [taskId, stored] of state.tasks) {
          if (stored.expiresAt && stored.expiresAt < now) {
            const deleteResult = await provider.deleteTask(taskId);
            if (deleteResult.success && deleteResult.data) {
              cleanedCount++;
            }
          }
        }

        return createSuccess(cleanedCount);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('cleanup', 'in-memory', undefined, error as Error)
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

        const tasksToCount = contextId 
          ? (state.contextIndex.get(contextId) || new Set())
          : new Set(state.tasks.keys());

        for (const taskId of tasksToCount) {
          const stored = state.tasks.get(taskId);
          if (!stored) continue;

          // Skip expired tasks
          if (stored.expiresAt && stored.expiresAt < new Date()) continue;

          totalTasks++;
          tasksByState[stored.state]++;

          if (!oldestTask || stored.createdAt < oldestTask) {
            oldestTask = stored.createdAt;
          }
          if (!newestTask || stored.createdAt > newestTask) {
            newestTask = stored.createdAt;
          }
        }

        return createSuccess({
          totalTasks,
          tasksByState,
          oldestTask,
          newestTask
        });
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('stats', 'in-memory', undefined, error as Error)
        );
      }
    },

    healthCheck: async () => {
      try {
        const startTime = Date.now();
        
        // Simple health check - verify we can access storage
        const taskCount = state.tasks.size;
        const latencyMs = Date.now() - startTime;

        return createSuccess({
          healthy: true,
          latencyMs,
          error: undefined
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
        // Clear all data for cleanup
        updateState({
          tasks: new Map(),
          contextIndex: new Map(),
          stateIndex: new Map(),
          config,
          stats: {
            totalTasks: 0,
            createdAt: new Date()
          }
        });

        return createSuccess(undefined);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('close', 'in-memory', undefined, error as Error)
        );
      }
    }
  };

  // Create the provider object
  const provider = {
    storeTask: async (task: A2ATask, metadata?: { expiresAt?: Date; [key: string]: any }) => {
      // Implementation moved to return object above
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
  } as A2ATaskProvider;

  // Re-implement with proper access to provider reference
  return {
    storeTask: async (task: A2ATask, metadata?: { expiresAt?: Date; [key: string]: any }) => {
      try {
        const sanitizeResult = sanitizeTask(task);
        if (!sanitizeResult.success) return sanitizeResult as any;

        const limitsResult = checkStorageLimits(state.tasks);
        if (!limitsResult.success) return limitsResult;

        const serializeResult = serializeA2ATask(sanitizeResult.data, metadata);
        if (!serializeResult.success) return serializeResult as any;

        const serializedTask = serializeResult.data;
        const taskStorage: A2ATaskStorage = {
          taskId: serializedTask.taskId,
          contextId: serializedTask.contextId,
          state: serializedTask.state as TaskState,
          taskData: serializedTask.taskData,
          createdAt: new Date(serializedTask.createdAt),
          updatedAt: new Date(serializedTask.updatedAt),
          expiresAt: metadata?.expiresAt,
          metadata: metadata ? { ...metadata } : undefined
        };

        const newTasks = new Map(state.tasks);
        newTasks.set(task.id, taskStorage);

        const { contextIndex, stateIndex } = addToIndices(
          state.contextIndex, state.stateIndex, task.id, task.contextId, task.status.state
        );

        updateState({
          ...state,
          tasks: newTasks,
          contextIndex,
          stateIndex,
          stats: { ...state.stats, totalTasks: newTasks.size }
        });

        return createSuccess(undefined);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('store', 'in-memory', task.id, error as Error));
      }
    },

    getTask: async (taskId: string) => {
      try {
        const stored = state.tasks.get(taskId);
        if (!stored) return createSuccess(null);
        if (stored.expiresAt && stored.expiresAt < new Date()) return createSuccess(null);

        const deserializeResult = deserializeA2ATask(convertStorageToSerialized(stored));
        return deserializeResult.success ? createSuccess(deserializeResult.data) : deserializeResult;
      } catch (error) {
        return createFailure(createA2ATaskStorageError('get', 'in-memory', taskId, error as Error));
      }
    },

    updateTask: async (task: A2ATask, metadata?: { [key: string]: any }) => {
      try {
        const existing = state.tasks.get(task.id);
        if (!existing) return createFailure(createA2ATaskNotFoundError(task.id, 'in-memory'));

        const sanitizeResult = sanitizeTask(task);
        if (!sanitizeResult.success) return sanitizeResult as any;

        const mergedMetadata = { ...existing.metadata, ...metadata };
        const serializeResult = serializeA2ATask(sanitizeResult.data, mergedMetadata);
        if (!serializeResult.success) return serializeResult as any;

        const serializedTask = serializeResult.data;
        const updatedStorage: A2ATaskStorage = {
          ...existing,
          state: serializedTask.state as TaskState,
          taskData: serializedTask.taskData,
          updatedAt: new Date(serializedTask.updatedAt),
          metadata: mergedMetadata
        };

        const newTasks = new Map(state.tasks);
        newTasks.set(task.id, updatedStorage);

        let contextIndex = state.contextIndex;
        let stateIndex = state.stateIndex;
        if (existing.state !== task.status.state) {
          const removeResult = removeFromIndices(contextIndex, stateIndex, task.id, task.contextId, existing.state);
          const addResult = addToIndices(removeResult.contextIndex, removeResult.stateIndex, task.id, task.contextId, task.status.state);
          contextIndex = addResult.contextIndex;
          stateIndex = addResult.stateIndex;
        }

        updateState({ ...state, tasks: newTasks, contextIndex, stateIndex });
        return createSuccess(undefined);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('update', 'in-memory', task.id, error as Error));
      }
    },

    updateTaskStatus: async (taskId: string, newState: TaskState, statusMessage?: any, timestamp?: string) => {
      try {
        const existing = state.tasks.get(taskId);
        if (!existing) return createFailure(createA2ATaskNotFoundError(taskId, 'in-memory'));

        const deserializeResult = deserializeA2ATask(convertStorageToSerialized(existing));
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

        return provider.updateTask(updatedTask);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('update-status', 'in-memory', taskId, error as Error));
      }
    },

    findTasks: async (query: A2ATaskQuery) => {
      try {
        let taskIds: Set<string> = new Set();

        if (query.contextId) {
          const contextTasks = state.contextIndex.get(query.contextId);
          if (contextTasks) taskIds = new Set(contextTasks);
        } else if (query.state) {
          const stateTasks = state.stateIndex.get(query.state);
          if (stateTasks) taskIds = new Set(stateTasks);
        } else {
          taskIds = new Set(state.tasks.keys());
        }

        const results: A2ATask[] = [];
        for (const taskId of taskIds) {
          if (query.taskId && taskId !== query.taskId) continue;

          const stored = state.tasks.get(taskId);
          if (!stored) continue;
          if (stored.expiresAt && stored.expiresAt < new Date()) continue;
          if (query.since && stored.createdAt < query.since) continue;
          if (query.until && stored.createdAt > query.until) continue;

          const deserializeResult = deserializeA2ATask(convertStorageToSerialized(stored));
          if (deserializeResult.success) results.push(deserializeResult.data);
        }

        const offset = query.offset || 0;
        const limit = query.limit || results.length;
        const paginatedResults = results
          .sort((a, b) => new Date(b.status.timestamp || '').getTime() - new Date(a.status.timestamp || '').getTime())
          .slice(offset, offset + limit);

        return createSuccess(paginatedResults);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('find', 'in-memory', undefined, error as Error));
      }
    },

    getTasksByContext: async (contextId: string, limit?: number) => {
      return provider.findTasks({ contextId, limit });
    },

    deleteTask: async (taskId: string) => {
      try {
        const existing = state.tasks.get(taskId);
        if (!existing) return createSuccess(false);

        const newTasks = new Map(state.tasks);
        newTasks.delete(taskId);

        const { contextIndex, stateIndex } = removeFromIndices(
          state.contextIndex, state.stateIndex, taskId, existing.contextId, existing.state
        );

        updateState({
          ...state,
          tasks: newTasks,
          contextIndex,
          stateIndex,
          stats: { ...state.stats, totalTasks: newTasks.size }
        });

        return createSuccess(true);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('delete', 'in-memory', taskId, error as Error));
      }
    },

    deleteTasksByContext: async (contextId: string) => {
      try {
        const contextTasks = state.contextIndex.get(contextId);
        if (!contextTasks) return createSuccess(0);

        let deletedCount = 0;
        for (const taskId of contextTasks) {
          const deleteResult = await provider.deleteTask(taskId);
          if (deleteResult.success && deleteResult.data) deletedCount++;
        }

        return createSuccess(deletedCount);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('delete-by-context', 'in-memory', undefined, error as Error));
      }
    },

    cleanupExpiredTasks: async () => {
      try {
        const now = new Date();
        let cleanedCount = 0;

        for (const [taskId, stored] of state.tasks) {
          if (stored.expiresAt && stored.expiresAt < now) {
            const deleteResult = await provider.deleteTask(taskId);
            if (deleteResult.success && deleteResult.data) cleanedCount++;
          }
        }

        return createSuccess(cleanedCount);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('cleanup', 'in-memory', undefined, error as Error));
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

        const tasksToCount = contextId 
          ? (state.contextIndex.get(contextId) || new Set())
          : new Set(state.tasks.keys());

        for (const taskId of tasksToCount) {
          const stored = state.tasks.get(taskId);
          if (!stored || (stored.expiresAt && stored.expiresAt < new Date())) continue;

          totalTasks++;
          tasksByState[stored.state]++;

          if (!oldestTask || stored.createdAt < oldestTask) oldestTask = stored.createdAt;
          if (!newestTask || stored.createdAt > newestTask) newestTask = stored.createdAt;
        }

        return createSuccess({ totalTasks, tasksByState, oldestTask, newestTask });
      } catch (error) {
        return createFailure(createA2ATaskStorageError('stats', 'in-memory', undefined, error as Error));
      }
    },

    healthCheck: async () => {
      try {
        const startTime = Date.now();
        const taskCount = state.tasks.size;
        const latencyMs = Date.now() - startTime;
        return createSuccess({ healthy: true, latencyMs });
      } catch (error) {
        return createSuccess({ healthy: false, error: (error as Error).message });
      }
    },

    close: async () => {
      try {
        updateState({
          tasks: new Map(),
          contextIndex: new Map(),
          stateIndex: new Map(),
          config,
          stats: { totalTasks: 0, createdAt: new Date() }
        });
        return createSuccess(undefined);
      } catch (error) {
        return createFailure(createA2ATaskStorageError('close', 'in-memory', undefined, error as Error));
      }
    }
  };
};