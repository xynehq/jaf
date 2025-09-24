#!/usr/bin/env node
/**
 * JAF Pipeline Demo Script
 * 
 * Demonstrates the JAF-based CI/CD pipeline with sample data
 */

import { run, makeLiteLLMProvider, createRunId, createTraceId } from '../../src/index';
import { PipelineOrchestrator, CodegenAgent, BuildARTAgent, EvaluationAgent } from './agents';
import { ConnectorMemoryProvider } from './memory/connector-memory';
import type { PipelineContext } from './types';

// Demo configuration (replace with your actual values for real testing)
const DEMO_CONFIG = {
  liteLLMUrl: 'http://localhost:4000', // Replace with your LiteLLM URL
  liteLLMApiKey: 'demo-key', // Replace with your API key
  jenkinsUrl: 'https://jenkins.internal.svc.k8s.office.mum.juspay.net',
  jenkinsPath: '/job/SDK%20Pipelines/job/sdk-api-mocking/job/test-jenkins/buildWithParameters',
  jenkinsUser: 'demo@juspay.in', // Replace with your Jenkins user
  jenkinsToken: 'demo-token', // Replace with your Jenkins token
  slackBotToken: 'xoxb-demo-token', // Replace with your Slack bot token
  maxTurns: 10
};

async function demoMigrationPipeline() {
  console.log('🚀 Starting JAF Pipeline Demo - Migration Flow\n');

  // Initialize providers
  const modelProvider = makeLiteLLMProvider<PipelineContext>(DEMO_CONFIG.liteLLMUrl, DEMO_CONFIG.liteLLMApiKey);
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
    maxTurns: DEMO_CONFIG.maxTurns,
    onEvent: (event: any) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] 📊 ${event.type}: ${JSON.stringify(event.data, null, 2)}\n`);
    }
  };

  // Demo context
  const context: PipelineContext = {
    connectorName: 'demo-connector',
    pipelineType: 'migration',
    jenkinsConfig: {
      url: DEMO_CONFIG.jenkinsUrl,
      path: DEMO_CONFIG.jenkinsPath,
      user: DEMO_CONFIG.jenkinsUser,
      token: DEMO_CONFIG.jenkinsToken
    },
    slackConfig: {
      botToken: DEMO_CONFIG.slackBotToken
    }
  };

  const initialState = {
    runId: createRunId(`demo-migration-${Date.now()}`),
    traceId: createTraceId(`demo-trace-${Date.now()}`),
    messages: [{
      role: 'user' as const,
      content: 'Start migration pipeline for connector: demo-connector'
    }],
    currentAgentName: 'PipelineOrchestrator',
    context,
    turnCount: 0
  };

  console.log('📋 Demo Context:');
  console.log(JSON.stringify(context, null, 2));
  console.log('\n🎯 Starting Pipeline Orchestration...\n');

  try {
    const result = await run(initialState, runConfig);
    
    if (result.outcome.status === 'completed') {
      console.log('✅ Demo Migration Pipeline completed successfully!');
      console.log('📊 Final State:', JSON.stringify(result.finalState, null, 2));
    } else if (result.outcome.status === 'error') {
      console.error('❌ Demo Migration Pipeline failed:', result.outcome.error);
    } else {
      console.error('❌ Demo Migration Pipeline interrupted:', result.outcome);
    }

    return result;
  } catch (error) {
    console.error('💥 Demo Pipeline Error:', error);
    throw error;
  }
}

async function demoARTPipeline() {
  console.log('\n🎨 Starting JAF Pipeline Demo - ART Processing Flow\n');

  // Initialize providers
  const modelProvider = makeLiteLLMProvider<PipelineContext>(DEMO_CONFIG.liteLLMUrl, DEMO_CONFIG.liteLLMApiKey);
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
    maxTurns: DEMO_CONFIG.maxTurns,
    onEvent: (event: any) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] 🎨 ${event.type}: ${JSON.stringify(event.data, null, 2)}\n`);
    }
  };

  // Demo ART context
  const context: PipelineContext = {
    connectorName: 'demo-connector',
    pipelineType: 'art',
    replayId: 'demo-20250923-123456',
    jenkinsConfig: {
      url: DEMO_CONFIG.jenkinsUrl,
      path: DEMO_CONFIG.jenkinsPath,
      user: DEMO_CONFIG.jenkinsUser,
      token: DEMO_CONFIG.jenkinsToken
    },
    slackConfig: {
      botToken: DEMO_CONFIG.slackBotToken
    }
  };

  const initialState = {
    runId: createRunId(`demo-art-${Date.now()}`),
    traceId: createTraceId(`demo-trace-${Date.now()}`),
    messages: [{
      role: 'user' as const,
      content: 'Process ART results for connector: demo-connector, replay ID: demo-20250923-123456'
    }],
    currentAgentName: 'EvaluationAgent',
    context,
    turnCount: 0
  };

  console.log('📋 Demo ART Context:');
  console.log(JSON.stringify(context, null, 2));
  console.log('\n🎯 Starting ART Evaluation...\n');

  try {
    const result = await run(initialState, runConfig);
    
    if (result.outcome.status === 'completed') {
      console.log('✅ Demo ART Pipeline completed successfully!');
      console.log('📊 Final State:', JSON.stringify(result.finalState, null, 2));
    } else if (result.outcome.status === 'error') {
      console.error('❌ Demo ART Pipeline failed:', result.outcome.error);
    } else {
      console.error('❌ Demo ART Pipeline interrupted:', result.outcome);
    }

    return result;
  } catch (error) {
    console.error('💥 Demo ART Pipeline Error:', error);
    throw error;
  }
}

