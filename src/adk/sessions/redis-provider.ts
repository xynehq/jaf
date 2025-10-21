/**
 * Real Redis Session Provider Implementation
 *
 * This provides a production-ready Redis-based session provider
 * with proper error handling and connection management
 */

import {
  SessionProvider,
  Session,
  SessionContext,
  throwSessionError
} from '../types.js';
import { createSession } from './index.js';
import { safeConsole } from '../../utils/logger.js';

// Helper type for Redis client
type RedisClient = any; // Will be properly typed when ioredis is added

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  database?: number;
  keyPrefix?: string;
  ttl?: number; // Session TTL in seconds
}

export const createRedisSessionProvider = (config: RedisConfig): SessionProvider => {
  let redis: RedisClient;
  
  // Require real Redis - no fallback
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
      lazyConnect: process.env.NODE_ENV === 'test',
      connectTimeout: 10000,
      commandTimeout: 5000
    });
    
    // Only log Redis events if not in test environment
    if (process.env.NODE_ENV !== 'test') {
      // Handle connection events
      redis.on('error', (err: any) => {
        safeConsole.error('[ADK:Sessions] Redis connection error:', err);
      });

      redis.on('connect', () => {
        safeConsole.log('[ADK:Sessions] Connected to Redis');
      });
      redis.on('ready', () => {
        safeConsole.log('[ADK:Sessions] Redis ready for commands');
      });

      redis.on('close', () => {
        safeConsole.log('[ADK:Sessions] Redis connection closed');
      });

      redis.on('reconnecting', (delay: number) => {
        safeConsole.log(`[ADK:Sessions] Reconnecting to Redis in ${delay}ms`);
      });
    }
  } catch (error) {
    throw new Error(
      'Redis session provider requires ioredis to be installed. ' +
      'Please install it with: npm install ioredis'
    );
  }
  
  const keyPrefix = config.keyPrefix || 'jaf_adk_session:';
  const sessionTTL = config.ttl || 86400; // Default 24 hours
  
  const getKey = (sessionId: string) => `${keyPrefix}${sessionId}`;
  const getUserKey = (userId: string) => `${keyPrefix}user:${userId}`;
  
  // Helper to serialize/deserialize sessions
  const serializeSession = (session: Session): string => {
    return JSON.stringify(session);
  };
  
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
  
  // Redis operation helpers with proper async handling
  const redisGet = async (key: string): Promise<string | null> => {
    try {
      return await redis.get(key);
    } catch (error) {
      safeConsole.error(`[ADK:Sessions] Redis GET error for key ${key}:`, error);
      throw error;
    }
  };

  const redisSet = async (key: string, value: string, ttlSeconds?: number): Promise<void> => {
    try {
      if (ttlSeconds) {
        await redis.setex(key, ttlSeconds, value);
      } else {
        await redis.set(key, value);
      }
    } catch (error) {
      safeConsole.error(`[ADK:Sessions] Redis SET error for key ${key}:`, error);
      throw error;
    }
  };
  
  // Note: redisDelete, redisSAdd, and redisSRem are used in the deleteSession method
  // which uses the redis.multi() approach for atomic operations
  
  const redisSMembers = async (key: string): Promise<string[]> => {
    try {
      return await redis.smembers(key);
    } catch (error) {
      safeConsole.error(`[ADK:Sessions] Redis SMEMBERS error for key ${key}:`, error);
      throw error;
    }
  };
  
  // Multi/Pipeline operations for performance
  const redisMulti = () => {
    return redis.multi();
  };
  
  const provider = {
    // Expose redis client for cleanup utilities
    _redis: redis,
    
    createSession: async (context: SessionContext): Promise<Session> => {
      const session = createSession(
        context.appName,
        context.userId,
        context.sessionId
      );
      
      try {
        // Use multi for atomic operations
        const multi = redisMulti();
        multi.setex(getKey(session.id), sessionTTL, serializeSession(session));
        multi.sadd(getUserKey(context.userId), session.id);
        await multi.exec();
        
        return session;
      } catch (error) {
        throwSessionError(`Failed to create session in Redis: ${error}`, session.id);
        throw error; // TypeScript needs this even though throwSessionError never returns
      }
    },
    
    getSession: async (sessionId: string): Promise<Session | null> => {
      try {
        const sessionData = await redisGet(getKey(sessionId));
        if (!sessionData) {
          return null;
        }
        
        const session = deserializeSession(sessionData);
        
        // Update last accessed time and refresh TTL
        session.metadata.lastAccessed = new Date();
        await redisSet(getKey(sessionId), serializeSession(session), sessionTTL);
        
        return session;
      } catch (error) {
        throwSessionError(`Failed to get session from Redis: ${error}`, sessionId);
        throw error; // TypeScript needs this even though throwSessionError never returns
      }
    },
    
    updateSession: async (session: Session): Promise<Session> => {
      try {
        session.metadata.lastAccessed = new Date();
        await redisSet(getKey(session.id), serializeSession(session), sessionTTL);
        return session;
      } catch (error) {
        throwSessionError(`Failed to update session in Redis: ${error}`, session.id);
        throw error; // TypeScript needs this even though throwSessionError never returns
      }
    },
    
    listSessions: async (userId: string): Promise<Session[]> => {
      try {
        const userKey = getUserKey(userId);
        const sessionIds = await redisSMembers(userKey);
        
        if (sessionIds.length === 0) {
          return [];
        }
        
        const sessions: Session[] = [];
        const deadSessionIds: string[] = [];
        
        // Retrieve all sessions for user
        for (const sessionId of sessionIds) {
          const sessionData = await redisGet(getKey(sessionId));
          if (sessionData) {
            try {
              sessions.push(deserializeSession(sessionData));
            } catch (error) {
              // Skip invalid sessions
              safeConsole.warn(`[ADK:Sessions] Skipping invalid session ${sessionId}:`, error);
              deadSessionIds.push(sessionId);
            }
          } else {
            // Session expired or deleted
            deadSessionIds.push(sessionId);
          }
        }
        
        // Clean up dead session references
        if (deadSessionIds.length > 0) {
          const multi = redis.multi();
          for (const deadId of deadSessionIds) {
            multi.srem(userKey, deadId);
          }
          await multi.exec();
        }
        
        // Sort by creation date (newest first)
        return sessions.sort((a, b) => 
          b.metadata.created.getTime() - a.metadata.created.getTime()
        );
      } catch (error) {
        throwSessionError(`Failed to list sessions from Redis: ${error}`);
        throw error; // TypeScript needs this even though throwSessionError never returns
      }
    },
    
    deleteSession: async (sessionId: string): Promise<boolean> => {
      try {
        const sessionData = await redisGet(getKey(sessionId));
        if (!sessionData) {
          return false;
        }
        
        const session = deserializeSession(sessionData);
        
        // Use multi for atomic deletion
        const multi = redis.multi();
        multi.del(getKey(sessionId));
        multi.srem(getUserKey(session.userId), sessionId);
        const results = await multi.exec();
        return results?.[0]?.[1] === 1;
      } catch (error) {
        throwSessionError(`Failed to delete session from Redis: ${error}`, sessionId);
        throw error; // TypeScript needs this even though throwSessionError never returns
      }
    }
  };
  
  return provider;
};

// Additional utility functions

export const closeRedisConnection = async (provider: any): Promise<void> => {
  // Access the internal redis client if available
  if (provider._redis && typeof provider._redis.disconnect === 'function') {
    await provider._redis.disconnect();
  }
};

export const pingRedis = async (provider: any): Promise<boolean> => {
  try {
    if (provider._redis && typeof provider._redis.ping === 'function') {
      const result = await provider._redis.ping();
      return result === 'PONG';
    }
    return false;
  } catch {
    return false;
  }
};