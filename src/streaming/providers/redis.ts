/**
 * JAF Streaming - Redis Stream Provider
 * 
 * Pushes events to Redis using RPUSH (list) or XADD (stream).
 * 
 * IMPORTANT: Requires 'ioredis' as a peer dependency.
 * Install with: npm install ioredis
 */

import {
  StreamProvider,
  StreamEvent,
  StreamResult,
  HealthCheckResult,
  RedisStreamProviderConfig,
  createStreamSuccess,
  createStreamFailure,
  createStreamError
} from '../types.js';
import { withRetry } from '../retry.js';
import { safeConsole } from '../../utils/logger.js';

/**
 * Redis client interface (subset of ioredis)
 */
interface RedisClient {
  rpush(key: string, ...values: string[]): Promise<number>;
  xadd(key: string, id: string, ...fieldsAndValues: string[]): Promise<string>;
  ping(): Promise<string>;
  quit(): Promise<string>;
}

/**
 * Create a Redis stream provider
 * 
 * @example
 * ```typescript
 * const provider = await createRedisStreamProvider({
 *   type: 'redis',
 *   url: 'redis://localhost:6379',
 *   streamPrefix: 'agent_events:',
 *   retry: { maxRetries: 3, retryDelayMs: 50 }
 * });
 * 
 * await provider.push('session-123', {
 *   eventType: 'tool_input',
 *   data: { toolName: 'search', input: 'query' },
 *   timestamp: new Date().toISOString()
 * });
 * ```
 */
