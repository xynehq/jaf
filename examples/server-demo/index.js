"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const functional_agent_framework_1 = require("functional-agent-framework");
// Create a simple calculator tool
const calculatorTool = {
    schema: {
        name: "calculate",
        description: "Perform mathematical calculations",
        parameters: zod_1.z.object({
            expression: zod_1.z.string().describe("Math expression to evaluate (e.g., '2 + 2', '10 * 5')")
        }),
    },
    execute: async (args, context) => {
        try {
            // Use safe math evaluator instead of eval
            const { evaluateMathExpression } = require('../../src/utils/safe-math');
            const result = evaluateMathExpression(args.expression);
            return `${args.expression} = ${result}`;
        }
        catch (error) {
            return `Error calculating ${args.expression}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    },
};
// Create a greeting tool
const greetingTool = {
    schema: {
        name: "greet",
        description: "Generate a personalized greeting",
        parameters: zod_1.z.object({
            name: zod_1.z.string().describe("Name of the person to greet")
        }),
    },
    execute: async (args, context) => {
        return `Hello, ${args.name}! Nice to meet you. I'm a helpful AI assistant running on the FAF framework.`;
    },
};
// Define agents
const mathAgent = {
    name: 'MathTutor',
    instructions: () => 'You are a helpful math tutor. Use the calculator tool to perform calculations and explain math concepts clearly.',
    tools: [calculatorTool],
};
const chatAgent = {
    name: 'ChatBot',
    instructions: () => 'You are a friendly chatbot. Use the greeting tool when meeting new people, and engage in helpful conversation.',
    tools: [greetingTool],
};
const assistantAgent = {
    name: 'Assistant',
    instructions: () => 'You are a general-purpose assistant. You can help with math calculations and provide greetings.',
    tools: [calculatorTool, greetingTool],
};
async function startServer() {
    console.log('🚀 Starting FAF Development Server...\n');
    // Set up model provider (you'll need a LiteLLM server running)
    const modelProvider = (0, functional_agent_framework_1.makeLiteLLMProvider)(process.env.LITELLM_URL || 'http://localhost:4000', process.env.LITELLM_API_KEY); // Type assertion to handle generic constraints
    // Set up tracing
    const traceCollector = new functional_agent_framework_1.ConsoleTraceCollector();
    try {
        // Start the server with multiple agents
        const server = await (0, functional_agent_framework_1.runServer)([mathAgent, chatAgent, assistantAgent], // Array of agents
        {
            modelProvider,
            maxTurns: 5,
            modelOverride: process.env.LITELLM_MODEL || 'gpt-3.5-turbo',
            onEvent: traceCollector.collect.bind(traceCollector),
        }, {
            port: parseInt(process.env.PORT || '3000'),
            host: '0.0.0.0',
            cors: true
        });
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
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}
if (require.main === module) {
    startServer().catch(console.error);
}
//# sourceMappingURL=index.js.map