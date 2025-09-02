#!/usr/bin/env tsx

/**
 * Interactive HITL Demo - Run like a development server
 * 
 * This demo creates an interactive chat session where you can:
 * 1. Chat with the AI assistant
 * 2. See tools requiring approval in real-time
 * 3. Approve or reject tool calls manually
 * 4. Experience the complete HITL flow
 * 
 * Usage: pnpm run demo
 */

import { z } from 'zod';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import path from 'path';

import {
  Agent,
  RunState,
  Tool,
  RunConfig,
  createRunId,
  createTraceId,
} from '../../src/core/types';
import { run } from '../../src/core/engine';
import { approve, reject } from '../../src/core/state';
import { makeLiteLLMProvider } from '../../src/providers/model';

// Load environment variables from .env file if it exists
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config({ path: path.join(process.cwd(), 'examples/hitl-demo/.env') });
} catch {
  // dotenv not available or .env file doesn't exist
}

// Simple color utility
const colors = {
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  magenta: (text: string) => `\x1b[35m${text}\x1b[0m`,
  white: (text: string) => `\x1b[37m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
};

// Load environment configuration
const LITELLM_BASE_URL = process.env.LITELLM_URL || process.env.LITELLM_BASE_URL || 'http://localhost:4000';
const LITELLM_API_KEY = process.env.LITELLM_API_KEY || 'sk-demo';
const LITELLM_MODEL = process.env.LITELLM_MODEL || 'gpt-3.5-turbo';

// Demo tools that require approval
const redirectTool: Tool<{ url: string; reason?: string }, any> = {
  schema: {
    name: 'redirectUser',
    description: 'Redirect user to a different screen/page',
    parameters: z.object({
      url: z.string().describe('The URL to redirect to'),
      reason: z.string().optional().describe('Reason for redirect')
    }) as z.ZodType<{ url: string; reason?: string }>,
  },
  needsApproval: true,
  execute: async ({ url, reason }, context) => {
    console.log(colors.cyan(`🔄 Executing redirect to: ${url}`));
    if (reason) console.log(colors.cyan(`   Reason: ${reason}`));
    
    if (context.currentScreen) {
      console.log(colors.cyan(`   Previous screen: ${context.currentScreen}`));
      console.log(colors.cyan(`   New screen context:`), context.newScreenData || 'No additional data');
    }
    
    return `Successfully redirected user to ${url}. Context updated with new screen data.`;
  },
};

const sendDataTool: Tool<{ data: string; recipient: string }, any> = {
  schema: {
    name: 'sendSensitiveData',
    description: 'Send sensitive data to a recipient',
    parameters: z.object({
      data: z.string().describe('The sensitive data to send'),
      recipient: z.string().describe('Who to send the data to')
    }) as z.ZodType<{ data: string; recipient: string }>,
  },
  needsApproval: true,
  execute: async ({ data, recipient }, context) => {
    console.log(colors.cyan(`📤 Sending data to: ${recipient}`));
    console.log(colors.cyan(`   Data: ${data.substring(0, 20)}...`));
    
    if (context.encryptionLevel) {
      console.log(colors.cyan(`   Using encryption level: ${context.encryptionLevel}`));
    }
    
    return `Data sent securely to ${recipient} with appropriate encryption.`;
  },
};

const demoAgent: Agent<any, any> = {
  name: 'HITL Demo Agent',
  instructions: () => `You are a helpful assistant that can help users with navigation and data operations.

Available tools:
- redirectUser: Redirect user to a different screen/page (requires approval)
- sendSensitiveData: Send sensitive data to a recipient (requires approval)

When a user asks for navigation or redirection, use the redirectUser tool.
When a user asks to send data, use the sendSensitiveData tool.
Always be helpful and explain what you're doing.`,
  tools: [redirectTool, sendDataTool],
  modelConfig: {
    name: LITELLM_MODEL,
    temperature: 0.1,
  },
};


/**
 * Create model provider - requires LiteLLM configuration
 */
const createModelProvider = () => {
  // Check if LiteLLM is properly configured
  if (!LITELLM_BASE_URL || !LITELLM_API_KEY || LITELLM_API_KEY === 'sk-demo') {
    console.log(colors.red(`❌ No LiteLLM configuration found`));
    console.log(colors.yellow(`   Please set LITELLM_URL and LITELLM_API_KEY environment variables`));
    console.log(colors.dim(`   Copy examples/hitl-demo/.env.example to .env and configure your LiteLLM server`));
    process.exit(1);
  }

  console.log(colors.green(`🤖 Using LiteLLM: ${LITELLM_BASE_URL} (${LITELLM_MODEL})`));
  return makeLiteLLMProvider(LITELLM_BASE_URL, LITELLM_API_KEY);
};

/**
 * Display welcome message and instructions
 */
