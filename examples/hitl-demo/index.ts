#!/usr/bin/env tsx

/**
 * File System HITL Demo - Recursive conversation pattern
 * 
 * This demo showcases the HITL (Human-in-the-Loop) system with file operations:
 * - listFile, readFile: No approval required
 * - deleteFile, editFile: Require approval
 * - Uses memory providers from environment
 * - Uses approval storage for persistence
 * - Recursive conversation pattern (no while loops)
 * 
 * Usage: npx tsx examples/hitl-demo/index.ts
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


/**
 * Create model provider - requires LiteLLM configuration
 */
const createModelProvider = () => {
  // Check if we have environment variables set (not using defaults)
  const hasEnvConfig = process.env.LITELLM_BASE_URL || process.env.LITELLM_URL;
  const hasApiKey = process.env.LITELLM_API_KEY;
  
  if (!hasEnvConfig || !hasApiKey) {
    console.log(colors.red(`❌ No LiteLLM configuration found`));
    console.log(colors.yellow(`   Please set LITELLM_BASE_URL and LITELLM_API_KEY environment variables`));
    console.log(colors.yellow(`   Example: LITELLM_BASE_URL=http://localhost:4000 LITELLM_API_KEY=your-key npx tsx examples/hitl-demo/index.ts`));
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
    
    // Create some demo files
    const demoFiles = [
      { name: 'README.txt', content: 'Welcome to the File System HITL Demo!\nThis is a sample file for testing.' },
      { name: 'config.json', content: '{\n  "app": "filesystem-demo",\n  "version": "1.0.0"\n}' },
      { name: 'notes.md', content: '# Demo Notes\n\n- This is a markdown file\n- You can edit or delete it\n- Operations require approval' }
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
  console.log(colors.bold(colors.blue('🗂️  JAF File System Human-in-the-Loop Demo')));
  console.log(colors.blue('================================================\n'));
  
  console.log(colors.green('This demo showcases HITL approval for file operations:'));
  console.log(colors.green('• Safe operations: listFiles, readFile (no approval)'));
  console.log(colors.green('• Dangerous operations: deleteFile, editFile (require approval)'));
  console.log(colors.green('• Approval state persists using memory providers'));
  console.log(colors.green('• Conversation history is maintained across sessions\n'));

  console.log(colors.cyan('Try these commands:'));
  console.log(colors.white('• "list files in the current directory"'));
  console.log(colors.white('• "read the README file"'));
  console.log(colors.white('• "edit the config file to add a new field"'));
  console.log(colors.white('• "delete the notes file"\n'));

  console.log(colors.dim('Commands: type "exit" to quit, "clear" to clear screen\n'));
}

/**
 * Handle approval request interactively
 */
async function handleApproval(interruption: any, rl: readline.Interface): Promise<any> {
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
    
    // Provide additional context based on the tool
    let additionalContext: any = {};
    
    if (toolCall.function.name === 'deleteFile') {
      additionalContext = {
        deletionConfirmed: {
          confirmedBy: 'demo-user',
          timestamp: new Date().toISOString(),
          backupCreated: true
        }
      };
    } else if (toolCall.function.name === 'editFile') {
      additionalContext = {
        editingApproved: {
          approvedBy: 'demo-user',
          timestamp: new Date().toISOString(),
          safetyLevel: 'standard'
        }
      };
    }
    
    return { approved: true, additionalContext };
  } else {
    console.log(colors.red('\n❌ Rejected!\n'));
    return { 
      approved: false, 
      additionalContext: { 
        rejectionReason: 'User declined the action',
        rejectedBy: 'demo-user',
        timestamp: new Date().toISOString()
      } 
    };
  }
}

/**
 * Process a single conversation turn
 */
async function processConversation(
  userInput: string,
  conversationHistory: any[],
  config: RunConfig<FileSystemContext>,
  rl: readline.Interface
): Promise<{ newHistory: any[]; shouldContinue: boolean }> {
  
  // Add user message to conversation
  const newHistory = [...conversationHistory, { role: 'user', content: userInput }];
  
  const context: FileSystemContext = {
    userId: 'demo-user',
    workingDirectory: DEMO_DIR,
    permissions: ['read', 'write', 'delete']
  };

  let state: RunState<FileSystemContext> = {
    runId: createRunId('filesystem-demo'),
    traceId: createTraceId('fs-trace'),
    messages: newHistory,
    currentAgentName: 'FileSystemAgent',
    context,
    turnCount: 0,
    approvals: new Map(),
  };

  console.log(colors.dim('⏳ Processing...\n'));
  
  // Process with the engine
  for (;;) {
    const result = await run(state, config);

    if (result.outcome.status === 'interrupted') {
      const interruption = result.outcome.interruptions[0];
      
      if (interruption.type === 'tool_approval') {
        const approvalResult = await handleApproval(interruption, rl);
        
        if (approvalResult.approved) {
          state = await approve(state, interruption, approvalResult.additionalContext, config);
        } else {
          state = await reject(state, interruption, approvalResult.additionalContext, config);
        }
        
        // Continue processing with the approval decision
        continue;
      }
    } else if (result.outcome.status === 'completed') {
      // Add assistant response to conversation history
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
 * Main conversation loop (recursive pattern)
 */
async function conversationLoop(
  conversationHistory: any[],
  config: RunConfig<FileSystemContext>,
  rl: readline.Interface
): Promise<void> {
  // Get user input
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

  // Process the conversation turn
  const result = await processConversation(userInput, conversationHistory, config, rl);
  
  if (result.shouldContinue) {
    // Recursive call to continue the conversation
    return conversationLoop(result.newHistory, config, rl);
  }
}

/**
 * Main demo function
 */
async function runFileSystemDemo() {
  displayWelcome();
  await setupSandbox();
  
  
  const rl = readline.createInterface({ input, output });
  const modelProvider = createModelProvider();
  
  // Set up memory provider from environment
  const memoryProvider = await setupMemoryProvider();
  
  // Set up approval storage
  console.log(colors.cyan('🔐 Setting up approval storage...'));
  const approvalStorage = createInMemoryApprovalStorage();
  console.log(colors.green('✅ Approval storage initialized'));

  const config: RunConfig<FileSystemContext> = {
    agentRegistry: new Map([['FileSystemAgent', fileSystemAgent]]),
    modelProvider,
    memory: {
      provider: memoryProvider,
      autoStore: true,
      maxMessages: 50,
      storeOnCompletion: true,
    },
    conversationId: `filesystem-demo-${Date.now()}`,
    approvalStorage,
  };

  try {
    // Start the recursive conversation loop
    await conversationLoop([], config, rl);
  } finally {
    rl.close();
  }
}

// Run the demo
if (require.main === module) {
  runFileSystemDemo().catch(console.error);
}

export { runFileSystemDemo };