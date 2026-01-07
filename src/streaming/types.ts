/**
 * JAF Streaming Output System - Types
 * 
 * Provides a pluggable interface for streaming events to external systems
 * (Redis, HTTP webhooks, message queues, etc.)
 */

import { TraceEvent, RunState } from '../core/types.js';

/**
 * A single event to be pushed to a stream
 */
export type StreamEvent = {
  readonly eventType: string;
  readonly data: Record<string, unknown>;
  readonly timestamp: string;
  readonly metadata?: {
    readonly traceId?: string;
    readonly runId?: string;
    readonly agentName?: string;
    readonly [key: string]: unknown;
  };
};

/**
 * Configuration for retry behavior
 */
export type RetryConfig = {
  /** Maximum number of retry attempts (default: 3) */
  readonly maxRetries?: number;
  /** Base delay between retries in milliseconds (default: 50) */
  readonly retryDelayMs?: number;
  /** Use exponential backoff (default: true) */
  readonly exponentialBackoff?: boolean;
  /** Maximum delay cap in milliseconds (default: 5000) */
  readonly maxDelayMs?: number;
};

/**
 * Result of a stream operation
 */
export type StreamResult<T = void> = 
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: StreamError };

/**
 * Stream error types
 */
export type StreamError = {
  readonly _tag: 'StreamError';
  readonly message: string;
  readonly code: 'CONNECTION_ERROR' | 'TIMEOUT' | 'PUSH_FAILED' | 'PROVIDER_ERROR' | 'RETRY_EXHAUSTED';
  readonly provider: string;
  readonly attempts?: number;
  readonly cause?: Error;
};

/**
 * Health check result
 */
export type HealthCheckResult = {
  readonly healthy: boolean;
  readonly latencyMs?: number;
  readonly error?: string;
  readonly providerName: string;
};

/**
 * Stream Provider interface - implement this for custom stream destinations
 * 
 * @example
 * ```typescript
 * const myProvider: StreamProvider = {
 *   name: 'my-provider',
 *   push: async (sessionId, event) => {
 *     await myQueue.send({ sessionId, event });
 *     return { success: true, data: undefined };
 *   },
 *   healthCheck: async () => ({ healthy: true, providerName: 'my-provider' }),
 *   close: async () => { await myQueue.close(); return { success: true, data: undefined }; }
 * };
 * ```
 */
export interface StreamProvider {
  /** Provider name for logging/debugging */
  readonly name: string;
  
  /**
   * Push a single event to the stream
   * @param sessionId - Unique identifier for the session/conversation
   * @param event - The event to push
   */
  push(sessionId: string, event: StreamEvent): Promise<StreamResult<void>>;
  
  /**
   * Push multiple events in a batch (optional optimization)
   * @param sessionId - Unique identifier for the session/conversation
   * @param events - Array of events to push
   */
  pushBatch?(sessionId: string, events: readonly StreamEvent[]): Promise<StreamResult<void>>;
  
  /**
   * Check if the provider is healthy and connected
   */
  healthCheck(): Promise<HealthCheckResult>;
  
  /**
   * Close and cleanup the provider resources
   */
  close(): Promise<StreamResult<void>>;
}

/**
 * Configuration for the stream output handler
 */
export type StreamOutputConfig<Ctx = unknown> = {
  /** Extract session ID from context or event */
  readonly sessionId: string | ((context: Ctx, event: TraceEvent) => string | undefined);
  
  /** Filter which events to stream (default: all events) */
  readonly eventFilter?: (event: TraceEvent) => boolean;
  
  /** Map JAF event types to custom event type names */
  readonly eventMapping?: Record<TraceEvent['type'], string>;
  
  /** Transform event data before streaming */
  readonly eventTransformer?: (event: TraceEvent) => Record<string, unknown>;
  
  /** Retry configuration */
  readonly retry?: RetryConfig;
  
  /** Whether to block on push errors (default: false - fire and forget) */
  readonly blocking?: boolean;
  
  /** Callback when push fails after all retries */
  readonly onPushError?: (error: StreamError, event: TraceEvent, sessionId: string) => void;
  
  /** Callback when push succeeds */
  readonly onPushSuccess?: (event: TraceEvent, sessionId: string) => void;
};

