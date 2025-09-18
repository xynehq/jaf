import { Message, TraceId } from '../../core/types';
import { 
  MemoryProvider, 
  ConversationMemory, 
  MemoryQuery, 
  Mem0Config,
  MemoryItem,
  MemoryResponse,
  MemoryErrorResponse,
  MemoryAddResponse,
  Result,
  createSuccess,
  createFailure,
  createMemoryConnectionError,
  createMemoryNotFoundError,
  createMemoryStorageError
} from '../types';

// Types matching the real MemoryClient API
interface Mem0Message {
  role: "user" | "assistant";
  content: string;
}

interface Mem0Options {
  user_id?: string;
  agent_id?: string;
  run_id?: string;
  metadata?: Record<string, any>;
  [key: string]: any;
}

interface Mem0SearchOptions extends Mem0Options {
  limit?: number;
  [key: string]: any;
}

interface Mem0Memory {
  id: string;
  memory?: string;
  score?: number;
  metadata?: any;
  [key: string]: any;
}

// Mem0 client interface - matches real MemoryClient API
interface Mem0Client {
  search(query: string, options?: Mem0SearchOptions): Promise<Array<Mem0Memory>>;
  add(messages: Array<Mem0Message>, options?: Mem0Options): Promise<Array<Mem0Memory>>;
  updateProject?(options: { custom_instructions: string }): Promise<any>;
  ping?(): Promise<any>;
}

/**
 * Mem0 memory provider - AI-powered memory with semantic search
 * Best for intelligent conversation memory with semantic understanding
 */
