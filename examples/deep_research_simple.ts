#!/usr/bin/env tsx

/**
 * Simple Deep Research Tool Demo
 * 
 * Demonstrates the JAF Deep Research Tool in standalone mode.
 */

import * as dotenv from 'dotenv';
import { createDeepResearchTool, createSimpleResearchTool, DeepResearchContext } from '../src/tools';
import { ToolResult } from '../src/core/tool-results';

dotenv.config();

async function main() {
  console.log('🔬 JAF Deep Research Tool - Simple Demo\n');
  console.log('=' .repeat(60));
  
  const apiKey = process.env.OPENAI_API_KEY || process.env.LITELLM_API_KEY || 'demo-key';
  
  // Configure the research context
  const context: DeepResearchContext = {
    apiKey,
    modelName: process.env.MODEL_NAME || 'gpt-4-turbo-preview',
    baseUrl: process.env.LITELLM_BASE_URL || 'https://api.openai.com/v1',
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
      
      console.log('\n📝 Summary Preview:');
      if (report.synthesis) {
        console.log(report.synthesis.substring(0, 500) + '...');
      }
      
      console.log('\n📚 Citations:', report.citations?.length || 0, 'sources');
    } else {
      console.error('❌ Research failed:', toolResult.error?.message);
    }
  } catch (error) {
    console.error('❌ Error during simple research:', error);
  }

  // Example 2: Deep Research
  console.log('\n\n📋 Example 2: Deep Research - CBDC Impact');
  console.log('-' .repeat(60));
  
  const deepQuery = 'Impact of Central Bank Digital Currency (CBDC) on fintech';
  console.log(`Query: "${deepQuery}"\n`);

  try {
    console.log('⏳ Starting deep research...\n');
    
    const deepResult = await deepResearchTool.execute(
      {
        query: deepQuery,
        maxDepth: 2,
        maxSearchResults: 3,
      },
      context
    );

    const toolResult = deepResult as ToolResult;
    
    if (toolResult.status === 'success') {
      const report = toolResult.data as any;
      
      console.log('✅ Deep Research Complete!\n');
      
      console.log('🔍 Research Breakdown:');
      console.log(`  Main Query: ${report.mainQuery}`);
      console.log(`  Sub-queries: ${report.subQueries?.length || 0}`);
      console.log(`  Total Findings: ${report.findings?.length || 0}`);
      console.log(`  Citations: ${report.citations?.length || 0}`);
      
      console.log('\n📊 Sub-queries:');
      report.subQueries?.slice(0, 3).forEach((q: string, i: number) => {
        console.log(`  ${i + 1}. ${q}`);
      });
      
      console.log('\n📝 Research Synthesis Preview:');
      console.log('-' .repeat(60));
      if (report.synthesis) {
        console.log(report.synthesis.substring(0, 800) + '...');
      }
      
      console.log('\n⏰ Completed at:', report.timestamp);
      
    } else {
      console.error('❌ Deep research failed:', toolResult.error?.message);
    }
  } catch (error) {
    console.error('❌ Error during deep research:', error);
  }

  console.log('\n\n🎯 Demo Complete!');
  console.log('=' .repeat(60));
  
  console.log('\n💡 Key Features Demonstrated:');
  console.log('  ✓ Simple research for quick queries');
  console.log('  ✓ Deep research with multi-level exploration');
  console.log('  ✓ Sub-query generation and decomposition');
  console.log('  ✓ Research synthesis and report generation');
  console.log('  ✓ Citation tracking and source management');
  
  console.log('\n🚀 Next Steps:');
  console.log('  - Integrate with real search APIs (Tavily, Google, etc.)');
  console.log('  - Add vector database support for RAG');
  console.log('  - Implement full JAF agent orchestration');
  console.log('  - Add streaming support for real-time updates');
}

console.log(`
╔════════════════════════════════════════════════════════════╗
║           🔬 JAF Deep Research Tool - Simple Demo          ║
║                                                            ║
║  This demo showcases the JAF Deep Research Tool in        ║
║  standalone mode without complex engine orchestration.    ║
║                                                            ║
║  Features:                                                ║
║  • Query decomposition into sub-queries                   ║
║  • Multi-depth research exploration                       ║
║  • Research synthesis and reporting                       ║
║  • Citation tracking                                      ║
║                                                            ║
║  Note: This uses mock data for demonstration.             ║
║  For production use, integrate with real search APIs.     ║
╚════════════════════════════════════════════════════════════╝
`);

main().catch(console.error);