async function demoAgentCapabilities() {
  console.log('\n🤖 JAF Pipeline Agent Capabilities Demo\n');

  console.log('📊 Available Agents:');
  console.log('  🎯 PipelineOrchestrator - Routes requests and coordinates pipeline flow');
  console.log('  🟢 CodegenAgent - Handles UCS/Euler code generation using Xyne');
  console.log('  🟠 BuildARTAgent - Manages Jenkins jobs and artifact downloads');
  console.log('  🟣 EvaluationAgent - Analyzes ART reports and enhances prompts\n');

  console.log('🛠️  Available Tools:');
  console.log('  Codegen Tools:');
  console.log('    • select_connector - Choose target connector');
  console.log('    • generate_migration_files - Generate prompts using Python script');
  console.log('    • execute_xyne_command - Run Xyne with build validation');
  console.log('    • validate_build - Cargo/Nix build validation with auto-fix');
  console.log('    • commit_and_push - Git operations');
  
  console.log('  Build/ART Tools:');
  console.log('    • trigger_jenkins_job - Jenkins API integration');
  console.log('    • monitor_build_status - Build progress monitoring');
  console.log('    • download_artifacts - Fetch ART reports');
  console.log('    • send_slack_notification - Slack integration');
  
  console.log('  Evaluation Tools:');
  console.log('    • parse_art_report - ART report analysis');
  console.log('    • analyze_art_issues - Issue categorization');
  console.log('    • generate_enhanced_prompts - Create improved prompts');
  console.log('    • save_enhanced_prompts - Persist learnings\n');

  console.log('🔄 Pipeline Flow:');
  console.log('  Migration: User Request → PipelineOrchestrator → CodegenAgent → BuildARTAgent → EvaluationAgent');
  console.log('  ART Processing: ART Request → PipelineOrchestrator → EvaluationAgent → CodegenAgent (retry)\n');

  console.log('💾 Memory & State Management:');
  console.log('  • Pipeline status and progress tracking');
  console.log('  • Connector configurations persistence');
  console.log('  • Migration results storage');
  console.log('  • ART reports and analysis');
  console.log('  • Enhanced prompts for feedback loops\n');
}

async function main() {
  const args = process.argv.slice(2);
  
  try {
    switch (args[0]) {
      case 'migration':
        await demoMigrationPipeline();
        break;
      case 'art':
        await demoARTPipeline();
        break;
      case 'capabilities':
        await demoAgentCapabilities();
        break;
      case 'full':
        await demoAgentCapabilities();
        await demoMigrationPipeline();
        await demoARTPipeline();
        break;
      default:
        console.log('🚀 JAF Pipeline Demo\n');
        console.log('Usage: node demo.ts [command]\n');
        console.log('Commands:');
        console.log('  migration     - Demo migration pipeline flow');
        console.log('  art          - Demo ART processing pipeline');
        console.log('  capabilities - Show agent and tool capabilities');
        console.log('  full         - Run all demos\n');
        console.log('Examples:');
        console.log('  node demo.ts migration');
        console.log('  node demo.ts art');
        console.log('  node demo.ts full\n');
        console.log('Note: Update DEMO_CONFIG with your actual credentials for real testing.');
        break;
    }
  } catch (error) {
    console.error('💥 Demo failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}