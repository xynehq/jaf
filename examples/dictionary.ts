/**
 * Dictionary Tool Example
 * 
 * Demonstrates how to use the dictionary tool for looking up
 * payment and fintech terms with the JAF framework.
 */

import { createAgent, createSession, runAgent } from '../src/adk/agents';
import { Model } from '../src/adk/models';
import { 
  createDictionaryTool, 
  createBatchDictionaryTool,
  createListCategoriesTool,
  createSearchGlossaryTool 
} from '../src/adk/tools/dictionaryTool';

// Example 1: Simple term lookup
async function exampleSimpleLookup() {
  console.log('\n=== Example 1: Simple Term Lookup ===\n');
  
  // Create the dictionary tool
  const dictionaryTool = createDictionaryTool();
  
  // Create an agent with the dictionary tool
  const agent = createAgent({
    name: 'PaymentExpert',
    model: Model.GEMINI_15_FLASH,
    instruction: 'You are a payment industry expert. Help users understand payment terms and concepts.',
    tools: [dictionaryTool]
  });
  
  // Create a session
  const session = createSession('dictionary-demo', 'user123');
  
  // Example: Look up "UPI collect"
  console.log('Q: What is UPI collect?');
  const response1 = await runAgent(
    agent,
    session,
    'What is UPI collect?'
  );
  console.log('A:', response1.content);
  
  // Example: Look up "two-factor authentication"  
  console.log('\nQ: Explain two-factor authentication');
  const response2 = await runAgent(
    agent,
    session,
    'Explain two-factor authentication'
  );
  console.log('A:', response2.content);
}

// Example 2: Contextual explanations
async function exampleContextualLookup() {
  console.log('\n=== Example 2: Contextual Explanations ===\n');
  
  const dictionaryTool = createDictionaryTool();
  
  const agent = createAgent({
    name: 'ImplementationHelper',
    model: Model.GEMINI_15_FLASH,
    instruction: 'Help developers understand payment terms in their implementation context.',
    tools: [dictionaryTool]
  });
  
  const session = createSession('context-demo', 'dev456');
  
  // Look up term with context
  console.log('Q: What is tokenization in the context of storing card details?');
  const response = await runAgent(
    agent,
    session,
    'What is tokenization in the context of storing card details for recurring payments?'
  );
  console.log('A:', response.content);
}

// Example 3: Batch lookups
async function exampleBatchLookup() {
  console.log('\n=== Example 3: Batch Term Lookups ===\n');
  
  const batchTool = createBatchDictionaryTool();
  
  const agent = createAgent({
    name: 'OnboardingAssistant',
    model: Model.GEMINI_15_FLASH,
    instruction: 'Help new team members understand multiple payment terms quickly.',
    tools: [batchTool]
  });
  
  const session = createSession('batch-demo', 'new789');
  
  console.log('Q: Explain these terms: PSP, MDR, 3DS, KYC');
  const response = await runAgent(
    agent,
    session,
    'Please explain these payment terms I need to know: PSP, MDR, 3DS, KYC'
  );
  console.log('A:', response.content);
}

// Example 4: Searching the glossary
async function exampleSearch() {
  console.log('\n=== Example 4: Searching Glossary ===\n');
  
  const searchTool = createSearchGlossaryTool();
  const dictionaryTool = createDictionaryTool();
  
  const agent = createAgent({
    name: 'SearchAssistant',
    model: Model.GEMINI_15_FLASH,
    instruction: 'Help users find and understand relevant payment terms.',
    tools: [searchTool, dictionaryTool]
  });
  
  const session = createSession('search-demo', 'search101');
  
  console.log('Q: Show me all terms related to "payment methods"');
  const response = await runAgent(
    agent,
    session,
    'What payment methods are available in the glossary?'
  );
  console.log('A:', response.content);
}

// Example 5: Category exploration
async function exampleCategories() {
  console.log('\n=== Example 5: Exploring Categories ===\n');
  
  const categoriesTool = createListCategoriesTool();
  const searchTool = createSearchGlossaryTool();
  
  const agent = createAgent({
    name: 'CategoryExplorer',
    model: Model.GEMINI_15_FLASH,
    instruction: 'Help users explore payment terms by category.',
    tools: [categoriesTool, searchTool]
  });
  
  const session = createSession('category-demo', 'cat202');
  
  console.log('Q: What categories of payment terms are available?');
  const response = await runAgent(
    agent,
    session,
    'Show me all the categories of payment terms you have'
  );
  console.log('A:', response.content);
}

