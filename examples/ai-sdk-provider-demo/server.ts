/**
 * JAF Server with OpenAI provider and calculator tool
 * Uses the JAF server infrastructure with conversation management
 * 
 * Usage:
 * 1. Start conversation: POST /chat with { messages: [{"role":"user","content":"What is 2+3?"}], agentName: "CalculatorAgent" }
 * 2. Continue conversation: POST /chat with conversationId to maintain session
 */

import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';
import {
  runServer,
  ToolResponse,
  ToolErrorCodes,
  withErrorHandling,
  Tool,
  Agent,
  RunConfig,
  createSimpleMemoryProvider
} from '@xynehq/jaf';
import { createAiSdkProvider } from '@xynehq/jaf/providers';
import { z } from 'zod';

if (!process.env.OPENAI_API_KEY) {
  console.error('❌ Missing OPENAI_API_KEY environment variable');
  console.log('💡 Please set OPENAI_API_KEY in your .env file');
  process.exit(1);
}

// OpenAI setup
const openai = createOpenAI();
const modelProvider = createAiSdkProvider(openai.chat('gpt-4o'));

// Calculator tool
const calculatorTool: Tool<{ expression: string }, null> = {
  schema: {
    name: "calculate",
    description: "Perform mathematical calculations",
    parameters: z.object({
      expression: z.string().describe("Math expression to evaluate (e.g., '2 + 2', '10 * 5')")
    }),
  },
  execute: withErrorHandling('calculate', async (args: { expression: string }, context: null) => {
    // Basic safety check - only allow simple math expressions
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
      // Safe evaluation - replace with proper math parser for production
      const result = Function('"use strict"; return (' + args.expression + ')')();
      return ToolResponse.success(`${args.expression} = ${result}`, {
        originalExpression: args.expression,
        result: result.toString(),
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

// Agent definition
const calculatorAgent: Agent<any, any> = {
  name: 'CalculatorAgent',
  instructions: () => 'You are a helpful calculator assistant. Help users with mathematical calculations and remember previous results in the conversation.',
  modelConfig: {
    name: 'gpt-4o',
    maxTokens: 1024,
  },
  tools: [calculatorTool],
};

// Run configuration
const runConfig: Omit<RunConfig<any>, 'agentRegistry'> = {
  modelProvider,
  maxTurns: 10,
};

// Start the server
async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '127.0.0.1';

  try {
    console.log('🚀 Starting JAF Calculator Server...');
    
    // Create memory provider for conversation persistence
    console.log('📝 Setting up in-memory conversation storage...');
    const memoryProvider = await createSimpleMemoryProvider('memory');
    
    const server = await runServer(
      [calculatorAgent], // agents array
      runConfig,        // run configuration
      {                 // server options
        port: PORT,
        host: HOST,
        cors: true,
        defaultMemoryProvider: memoryProvider
      }
    );

    console.log(`\n🎯 JAF Calculator Server running on http://${HOST}:${PORT}`);
    console.log('✅ In-memory conversation storage enabled');
    console.log('\n📋 Available endpoints:');
    console.log(`  GET  http://${HOST}:${PORT}/health - Health check`);
    console.log(`  GET  http://${HOST}:${PORT}/agents - List available agents`);
    console.log(`  POST http://${HOST}:${PORT}/chat - Start/continue conversation`);
    console.log(`  POST http://${HOST}:${PORT}/agents/CalculatorAgent/chat - Agent-specific chat`);
    console.log(`  GET  http://${HOST}:${PORT}/memory/health - Memory provider health`);
    console.log(`  GET  http://${HOST}:${PORT}/conversations/:id - Get conversation history`);
    console.log(`  DELETE http://${HOST}:${PORT}/conversations/:id - Delete conversation`);
    
    console.log('\n💡 Example usage:');
    console.log('# Start new conversation:');
    console.log(`curl -X POST http://${HOST}:${PORT}/chat \\`);
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"messages":[{"role":"user","content":"What is 5+3?"}],"agentName":"CalculatorAgent"}\'');
    
    console.log('\n# Continue conversation (use conversationId from previous response):');
    console.log(`curl -X POST http://${HOST}:${PORT}/chat \\`);
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"messages":[{"role":"user","content":"What was that result again?"}],"agentName":"CalculatorAgent","conversationId":"conv-xxxxx"}\'');

    console.log('\n# Simplified agent-specific endpoint:');
    console.log(`curl -X POST http://${HOST}:${PORT}/agents/CalculatorAgent/chat \\`);
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"messages":[{"role":"user","content":"Calculate 10*7"}]}\'');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down server...');
      await server.stop();
      console.log('✅ Server stopped gracefully');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Shutting down server...');
      await server.stop();
      console.log('✅ Server stopped gracefully');
      process.exit(0);
    });

    return server;
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer().catch(error => {
  console.error('❌ Server startup error:', error);
  process.exit(1);
});