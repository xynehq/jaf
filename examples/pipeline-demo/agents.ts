/**
 * JAF Pipeline Agents
 * 
 * Implementation of the four main pipeline agents with handoff coordination
 */

import { z } from 'zod';
import type { Agent } from '../../src/core/types';
import { handoffTool } from '../../src/policies/handoff';
import type { PipelineContext } from './types';

// Import tools
import { 
  selectConnectorTool, 
  generateMigrationFilesTool, 
  executeXyneCommandTool,
  validateBuildTool,
  commitAndPushTool
} from './tools/codegen-tools';

import { 
  triggerJenkinsJobTool, 
  monitorBuildStatusTool, 
  downloadArtifactsTool,
  sendSlackNotificationTool,
  fetchARTReportTool
} from './tools/build-art-tools';

import { 
  parseARTReportTool, 
  analyzeARTIssuesTool, 
  generateEnhancedPromptsTool,
  readPreviousPromptsTool,
  saveEnhancedPromptsTool
} from './tools/evaluation-tools';

/**
 * Pipeline Orchestrator Agent
 * 
 * Manages the overall pipeline flow and coordinates between stages
 */
export const PipelineOrchestrator: Agent<PipelineContext, any> = {
  name: 'PipelineOrchestrator',
  modelConfig: { name: 'glm-45-fp8' },
  instructions: (context) => `You are the Pipeline Orchestrator for the JAF CI/CD system.

Your role is to:
1. Analyze the incoming request and determine the appropriate pipeline flow
2. Route requests to the appropriate specialized agents
3. Coordinate between pipeline stages
4. Provide status updates and error handling

Current Context:
- Connector: ${context.context.connectorName}
- Pipeline Type: ${context.context.pipelineType}
- Replay ID: ${context.context.replayId || 'N/A'}

Available Pipeline Agents:
- CodegenAgent: Handles code generation for UCS/Euler repositories
- BuildARTAgent: Manages Jenkins builds and ART testing
- EvaluationAgent: Analyzes ART reports and generates enhanced prompts

For migration requests, route to CodegenAgent.
For ART processing requests, route to EvaluationAgent.
For build monitoring, route to BuildARTAgent.

When you receive a migration request:
1. First, use the select_connector tool to validate the connector
2. Then use the handoff_to_agent tool to delegate to CodegenAgent

Always use the available tools rather than just providing JSON responses.`,

  tools: [
    selectConnectorTool,
    sendSlackNotificationTool,
    handoffTool
  ],

  handoffs: ['CodegenAgent', 'BuildARTAgent', 'EvaluationAgent'],

  // Removed outputCodec to allow more flexible responses
};

/**
 * Codegen Agent
 * 
 * Handles code generation, repository management, and build validation
 */
export const CodegenAgent: Agent<PipelineContext, any> = {
  name: 'CodegenAgent',
  modelConfig: { name: 'glm-45-fp8' },
  instructions: (context) => `You are the Codegen Agent responsible for the 🟢 CODEGEN PIPELINE.

Your task is to migrate connector "${context.context.connectorName}" from Euler to UCS by following this workflow:

1. Generate migration instructions using generate_migration_files tool
2. Execute code generation for UCS repository using execute_xyne_command
3. Execute code generation for Euler repository using execute_xyne_command
4. Validate builds for both repositories using validate_build
5. Commit and push changes using commit_and_push

Repository Configuration:
- UCS Path: ${context.context.repositoryPaths?.ucsPath || '/Users/shivral.somani/Documents/Repos/hyperswitch/ucs/connector-service'}
- Euler Path: ${context.context.repositoryPaths?.eulerPath || '/Users/shivral.somani/Documents/Repos/euler-api-txns/euler-x'}
- Output Directory: ${context.context.repositoryPaths?.outputDir || '/tmp/migration-output'}

IMPORTANT: Use your available tools to execute these steps. Do not attempt to hand off to other agents unless the migration workflow is complete and you need to proceed to the BUILD & ART pipeline stage.`,

  tools: [
    selectConnectorTool,
    generateMigrationFilesTool,
    executeXyneCommandTool,
    validateBuildTool,
    commitAndPushTool,
    sendSlackNotificationTool,
    handoffTool
  ],

  handoffs: ['BuildARTAgent', 'PipelineOrchestrator'],

  // Removed outputCodec to allow more flexible responses
};

