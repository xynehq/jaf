import 'dotenv/config';
import { z } from 'zod';
import { 
  runServer, 
  Tool, 
  Agent, 
  makeLiteLLMProvider,
  ConsoleTraceCollector,
  ToolResponse,
  ToolErrorCodes,
  withErrorHandling,
  createMemoryProviderFromEnv
} from 'functional-agent-framework';

// Define context type
type MyContext = {
  userId: string;
  permissions: string[];
};

// Create a simple calculator tool with standardized error handling
const calculatorTool: Tool<{ expression: string }, MyContext> = {
  schema: {
    name: "calculate",
    description: "Perform mathematical calculations",
    parameters: z.object({
      expression: z.string().describe("Math expression to evaluate (e.g., '2 + 2', '10 * 5')")
    }),
  },
  execute: withErrorHandling('calculate', async (args: { expression: string }, context: MyContext) => {
    // Basic safety check - only allow simple math expressions (including spaces)
    const sanitized = args.expression.replace(/[^0-9+\-*/().\s]/g, '');
    if (sanitized !== args.expression) {
      return ToolResponse.validationError(
        "Invalid characters in expression. Only numbers, +, -, *, /, (, ), and spaces are allowed.",
        { 
          originalExpression: args.expression,
          sanitizedExpression: sanitized,
          invalidCharacters: args.expression.replace(/[0-9+\-*/().\s]/g, '')
        }
      );
    }
    
    try {
      const result = eval(sanitized);
      return ToolResponse.success(`${args.expression} = ${result}`, {
        originalExpression: args.expression,
        result,
        calculationType: 'arithmetic'
      });
    } catch (evalError) {
      return ToolResponse.error(
        ToolErrorCodes.EXECUTION_FAILED,
        `Failed to evaluate expression: ${evalError instanceof Error ? evalError.message : 'Unknown error'}`,
        { 
          expression: args.expression,
          evalError: evalError instanceof Error ? evalError.message : evalError
        }
      );
    }
  }),
};

// Create a greeting tool with standardized error handling
const greetingTool: Tool<{ name: string }, MyContext> = {
  schema: {
    name: "greet",
    description: "Generate a personalized greeting",
    parameters: z.object({
      name: z.string().describe("Name of the person to greet")
    }),
  },
  execute: withErrorHandling('greet', async (args: { name: string }, context: MyContext) => {
    // Validate name input
    if (!args.name || args.name.trim().length === 0) {
      return ToolResponse.validationError("Name cannot be empty", { providedName: args.name });
    }
    
    // Check for extremely long names (potential abuse)
    if (args.name.length > 100) {
      return ToolResponse.validationError("Name is too long (max 100 characters)", { 
        nameLength: args.name.length,
        maxLength: 100 
      });
    }
    
    const greeting = `Hello, ${args.name.trim()}! Nice to meet you. I'm a helpful AI assistant running on the FAF framework.`;
    
    return ToolResponse.success(greeting, {
      greetedName: args.name.trim(),
      greetingType: 'personal'
    });
  }),
};

// Define agents
const mathAgent: Agent<MyContext, string> = {
  name: 'MathTutor',
  instructions: () => 'You are a helpful math tutor with access to conversation history. Use the calculator tool to perform calculations and explain math concepts clearly. You can reference previous calculations and questions from our conversation.',
  tools: [calculatorTool],
};

const chatAgent: Agent<MyContext, string> = {
  name: 'ChatBot',
  instructions: () => 'You are a friendly chatbot. Use the greeting tool when meeting new people, and engage in helpful conversation.',
  tools: [greetingTool],
};

const assistantAgent: Agent<MyContext, string> = {
  name: 'Assistant',
  instructions: () => 'You are a general-purpose assistant with access to conversation history. You can help with math calculations and provide greetings. You can reference previous messages and calculations from our conversation.',
  tools: [calculatorTool, greetingTool],
};

