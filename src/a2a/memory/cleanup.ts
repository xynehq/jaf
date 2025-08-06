/**
 * A2A Task Cleanup Service for JAF
 * Pure functional cleanup and expiration policies for A2A tasks
 */

import { A2ATaskProvider, A2AResult, createA2ATaskStorageError, createSuccess, createFailure } from './types.js';

/**
 * Configuration for task cleanup policies
 */
export interface A2ATaskCleanupConfig {
  readonly enabled: boolean;
  readonly interval: number; // Cleanup interval in milliseconds
  readonly maxAge: number; // Maximum age of completed tasks in milliseconds
  readonly maxCompletedTasks: number; // Maximum number of completed tasks to keep
  readonly maxFailedTasks: number; // Maximum number of failed tasks to keep
  readonly retainStates: readonly string[]; // Task states to always retain
  readonly batchSize: number; // Number of tasks to process in each cleanup batch
  readonly dryRun: boolean; // If true, log what would be cleaned up but don't delete
}

/**
 * Default cleanup configuration
 */
export const defaultCleanupConfig: A2ATaskCleanupConfig = {
  enabled: true,
  interval: 3600000, // 1 hour
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxCompletedTasks: 1000,
  maxFailedTasks: 500,
  retainStates: ['working', 'input-required', 'submitted'],
  batchSize: 100,
  dryRun: false
};

/**
 * Result type for cleanup operations
 */
export interface CleanupResult {
  readonly expiredCleaned: number;
  readonly excessCompletedCleaned: number;
  readonly excessFailedCleaned: number;
  readonly totalCleaned: number;
  readonly errors: readonly string[];
}

/**
 * Pure function to perform task cleanup
 */
export const performTaskCleanup = async (
  taskProvider: A2ATaskProvider,
  config: A2ATaskCleanupConfig = defaultCleanupConfig
): Promise<A2AResult<CleanupResult>> => {
  try {
    const errors: string[] = [];
    let expiredCleaned = 0;
    let excessCompletedCleaned = 0;
    let excessFailedCleaned = 0;

    // Step 1: Clean up expired tasks
    if (config.enabled) {
      try {
        const expiredResult = await taskProvider.cleanupExpiredTasks();
        if (expiredResult.success) {
          expiredCleaned = expiredResult.data;
          if (config.dryRun) {
            console.log(`[DRY RUN] Would clean up ${expiredCleaned} expired tasks`);
            expiredCleaned = 0; // Reset for dry run
          }
        } else {
          errors.push(`Failed to cleanup expired tasks: ${expiredResult.error.message}`);
        }
      } catch (error) {
        errors.push(`Error during expired task cleanup: ${(error as Error).message}`);
      }
    }

    // Step 2: Clean up excess completed tasks
    if (config.enabled && config.maxCompletedTasks > 0) {
      try {
        const completedTasksResult = await taskProvider.findTasks({
          state: 'completed',
          limit: config.maxCompletedTasks + config.batchSize
        });

        if (completedTasksResult.success) {
          const completedTasks = completedTasksResult.data;
          
          if (completedTasks.length > config.maxCompletedTasks) {
            // Sort by completion time (oldest first) and remove excess
            const sortedTasks = completedTasks
              .sort((a, b) => {
                const timeA = new Date(a.status.timestamp || '').getTime();
                const timeB = new Date(b.status.timestamp || '').getTime();
                return timeA - timeB;
              });

            const tasksToDelete = sortedTasks.slice(0, sortedTasks.length - config.maxCompletedTasks);
            
            if (config.dryRun) {
              console.log(`[DRY RUN] Would clean up ${tasksToDelete.length} excess completed tasks`);
            } else {
              for (const task of tasksToDelete) {
                const deleteResult = await taskProvider.deleteTask(task.id);
                if (deleteResult.success && deleteResult.data) {
                  excessCompletedCleaned++;
                } else {
                  errors.push(`Failed to delete completed task ${task.id}`);
                }
              }
            }
          }
        } else {
          errors.push(`Failed to find completed tasks: ${completedTasksResult.error.message}`);
        }
      } catch (error) {
        errors.push(`Error during completed task cleanup: ${(error as Error).message}`);
      }
    }

    // Step 3: Clean up excess failed tasks
    if (config.enabled && config.maxFailedTasks > 0) {
      try {
        const failedTasksResult = await taskProvider.findTasks({
          state: 'failed',
          limit: config.maxFailedTasks + config.batchSize
        });

        if (failedTasksResult.success) {
          const failedTasks = failedTasksResult.data;
          
          if (failedTasks.length > config.maxFailedTasks) {
            // Sort by failure time (oldest first) and remove excess
            const sortedTasks = failedTasks
              .sort((a, b) => {
                const timeA = new Date(a.status.timestamp || '').getTime();
                const timeB = new Date(b.status.timestamp || '').getTime();
                return timeA - timeB;
              });

            const tasksToDelete = sortedTasks.slice(0, sortedTasks.length - config.maxFailedTasks);
            
            if (config.dryRun) {
              console.log(`[DRY RUN] Would clean up ${tasksToDelete.length} excess failed tasks`);
            } else {
              for (const task of tasksToDelete) {
                const deleteResult = await taskProvider.deleteTask(task.id);
                if (deleteResult.success && deleteResult.data) {
                  excessFailedCleaned++;
                } else {
                  errors.push(`Failed to delete failed task ${task.id}`);
                }
              }
            }
          }
        } else {
          errors.push(`Failed to find failed tasks: ${failedTasksResult.error.message}`);
        }
      } catch (error) {
        errors.push(`Error during failed task cleanup: ${(error as Error).message}`);
      }
    }

    // Step 4: Clean up old tasks beyond max age
    if (config.enabled && config.maxAge > 0) {
      try {
        const cutoffDate = new Date(Date.now() - config.maxAge);
        
        // Find old completed and failed tasks
        for (const state of ['completed', 'failed', 'canceled']) {
          if (config.retainStates.includes(state)) continue;

          const oldTasksResult = await taskProvider.findTasks({
            state: state as any,
            until: cutoffDate,
            limit: config.batchSize
          });

          if (oldTasksResult.success) {
            const oldTasks = oldTasksResult.data;
            
            if (config.dryRun) {
              console.log(`[DRY RUN] Would clean up ${oldTasks.length} old ${state} tasks`);
            } else {
              for (const task of oldTasks) {
                const deleteResult = await taskProvider.deleteTask(task.id);
                if (deleteResult.success && deleteResult.data) {
                  if (state === 'completed') {
                    excessCompletedCleaned++;
                  } else if (state === 'failed') {
                    excessFailedCleaned++;
                  }
                } else {
                  errors.push(`Failed to delete old ${state} task ${task.id}`);
                }
              }
            }
          } else {
            errors.push(`Failed to find old ${state} tasks: ${oldTasksResult.error.message}`);
          }
        }
      } catch (error) {
        errors.push(`Error during old task cleanup: ${(error as Error).message}`);
      }
    }

    const totalCleaned = expiredCleaned + excessCompletedCleaned + excessFailedCleaned;

    return createSuccess({
      expiredCleaned,
      excessCompletedCleaned,
      excessFailedCleaned,
      totalCleaned,
      errors
    });
  } catch (error) {
    return createFailure(
      createA2ATaskStorageError('cleanup', 'unknown', undefined, error as Error)
    );
  }
};

