/**
 * Unit tests for Redis Session Provider
 */

import { createRedisSessionProvider } from '../redis-provider.js';
import { SessionProvider } from '../../types.js';

describe('Redis Session Provider', () => {
  describe('Module Loading', () => {
    it('should throw error when ioredis is not installed', () => {
      // Mock require to simulate missing module
      const originalRequire = require;
      const mockRequire = jest.fn().mockImplementation((module: string) => {
        if (module === 'ioredis') {
          throw new Error("Cannot find module 'ioredis'");
        }
        return originalRequire(module);
      });
      
      // Replace global require
      (global as any).require = mockRequire;
      
      try {
        expect(() => {
          createRedisSessionProvider({
            host: 'localhost',
            port: 6379
          });
        }).toThrow('Redis session provider requires ioredis to be installed');
      } finally {
        // Restore original require
        (global as any).require = originalRequire;
      }
    });
  });

  describe('Configuration', () => {
    // Skip if ioredis not available
    let ioredisAvailable = false;
    
    try {
      require('ioredis');
      ioredisAvailable = true;
    } catch {
      // ioredis not available
    }

    (ioredisAvailable ? it : it.skip)('should accept custom configuration', () => {
      const config = {
        host: 'custom-host',
        port: 6380,
        password: 'secret',
        database: 2,
        keyPrefix: 'myapp:',
        ttl: 7200
      };

      expect(() => createRedisSessionProvider(config)).not.toThrow();
    });

    (ioredisAvailable ? it : it.skip)('should use default values for optional config', () => {
      const config = {
        host: 'localhost',
        port: 6379
      };

      expect(() => createRedisSessionProvider(config)).not.toThrow();
    });
  });

  describe('Connection Utility Functions', () => {
    let ioredisAvailable = false;
    
    try {
      require('ioredis');
      ioredisAvailable = true;
    } catch {
      // ioredis not available
    }

    (ioredisAvailable ? it : it.skip)('should have utility functions exported', async () => {
      const { closeRedisConnection, pingRedis } = await import('../redis-provider.js');
      
      expect(closeRedisConnection).toBeDefined();
      expect(pingRedis).toBeDefined();
      expect(typeof closeRedisConnection).toBe('function');
      expect(typeof pingRedis).toBe('function');
    });
  });
});