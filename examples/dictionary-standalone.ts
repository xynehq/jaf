#!/usr/bin/env tsx
/**
 * Standalone Dictionary Tool Example
 * 
 * Simple demonstration of the dictionary tool without full agent setup
 * Run with: tsx examples/dictionary-standalone.ts
 */

import { createDictionaryTool } from '../src/adk/tools/dictionaryTool';
import type { ToolContext } from '../src/adk/types';

// Create mock context for demonstration
const mockContext: ToolContext = {
  agent: {
    id: 'demo-agent',
    config: {
      name: 'DemoAgent',
      model: 'gemini-1.5-flash',
      instruction: 'Demo agent',
      tools: []
    },
    metadata: {
      created: new Date(),
      version: '1.0.0'
    }
  } as any,
  session: {
    id: 'demo-session',
    appName: 'dictionary-demo',
    userId: 'user123',
    messages: [],
    artifacts: {},
    metadata: {
      created: new Date()
    }
  },
  message: {
    role: 'user',
    parts: []
  },
  actions: {}
};

async function demonstrateDictionary() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         Payment Dictionary Tool - Standalone Demo            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  const dictionaryTool = createDictionaryTool();
  
  // Example 1: Looking up "UPI collect"
  console.log('═══ Example 1: What is UPI collect? ═══\n');
  const upiCollectResult = await dictionaryTool.execute(
    { term: 'UPI collect', detailed: true },
    mockContext
  );
  
  if (upiCollectResult.success) {
    const data = upiCollectResult.data as any;
    console.log(data.response);
    if (data.relatedTerms) {
      console.log('\nRelated terms:', data.relatedTerms.join(', '));
    }
  }
  
  // Example 2: Two-factor authentication
  console.log('\n═══ Example 2: Explain two-factor authentication ═══\n');
  const tfaResult = await dictionaryTool.execute(
    { term: 'two-factor authentication', detailed: true },
    mockContext
  );
  
  if (tfaResult.success) {
    const data = tfaResult.data as any;
    console.log(data.response);
  }
  
  // Example 3: Tokenization with context
  console.log('\n═══ Example 3: Tokenization in context ═══\n');
  const tokenResult = await dictionaryTool.execute(
    { 
      term: 'tokenization',
      context: 'storing cards for subscription billing',
      detailed: true 
    },
    mockContext
  );
  
  if (tokenResult.success) {
    const data = tokenResult.data as any;
    console.log(data.response);
  }
  
  // Example 4: Payment gateway vs PSP
  console.log('\n═══ Example 4: Payment Gateway ═══\n');
  const pgResult = await dictionaryTool.execute(
    { term: 'payment gateway', detailed: false },
    mockContext
  );
  
  if (pgResult.success) {
    const data = pgResult.data as any;
    console.log(data.response);
  }
  
  console.log('\n═══ Example 5: PSP (Payment Service Provider) ═══\n');
  const pspResult = await dictionaryTool.execute(
    { term: 'PSP', detailed: false },
    mockContext
  );
  
  if (pspResult.success) {
    const data = pspResult.data as any;
    console.log(data.response);
  }
  
  // Example 6: Looking up a term that might not exist
  console.log('\n═══ Example 6: Non-existent term ═══\n');
  const unknownResult = await dictionaryTool.execute(
    { term: 'quantum payment', detailed: true },
    mockContext
  );
  
  if (unknownResult.success) {
    const data = unknownResult.data as any;
    console.log('Found:', data.found);
    console.log(data.response);
    if (data.similarTerms && data.similarTerms.length > 0) {
      console.log('\nSimilar terms found:', data.similarTerms.join(', '));
    }
  }
}

// Additional examples using other dictionary tools
async function demonstrateOtherTools() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║              Additional Dictionary Tools Demo                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  // Import additional tools
  const { 
    createBatchDictionaryTool,
    createSearchGlossaryTool,
    createListCategoriesTool
  } = await import('../src/adk/tools/dictionaryTool');
  
  // Batch lookup
  console.log('═══ Batch Lookup: MDR, EMI, BNPL ═══\n');
  const batchTool = createBatchDictionaryTool();
  const batchResult = await batchTool.execute(
    { terms: ['MDR', 'EMI', 'BNPL'] },
    mockContext
  );
  
  if (batchResult.success) {
    const data = batchResult.data as Record<string, any>;
    for (const [term, info] of Object.entries(data)) {
      console.log(`${term}:`);
      if (info.found) {
        console.log(`  ${info.fullForm ? `(${info.fullForm}) ` : ''}${info.definition}`);
        console.log(`  Category: ${info.category}\n`);
      } else {
        console.log(`  ${info.message}\n`);
      }
    }
  }
  
  // Search glossary
  console.log('═══ Search for "payment" related terms ═══\n');
  const searchTool = createSearchGlossaryTool();
  const searchResult = await searchTool.execute(
    { keyword: 'payment', category: 'payment-method' },
    mockContext
  );
  
  if (searchResult.success) {
    const data = searchResult.data as any;
    console.log(`Found ${data.count} results in category "${data.category}":\n`);
    data.results.slice(0, 5).forEach((result: any) => {
      console.log(`• ${result.term}: ${result.summary}`);
    });
  }
  
  // List categories
  console.log('\n═══ Available Categories ═══\n');
  const categoriesTool = createListCategoriesTool();
  const categoriesResult = await categoriesTool.execute({}, mockContext);
  
  if (categoriesResult.success) {
    const data = categoriesResult.data as Record<string, any>;
    for (const [category, info] of Object.entries(data)) {
      console.log(`${category} (${info.termCount} terms)`);
      console.log(`  ${info.description}`);
      console.log(`  Examples: ${info.sampleTerms.join(', ')}\n`);
    }
  }
}

// Main execution
async function main() {
  try {
    await demonstrateDictionary();
    await demonstrateOtherTools();
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                    Demo Complete!                              ');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('The dictionary tool provides:');
    console.log('• 40+ payment/fintech terms with detailed explanations');
    console.log('• Contextual explanations when needed');
    console.log('• Batch lookup capabilities');
    console.log('• Search functionality');
    console.log('• Category-based organization');
    console.log('\nPerfect for onboarding, documentation, and quick reference!');
  } catch (error) {
    console.error('Error running demo:', error);
    process.exit(1);
  }
}

// Run the demo
if (require.main === module) {
  main();
}