import 'dotenv/config';
import { 
  createMem0Provider,
  Message
} from '@xynehq/jaf';
import { MemoryClient } from 'mem0ai';

// Mock Mem0 client for demonstration
class MockMem0Client {
  private memories: Array<{ id: string; content: string; metadata?: any; score?: number }> = [];
  private idCounter = 1;

  async search(query: string, options?: {
    user_id?: string;
    limit?: number;
  }) {
    console.log(`[MockMem0] Searching for "${query}" for user ${options?.user_id}`);
    
    // Simple mock search - find memories containing query keywords
    const queryWords = query.toLowerCase().split(' ');
    const results = this.memories
      .filter(memory => 
        queryWords.some(word => memory.content.toLowerCase().includes(word))
      )
      .map(memory => ({
        id: memory.id,
        memory: memory.content,
        metadata: memory.metadata,
        score: Math.random() * 0.5 + 0.5 // Random score between 0.5-1.0
      }))
      .slice(0, options?.limit || 10);

    return results;
  }

  async add(messages: Array<{ role: string; content: string }>, options?: {
    user_id?: string;
    metadata?: any;
  }) {
    const content = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    const id = `mem_${this.idCounter++}`;
    
    console.log(`[MockMem0] Adding memory with ID ${id} for user ${options?.user_id}`);
    
    this.memories.push({
      id,
      content,
      metadata: options?.metadata
    });

    return [{
      id,
      memory: content,
      metadata: options?.metadata
    }];
  }

  async updateProject(options: { custom_instructions: string }) {
    console.log(`[MockMem0] Updated project instructions: ${options.custom_instructions}`);
    return { success: true };
  }

  async ping() {
    return { status: 'healthy' };
  }
}

async function demonstrateMem0Memory() {
  console.log('\n🧠 JAF Mem0 Memory Provider Demo');
  console.log('=================================');
  console.log('Testing searchMemory and addToMemory functionality\n');

  // Create real Mem0 client with hardcoded API key
  const mem0Client = new MemoryClient({ 
    apiKey: 'm0-41OlZmrBayD4gvHRxtJzTS80TqvGAQGf8BPI1DVx' 
  });
  
  // Create Mem0 provider
  const memoryProvider = await createMem0Provider({
    type: 'mem0',
    apiKey: 'm0-41OlZmrBayD4gvHRxtJzTS80TqvGAQGf8BPI1DVx',
    baseUrl: 'https://api.mem0.ai',
    timeout: 30000,
    maxRetries: 3
  }, mem0Client);

  const testUserId = 'demo-user@example.com';

  console.log('1. Testing addToMemory functionality');
  console.log('====================================');

  // Test adding memories
  const memoriesToAdd = [
    "The user prefers Python for machine learning projects and uses PyTorch",
    "The user works at a tech startup focused on AI/ML solutions",
    "The user is interested in distributed systems and microservices architecture",
    "The user likes to use TypeScript for backend development"
  ];

  for (const memory of memoriesToAdd) {
    console.log(`\n📝 Adding memory: "${memory}"`);
    const result = await (memoryProvider as any).addToMemory(
      memory,
      testUserId,
      "Remember user preferences and background for personalized responses",
      { source: 'demo', category: 'preference' }
    );
    
    if (result.success) {
      console.log(`✅ Success: ${result.summary}`);
      console.log(`   Memory ID: ${result.memory_id}`);
    } else {
      console.log(`❌ Failed: ${result.error}`);
    }
  }

  console.log('\n\n2. Testing searchMemory functionality');
  console.log('=====================================');

  // Test searching memories
  const searchQueries = [
    "programming languages",
    "Python",
    "work experience",
    "backend development",
    "machine learning"
  ];

  for (const query of searchQueries) {
    console.log(`\n🔍 Searching for: "${query}"`);
    const searchResult = await (memoryProvider as any).searchMemory(query, testUserId, 5);
    
    if ('memories' in searchResult && searchResult.memories.length > 0) {
      console.log(`✅ Found ${searchResult.total_results} memories (${searchResult.search_time_ms}ms):`);
      searchResult.memories.forEach((memory: any, index: number) => {
        console.log(`   ${index + 1}. [Score: ${memory.score?.toFixed(2)}] ${memory.content}`);
        if (memory.metadata) {
          console.log(`      Metadata: ${JSON.stringify(memory.metadata)}`);
        }
      });
    } else if ('error' in searchResult) {
      console.log(`❌ Search failed: ${searchResult.error}`);
    } else {
      console.log(`ℹ️  No memories found for "${query}"`);
    }
  }

  console.log('\n\n3. Testing health check');
  console.log('=======================');

  const healthResult = await memoryProvider.healthCheck();
  if (healthResult.success) {
    const health = healthResult.data;
    console.log(`✅ Health check: ${health.healthy ? 'HEALTHY' : 'UNHEALTHY'}`);
    if (health.latencyMs) {
      console.log(`   Latency: ${health.latencyMs}ms`);
    }
    if (health.error) {
      console.log(`   Error: ${health.error}`);
    }
  } else {
    console.log(`❌ Health check failed: ${healthResult.error.message}`);
  }

  console.log('\n\n4. Testing conversation storage');
  console.log('===============================');

  // Test standard memory provider functionality
  const conversationId = `mem0-demo-${Date.now()}`;
  const testMessages: Message[] = [
    { role: 'user', content: 'Hello, I need help with a Python ML project' },
    { role: 'assistant', content: 'I can help with that! What kind of ML project are you working on?' },
    { role: 'user', content: 'I want to build a recommendation system using PyTorch' }
  ];

  console.log(`\n💬 Storing conversation: ${conversationId}`);
  const storeResult = await memoryProvider.storeMessages(
    conversationId, 
    testMessages,
    { userId: testUserId, source: 'demo' }
  );

  if (storeResult.success) {
    console.log('✅ Messages stored successfully');
    
    // Retrieve the conversation
    const getResult = await memoryProvider.getConversation(conversationId);
    if (getResult.success && getResult.data) {
      console.log(`📖 Retrieved conversation with ${getResult.data.messages.length} messages`);
      console.log(`   User ID: ${getResult.data.userId}`);
      console.log(`   Metadata: ${JSON.stringify(getResult.data.metadata, null, 2)}`);
    }
  } else {
    console.log(`❌ Failed to store messages: ${storeResult.error.message}`);
  }

  // Close the provider
  await memoryProvider.close();

  console.log('\n🎉 Mem0 Demo Completed!');
  console.log('\n📊 Demo Summary:');
  console.log('- ✅ Mem0 provider initialization');
  console.log('- ✅ addToMemory functionality');
  console.log('- ✅ searchMemory with semantic queries');
  console.log('- ✅ Health check monitoring');
  console.log('- ✅ Standard conversation storage');
  console.log('- ✅ Provider cleanup');
  console.log('\n🔗 Integration Features:');
  console.log('- AI-powered semantic memory search');
  console.log('- Automatic memory extraction from conversations');
  console.log('- Custom metadata and instructions support');
  console.log('- Robust error handling and timeouts');
  console.log('- JAF memory provider interface compliance');
}

// Main execution
async function main() {
  console.log('🚀 Starting JAF Mem0 Memory Demo...\n');
  
  try {
    await demonstrateMem0Memory();
  } catch (error) {
    console.error('\n❌ Demo failed with error:');
    console.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}