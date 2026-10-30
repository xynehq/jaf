/**
 * Complete example of A2A server with JAF integration
 * Shows how to set up multiple agents with A2A protocol support
 */

import { createWeatherAgent } from './weather-agent.js';
import { startA2AServer } from '../server.js';
import type { A2AServerConfig } from '../types.js';
import { createA2AAgent, createA2ATool } from '../agent.js';
import { z } from 'zod';
import { evaluateMathExpression } from '../../utils/safe-math.js';
import { isMainScript } from '../../utils/is-main-script.js';

// Create a simple calculator agent
const createCalculatorAgent = () => createA2AAgent({
  name: 'calculator_assistant',
  description: 'Mathematical calculations and problem solving',
  instruction: 'You are a calculator assistant. Help users with mathematical calculations and provide step-by-step solutions.',
  
  tools: [
    createA2ATool({
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: z.object({
        expression: z.string().describe('Mathematical expression to evaluate'),
        showSteps: z.boolean().default(false).describe('Show calculation steps')
      }),
      execute: async ({ expression, showSteps }) => {
        try {
          // Use safe math evaluator instead of eval
          const result = evaluateMathExpression(expression);
          
          if (showSteps) {
            return `Calculation: ${expression}\n` +
                   `Result: ${result}`;
          } else {
            return `${expression} = ${result}`;
          }
        } catch (error) {
          return `Error calculating "${expression}": Invalid mathematical expression`;
        }
      }
    }),
    
    createA2ATool({
      name: 'solve_equation',
      description: 'Solve algebraic equations',
      parameters: z.object({
        equation: z.string().describe('Equation to solve (e.g., "2x + 5 = 15")'),
        variable: z.string().default('x').describe('Variable to solve for')
      }),
      execute: async ({ equation, variable }) => {
        // Simplified equation solver for demonstration
        if (equation.includes('x') && equation.includes('=')) {
          return `Solution for ${equation}:\n` +
                 `This is a demonstration. In a real implementation, this would solve for ${variable}.\n` +
                 `Example: If 2x + 5 = 15, then x = 5`;
        }
        return `Please provide a valid equation with variable ${variable}`;
      }
    })
  ]
});

// Create a simple greeting agent
const createGreetingAgent = () => createA2AAgent({
  name: 'greeting_assistant',
  description: 'Friendly greetings and introductions',
  instruction: 'You are a friendly greeting assistant. Welcome users and help them understand what services are available.',
  
  tools: [
    createA2ATool({
      name: 'generate_greeting',
      description: 'Generate personalized greetings',
      parameters: z.object({
        name: z.string().optional().describe('User\'s name'),
        timeOfDay: z.enum(['morning', 'afternoon', 'evening']).optional().describe('Time of day'),
        formal: z.boolean().default(false).describe('Use formal greeting')
      }),
      execute: async ({ name, timeOfDay, formal }) => {
        let greeting = '';
        
        if (timeOfDay) {
          const timeGreetings = {
            morning: formal ? 'Good morning' : 'Good morning',
            afternoon: formal ? 'Good afternoon' : 'Good afternoon', 
            evening: formal ? 'Good evening' : 'Good evening'
          };
          greeting = timeGreetings[timeOfDay];
        } else {
          greeting = formal ? 'Greetings' : 'Hello';
        }
        
        if (name) {
          greeting += `, ${name}`;
        }
        
        greeting += '! Welcome to our A2A-enabled agent service. ';
        greeting += 'I can help you get started and connect you with our specialized agents:\n\n';
        greeting += '🌤️ Weather Assistant - Get weather information and plan trips\n';
        greeting += '🔢 Calculator Assistant - Perform mathematical calculations\n';
        greeting += '👋 Greeting Assistant - That\'s me! I help with introductions\n\n';
        greeting += 'What would you like to do today?';
        
        return greeting;
      }
    }),
    
    createA2ATool({
      name: 'list_available_services',
      description: 'List all available agent services',
      parameters: z.object({
        detailed: z.boolean().default(false).describe('Include detailed descriptions')
      }),
      execute: async ({ detailed }) => {
        let response = 'Available Services:\n\n';
        
        if (detailed) {
          response += '🌤️ **Weather Assistant**\n';
          response += '   • Current weather conditions for any location\n';
          response += '   • Hourly and daily forecasts\n';
          response += '   • Travel planning with weather considerations\n';
          response += '   • Weather-appropriate activity suggestions\n\n';
          
          response += '🔢 **Calculator Assistant**\n';
          response += '   • Basic and advanced mathematical calculations\n';
          response += '   • Algebraic equation solving\n';
          response += '   • Step-by-step solution explanations\n';
          response += '   • Mathematical problem solving\n\n';
          
          response += '👋 **Greeting Assistant**\n';
          response += '   • Personalized welcome messages\n';
          response += '   • Service introductions and guidance\n';
          response += '   • Help navigating available agents\n';
        } else {
          response += '• Weather Assistant - Weather info & travel planning\n';
          response += '• Calculator Assistant - Math calculations & equations\n';
          response += '• Greeting Assistant - Introductions & guidance\n';
        }
        
        response += '\nYou can interact with any of these agents through our A2A protocol interface!';
        return response;
      }
    })
  ]
});

// Main function to start the A2A server
const main = async () => {
  // Create all agents
  const weatherAgent = createWeatherAgent();
  const calculatorAgent = createCalculatorAgent();
  const greetingAgent = createGreetingAgent();
  
  // Configure the A2A server
  const serverConfig: A2AServerConfig = {
    agents: new Map([
      ['weather', weatherAgent],
      ['calculator', calculatorAgent],
      ['greeting', greetingAgent]
    ]),
    
    agentCard: {
      name: 'Multi-Agent Assistant Service',
      description: 'A collection of specialized AI agents providing weather, calculation, and greeting services through the A2A protocol',
      version: '1.0.0',
      provider: {
        organization: 'Juspay',
        url: 'https://juspay.in'
      }
    },
    
    port: 3000,
    host: 'localhost'
  };
  
  console.log('🚀 Starting A2A-enabled JAF server...\n');
  
  try {
    // Start the server
    const server = await startA2AServer(serverConfig);
    
    console.log('\n✅ Server started successfully!\n');
    console.log('🔗 Test the agents:');
    console.log('   Weather: curl -X POST http://localhost:3000/a2a/agents/weather \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"role":"user","parts":[{"kind":"text","text":"What\'s the weather in Tokyo?"}],"messageId":"msg1","kind":"message"}}}\'');
    console.log('');
    console.log('   Calculator: curl -X POST http://localhost:3000/a2a/agents/calculator \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"jsonrpc":"2.0","id":"2","method":"message/send","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Calculate 15 * 23 + 7"}],"messageId":"msg2","kind":"message"}}}\'');
    console.log('');
    console.log('🌐 Agent Discovery:');
    console.log('   curl http://localhost:3000/.well-known/agent-card');
    console.log('');
    console.log('🏥 Health Check:');
    console.log('   curl http://localhost:3000/a2a/health');
    console.log('');
    console.log('⚡ Capabilities:');
    console.log('   curl http://localhost:3000/a2a/capabilities');
    console.log('');
    console.log('Press Ctrl+C to stop the server');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down server...');
      await server.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n🛑 Shutting down server...');
      await server.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Export for use in other modules
export {
  createCalculatorAgent,
  createGreetingAgent,
  main as startExampleServer
};

// Run if this file is executed directly
if (isMainScript('a2a/examples/server-example')) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}