export async function createRedisStreamProvider(
  config: Omit<RedisStreamProviderConfig, 'type'>
): Promise<StreamProvider> {
  const streamPrefix = config.streamPrefix ?? 'jaf:stream:';
  const providerName = config.name ?? 'redis-stream';
  const streamType = config.streamType ?? 'list';
  const maxLen = config.maxLen;
  const retryConfig = config.retry ?? { maxRetries: 3, retryDelayMs: 50 };

  let client: RedisClient;
  let closed = false;

  // Dynamically import ioredis (peer dependency - must be installed separately)
  try {
    const ioredisModule = await import('ioredis');
    const Redis = ioredisModule.default;

    if (config.url) {
      client = new Redis(config.url) as unknown as RedisClient;
    } else {
      client = new Redis({
        host: config.host ?? 'localhost',
        port: config.port ?? 6379,
        password: config.password,
        db: config.db ?? 0
      }) as unknown as RedisClient;
    }

    // Test connection
    await client.ping();
    safeConsole.log(`[JAF:STREAM:REDIS] Connected to Redis`);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    // Check if it's a module not found error
    if (errMsg.includes('Cannot find module') || errMsg.includes('ioredis')) {
      throw new Error(
        `Redis provider requires 'ioredis' package. Install it with: npm install ioredis\n` +
        `Original error: ${errMsg}`
      );
    }

    throw new Error(`Failed to connect to Redis: ${errMsg}`);
  }

  /**
   * Get the stream key for a session
   */
  const getStreamKey = (sessionId: string): string => `${streamPrefix}${sessionId}`;

  /**
   * Serialize event to JSON string
   */
  const serializeEvent = (event: StreamEvent): string => {
    return JSON.stringify({
      event_type: event.eventType,
      data: event.data,
      timestamp: event.timestamp,
      metadata: event.metadata
    });
  };

  return {
    name: providerName,

    async push(sessionId: string, event: StreamEvent): Promise<StreamResult<void>> {
      if (closed) {
        return createStreamFailure(
          createStreamError(
            'Provider is closed',
            'PROVIDER_ERROR',
            providerName
          )
        );
      }

      const streamKey = getStreamKey(sessionId);
      const serialized = serializeEvent(event);

      const result = await withRetry(
        async () => {
          if (streamType === 'stream') {
            // Use XADD for Redis Streams
            const args: string[] = [streamKey, '*', 'event', serialized];
            if (maxLen) {
              args.splice(1, 0, 'MAXLEN', '~', String(maxLen));
            }
            await client.xadd(streamKey, '*', 'event', serialized);
          } else {
            // Use RPUSH for Redis Lists (default, matches Python implementation)
            await client.rpush(streamKey, serialized);
          }
        },
        {
          providerName,
          config: retryConfig
        }
      );

      if (result.success) {
        safeConsole.log(`[JAF:STREAM:REDIS] Pushed event to ${streamKey}: ${event.eventType}`);
      }

      return result;
    },

    async pushBatch(sessionId: string, events: readonly StreamEvent[]): Promise<StreamResult<void>> {
      if (closed) {
        return createStreamFailure(
          createStreamError(
            'Provider is closed',
            'PROVIDER_ERROR',
            providerName
          )
        );
      }

      if (events.length === 0) {
        return createStreamSuccess(undefined);
      }

      const streamKey = getStreamKey(sessionId);
      const serialized = events.map(serializeEvent);

      const result = await withRetry(
        async () => {
          if (streamType === 'stream') {
            // XADD each event (Redis Streams don't have batch XADD)
            for (const event of serialized) {
              await client.xadd(streamKey, '*', 'event', event);
            }
          } else {
            // RPUSH all at once for lists
            await client.rpush(streamKey, ...serialized);
          }
        },
        {
          providerName,
          config: retryConfig
        }
      );

      if (result.success) {
        safeConsole.log(`[JAF:STREAM:REDIS] Pushed ${events.length} events to ${streamKey}`);
      }

      return result;
    },

    async healthCheck(): Promise<HealthCheckResult> {
      if (closed) {
        return {
          healthy: false,
          providerName,
          error: 'Provider is closed'
        };
      }

      const start = Date.now();
      try {
        await client.ping();
        return {
          healthy: true,
          providerName,
          latencyMs: Date.now() - start
        };
      } catch (error) {
        return {
          healthy: false,
          providerName,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },

    async close(): Promise<StreamResult<void>> {
      if (closed) {
        return createStreamSuccess(undefined);
      }

      closed = true;

      try {
        await client.quit();
        safeConsole.log(`[JAF:STREAM:REDIS] Connection closed`);
        return createStreamSuccess(undefined);
      } catch (error) {
        return createStreamFailure(
          createStreamError(
            error instanceof Error ? error.message : String(error),
            'PROVIDER_ERROR',
            providerName,
            undefined,
            error instanceof Error ? error : undefined
          )
        );
      }
    }
  };
}

/**
 * Create a Redis stream provider with a pre-existing client
 * Useful when you already have a Redis connection
 * 
 * @example
 * ```typescript
 * import Redis from 'ioredis';
 * 
 * const redis = new Redis('redis://localhost:6379');
 * const provider = createRedisStreamProviderWithClient(redis, {
 *   streamPrefix: 'agent_events:'
 * });
 * ```
 */
export function createRedisStreamProviderWithClient(
  client: RedisClient,
  config: Omit<RedisStreamProviderConfig, 'type' | 'url' | 'host' | 'port' | 'password' | 'db'> = {}
): StreamProvider {
  const streamPrefix = config.streamPrefix ?? 'jaf:stream:';
  const providerName = config.name ?? 'redis-stream';
  const streamType = config.streamType ?? 'list';
  const retryConfig = config.retry ?? { maxRetries: 3, retryDelayMs: 50 };

  let closed = false;

  const getStreamKey = (sessionId: string): string => `${streamPrefix}${sessionId}`;

  const serializeEvent = (event: StreamEvent): string => {
    return JSON.stringify({
      event_type: event.eventType,
      data: event.data,
      timestamp: event.timestamp,
      metadata: event.metadata
    });
  };

  return {
    name: providerName,

    async push(sessionId: string, event: StreamEvent): Promise<StreamResult<void>> {
      if (closed) {
        return createStreamFailure(
          createStreamError('Provider is closed', 'PROVIDER_ERROR', providerName)
        );
      }

      const streamKey = getStreamKey(sessionId);
      const serialized = serializeEvent(event);

      const result = await withRetry(
        async () => {
          if (streamType === 'stream') {
            await client.xadd(streamKey, '*', 'event', serialized);
          } else {
            await client.rpush(streamKey, serialized);
          }
        },
        { providerName, config: retryConfig }
      );

      if (result.success) {
        safeConsole.log(`[JAF:STREAM:REDIS] Pushed event to ${streamKey}: ${event.eventType}`);
      }

      return result;
    },

    async pushBatch(sessionId: string, events: readonly StreamEvent[]): Promise<StreamResult<void>> {
      if (closed || events.length === 0) {
        return closed
          ? createStreamFailure(createStreamError('Provider is closed', 'PROVIDER_ERROR', providerName))
          : createStreamSuccess(undefined);
      }

      const streamKey = getStreamKey(sessionId);
      const serialized = events.map(serializeEvent);

      const result = await withRetry(
        async () => {
          if (streamType === 'stream') {
            for (const event of serialized) {
              await client.xadd(streamKey, '*', 'event', event);
            }
          } else {
            await client.rpush(streamKey, ...serialized);
          }
        },
        { providerName, config: retryConfig }
      );

      return result;
    },

    async healthCheck(): Promise<HealthCheckResult> {
      if (closed) {
        return { healthy: false, providerName, error: 'Provider is closed' };
      }

      const start = Date.now();
      try {
        await client.ping();
        return { healthy: true, providerName, latencyMs: Date.now() - start };
      } catch (error) {
        return {
          healthy: false,
          providerName,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },

    async close(): Promise<StreamResult<void>> {
      closed = true;
      // Don't close the client since we don't own it
      safeConsole.log(`[JAF:STREAM:REDIS] Provider closed (client not closed)`);
      return createStreamSuccess(undefined);
    }
  };
}
