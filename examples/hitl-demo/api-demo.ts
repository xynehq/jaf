#!/usr/bin/env tsx

/**
 * File System HITL API Demo - With HTTP endpoints for approval
 * 
 * This demo extends the file system HITL demo with HTTP API endpoints
 * for remote approval/rejection via curl commands:
 * - All file operations from the main demo
 * - HTTP API server for approval management
 * - curl-based approval/rejection support
 * - Real-time coordination between terminal and API
 * 
 * Usage: npx tsx examples/hitl-demo/api-demo.ts
 */

import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';

import {
  RunState,
  RunConfig,
  createRunId,
  createTraceId,
} from '../../src/core/types';
import { run } from '../../src/core/engine';
import { approve, reject } from '../../src/core/state';
import { makeLiteLLMProvider } from '../../src/providers/model';
import { createInMemoryApprovalStorage } from '../../src/memory/approval-storage';
import { fileSystemAgent, LITELLM_BASE_URL, LITELLM_API_KEY, LITELLM_MODEL } from './shared/agent';
import { FileSystemContext, DEMO_DIR } from './shared/tools';
import { setupMemoryProvider } from './shared/memory';


// Color utilities
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

// Configuration
const API_PORT = parseInt(process.env.API_PORT || '3001');

// Global state for pending approvals
const pendingApprovals = new Map<string, {
  interruption: any;
  resolve: (value: any) => void;
  metadata: {
    sessionId: string;
    toolCallId: string;
    toolName: string;
    arguments: any;
    timestamp: Date;
  };
}>();


/**
 * Create model provider
 */
const createModelProvider = () => {
  // Check if we have environment variables set (not using defaults)
  const hasEnvConfig = process.env.LITELLM_BASE_URL || process.env.LITELLM_URL;
  const hasApiKey = process.env.LITELLM_API_KEY;
  
  if (!hasEnvConfig || !hasApiKey) {
    console.log(colors.red(`❌ No LiteLLM configuration found`));
    console.log(colors.yellow(`   Please set LITELLM_BASE_URL and LITELLM_API_KEY environment variables`));
    console.log(colors.yellow(`   Example: LITELLM_BASE_URL=http://localhost:4000 LITELLM_API_KEY=your-key npx tsx examples/hitl-demo/api-demo.ts`));
    console.log(colors.dim(`   Or copy examples/hitl-demo/.env.example to .env and configure your LiteLLM server`));
    process.exit(1);
  }

  console.log(colors.green(`🤖 Using LiteLLM: ${LITELLM_BASE_URL} (${LITELLM_MODEL})`));
  return makeLiteLLMProvider(LITELLM_BASE_URL, LITELLM_API_KEY) as any;
};
/**
 * Setup demo sandbox directory
 */
async function setupSandbox() {
  try {
    await fs.mkdir(DEMO_DIR, { recursive: true });
    
    const demoFiles = [
      { name: 'README.txt', content: 'Welcome to the File System HITL API Demo!\nThis is a sample file for testing.' },
      { name: 'config.json', content: '{\n  "app": "filesystem-api-demo",\n  "version": "1.0.0",\n  "api": true\n}' },
      { name: 'notes.md', content: '# API Demo Notes\n\n- This is a markdown file\n- You can edit or delete it via terminal or API\n- Operations require approval' }
    ];

    for (const file of demoFiles) {
      const filePath = path.join(DEMO_DIR, file.name);
      if (!existsSync(filePath)) {
        await fs.writeFile(filePath, file.content);
      }
    }
    
    console.log(colors.green(`📁 Sandbox directory ready: ${DEMO_DIR}`));
  } catch (error) {
    console.error(colors.red(`Failed to setup sandbox: ${error}`));
    process.exit(1);
  }
}

/**
 * Display welcome message
 */
function displayWelcome() {
  console.clear();
  console.log(colors.bold(colors.blue('🌐 JAF File System HITL API Demo')));
  console.log(colors.blue('====================================\n'));
  
  console.log(colors.green('This demo showcases HITL with curl-based approval only:'));
  console.log(colors.green('• Safe operations: listFiles, readFile (no approval)'));
  console.log(colors.green('• Dangerous operations: deleteFile, editFile (require approval)'));
  console.log(colors.green('• Approve/reject ONLY via curl commands'));
  console.log(colors.green('• No terminal approval - must use API endpoints\n'));

  console.log(colors.cyan('Try these commands:'));
  console.log(colors.white('• "list files in the current directory"'));
  console.log(colors.white('• "read the README file"'));
  console.log(colors.white('• "edit the config file to add api: true"'));
  console.log(colors.white('• "delete the notes file"\n'));

  console.log(colors.yellow('API Endpoints:'));
  console.log(colors.white(`• GET http://localhost:${API_PORT}/pending - List pending approvals`));
  console.log(colors.white(`• POST http://localhost:${API_PORT}/approve/:sessionId/:toolCallId - Approve`));
  console.log(colors.white(`• POST http://localhost:${API_PORT}/reject/:sessionId/:toolCallId - Reject\n`));

  console.log(colors.dim('Commands: type "exit" to quit, "clear" to clear screen\n'));
}

