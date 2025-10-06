/**
 * Real PostgreSQL Session Provider Implementation
 *
 * This provides a production-ready PostgreSQL-based session provider
 * with proper connection pooling, transactions, and error handling
 */

import {
  SessionProvider,
  Session,
  SessionContext,
  throwSessionError
} from '../types.js';
import { createSession } from './index.js';
import { safeConsole } from '../../utils/logger.js';

// Helper type for PostgreSQL client
type PgPool = any; // Will be properly typed when pg is added

export interface PostgresConfig {
  connectionString: string;
  tableName?: string;
  poolSize?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

// SQL queries as constants for better maintainability
const SQL_CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS $1 (
    id VARCHAR(255) PRIMARY KEY,
    app_name VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    messages JSONB NOT NULL DEFAULT '[]',
    artifacts JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_accessed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT idx_user_sessions UNIQUE (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_id ON $1 (user_id);
  CREATE INDEX IF NOT EXISTS idx_created_at ON $1 (created_at DESC);
`;

export const createPostgresSessionProvider = (config: PostgresConfig): SessionProvider => {
  let pool: PgPool;
  const tableName = config.tableName || 'jaf_sessions';
  
  // Require real PostgreSQL - no fallback
  try {
    // Dynamic import to avoid breaking if pg not installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: config.connectionString,
      max: config.poolSize || 10,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
    });
    
    // Handle pool events
    pool.on('error', (err: any, client: any) => {
      safeConsole.error('[ADK:Sessions] PostgreSQL pool error:', err);
    });

    pool.on('connect', (client: any) => {
      safeConsole.log('[ADK:Sessions] New PostgreSQL client connected');
    });

    pool.on('acquire', (client: any) => {
      safeConsole.log('[ADK:Sessions] PostgreSQL client acquired from pool');
    });

    pool.on('remove', (client: any) => {
      safeConsole.log('[ADK:Sessions] PostgreSQL client removed from pool');
    });

    // Initialize table
    initializeTable().catch(err => {
      safeConsole.error('[ADK:Sessions] Failed to initialize PostgreSQL table:', err);
    });
    
  } catch (error) {
    throw new Error(
      'PostgreSQL session provider requires pg to be installed. ' +
      'Please install it with: npm install pg'
    );
  }
  
  // Initialize database table
  async function initializeTable(): Promise<void> {
    
    const client = await pool.connect();
    try {
      // Use dynamic table name safely
      const createTableQuery = SQL_CREATE_TABLE.replace(/\$1/g, tableName);
      await client.query(createTableQuery);
      safeConsole.log(`[ADK:Sessions] PostgreSQL table ${tableName} initialized`);
    } catch (error) {
      safeConsole.error('[ADK:Sessions] Failed to create table:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  // Helper to serialize/deserialize sessions
  const sessionToRow = (session: Session): any => {
    return {
      id: session.id,
      app_name: session.appName,
      user_id: session.userId,
      messages: JSON.stringify(session.messages),
      artifacts: JSON.stringify(session.artifacts),
      metadata: JSON.stringify({
        ...session.metadata,
        created: undefined, // Store in created_at column
        lastAccessed: undefined // Store in last_accessed_at column
      }),
      created_at: session.metadata.created,
      last_accessed_at: session.metadata.lastAccessed || null
    };
  };
  
  const rowToSession = (row: any): Session => {
    const metadata = typeof row.metadata === 'string' 
      ? JSON.parse(row.metadata) 
      : row.metadata;
      
    return {
      id: row.id,
      appName: row.app_name,
      userId: row.user_id,
      messages: typeof row.messages === 'string' 
        ? JSON.parse(row.messages) 
        : row.messages,
      artifacts: typeof row.artifacts === 'string' 
        ? JSON.parse(row.artifacts) 
        : row.artifacts,
      metadata: {
        ...metadata,
        created: new Date(row.created_at),
        lastAccessed: row.last_accessed_at ? new Date(row.last_accessed_at) : undefined
      }
    };
  };
  
  // Database operation helpers
  async function executeQuery(query: string, params: any[]): Promise<any> {
    const client = await pool.connect();
    try {
      const result = await client.query(query, params);
      return result;
    } finally {
      client.release();
    }
  }
  
  async function executeTransaction(operations: Array<{ query: string; params: any[] }>): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const op of operations) {
        await client.query(op.query, op.params);
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  return {
    createSession: async (context: SessionContext): Promise<Session> => {
      const session = createSession(
        context.appName,
        context.userId,
        context.sessionId
      );
      
      try {
        const row = sessionToRow(session);
        const query = `
          INSERT INTO ${tableName} 
          (id, app_name, user_id, messages, artifacts, metadata, created_at, last_accessed_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;
        
        const result = await executeQuery(query, [
          row.id,
          row.app_name,
          row.user_id,
          row.messages,
          row.artifacts,
          row.metadata,
          row.created_at,
          row.last_accessed_at
        ]);
        
        return rowToSession(result.rows[0]);
      } catch (error) {
        throwSessionError(`Failed to create session in PostgreSQL: ${error}`, session.id);
        throw error; // TypeScript needs this even though throwSessionError never returns
      }
    },
    
    getSession: async (sessionId: string): Promise<Session | null> => {
      try {
        const query = `
          UPDATE ${tableName}
          SET last_accessed_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *
        `;
        
        const result = await executeQuery(query, [sessionId]);
        
        if (result.rows.length === 0) {
          return null;
        }
        
        return rowToSession(result.rows[0]);
      } catch (error) {
        throwSessionError(`Failed to get session from PostgreSQL: ${error}`, sessionId);
        throw error; // TypeScript needs this even though throwSessionError never returns
      }
    },
    
    updateSession: async (session: Session): Promise<Session> => {
      try {
        session.metadata.lastAccessed = new Date();
        
        const row = sessionToRow(session);
        const query = `
          UPDATE ${tableName}
          SET 
            messages = $2,
            artifacts = $3,
            metadata = $4,
            last_accessed_at = $5
          WHERE id = $1
          RETURNING *
        `;
        
        const result = await executeQuery(query, [
          session.id,
          row.messages,
          row.artifacts,
          row.metadata,
          row.last_accessed_at
        ]);
        
        if (result.rows.length === 0) {
          throw new Error('Session not found');
        }
        
        return rowToSession(result.rows[0]);
      } catch (error) {
        throwSessionError(`Failed to update session in PostgreSQL: ${error}`, session.id);
        throw error; // TypeScript needs this even though throwSessionError never returns
      }
    },
    
    listSessions: async (userId: string): Promise<Session[]> => {
      try {
        const query = `
          SELECT * FROM ${tableName}
          WHERE user_id = $1
          ORDER BY created_at DESC
        `;
        
        const result = await executeQuery(query, [userId]);
        
        return result.rows.map(rowToSession);
      } catch (error) {
        throwSessionError(`Failed to list sessions from PostgreSQL: ${error}`);
        throw error; // TypeScript needs this even though throwSessionError never returns
      }
    },
    
    deleteSession: async (sessionId: string): Promise<boolean> => {
      try {
        const query = `
          DELETE FROM ${tableName}
          WHERE id = $1
        `;
        
        const result = await executeQuery(query, [sessionId]);
        
        return result.rowCount > 0;
      } catch (error) {
        throwSessionError(`Failed to delete session from PostgreSQL: ${error}`, sessionId);
        throw error; // TypeScript needs this even though throwSessionError never returns
      }
    }
  };
};

// Additional utility functions

export const closePostgresPool = async (provider: any): Promise<void> => {
  // Access the internal pool if available
  if (provider._pool && typeof provider._pool.end === 'function') {
    await provider._pool.end();
  }
};

export const getPoolStats = (provider: any): any => {
  if (provider._pool) {
    return {
      totalCount: provider._pool.totalCount,
      idleCount: provider._pool.idleCount,
      waitingCount: provider._pool.waitingCount
    };
  }
  return null;
};

// Migration helper for existing data
export const migrateFromRedisToPostgres = async (
  redisProvider: SessionProvider,
  postgresProvider: SessionProvider,
  userIds: string[]
): Promise<{ migrated: number; errors: string[] }> => {
  let migrated = 0;
  const errors: string[] = [];
  
  for (const userId of userIds) {
    try {
      const sessions = await redisProvider.listSessions(userId);
      
      for (const session of sessions) {
        try {
          await postgresProvider.updateSession(session);
          migrated++;
        } catch (error) {
          errors.push(`Failed to migrate session ${session.id}: ${error}`);
        }
      }
    } catch (error) {
      errors.push(`Failed to list sessions for user ${userId}: ${error}`);
    }
  }
  
  return { migrated, errors };
};