export async function createMem0Provider(config: Mem0Config, mem0Client: Mem0Client): Promise<MemoryProvider> {
  const fullConfig: Mem0Config & { 
    apiKey: string; 
    baseUrl: string; 
    timeout: number; 
    maxRetries: number;
  } = {
    ...config,
    type: 'mem0',
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? 'https://api.mem0.ai',
    timeout: config.timeout ?? 30000,
    maxRetries: config.maxRetries ?? 3
  };
  
  // In-memory cache for conversations since Mem0 doesn't store full conversations
  const conversationCache = new Map<string, ConversationMemory>();
  
  try {
    // Test connection using ping if available
    if (mem0Client.ping) {
      await mem0Client.ping();
    }
    console.log(`[MEMORY:Mem0] Connected to Mem0 at ${fullConfig.baseUrl}`);
  } catch (error) {
    throw createMemoryConnectionError('Mem0', error as Error);
  }

  const ensureConnected = (): Mem0Client => {
    if (!mem0Client) {
      throw createMemoryConnectionError('Mem0', new Error('Mem0 client not initialized'));
    }
    return mem0Client;
  };

  // Search memory functionality
  const searchMemory = async (
    query: string,
    userEmail: string,
    limit: number = 10
  ): Promise<MemoryResponse | MemoryErrorResponse> => {
    const client = ensureConnected();
    const startTime = Date.now();
    
    try {
      console.log(`[MEMORY:Mem0] Searching memory for user ${userEmail} with query: ${query}`);
      
      const searchResults = await client.search(query, {
        user_id: userEmail,
        limit
      });
      
      const endTime = Date.now();
      const searchTimeMs = endTime - startTime;
      const searchTimeSeconds = searchTimeMs / 1000;
      
      console.log(`[MEMORY:Mem0] Found ${searchResults.length} memory results in ${searchTimeMs}ms`);
      
      const response: MemoryResponse = {
        user_email: userEmail,
        query,
        total_results: searchResults.length,
        memories: searchResults.map(result => ({
          id: result.id,
          content: result.memory || '',
          metadata: result.metadata,
          score: result.score
        })),
        search_time_ms: searchTimeMs,
        search_time_seconds: searchTimeSeconds
      };
      
      return response;
    } catch (error) {
      const endTime = Date.now();
      const searchTimeMs = endTime - startTime;
      const searchTimeSeconds = searchTimeMs / 1000;
      
      console.error(`[MEMORY:Mem0] Search failed for user ${userEmail}:`, error);
      
      const errorResponse: MemoryErrorResponse = {
        error: error instanceof Error ? error.message : 'Unknown search error',
        user_email: userEmail,
        query,
        memories: [],
        search_time_ms: searchTimeMs,
        search_time_seconds: searchTimeSeconds
      };
      
      return errorResponse;
    }
  };

  // Add to memory functionality
  const addToMemory = async (
    memoryContent: string,
    userEmail: string,
    customInstructions?: string,
    metadata?: any
  ): Promise<MemoryAddResponse> => {
    const client = ensureConnected();
    
    try {
      console.log(`[MEMORY:Mem0] Adding memory for user ${userEmail}`);
      
      // Update project custom instructions if provided
      if (customInstructions && client.updateProject) {
        await client.updateProject({ custom_instructions: customInstructions });
        console.log(`[MEMORY:Mem0] Updated project custom instructions`);
      }
      
      // Add memory with metadata
      const memoryResults = await client.add([{ role: "user", content: memoryContent }], {
        user_id: userEmail,
        metadata: {
          timestamp: new Date().toISOString(),
          source: "jaf_conversation",
          ...metadata
        }
      });
      
      const memoryResult = memoryResults[0]; // Get first result
      console.log(`[MEMORY:Mem0] Added memory with ID: ${memoryResult?.id}`);
      
      const response: MemoryAddResponse = {
        success: true,
        user_email: userEmail,
        summary: `Successfully added memory: ${memoryContent.substring(0, 100)}${memoryContent.length > 100 ? '...' : ''}`,
        memory_id: memoryResult?.id
      };
      
      return response;
    } catch (error) {
      console.error(`[MEMORY:Mem0] Failed to add memory for user ${userEmail}:`, error);
      
      const errorResponse: MemoryAddResponse = {
        success: false,
        user_email: userEmail,
        summary: `Failed to add memory: ${memoryContent.substring(0, 100)}${memoryContent.length > 100 ? '...' : ''}`,
        error: error instanceof Error ? error.message : 'Unknown error occurred while adding memory'
      };
      
      return errorResponse;
    }
  };

  // Standard MemoryProvider interface implementations
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

      // Store in local cache
      conversationCache.set(conversationId, conversation);
      
      // If user is provided, add to Mem0 memory
      if (metadata?.userId && messages.length > 0) {
        const memoryContent = messages
          .map(msg => `${msg.role}: ${msg.content}`)
          .join('\n');
        
        const addResult = await addToMemory(
          memoryContent,
          metadata.userId,
          undefined,
          {
            conversationId,
            traceId: metadata?.traceId,
            messageCount: messages.length
          }
        );
        
        if (!addResult.success) {
          console.warn(`[MEMORY:Mem0] Failed to add to semantic memory: ${addResult.error}`);
        }
      }
      
      console.log(`[MEMORY:Mem0] Stored ${messages.length} messages for conversation ${conversationId}`);
      return createSuccess(undefined);
    } catch (error) {
      return createFailure(createMemoryStorageError('store messages', 'Mem0', error as Error));
    }
  };

  const getConversation = async (conversationId: string): Promise<Result<ConversationMemory | null>> => {
    try {
      const conversation = conversationCache.get(conversationId);
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
      
      conversationCache.set(conversationId, updatedConversation);
      
      console.log(`[MEMORY:Mem0] Retrieved conversation ${conversationId} with ${conversation.messages.length} messages`);
      return createSuccess(updatedConversation);
    } catch (error) {
      return createFailure(createMemoryStorageError('get conversation', 'Mem0', error as Error));
    }
  };

  const appendMessages = async (
    conversationId: string,
    messages: readonly Message[],
    metadata?: { traceId?: TraceId; [key: string]: any }
  ): Promise<Result<void>> => {
    try {
      const existing = conversationCache.get(conversationId);
      if (!existing) {
        return createFailure(createMemoryNotFoundError(conversationId, 'Mem0'));
      }

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

      conversationCache.set(conversationId, updatedConversation);
      
      // Add new messages to Mem0 memory if user is available
      if (existing.userId && messages.length > 0) {
        const memoryContent = messages
          .map(msg => `${msg.role}: ${msg.content}`)
          .join('\n');
        
        const addResult = await addToMemory(
          memoryContent,
          existing.userId,
          undefined,
          {
            conversationId,
            traceId: metadata?.traceId,
            appendedMessageCount: messages.length
          }
        );
        
        if (!addResult.success) {
          console.warn(`[MEMORY:Mem0] Failed to add appended messages to semantic memory: ${addResult.error}`);
        }
      }
      
      console.log(`[MEMORY:Mem0] Appended ${messages.length} messages to conversation ${conversationId} (total: ${updatedMessages.length})`);
      return createSuccess(undefined);
    } catch (error) {
      return createFailure(createMemoryStorageError('append messages', 'Mem0', error as Error));
    }
  };

  const findConversations = async (query: MemoryQuery): Promise<Result<ConversationMemory[]>> => {
    try {
      const results: ConversationMemory[] = [];
      
      for (const [id, conversation] of conversationCache) {
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
      
      console.log(`[MEMORY:Mem0] Found ${paginatedResults.length} conversations matching query`);
      return createSuccess(paginatedResults);
    } catch (error) {
      return createFailure(createMemoryStorageError('find conversations', 'Mem0', error as Error));
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
    console.log(`[MEMORY:Mem0] Retrieved ${messages.length} recent messages for conversation ${conversationId}`);
    return createSuccess(messages);
  };

  const deleteConversation = async (conversationId: string): Promise<Result<boolean>> => {
    try {
      const existed = conversationCache.has(conversationId);
      conversationCache.delete(conversationId);
      
      console.log(`[MEMORY:Mem0] ${existed ? 'Deleted' : 'Attempted to delete non-existent'} conversation ${conversationId}`);
      return createSuccess(existed);
    } catch (error) {
      return createFailure(createMemoryStorageError('delete conversation', 'Mem0', error as Error));
    }
  };

  const clearUserConversations = async (userId: string): Promise<Result<number>> => {
    try {
      let deletedCount = 0;
      
      for (const [id, conversation] of conversationCache) {
        if (conversation.userId === userId) {
          conversationCache.delete(id);
          deletedCount++;
        }
      }
      
      console.log(`[MEMORY:Mem0] Cleared ${deletedCount} conversations for user ${userId}`);
      return createSuccess(deletedCount);
    } catch (error) {
      return createFailure(createMemoryStorageError('clear user conversations', 'Mem0', error as Error));
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

      for (const conversation of conversationCache.values()) {
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
      return createFailure(createMemoryStorageError('get stats', 'Mem0', error as Error));
    }
  };

  const healthCheck = async (): Promise<Result<{ healthy: boolean; latencyMs?: number; error?: string }>> => {
    const start = Date.now();
    
    try {
      const client = ensureConnected();
      
      // Test Mem0 connectivity using ping if available
      if (client.ping) {
        await client.ping();
      }
      
      // Test basic operations
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
      console.log(`[MEMORY:Mem0] Closing provider, clearing ${conversationCache.size} conversations from cache`);
      conversationCache.clear();
      return createSuccess(undefined);
    } catch (error) {
      return createFailure(createMemoryStorageError('close provider', 'Mem0', error as Error));
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
    close,
    // Expose Mem0-specific functionality
    searchMemory,
    addToMemory
  } as MemoryProvider & {
    searchMemory: typeof searchMemory;
    addToMemory: typeof addToMemory;
  };
}