#!/usr/bin/env tsx

/**
 * Deep Research Tool Demo
 * 
 * Demonstrates the JAF Deep Research Tool that performs structured
 * multi-step research with supervisor-researcher orchestration.
 */

import * as dotenv from 'dotenv';
import { run } from '../src/core/engine';
import { RunState, RunConfig, createTraceId, createRunId } from '../src/core/types';
import { makeLiteLLMProvider } from '../src/providers/model';
import { createDeepResearchTool, createSimpleResearchTool, DeepResearchContext } from '../src/tools';
import { ToolResult } from '../src/core/tool-results';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

async function main() {
  console.log('🔬 JAF Deep Research Tool Demo\n');
  console.log('=' .repeat(60));
  
  const apiKey = process.env.OPENAI_API_KEY || process.env.LITELLM_API_KEY;
  
  if (!apiKey) {
    console.error('❌ Please set OPENAI_API_KEY or LITELLM_API_KEY in your .env file');
    process.exit(1);
  }

  // Configure the research context
  const context: DeepResearchContext = {
    apiKey,
    modelName: process.env.MODEL_NAME || 'gpt-4-turbo-preview',
    baseUrl: process.env.LITELLM_BASE_URL || 'https://api.openai.com/v1',
    maxSearchResults: 3,
    maxConcurrentResearchers: 3,
    maxResearchIterations: 6,
  };

  // Create research tools
  const deepResearchTool = createDeepResearchTool<DeepResearchContext>({
    apiKey,
    modelName: context.modelName,
    baseUrl: context.baseUrl,
  });

  const simpleResearchTool = createSimpleResearchTool<DeepResearchContext>({
    apiKey,
    modelName: context.modelName,
    baseUrl: context.baseUrl,
  });

  // Create the JAF configuration with research tools
  const modelProvider = makeLiteLLMProvider(context.baseUrl, apiKey);
  
  const config: RunConfig<DeepResearchContext> = {
    agent: {
      model: context.modelName || 'gpt-4-turbo-preview',
      modelProvider,
      maxIterations: 10,
    },
    tools: [deepResearchTool, simpleResearchTool],
  };

  // Example 1: Simple Research
  console.log('\n📋 Example 1: Simple Research');
  console.log('-' .repeat(60));
  
  const simpleQuery = 'What are the latest developments in quantum computing?';
  console.log(`Query: "${simpleQuery}"\n`);

  try {
    console.log('⏳ Running simple research...\n');
    
    const simpleResult = await simpleResearchTool.execute(
      { query: simpleQuery },
      context
    );

    const toolResult = simpleResult as ToolResult;
    
    if (toolResult.status === 'success') {
      const report = toolResult.data as any;
      
      console.log('✅ Simple Research Complete!\n');
      console.log('📊 Sub-queries Generated:');
      report.subQueries?.forEach((q: string, i: number) => {
        console.log(`  ${i + 1}. ${q}`);
      });
      
      console.log('\n📝 Summary:');
      if (report.synthesis) {
        console.log(report.synthesis.substring(0, 500) + '...');
      }
    } else {
      console.error('❌ Research failed:', toolResult.error?.message);
    }
  } catch (error) {
    console.error('❌ Error during simple research:', error);
  }

  // Example 2: Deep Research with CBDC Focus
  console.log('\n\n📋 Example 2: Deep Research - CBDC Impact on Indian Fintech');
  console.log('-' .repeat(60));
  
  const deepQuery = 'Impact of Central Bank Digital Currency (CBDC) on the Indian fintech ecosystem';
  console.log(`Query: "${deepQuery}"\n`);

  try {
    console.log('⏳ Starting deep research workflow...\n');
    
    const deepResult = await deepResearchTool.execute(
      {
        query: deepQuery,
        maxDepth: 2,
        maxSearchResults: 3,
        maxIterations: 6,
        allowClarification: false, // Skip clarification for demo
      },
      context
    );

    const toolResult = deepResult as ToolResult;
    
    if (toolResult.status === 'success') {
      const report = toolResult.data as any;
      
      console.log('✅ Deep Research Complete!\n');
      
      console.log('🔍 Research Breakdown:');
      console.log(`  Main Query: ${report.mainQuery}`);
      console.log(`  Sub-queries Generated: ${report.subQueries?.length || 0}`);
      console.log(`  Findings Collected: ${report.findings?.length || 0}`);
      console.log(`  Citations: ${report.citations?.length || 0}`);
      
      console.log('\n📊 Sub-queries:');
      report.subQueries?.forEach((q: string, i: number) => {
        console.log(`  ${i + 1}. ${q}`);
      });
      
      console.log('\n📝 Research Synthesis:');
      console.log('-' .repeat(60));
      console.log(report.synthesis || 'No synthesis available');
      
      console.log('\n📚 Citations:');
      report.citations?.forEach((citation: string, i: number) => {
        console.log(`  [${i + 1}] ${citation}`);
      });
      
      console.log('\n⏰ Completed at:', report.timestamp);
      
    } else {
      console.error('❌ Deep research failed:', toolResult.error?.message);
    }
  } catch (error) {
    console.error('❌ Error during deep research:', error);
  }

  // Example 3: Using the Engine for Conversational Research
  console.log('\n\n📋 Example 3: Conversational Research with JAF Engine');
  console.log('-' .repeat(60));
  
  const conversationalQuery = 'Help me research the pros and cons of remote work for software teams';
  console.log(`Query: "${conversationalQuery}"\n`);

  try {
    console.log('⏳ Running conversational research through JAF engine...\n');
    
    const initialState: RunState<DeepResearchContext> = {
      runId: createRunId(uuidv4()),
      traceId: createTraceId(uuidv4()),
      messages: [
        {
          role: 'user',
          content: `Use the deepResearch tool to: ${conversationalQuery}`,
        },
      ],
      context,
      turnCount: 0,
      approvals: new Map(),
    };
    
    const result = await run(initialState, config);

    if (result.outcome.status === 'completed') {
      console.log('✅ Engine Execution Complete!\n');
      
      // Extract tool calls and responses
      for (const message of result.state.messages) {
        if (message.role === 'assistant' && message.tool_calls) {
          console.log('🔧 Tool Calls Made:');
          for (const toolCall of message.tool_calls) {
            console.log(`  - ${toolCall.function.name}`);
          }
        }
        
        if (message.role === 'tool') {
          console.log('\n📊 Tool Response Received');
        }
        
        if (message.role === 'assistant' && message.content && !message.tool_calls) {
          console.log('\n💡 Assistant Response:');
          const content = typeof message.content === 'string' 
            ? message.content 
            : message.content[0]?.text || '';
          console.log(content.substring(0, 1000) + (content.length > 1000 ? '...' : ''));
        }
      }
      
      if (result.outcome.output) {
        console.log('\n📄 Final Output:');
        console.log(result.outcome.output);
      }
    } else if (result.outcome.status === 'error') {
      console.log('❌ Execution failed:', result.outcome.error);
    }
  } catch (error) {
    console.error('❌ Error during engine execution:', error);
  }

  console.log('\n\n🎯 Demo Complete!');
  console.log('=' .repeat(60));
  
  console.log('\n💡 Key Features Demonstrated:');
  console.log('  ✓ Simple research for quick queries');
  console.log('  ✓ Deep research with supervisor-researcher pattern');
  console.log('  ✓ Sub-query generation and decomposition');
  console.log('  ✓ Parallel research execution');
  console.log('  ✓ Research synthesis and report generation');
  console.log('  ✓ Integration with JAF engine for conversational AI');
  
  console.log('\n🚀 Use Cases:');
  console.log('  - Academic research and literature review');
  console.log('  - Market research and competitive analysis');
  console.log('  - Policy analysis and regulatory compliance');
  console.log('  - Technology assessment and evaluation');
  console.log('  - Investment due diligence and risk assessment');
}

console.log(`
╔════════════════════════════════════════════════════════════╗
║              🔬 JAF Deep Research Tool Demo                ║
║                                                            ║
║  This demo showcases the JAF Deep Research Tool that      ║
║  performs structured multi-step research using JAF's      ║
║  native orchestration capabilities.                       ║
║                                                            ║
║  Architecture:                                            ║
║  • Supervisor Agent - Manages research strategy           ║
║  • Researcher Agents - Conduct focused research           ║
║  • Synthesis Engine - Generates comprehensive reports     ║
║                                                            ║
║  Features:                                                ║
║  • Query clarification and refinement                     ║
║  • Sub-query decomposition                                ║
║  • Parallel research execution                            ║
║  • Finding deduplication and ranking                      ║
║  • Comprehensive report synthesis                         ║
║                                                            ║
║  Requirements:                                            ║
║  • Set OPENAI_API_KEY in your .env file                  ║
║  • Or use LITELLM_API_KEY with LITELLM_BASE_URL          ║
╚════════════════════════════════════════════════════════════╝
`);

main().catch(console.error);