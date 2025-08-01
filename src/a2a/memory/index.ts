/**
 * A2A Memory Module for FAF
 * Exports all A2A task memory functionality
 */

// Types and interfaces (excluding conflicting utility functions)
export type {
  A2ATaskQuery,
  A2ATaskStorage,
  A2ATaskProvider,
  A2ATaskMemoryConfig,
  A2AInMemoryTaskConfig,
  A2ARedisTaskConfig,
  A2APostgresTaskConfig,
  A2ATaskProviderConfig,
  A2ATaskError,
  A2ATaskNotFoundError,
  A2ATaskStorageError,
  A2ATaskErrorUnion,
  A2AResult
} from './types.js';

export {
  createA2ATaskError,
  createA2ATaskNotFoundError,
  createA2ATaskStorageError,
  isA2ATaskError,
  isA2ATaskNotFoundError,
  isA2ATaskStorageError,
  createA2ASuccess,
  createA2AFailure
} from './types.js';

// Serialization utilities
export * from './serialization.js';

// Provider implementations
export { createA2AInMemoryTaskProvider } from './providers/in-memory.js';
export { createA2ARedisTaskProvider } from './providers/redis.js';
export { createA2APostgresTaskProvider } from './providers/postgres.js';

// Factory functions
export * from './factory.js';

// Cleanup functions
export * from './cleanup.js';