function displayWelcome() {
  console.clear();
  console.log(colors.bold(colors.blue('🚀 JAF Human-in-the-Loop Interactive Demo')));
  console.log(colors.blue('============================================\n'));
  
  console.log(colors.green('This demo shows the HITL (Human-in-the-Loop) system where:'));
  console.log(colors.green('• Tools can require approval before execution'));
  console.log(colors.green('• You manually approve or reject tool calls'));
  console.log(colors.green('• LLM remains unaware of the approval process'));
  console.log(colors.green('• Frontend can provide additional context'));
  console.log(colors.green('• Everything happens through the same chat endpoint\n'));

  console.log(colors.cyan('Try these commands:'));
  console.log(colors.white('• "redirect me to the dashboard"'));
  console.log(colors.white('• "send my data to the team"'));
  console.log(colors.white('• "navigate to settings"'));
  console.log(colors.white('• Or ask anything else!\n'));

  console.log(colors.dim('Commands: type "exit" to quit, "clear" to clear screen\n'));
}

/**
 * Main interactive chat loop
 */
async function runInteractiveDemo() {
  displayWelcome();
  
  const rl = readline.createInterface({ input, output });
  const modelProvider = createModelProvider();
  
  const runConfig: RunConfig<any> = {
    agentRegistry: new Map([['HITL Demo Agent', demoAgent]]),
    modelProvider,
  };

  const conversationHistory: any[] = [];
  let currentApprovals = new Map(); // Persist approvals across turns
  const sessionRunId = createRunId('interactive-demo'); // Single runId for entire session

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Get user input
      const userInput = await rl.question(colors.bold(colors.green('You: ')));
      
      if (userInput.toLowerCase() === 'exit') {
        console.log(colors.yellow('👋 Goodbye!'));
        break;
      }
      
      if (userInput.toLowerCase() === 'clear') {
        displayWelcome();
        continue;
      }

      if (!userInput.trim()) continue;

      // Add user message to conversation
      conversationHistory.push({ role: 'user', content: userInput });

      let state: RunState<any> = {
        runId: sessionRunId, // Use consistent runId for the session
        traceId: createTraceId('interactive-trace'),
        messages: [...conversationHistory],
        currentAgentName: 'HITL Demo Agent',
        context: { userId: 'demo-user', currentScreen: '/home' },
        turnCount: conversationHistory.length,
        approvals: currentApprovals, // Use persistent approvals map
      };

      console.log(colors.dim(`Debug: Current approvals count: ${currentApprovals.size}`));
      console.log(colors.dim(`Debug: Approvals:`), Array.from(currentApprovals.entries()));

      console.log(colors.dim('⏳ Processing...\n'));
      
      // Process the conversation
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await run(state, runConfig);

        if (result.outcome.status === 'interrupted') {
          const interruption = result.outcome.interruptions[0];
          
          if (interruption.type === 'tool_approval') {
            const toolCall = interruption.toolCall;
            const args = JSON.parse(toolCall.function.arguments);
            
            console.log(colors.red('🛑 APPROVAL REQUIRED\n'));
            console.log(colors.yellow(`Tool: ${colors.bold(toolCall.function.name)}`));
            console.log(colors.yellow(`Arguments:`));
            Object.entries(args).forEach(([key, value]) => {
              console.log(colors.yellow(`  ${key}: ${value}`));
            });
            console.log(colors.yellow(`Session ID: ${interruption.sessionId}\n`));

            const approval = await rl.question(colors.bold(colors.magenta('Do you approve this action? (y/n): ')));
            
            if (approval.toLowerCase() === 'y' || approval.toLowerCase() === 'yes') {
              console.log(colors.green('\n✅ Approved! Providing additional context...\n'));
              
              // Simulate additional context from frontend
              let additionalContext: any = {};
              
              if (toolCall.function.name === 'redirectUser') {
                additionalContext = {
                  currentScreen: '/dashboard',
                  newScreenData: {
                    widgets: ['analytics', 'reports', 'settings'],
                    userPermissions: ['read', 'write']
                  }
                };
              } else if (toolCall.function.name === 'sendSensitiveData') {
                additionalContext = {
                  encryptionLevel: 'AES-256',
                  auditLog: true,
                  requireReceipt: true
                };
              }

              state = approve(result.finalState, interruption, additionalContext);
              currentApprovals = new Map(state.approvals); // Update the persistent approvals
              console.log(colors.dim(`   Approval recorded for tool call ID: ${interruption.toolCall.id}`));
              console.log(colors.dim(`   State approvals:`), Array.from(state.approvals.entries()));
              // Continue with the approved state instead of restarting the conversation
              continue;
            } else {
              console.log(colors.red('\n❌ Rejected!\n'));
              state = reject(result.finalState, interruption, { rejectionReason: 'User declined' });
              currentApprovals = new Map(state.approvals); // Update the persistent approvals
              // Continue with the rejected state
              continue;
            }
          }
        } else if (result.outcome.status === 'completed') {
          // Add assistant response to conversation history
          conversationHistory.push({ role: 'assistant', content: result.outcome.output });
          
          console.log(colors.bold(colors.blue('Assistant: ')) + result.outcome.output + '\n');
          break;
        } else if (result.outcome.status === 'error') {
          console.log(colors.red('❌ Error:'), result.outcome.error + '\n');
          break;
        }
      }
    }
  } finally {
    rl.close();
  }
}

// Run the interactive demo
if (require.main === module) {
  runInteractiveDemo().catch(console.error);
}

export { runInteractiveDemo };