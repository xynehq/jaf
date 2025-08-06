/**
 * Tests for Artifact Storage System
 */

import {
  createMemoryArtifactStorage,
  createRedisArtifactStorage,
  createPostgresArtifactStorage,
  createArtifactStorage,
  getSessionArtifact,
  setSessionArtifact,
  deleteSessionArtifact,
  clearSessionArtifacts,
  listSessionArtifacts,
  type ArtifactStorage
} from '../index';
import { Session } from '../../types';

describe('Artifact Storage System', () => {
  const testSessionId = 'test-session-123';
  const testKey = 'test-artifact';
  const testValue = { data: 'test data', nested: { value: 42 } };
  
  describe('Memory Artifact Storage', () => {
    let storage: ArtifactStorage;
    
    beforeEach(() => {
      storage = createMemoryArtifactStorage();
    });
    
    it('should store and retrieve artifacts', async () => {
      const artifact = await storage.set(testSessionId, testKey, testValue);
      
      expect(artifact.key).toBe(testKey);
      expect(artifact.value).toEqual(testValue);
      expect(artifact.metadata.created).toBeInstanceOf(Date);
      expect(artifact.metadata.lastModified).toBeInstanceOf(Date);
      expect(artifact.metadata.size).toBeGreaterThan(0);
      
      const retrieved = await storage.get(testSessionId, testKey);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.value).toEqual(testValue);
    });
    
    it('should return null for non-existent artifacts', async () => {
      const result = await storage.get(testSessionId, 'non-existent');
      expect(result).toBeNull();
    });
    
    it('should delete artifacts', async () => {
      await storage.set(testSessionId, testKey, testValue);
      
      const deleted = await storage.delete(testSessionId, testKey);
      expect(deleted).toBe(true);
      
      const result = await storage.get(testSessionId, testKey);
      expect(result).toBeNull();
    });
    
    it('should list all artifacts for a session', async () => {
      await storage.set(testSessionId, 'artifact1', { value: 1 });
      await storage.set(testSessionId, 'artifact2', { value: 2 });
      await storage.set(testSessionId, 'artifact3', { value: 3 });
      
      const artifacts = await storage.list(testSessionId);
      expect(artifacts).toHaveLength(3);
      expect(artifacts.map(a => a.key).sort()).toEqual(['artifact1', 'artifact2', 'artifact3']);
    });
    
    it('should clear all artifacts for a session', async () => {
      await storage.set(testSessionId, 'artifact1', { value: 1 });
      await storage.set(testSessionId, 'artifact2', { value: 2 });
      
      await storage.clear(testSessionId);
      
      const artifacts = await storage.list(testSessionId);
      expect(artifacts).toHaveLength(0);
    });
    
    it('should check if artifact exists', async () => {
      await storage.set(testSessionId, testKey, testValue);
      
      const exists = await storage.exists(testSessionId, testKey);
      expect(exists).toBe(true);
      
      const notExists = await storage.exists(testSessionId, 'non-existent');
      expect(notExists).toBe(false);
    });
    
    it('should handle TTL expiration', async () => {
      const ttlStorage = createMemoryArtifactStorage({ ttl: 1 }); // 1 second TTL
      
      await ttlStorage.set(testSessionId, testKey, testValue);
      
      // Should exist immediately
      let result = await ttlStorage.get(testSessionId, testKey);
      expect(result).not.toBeNull();
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Should be expired
      result = await ttlStorage.get(testSessionId, testKey);
      expect(result).toBeNull();
    });
    
    it('should enforce size limits', async () => {
      const limitedStorage = createMemoryArtifactStorage({ maxSize: 100 }); // 100 bytes max
      
      const largeValue = { data: 'x'.repeat(200) }; // Exceeds limit
      
      await expect(
        limitedStorage.set(testSessionId, testKey, largeValue)
      ).rejects.toThrow('exceeds maximum allowed size');
    });
    
    it('should update metadata on re-set', async () => {
      const artifact1 = await storage.set(testSessionId, testKey, { value: 1 });
      const created1 = artifact1.metadata.created;
      
      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const artifact2 = await storage.set(testSessionId, testKey, { value: 2 });
      
      expect(artifact2.metadata.created).toEqual(created1); // Created date preserved
      expect(artifact2.metadata.lastModified.getTime()).toBeGreaterThan(created1.getTime());
    });
    
    it('should handle multiple sessions independently', async () => {
      const session1 = 'session-1';
      const session2 = 'session-2';
      
      await storage.set(session1, 'key', { session: 1 });
      await storage.set(session2, 'key', { session: 2 });
      
      const result1 = await storage.get(session1, 'key');
      const result2 = await storage.get(session2, 'key');
      
      expect(result1?.value).toEqual({ session: 1 });
      expect(result2?.value).toEqual({ session: 2 });
    });
  });
  
  describe('Redis Artifact Storage', () => {
    let storage: ArtifactStorage | null = null;
    let redisConnected = false;
    
    beforeAll(async () => {
      // Skip Redis tests in CI environment
      if (process.env.CI) {
        console.log('Skipping Redis artifact tests in CI');
        return;
      }
      
      try {
        // Check if ioredis is available
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Redis = require('ioredis');
        
        // Test connection first
        const testClient = new Redis({
          host: 'localhost',
          port: 6379,
          connectTimeout: 1000,
          lazyConnect: true,
          retryStrategy: () => null
        });
        
        try {
          await testClient.connect();
          await testClient.ping();
          redisConnected = true;
          await testClient.quit();
          
          // Only create storage if connection works
          storage = createRedisArtifactStorage({
            host: 'localhost',
            port: 6379,
            keyPrefix: 'test:artifacts:'
          });
        } catch {
          // Connection failed, skip tests
          console.log('Redis connection failed - skipping tests');
        }
      } catch {
        // ioredis not available, skip tests
        console.log('ioredis not installed - skipping tests');
      }
    });
    
    afterEach(async () => {
      if (storage && redisConnected) {
        try {
          await storage.clear(testSessionId);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
    
    it('should work with Redis if available', async () => {
      if (!storage || !redisConnected) {
        console.log('Skipping Redis tests - Redis not available');
        return;
      }
      
      try {
        const artifact = await storage.set(testSessionId, testKey, testValue);
        expect(artifact.value).toEqual(testValue);
        
        const retrieved = await storage.get(testSessionId, testKey);
        expect(retrieved?.value).toEqual(testValue);
      } catch (error) {
        // Skip test if Redis connection fails
        if (error instanceof Error && 
            (error.message.includes('ECONNREFUSED') || 
             error.message.includes('Stream isn\'t writeable') ||
             error.message.includes('max retries'))) {
          console.log('Skipping Redis test - Connection issue');
          return;
        }
        throw error;
      }
    }, 15000);
  });
  
  describe('PostgreSQL Artifact Storage', () => {
    let storage: ArtifactStorage | null = null;
    
    beforeAll(() => {
      // Skip PostgreSQL tests in CI environment
      if (process.env.CI) {
        console.log('Skipping PostgreSQL artifact tests in CI');
        return;
      }
      
      try {
        require('pg');
        const connectionString = process.env.POSTGRES_URL || 'postgresql://jaf_test:jaf_test_password@localhost:5432/jaf_test_db';
        storage = createPostgresArtifactStorage({
          connectionString,
          tableName: 'test_artifacts'
        });
      } catch {
        // PostgreSQL not available, skip tests
      }
    });
    
    afterEach(async () => {
      if (storage) {
        await storage.clear(testSessionId);
      }
    });
    
    it('should work with PostgreSQL if available', async () => {
      if (!storage) {
        console.log('Skipping PostgreSQL tests - PostgreSQL not available');
        return;
      }
      
      try {
        const artifact = await storage.set(testSessionId, testKey, testValue);
        expect(artifact.value).toEqual(testValue);
        
        const retrieved = await storage.get(testSessionId, testKey);
        expect(retrieved?.value).toEqual(testValue);
      } catch (error) {
        // Skip test if PostgreSQL connection fails (e.g., in CI)
        if (error instanceof Error && 
            (error.message.includes('ECONNREFUSED') || 
             error.message.includes('connect ECONNREFUSED'))) {
          console.log('Skipping PostgreSQL test - Connection failed (expected in CI)');
          return;
        }
        throw error;
      }
    }, 15000);
  });
  
  describe('Session Integration', () => {
    const mockSession: Session = {
      id: 'session-123',
      appName: 'test-app',
      userId: 'user-123',
      messages: [],
      artifacts: {
        existing: { value: 'existing data' }
      },
      metadata: {
        created: new Date()
      }
    };
    
    it('should get artifact from session', () => {
      const result = getSessionArtifact(mockSession, 'existing');
      expect(result).toEqual({ value: 'existing data' });
      
      const notFound = getSessionArtifact(mockSession, 'non-existent');
      expect(notFound).toBeNull();
    });
    
    it('should set artifact in session', () => {
      const newSession = setSessionArtifact(mockSession, 'new-key', { new: 'value' });
      
      expect(newSession.artifacts['new-key']).toEqual({ new: 'value' });
      expect(newSession.artifacts['existing']).toEqual({ value: 'existing data' });
      expect(newSession).not.toBe(mockSession); // Should be immutable
    });
    
    it('should delete artifact from session', () => {
      const newSession = deleteSessionArtifact(mockSession, 'existing');
      
      expect(newSession.artifacts['existing']).toBeUndefined();
      expect(Object.keys(newSession.artifacts)).toHaveLength(0);
      expect(newSession).not.toBe(mockSession); // Should be immutable
    });
    
    it('should clear all artifacts from session', () => {
      const clearedSession = clearSessionArtifacts(mockSession);
      
      expect(Object.keys(clearedSession.artifacts)).toHaveLength(0);
      expect(clearedSession).not.toBe(mockSession); // Should be immutable
    });
    
    it('should list artifact keys from session', () => {
      const keys = listSessionArtifacts(mockSession);
      expect(keys).toEqual(['existing']);
    });
  });
  
  describe('Factory Function', () => {
    it('should create memory storage', () => {
      const storage = createArtifactStorage({
        type: 'memory',
        config: { maxSize: 1000 }
      });
      
      expect(storage).toBeDefined();
      expect(storage.get).toBeDefined();
      expect(storage.set).toBeDefined();
    });
    
    it('should throw for unimplemented storage types', () => {
      expect(() => 
        createArtifactStorage({ type: 's3' })
      ).toThrow('S3 artifact storage not yet implemented');
      
      expect(() => 
        createArtifactStorage({ type: 'gcs' })
      ).toThrow('GCS artifact storage not yet implemented');
    });
    
    it('should throw for unknown storage types', () => {
      expect(() => 
        createArtifactStorage({ type: 'unknown' as any })
      ).toThrow('Unknown artifact storage type: unknown');
    });
  });
});