// Example 6: Direct tool execution (without agent)
async function exampleDirectToolUse() {
  console.log('\n=== Example 6: Direct Tool Execution ===\n');
  
  const dictionaryTool = createDictionaryTool();
  
  // Mock context for direct execution
  const mockContext = {
    agent: {} as any,
    session: {} as any,
    message: {} as any,
    actions: {}
  };
  
  // Look up UPI
  console.log('Looking up "UPI" directly:');
  const upiResult = await dictionaryTool.execute(
    { term: 'UPI', detailed: true },
    mockContext
  );
  console.log(JSON.stringify(upiResult, null, 2));
  
  // Look up with context
  console.log('\nLooking up "3DS" with context:');
  const threedsResult = await dictionaryTool.execute(
    { 
      term: '3DS', 
      context: 'implementing checkout flow for European customers',
      detailed: true 
    },
    mockContext
  );
  console.log(JSON.stringify(threedsResult, null, 2));
}

// Example 7: Building a chatbot with dictionary
async function exampleChatbot() {
  console.log('\n=== Example 7: Payment Terms Chatbot ===\n');
  
  // Create all dictionary tools
  const tools = [
    createDictionaryTool(),
    createBatchDictionaryTool(),
    createSearchGlossaryTool(),
    createListCategoriesTool()
  ];
  
  const chatbot = createAgent({
    name: 'PaymentGlossaryBot',
    model: Model.GEMINI_15_FLASH,
    instruction: `You are a helpful payment terms assistant. You can:
    1. Explain individual payment/fintech terms
    2. Look up multiple terms at once
    3. Search for terms by keyword
    4. Show available categories
    5. Provide contextual explanations for implementation
    
    Always use the appropriate tool to provide accurate definitions from the glossary.`,
    tools
  });
  
  const session = createSession('chatbot-demo', 'chat303');
  
  // Simulate conversation
  const queries = [
    "What payment methods do you know about?",
    "Explain UPI and how it works",
    "What's the difference between PSP and payment gateway?",
    "I'm implementing card payments - what security terms should I know?",
    "Search for all terms related to compliance"
  ];
  
  for (const query of queries) {
    console.log(`User: ${query}`);
    const response = await runAgent(chatbot, session, query);
    console.log(`Bot: ${response.content}\n`);
  }
}

// Main execution
async function main() {
  try {
    // Run examples based on command line argument
    const example = process.argv[2];
    
    switch (example) {
      case '1':
        await exampleSimpleLookup();
        break;
      case '2':
        await exampleContextualLookup();
        break;
      case '3':
        await exampleBatchLookup();
        break;
      case '4':
        await exampleSearch();
        break;
      case '5':
        await exampleCategories();
        break;
      case '6':
        await exampleDirectToolUse();
        break;
      case '7':
        await exampleChatbot();
        break;
      default:
        console.log('Running all examples...\n');
        await exampleSimpleLookup();
        await exampleContextualLookup();
        await exampleBatchLookup();
        await exampleSearch();
        await exampleCategories();
        await exampleDirectToolUse();
        await exampleChatbot();
    }
  } catch (error) {
    console.error('Error running examples:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  console.log(`
╔══════════════════════════════════════════════╗
║     Payment Dictionary Tool Examples         ║
║                                              ║
║  Usage: npm run example:dictionary [number]  ║
║                                              ║
║  Examples:                                   ║
║  1 - Simple term lookup                      ║
║  2 - Contextual explanations                 ║
║  3 - Batch lookups                          ║
║  4 - Search glossary                        ║
║  5 - Explore categories                     ║
║  6 - Direct tool execution                  ║
║  7 - Payment chatbot                        ║
║                                              ║
║  Run without number to see all examples     ║
╚══════════════════════════════════════════════╝
`);
  
  main().catch(console.error);
}

export {
  exampleSimpleLookup,
  exampleContextualLookup,
  exampleBatchLookup,
  exampleSearch,
  exampleCategories,
  exampleDirectToolUse,
  exampleChatbot
};