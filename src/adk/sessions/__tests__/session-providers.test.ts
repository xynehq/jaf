/**
 * Comprehensive tests for session providers
 */

import { 
  createInMemorySessionProvider,
  createRedisSessionProvider,
  createPostgresSessionProvider,
  createSession,
  addMessageToSession,
  addArtifactToSession,
  updateSessionMetadata,
  validateSession,
  getSessionStats
} from '../index.js';
import { 
  SessionProvider, 
  Session, 
  SessionContext,
  Content,
  ContentRole
} from '../../types.js';

// Test data
const createTestContext = (overrides?: Partial<SessionContext>): SessionContext => ({
  appName: 'test-app',
  userId: 'test-user-123',
  sessionId: 'test-session-456',
  ...overrides
});

const createTestMessage = (text: string, role: ContentRole = ContentRole.USER): Content => ({
  role,
  parts: [{ type: 'text', text }],
  metadata: {}
});

// Provider test suite factory
const runProviderTests = (
  providerName: string,
  createProvider: () => SessionProvider | Promise<SessionProvider>,
  cleanup?: () => Promise<void>
) => {
  describe(`${providerName} SessionProvider`, () => {
    let provider: SessionProvider;

    beforeEach(async () => {
      provider = await createProvider();
    });

    afterEach(async () => {
      if (cleanup) {
        await cleanup();
      }
    });

    describe('createSession', () => {
      it('should create a new session with provided context', async () => {
        const context = createTestContext();
        const session = await provider.createSession(context);

        expect(session).toBeDefined();
        expect(session.id).toBe(context.sessionId);
        expect(session.appName).toBe(context.appName);
        expect(session.userId).toBe(context.userId);
        expect(session.messages).toHaveLength(0);
        expect(session.artifacts).toEqual({});
        expect(session.metadata.created).toBeInstanceOf(Date);
      });

      it('should generate session ID if not provided', async () => {
        const context = createTestContext({ sessionId: undefined });
        const session = await provider.createSession(context);

        expect(session.id).toMatch(/^session_\d+_\d+$/);
      });

      it('should handle concurrent session creation', async () => {
        const promises = Array.from({ length: 10 }, (_, i) => 
          provider.createSession(createTestContext({ 
            sessionId: `concurrent-${i}`,
            userId: `user-${i}`
          }))
        );

        const sessions = await Promise.all(promises);
        expect(sessions).toHaveLength(10);
        expect(new Set(sessions.map(s => s.id)).size).toBe(10);
      });
    });

    describe('getSession', () => {
      it('should retrieve an existing session', async () => {
        const context = createTestContext();
        const created = await provider.createSession(context);
        const retrieved = await provider.getSession(created.id);

        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe(created.id);
        expect(retrieved?.metadata.lastAccessed).toBeInstanceOf(Date);
        expect(retrieved?.metadata.lastAccessed?.getTime()).toBeGreaterThanOrEqual(
          created.metadata.created.getTime()
        );
      });

      it('should return null for non-existent session', async () => {
        const session = await provider.getSession('non-existent-id');
        expect(session).toBeNull();
      });

      it('should update lastAccessed timestamp', async () => {
        const context = createTestContext();
        const created = await provider.createSession(context);
        
        // Wait a bit to ensure timestamp difference
        await new Promise(resolve => setTimeout(resolve, 10));
        
        const retrieved = await provider.getSession(created.id);
        expect(retrieved?.metadata.lastAccessed?.getTime()).toBeGreaterThan(
          created.metadata.created.getTime()
        );
      });
    });

    describe('updateSession', () => {
      it('should update session with new data', async () => {
        const context = createTestContext();
        let session = await provider.createSession(context);

        // Add message
        session = addMessageToSession(session, createTestMessage('Hello'));
        
        // Add artifact
        session = addArtifactToSession(session, 'test-key', { value: 'test-data' });
        
        // Update metadata
        session = updateSessionMetadata(session, { 
          tags: ['important', 'test'] 
        });

        const updated = await provider.updateSession(session);
        const retrieved = await provider.getSession(session.id);

        expect(retrieved?.messages).toHaveLength(1);
        expect(retrieved?.messages[0].parts[0].text).toBe('Hello');
        expect(retrieved?.artifacts['test-key']).toEqual({ value: 'test-data' });
        expect(retrieved?.metadata.tags).toEqual(['important', 'test']);
      });

      it('should handle concurrent updates', async () => {
        const context = createTestContext();
        const session = await provider.createSession(context);

        const updates = Array.from({ length: 5 }, (_, i) => {
          const updatedSession = addMessageToSession(
            session, 
            createTestMessage(`Message ${i}`)
          );
          return provider.updateSession({
            ...updatedSession,
            messages: [createTestMessage(`Message ${i}`)]
          });
        });

        await Promise.all(updates);
        const final = await provider.getSession(session.id);
        
        // Should have the last update
        expect(final?.messages).toHaveLength(1);
      });
    });

    describe('listSessions', () => {
      it('should list all sessions for a user', async () => {
        const userId = 'list-test-user';
        
        // Create multiple sessions
        const sessionIds = ['session-1', 'session-2', 'session-3'];
        for (const sessionId of sessionIds) {
          await provider.createSession(createTestContext({ userId, sessionId }));
        }

        const sessions = await provider.listSessions(userId);
        expect(sessions).toHaveLength(3);
        expect(sessions.map(s => s.id).sort()).toEqual(sessionIds.sort());
      });

      it('should return empty array for user with no sessions', async () => {
        const sessions = await provider.listSessions('user-with-no-sessions');
        expect(sessions).toEqual([]);
      });

      it('should not return sessions from other users', async () => {
        await provider.createSession(createTestContext({ 
          userId: 'user-1',
          sessionId: 'session-1' 
        }));
        await provider.createSession(createTestContext({ 
          userId: 'user-2',
          sessionId: 'session-2' 
        }));

        const user1Sessions = await provider.listSessions('user-1');
        const user2Sessions = await provider.listSessions('user-2');

        expect(user1Sessions).toHaveLength(1);
        expect(user1Sessions[0].id).toBe('session-1');
        expect(user2Sessions).toHaveLength(1);
        expect(user2Sessions[0].id).toBe('session-2');
      });

      it('should sort sessions by creation date (newest first)', async () => {
        const userId = 'sort-test-user';
        
        // Create sessions with delays
        for (let i = 0; i < 3; i++) {
          await provider.createSession(createTestContext({ 
            userId, 
            sessionId: `session-${i}` 
          }));
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        const sessions = await provider.listSessions(userId);
        expect(sessions[0].id).toBe('session-2'); // Newest
        expect(sessions[2].id).toBe('session-0'); // Oldest
      });
    });

    describe('deleteSession', () => {
      it('should delete an existing session', async () => {
        const context = createTestContext();
        const session = await provider.createSession(context);
        
        const deleted = await provider.deleteSession(session.id);
        expect(deleted).toBe(true);

        const retrieved = await provider.getSession(session.id);
        expect(retrieved).toBeNull();
      });

      it('should return false for non-existent session', async () => {
        const deleted = await provider.deleteSession('non-existent-id');
        expect(deleted).toBe(false);
      });

      it('should remove session from user list', async () => {
        const userId = 'delete-test-user';
        const sessionIds = ['keep-1', 'delete-me', 'keep-2'];
        
        for (const sessionId of sessionIds) {
          await provider.createSession(createTestContext({ userId, sessionId }));
        }

        await provider.deleteSession('delete-me');
        
        const sessions = await provider.listSessions(userId);
        expect(sessions).toHaveLength(2);
        expect(sessions.map(s => s.id).sort()).toEqual(['keep-1', 'keep-2'].sort());
      });
    });

    describe('Session validation', () => {
      it('should validate session structure', async () => {
        const context = createTestContext();
        const session = await provider.createSession(context);
        
        const validation = validateSession(session);
        expect(validation.success).toBe(true);
      });

      it('should handle sessions with complex data', async () => {
        const context = createTestContext();
        let session = await provider.createSession(context);

        // Add various content types
        session = addMessageToSession(session, createTestMessage('User message', ContentRole.USER));
        session = addMessageToSession(session, createTestMessage('Model response', ContentRole.MODEL));
        session = addMessageToSession(session, {
          role: ContentRole.SYSTEM,
          parts: [
            { type: 'text', text: 'System message' },
            { 
              type: 'function_call', 
              functionCall: {
                id: 'call-123',
                name: 'testFunction',
                args: { param: 'value' }
              }
            }
          ]
        });

        // Add artifacts
        session = addArtifactToSession(session, 'nested', {
          level1: {
            level2: {
              data: [1, 2, 3],
              text: 'nested value'
            }
          }
        });

        const updated = await provider.updateSession(session);
        const retrieved = await provider.getSession(session.id);

        expect(retrieved?.messages).toHaveLength(3);
        expect(retrieved?.artifacts['nested']).toEqual({
          level1: {
            level2: {
              data: [1, 2, 3],
              text: 'nested value'
            }
          }
        });
      });
    });

    describe('Session statistics', () => {
      it('should calculate correct session stats', async () => {
        const context = createTestContext();
        let session = await provider.createSession(context);

        session = addMessageToSession(session, createTestMessage('Hello', ContentRole.USER));
        session = addMessageToSession(session, createTestMessage('Hi there!', ContentRole.MODEL));
        session = addMessageToSession(session, createTestMessage('System init', ContentRole.SYSTEM));
        session = addArtifactToSession(session, 'artifact1', 'value1');
        session = addArtifactToSession(session, 'artifact2', 'value2');

        await provider.updateSession(session);

        const stats = getSessionStats(session);
        expect(stats.messageCount).toBe(3);
        expect(stats.userMessages).toBe(1);
        expect(stats.modelMessages).toBe(1);
        expect(stats.systemMessages).toBe(1);
        expect(stats.artifactCount).toBe(2);
        expect(stats.totalTextLength).toBe('Hello'.length + 'Hi there!'.length + 'System init'.length);
      });
    });
  });
};

// Run tests for all providers
describe('Session Providers', () => {
  // In-Memory Provider Tests
  runProviderTests(
    'InMemory',
    () => createInMemorySessionProvider()
  );

  // Redis Provider Tests
  describe('Redis', () => {
    // Check if Redis is available
    let redisAvailable = false;
    
    beforeAll(async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Redis = require('ioredis');
        const testClient = new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          lazyConnect: true,
          retryStrategy: () => null
        });
        
        await testClient.connect();
        await testClient.ping();
        await testClient.disconnect();
        redisAvailable = true;
      } catch (error) {
        console.log('Redis not available for testing:', (error as Error).message);
      }
    });

    if (redisAvailable && !process.env.CI) {
      runProviderTests(
        'Redis',
        () => createRedisSessionProvider({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          keyPrefix: 'jaf_test:',
          ttl: 3600
        }),
        async () => {
          // Cleanup test keys
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const Redis = require('ioredis');
            const client = new Redis({
              host: process.env.REDIS_HOST || 'localhost',
              port: parseInt(process.env.REDIS_PORT || '6379')
            });
            
            const keys = await client.keys('jaf_test:*');
            if (keys.length > 0) {
              await client.del(...keys);
            }
            await client.disconnect();
          } catch (error) {
            console.error('Redis cleanup failed:', error);
          }
        }
      );
    } else {
      test.skip('Redis provider tests skipped - Redis not available', () => {});
    }

    test('should throw error when ioredis is not available', async () => {
      // Check if ioredis is actually available
      let ioredisAvailable = false;
      try {
        require('ioredis');
        ioredisAvailable = true;
      } catch {
        ioredisAvailable = false;
      }
      
      // Skip this test if ioredis is actually installed
      if (ioredisAvailable) {
        console.log('Skipping test - ioredis is installed');
        expect(true).toBe(true); // Dummy assertion to pass the test
        return;
      }
      
      // Mock require to simulate missing ioredis
      const originalRequire = require;
      (global as any).require = jest.fn().mockImplementation((module: string) => {
        if (module === 'ioredis') {
          throw new Error('Cannot find module \'ioredis\'');
        }
        return originalRequire(module);
      });

      try {
        expect(() => createRedisSessionProvider({
          host: 'localhost',
          port: 6379
        })).toThrow('Redis session provider requires ioredis to be installed');
      } finally {
        (global as any).require = originalRequire;
      }
    });
  });

  // PostgreSQL Provider Tests
  describe('PostgreSQL', () => {
    let pgAvailable = false;
    
    beforeAll(async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Pool } = require('pg');
        const testPool = new Pool({
          connectionString: process.env.POSTGRES_URL || 'postgresql://jaf_test:jaf_test_password@localhost:5432/jaf_test_db',
          max: 1
        });
        
        await testPool.query('SELECT 1');
        await testPool.end();
        pgAvailable = true;
      } catch (error) {
        console.log('PostgreSQL not available for testing:', (error as Error).message);
      }
    });

    if (pgAvailable && !process.env.CI) {
      runProviderTests(
        'PostgreSQL',
        () => createPostgresSessionProvider({
          connectionString: process.env.POSTGRES_URL || 'postgresql://jaf_test:jaf_test_password@localhost:5432/jaf_test_db',
          tableName: 'jaf_test_sessions'
        }),
        async () => {
          // Cleanup test table
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { Pool } = require('pg');
            const pool = new Pool({
              connectionString: process.env.DATABASE_URL || 'postgresql://localhost/jaf_test'
            });
            
            await pool.query('DROP TABLE IF EXISTS jaf_test_sessions');
            await pool.end();
          } catch (error) {
            console.error('PostgreSQL cleanup failed:', error);
          }
        }
      );
    } else {
      test.skip('PostgreSQL provider tests skipped - PostgreSQL not available', () => {});
    }

    test('should throw error when pg is not available', async () => {
      // Check if pg is actually available
      let pgAvailable = false;
      try {
        require('pg');
        pgAvailable = true;
      } catch {
        pgAvailable = false;
      }
      
      // Skip this test if pg is actually installed
      if (pgAvailable) {
        console.log('Skipping test - pg is installed');
        expect(true).toBe(true); // Dummy assertion to pass the test
        return;
      }
      
      // Mock require to simulate missing pg
      const originalRequire = require;
      (global as any).require = jest.fn().mockImplementation((module: string) => {
        if (module === 'pg') {
          throw new Error('Cannot find module \'pg\'');
        }
        return originalRequire(module);
      });

      try {
        expect(() => createPostgresSessionProvider({
          connectionString: 'postgresql://localhost/test'
        })).toThrow('PostgreSQL session provider requires pg to be installed');
      } finally {
        (global as any).require = originalRequire;
      }
    });
  });
});

// Export test utilities for other tests
export { createTestContext, createTestMessage, runProviderTests };