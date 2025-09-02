#!/usr/bin/env tsx

/**
 * HITL API Demo - Interactive chat with curl-based approval API
 * 
 * This demo creates:
 * 1. An interactive chat session (like the original demo)
 * 2. An HTTP API server for handling approvals via curl
 * 3. Real-time coordination between chat and API
 * 
 * Usage: pnpm run demo:api
 * 
 * API Endpoints:
 * - GET /pending - List pending approvals
 * - POST /approve/:sessionId/:toolCallId - Approve a tool call
 * - POST /reject/:sessionId/:toolCallId - Reject a tool call
 */

import { z } from 'zod';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import * as path from 'path';
const express = require('express');
import { createServer } from 'http';

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
const API_PORT = process.env.API_PORT || 3001;

// Global state for pending approvals and sessions
interface PendingApproval {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  args: any;
  timestamp: Date;
  resolve: (decision: { approved: boolean; additionalContext?: any }) => void;
}

const pendingApprovals = new Map<string, PendingApproval>();
const activeSessions = new Map<string, any>();

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
 * Create Express API server for handling approvals
 */
function createApiServer() {
  const app = express();
  app.use(express.json());

  // Enable CORS for testing
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  // Get all pending approvals
  app.get('/pending', (req, res) => {
    const pending = Array.from(pendingApprovals.values()).map(approval => ({
      sessionId: approval.sessionId,
      toolCallId: approval.toolCallId,
      toolName: approval.toolName,
      args: approval.args,
      timestamp: approval.timestamp,
    }));
    res.json({ pending });
  });

  // Approve a tool call
  app.post('/approve/:sessionId/:toolCallId', (req, res) => {
    const { sessionId, toolCallId } = req.params;
    const { additionalContext } = req.body;
    
    const key = `${sessionId}:${toolCallId}`;
    const approval = pendingApprovals.get(key);
    
    if (!approval) {
      return res.status(404).json({ 
        error: 'Approval not found',
        sessionId,
        toolCallId 
      });
    }

    console.log(colors.green(`\n🌐 API: Approved ${approval.toolName} for ${sessionId}`));
    if (additionalContext) {
      console.log(colors.green(`   Additional context provided via API`));
    }

    // Resolve the pending approval
    approval.resolve({ approved: true, additionalContext });
    pendingApprovals.delete(key);

    res.json({ 
      success: true, 
      message: `Approved ${approval.toolName}`,
      sessionId,
      toolCallId 
    });
  });

  // Reject a tool call
  app.post('/reject/:sessionId/:toolCallId', (req, res) => {
    const { sessionId, toolCallId } = req.params;
    const { reason } = req.body;
    
    const key = `${sessionId}:${toolCallId}`;
    const approval = pendingApprovals.get(key);
    
    if (!approval) {
      return res.status(404).json({ 
        error: 'Approval not found',
        sessionId,
        toolCallId 
      });
    }

    console.log(colors.red(`\n🌐 API: Rejected ${approval.toolName} for ${sessionId}`));
    if (reason) {
      console.log(colors.red(`   Reason: ${reason}`));
    }

    // Resolve the pending approval
    approval.resolve({ approved: false, additionalContext: { rejectionReason: reason } });
    pendingApprovals.delete(key);

    res.json({ 
      success: true, 
      message: `Rejected ${approval.toolName}`,
      sessionId,
      toolCallId 
    });
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', pendingCount: pendingApprovals.size });
  });

  return app;
}

/**
 * Display welcome message and instructions
 */
function displayWelcome() {
  console.clear();
  console.log(colors.bold(colors.blue('🚀 JAF Human-in-the-Loop API Demo')));
  console.log(colors.blue('==========================================\n'));
  
  console.log(colors.green('This demo shows the HITL system with both:'));
  console.log(colors.green('• Interactive terminal approvals (like before)'));
  console.log(colors.green('• RESTful API for remote approvals via curl'));
  console.log(colors.green('• Real-time coordination between both interfaces\n'));

  console.log(colors.cyan('Terminal Commands:'));
  console.log(colors.white('• "redirect me to the dashboard"'));
  console.log(colors.white('• "send my data to the team"'));
  console.log(colors.white('• "api" to see API status'));
  console.log(colors.white('• "exit" to quit\n'));

  console.log(colors.cyan(`API Server running on http://localhost:${API_PORT}`));
  console.log(colors.cyan('API Endpoints:'));
  console.log(colors.white(`• GET  /pending - List pending approvals`));
  console.log(colors.white(`• POST /approve/:sessionId/:toolCallId - Approve`));
  console.log(colors.white(`• POST /reject/:sessionId/:toolCallId - Reject\n`));

  console.log(colors.yellow('Example curl commands:'));
  console.log(colors.dim(`curl http://localhost:${API_PORT}/pending`));
  console.log(colors.dim(`curl -X POST http://localhost:${API_PORT}/approve/session-id/tool-call-id`));
  console.log(colors.dim(`curl -X POST http://localhost:${API_PORT}/reject/session-id/tool-call-id \\`));
  console.log(colors.dim(`     -H "Content-Type: application/json" \\`));
  console.log(colors.dim(`     -d '{"reason": "Not authorized"}'`));
  console.log('');
}

