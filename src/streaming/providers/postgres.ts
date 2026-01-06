/**
 * JAF Streaming - PostgreSQL Stream Provider
 * 
 * Stores stream events in PostgreSQL for durability and queryability.
 * 
 * IMPORTANT: Requires 'pg' as a peer dependency.
 * Install with: npm install pg
 */

import {
  StreamProvider,
  StreamEvent,
  StreamResult,
  HealthCheckResult,
  RetryConfig,
  createStreamSuccess,
  createStreamFailure,
  createStreamError
} from '../types.js';
import { withRetry } from '../retry.js';
import { safeConsole } from '../../utils/logger.js';

/**
 * PostgreSQL client interface (compatible with pg, postgres.js, etc.)
 */
export interface PostgresClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
  end(): Promise<void>;
}

/**
 * PostgreSQL stream provider configuration
 */
export type PostgresStreamProviderConfig = {
  /** Provider name override */
  readonly name?: string;
  /** Retry configuration */
  readonly retry?: RetryConfig;
  /** Stream key prefix (e.g., 'agent_events:') */
  readonly streamPrefix?: string;
  /** Table name for stream events (default: 'stream_events') */
  readonly tableName?: string;
  /** Whether to auto-create the table (default: true) */
  readonly autoCreateTable?: boolean;
  /** Maximum events to keep per session (for cleanup) */
  readonly maxEventsPerSession?: number;
};

/**
 * Create a PostgreSQL stream provider with a pre-existing client
 * 
 * @example
 * ```typescript
 * import { Pool } from 'pg';
 * 
 * const pool = new Pool({ connectionString: 'postgres://...' });
 * const provider = await createPostgresStreamProvider(pool, {
 *   tableName: 'agent_stream_events',
 *   streamPrefix: 'agent_events:'
 * });
 * 
 * await provider.push('session-123', {
 *   eventType: 'tool_input',
 *   data: { toolName: 'search', input: 'query' },
 *   timestamp: new Date().toISOString()
 * });
 * ```
 */
