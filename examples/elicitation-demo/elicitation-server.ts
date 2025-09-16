#!/usr/bin/env tsx

import 'dotenv/config';
import { z } from 'zod';
import {
  runServer,
  Agent,
  Tool,
  makeLiteLLMProvider,
  createInMemoryProvider,
  Elicit,
  elicit,
  ElicitationSchemas,
  ServerElicitationProvider,
  ElicitationInterruptionError
} from '../../dist/index.js';

// Tool that demonstrates basic elicitation
const getUserInfoTool: Tool<{ reason?: string }, any> = {
  schema: {
    name: 'getUserInfo',
    description: 'Collect user information for personalization',
    parameters: z.object({
      reason: z.string().optional().describe('Why the information is needed'),
    }),
  },
  execute: async ({ reason }) => {
    try {
      // Use convenience method for contact information
      const info = await Elicit.contactInfo(
        reason ? `We need your contact information: ${reason}` : 'Please provide your contact information'
      );

      return `Successfully collected user information:
            - Name: ${info.name}
            - Email: ${info.email}
            - Phone: ${info.phone || 'Not provided'}`;
    } catch (error) {
      // Let elicitation interruption errors propagate to the engine
      if (error instanceof ElicitationInterruptionError) {
        throw error;
      }
      return `Failed to collect user information: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
};

// Tool that demonstrates custom elicitation schema
const preferencesTool: Tool<{ category?: string }, any> = {
  schema: {
    name: 'getPreferences',
    description: 'Collect user preferences',
    parameters: z.object({
      category: z.string().optional().describe('Category of preferences to collect'),
    }),
  },
  execute: async ({ category = 'general' }) => {
    try {
      // Use custom schema for preferences
      const schema = ElicitationSchemas.choice({
        title: 'Experience Level',
        description: `What are your ${category} preferences?`,
        choices: ['beginner', 'intermediate', 'advanced'],
        choiceLabels: ['Beginner (just starting)', 'Intermediate (some experience)', 'Advanced (expert level)'],
      });

      const result = await elicit(`Please select your ${category} experience level:`, schema);

      return `User selected ${category} preference: ${result.choice}`;
    } catch (error) {
      // Let elicitation interruption errors propagate to the engine
      if (error instanceof ElicitationInterruptionError) {
        throw error;
      }
      return `Failed to collect preferences: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
};

// Tool that demonstrates text input elicitation
const feedbackTool: Tool<{ topic?: string }, any> = {
  schema: {
    name: 'getFeedback',
    description: 'Collect user feedback',
    parameters: z.object({
      topic: z.string().optional().describe('Topic to get feedback on'),
    }),
  },
  execute: async ({ topic = 'our service' }) => {
    try {
      const feedback = await Elicit.text(
        `Please provide your feedback about ${topic}:`,
        {
          title: 'Your Feedback',
          description: 'Help us improve by sharing your thoughts',
          minLength: 10,
          maxLength: 500,
        }
      );

      return `Received feedback about ${topic}: "${feedback.substring(0, 100)}${feedback.length > 100 ? '...' : ''}"`;
    } catch (error) {
      // Let elicitation interruption errors propagate to the engine
      if (error instanceof ElicitationInterruptionError) {
        throw error;
      }
      return `Failed to collect feedback: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
};

// Tool that demonstrates confirmation elicitation
const confirmActionTool: Tool<{ action: string }, any> = {
  schema: {
    name: 'confirmAction',
    description: 'Ask user to confirm an action',
    parameters: z.object({
      action: z.string().describe('Action to confirm'),
    }) as z.ZodType<{ action: string }>,
  },
  execute: async ({ action }) => {
    try {
      const confirmed = await Elicit.confirm(`Are you sure you want to ${action}?`);

      if (confirmed) {
        return `User confirmed: ${action}. Action would be executed now.`;
      } else {
        return `User declined: ${action}. Action was cancelled.`;
      }
    } catch (error) {
      // Let elicitation interruption errors propagate to the engine
      if (error instanceof ElicitationInterruptionError) {
        throw error;
      }
      return `Failed to get confirmation: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
};

// Tool that demonstrates number input elicitation
const getQuantityTool: Tool<{ item?: string }, any> = {
  schema: {
    name: 'getQuantity',
    description: 'Ask user for a quantity',
    parameters: z.object({
      item: z.string().optional().describe('Item to get quantity for'),
    }),
  },
  execute: async ({ item = 'items' }) => {
    try {
      const quantity = await Elicit.number(
        `How many ${item} do you need?`,
        {
          title: 'Quantity',
          description: 'Enter the number you need',
          minimum: 1,
          maximum: 100,
          integer: true,
        }
      );

      return `User requested ${quantity} ${item}`;
    } catch (error) {
      // Let elicitation interruption errors propagate to the engine
      if (error instanceof ElicitationInterruptionError) {
        throw error;
      }
      return `Failed to get quantity: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
};

const elicitationAgent: Agent<any, string> = {
  name: 'Elicitation Demo Agent',
  instructions: () => `You are a helpful assistant that demonstrates MCP elicitation features.

Available tools for collecting user information:
- getUserInfo: Collect contact information
- getPreferences: Collect user preferences
- getFeedback: Collect user feedback
- confirmAction: Ask for confirmation
- getQuantity: Ask for numerical input

When the user asks about elicitation or wants to see examples, use these tools to demonstrate how they work.
Explain what each tool does before using it.
`,
  tools: [getUserInfoTool, preferencesTool, feedbackTool, confirmActionTool, getQuantityTool],
  modelConfig: { name: process.env.LITELLM_MODEL || 'gpt-3.5-turbo', temperature: 0.7 },
};

async function main() {
  const host = process.env.HOST || '127.0.0.1';
  const port = parseInt(process.env.PORT || '3000', 10);

  // Model provider
  const baseURL = process.env.LITELLM_URL || 'http://localhost:4000';
  const apiKey = process.env.LITELLM_API_KEY || 'sk-demo';
  const modelProvider = makeLiteLLMProvider(baseURL, apiKey);

  // Memory provider
  const memoryProvider = createInMemoryProvider();

  // Elicitation provider
  const elicitationProvider = new ServerElicitationProvider();

  console.log('🚀 Starting Elicitation Demo Server...');
  console.log('This server demonstrates MCP elicitation features in JAF');
  console.log('');

  const server = await runServer(
    [elicitationAgent],
    {
      modelProvider,
      elicitationProvider,
      memory: {
        provider: memoryProvider,
        autoStore: true,
        storeOnCompletion: true
      }
    },
    {
      port,
      host,
      defaultMemoryProvider: memoryProvider,
      elicitationProvider,
    }
  );

  console.log('');
  console.log('📋 Available endpoints:');
  console.log(`   POST ${host}:${port}/chat - Chat with agents`);
  console.log(`   GET  ${host}:${port}/elicitation/pending - View pending elicitation requests`);
  console.log(`   POST ${host}:${port}/elicitation/respond - Respond to elicitation requests`);
  console.log('');
  console.log('💡 Try asking the agent to:');
  console.log('   - "Collect my contact information"');
  console.log('   - "Get my preferences for programming"');
  console.log('   - "Ask for my feedback on this demo"');
  console.log('   - "Confirm if I want to delete my account"');
  console.log('   - "Ask how many tickets I need"');
  console.log('');
  console.log('🔄 When elicitation requests are made, use the /elicitation endpoints to respond.');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n📤 Shutting down server...');
    await server.stop();
    process.exit(0);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}