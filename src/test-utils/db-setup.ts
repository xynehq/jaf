/**
 * Test Database Setup Utilities
 */

import Redis from 'ioredis';
import { Pool } from 'pg';

export interface TestDatabaseClients {
  redis?: Redis;
  postgres?: Pool;
}

/**
 * Create Redis client for testing
 */
export const createTestRedisClient = (): Redis | undefined => {
  try {
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      db: parseInt(process.env.REDIS_DB || '0'),
      retryStrategy: (times) => {
        if (times > 3) {
          return null; // Stop retrying
        }
        return Math.min(times * 100, 2000);
      },
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false
    });

    // Test connection
    redis.ping().catch(() => {
      redis.disconnect();
    });

    return redis;
  } catch (error) {
    console.warn('Failed to create Redis client for testing:', error);
    return undefined;
  }
};

/**
 * Create PostgreSQL client for testing
 */
export const createTestPostgresClient = (): Pool | undefined => {
  try {
    const pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      user: process.env.POSTGRES_USER || 'faf_test',
      password: process.env.POSTGRES_PASSWORD || 'faf_test_password',
      database: process.env.POSTGRES_DATABASE || 'faf_test_db',
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection
    pool.query('SELECT 1').catch(() => {
      pool.end();
    });

    return pool;
  } catch (error) {
    console.warn('Failed to create PostgreSQL client for testing:', error);
    return undefined;
  }
};

/**
 * Setup test database clients
 */
export const setupTestDatabases = async (): Promise<TestDatabaseClients> => {
  const clients: TestDatabaseClients = {};

  // Try to create Redis client
  const redis = createTestRedisClient();
  if (redis) {
    try {
      await redis.ping();
      clients.redis = redis;
      console.log('✓ Redis connected for testing');
    } catch (error) {
      console.warn('✗ Redis not available for testing');
      redis.disconnect();
    }
  }

  // Try to create PostgreSQL client
  const postgres = createTestPostgresClient();
  if (postgres) {
    try {
      await postgres.query('SELECT 1');
      clients.postgres = postgres;
      console.log('✓ PostgreSQL connected for testing');
    } catch (error) {
      console.warn('✗ PostgreSQL not available for testing');
      await postgres.end();
    }
  }

  return clients;
};

/**
 * Cleanup test database clients
 */
export const cleanupTestDatabases = async (clients: TestDatabaseClients): Promise<void> => {
  if (clients.redis) {
    await clients.redis.flushdb();
    clients.redis.disconnect();
  }

  if (clients.postgres) {
    // Clean up test tables
    try {
      await clients.postgres.query(`
        DROP TABLE IF EXISTS faf_sessions CASCADE;
        DROP TABLE IF EXISTS faf_artifacts CASCADE;
        DROP TABLE IF EXISTS faf_memory CASCADE;
      `);
    } catch (error) {
      // Ignore cleanup errors
    }
    await clients.postgres.end();
  }
};

/**
 * Check if Redis is available
 */
export const isRedisAvailable = async (): Promise<boolean> => {
  const redis = createTestRedisClient();
  if (!redis) return false;

  try {
    await redis.ping();
    redis.disconnect();
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if PostgreSQL is available
 */
export const isPostgresAvailable = async (): Promise<boolean> => {
  const postgres = createTestPostgresClient();
  if (!postgres) return false;

  try {
    await postgres.query('SELECT 1');
    await postgres.end();
    return true;
  } catch {
    return false;
  }
};