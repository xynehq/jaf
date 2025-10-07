/**
 * JAF ADK Layer - Session Management
 *
 * Functional session management with pluggable providers
 */

import {
  Session,
  SessionContext,
  SessionProvider,
  SessionMetadata,
  Content,
  SessionError,
  ValidationResult,
  throwSessionError,
  createSessionError
} from '../types';
import { safeConsole } from '../../utils/logger.js';

// ========== Session Creation ==========

export const generateSessionId = (): string => {
  // Use timestamp and random number to match expected pattern /^session_\d+_\d+$/
  return `session_${Date.now()}_${Math.floor(Math.random() * 1000000000)}`;
};

export const createSession = (
  appName: string,
  userId: string,
  sessionId?: string,
  metadata?: Partial<SessionMetadata>
): Session => {
  const id = sessionId || generateSessionId();
  
  const sessionMetadata: SessionMetadata = {
    created: new Date(),
    tags: [],
    properties: {},
    ...metadata
  };
  
  return {
    id,
    appName,
    userId,
    messages: [],
    artifacts: {},
    metadata: sessionMetadata
  };
};

// ========== In-Memory Session Provider ==========

export const createInMemorySessionProvider = (): SessionProvider => {
  const sessions = new Map<string, Session>();
  
  return {
    createSession: async (context: SessionContext): Promise<Session> => {
      const session = createSession(
        context.appName,
        context.userId,
        context.sessionId
      );
      
      sessions.set(session.id, session);
      return session;
    },
    
    getSession: async (sessionId: string): Promise<Session | null> => {
      const session = sessions.get(sessionId);
      if (session) {
        // Update last accessed
        session.metadata.lastAccessed = new Date();
        sessions.set(sessionId, session);
      }
      return session || null;
    },
    
    updateSession: async (session: Session): Promise<Session> => {
      session.metadata.lastAccessed = new Date();
      sessions.set(session.id, session);
      return session;
    },
    
    listSessions: async (userId: string): Promise<Session[]> => {
      return Array.from(sessions.values())
        .filter(session => session.userId === userId)
        .sort((a, b) => b.metadata.created.getTime() - a.metadata.created.getTime());
    },
    
    deleteSession: async (sessionId: string): Promise<boolean> => {
      return sessions.delete(sessionId);
    }
  };
};

// ========== Redis Session Provider ==========

// Re-export from the real implementation
export { createRedisSessionProvider, type RedisConfig } from './redis-provider.js';

// Legacy mock implementation for backward compatibility
interface MockRedisConfig {
  host: string;
  port: number;
  password?: string;
  database?: number;
  keyPrefix?: string;
}

