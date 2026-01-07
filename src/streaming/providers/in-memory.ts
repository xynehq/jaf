/**
 * JAF Streaming - In-Memory Stream Provider
 * 
 * Stores events in memory for testing and development.
 * Not suitable for production use.
 */

import {
  StreamProvider,
  StreamEvent,
  StreamResult,
  HealthCheckResult,
  InMemoryStreamProviderConfig,
  createStreamSuccess,
  createStreamFailure,
  createStreamError
} from '../types.js';
import { safeConsole } from '../../utils/logger.js';

/**
 * In-memory storage for stream events
 */
type EventStore = Map<string, StreamEvent[]>;

/**
 * Create an in-memory stream provider
 * 
 * @example
 * ```typescript
 * const provider = createInMemoryStreamProvider({
 *   type: 'memory',
 *   maxEventsPerSession: 100,
 *   maxSessions: 50
 * });
 * 
 * await provider.push('session-123', {
 *   eventType: 'tool_input',
 *   data: { toolName: 'search', input: 'query' },
 *   timestamp: new Date().toISOString()
 * });
 * 
 * // Get stored events for testing
 * const events = provider.getEvents('session-123');
 * ```
 */
export function createInMemoryStreamProvider(
  config: Omit<InMemoryStreamProviderConfig, 'type'> = {}
): StreamProvider & {
  /** Get all events for a session (for testing) */
  getEvents: (sessionId: string) => readonly StreamEvent[];
  /** Get all sessions (for testing) */
  getSessions: () => readonly string[];
  /** Clear events for a session (for testing) */
  clearSession: (sessionId: string) => void;
  /** Clear all events (for testing) */
  clearAll: () => void;
  /** Get event count across all sessions */
  getTotalEventCount: () => number;
} {
  const maxEventsPerSession = config.maxEventsPerSession ?? 1000;
  const maxSessions = config.maxSessions ?? 100;
  const streamPrefix = config.streamPrefix ?? '';
  const providerName = config.name ?? 'in-memory-stream';
  
  const store: EventStore = new Map();
  let closed = false;
  
  /**
   * Get the storage key for a session
   */
  const getKey = (sessionId: string): string => `${streamPrefix}${sessionId}`;
  
  /**
   * Evict oldest session if we've exceeded max sessions
   */
  const evictOldestSessionIfNeeded = (): void => {
    if (store.size > maxSessions) {
      // Find and remove the oldest session (first key)
      const oldestKey = store.keys().next().value;
      if (oldestKey) {
        store.delete(oldestKey);
        safeConsole.log(`[JAF:STREAM:MEMORY] Evicted oldest session: ${oldestKey}`);
      }
    }
  };
  
  /**
   * Trim events for a session if exceeding max
   */
  const trimEventsIfNeeded = (key: string): void => {
    const events = store.get(key);
    if (events && events.length > maxEventsPerSession) {
      // Keep the most recent events
      const trimmed = events.slice(-maxEventsPerSession);
      store.set(key, trimmed);
      safeConsole.log(
        `[JAF:STREAM:MEMORY] Trimmed events for ${key}: ${events.length} → ${trimmed.length}`
      );
    }
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
      
      try {
        const key = getKey(sessionId);
        
        // Get or create session events array
        let events = store.get(key);
        if (!events) {
          evictOldestSessionIfNeeded();
          events = [];
          store.set(key, events);
        }
        
        // Add event
        events.push(event);
        
        // Trim if needed
        trimEventsIfNeeded(key);
        
        safeConsole.log(
          `[JAF:STREAM:MEMORY] Pushed event to ${key}: ${event.eventType}`
        );
        
        return createStreamSuccess(undefined);
        
      } catch (error) {
        return createStreamFailure(
          createStreamError(
            error instanceof Error ? error.message : String(error),
            'PUSH_FAILED',
            providerName,
            undefined,
            error instanceof Error ? error : undefined
          )
        );
      }
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
      
      try {
        const key = getKey(sessionId);
        
        // Get or create session events array
        let storedEvents = store.get(key);
        if (!storedEvents) {
          evictOldestSessionIfNeeded();
          storedEvents = [];
          store.set(key, storedEvents);
        }
        
        // Add all events
        storedEvents.push(...events);
        
        // Trim if needed
        trimEventsIfNeeded(key);
        
        safeConsole.log(
          `[JAF:STREAM:MEMORY] Pushed ${events.length} events to ${key}`
        );
        
        return createStreamSuccess(undefined);
        
      } catch (error) {
        return createStreamFailure(
          createStreamError(
            error instanceof Error ? error.message : String(error),
            'PUSH_FAILED',
            providerName,
            undefined,
            error instanceof Error ? error : undefined
          )
        );
      }
    },
    
    async healthCheck(): Promise<HealthCheckResult> {
      return {
        healthy: !closed,
        providerName,
        latencyMs: 0,
        error: closed ? 'Provider is closed' : undefined
      };
    },
    
    async close(): Promise<StreamResult<void>> {
      closed = true;
      store.clear();
      safeConsole.log(`[JAF:STREAM:MEMORY] Provider closed`);
      return createStreamSuccess(undefined);
    },
    
    // Test utilities
    getEvents(sessionId: string): readonly StreamEvent[] {
      const key = getKey(sessionId);
      return store.get(key) ?? [];
    },
    
    getSessions(): readonly string[] {
      return Array.from(store.keys()).map(key => 
        key.startsWith(streamPrefix) ? key.slice(streamPrefix.length) : key
      );
    },
    
    clearSession(sessionId: string): void {
      const key = getKey(sessionId);
      store.delete(key);
    },
    
    clearAll(): void {
      store.clear();
    },
    
    getTotalEventCount(): number {
      let count = 0;
      for (const events of store.values()) {
        count += events.length;
      }
      return count;
    }
  };
}