/**
 * Wait for approval via API only
 */
async function waitForApproval(
  sessionId: string,
  toolCallId: string,
  toolName: string,
  args: any
): Promise<{ approved: boolean; additionalContext?: any }> {
  return new Promise((resolve) => {
    const key = `${sessionId}:${toolCallId}`;
    let resolved = false;
    
    // Store pending approval with resolve function
    pendingApprovals.set(key, {
      sessionId,
      toolCallId,
      toolName,
      args,
      timestamp: new Date(),
      resolve: (decision) => {
        if (resolved) return; // Prevent double resolution
        resolved = true;
        
        // Clean up
        pendingApprovals.delete(key);
        console.log(colors.green('\n🌐 API: Approved via API - continuing automatically\n'));
        resolve(decision);
      },
    });

    console.log(colors.red('🛑 APPROVAL REQUIRED\n'));
    console.log(colors.yellow(`Tool: ${colors.bold(toolName)}`));
    console.log(colors.yellow(`Arguments:`));
    Object.entries(args).forEach(([key, value]) => {
      console.log(colors.yellow(`  ${key}: ${value}`));
    });
    console.log(colors.yellow(`Session ID: ${sessionId}`));
    console.log(colors.yellow(`Tool Call ID: ${toolCallId}\n`));
    
    console.log(colors.magenta('⏳ Waiting for API approval...'));
    console.log(colors.white(`💡 Approve: curl -X POST http://localhost:3001/approve/${sessionId}/${toolCallId}`));
    console.log(colors.white(`💡 Reject:  curl -X POST http://localhost:3001/reject/${sessionId}/${toolCallId}`));
    console.log(colors.dim(`💡 Check:   curl http://localhost:3001/pending`));
    console.log('');
    console.log(colors.cyan('🔄 Tool execution will continue automatically once approved via API...'));
    console.log('');

    // No terminal input - purely API-driven
    // The promise will only resolve when API approval comes through
  });
}

/**
 * Main interactive chat loop with API integration
 */
async function runApiDemo() {
  // Start API server
  const app = createApiServer();
  const server = createServer(app);
  
  server.listen(API_PORT, () => {
    console.log(colors.green(`🌐 API Server started on http://localhost:${API_PORT}`));
  });

  displayWelcome();
  
  const rl = readline.createInterface({ input, output });
  const modelProvider = createModelProvider();
  
  const runConfig: RunConfig<any> = {
    agentRegistry: new Map([['HITL Demo Agent', demoAgent]]),
    modelProvider,
  };

  const conversationHistory: any[] = [];
  let currentApprovals = new Map();
  const sessionRunId = createRunId('api-demo');

  try {
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

      if (userInput.toLowerCase() === 'api') {
        console.log(colors.cyan(`📊 API Status:`));
        console.log(colors.white(`• Server: http://localhost:${API_PORT}`));
        console.log(colors.white(`• Pending approvals: ${pendingApprovals.size}`));
        if (pendingApprovals.size > 0) {
          console.log(colors.white(`• IDs: ${Array.from(pendingApprovals.keys()).join(', ')}`));
        }
        console.log('');
        continue;
      }

      if (!userInput.trim()) continue;

      // Add user message to conversation
      conversationHistory.push({ role: 'user', content: userInput });

      let state: RunState<any> = {
        runId: sessionRunId,
        traceId: createTraceId('api-trace'),
        messages: [...conversationHistory],
        currentAgentName: 'HITL Demo Agent',
        context: { userId: 'api-user', currentScreen: '/home' },
        turnCount: conversationHistory.length,
        approvals: currentApprovals,
      };

      console.log(colors.dim('⏳ Processing...\n'));
      
      // Process the conversation
      while (true) {
        const result = await run(state, runConfig);

        if (result.outcome.status === 'interrupted') {
          const interruption = result.outcome.interruptions[0];
          
          if (interruption.type === 'tool_approval') {
            const toolCall = interruption.toolCall;
            const args = JSON.parse(toolCall.function.arguments);
            
            // Wait for approval (terminal or API)
            const decision = await waitForApproval(
              interruption.sessionId || sessionRunId,
              toolCall.id,
              toolCall.function.name,
              args
            );

            if (decision.approved) {
              state = approve(result.finalState, interruption, decision.additionalContext);
              currentApprovals = new Map(state.approvals);
              console.log(colors.dim(`   Approval recorded for tool call ID: ${toolCall.id}`));
              // Continue with the approved state
              continue;
            } else {
              state = reject(result.finalState, interruption, decision.additionalContext);
              currentApprovals = new Map(state.approvals);
              console.log(colors.dim(`   Rejection recorded for tool call ID: ${toolCall.id}`));
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
    server.close();
  }
}

// Run the API demo
if (require.main === module) {
  runApiDemo().catch(console.error);
}

export { runApiDemo };