export const createMockRedisSessionProvider = (config: MockRedisConfig): SessionProvider => {
  let redis: any; // Will be typed properly when ioredis is added
  let isRealRedis = false;
  
  // Try to use real Redis if available
  try {
    // Dynamic import to avoid breaking if ioredis not installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require('ioredis');
    redis = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.database || 0,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      enableOfflineQueue: true,
      maxRetriesPerRequest: 3,
      lazyConnect: false
    });
    isRealRedis = true;
    
    // Handle connection errors
    redis.on('error', (err: any) => {
      safeConsole.error('[ADK:Sessions] Redis connection error:', err);
    });

    redis.on('connect', () => {
      safeConsole.log('[ADK:Sessions] Connected to Redis');
    });
  } catch (error) {
    safeConsole.warn('[ADK:Sessions] ioredis not found, falling back to mock implementation');
    // Fallback to mock Map if ioredis not available
    redis = new Map<string, string>();
  }
  const keyPrefix = config.keyPrefix || 'jaf_adk_session:';
  
  const getKey = (sessionId: string) => `${keyPrefix}${sessionId}`;
  const getUserKey = (userId: string) => `${keyPrefix}user:${userId}`;
  
  // Helper to deserialize session and restore Date objects
  const deserializeSession = (sessionData: string): Session => {
    const session: Session = JSON.parse(sessionData);
    // Restore Date objects from strings
    if (session.metadata.created && typeof session.metadata.created === 'string') {
      session.metadata.created = new Date(session.metadata.created);
    }
    if (session.metadata.lastAccessed && typeof session.metadata.lastAccessed === 'string') {
      session.metadata.lastAccessed = new Date(session.metadata.lastAccessed);
    }
    return session;
  };
  
  return {
    createSession: async (context: SessionContext): Promise<Session> => {
      const session = createSession(
        context.appName,
        context.userId,
        context.sessionId
      );
      
      // Store session
      redis.set(getKey(session.id), JSON.stringify(session));
      
      // Add to user's session list
      const userKey = getUserKey(context.userId);
      const userSessions = redis.get(userKey);
      const sessionIds = userSessions ? JSON.parse(userSessions) : [];
      sessionIds.push(session.id);
      redis.set(userKey, JSON.stringify(sessionIds));
      
      return session;
    },
    
    getSession: async (sessionId: string): Promise<Session | null> => {
      const sessionData = redis.get(getKey(sessionId));
      if (!sessionData) {
        return null;
      }
      
      try {
        const session = deserializeSession(sessionData);
        
        // Update last accessed
        session.metadata.lastAccessed = new Date();
        redis.set(getKey(sessionId), JSON.stringify(session));
        
        return session;
      } catch (error) {
        throwSessionError(`Failed to parse session data: ${error}`, sessionId);
        return null; // This will never be reached due to throwSessionError, but needed for TypeScript
      }
    },
    
    updateSession: async (session: Session): Promise<Session> => {
      session.metadata.lastAccessed = new Date();
      redis.set(getKey(session.id), JSON.stringify(session));
      return session;
    },
    
    listSessions: async (userId: string): Promise<Session[]> => {
      const userKey = getUserKey(userId);
      const sessionIdsData = redis.get(userKey);
      
      if (!sessionIdsData) {
        return [];
      }
      
      try {
        const sessionIds: string[] = JSON.parse(sessionIdsData);
        const sessions: Session[] = [];
        
        for (const sessionId of sessionIds) {
          const sessionData = redis.get(getKey(sessionId));
          if (sessionData) {
            sessions.push(deserializeSession(sessionData));
          }
        }
        
        return sessions.sort((a, b) => 
          b.metadata.created.getTime() - a.metadata.created.getTime()
        );
      } catch (error) {
        throwSessionError(`Failed to list sessions for user: ${error}`, undefined, { userId });
        return []; // This will never be reached due to throwSessionError, but needed for TypeScript
      }
    },
    
    deleteSession: async (sessionId: string): Promise<boolean> => {
      const sessionData = redis.get(getKey(sessionId));
      if (!sessionData) {
        return false;
      }
      
      try {
        const session: Session = JSON.parse(sessionData);
        
        // Remove from Redis
        redis.delete(getKey(sessionId));
        
        // Remove from user's session list
        const userKey = getUserKey(session.userId);
        const userSessionsData = redis.get(userKey);
        if (userSessionsData) {
          const sessionIds: string[] = JSON.parse(userSessionsData);
          const updatedIds = sessionIds.filter(id => id !== sessionId);
          redis.set(userKey, JSON.stringify(updatedIds));
        }
        
        return true;
      } catch (error) {
        throwSessionError(`Failed to delete session: ${error}`, sessionId);
        return false; // This will never be reached due to throwSessionError, but needed for TypeScript
      }
    }
  };
};

// ========== Postgres Session Provider ==========

// Re-export from the real implementation
export { createPostgresSessionProvider, type PostgresConfig } from './postgres-provider.js';

// ========== Session Operations ==========

export const addMessageToSession = (session: Session, message: Content): Session => {
  return {
    ...session,
    messages: [...session.messages, message],
    metadata: {
      ...session.metadata,
      lastAccessed: new Date()
    }
  };
};

