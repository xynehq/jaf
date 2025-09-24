#!/usr/bin/env node
/**
 * JAF-based CI/CD Pipeline Implementation
 * 
 * This implements the Mermaid diagram pipeline:
 * - Codegen Pipeline (UCS/Euler code generation)
 * - Build & ART Pipeline (Jenkins integration)
 * - Evaluation & Enhancement Pipeline (ART report analysis)
 */

import { run, makeLiteLLMProvider, createInMemoryProvider, createRunId, createTraceId } from '../../src/index';
import { runServer } from '../../src/server/index';
import { PipelineOrchestrator, CodegenAgent, BuildARTAgent, EvaluationAgent } from './agents';
import { ConnectorMemoryProvider } from './memory/connector-memory';
import type { PipelineContext } from './types';

// Configuration
const CONFIG = {
  liteLLMUrl: process.env.LITE_LLM_URL || 'https://grid.ai.juspay.net',
  liteLLMApiKey: process.env.LITE_LLM_API_KEY || 'sk-af-K9l7Uvi1EN7ceeo_oiw',
  liteLLMModel: process.env.LITE_LLM_MODEL || 'glm-45-fp8',
  jenkinsUrl: 'https://jenkins.internal.svc.k8s.office.mum.juspay.net',
  jenkinsPath: '/job/SDK%20Pipelines/job/sdk-api-mocking/job/test-jenkins/buildWithParameters',
  jenkinsUser: 'shivral.somani@juspay.in',
  jenkinsToken: '',
  slackBotToken: '',
  maxTurns: 50,
  port: 3000
};

