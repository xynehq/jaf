/**
 * Shared memory provider setup for HITL demos
 */

import { createMemoryProviderFromEnv } from '../../../src/memory/factory';

// Color utilities for console output
const colors = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
};

/**
 * Setup memory provider from environment configuration
 */
export async function setupMemoryProvider() {
  console.log(colors.cyan('💾 Setting up memory provider...'));
  let memoryProvider;
  
  const memoryType = process.env.JAF_MEMORY_TYPE || 'memory';
  
  if (memoryType === 'redis') {
    try {
      // Create Redis client if Redis is configured
      const { default: Redis } = await import('ioredis');
      const redisClient = new Redis({
        host: process.env.JAF_REDIS_HOST || 'localhost',
        port: parseInt(process.env.JAF_REDIS_PORT || '6379'),
        db: parseInt(process.env.JAF_REDIS_DB || '0'),
      });
      memoryProvider = await createMemoryProviderFromEnv({ redis: redisClient });
      console.log(colors.green('✅ Redis memory provider initialized'));
    } catch (error: any) {
      console.log(colors.yellow(`⚠️  Redis not available, falling back to in-memory`));
      console.log(colors.dim(`   Error: ${error.message}`));
      memoryProvider = await createMemoryProviderFromEnv();
    }
  } else if (memoryType === 'postgres') {
    try {
      // Create PostgreSQL client if PostgreSQL is configured
      const { Client } = await import('pg');
      const pgClient = new Client({
        host: process.env.JAF_POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.JAF_POSTGRES_PORT || '5432'),
        database: process.env.JAF_POSTGRES_DB || 'jaf_memory',
        user: process.env.JAF_POSTGRES_USER || 'postgres',
        password: process.env.JAF_POSTGRES_PASSWORD,
        ssl: process.env.JAF_POSTGRES_SSL === 'true',
      });
      
      await pgClient.connect();
      console.log(colors.dim('   Connected to PostgreSQL'));
      
      memoryProvider = await createMemoryProviderFromEnv({ postgres: pgClient });
      console.log(colors.green('✅ PostgreSQL memory provider initialized'));
    } catch (error: any) {
      console.log(colors.yellow(`⚠️  PostgreSQL not available, falling back to in-memory`));
      console.log(colors.dim(`   Error: ${error.message || JSON.stringify(error)}`));
      if (error.cause) {
        console.log(colors.dim(`   Cause: ${error.cause.message}`));
      }
      console.log(colors.dim(`   Full error: ${JSON.stringify(error, null, 2)}`));
      memoryProvider = await createMemoryProviderFromEnv();
    }
  } else {
    // In-memory provider
    memoryProvider = await createMemoryProviderFromEnv();
    console.log(colors.green('✅ In-memory provider initialized'));
  }
  
  return memoryProvider;
}