/**
 * Base configuration for stream providers
 */
export type BaseStreamProviderConfig = {
  /** Provider name override */
  readonly name?: string;
  /** Retry configuration */
  readonly retry?: RetryConfig;
  /** Stream key prefix (e.g., 'agent_events:') */
  readonly streamPrefix?: string;
};

/**
 * In-memory stream provider configuration
 */
export type InMemoryStreamProviderConfig = BaseStreamProviderConfig & {
  readonly type: 'memory';
  /** Maximum events to keep per session (default: 1000) */
  readonly maxEventsPerSession?: number;
  /** Maximum total sessions (default: 100) */
  readonly maxSessions?: number;
};

/**
 * HTTP webhook stream provider configuration
 */
export type HttpStreamProviderConfig = BaseStreamProviderConfig & {
  readonly type: 'http';
  /** Webhook endpoint URL */
  readonly endpoint: string;
  /** HTTP headers to include */
  readonly headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 5000) */
  readonly timeoutMs?: number;
  /** HTTP method (default: POST) */
  readonly method?: 'POST' | 'PUT';
  /** Whether to batch events (default: false) */
  readonly batch?: {
    readonly enabled: boolean;
    readonly maxSize?: number;
    readonly flushIntervalMs?: number;
  };
};

/**
 * Redis stream provider configuration
 */
export type RedisStreamProviderConfig = BaseStreamProviderConfig & {
  readonly type: 'redis';
  /** Redis URL (e.g., 'redis://localhost:6379') */
  readonly url?: string;
  /** Redis host (default: 'localhost') */
  readonly host?: string;
  /** Redis port (default: 6379) */
  readonly port?: number;
  /** Redis password */
  readonly password?: string;
  /** Redis database number (default: 0) */
  readonly db?: number;
  /** Use RPUSH (list) or XADD (stream) - default: 'list' */
  readonly streamType?: 'list' | 'stream';
  /** Max length for Redis streams (only for streamType: 'stream') */
  readonly maxLen?: number;
};

/**
 * Console stream provider configuration (for debugging)
 */
export type ConsoleStreamProviderConfig = BaseStreamProviderConfig & {
  readonly type: 'console';
  /** Log level (default: 'info') */
  readonly level?: 'debug' | 'info' | 'warn';
  /** Pretty print JSON (default: true) */
  readonly pretty?: boolean;
  /** Include timestamp in output (default: true) */
  readonly includeTimestamp?: boolean;
};

/**
 * Union of all provider configurations
 */
export type StreamProviderConfig = 
  | InMemoryStreamProviderConfig
  | HttpStreamProviderConfig
  | RedisStreamProviderConfig
  | ConsoleStreamProviderConfig;

/**
 * Helper to create a stream error
 */
export const createStreamError = (
  message: string,
  code: StreamError['code'],
  provider: string,
  attempts?: number,
  cause?: Error
): StreamError => ({
  _tag: 'StreamError',
  message,
  code,
  provider,
  attempts,
  cause
});

/**
 * Helper to create a success result
 */
export const createStreamSuccess = <T>(data: T): StreamResult<T> => ({
  success: true,
  data
});

/**
 * Helper to create a failure result
 */
export const createStreamFailure = (error: StreamError): StreamResult<never> => ({
  success: false,
  error
});

/**
 * Type guard for successful result
 */
export const isStreamSuccess = <T>(result: StreamResult<T>): result is { success: true; data: T } => 
  result.success;

/**
 * Type guard for failed result
 */
export const isStreamFailure = <T>(result: StreamResult<T>): result is { success: false; error: StreamError } => 
  !result.success;

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  retryDelayMs: 50,
  exponentialBackoff: true,
  maxDelayMs: 5000
};

/**
 * Default stream output configuration
 */
export const DEFAULT_STREAM_OUTPUT_CONFIG: Partial<StreamOutputConfig> = {
  blocking: false,
  retry: DEFAULT_RETRY_CONFIG
};
