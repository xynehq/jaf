/**
 * Example usage of session providers
 */

import {
  createInMemorySessionProvider,
  createRedisSessionProvider,
  createPostgresSessionProvider,
  addMessageToSession,
  addArtifactToSession,
  getSessionStats
} from '../index.js';
import { SessionProvider, SessionContext, ContentRole } from '../../types.js';

// Example 1: In-Memory Session Provider
async function inMemoryExample() {
  console.log('=== In-Memory Session Provider Example ===');
  
  const provider = createInMemorySessionProvider();
  
  // Create a session
  const context: SessionContext = {
    appName: 'my-app',
    userId: 'user-123',
    sessionId: 'session-456'
  };
  
  let session = await provider.createSession(context);
  console.log('Created session:', session.id);
  
  // Add messages
  session = addMessageToSession(session, {
    role: ContentRole.USER,
    parts: [{ type: 'text', text: 'Hello, AI!' }]
  });
  
  session = addMessageToSession(session, {
    role: ContentRole.MODEL,
    parts: [{ type: 'text', text: 'Hello! How can I help you?' }]
  });
  
  // Add artifacts
  session = addArtifactToSession(session, 'userPreferences', {
    theme: 'dark',
    language: 'en'
  });
  
  // Update session
  await provider.updateSession(session);
  
  // Get session stats
  const stats = getSessionStats(session);
  console.log('Session stats:', stats);
  
  // List user sessions
  const sessions = await provider.listSessions('user-123');
  console.log('User has', sessions.length, 'sessions');
}

// Example 2: Redis Session Provider
async function redisExample() {
  console.log('\n=== Redis Session Provider Example ===');
  
  try {
    const provider = createRedisSessionProvider({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      keyPrefix: 'myapp:sessions:',
      ttl: 3600 // 1 hour TTL
    });
    
    // Create a session
    const context: SessionContext = {
      appName: 'redis-app',
      userId: 'redis-user-123'
    };
    
    const session = await provider.createSession(context);
    console.log('Created Redis session:', session.id);
    
    // Session will be automatically persisted to Redis
    // and will expire after 1 hour
    
  } catch (error) {
    console.error('Redis provider error:', (error as Error).message);
    console.log('Make sure Redis is installed and running');
  }
}

// Example 3: PostgreSQL Session Provider
async function postgresExample() {
  console.log('\n=== PostgreSQL Session Provider Example ===');
  
  try {
    const provider = createPostgresSessionProvider({
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost/myapp',
      tableName: 'app_sessions',
      poolSize: 10
    });
    
    // Create a session
    const context: SessionContext = {
      appName: 'postgres-app',
      userId: 'pg-user-123'
    };
    
    const session = await provider.createSession(context);
    console.log('Created PostgreSQL session:', session.id);
    
    // Session will be automatically persisted to PostgreSQL
    // Table will be created automatically if it doesn't exist
    
  } catch (error) {
    console.error('PostgreSQL provider error:', (error as Error).message);
    console.log('Make sure PostgreSQL is installed and database exists');
  }
}

// Example 4: Provider-agnostic code
async function useAnyProvider(provider: SessionProvider) {
  console.log('\n=== Provider-Agnostic Example ===');
  
  const context: SessionContext = {
    appName: 'universal-app',
    userId: 'user-789'
  };
  
  // Create session
  let session = await provider.createSession(context);
  
  // Add conversation
  session = addMessageToSession(session, {
    role: ContentRole.USER,
    parts: [{ type: 'text', text: 'What is the weather today?' }]
  });
  
  session = addMessageToSession(session, {
    role: ContentRole.MODEL,
    parts: [{ 
      type: 'function_call',
      functionCall: {
        id: 'call-123',
        name: 'getWeather',
        args: { location: 'current' }
      }
    }]
  });
  
  session = addMessageToSession(session, {
    role: ContentRole.MODEL,
    parts: [{ type: 'text', text: 'The weather today is sunny with a high of 75°F.' }]
  });
  
  // Save session
  await provider.updateSession(session);
  
  // Retrieve session
  const retrieved = await provider.getSession(session.id);
  console.log('Retrieved session with', retrieved?.messages.length, 'messages');
  
  // Clean up
  await provider.deleteSession(session.id);
  console.log('Session deleted');
}

// Run examples
async function main() {
  // Always works - no dependencies
  await inMemoryExample();
  
  // Requires Redis
  await redisExample();
  
  // Requires PostgreSQL
  await postgresExample();
  
  // Use any provider
  const provider = createInMemorySessionProvider();
  await useAnyProvider(provider);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { inMemoryExample, redisExample, postgresExample, useAnyProvider };