/**
 * Handle approval request (curl-only)
 */
async function handleApproval(interruption: any): Promise<any> {
  const toolCall = interruption.toolCall;
  const args = JSON.parse(toolCall.function.arguments);
  const approvalKey = `${interruption.sessionId}-${toolCall.id}`;
  
  console.log(colors.red('🛑 APPROVAL REQUIRED\n'));
  console.log(colors.yellow(`Tool: ${colors.bold(toolCall.function.name)}`));
  console.log(colors.yellow(`Arguments:`));
  Object.entries(args).forEach(([key, value]) => {
    console.log(colors.yellow(`  ${key}: ${value}`));
  });
  console.log(colors.yellow(`Session ID: ${interruption.sessionId}`));
  console.log(colors.yellow(`Tool Call ID: ${toolCall.id}\n`));
  
  console.log(colors.cyan('💡 Use curl to approve/reject:'));
  console.log(colors.white(`   Simple:  curl -X POST http://localhost:${API_PORT}/approve/${interruption.sessionId}/${toolCall.id}`));
  console.log(colors.white(`   Context: curl -X POST http://localhost:${API_PORT}/approve/${interruption.sessionId}/${toolCall.id} \\`));
  console.log(colors.white(`              -H "Content-Type: application/json" \\`));
  console.log(colors.white(`              -d '{"additionalContext": {"message": "your-additional-context"}}'`));
  console.log(colors.white(`   Reject:  curl -X POST http://localhost:${API_PORT}/reject/${interruption.sessionId}/${toolCall.id} \\`));
  console.log(colors.white(`              -H "Content-Type: application/json" \\`));
  console.log(colors.white(`              -d '{"reason": "not authorized", "additionalContext": {"rejectedBy": "your-name"}}'`));
  console.log(colors.dim(`   Check:   curl http://localhost:${API_PORT}/pending\n`));

  // Store pending approval for API access only
  const approvalPromise = new Promise<any>((resolve) => {
    pendingApprovals.set(approvalKey, {
      interruption,
      resolve,
      metadata: {
        sessionId: interruption.sessionId,
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        arguments: args,
        timestamp: new Date()
      }
    });
  });

  console.log(colors.dim('⏳ Waiting for curl approval/rejection...\n'));

  // Wait for API call only
  const result = await approvalPromise;
  
  // Clean up pending approval
  pendingApprovals.delete(approvalKey);
  
  if (result.approved) {
    console.log(colors.green(`\n✅ Approved via curl! Providing additional context...\n`));
  } else {
    console.log(colors.red(`\n❌ Rejected via curl!\n`));
  }
  
  return result;
}

/**
 * Get additional context based on tool
 */
function getAdditionalContext(toolName: string): any {
  if (toolName === 'deleteFile') {
    return {
      deletionConfirmed: {
        confirmedBy: 'demo-user',
        timestamp: new Date().toISOString(),
        backupCreated: true
      }
    };
  } else if (toolName === 'editFile') {
    return {
      editingApproved: {
        approvedBy: 'demo-user',
        timestamp: new Date().toISOString(),
        safetyLevel: 'standard'
      }
    };
  }
  return {};
}

/**
 * Setup HTTP API server
 */
function setupAPIServer() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const express = require('express');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cors = require('cors');
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      pendingApprovals: pendingApprovals.size,
      timestamp: new Date().toISOString()
    });
  });

  // List pending approvals
  app.get('/pending', (req, res) => {
    const pending = Array.from(pendingApprovals.entries()).map(([key, data]) => ({
      key,
      ...data.metadata
    }));
    res.json(pending);
  });

  // Approve tool call
  app.post('/approve/:sessionId/:toolCallId', (req, res) => {
    const { sessionId, toolCallId } = req.params;
    const { additionalContext } = req.body || {};
    const approvalKey = `${sessionId}-${toolCallId}`;
    
    const pending = pendingApprovals.get(approvalKey);
    if (!pending) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    const result = {
      approved: true,
      source: 'API',
      additionalContext: {
        ...getAdditionalContext(pending.metadata.toolName),
        ...additionalContext,
        approvedViaAPI: true
      }
    };

    pending.resolve(result);
    res.json({ message: 'Approval recorded', sessionId, toolCallId });
  });

  // Reject tool call
  app.post('/reject/:sessionId/:toolCallId', (req, res) => {
    const { sessionId, toolCallId } = req.params;
    const { reason } = req.body || {};
    const approvalKey = `${sessionId}-${toolCallId}`;
    
    const pending = pendingApprovals.get(approvalKey);
    if (!pending) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    const result = {
      approved: false,
      source: 'API',
      additionalContext: {
        rejectionReason: reason || 'Rejected via API',
        rejectedBy: 'api-user',
        timestamp: new Date().toISOString(),
        rejectedViaAPI: true
      }
    };

    pending.resolve(result);
    res.json({ message: 'Rejection recorded', sessionId, toolCallId });
  });

  return app;
}

