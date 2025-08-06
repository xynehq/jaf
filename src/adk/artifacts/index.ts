/**
 * JAF ADK Layer - Artifact Storage System
 * 
 * Provides persistent key-value storage for agent conversations
 * with support for multiple storage backends
 */

import { Session } from '../types.js';

// ========== Types ==========

export interface ArtifactMetadata {
  created: Date;
  lastModified: Date;
  contentType?: string;
  size?: number;
  tags?: string[];
}

export interface Artifact<T = unknown> {
  key: string;
  value: T;
  metadata: ArtifactMetadata;
}

export interface ArtifactStorage {
  get: <T = unknown>(sessionId: string, key: string) => Promise<Artifact<T> | null>;
  set: <T = unknown>(sessionId: string, key: string, value: T, metadata?: Partial<ArtifactMetadata>) => Promise<Artifact<T>>;
  delete: (sessionId: string, key: string) => Promise<boolean>;
  list: (sessionId: string) => Promise<Artifact[]>;
  clear: (sessionId: string) => Promise<void>;
  exists: (sessionId: string, key: string) => Promise<boolean>;
}

export interface ArtifactStorageConfig {
  type: 'memory' | 'redis' | 'postgres' | 's3' | 'gcs';
  config?: Record<string, unknown>;
  maxSize?: number; // Maximum artifact size in bytes
  ttl?: number; // Time to live in seconds
}

// ========== In-Memory Storage ==========

export const createMemoryArtifactStorage = (config?: { maxSize?: number; ttl?: number }): ArtifactStorage => {
  const storage = new Map<string, Map<string, Artifact>>();
  const maxSize = config?.maxSize || 10 * 1024 * 1024; // 10MB default
  const ttl = config?.ttl; // Optional TTL
  
  // Helper to get session storage
  const getSessionStorage = (sessionId: string): Map<string, Artifact> => {
    if (!storage.has(sessionId)) {
      storage.set(sessionId, new Map());
    }
    return storage.get(sessionId)!;
  };
  
  // Helper to check TTL
  const isExpired = (artifact: Artifact): boolean => {
    if (!ttl) return false;
    const age = Date.now() - artifact.metadata.lastModified.getTime();
    return age > ttl * 1000;
  };
  
  // Helper to estimate size
  const estimateSize = (value: unknown): number => {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  };
  
  return {
    get: async <T = unknown>(sessionId: string, key: string): Promise<Artifact<T> | null> => {
      const sessionStorage = getSessionStorage(sessionId);
      const artifact = sessionStorage.get(key);
      
      if (!artifact) return null;
      if (isExpired(artifact)) {
        sessionStorage.delete(key);
        return null;
      }
      
      return artifact as Artifact<T>;
    },
    
    set: async <T = unknown>(sessionId: string, key: string, value: T, metadata?: Partial<ArtifactMetadata>): Promise<Artifact<T>> => {
      const sessionStorage = getSessionStorage(sessionId);
      const size = estimateSize(value);
      
      if (size > maxSize) {
        throw new Error(`Artifact size (${size} bytes) exceeds maximum allowed size (${maxSize} bytes)`);
      }
      
      const now = new Date();
      const artifact: Artifact<T> = {
        key,
        value,
        metadata: {
          created: metadata?.created || sessionStorage.get(key)?.metadata.created || now,
          lastModified: now,
          contentType: metadata?.contentType,
          size,
          tags: metadata?.tags
        }
      };
      
      sessionStorage.set(key, artifact as Artifact);
      return artifact;
    },
    
    delete: async (sessionId: string, key: string): Promise<boolean> => {
      const sessionStorage = getSessionStorage(sessionId);
      return sessionStorage.delete(key);
    },
    
    list: async (sessionId: string): Promise<Artifact[]> => {
      const sessionStorage = getSessionStorage(sessionId);
      const artifacts: Artifact[] = [];
      
      for (const [key, artifact] of sessionStorage.entries()) {
        if (!isExpired(artifact)) {
          artifacts.push(artifact);
        } else {
          sessionStorage.delete(key);
        }
      }
      
      return artifacts;
    },
    
    clear: async (sessionId: string): Promise<void> => {
      storage.delete(sessionId);
    },
    
    exists: async (sessionId: string, key: string): Promise<boolean> => {
      const sessionStorage = getSessionStorage(sessionId);
      const artifact = sessionStorage.get(key);
      
      if (!artifact) return false;
      if (isExpired(artifact)) {
        sessionStorage.delete(key);
        return false;
      }
      
      return true;
    }
  };
};

// ========== Redis Storage ==========