export async function createPostgresStreamProvider(
  client: PostgresClient,
  config: PostgresStreamProviderConfig = {}
): Promise<StreamProvider> {
  const streamPrefix = config.streamPrefix ?? '';
  const providerName = config.name ?? 'postgres-stream';
  const tableName = config.tableName ?? 'stream_events';
  const autoCreateTable = config.autoCreateTable ?? true;
  const retryConfig = config.retry ?? { maxRetries: 3, retryDelayMs: 50 };
  
  let closed = false;
  
  // Initialize schema if needed
  if (autoCreateTable) {
    try {
      await initializeSchema(client, tableName);
      safeConsole.log(`[JAF:STREAM:POSTGRES] Schema initialized for table ${tableName}`);
    } catch (error) {
      throw new Error(
        `Failed to initialize PostgreSQL schema: ${error instanceof Error ? error.message : error}`
      );
    }
  }
  
  /**
   * Get the stream key for a session
   */
  const getStreamKey = (sessionId: string): string => `${streamPrefix}${sessionId}`;
  
  return {
    name: providerName,
    
    async push(sessionId: string, event: StreamEvent): Promise<StreamResult<void>> {
      if (closed) {
        return createStreamFailure(
          createStreamError('Provider is closed', 'PROVIDER_ERROR', providerName)
        );
      }
      
      const streamKey = getStreamKey(sessionId);
      
      const result = await withRetry(
        async () => {
          const sql = `
            INSERT INTO ${tableName} 
            (session_id, stream_key, event_type, event_data, metadata, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
          `;
          
          await client.query(sql, [
            sessionId,
            streamKey,
            event.eventType,
            JSON.stringify(event.data),
            JSON.stringify(event.metadata ?? {}),
            event.timestamp
          ]);
        },
        {
          providerName,
          config: retryConfig
        }
      );
      
      if (result.success) {
        safeConsole.log(`[JAF:STREAM:POSTGRES] Pushed event to ${streamKey}: ${event.eventType}`);
      }
      
      return result;
    },
    
    async pushBatch(sessionId: string, events: readonly StreamEvent[]): Promise<StreamResult<void>> {
      if (closed) {
        return createStreamFailure(
          createStreamError('Provider is closed', 'PROVIDER_ERROR', providerName)
        );
      }
      
      if (events.length === 0) {
        return createStreamSuccess(undefined);
      }
      
      const streamKey = getStreamKey(sessionId);
      
      const result = await withRetry(
        async () => {
          // Build batch insert
          const values: unknown[] = [];
          const placeholders: string[] = [];
          
          events.forEach((event, index) => {
            const offset = index * 6;
            placeholders.push(
              `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`
            );
            values.push(
              sessionId,
              streamKey,
              event.eventType,
              JSON.stringify(event.data),
              JSON.stringify(event.metadata ?? {}),
              event.timestamp
            );
          });
          
          const sql = `
            INSERT INTO ${tableName} 
            (session_id, stream_key, event_type, event_data, metadata, created_at)
            VALUES ${placeholders.join(', ')}
          `;
          
          await client.query(sql, values);
        },
        {
          providerName,
          config: retryConfig
        }
      );
      
      if (result.success) {
        safeConsole.log(`[JAF:STREAM:POSTGRES] Pushed ${events.length} events to ${streamKey}`);
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
        await client.query('SELECT 1');
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
      // Don't close the client since we don't own it
      safeConsole.log(`[JAF:STREAM:POSTGRES] Provider closed (client not closed)`);
      return createStreamSuccess(undefined);
    }
  };
}

/**
 * Extended PostgreSQL stream provider with query capabilities
 * 
 * @example
 * ```typescript
 * const provider = await createPostgresStreamProviderWithQueries(pool, config);
 * 
 * // Get events for a session
 * const events = await provider.getEvents('session-123', { limit: 100 });
 * 
 * // Get events by type
 * const toolEvents = await provider.getEventsByType('session-123', 'tool_call_start');
 * 
 * // Cleanup old events
 * await provider.cleanupOldEvents(30); // Delete events older than 30 days
 * ```
 */
export async function createPostgresStreamProviderWithQueries(
  client: PostgresClient,
  config: PostgresStreamProviderConfig = {}
): Promise<StreamProvider & {
  /** Get events for a session */
  getEvents: (sessionId: string, options?: { limit?: number; offset?: number; since?: Date }) => Promise<readonly StreamEvent[]>;
  /** Get events by type for a session */
  getEventsByType: (sessionId: string, eventType: string, options?: { limit?: number }) => Promise<readonly StreamEvent[]>;
  /** Get event count for a session */
  getEventCount: (sessionId: string) => Promise<number>;
  /** Cleanup old events */
  cleanupOldEvents: (olderThanDays: number) => Promise<number>;
  /** Clear events for a session */
  clearSession: (sessionId: string) => Promise<number>;
}> {
  const baseProvider = await createPostgresStreamProvider(client, config);
  const tableName = config.tableName ?? 'stream_events';
  const streamPrefix = config.streamPrefix ?? '';
  
  const getStreamKey = (sessionId: string): string => `${streamPrefix}${sessionId}`;
  
  return {
    ...baseProvider,
    
    async getEvents(
      sessionId: string, 
      options?: { limit?: number; offset?: number; since?: Date }
    ): Promise<readonly StreamEvent[]> {
      const streamKey = getStreamKey(sessionId);
      const limit = options?.limit ?? 100;
      const offset = options?.offset ?? 0;
      
      let sql = `
        SELECT event_type, event_data, metadata, created_at
        FROM ${tableName}
        WHERE stream_key = $1
      `;
      const params: unknown[] = [streamKey];
      let paramIndex = 2;
      
      if (options?.since) {
        sql += ` AND created_at >= $${paramIndex}`;
        params.push(options.since.toISOString());
        paramIndex++;
      }
      
      sql += ` ORDER BY created_at ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);
      
      const result = await client.query(sql, params);
      
      return result.rows.map((row: any) => ({
        eventType: row.event_type,
        data: typeof row.event_data === 'string' ? JSON.parse(row.event_data) : row.event_data,
        timestamp: row.created_at,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));
    },
    
    async getEventsByType(
      sessionId: string, 
      eventType: string, 
      options?: { limit?: number }
    ): Promise<readonly StreamEvent[]> {
      const streamKey = getStreamKey(sessionId);
      const limit = options?.limit ?? 100;
      
      const sql = `
        SELECT event_type, event_data, metadata, created_at
        FROM ${tableName}
        WHERE stream_key = $1 AND event_type = $2
        ORDER BY created_at ASC
        LIMIT $3
      `;
      
      const result = await client.query(sql, [streamKey, eventType, limit]);
      
      return result.rows.map((row: any) => ({
        eventType: row.event_type,
        data: typeof row.event_data === 'string' ? JSON.parse(row.event_data) : row.event_data,
        timestamp: row.created_at,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));
    },
    
    async getEventCount(sessionId: string): Promise<number> {
      const streamKey = getStreamKey(sessionId);
      
      const sql = `SELECT COUNT(*) as count FROM ${tableName} WHERE stream_key = $1`;
      const result = await client.query(sql, [streamKey]);
      
      return parseInt((result.rows[0] as any).count) || 0;
    },
    
    async cleanupOldEvents(olderThanDays: number): Promise<number> {
      const sql = `
        DELETE FROM ${tableName}
        WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'
      `;
      
      const result = await client.query(sql);
      const deletedCount = result.rowCount;
      
      safeConsole.log(`[JAF:STREAM:POSTGRES] Cleaned up ${deletedCount} events older than ${olderThanDays} days`);
      return deletedCount;
    },
    
    async clearSession(sessionId: string): Promise<number> {
      const streamKey = getStreamKey(sessionId);
      
      const sql = `DELETE FROM ${tableName} WHERE stream_key = $1`;
      const result = await client.query(sql, [streamKey]);
      
      safeConsole.log(`[JAF:STREAM:POSTGRES] Cleared ${result.rowCount} events for session ${sessionId}`);
      return result.rowCount;
    }
  };
}

/**
 * Initialize the PostgreSQL schema for stream events
 */
async function initializeSchema(client: PostgresClient, tableName: string): Promise<void> {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id SERIAL PRIMARY KEY,
      session_id VARCHAR(255) NOT NULL,
      stream_key VARCHAR(512) NOT NULL,
      event_type VARCHAR(100) NOT NULL,
      event_data JSONB NOT NULL,
      metadata JSONB,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_${tableName}_stream_key 
      ON ${tableName} (stream_key);
    CREATE INDEX IF NOT EXISTS idx_${tableName}_session_id 
      ON ${tableName} (session_id);
    CREATE INDEX IF NOT EXISTS idx_${tableName}_event_type 
      ON ${tableName} (event_type);
    CREATE INDEX IF NOT EXISTS idx_${tableName}_created_at 
      ON ${tableName} (created_at);
    CREATE INDEX IF NOT EXISTS idx_${tableName}_stream_key_created 
      ON ${tableName} (stream_key, created_at);
  `;

  await client.query(createTableSQL);
}
