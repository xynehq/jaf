import { Message, TraceId } from '../../core/types';
import {
  MemoryProvider,
  ConversationMemory,
  MemoryQuery,
  PostgresConfig,
  Result,
  createSuccess,
  createFailure,
  createMemoryConnectionError,
  createMemoryNotFoundError,
  createMemoryStorageError,
  ConversationStatus
} from '../types';
import { safeConsole } from '../../utils/logger.js';

// PostgreSQL client interface - compatible with pg, postgres.js, etc.
interface PostgresClient {
  query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }>;
  end(): Promise<void>;
}

/**
 * PostgreSQL memory provider - fully persistent with advanced querying
 * Best for production environments requiring complex queries and full persistence
 */
export async function createPostgresProvider(config: PostgresConfig, postgresClient: PostgresClient): Promise<MemoryProvider> {
  const fullConfig: PostgresConfig & { 
    host: string; 
    port: number; 
    database: string; 
    username: string; 
    ssl: boolean; 
    tableName: string; 
    maxConnections: number 
  } = {
    ...config,
    type: 'postgres' as const,
    host: config.host ?? 'localhost',
    port: config.port ?? 5432,
    database: config.database ?? 'jaf_memory',
    username: config.username ?? 'postgres',
    ssl: config.ssl ?? false,
    tableName: config.tableName ?? 'conversations',
    maxConnections: config.maxConnections ?? 10
  };
  
  try {
    // Test connection and create table if needed
    await initializeSchema(postgresClient, fullConfig);
    safeConsole.log(`[MEMORY:Postgres] Connected to PostgreSQL at ${fullConfig.host}:${fullConfig.port}/${fullConfig.database}`);
  } catch (error) {
    throw createMemoryConnectionError('PostgreSQL', error as Error);
  }

  const ensureConnected = (): PostgresClient => {
    if (!postgresClient) {
      throw createMemoryConnectionError('PostgreSQL', new Error('PostgreSQL client not initialized'));
    }
    return postgresClient;
  };

  const storeMessages = async (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { userId?: string; traceId?: TraceId; [key: string]: any }
  ): Promise<Result<void>> => {
    const client = ensureConnected();
    
    try {
      const now = new Date();
      const conversationMetadata = {
        totalMessages: messages.length,
        traceId: metadata?.traceId,
        ...metadata
      };

      const sql = `
        INSERT INTO ${fullConfig.tableName} 
        (conversation_id, user_id, messages, metadata, created_at, updated_at, last_activity)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (conversation_id) 
        DO UPDATE SET 
          messages = $3,
          metadata = $4,
          updated_at = $6,
          last_activity = $7
      `;
      
      await client.query(sql, [
        conversationId,
        metadata?.userId || null,
        JSON.stringify(messages),
        JSON.stringify(conversationMetadata),
        now,
        now,
        now
      ]);
      
      safeConsole.log(`[MEMORY:Postgres] Stored ${messages.length} messages for conversation ${conversationId}`);
      return createSuccess(undefined);
    } catch (error) {
      return createFailure(createMemoryStorageError('store messages', 'PostgreSQL', error as Error));
    }
  };

  const getConversation = async (conversationId: string): Promise<Result<ConversationMemory | null>> => {
    const client = ensureConnected();
    
    try {
      safeConsole.log(`[MEMORY:Postgres] Getting conversation ${conversationId}`);

      const sql = `
        SELECT conversation_id, user_id, messages, metadata, created_at, updated_at, last_activity
        FROM ${fullConfig.tableName}
        WHERE conversation_id = $1
      `;

      safeConsole.log(`[MEMORY:Postgres] Executing SQL: ${sql}`);
      safeConsole.log(`[MEMORY:Postgres] Parameters:`, [conversationId]);
      
      const result = await client.query(sql, [conversationId]);

      safeConsole.log(`[MEMORY:Postgres] Query result: ${result.rows.length} rows found`);

      if (result.rows.length === 0) {
        safeConsole.log(`[MEMORY:Postgres] No conversation found for ${conversationId}`);
        return createSuccess(null);
      }

      const row = result.rows[0];
      safeConsole.log(`[MEMORY:Postgres] Raw row data:`, {
        conversation_id: row.conversation_id,
        user_id: row.user_id,
        messages_length: row.messages?.length || 0,
        metadata_length: row.metadata?.length || 0,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_activity: row.last_activity
      });
      
      // Update last activity
      const updateSQL = `
        UPDATE ${fullConfig.tableName} 
        SET last_activity = NOW() 
        WHERE conversation_id = $1
      `;
      await client.query(updateSQL, [conversationId]);

      safeConsole.log(`[MEMORY:Postgres] Parsing messages JSON:`, row.messages);
      safeConsole.log(`[MEMORY:Postgres] Messages type:`, typeof row.messages);
      
      // Handle both string and object messages (PostgreSQL JSONB can return either)
      let parsedMessages;
      if (typeof row.messages === 'string') {
        parsedMessages = JSON.parse(row.messages);
      } else if (Array.isArray(row.messages)) {
        parsedMessages = row.messages;
      } else {
        throw new Error('Invalid messages format: expected string or array');
      }
      safeConsole.log(`[MEMORY:Postgres] Parsed ${parsedMessages.length} messages`);

      safeConsole.log(`[MEMORY:Postgres] Parsing metadata JSON:`, row.metadata);
      safeConsole.log(`[MEMORY:Postgres] Metadata type:`, typeof row.metadata);
      
      // Handle both string and object metadata (PostgreSQL JSONB can return either)
      let parsedMetadata;
      if (typeof row.metadata === 'string') {
        parsedMetadata = JSON.parse(row.metadata || '{}');
      } else if (typeof row.metadata === 'object' && row.metadata !== null) {
        parsedMetadata = row.metadata;
      } else {
        parsedMetadata = {};
      }
      safeConsole.log(`[MEMORY:Postgres] Parsed metadata:`, parsedMetadata);

      const conversation: ConversationMemory = {
        conversationId: row.conversation_id,
        userId: row.user_id,
        messages: parsedMessages,
        metadata: {
          ...parsedMetadata,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
          lastActivity: new Date(), // Use current time since we just updated it
          totalMessages: parsedMessages.length
        }
      };

      safeConsole.log(`[MEMORY:Postgres] Successfully created conversation object with ${conversation.messages.length} messages`);
      safeConsole.log(`[MEMORY:Postgres] Retrieved conversation ${conversationId} with ${conversation.messages.length} messages`);
      return createSuccess(conversation);
    } catch (error) {
      safeConsole.error(`[MEMORY:Postgres] Error in getConversation:`, error);
      safeConsole.error(`[MEMORY:Postgres] Error stack:`, (error as Error).stack);
      return createFailure(createMemoryStorageError('get conversation', 'PostgreSQL', error as Error));
    }
  };

  const appendMessages = async (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { traceId?: TraceId; [key: string]: any }
  ): Promise<Result<void>> => {
    const client = ensureConnected();
    
    try {
      // Get existing conversation
      const existingResult = await getConversation(conversationId);
      if (!existingResult.success) {
        return existingResult;
      }
      
      if (!existingResult.data) {
        return createFailure(createMemoryNotFoundError(conversationId, 'PostgreSQL'));
      }

      const existing = existingResult.data;
      const updatedMessages = [...existing.messages, ...messages];
      const now = new Date();
      
      const updatedMetadata = {
        ...existing.metadata,
        totalMessages: updatedMessages.length,
        traceId: metadata?.traceId || existing.metadata?.traceId,
        ...metadata
      };

      const sql = `
        UPDATE ${fullConfig.tableName}
        SET messages = $1, metadata = $2, updated_at = $3, last_activity = $3
        WHERE conversation_id = $4
      `;
      
      await client.query(sql, [
        JSON.stringify(updatedMessages),
        JSON.stringify(updatedMetadata),
        now,
        conversationId
      ]);
      
      safeConsole.log(`[MEMORY:Postgres] Appended ${messages.length} messages to conversation ${conversationId} (total: ${updatedMessages.length})`);
      return createSuccess(undefined);
    } catch (error) {
      return createFailure(createMemoryStorageError('append messages', 'PostgreSQL', error as Error));
    }
  };

  const findConversations = async (query: MemoryQuery): Promise<Result<ConversationMemory[]>> => {
    const client = ensureConnected();
    
    try {
      let sql = `
        SELECT conversation_id, user_id, messages, metadata, created_at, updated_at, last_activity
        FROM ${fullConfig.tableName}
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (query.conversationId) {
        sql += ` AND conversation_id = $${paramIndex}`;
        params.push(query.conversationId);
        paramIndex++;
      }

      if (query.userId) {
        sql += ` AND user_id = $${paramIndex}`;
        params.push(query.userId);
        paramIndex++;
      }

      if (query.traceId) {
        sql += ` AND metadata->>'traceId' = $${paramIndex}`;
        params.push(query.traceId);
        paramIndex++;
      }

      if (query.since) {
        sql += ` AND created_at >= $${paramIndex}`;
        params.push(query.since);
        paramIndex++;
      }

      if (query.until) {
        sql += ` AND created_at <= $${paramIndex}`;
        params.push(query.until);
        paramIndex++;
      }

      // Sort by last activity (most recent first)
      sql += ` ORDER BY last_activity DESC`;

      // Add pagination
      if (query.limit) {
        sql += ` LIMIT $${paramIndex}`;
        params.push(query.limit);
        paramIndex++;
      }

      if (query.offset) {
        sql += ` OFFSET $${paramIndex}`;
        params.push(query.offset);
        paramIndex++;
      }

      const result = await client.query(sql, params);
      
      const conversations: ConversationMemory[] = result.rows.map(row => {
        // Handle both string and object messages (PostgreSQL JSONB can return either)
        let parsedMessages;
        if (typeof row.messages === 'string') {
          parsedMessages = JSON.parse(row.messages);
        } else if (Array.isArray(row.messages)) {
          parsedMessages = row.messages;
        } else {
          throw new Error('Invalid messages format: expected string or array');
        }
        
        // Handle both string and object metadata (PostgreSQL JSONB can return either)
        let parsedMetadata;
        if (typeof row.metadata === 'string') {
          parsedMetadata = JSON.parse(row.metadata || '{}');
        } else if (typeof row.metadata === 'object' && row.metadata !== null) {
          parsedMetadata = row.metadata;
        } else {
          parsedMetadata = {};
        }
        
        return {
          conversationId: row.conversation_id,
          userId: row.user_id,
          messages: parsedMessages,
          metadata: {
            ...parsedMetadata,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            lastActivity: new Date(row.last_activity),
            totalMessages: parsedMessages.length
          }
        };
      });
      
      safeConsole.log(`[MEMORY:Postgres] Found ${conversations.length} conversations matching query`);
      return createSuccess(conversations);
    } catch (error) {
      return createFailure(createMemoryStorageError('find conversations', 'PostgreSQL', error as Error));
    }
  };

  const getRecentMessages = async (conversationId: string, limit: number = 50): Promise<Result<readonly Message[]>> => {
    const conversationResult = await getConversation(conversationId);
    if (!conversationResult.success) {
      return conversationResult;
    }

    if (!conversationResult.data) {
      return createSuccess([]);
    }

    const messages = conversationResult.data.messages.slice(-limit);
    safeConsole.log(`[MEMORY:Postgres] Retrieved ${messages.length} recent messages for conversation ${conversationId}`);
    return createSuccess(messages);
  };

  const deleteConversation = async (conversationId: string): Promise<Result<boolean>> => {
    const client = ensureConnected();
    
    try {
      const sql = `DELETE FROM ${fullConfig.tableName} WHERE conversation_id = $1`;
      const result = await client.query(sql, [conversationId]);
      
      const deleted = result.rowCount > 0;
      safeConsole.log(`[MEMORY:Postgres] ${deleted ? 'Deleted' : 'Attempted to delete non-existent'} conversation ${conversationId}`);
      return createSuccess(deleted);
    } catch (error) {
      return createFailure(createMemoryStorageError('delete conversation', 'PostgreSQL', error as Error));
    }
  };

  const clearUserConversations = async (userId: string): Promise<Result<number>> => {
    const client = ensureConnected();
    
    try {
      const sql = `DELETE FROM ${fullConfig.tableName} WHERE user_id = $1`;
      const result = await client.query(sql, [userId]);
      
      const deletedCount = result.rowCount;
      safeConsole.log(`[MEMORY:Postgres] Cleared ${deletedCount} conversations for user ${userId}`);
      return createSuccess(deletedCount);
    } catch (error) {
      return createFailure(createMemoryStorageError('clear user conversations', 'PostgreSQL', error as Error));
    }
  };

  const getStats = async (userId?: string): Promise<Result<{
    totalConversations: number;
    totalMessages: number;
    oldestConversation?: Date;
    newestConversation?: Date;
  }>> => {
    const client = ensureConnected();
    
    try {
      let sql = `
        SELECT 
          COUNT(*) as total_conversations,
          MIN(created_at) as oldest_conversation,
          MAX(created_at) as newest_conversation,
          SUM((metadata->>'totalMessages')::int) as total_messages
        FROM ${fullConfig.tableName}
      `;
      const params: any[] = [];

      if (userId) {
        sql += ' WHERE user_id = $1';
        params.push(userId);
      }

      const result = await client.query(sql, params);
      const row = result.rows[0];

      return createSuccess({
        totalConversations: parseInt(row.total_conversations) || 0,
        totalMessages: parseInt(row.total_messages) || 0,
        oldestConversation: row.oldest_conversation ? new Date(row.oldest_conversation) : undefined,
        newestConversation: row.newest_conversation ? new Date(row.newest_conversation) : undefined
      });
    } catch (error) {
      return createFailure(createMemoryStorageError('get stats', 'PostgreSQL', error as Error));
    }
  };

  const healthCheck = async (): Promise<Result<{ healthy: boolean; latencyMs?: number; error?: string }>> => {
    const start = Date.now();
    
    try {
      const client = ensureConnected();
      
      // Test basic connectivity
      await client.query('SELECT 1');
      
      // Test table operations
      const testId = `health-check-${Date.now()}`;
      const storeResult = await storeMessages(testId, [{ role: 'user', content: 'health check' }]);
      if (!storeResult.success) {
        return createSuccess({
          healthy: false,
          latencyMs: Date.now() - start,
          error: storeResult.error.message
        });
      }

      const getResult = await getConversation(testId);
      if (!getResult.success) {
        return createSuccess({
          healthy: false,
          latencyMs: Date.now() - start,
          error: getResult.error.message
        });
      }

      const deleteResult = await deleteConversation(testId);
      if (!deleteResult.success) {
        return createSuccess({
          healthy: false,
          latencyMs: Date.now() - start,
          error: deleteResult.error.message
        });
      }
      
      const latencyMs = Date.now() - start;
      return createSuccess({ healthy: true, latencyMs });
    } catch (error) {
      return createSuccess({ 
        healthy: false, 
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const close = async (): Promise<Result<void>> => {
    try {
      if (postgresClient) {
        safeConsole.log('[MEMORY:Postgres] Closing PostgreSQL connection');
        await postgresClient.end();
      }
      return createSuccess(undefined);
    } catch (error) {
      return createFailure(createMemoryStorageError('close connection', 'PostgreSQL', error as Error));
    }
  };

  const cleanupOldConversations = async (olderThanDays: number): Promise<Result<number>> => {
    const client = ensureConnected();
    
    try {
      const sql = `
        DELETE FROM ${fullConfig.tableName} 
        WHERE last_activity < NOW() - INTERVAL '${olderThanDays} days'
      `;
      
      const result = await client.query(sql);
      const deletedCount = result.rowCount;

      safeConsole.log(`[MEMORY:Postgres] Cleaned up ${deletedCount} conversations older than ${olderThanDays} days`);
      return createSuccess(deletedCount);
    } catch (error) {
      return createFailure(createMemoryStorageError('cleanup old conversations', 'PostgreSQL', error as Error));
    }
  };

  const getAnalytics = async (userId?: string): Promise<Result<{
    averageMessagesPerConversation: number;
    conversationsLastWeek: number;
    conversationsLastMonth: number;
    mostActiveHour: number;
    mostActiveDay: string;
  }>> => {
    const client = ensureConnected();
    
    try {
      let whereClause = '';
      const params: any[] = [];
      
      if (userId) {
        whereClause = 'WHERE user_id = $1';
        params.push(userId);
      }

      const sql = `
        SELECT 
          AVG((metadata->>'totalMessages')::int) as avg_messages,
          COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as last_week,
          COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as last_month,
          EXTRACT(hour FROM last_activity) as activity_hour,
          TO_CHAR(last_activity, 'Day') as activity_day
        FROM ${fullConfig.tableName}
        ${whereClause}
        GROUP BY EXTRACT(hour FROM last_activity), TO_CHAR(last_activity, 'Day')
        ORDER BY COUNT(*) DESC
        LIMIT 1
      `;

      const result = await client.query(sql, params);
      const row = result.rows[0] || {};

      return createSuccess({
        averageMessagesPerConversation: parseFloat(row.avg_messages) || 0,
        conversationsLastWeek: parseInt(row.last_week) || 0,
        conversationsLastMonth: parseInt(row.last_month) || 0,
        mostActiveHour: parseInt(row.activity_hour) || 0,
        mostActiveDay: (row.activity_day || '').trim()
      });
    } catch (error) {
      return createFailure(createMemoryStorageError('get analytics', 'PostgreSQL', error as Error));
    }
  };

  return {
    storeMessages,
    getConversation,
    appendMessages,
    findConversations,
    getRecentMessages,
    deleteConversation,
    clearUserConversations,
    getStats,
    healthCheck,
    close
  };
}

async function initializeSchema(client: PostgresClient, config: PostgresConfig & { tableName: string }): Promise<void> {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS ${config.tableName} (
      conversation_id VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(255),
      messages JSONB NOT NULL,
      metadata JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_${config.tableName}_user_id 
      ON ${config.tableName} (user_id);
    CREATE INDEX IF NOT EXISTS idx_${config.tableName}_created_at 
      ON ${config.tableName} (created_at);
    CREATE INDEX IF NOT EXISTS idx_${config.tableName}_last_activity 
      ON ${config.tableName} (last_activity);
    CREATE INDEX IF NOT EXISTS idx_${config.tableName}_metadata_gin 
      ON ${config.tableName} USING GIN (metadata);
    CREATE INDEX IF NOT EXISTS idx_${config.tableName}_trace_id 
      ON ${config.tableName} ((metadata->>'traceId'));
  `;

  await client.query(createTableSQL);
  
  // Drop status column if it exists (migration from older versions)
  try {
    await client.query(`ALTER TABLE ${config.tableName} DROP COLUMN IF EXISTS status`);
    safeConsole.log(`[MEMORY:Postgres] Dropped status column if it existed`);
  } catch (error) {
    // Ignore errors if column doesn't exist
    safeConsole.log(`[MEMORY:Postgres] Status column migration completed`);
  }

  safeConsole.log(`[MEMORY:Postgres] Schema initialized for table ${config.tableName}`);
}