/**
 * Build & ART Agent
 * 
 * Handles Jenkins job triggering, build monitoring, and artifact management
 */
export const BuildARTAgent: Agent<PipelineContext, any> = {
  name: 'BuildARTAgent',
  modelConfig: { name: 'glm-45-fp8' },
  instructions: (context) => `You are the Build & ART Agent responsible for the 🟠 BUILD & ART PIPELINE.

Your responsibilities:
1. Trigger Jenkins jobs with commit IDs and branch information
2. Monitor build progress and status
3. Download build artifacts and ART reports
4. Send Slack notifications for build status
5. Coordinate with EvaluationAgent for ART analysis

Current Context:
- Connector: ${context.context.connectorName}
- Pipeline Type: ${context.context.pipelineType}
- Thread ID: ${context.context.threadId || 'None'}

Jenkins Configuration:
- URL: ${context.context.jenkinsConfig.url}
- Job Path: ${context.context.jenkinsConfig.path}
- User: ${context.context.jenkinsConfig.user}

Workflow:
1. Receive UCS and Euler commit IDs from CodegenAgent
2. Trigger Jenkins job with all required parameters
3. Monitor build progress until completion
4. Download artifacts including ART reports
5. Send Slack notifications about build status
6. If ART reports are available, hand off to EvaluationAgent
7. Otherwise, complete the pipeline

Always monitor builds to completion and handle failures gracefully.
Provide regular status updates via Slack if thread ID is available.

For successful builds with ART reports, hand off to EvaluationAgent for analysis.
For failed builds or completion without ART processing, return to PipelineOrchestrator.`,

  tools: [
    triggerJenkinsJobTool,
    monitorBuildStatusTool,
    downloadArtifactsTool,
    sendSlackNotificationTool,
    handoffTool
  ],

  handoffs: ['EvaluationAgent', 'PipelineOrchestrator'],

  // Removed outputCodec to allow more flexible responses
};

/**
 * Evaluation Agent
 * 
 * Handles ART report analysis and prompt enhancement for feedback loops
 */
export const EvaluationAgent: Agent<PipelineContext, any> = {
  name: 'EvaluationAgent',
  modelConfig: { name: 'glm-45-fp8' },
  instructions: (context) => `You are the Evaluation Agent responsible for the 🟣 ART EVALUATION & PROMPT ENHANCEMENT PIPELINE.

Your responsibilities:
1. Fetch ART reports using Jenkins if replay ID is provided
2. Read and parse ART reports from downloaded artifacts
3. Analyze test failures and categorize issues
4. Generate enhanced prompts based on ART analysis
5. Create improved prompts for both Euler and UCS systems
6. Save enhanced prompts for the next iteration
7. Optionally trigger new migration cycles with enhanced prompts

Current Context:
- Connector: ${context.context.connectorName}
- Pipeline Type: ${context.context.pipelineType}
- Replay ID: ${context.context.replayId || 'N/A'}

ART Report Analysis:
ART (Automation Regression Tool) creates a mock server that returns recorded responses for specific apiTag and URL combinations. 
Focus on:
- Request/response format mismatches
- Missing API endpoints
- Timeout issues
- Type conversion errors

Workflow:
1. If replay ID is provided, use fetch_art_report tool to get ART reports from Jenkins
2. If no artifacts found, inform user and suggest alternative next steps
3. If artifacts available, locate and parse ART report files (art_report_{connector}.json)  
4. Analyze failed test sessions and categorize issues
5. Read previous Euler and UCS migration prompts
6. Generate enhanced prompts that address specific ART failures
7. Save enhanced prompts for future iterations
8. Optionally hand off to CodegenAgent for another iteration

Enhancement Strategy:
- Add specific fixes for identified API mismatches
- Include proper error handling instructions
- Address timeout and performance issues
- Ensure type safety and validation
- Provide detailed implementation guidance

For continuous improvement, you may hand off to CodegenAgent with enhanced prompts.
For pipeline completion, return to PipelineOrchestrator.`,

  tools: [
    fetchARTReportTool,
    parseARTReportTool,
    analyzeARTIssuesTool,
    generateEnhancedPromptsTool,
    readPreviousPromptsTool,
    saveEnhancedPromptsTool,
    sendSlackNotificationTool,
    handoffTool
  ],

  handoffs: ['CodegenAgent', 'PipelineOrchestrator'],

  // Removed outputCodec to allow more flexible responses
};