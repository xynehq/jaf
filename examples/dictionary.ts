#!/usr/bin/env tsx
/**
 * Dictionary Tool Example - Core Implementation
 * 
 * Demonstrates using the core dictionary tool with the JAF framework
 */

import { createEngine } from '../src/core/engine';
import { createTraceId, createRunId } from '../src/core/types';
import { 
  dictionaryTool, 
  batchDictionaryTool,
  searchGlossaryTool,
  listCategoriesTool 
} from '../src/tools/dictionaryTool';

async function exampleDictionaryLookup() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║      Payment Dictionary Tool - Core Implementation Demo        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  // Create an engine with dictionary tools
  const engine = createEngine({
    model: 'gpt-4o-mini',
    tools: [dictionaryTool, batchDictionaryTool, searchGlossaryTool, listCategoriesTool]
  });
  
  const traceId = createTraceId('dict-demo-' + Date.now());
  const runId = createRunId('run-' + Date.now());
  
  // Example 1: Ask about UPI collect
  console.log('═══ Example 1: What is UPI collect? ═══\n');
  const response1 = await engine({
    messages: [
      { 
        role: 'user', 
        content: 'What is UPI collect? Please use the dictionary tool to look it up.' 
      }
    ],
    context: {},
    traceId,
    runId
  });
  
  if (response1.type === 'success') {
    console.log('Assistant:', response1.content);
  }
  
  // Example 2: Explain two-factor authentication
  console.log('\n═══ Example 2: Two-Factor Authentication ═══\n');
  const response2 = await engine({
    messages: [
      { 
        role: 'user', 
        content: 'Look up "two-factor authentication" in the dictionary and explain it.' 
      }
    ],
    context: {},
    traceId,
    runId: createRunId('run-2fa-' + Date.now())
  });
  
  if (response2.type === 'success') {
    console.log('Assistant:', response2.content);
  }
  
  // Example 3: Batch lookup
  console.log('\n═══ Example 3: Multiple Terms ═══\n');
  const response3 = await engine({
    messages: [
      { 
        role: 'user', 
        content: 'Look up these payment terms for me: PSP, MDR, and 3DS' 
      }
    ],
    context: {},
    traceId,
    runId: createRunId('run-batch-' + Date.now())
  });
  
  if (response3.type === 'success') {
    console.log('Assistant:', response3.content);
  }
  
  // Example 4: Search for terms
  console.log('\n═══ Example 4: Search for Security Terms ═══\n');
  const response4 = await engine({
    messages: [
      { 
        role: 'user', 
        content: 'Search the glossary for terms related to "security"' 
      }
    ],
    context: {},
    traceId,
    runId: createRunId('run-search-' + Date.now())
  });
  
  if (response4.type === 'success') {
    console.log('Assistant:', response4.content);
  }
  
  // Example 5: List categories
  console.log('\n═══ Example 5: Available Categories ═══\n');
  const response5 = await engine({
    messages: [
      { 
        role: 'user', 
        content: 'What categories of payment terms are available in the dictionary?' 
      }
    ],
    context: {},
    traceId,
    runId: createRunId('run-categories-' + Date.now())
  });
  
  if (response5.type === 'success') {
    console.log('Assistant:', response5.content);
  }
}

// Direct tool execution example
async function exampleDirectExecution() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                  Direct Tool Execution Demo                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  // Execute dictionary tool directly
  console.log('Looking up "tokenization" directly:\n');
  const result = await dictionaryTool.execute(
    { term: 'tokenization', detailed: true },
    {} // Empty context for direct execution
  );
  console.log(result);
  
  // Batch lookup
  console.log('\n\nBatch lookup for EMI, BNPL, KYC:\n');
  const batchResult = await batchDictionaryTool.execute(
    { terms: ['EMI', 'BNPL', 'KYC'] },
    {}
  );
  console.log(batchResult);
  
  // Search
  console.log('\n\nSearching for "payment" in payment-method category:\n');
  const searchResult = await searchGlossaryTool.execute(
    { keyword: 'payment', category: 'payment-method' },
    {}
  );
  console.log(searchResult);
}

// Main function
async function main() {
  try {
    const mode = process.argv[2];
    
    if (mode === 'direct') {
      await exampleDirectExecution();
    } else {
      await exampleDictionaryLookup();
    }
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                        Demo Complete!                          ');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('Error running example:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  console.log(`
Usage:
  npm run example:dictionary         # Run with engine/agent
  npm run example:dictionary direct  # Run direct tool execution
`);
  main();
}

export { exampleDictionaryLookup, exampleDirectExecution };