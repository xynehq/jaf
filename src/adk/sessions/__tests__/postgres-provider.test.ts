/**
 * Unit tests for PostgreSQL Session Provider
 */

import { createPostgresSessionProvider } from '../postgres-provider.js';
import { SessionProvider } from '../../types.js';

describe('PostgreSQL Session Provider', () => {
  describe('Module Loading', () => {
    it('should throw error when pg is not installed', () => {
      // Mock require to simulate missing module
      const originalRequire = require;
      const mockRequire = jest.fn().mockImplementation((module: string) => {
        if (module === 'pg') {
          throw new Error("Cannot find module 'pg'");
        }
        return originalRequire(module);
      });
      
      // Replace global require
      (global as any).require = mockRequire;
      
      try {
        expect(() => {
          createPostgresSessionProvider({
            connectionString: 'postgresql://localhost/test'
          });
        }).toThrow('PostgreSQL session provider requires pg to be installed');
      } finally {
        // Restore original require
        (global as any).require = originalRequire;
      }
    });
  });

  describe('Configuration', () => {
    // Skip if pg not available
    let pgAvailable = false;
    
    try {
      require('pg');
      pgAvailable = true;
    } catch {
      // pg not available
    }

    (pgAvailable ? it : it.skip)('should accept custom configuration', () => {
      const config = {
        connectionString: 'postgresql://user:password@host:5432/database',
        tableName: 'custom_sessions',
        poolSize: 20,
        idleTimeoutMillis: 60000,
        connectionTimeoutMillis: 5000
      };

      expect(() => createPostgresSessionProvider(config)).not.toThrow();
    });

    (pgAvailable ? it : it.skip)('should use default values for optional config', () => {
      const config = {
        connectionString: 'postgresql://localhost/test'
      };

      expect(() => createPostgresSessionProvider(config)).not.toThrow();
    });
  });

  describe('Utility Functions', () => {
    let pgAvailable = false;
    
    try {
      require('pg');
      pgAvailable = true;
    } catch {
      // pg not available
    }

    (pgAvailable ? it : it.skip)('should have utility functions exported', async () => {
      const { closePostgresPool, getPoolStats, migrateFromRedisToPostgres } = await import('../postgres-provider.js');
      
      expect(closePostgresPool).toBeDefined();
      expect(getPoolStats).toBeDefined();
      expect(migrateFromRedisToPostgres).toBeDefined();
      expect(typeof closePostgresPool).toBe('function');
      expect(typeof getPoolStats).toBe('function');
      expect(typeof migrateFromRedisToPostgres).toBe('function');
    });
  });

  describe('Migration Helper', () => {
    it('should provide migration helper function', async () => {
      const { migrateFromRedisToPostgres } = await import('../postgres-provider.js');
      
      // Mock providers
      const mockRedisProvider: SessionProvider = {
        createSession: jest.fn(),
        getSession: jest.fn(),
        updateSession: jest.fn(),
        listSessions: jest.fn().mockResolvedValue([]),
        deleteSession: jest.fn()
      };
      
      const mockPostgresProvider: SessionProvider = {
        createSession: jest.fn(),
        getSession: jest.fn(),
        updateSession: jest.fn(),
        listSessions: jest.fn(),
        deleteSession: jest.fn()
      };
      
      const result = await migrateFromRedisToPostgres(
        mockRedisProvider,
        mockPostgresProvider,
        ['user1', 'user2']
      );
      
      expect(result).toHaveProperty('migrated');
      expect(result).toHaveProperty('errors');
      expect(result.migrated).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });
});