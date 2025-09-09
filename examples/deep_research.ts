#!/usr/bin/env tsx

import * as dotenv from 'dotenv';
import { makeEngine } from '../src/core/engine';
import { makeLiteLLMProvider } from '../src/providers/model';
import { createDeepResearchTool, DeepResearchContext } from '../src/tools/deep-research';
import { ToolResult } from '../src/core/tool-results';
import { MemoryStorage } from '../src/memory/providers/in-memory';
import { Document } from '@langchain/core/documents';

dotenv.config();

async function main() {
  console.log('🔬 Deep Research Tool Demo - CBDC Impact on Indian Fintech\n');
  console.log('=' .repeat(60));
  
  const apiKey = process.env.OPENAI_API_KEY || process.env.LITELLM_API_KEY;
  
  if (!apiKey) {
    console.error('❌ Please set OPENAI_API_KEY or LITELLM_API_KEY in your .env file');
    process.exit(1);
  }

  const mockVectorDB = {
    search: async (query: string, limit: number): Promise<Document[]> => {
      console.log(`📊 Vector DB search for: "${query}" (limit: ${limit})`);
      
      const mockDocuments: Document[] = [
        {
          pageContent: `The Reserve Bank of India (RBI) has been actively exploring Central Bank Digital Currency (CBDC) 
          through pilot programs. The e-rupee pilot launched in December 2022 has seen participation from major banks 
          including SBI, ICICI, and HDFC. Initial reports suggest transaction volumes exceeding 1 million by Q2 2023, 
          with retail adoption growing steadily in tier-1 cities.`,
          metadata: {
            source: 'RBI Annual Report 2023',
            relevance: 0.95,
          },
        },
        {
          pageContent: `Indian fintech companies like Paytm, PhonePe, and Razorpay are adapting their infrastructure 
          to integrate CBDC capabilities. The UPI ecosystem, which processes over 10 billion transactions monthly, 
          is being evaluated for CBDC interoperability. Industry experts predict that CBDC could reduce transaction 
          costs by 40% while improving settlement times from T+2 to near-instantaneous.`,
          metadata: {
            source: 'NASSCOM Fintech Report 2024',
            relevance: 0.92,
          },
        },
        {
          pageContent: `Challenges facing CBDC adoption in India include digital literacy gaps, with only 38% of the 
          population having smartphone access. Infrastructure requirements for offline CBDC transactions and privacy 
          concerns remain key implementation hurdles. The RBI is working on a tiered privacy model balancing 
          anonymity for small transactions with KYC requirements for larger amounts.`,
          metadata: {
            source: 'Digital India Foundation Study',
            relevance: 0.88,
          },
        },
      ];
      
      return mockDocuments.slice(0, limit);
    },
  };

  const context: DeepResearchContext = {
    apiKey,
    modelName: 'gpt-4-turbo-preview',
    maxSearchResults: 3,
    vectorDB: mockVectorDB,
  };

  const deepResearchTool = createDeepResearchTool<DeepResearchContext>({
    apiKey,
    modelName: 'gpt-4-turbo-preview',
  });

  const litellmProvider = makeLiteLLMProvider(
    process.env.LITELLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey
  );

  const memoryStorage = new MemoryStorage();

  const engine = makeEngine({
    tools: [deepResearchTool],
    modelProvider: litellmProvider,
    memoryStorage,
  });

  const researchQuery = 'Impact of CBDC on Indian fintech ecosystem';
  
  console.log(`\n🎯 Research Query: "${researchQuery}"`);
  console.log('=' .repeat(60));

  try {
    console.log('\n⏳ Starting deep research workflow...\n');
    
    const result = await deepResearchTool.execute(
      {
        query: researchQuery,
        maxDepth: 2,
        maxSearchResults: 3,
        includeVectorDB: true,
        allowClarification: false,
      },
      context
    );

    const toolResult = result as ToolResult;
    
    if (toolResult.status !== 'success') {
      console.error('❌ Research failed:', toolResult.error?.message);
      return;
    }

    const report = toolResult.data as any;
    
    console.log('\n📋 Research Report');
    console.log('=' .repeat(60));
    
    console.log('\n🔍 Sub-queries Generated:');
    report.subQueries.forEach((q: string, i: number) => {
      console.log(`  ${i + 1}. ${q}`);
    });
    
    console.log('\n📊 Top Findings (by relevance):');
    report.findings.slice(0, 5).forEach((finding: any, i: number) => {
      console.log(`\n  ${i + 1}. [Score: ${finding.relevanceScore}] ${finding.source}`);
      console.log(`     ${finding.content.substring(0, 150)}...`);
    });
    
    console.log('\n📝 Synthesized Report:');
    console.log('-' .repeat(60));
    console.log(report.synthesis);
    
    console.log('\n📚 Citations:');
    report.citations.forEach((citation: string, i: number) => {
      console.log(`  [${i + 1}] ${citation}`);
    });
    
    console.log('\n✅ Research completed successfully!');
    console.log(`⏰ Timestamp: ${report.timestamp}`);
    
    console.log('\n💡 Example Use Cases:');
    console.log('  - Policy analysis and regulatory compliance');
    console.log('  - Market research and competitive intelligence');
    console.log('  - Technology assessment and implementation planning');
    console.log('  - Academic research and literature review');
    console.log('  - Investment due diligence and risk assessment');
    
  } catch (error) {
    console.error('❌ Error during research:', error);
  }
}

console.log(`
╔════════════════════════════════════════════════════════════╗
║          🔬 LangChain Deep Research Tool Demo              ║
║                                                            ║
║  This demo showcases integration of LangChain's Open      ║
║  Deep Research workflow for structured multi-step         ║
║  research with citations.                                 ║
║                                                            ║
║  Features:                                                ║
║  • Query decomposition into sub-queries                   ║
║  • Web search and document loading                        ║
║  • Vector database integration                            ║
║  • Result ranking and deduplication                       ║
║  • Comprehensive report synthesis                         ║
║                                                            ║
║  Requirements:                                            ║
║  • Set OPENAI_API_KEY in your .env file                  ║
║  • Or use LITELLM_API_KEY with LITELLM_BASE_URL          ║
╚════════════════════════════════════════════════════════════╝
`);

main().catch(console.error);