export const addArtifactToSession = (
  session: Session, 
  key: string, 
  value: unknown
): Session => {
  return {
    ...session,
    artifacts: {
      ...session.artifacts,
      [key]: value
    },
    metadata: {
      ...session.metadata,
      lastAccessed: new Date()
    }
  };
};

export const removeArtifactFromSession = (session: Session, key: string): Session => {
  const { [key]: removed, ...remainingArtifacts } = session.artifacts;
  
  return {
    ...session,
    artifacts: remainingArtifacts,
    metadata: {
      ...session.metadata,
      lastAccessed: new Date()
    }
  };
};

export const updateSessionMetadata = (
  session: Session,
  metadata: Partial<SessionMetadata>
): Session => {
  return {
    ...session,
    metadata: {
      ...session.metadata,
      ...metadata,
      lastAccessed: new Date()
    }
  };
};

export const clearSessionMessages = (session: Session): Session => {
  return {
    ...session,
    messages: [],
    metadata: {
      ...session.metadata,
      lastAccessed: new Date()
    }
  };
};

// ========== Session Validation ==========

export const validateSession = (session: Session): ValidationResult<Session> => {
  const errors: string[] = [];
  
  if (!session.id || session.id.trim().length === 0) {
    errors.push('Session ID is required');
  }
  
  if (!session.appName || session.appName.trim().length === 0) {
    errors.push('App name is required');
  }
  
  if (!session.userId || session.userId.trim().length === 0) {
    errors.push('User ID is required');
  }
  
  if (!Array.isArray(session.messages)) {
    errors.push('Messages must be an array');
  }
  
  if (typeof session.artifacts !== 'object' || session.artifacts === null) {
    errors.push('Artifacts must be an object');
  }
  
  if (!session.metadata || !session.metadata.created) {
    errors.push('Session metadata with created date is required');
  }
  
  if (errors.length > 0) {
    return { success: false, errors };
  }
  
  return { success: true, data: session };
};

export const validateSessionContext = (context: SessionContext): ValidationResult<SessionContext> => {
  const errors: string[] = [];
  
  if (!context.appName || context.appName.trim().length === 0) {
    errors.push('App name is required');
  }
  
  if (!context.userId || context.userId.trim().length === 0) {
    errors.push('User ID is required');
  }
  
  if (errors.length > 0) {
    return { success: false, errors };
  }
  
  return { success: true, data: context };
};

// ========== Session Utilities ==========

export const getOrCreateSession = async (
  provider: SessionProvider,
  context: SessionContext
): Promise<Session> => {
  // If sessionId is provided, try to get existing session
  if (context.sessionId) {
    const existingSession = await provider.getSession(context.sessionId);
    if (existingSession) {
      return existingSession;
    }
  }
  
  // Create new session
  return await provider.createSession(context);
};

export const getSessionStats = (session: Session) => {
  const messageCount = session.messages.length;
  const userMessages = session.messages.filter(m => m.role === 'user').length;
  const modelMessages = session.messages.filter(m => m.role === 'model').length;
  const systemMessages = session.messages.filter(m => m.role === 'system').length;
  const artifactCount = Object.keys(session.artifacts).length;
  
  const totalTextLength = session.messages
    .flatMap(m => m.parts)
    .filter(p => p.type === 'text' && p.text)
    .reduce((sum, p) => sum + (p.text?.length || 0), 0);
  
  return {
    id: session.id,
    appName: session.appName,
    userId: session.userId,
    messageCount,
    userMessages,
    modelMessages,
    systemMessages,
    artifactCount,
    totalTextLength,
    created: session.metadata.created,
    lastAccessed: session.metadata.lastAccessed,
    tags: session.metadata.tags
  };
};

