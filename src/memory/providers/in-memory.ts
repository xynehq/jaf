import { Message, TraceId } from '../../core/types';
import { 
  MemoryProvider, 
  ConversationMemory, 
  MemoryQuery, 
  InMemoryConfig,
  Result,
  createSuccess,
  createFailure,
  createMemoryNotFoundError,
  createMemoryStorageError
} from '../types';

/**
 * In-memory memory provider - no persistence across server restarts
 * Best for development, testing, or temporary conversations
 */
export function createInMemoryProvider(config: InMemoryConfig = { type: 'memory', maxConversations: 1000, maxMessagesPerConversation: 1000 }): MemoryProvider {
  const fullConfig: InMemoryConfig & { maxConversations: number; maxMessagesPerConversation: number } = {
    ...config,
    type: 'memory',
    maxConversations: config.maxConversations ?? 1000,
    maxMessagesPerConversation: config.maxMessagesPerConversation ?? 1000
  };
  
  let conversations = new Map<string, ConversationMemory>();
  
  console.log(`[MEMORY:InMemory] Initialized with max ${fullConfig.maxConversations} conversations, ${fullConfig.maxMessagesPerConversation} messages each`);

  const enforceMemoryLimits = (): void => {
    if (conversations.size <= fullConfig.maxConversations) {
      return;
    }

    // Sort by last activity and remove oldest conversations
    const sorted = Array.from(conversations.entries())
      .sort(([, a], [, b]) => {
        const aTime = a.metadata?.lastActivity?.getTime() || 0;
        const bTime = b.metadata?.lastActivity?.getTime() || 0;
        return aTime - bTime; // Oldest first
      });

    const toRemove = sorted.slice(0, conversations.size - fullConfig.maxConversations);
    
    for (const [id] of toRemove) {
      conversations.delete(id);
    }

    console.log(`[MEMORY:InMemory] Enforced memory limits, removed ${toRemove.length} oldest conversations`);
  };

  const storeMessages = async (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { userId?: string; traceId?: TraceId; [key: string]: any }
  ): Promise<Result<void>> => {
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

      conversations.set(conversationId, conversation);
      enforceMemoryLimits();
      
      console.log(`[MEMORY:InMemory] Stored ${messages.length} messages for conversation ${conversationId}`);
      return createSuccess(undefined);
    } catch (error) {
      return createFailure(createMemoryStorageError('store messages', 'InMemory', error as Error));
    }
  };

  const getConversation = async (conversationId: string): Promise<Result<ConversationMemory | null>> => {
    try {
      const conversation = conversations.get(conversationId);
      if (!conversation) {
        return createSuccess(null);
      }

      // Update last activity
      const updatedConversation: ConversationMemory = {
        ...conversation,
        metadata: {
          ...conversation.metadata!,
          lastActivity: new Date()
        }
      };
      
      conversations.set(conversationId, updatedConversation);
      
      console.log(`[MEMORY:InMemory] Retrieved conversation ${conversationId} with ${conversation.messages.length} messages`);
      return createSuccess(updatedConversation);
    } catch (error) {
      return createFailure(createMemoryStorageError('get conversation', 'InMemory', error as Error));
    }
  };

  const appendMessages = async (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { traceId?: TraceId; [key: string]: any }
  ): Promise<Result<void>> => {
    try {
      const existing = conversations.get(conversationId);
      if (!existing) {
        return createFailure(createMemoryNotFoundError(conversationId, 'InMemory'));
      }

      const updatedMessages = [...existing.messages, ...messages];
      
      // Enforce per-conversation message limit
      const finalMessages = updatedMessages.length > fullConfig.maxMessagesPerConversation
        ? updatedMessages.slice(-fullConfig.maxMessagesPerConversation)
        : updatedMessages;

      const now = new Date();
      const updatedConversation: ConversationMemory = {
        ...existing,
        messages: finalMessages,
        metadata: {
          ...existing.metadata!,
          updatedAt: now,
          lastActivity: now,
          totalMessages: finalMessages.length,
          traceId: metadata?.traceId || existing.metadata?.traceId,
          ...metadata
        }
      };

      conversations.set(conversationId, updatedConversation);
      
      console.log(`[MEMORY:InMemory] Appended ${messages.length} messages to conversation ${conversationId} (total: ${finalMessages.length})`);
      return createSuccess(undefined);
    } catch (error) {
      return createFailure(createMemoryStorageError('append messages', 'InMemory', error as Error));
    }
  };

  const findConversations = async (query: MemoryQuery): Promise<Result<ConversationMemory[]>> => {
    try {
      const results: ConversationMemory[] = [];
      
      for (const [id, conversation] of conversations) {
        let matches = true;

        if (query.conversationId && id !== query.conversationId) {
          matches = false;
        }
        
        if (query.userId && conversation.userId !== query.userId) {
          matches = false;
        }
        
        if (query.traceId && conversation.metadata?.traceId !== query.traceId) {
          matches = false;
        }
        
        if (query.since && conversation.metadata?.createdAt && conversation.metadata.createdAt < query.since) {
          matches = false;
        }
        
        if (query.until && conversation.metadata?.createdAt && conversation.metadata.createdAt > query.until) {
          matches = false;
        }

        if (matches) {
          results.push(conversation);
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
      
      console.log(`[MEMORY:InMemory] Found ${paginatedResults.length} conversations matching query`);
      return createSuccess(paginatedResults);
    } catch (error) {
      return createFailure(createMemoryStorageError('find conversations', 'InMemory', error as Error));
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
    console.log(`[MEMORY:InMemory] Retrieved ${messages.length} recent messages for conversation ${conversationId}`);
    return createSuccess(messages);
  };

  const deleteConversation = async (conversationId: string): Promise<Result<boolean>> => {
    try {
      const existed = conversations.has(conversationId);
      conversations.delete(conversationId);
      
      console.log(`[MEMORY:InMemory] ${existed ? 'Deleted' : 'Attempted to delete non-existent'} conversation ${conversationId}`);
      return createSuccess(existed);
    } catch (error) {
      return createFailure(createMemoryStorageError('delete conversation', 'InMemory', error as Error));
    }
  };

  const clearUserConversations = async (userId: string): Promise<Result<number>> => {
    try {
      let deletedCount = 0;
      
      for (const [id, conversation] of conversations) {
        if (conversation.userId === userId) {
          conversations.delete(id);
          deletedCount++;
        }
      }
      
      console.log(`[MEMORY:InMemory] Cleared ${deletedCount} conversations for user ${userId}`);
      return createSuccess(deletedCount);
    } catch (error) {
      return createFailure(createMemoryStorageError('clear user conversations', 'InMemory', error as Error));
    }
  };

  const getStats = async (userId?: string): Promise<Result<{
    totalConversations: number;
    totalMessages: number;
    oldestConversation?: Date;
    newestConversation?: Date;
  }>> => {
    try {
      let totalConversations = 0;
      let totalMessages = 0;
      let oldestDate: Date | undefined;
      let newestDate: Date | undefined;

      for (const conversation of conversations.values()) {
        if (userId && conversation.userId !== userId) {
          continue;
        }

        totalConversations++;
        totalMessages += conversation.messages.length;

        const createdAt = conversation.metadata?.createdAt;
        if (createdAt) {
          if (!oldestDate || createdAt < oldestDate) {
            oldestDate = createdAt;
          }
          if (!newestDate || createdAt > newestDate) {
            newestDate = createdAt;
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
      return createFailure(createMemoryStorageError('get stats', 'InMemory', error as Error));
    }
  };

  const healthCheck = async (): Promise<Result<{ healthy: boolean; latencyMs?: number; error?: string }>> => {
    const start = Date.now();
    
    try {
      // Simple operation to test functionality
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
      console.log(`[MEMORY:InMemory] Closing provider, clearing ${conversations.size} conversations`);
      conversations.clear();
      return createSuccess(undefined);
    } catch (error) {
      return createFailure(createMemoryStorageError('close provider', 'InMemory', error as Error));
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