/**
 * Pure function to create a cleanup scheduler
 */
export const createTaskCleanupScheduler = (
  taskProvider: A2ATaskProvider,
  config: A2ATaskCleanupConfig = defaultCleanupConfig
) => {
  let intervalId: NodeJS.Timeout | null = null;
  let isRunning = false;

  const start = () => {
    if (isRunning || !config.enabled) return;

    isRunning = true;
    
    const runCleanup = async () => {
      try {
        const result = await performTaskCleanup(taskProvider, config);
        
        if (result.success) {
          const { totalCleaned, errors } = result.data;
          
          if (totalCleaned > 0 || errors.length > 0) {
            console.log(`A2A task cleanup completed: ${totalCleaned} tasks cleaned`);
            
            if (errors.length > 0) {
              console.warn(`A2A task cleanup errors: ${errors.join(', ')}`);
            }
          }
        } else {
          console.error(`A2A task cleanup failed: ${result.error.message}`);
        }
      } catch (error) {
        console.error(`A2A task cleanup error: ${(error as Error).message}`);
      }
    };

    // Run initial cleanup
    runCleanup();

    // Schedule periodic cleanup
    intervalId = setInterval(runCleanup, config.interval);
  };

  const stop = () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    isRunning = false;
  };

  const runOnce = () => {
    return performTaskCleanup(taskProvider, config);
  };

  return {
    start,
    stop,
    runOnce,
    isRunning: () => isRunning,
    config
  };
};

/**
 * Pure function to validate cleanup configuration
 */
export const validateCleanupConfig = (config: Partial<A2ATaskCleanupConfig>): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (config.interval !== undefined && config.interval <= 0) {
    errors.push('Cleanup interval must be greater than 0');
  }

  if (config.maxAge !== undefined && config.maxAge <= 0) {
    errors.push('Max age must be greater than 0');
  }

  if (config.maxCompletedTasks !== undefined && config.maxCompletedTasks < 0) {
    errors.push('Max completed tasks must be non-negative');
  }

  if (config.maxFailedTasks !== undefined && config.maxFailedTasks < 0) {
    errors.push('Max failed tasks must be non-negative');
  }

  if (config.batchSize !== undefined && config.batchSize <= 0) {
    errors.push('Batch size must be greater than 0');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Helper function to create cleanup config from environment variables
 */
export const createCleanupConfigFromEnv = (): A2ATaskCleanupConfig => {
  return {
    enabled: process.env.JAF_A2A_CLEANUP_ENABLED !== 'false',
    interval: parseInt(process.env.JAF_A2A_CLEANUP_INTERVAL || '3600000'),
    maxAge: parseInt(process.env.JAF_A2A_CLEANUP_MAX_AGE || '604800000'), // 7 days
    maxCompletedTasks: parseInt(process.env.JAF_A2A_CLEANUP_MAX_COMPLETED || '1000'),
    maxFailedTasks: parseInt(process.env.JAF_A2A_CLEANUP_MAX_FAILED || '500'),
    retainStates: (process.env.JAF_A2A_CLEANUP_RETAIN_STATES || 'working,input-required,submitted').split(','),
    batchSize: parseInt(process.env.JAF_A2A_CLEANUP_BATCH_SIZE || '100'),
    dryRun: process.env.JAF_A2A_CLEANUP_DRY_RUN === 'true'
  };
};