import { z } from 'zod';
import { Message, TraceId, RunId } from '../core/types';

// Conversation status types
export type ConversationStatus = 
  | 'completed'   // Conversation finished successfully
  | 'halted';     // Stuck on approval/interruption (HITL)

// Result type for functional error handling
export type Result<T, E = MemoryErrorUnion> = 
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

/**
 * Memory management types for the JAF framework
 */

export interface ConversationMemory {
  readonly conversationId: string;
  readonly userId?: string;
  readonly messages: readonly Message[];
  readonly metadata?: {
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly totalMessages: number;
    readonly lastActivity: Date;
    readonly [key: string]: any;
  };
}

export interface MemoryQuery {
  readonly conversationId?: string;
  readonly userId?: string;
  readonly traceId?: TraceId;
  readonly limit?: number;
  readonly offset?: number;
  readonly since?: Date;
  readonly until?: Date;
}

export type MemoryProvider = {
  /**
   * Store messages for a conversation
   */
  readonly storeMessages: (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { userId?: string; traceId?: TraceId; [key: string]: any }
  ) => Promise<Result<void>>;

  /**
   * Retrieve conversation history
   */
  readonly getConversation: (conversationId: string) => Promise<Result<ConversationMemory | null>>;

  /**
   * Append new messages to existing conversation
   */
  readonly appendMessages: (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { traceId?: TraceId; [key: string]: any }
  ) => Promise<Result<void>>;

  /**
   * Search conversations by query
   */
  readonly findConversations: (query: MemoryQuery) => Promise<Result<ConversationMemory[]>>;

  /**
   * Get recent messages from a conversation
   */
  readonly getRecentMessages: (
    conversationId: string,
    limit?: number
  ) => Promise<Result<readonly Message[]>>;

  /**
   * Delete conversation
   */
  readonly deleteConversation: (conversationId: string) => Promise<Result<boolean>>;

  /**
   * Clear all conversations for a user
   */
  readonly clearUserConversations: (userId: string) => Promise<Result<number>>;

  /**
   * Get conversation statistics
   */
  readonly getStats: (userId?: string) => Promise<Result<{
    totalConversations: number;
    totalMessages: number;
    oldestConversation?: Date;
    newestConversation?: Date;
  }>>;

  /**
   * Health check for the memory provider
   */
  readonly healthCheck: () => Promise<Result<{ healthy: boolean; latencyMs?: number; error?: string }>>;

  /**
   * Close/cleanup the provider
   */
  readonly close: () => Promise<Result<void>>;
  
  /**
   * Restore a conversation to a checkpoint above a specific user message.
   * Removes the targeted user message and all messages after it.
   * Returns the targeted user query text.
   */
  readonly restoreToCheckpoint: (
    conversationId: string,
    criteria: CheckpointCriteria
  ) => Promise<Result<{
    restored: boolean;
    removedMessagesCount: number;
    checkpointIndex: number;
    checkpointUserQuery?: string;
  }>>;
};

/**
 * Criteria to identify the user message to checkpoint against.
 * Provide exactly one of the selectors. If multiple are provided,
 * precedence is: byMessageId > byIndex > byUserMessageNumber > byText.
 *
 * - byIndex: 0-based index into the messages array
 * - byUserMessageNumber: 0-based index among only 'user' role messages
 * - byText: match the message text using the specified match mode
 */
export type CheckpointCriteria = {
  readonly byMessageId?: string;
  readonly byIndex?: number;
  readonly byUserMessageNumber?: number;
  readonly byText?: string;
  readonly match?: 'exact' | 'startsWith' | 'contains';
};

export interface MemoryConfig {
  readonly provider: MemoryProvider;
  readonly autoStore?: boolean; // Automatically store conversation history
  readonly maxMessages?: number; // Maximum messages to keep in memory
  readonly ttl?: number; // Time-to-live in seconds for conversations
  readonly compressionThreshold?: number; // Compress conversations after N messages
  readonly storeOnCompletion?: boolean; // Store conversation on completion (in addition to interruptions)
}

// Configuration schemas for different providers
export const InMemoryConfigSchema = z.object({
  type: z.literal('memory'),
  maxConversations: z.number().default(1000),
  maxMessagesPerConversation: z.number().default(1000)
});