/**
 * Process conversation turn
 */
async function processConversation(
  userInput: string,
  conversationHistory: any[],
  config: RunConfig<FileSystemContext>,
  rl: readline.Interface
): Promise<{ newHistory: any[]; shouldContinue: boolean }> {
  
  const newHistory = [...conversationHistory, { role: 'user', content: userInput }];
  
  const context: FileSystemContext = {
    userId: 'api-demo-user',
    workingDirectory: DEMO_DIR,
    permissions: ['read', 'write', 'delete']
  };

  let state: RunState<FileSystemContext> = {
    runId: createRunId('filesystem-api-demo'),
    traceId: createTraceId('fs-api-trace'),
    messages: newHistory,
    currentAgentName: 'FileSystemAgent',
    context,
    turnCount: 0,
    approvals: new Map(),
  };

  console.log(colors.dim('⏳ Processing...\n'));
  
  for (;;) {
    const result = await run(state, config);

    if (result.outcome.status === 'interrupted') {
      const interruption = result.outcome.interruptions[0];
      
      if (interruption.type === 'tool_approval') {
        const approvalResult = await handleApproval(interruption);
        
        if (approvalResult.approved) {
          state = await approve(state, interruption, approvalResult.additionalContext, config);
        } else {
          state = await reject(state, interruption, approvalResult.additionalContext, config);
        }
        
        continue;
      }
    } else if (result.outcome.status === 'completed') {
      const finalHistory = [...newHistory, { role: 'assistant', content: result.outcome.output }];
      console.log(colors.bold(colors.blue('Assistant: ')) + result.outcome.output + '\n');
      return { newHistory: finalHistory, shouldContinue: true };
    } else if (result.outcome.status === 'error') {
      console.log(colors.red('❌ Error:'), JSON.stringify(result.outcome.error, null, 2) + '\n');
      return { newHistory, shouldContinue: true };
    }
  }
}

/**
 * Conversation loop
 */
async function conversationLoop(
  conversationHistory: any[],
  config: RunConfig<FileSystemContext>,
  rl: readline.Interface
): Promise<void> {
  const userInput = await rl.question(colors.bold(colors.green('You: ')));
  
  if (userInput.toLowerCase() === 'exit') {
    console.log(colors.yellow('👋 Goodbye!'));
    return;
  }
  
  if (userInput.toLowerCase() === 'clear') {
    displayWelcome();
    return conversationLoop(conversationHistory, config, rl);
  }

  if (!userInput.trim()) {
    return conversationLoop(conversationHistory, config, rl);
  }

  const result = await processConversation(userInput, conversationHistory, config, rl);
  
  if (result.shouldContinue) {
    return conversationLoop(result.newHistory, config, rl);
  }
}

/**
 * Main demo function
 */
async function runFileSystemAPIDemo() {
  displayWelcome();
  await setupSandbox();
  
  // Setup API server
  const app = setupAPIServer();
  const server = app.listen(API_PORT, () => {
    console.log(colors.green(`🌐 API server running on http://localhost:${API_PORT}`));
    console.log(colors.dim(`   Health: http://localhost:${API_PORT}/health`));
    console.log(colors.dim(`   Pending: http://localhost:${API_PORT}/pending\n`));
  });
  
  const rl = readline.createInterface({ input, output });
  const modelProvider = createModelProvider();
  
  // Generate session ID for this demo run
  const sessionId = `api-demo-${Date.now()}`;
  console.log(colors.cyan(`🔗 Session ID: ${colors.bold(sessionId)}\n`));

  // Setup memory and approval storage
  const memoryProvider = await setupMemoryProvider();
  
  console.log(colors.cyan('🔐 Setting up approval storage...'));
  const approvalStorage = createInMemoryApprovalStorage();
  console.log(colors.green('✅ Approval storage initialized\n'));

  const config: RunConfig<FileSystemContext> = {
    agentRegistry: new Map([['FileSystemAgent', fileSystemAgent]]),
    modelProvider,
    memory: {
      provider: memoryProvider,
      autoStore: true,
      maxMessages: 50,
      storeOnCompletion: true,
    },
    conversationId: `filesystem-api-demo-${Date.now()}`,
    approvalStorage,
  };

  try {
    await conversationLoop([], config, rl);
  } finally {
    rl.close();
    server.close();
  }
}

// Run the demo
if (require.main === module) {
  runFileSystemAPIDemo().catch(console.error);
}

export { runFileSystemAPIDemo };