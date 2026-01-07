/**
 * JAF Streaming Output System
 * 
 * Provides a pluggable interface for streaming agent events to external systems
 * like Redis, HTTP webhooks, message queues, etc.
 * 
 * @example Basic Redis streaming (similar to your Python implementation)
 * ```typescript
 * import { 
 *   createRedisStreamProvider, 
 *   withStreamOutput,
 *   EventMappings 
 * } from '@xynehq/jaf/streaming';
 * 
 * // Create Redis provider (requires: npm install ioredis)
 * const streamProvider = await createRedisStreamProvider({
 *   url: 'redis://localhost:6379',
 *   streamPrefix: 'agent_events:',
 *   retry: { maxRetries: 3, retryDelayMs: 50 }
 * });
 * 
 * // Use with JAF's onEvent
 * const config: RunConfig<MyContext> = {
 *   agentRegistry,
 *   modelProvider,
 *   onEvent: withStreamOutput(streamProvider, {
 *     sessionId: (ctx) => ctx.sessionId,
 *     eventFilter: (e) => ['tool_call_start', 'tool_call_end'].includes(e.type),
 *     eventMapping: EventMappings.pythonCompatible
 *   })
 * };
 * ```
 * 
 * @example Composing multiple handlers
 * ```typescript
 * import { composeEventHandlers, withStreamOutput, createConsoleEventHandler } from '@xynehq/jaf/streaming';
 * 
 * const config: RunConfig<MyContext> = {
 *   onEvent: composeEventHandlers([
 *     withStreamOutput(redisProvider, { sessionId: ctx => ctx.sessionId }),
 *     createConsoleEventHandler({ pretty: true })
 *   ])
 * };
 * ```
 * 
 * @module streaming
 */

// ========== Core Types ==========
export {
  // Stream types
  type StreamEvent,
  type StreamResult,
  type StreamError,
  type HealthCheckResult,
  
  // Provider interface
  type StreamProvider,
  
  // Configuration types
  type RetryConfig,
  type StreamOutputConfig,
  type BaseStreamProviderConfig,
  type StreamProviderConfig,
  type InMemoryStreamProviderConfig,
  type HttpStreamProviderConfig,
  type RedisStreamProviderConfig,
  type ConsoleStreamProviderConfig,
  
  // Result helpers
  createStreamError,
  createStreamSuccess,
  createStreamFailure,
  isStreamSuccess,
  isStreamFailure,
  
  // Defaults
  DEFAULT_RETRY_CONFIG,
  DEFAULT_STREAM_OUTPUT_CONFIG
} from './types.js';

// ========== Retry Utilities ==========
export {
  // Retry functions
  withRetry,
  makeRetryable,
  withFallback,
  
  // Circuit breaker
  withCircuitBreaker,
  resetCircuitBreaker,
  getCircuitBreakerStatus,
  
  // Utilities
  calculateBackoffDelay,
  
  // Types
  type RetryContext,
  type WithRetryOptions,
  type CircuitBreakerOptions
} from './retry.js';

// ========== Event Handler Integration ==========
export {
  // Main integration
  withStreamOutput,
  composeEventHandlers,
  
  // Console handler (for debugging)
  createConsoleEventHandler,
  
  // Event filtering
  filterEventsByType,
  EventFilters,
  
  // Event mapping
  createEventMapping,
  EventMappings
} from './event-handler.js';

// ========== Providers ==========

// In-Memory Provider (no external dependencies)
export { createInMemoryStreamProvider } from './providers/in-memory.js';

// Redis Provider (requires ioredis peer dependency)
export { 
  createRedisStreamProvider,
  createRedisStreamProviderWithClient
} from './providers/redis.js';

// PostgreSQL Provider (requires pg peer dependency)
export { 
  createPostgresStreamProvider,
  createPostgresStreamProviderWithQueries,
  type PostgresClient,
  type PostgresStreamProviderConfig
} from './providers/postgres.js';

// ========== Convenience Factory ==========

import { StreamProviderConfig, StreamProvider } from './types.js';
import { createInMemoryStreamProvider } from './providers/in-memory.js';
import { createRedisStreamProvider } from './providers/redis.js';

/**
 * Factory function to create a stream provider from config
 * 
 * @example
 * ```typescript
 * const provider = await createStreamProvider({
 *   type: 'redis',
 *   url: 'redis://localhost:6379'
 * });
 * ```
 */
export async function createStreamProvider(
  config: StreamProviderConfig
): Promise<StreamProvider> {
  switch (config.type) {
    case 'memory':
      return createInMemoryStreamProvider(config);
    
    case 'redis':
      return createRedisStreamProvider(config);
    
    case 'http':
      throw new Error(
        'HTTP stream provider not yet implemented. ' +
        'Use withStreamOutput with a custom provider or contribute an implementation!'
      );
    
    case 'console':
      throw new Error(
        'Console stream provider not yet implemented. ' +
        'Use createConsoleEventHandler for console logging.'
      );
    
    default:
      throw new Error(`Unknown stream provider type: ${(config as any).type}`);
  }
}