async function main() {
  console.log('🚀 Initializing JAF CI/CD Pipeline...\n');

  // Initialize providers
  const modelProvider = makeLiteLLMProvider<PipelineContext>(CONFIG.liteLLMUrl, CONFIG.liteLLMApiKey);
  const memoryProvider = new ConnectorMemoryProvider();

  // Create agent registry
  const agentRegistry = new Map([
    ['PipelineOrchestrator', PipelineOrchestrator],
    ['CodegenAgent', CodegenAgent],  
    ['BuildARTAgent', BuildARTAgent],
    ['EvaluationAgent', EvaluationAgent]
  ]);

  const runConfig = {
    agentRegistry,
    modelProvider,
    memoryProvider,
    maxTurns: CONFIG.maxTurns,
    onEvent: (event: any) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] ${event.type}: ${JSON.stringify(event.data, null, 2)}`);
    }
  };

  // Check command line arguments
  const args = process.argv.slice(2);
  
  if (args.includes('--server')) {
    // Start server mode
    console.log('🌐 Starting JAF CI/CD Pipeline Server...');
    
    const serverConfig = {
      port: CONFIG.port,
      defaultMemoryProvider: memoryProvider
    };

    const agents = [PipelineOrchestrator, CodegenAgent, BuildARTAgent, EvaluationAgent];
    await runServer(agents, { modelProvider }, serverConfig);
    
  } else if (args.includes('--interactive')) {
    // Interactive mode
    console.log('💬 Starting Interactive Mode...');
    console.log('Available commands:');
    console.log('  - "migrate <connector_name>" - Start migration pipeline');
    console.log('  - "art <connector_name> <replay_id>" - Process ART results');
    console.log('  - "status <run_id>" - Check pipeline status');
    console.log('  - "exit" - Exit interactive mode\n');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'jaf-pipeline> '
    });

    rl.prompt();

    rl.on('line', async (input: string) => {
      const [command, ...params] = input.trim().split(' ');

      try {
        switch (command) {
          case 'migrate':
            if (params.length === 0) {
              console.log('❌ Usage: migrate <connector_name>');
              break;
            }
            await runMigrationPipeline(params[0], runConfig);
            break;

          case 'art':
            if (params.length < 2) {
              console.log('❌ Usage: art <connector_name> <replay_id>');
              break;
            }
            await runARTPipeline(params[0], params[1], runConfig);
            break;

          case 'status':
            if (params.length === 0) {
              console.log('❌ Usage: status <run_id>');
              break;
            }
            await checkPipelineStatus(params[0], memoryProvider);
            break;

          case 'exit':
            console.log('👋 Goodbye!');
            process.exit(0);
            break;

          default:
            console.log('❌ Unknown command. Type "exit" to quit.');
        }
      } catch (error) {
        console.error(`❌ Error: ${error}`);
      }

      rl.prompt();
    });

  } else {
    // Single run mode with connector from arguments
    const connectorName = args[0];
    if (!connectorName) {
      console.log('❌ Usage: node index.ts <connector_name> [--server|--interactive]');
      console.log('\nExamples:');
      console.log('  node index.ts payu           # Run migration for payu connector');
      console.log('  node index.ts --server       # Start REST API server');
      console.log('  node index.ts --interactive  # Start interactive mode');
      process.exit(1);
    }

    await runMigrationPipeline(connectorName, runConfig);
  }
}

async function runMigrationPipeline(connectorName: string, runConfig: any) {
  console.log(`🔄 Starting migration pipeline for connector: ${connectorName}\n`);

  const context: PipelineContext = {
    connectorName,
    pipelineType: 'migration',
    repositoryPaths: {
      ucsPath: '/Users/shivral.somani/Documents/Repos/hyperswitch/ucs/connector-service',
      eulerPath: '/Users/shivral.somani/Documents/Repos/euler-api-txns/euler-x',
      outputDir: `/tmp/migration-${connectorName}-${Date.now()}`
    },
    jenkinsConfig: {
      url: CONFIG.jenkinsUrl,
      path: CONFIG.jenkinsPath,
      user: CONFIG.jenkinsUser,
      token: CONFIG.jenkinsToken
    },
    slackConfig: {
      botToken: CONFIG.slackBotToken
    }
  };

  const initialState = {
    runId: createRunId(`migration-${connectorName}-${Date.now()}`),
    traceId: createTraceId(`trace-${Date.now()}`),
    messages: [{
      role: 'user' as const,
      content: `Start migration pipeline for connector: ${connectorName}`
    }],
    currentAgentName: 'PipelineOrchestrator',
    context,
    turnCount: 0
  };

  const result = await run(initialState, runConfig);
  
  if (result.outcome.status === 'completed') {
    console.log('✅ Migration pipeline completed successfully!');
  } else if (result.outcome.status === 'error') {
    console.error('❌ Migration pipeline failed:', result.outcome.error);
  } else {
    console.error('❌ Migration pipeline interrupted:', result.outcome);
  }

  return result;
}

async function runARTPipeline(connectorName: string, replayId: string, runConfig: any) {
  console.log(`🎨 Starting ART processing for connector: ${connectorName}, replay: ${replayId}\n`);

  const context: PipelineContext = {
    connectorName,
    pipelineType: 'art',
    replayId,
    jenkinsConfig: {
      url: CONFIG.jenkinsUrl,
      path: CONFIG.jenkinsPath,
      user: CONFIG.jenkinsUser,
      token: CONFIG.jenkinsToken
    },
    slackConfig: {
      botToken: CONFIG.slackBotToken
    }
  };

  const initialState = {
    runId: createRunId(`art-${connectorName}-${replayId}-${Date.now()}`),
    traceId: createTraceId(`trace-${Date.now()}`),
    messages: [{
      role: 'user' as const,
      content: `Process ART results for connector: ${connectorName}, replay ID: ${replayId}`
    }],
    currentAgentName: 'EvaluationAgent',
    context,
    turnCount: 0
  };

  const result = await run(initialState, runConfig);
  
  if (result.outcome.status === 'completed') {
    console.log('✅ ART processing completed successfully!');
  } else if (result.outcome.status === 'error') {
    console.error('❌ ART processing failed:', result.outcome.error);
  } else {
    console.error('❌ ART processing interrupted:', result.outcome);
  }

  return result;
}

async function checkPipelineStatus(runId: string, memoryProvider: any) {
  try {
    const status = await memoryProvider.getPipelineStatus(runId);
    if (status) {
      console.log(`📊 Pipeline Status for ${runId}:`);
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(`❌ No status found for run ID: ${runId}`);
    }
  } catch (error) {
    console.error(`❌ Error checking status: ${error}`);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down JAF CI/CD Pipeline...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down JAF CI/CD Pipeline...');
  process.exit(0);
});

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}