async function startServer() {
  console.log('🚀 Starting FAF Development Server (Functional)...\n');

  // Check if LiteLLM configuration is provided
  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000';
  const litellmApiKey = process.env.LITELLM_API_KEY;
  
  console.log(`📡 LiteLLM URL: ${litellmUrl}`);
  console.log(`🔑 API Key: ${litellmApiKey ? 'Set' : 'Not set'}`);
  console.log(`⚠️  Note: Chat endpoints will fail without a running LiteLLM server\n`);

  // Set up model provider (you'll need a LiteLLM server running)
  const modelProvider = makeLiteLLMProvider(litellmUrl, litellmApiKey) as any;

  // Set up tracing
  const traceCollector = new ConsoleTraceCollector();

  // Set up memory provider based on environment configuration
  console.log('🔧 Setting up memory provider...');
  const memoryType = process.env.FAF_MEMORY_TYPE || 'memory';
  console.log(`💾 Memory provider type: ${memoryType}`);

  let externalClients: { redis?: any; postgres?: any } = {};

  // Set up external clients based on memory type
  if (memoryType === 'redis') {
    console.log('🔗 Setting up Redis client...');
    try {
      const { createClient } = await import('redis');
      const redisClient = createClient({
        url: process.env.FAF_REDIS_URL || `redis://${process.env.FAF_REDIS_HOST || 'localhost'}:${process.env.FAF_REDIS_PORT || '6379'}`,
        password: process.env.FAF_REDIS_PASSWORD,
        database: parseInt(process.env.FAF_REDIS_DB || '0')
      });
      await redisClient.connect();
      externalClients.redis = redisClient;
      console.log('✅ Redis client connected');
    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error);
      console.log('📋 Make sure Redis is running and accessible');
      console.log('🔧 Install Redis client: npm install redis');
      process.exit(1);
    }
  } else if (memoryType === 'postgres') {
    console.log('🔗 Setting up PostgreSQL client...');
    try {
      const { Client } = await import('pg');
      const postgresClient = new Client({
        connectionString: process.env.FAF_POSTGRES_CONNECTION_STRING,
        host: process.env.FAF_POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.FAF_POSTGRES_PORT || '5432'),
        database: process.env.FAF_POSTGRES_DB || 'faf_memory',
        user: process.env.FAF_POSTGRES_USER || 'postgres',
        password: process.env.FAF_POSTGRES_PASSWORD,
        ssl: process.env.FAF_POSTGRES_SSL === 'true'
      });
      await postgresClient.connect();
      externalClients.postgres = postgresClient;
      console.log('✅ PostgreSQL client connected');
    } catch (error) {
      console.error('❌ Failed to connect to PostgreSQL:', error);
      console.log('📋 Make sure PostgreSQL is running and accessible');
      console.log('🔧 Install PostgreSQL client: npm install pg @types/pg');
      process.exit(1);
    }
  }

  // Create memory provider using environment configuration
  const memoryProvider = await createMemoryProviderFromEnv(externalClients);
  console.log(`✅ Memory provider (${memoryType}) initialized successfully`);

  try {
    console.log('🔧 Calling runServer...');
    // Create and start the server with multiple agents using functional approach
    const server = await runServer(
      [mathAgent, chatAgent, assistantAgent], // Array of agents
      {
        modelProvider,
        maxTurns: 5,
        modelOverride: process.env.LITELLM_MODEL || 'gpt-3.5-turbo',
        onEvent: traceCollector.collect.bind(traceCollector),
        memory: {
          provider: memoryProvider,
          autoStore: true, // Automatically store conversation history
          maxMessages: 100 // Keep last 100 messages per conversation
        }
      },
      {
        port: parseInt(process.env.PORT || '3000'),
        host: '127.0.0.1',
        cors: false,
        defaultMemoryProvider: memoryProvider // Set memory provider on server config
      }
    );

    // Server is already started by runServer

    console.log('\n✅ Server started successfully!');
    console.log('\n📚 Try these example requests:');
    console.log('');
    console.log('1. Health Check:');
    console.log('   curl http://localhost:3000/health');
    console.log('');
    console.log('2. List Agents:');
    console.log('   curl http://localhost:3000/agents');
    console.log('');
    console.log('3. Memory Health Check:');
    console.log('   curl http://localhost:3000/memory/health');
    console.log('');
    console.log('4. Chat with Math Tutor (with conversation memory):');
    console.log('   curl -X POST http://localhost:3000/chat \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"messages":[{"role":"user","content":"What is 15 * 7?"}],"conversationId":"demo-conversation-1","agentName":"MathTutor","context":{"userId":"demo","permissions":["user"]}}\'');
    console.log('');
    console.log('5. Continue conversation (shows memory persistence):');
    console.log('   curl -X POST http://localhost:3000/chat \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"messages":[{"role":"user","content":"What was my previous calculation?"}],"conversationId":"demo-conversation-1","agentName":"MathTutor","context":{"userId":"demo","permissions":["user"]}}\'');
    console.log('');
    console.log('6. Chat with ChatBot:');
    console.log('   curl -X POST http://localhost:3000/agents/ChatBot/chat \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"messages":[{"role":"user","content":"Hi, my name is Alice"}],"conversationId":"demo-conversation-2","context":{"userId":"demo","permissions":["user"]}}\'');
    console.log('');
    console.log('7. Chat with Assistant (multi-tool with memory):');
    console.log('   curl -X POST http://localhost:3000/chat \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"messages":[{"role":"user","content":"Calculate 25 + 17 and then greet me as Bob"}],"conversationId":"demo-conversation-3","agentName":"Assistant","context":{"userId":"demo","permissions":["user"]}}\'');
    console.log('');
    console.log('💡 Tips:');
    console.log('   - Include conversationId in requests to maintain conversation history');
    console.log('   - If no conversationId provided, server will generate one and return it');
    console.log('   - Use the returned conversationId for follow-up requests');
    console.log('');
    console.log('🔧 Memory Provider Configuration:');
    console.log(`   Current provider: ${memoryType}`);
    console.log('   Available providers:');
    console.log('   - memory (default): FAF_MEMORY_TYPE=memory');
    console.log('   - Redis: FAF_MEMORY_TYPE=redis');
    console.log('     • FAF_REDIS_HOST, FAF_REDIS_PORT, FAF_REDIS_PASSWORD, FAF_REDIS_DB');
    console.log('   - PostgreSQL: FAF_MEMORY_TYPE=postgres');
    console.log('     • FAF_POSTGRES_HOST, FAF_POSTGRES_PORT, FAF_POSTGRES_DB');
    console.log('     • FAF_POSTGRES_USER, FAF_POSTGRES_PASSWORD, FAF_POSTGRES_SSL');
    console.log('');

    // Handle graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
      await server.stop();
      
      // Close external clients
      if (externalClients.redis) {
        console.log('🔌 Closing Redis connection...');
        await externalClients.redis.quit();
      }
      if (externalClients.postgres) {
        console.log('🔌 Closing PostgreSQL connection...');
        await externalClients.postgres.end();
      }
      
      console.log('✅ Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('❌ Unhandled error in startServer:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  });
}