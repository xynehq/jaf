/**
 * A2A Task Memory Types for JAF
 * Extends the core memory system to support A2A task queue persistence
 */

import { z } from 'zod';
import { A2ATask, TaskState } from '../types.js';

// A2A Task storage and retrieval types
export interface A2ATaskQuery {
  readonly taskId?: string;
  readonly contextId?: string;
  readonly state?: TaskState;
  readonly limit?: number;
  readonly offset?: number;
  readonly since?: Date;
  readonly until?: Date;
  readonly includeHistory?: boolean;
  readonly includeArtifacts?: boolean;
}

export interface A2ATaskStorage {
  readonly taskId: string;
  readonly contextId: string;
  readonly state: TaskState;
  readonly taskData: string; // Serialized A2ATask
  readonly statusMessage?: string; // Serialized status message for quick access
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt?: Date;
  readonly metadata?: Readonly<Record<string, any>>;
}

// A2A Task Provider interface extending memory patterns
export type A2ATaskProvider = {
  /**
   * Store a new A2A task
   */
  readonly storeTask: (
    task: A2ATask,
    metadata?: { expiresAt?: Date; [key: string]: any }
  ) => Promise<A2AResult<void>>;

  /**
   * Retrieve a task by ID
   */
  readonly getTask: (taskId: string) => Promise<A2AResult<A2ATask | null>>;

  /**
   * Update an existing task
   */
  readonly updateTask: (
    task: A2ATask,
    metadata?: { [key: string]: any }
  ) => Promise<A2AResult<void>>;

  /**
   * Update task status only (optimized for frequent status changes)
   */
  readonly updateTaskStatus: (
    taskId: string,
    state: TaskState,
    statusMessage?: any,
    timestamp?: string
  ) => Promise<A2AResult<void>>;

  /**
   * Search tasks by query
   */
  readonly findTasks: (query: A2ATaskQuery) => Promise<A2AResult<A2ATask[]>>;

  /**
   * Get tasks by context ID
   */
  readonly getTasksByContext: (
    contextId: string,
    limit?: number
  ) => Promise<A2AResult<A2ATask[]>>;

  /**
   * Delete a task
   */
  readonly deleteTask: (taskId: string) => Promise<A2AResult<boolean>>;

  /**
   * Delete tasks by context ID
   */
  readonly deleteTasksByContext: (contextId: string) => Promise<A2AResult<number>>;

  /**
   * Clean up expired tasks
   */
  readonly cleanupExpiredTasks: () => Promise<A2AResult<number>>;

  /**
   * Get task statistics
   */
  readonly getTaskStats: (contextId?: string) => Promise<A2AResult<{
    totalTasks: number;
    tasksByState: Record<TaskState, number>;
    oldestTask?: Date;
    newestTask?: Date;
  }>>;

  /**
   * Health check for the task provider
   */
  readonly healthCheck: () => Promise<A2AResult<{ healthy: boolean; latencyMs?: number; error?: string }>>;

  /**
   * Close/cleanup the provider
   */
  readonly close: () => Promise<A2AResult<void>>;
};

// Configuration schemas for A2A task storage
export const A2ATaskMemoryConfigSchema = z.object({
  type: z.enum(['memory', 'redis', 'postgres']),
  keyPrefix: z.string().default('jaf:a2a:tasks:'),
  defaultTtl: z.number().optional(), // Default TTL in seconds for tasks
  cleanupInterval: z.number().default(3600), // Cleanup interval in seconds
  maxTasks: z.number().default(10000), // Maximum tasks to store (for in-memory)
  enableHistory: z.boolean().default(true), // Store task history
  enableArtifacts: z.boolean().default(true), // Store task artifacts
});

export const A2AInMemoryTaskConfigSchema = A2ATaskMemoryConfigSchema.extend({
  type: z.literal('memory'),
  maxTasksPerContext: z.number().default(1000),
});

export const A2ARedisTaskConfigSchema = A2ATaskMemoryConfigSchema.extend({
  type: z.literal('redis'),
  host: z.string().default('localhost'),
  port: z.number().default(6379),
  password: z.string().optional(),
  db: z.number().default(0),
});

