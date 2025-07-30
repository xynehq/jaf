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
  withErrorHandling
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
  instructions: () => 'You are a helpful math tutor. Use the calculator tool to perform calculations and explain math concepts clearly.',
  tools: [calculatorTool],
};

const chatAgent: Agent<MyContext, string> = {
  name: 'ChatBot',
  instructions: () => 'You are a friendly chatbot. Use the greeting tool when meeting new people, and engage in helpful conversation.',
  tools: [greetingTool],
};

const assistantAgent: Agent<MyContext, string> = {
  name: 'Assistant',
  instructions: () => 'You are a general-purpose assistant. You can help with math calculations and provide greetings.',
  tools: [calculatorTool, greetingTool],
};

async function startServer() {
  console.log('🚀 Starting FAF Development Server...\n');

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

  try {
    console.log('🔧 Calling runServer...');
    // Start the server with multiple agents
    const server = await runServer(
      [mathAgent, chatAgent, assistantAgent], // Array of agents
      {
        modelProvider,
        maxTurns: 5,
        modelOverride: process.env.LITELLM_MODEL || 'gpt-3.5-turbo',
        onEvent: traceCollector.collect.bind(traceCollector),
      },
      {
        port: parseInt(process.env.PORT || '3000'),
        host: '127.0.0.1',
        cors: false
      }
    );

    console.log('\n✅ Server started successfully!');
    console.log('\n📚 Try these example requests:');
    console.log('');
    console.log('1. Health Check:');
    console.log('   curl http://localhost:3000/health');
    console.log('');
    console.log('2. List Agents:');
    console.log('   curl http://localhost:3000/agents');
    console.log('');
    console.log('3. Chat with Math Tutor:');
    console.log('   curl -X POST http://localhost:3000/chat \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"messages":[{"role":"user","content":"What is 15 * 7?"}],"agentName":"MathTutor","context":{"userId":"demo","permissions":["user"]}}\'');
    console.log('');
    console.log('4. Chat with ChatBot:');
    console.log('   curl -X POST http://localhost:3000/agents/ChatBot/chat \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"messages":[{"role":"user","content":"Hi, my name is Alice"}],"context":{"userId":"demo","permissions":["user"]}}\'');
    console.log('');
    console.log('5. Chat with Assistant:');
    console.log('   curl -X POST http://localhost:3000/chat \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"messages":[{"role":"user","content":"Calculate 25 + 17 and then greet me as Bob"}],"agentName":"Assistant","context":{"userId":"demo","permissions":["user"]}}\'');
    console.log('');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });

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