import { Message, TraceId } from '../../core/types';
import { 
  MemoryProvider, 
  ConversationMemory, 
  MemoryQuery, 
  RedisConfig,
  Result,
  createSuccess,
  createFailure,
  createMemoryConnectionError,
  createMemoryNotFoundError,
  createMemoryStorageError
} from '../types';

// Redis client interface - compatible with ioredis, node-redis, etc.
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: any[]): Promise<any>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  exists(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<void>;
}

/**
 * Redis memory provider - persistent across server restarts
 * Best for production environments with shared state
 */
export async function createRedisProvider(config: RedisConfig, redisClient: RedisClient): Promise<MemoryProvider> {
  const fullConfig: RedisConfig & { host: string; port: number; db: number; keyPrefix: string } = {
    ...config,
    type: 'redis',
    host: config.host ?? 'localhost',
    port: config.port ?? 6379,
    db: config.db ?? 0,
    keyPrefix: config.keyPrefix ?? 'jaf:memory:'
  };
  
  try {
    await redisClient.ping();
    console.log(`[MEMORY:Redis] Connected to Redis at ${fullConfig.host}:${fullConfig.port}`);
  } catch (error) {
    throw createMemoryConnectionError('Redis', error as Error);
  }

  const ensureConnected = (): RedisClient => {
    if (!redisClient) {
      throw createMemoryConnectionError('Redis', new Error('Redis client not initialized'));
    }
    return redisClient;
  };

  const getKey = (conversationId: string): string => {
    return `${fullConfig.keyPrefix}${conversationId}`;
  };

  const getUserKey = (userId: string): string => {
    return `${fullConfig.keyPrefix}user:${userId}:*`;
  };

  const storeMessages = async (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { userId?: string; traceId?: TraceId; [key: string]: any }
  ): Promise<Result<void>> => {
    const client = ensureConnected();
    
    try {
      const now = new Date();
      const conversation: ConversationMemory = {
        conversationId,
        userId: metadata?.userId,
        messages,
        metadata: {
          createdAt: now,
          updatedAt: now,
          totalMessages: messages.length,
          lastActivity: now,
          traceId: metadata?.traceId,
          ...metadata
        }
      };

      const key = getKey(conversationId);
      const value = JSON.stringify(conversation, null, 0); // Compact JSON
      
      await client.set(key, value);
      
      // Set TTL if configured
      if (fullConfig.ttl) {
        await client.expire(key, fullConfig.ttl);
      }
      
      console.log(`[MEMORY:Redis] Stored ${messages.length} messages for conversation ${conversationId}`);
      return createSuccess(undefined);
    } catch (error) {
      return createFailure(createMemoryStorageError('store messages', 'Redis', error as Error));
    }
  };

  const getConversation = async (conversationId: string): Promise<Result<ConversationMemory | null>> => {
    const client = ensureConnected();
    
    try {
      const key = getKey(conversationId);
      const value = await client.get(key);
      
      if (!value) {
        return createSuccess(null);
      }

      const conversation: ConversationMemory = JSON.parse(value);
      
      // Convert date strings back to Date objects
      const convertedConversation: ConversationMemory = {
        ...conversation,
        metadata: conversation.metadata ? {
          ...conversation.metadata,
          createdAt: conversation.metadata.createdAt ? new Date(conversation.metadata.createdAt) : new Date(),
          updatedAt: conversation.metadata.updatedAt ? new Date(conversation.metadata.updatedAt) : new Date(),
          lastActivity: conversation.metadata.lastActivity ? new Date(conversation.metadata.lastActivity) : new Date()
        } : undefined
      };

      // Update last activity
      const updatedConversation: ConversationMemory = {
        ...convertedConversation,
        metadata: {
          ...convertedConversation.metadata!,
          lastActivity: new Date()
        }
      };
      
      // Store updated last activity (fire and forget)
      client.set(key, JSON.stringify(updatedConversation, null, 0)).catch(console.error);
      
      console.log(`[MEMORY:Redis] Retrieved conversation ${conversationId} with ${convertedConversation.messages.length} messages`);
      return createSuccess(updatedConversation);
    } catch (error) {
      return createFailure(createMemoryStorageError('get conversation', 'Redis', error as Error));
    }
  };

  const appendMessages = async (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { traceId?: TraceId; [key: string]: any }
  ): Promise<Result<void>> => {
    const client = ensureConnected();
    
    try {
      const existingResult = await getConversation(conversationId);
      if (!existingResult.success) {
        return existingResult;
      }
      
      if (!existingResult.data) {
        return createFailure(createMemoryNotFoundError(conversationId, 'Redis'));
      }

      const existing = existingResult.data;

      const updatedMessages = [...existing.messages, ...messages];
      const now = new Date();
      
      const updatedConversation: ConversationMemory = {
        ...existing,
        messages: updatedMessages,
        metadata: {
          ...existing.metadata!,
          updatedAt: now,
          lastActivity: now,
          totalMessages: updatedMessages.length,
          traceId: metadata?.traceId || existing.metadata?.traceId,
          ...metadata
        }
      };

      const key = getKey(conversationId);
      await client.set(key, JSON.stringify(updatedConversation, null, 0));
      
      // Refresh TTL if configured
      if (fullConfig.ttl) {
        await client.expire(key, fullConfig.ttl);
      }
      
      console.log(`[MEMORY:Redis] Appended ${messages.length} messages to conversation ${conversationId} (total: ${updatedMessages.length})`);
      return createSuccess(undefined);
    } catch (error) {
      return createFailure(createMemoryStorageError('append messages', 'Redis', error as Error));
    }
  };

  const findConversations = async (query: MemoryQuery): Promise<Result<ConversationMemory[]>> => {
    const client = ensureConnected();
    
    try {
      // Get all conversation keys
      const pattern = query.userId 
        ? getUserKey(query.userId)
        : `${fullConfig.keyPrefix}*`;
      
      const keys = await client.keys(pattern);
      const results: ConversationMemory[] = [];
      
      // Fetch conversations in parallel
      const conversations = await Promise.all(
        keys.map(async (key) => {
          try {
            const value = await client.get(key);
            return value ? JSON.parse(value) as ConversationMemory : null;
          } catch {
            return null; // Skip malformed entries
          }
        })
      );

      // Filter and process results
      for (const conversation of conversations) {
        if (!conversation) continue;

        // Convert date strings back to Date objects
        const convertedConversation: ConversationMemory = {
          ...conversation,
          metadata: conversation.metadata ? {
            ...conversation.metadata,
            createdAt: conversation.metadata.createdAt ? new Date(conversation.metadata.createdAt) : new Date(),
            updatedAt: conversation.metadata.updatedAt ? new Date(conversation.metadata.updatedAt) : new Date(),
            lastActivity: conversation.metadata.lastActivity ? new Date(conversation.metadata.lastActivity) : new Date()
          } : undefined
        };

        // Apply filters
        let matches = true;

        if (query.conversationId && convertedConversation.conversationId !== query.conversationId) {
          matches = false;
        }
        
        if (query.traceId && convertedConversation.metadata?.traceId !== query.traceId) {
          matches = false;
        }
        
        if (query.since && convertedConversation.metadata?.createdAt && convertedConversation.metadata.createdAt < query.since) {
          matches = false;
        }
        
        if (query.until && convertedConversation.metadata?.createdAt && convertedConversation.metadata.createdAt > query.until) {
          matches = false;
        }

        if (matches) {
          results.push(convertedConversation);
        }
      }

      // Sort by last activity (most recent first)
      results.sort((a, b) => {
        const aTime = a.metadata?.lastActivity?.getTime() || 0;
        const bTime = b.metadata?.lastActivity?.getTime() || 0;
        return bTime - aTime;
      });

      // Apply pagination
      const offset = query.offset || 0;
      const limit = query.limit || results.length;
      const paginatedResults = results.slice(offset, offset + limit);
      
      console.log(`[MEMORY:Redis] Found ${paginatedResults.length} conversations matching query`);
      return createSuccess(paginatedResults);
    } catch (error) {
      return createFailure(createMemoryStorageError('find conversations', 'Redis', error as Error));
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
    console.log(`[MEMORY:Redis] Retrieved ${messages.length} recent messages for conversation ${conversationId}`);
    return createSuccess(messages);
  };

  const deleteConversation = async (conversationId: string): Promise<Result<boolean>> => {
    const client = ensureConnected();
    
    try {
      const key = getKey(conversationId);
      const deleted = await client.del(key);
      
      console.log(`[MEMORY:Redis] ${deleted > 0 ? 'Deleted' : 'Attempted to delete non-existent'} conversation ${conversationId}`);
      return createSuccess(deleted > 0);
    } catch (error) {
      return createFailure(createMemoryStorageError('delete conversation', 'Redis', error as Error));
    }
  };

  const clearUserConversations = async (userId: string): Promise<Result<number>> => {
    const client = ensureConnected();
    
    try {
      const pattern = getUserKey(userId);
      const keys = await client.keys(pattern);
      
      if (keys.length === 0) {
        return createSuccess(0);
      }

      // Delete in batches to avoid blocking Redis
      let deletedCount = 0;
      const batchSize = 100;
      
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(key => client.del(key)));
        deletedCount += results.reduce((sum, result) => sum + result, 0);
      }
      
      console.log(`[MEMORY:Redis] Cleared ${deletedCount} conversations for user ${userId}`);
      return createSuccess(deletedCount);
    } catch (error) {
      return createFailure(createMemoryStorageError('clear user conversations', 'Redis', error as Error));
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
      const pattern = userId 
        ? getUserKey(userId)
        : `${fullConfig.keyPrefix}*`;
      
      const keys = await client.keys(pattern);
      
      let totalConversations = 0;
      let totalMessages = 0;
      let oldestDate: Date | undefined;
      let newestDate: Date | undefined;

      // Process conversations in batches
      const batchSize = 50;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        const conversations = await Promise.all(
          batch.map(async (key) => {
            try {
              const value = await client.get(key);
              return value ? JSON.parse(value) as ConversationMemory : null;
            } catch {
              return null;
            }
          })
        );

        for (const conversation of conversations) {
          if (!conversation) continue;

          totalConversations++;
          totalMessages += conversation.messages.length;

          const createdAt = conversation.metadata?.createdAt 
            ? new Date(conversation.metadata.createdAt)
            : undefined;
            
          if (createdAt) {
            if (!oldestDate || createdAt < oldestDate) {
              oldestDate = createdAt;
            }
            if (!newestDate || createdAt > newestDate) {
              newestDate = createdAt;
            }
          }
        }
      }

      return createSuccess({
        totalConversations,
        totalMessages,
        oldestConversation: oldestDate,
        newestConversation: newestDate
      });
    } catch (error) {
      return createFailure(createMemoryStorageError('get stats', 'Redis', error as Error));
    }
  };

  const healthCheck = async (): Promise<Result<{ healthy: boolean; latencyMs?: number; error?: string }>> => {
    const start = Date.now();
    
    try {
      const client = ensureConnected();
      await client.ping();
      
      // Test basic operations
      const testId = `health-check-${Date.now()}`;
      const testKey = getKey(testId);
      
      await client.set(testKey, JSON.stringify({ test: true }));
      await client.get(testKey);
      await client.del(testKey);
      
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
      if (redisClient) {
        console.log('[MEMORY:Redis] Closing Redis connection');
        await redisClient.quit();
      }
      return createSuccess(undefined);
    } catch (error) {
      return createFailure(createMemoryStorageError('close connection', 'Redis', error as Error));
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