export const RedisConfigSchema = z.object({
  type: z.literal('redis'),
  url: z.string().optional(),
  host: z.string().default('localhost'),
  port: z.number().default(6379),
  password: z.string().optional(),
  db: z.number().default(0),
  keyPrefix: z.string().default('jaf:memory:'),
  ttl: z.number().optional() // seconds
});

export const PostgresConfigSchema = z.object({
  type: z.literal('postgres'),
  connectionString: z.string().optional(),
  host: z.string().default('localhost'),
  port: z.number().default(5432),
  database: z.string().default('jaf_memory'),
  username: z.string().default('postgres'),
  password: z.string().optional(),
  ssl: z.boolean().default(false),
  tableName: z.string().default('conversations'),
  maxConnections: z.number().default(10)
});

export const MemoryProviderConfigSchema = z.union([
  InMemoryConfigSchema,
  RedisConfigSchema,
  PostgresConfigSchema
]);

export type InMemoryConfig = z.infer<typeof InMemoryConfigSchema>;
export type RedisConfig = z.infer<typeof RedisConfigSchema>;
export type PostgresConfig = z.infer<typeof PostgresConfigSchema>;
export type MemoryProviderConfig = z.infer<typeof MemoryProviderConfigSchema>;

// Functional error types
export type MemoryError = {
  readonly _tag: 'MemoryError';
  readonly message: string;
  readonly code: string;
  readonly provider: string;
  readonly cause?: Error;
};

export type MemoryConnectionError = {
  readonly _tag: 'MemoryConnectionError';
  readonly message: string;
  readonly provider: string;
  readonly cause?: Error;
};

export type MemoryNotFoundError = {
  readonly _tag: 'MemoryNotFoundError';
  readonly message: string;
  readonly conversationId: string;
  readonly provider: string;
};

export type MemoryStorageError = {
  readonly _tag: 'MemoryStorageError';
  readonly message: string;
  readonly operation: string;
  readonly provider: string;
  readonly cause?: Error;
};

export type MemoryErrorUnion = 
  | MemoryConnectionError 
  | MemoryNotFoundError 
  | MemoryStorageError;

// Error factory functions
export const createMemoryError = (
  message: string,
  code: string,
  provider: string,
  cause?: Error
): MemoryError => ({
  _tag: 'MemoryError',
  message,
  code,
  provider,
  cause
});

export const createMemoryConnectionError = (
  provider: string,
  cause?: Error
): MemoryConnectionError => ({
  _tag: 'MemoryConnectionError',
  message: `Failed to connect to ${provider} memory provider`,
  provider,
  cause
});

export const createMemoryNotFoundError = (
  conversationId: string,
  provider: string
): MemoryNotFoundError => ({
  _tag: 'MemoryNotFoundError',
  message: `Conversation ${conversationId} not found`,
  conversationId,
  provider
});

export const createMemoryStorageError = (
  operation: string,
  provider: string,
  cause?: Error
): MemoryStorageError => ({
  _tag: 'MemoryStorageError',
  message: `Failed to ${operation} in ${provider}`,
  operation,
  provider,
  cause
});

// Error checking functions
export const isMemoryError = (error: any): error is MemoryErrorUnion => {
  return error && typeof error === 'object' && '_tag' in error && 
    (error._tag === 'MemoryConnectionError' || 
     error._tag === 'MemoryNotFoundError' || 
     error._tag === 'MemoryStorageError');
};

export const isMemoryConnectionError = (error: any): error is MemoryConnectionError => {
  return error && error._tag === 'MemoryConnectionError';
};

export const isMemoryNotFoundError = (error: any): error is MemoryNotFoundError => {
  return error && error._tag === 'MemoryNotFoundError';
};

export const isMemoryStorageError = (error: any): error is MemoryStorageError => {
  return error && error._tag === 'MemoryStorageError';
};

// Result helper functions
export const createSuccess = <T>(data: T): Result<T> => ({
  success: true,
  data
});

export const createFailure = <E extends MemoryErrorUnion>(error: E): Result<never, E> => ({
  success: false,
  error
});

export const isSuccess = <T, E>(result: Result<T, E>): result is { success: true; data: T } => {
  return result.success;
};

export const isFailure = <T, E>(result: Result<T, E>): result is { success: false; error: E } => {
  return !result.success;
};