export const cloneSession = (session: Session, newId?: string): Session => {
  return {
    ...session,
    id: newId || generateSessionId(),
    messages: [...session.messages],
    artifacts: { ...session.artifacts },
    metadata: {
      ...session.metadata,
      created: new Date()
    }
  };
};

export const mergeSessionArtifacts = (session: Session, artifacts: Record<string, unknown>): Session => {
  return {
    ...session,
    artifacts: {
      ...session.artifacts,
      ...artifacts
    },
    metadata: {
      ...session.metadata,
      lastAccessed: new Date()
    }
  };
};

// ========== Session Query Functions ==========

export const getLastUserMessage = (session: Session): Content | null => {
  const userMessages = session.messages.filter(m => m.role === 'user');
  return userMessages.length > 0 ? userMessages[userMessages.length - 1] : null;
};

export const getLastModelMessage = (session: Session): Content | null => {
  const modelMessages = session.messages.filter(m => m.role === 'model');
  return modelMessages.length > 0 ? modelMessages[modelMessages.length - 1] : null;
};

export const getMessagesByRole = (session: Session, role: Content['role']): Content[] => {
  return session.messages.filter(m => m.role === role);
};

export const hasArtifact = (session: Session, key: string): boolean => {
  return key in session.artifacts;
};

export const getArtifact = (session: Session, key: string): unknown | null => {
  return session.artifacts[key] || null;
};

export const getArtifactKeys = (session: Session): string[] => {
  return Object.keys(session.artifacts);
};

// ========== Error Handling ==========

// Export createSessionError from types for external use
export { createSessionError }

export const withSessionErrorHandling = <T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  sessionId?: string
) => {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      // Check if error is already a SessionError by checking its properties
      // Handle both Error instances and plain SessionErrorObjects
      if (error && typeof error === 'object' && 
          ((error as any).name === 'SessionError' || 
           (error as any).code === 'SESSION_ERROR')) {
        throw error;
      }
      
      throwSessionError(
        `Session operation failed: ${error instanceof Error ? error.message : String(error)}`,
        sessionId,
        { originalError: error }
      );
      // This will never be reached due to throwSessionError, but needed for TypeScript
      throw error;
    }
  };
};

// ========== Session Provider Bridge ==========

// Bridge JAF memory providers to ADK session providers
export const createMemoryProviderBridge = (memoryProvider: any): SessionProvider => {
  return {
    createSession: async (context: SessionContext): Promise<Session> => {
      const memory = await memoryProvider.createMemory(context.userId);
      return sessionFromMemory(memory, context);
    },
    
    getSession: async (sessionId: string): Promise<Session | null> => {
      const memory = await memoryProvider.getMemory(sessionId);
      return memory ? sessionFromMemory(memory) : null;
    },
    
    updateSession: async (session: Session): Promise<Session> => {
      const memory = memoryFromSession(session);
      await memoryProvider.updateMemory(session.id, memory);
      return session;
    },
    
    listSessions: async (userId: string): Promise<Session[]> => {
      const memories = await memoryProvider.listMemories(userId);
      return memories.map((memory: any) => sessionFromMemory(memory));
    },
    
    deleteSession: async (sessionId: string): Promise<boolean> => {
      return await memoryProvider.deleteMemory(sessionId);
    }
  };
};

const sessionFromMemory = (memory: any, context?: SessionContext): Session => {
  return {
    id: memory.id || generateSessionId(),
    appName: context?.appName || 'unknown',
    userId: memory.userId || context?.userId || 'unknown',
    messages: memory.messages || [],
    artifacts: memory.metadata || {},
    metadata: {
      created: memory.created || new Date(),
      lastAccessed: memory.lastAccessed,
      tags: [],
      properties: {}
    }
  };
};

const memoryFromSession = (session: Session): any => {
  return {
    id: session.id,
    userId: session.userId,
    messages: session.messages,
    metadata: session.artifacts,
    created: session.metadata.created,
    lastAccessed: session.metadata.lastAccessed
  };
};