export const A2APostgresTaskConfigSchema = A2ATaskMemoryConfigSchema.extend({
  type: z.literal('postgres'),
  host: z.string().default('localhost'),
  port: z.number().default(5432),
  database: z.string().default('jaf_a2a'),
  username: z.string().default('postgres'),
  password: z.string().optional(),
  ssl: z.boolean().default(false),
  tableName: z.string().default('a2a_tasks'),
  maxConnections: z.number().default(10),
});

export const A2ATaskProviderConfigSchema = z.union([
  A2AInMemoryTaskConfigSchema,
  A2ARedisTaskConfigSchema,
  A2APostgresTaskConfigSchema
]);

export type A2ATaskMemoryConfig = z.infer<typeof A2ATaskMemoryConfigSchema>;
export type A2AInMemoryTaskConfig = z.infer<typeof A2AInMemoryTaskConfigSchema>;
export type A2ARedisTaskConfig = z.infer<typeof A2ARedisTaskConfigSchema>;
export type A2APostgresTaskConfig = z.infer<typeof A2APostgresTaskConfigSchema>;
export type A2ATaskProviderConfig = z.infer<typeof A2ATaskProviderConfigSchema>;

// Error types specific to A2A task storage
export type A2ATaskError = {
  readonly _tag: 'A2ATaskError';
  readonly message: string;
  readonly code: string;
  readonly provider: string;
  readonly taskId?: string;
  readonly cause?: Error;
};

export type A2ATaskNotFoundError = {
  readonly _tag: 'A2ATaskNotFoundError';
  readonly message: string;
  readonly taskId: string;
  readonly provider: string;
};

export type A2ATaskStorageError = {
  readonly _tag: 'A2ATaskStorageError';
  readonly message: string;
  readonly operation: string;
  readonly provider: string;
  readonly taskId?: string;
  readonly cause?: Error;
};

export type A2ATaskErrorUnion = 
  | A2ATaskError
  | A2ATaskNotFoundError 
  | A2ATaskStorageError;

// A2A-specific Result type for task operations
export type A2AResult<T> = 
  | { success: true; data: T }
  | { success: false; error: A2ATaskErrorUnion };

// Error factory functions
export const createA2ATaskError = (
  message: string,
  code: string,
  provider: string,
  taskId?: string,
  cause?: Error
): A2ATaskError => ({
  _tag: 'A2ATaskError',
  message,
  code,
  provider,
  taskId,
  cause
});

export const createA2ATaskNotFoundError = (
  taskId: string,
  provider: string
): A2ATaskNotFoundError => ({
  _tag: 'A2ATaskNotFoundError',
  message: `A2A task ${taskId} not found`,
  taskId,
  provider
});

export const createA2ATaskStorageError = (
  operation: string,
  provider: string,
  taskId?: string,
  cause?: Error
): A2ATaskStorageError => ({
  _tag: 'A2ATaskStorageError',
  message: `Failed to ${operation} A2A task${taskId ? ` ${taskId}` : ''} in ${provider}`,
  operation,
  provider,
  taskId,
  cause
});

// Error checking functions
export const isA2ATaskError = (error: any): error is A2ATaskErrorUnion => {
  return error && typeof error === 'object' && '_tag' in error && 
    (error._tag === 'A2ATaskError' || 
     error._tag === 'A2ATaskNotFoundError' || 
     error._tag === 'A2ATaskStorageError');
};

export const isA2ATaskNotFoundError = (error: any): error is A2ATaskNotFoundError => {
  return error && error._tag === 'A2ATaskNotFoundError';
};

export const isA2ATaskStorageError = (error: any): error is A2ATaskStorageError => {
  return error && error._tag === 'A2ATaskStorageError';
};

// A2A-specific Result functions
export const createA2ASuccess = <T>(data: T): A2AResult<T> => ({ success: true, data });

export const createA2AFailure = (error: A2ATaskErrorUnion): A2AResult<never> => ({ success: false, error });

// Convenience exports for backward compatibility
export const createSuccess = createA2ASuccess;
export const createFailure = createA2AFailure;