export const createRedisArtifactStorage = (config: {
  host: string;
  port: number;
  password?: string;
  database?: number;
  keyPrefix?: string;
  maxSize?: number;
  ttl?: number;
}): ArtifactStorage => {
  let redis: any;
  const keyPrefix = config.keyPrefix || 'jaf:artifacts:';
  const maxSize = config.maxSize || 10 * 1024 * 1024; // 10MB default
  const ttl = config.ttl; // Optional TTL in seconds
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require('ioredis');
    redis = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.database || 0,
      connectTimeout: 5000, // 5 second timeout
      enableOfflineQueue: false, // Fail fast if offline
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 3) return null; // Stop retrying after 3 attempts
        return Math.min(times * 100, 3000);
      }
    });
  } catch (error) {
    throw new Error('Redis artifact storage requires ioredis to be installed');
  }
  
  const getKey = (sessionId: string, key: string) => `${keyPrefix}${sessionId}:${key}`;
  const getSessionPattern = (sessionId: string) => `${keyPrefix}${sessionId}:*`;
  
  return {
    get: async <T = unknown>(sessionId: string, key: string): Promise<Artifact<T> | null> => {
      const redisKey = getKey(sessionId, key);
      const data = await redis.get(redisKey);
      
      if (!data) return null;
      
      try {
        return JSON.parse(data) as Artifact<T>;
      } catch {
        return null;
      }
    },
    
    set: async <T = unknown>(sessionId: string, key: string, value: T, metadata?: Partial<ArtifactMetadata>): Promise<Artifact<T>> => {
      const now = new Date();
      const artifact: Artifact<T> = {
        key,
        value,
        metadata: {
          created: metadata?.created || now,
          lastModified: now,
          contentType: metadata?.contentType,
          size: JSON.stringify(value).length,
          tags: metadata?.tags
        }
      };
      
      const serialized = JSON.stringify(artifact);
      if (serialized.length > maxSize) {
        throw new Error(`Artifact size exceeds maximum allowed size`);
      }
      
      const redisKey = getKey(sessionId, key);
      if (ttl) {
        await redis.setex(redisKey, ttl, serialized);
      } else {
        await redis.set(redisKey, serialized);
      }
      
      return artifact;
    },
    
    delete: async (sessionId: string, key: string): Promise<boolean> => {
      const redisKey = getKey(sessionId, key);
      const result = await redis.del(redisKey);
      return result > 0;
    },
    
    list: async (sessionId: string): Promise<Artifact[]> => {
      const pattern = getSessionPattern(sessionId);
      const keys = await redis.keys(pattern);
      
      if (keys.length === 0) return [];
      
      const values = await redis.mget(...keys);
      const artifacts: Artifact[] = [];
      
      for (const value of values) {
        if (value) {
          try {
            artifacts.push(JSON.parse(value));
          } catch (error) {
            // Log error but continue with other artifacts
            console.error(`[Artifacts] Failed to parse artifact: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }
      
      return artifacts;
    },
    
    clear: async (sessionId: string): Promise<void> => {
      const pattern = getSessionPattern(sessionId);
      const keys = await redis.keys(pattern);
      
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    },
    
    exists: async (sessionId: string, key: string): Promise<boolean> => {
      const redisKey = getKey(sessionId, key);
      const exists = await redis.exists(redisKey);
      return exists > 0;
    }
  };
};

// ========== PostgreSQL Storage ==========

export const createPostgresArtifactStorage = (config: {
  connectionString: string;
  tableName?: string;
  maxSize?: number;
  ttl?: number;
}): ArtifactStorage => {
  let pool: any;
  const tableName = config.tableName || 'jaf_artifacts';
  // const maxSize = config.maxSize || 10 * 1024 * 1024; // TODO: Implement size limit checking
  const ttl = config.ttl;
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: config.connectionString,
      connectionTimeoutMillis: 5000, // 5 second timeout
      query_timeout: 5000, // 5 second query timeout
      statement_timeout: 5000 // 5 second statement timeout
    });
  } catch (error) {
    throw new Error('PostgreSQL artifact storage requires pg to be installed');
  }
  
  async function initializeTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        session_id VARCHAR(255) NOT NULL,
        key VARCHAR(255) NOT NULL,
        value JSONB NOT NULL,
        metadata JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL,
        modified_at TIMESTAMP WITH TIME ZONE NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE,
        PRIMARY KEY (session_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_session_id ON ${tableName} (session_id);
      CREATE INDEX IF NOT EXISTS idx_expires_at ON ${tableName} (expires_at);
    `;
    
    await pool.query(query);
  }
  
  // Initialize table asynchronously
  const initPromise = initializeTable().catch(error => {
    console.error('Failed to initialize PostgreSQL artifact storage table:', error);
    throw error;
  });
  
  return {
    get: async <T = unknown>(sessionId: string, key: string): Promise<Artifact<T> | null> => {
      await initPromise; // Ensure table exists
      const query = `
        SELECT * FROM ${tableName}
        WHERE session_id = $1 AND key = $2
        AND (expires_at IS NULL OR expires_at > NOW())
      `;
      
      const result = await pool.query(query, [sessionId, key]);
      
      if (result.rows.length === 0) return null;
      
      const row = result.rows[0];
      return {
        key: row.key,
        value: row.value as T,
        metadata: {
          ...row.metadata,
          created: new Date(row.created_at),
          lastModified: new Date(row.modified_at)
        }
      };
    },
    
    set: async <T = unknown>(sessionId: string, key: string, value: T, metadata?: Partial<ArtifactMetadata>): Promise<Artifact<T>> => {
      await initPromise; // Ensure table exists
      const now = new Date();
      const expiresAt = ttl ? new Date(now.getTime() + ttl * 1000) : null;
      
      const artifact: Artifact<T> = {
        key,
        value,
        metadata: {
          created: metadata?.created || now,
          lastModified: now,
          contentType: metadata?.contentType,
          size: JSON.stringify(value).length,
          tags: metadata?.tags
        }
      };
      
      const query = `
        INSERT INTO ${tableName} (session_id, key, value, metadata, created_at, modified_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (session_id, key)
        DO UPDATE SET 
          value = $3,
          metadata = $4,
          modified_at = $6,
          expires_at = $7
        RETURNING *
      `;
      
      await pool.query(query, [
        sessionId,
        key,
        JSON.stringify(value),
        JSON.stringify(artifact.metadata),
        artifact.metadata.created,
        now,
        expiresAt
      ]);
      
      return artifact;
    },
    
    delete: async (sessionId: string, key: string): Promise<boolean> => {
      await initPromise; // Ensure table exists
      const query = `
        DELETE FROM ${tableName}
        WHERE session_id = $1 AND key = $2
      `;
      
      const result = await pool.query(query, [sessionId, key]);
      return result.rowCount > 0;
    },
    
    list: async (sessionId: string): Promise<Artifact[]> => {
      await initPromise; // Ensure table exists
      const query = `
        SELECT * FROM ${tableName}
        WHERE session_id = $1
        AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY modified_at DESC
      `;
      
      const result = await pool.query(query, [sessionId]);
      
      return result.rows.map((row: any) => ({
        key: row.key,
        value: row.value,
        metadata: {
          ...row.metadata,
          created: new Date(row.created_at),
          lastModified: new Date(row.modified_at)
        }
      }));
    },
    
    clear: async (sessionId: string): Promise<void> => {
      await initPromise; // Ensure table exists
      const query = `
        DELETE FROM ${tableName}
        WHERE session_id = $1
      `;
      
      await pool.query(query, [sessionId]);
    },
    
    exists: async (sessionId: string, key: string): Promise<boolean> => {
      await initPromise; // Ensure table exists
      const query = `
        SELECT 1 FROM ${tableName}
        WHERE session_id = $1 AND key = $2
        AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 1
      `;
      
      const result = await pool.query(query, [sessionId, key]);
      return result.rows.length > 0;
    }
  };
};

// ========== Session Integration ==========

/**
 * Helper functions to integrate artifacts with sessions
 */

export const getSessionArtifact = <T = unknown>(session: Session, key: string): T | null => {
  return (session.artifacts[key] as T) || null;
};

export const setSessionArtifact = <T = unknown>(session: Session, key: string, value: T): Session => {
  return {
    ...session,
    artifacts: {
      ...session.artifacts,
      [key]: value
    }
  };
};

export const deleteSessionArtifact = (session: Session, key: string): Session => {
  const { [key]: _, ...rest } = session.artifacts;
  return {
    ...session,
    artifacts: rest
  };
};

export const clearSessionArtifacts = (session: Session): Session => {
  return {
    ...session,
    artifacts: {}
  };
};

export const listSessionArtifacts = (session: Session): string[] => {
  return Object.keys(session.artifacts);
};

// ========== Factory Function ==========

export const createArtifactStorage = (config: ArtifactStorageConfig): ArtifactStorage => {
  switch (config.type) {
    case 'memory':
      return createMemoryArtifactStorage(config.config as any);
    
    case 'redis':
      return createRedisArtifactStorage(config.config as any);
    
    case 'postgres':
      return createPostgresArtifactStorage(config.config as any);
    
    case 's3':
      throw new Error('S3 artifact storage not yet implemented');
    
    case 'gcs':
      throw new Error('GCS artifact storage not yet implemented');
    
    default:
      throw new Error(`Unknown artifact storage type: ${config.type}`);
  }
};