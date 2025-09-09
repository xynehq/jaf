/**
 * Session Memory Vector Tool Example
 * 
 * Demonstrates vector database storage with FAISS/Vectra and hybrid search capabilities.
 * Shows how to store facts with embeddings and retrieve them using semantic similarity.
 */

import {
  configureVectorMemory,
  storeFactTool,
  searchFactsTool,
  findSimilarFactsTool,
  listFactsTool,
  deleteFactTool,
  getMemoryStatsTool,
  StorageBackend,
  SearchStrategy,
  SessionMemoryContext
} from '../src/tools/sessionMemoryVectorTool';

async function runExample() {
  console.log('🧠 Session Memory Vector Tool Example\n');
  console.log('=' .repeat(60));
  
  // Configure vector memory with Vectra backend and hybrid search
  configureVectorMemory({
    backend: StorageBackend.VECTRA,
    searchStrategy: SearchStrategy.HYBRID,
    hybridAlpha: 0.6, // Slightly favor semantic search
    storePath: './.session-memory-vector-demo'
  });
  
  console.log('✅ Configured with Vectra backend and hybrid search (α=0.6)\n');
  
  // Create session context
  const context: SessionMemoryContext = {
    sessionId: 'vector-demo-001',
    userId: 'demo-user'
  };
  
  console.log('📝 Step 1: Store various facts with categories and tags');
  console.log('-'.repeat(60));
  
  // Store programming facts
  const programmingFacts = [
    {
      key: 'python-intro',
      value: { language: 'Python', year: 1991, creator: 'Guido van Rossum' },
      text: 'Python is a high-level programming language created by Guido van Rossum in 1991. It emphasizes code readability and simplicity.',
      category: 'programming',
      tags: ['python', 'language', 'history']
    },
    {
      key: 'javascript-intro',
      value: { language: 'JavaScript', year: 1995, creator: 'Brendan Eich' },
      text: 'JavaScript is a dynamic programming language created by Brendan Eich in 1995. It is primarily used for web development and runs in browsers.',
      category: 'programming',
      tags: ['javascript', 'language', 'web']
    },
    {
      key: 'react-framework',
      value: { framework: 'React', type: 'UI Library', company: 'Facebook' },
      text: 'React is a JavaScript library for building user interfaces, developed by Facebook. It uses a virtual DOM and component-based architecture.',
      category: 'programming',
      tags: ['react', 'javascript', 'framework', 'frontend']
    },
    {
      key: 'nodejs-runtime',
      value: { runtime: 'Node.js', basedOn: 'V8 Engine', year: 2009 },
      text: 'Node.js is a JavaScript runtime built on Chrome V8 engine. It allows JavaScript to run on servers and build backend applications.',
      category: 'programming',
      tags: ['nodejs', 'javascript', 'backend', 'runtime']
    }
  ];
  
  // Store science facts
  const scienceFacts = [
    {
      key: 'einstein-relativity',
      value: { scientist: 'Albert Einstein', theory: 'Relativity', year: 1905 },
      text: 'Albert Einstein developed the theory of relativity in 1905, revolutionizing our understanding of space, time, and gravity.',
      category: 'science',
      tags: ['physics', 'einstein', 'relativity']
    },
    {
      key: 'dna-structure',
      value: { discovery: 'DNA Structure', scientists: ['Watson', 'Crick'], year: 1953 },
      text: 'James Watson and Francis Crick discovered the double helix structure of DNA in 1953, a breakthrough in molecular biology.',
      category: 'science',
      tags: ['biology', 'dna', 'genetics']
    },
    {
      key: 'quantum-computing',
      value: { field: 'Quantum Computing', principle: 'Superposition' },
      text: 'Quantum computing uses quantum mechanical phenomena like superposition and entanglement to perform computations exponentially faster than classical computers.',
      category: 'science',
      tags: ['quantum', 'computing', 'physics']
    }
  ];
  
  // Store all facts
  for (const fact of [...programmingFacts, ...scienceFacts]) {
    const result = await storeFactTool.execute(fact, context);
    const response = JSON.parse(result as string);
    console.log(`✓ Stored: ${fact.key} (${fact.category})`);
  }
  
  console.log('\n📊 Step 2: Get memory statistics');
  console.log('-'.repeat(60));
  
  let result = await getMemoryStatsTool.execute({}, context);
  let stats = JSON.parse(result as string).stats;
  console.log(`Total facts: ${stats.totalFacts}`);
  console.log(`Categories: ${stats.categories.join(', ')}`);
  console.log(`Tags: ${stats.tags.slice(0, 10).join(', ')}...`);
  console.log(`Backend: ${stats.backend}`);
  console.log(`Search strategy: ${stats.searchStrategy}`);
  
  console.log('\n🔍 Step 3: Semantic search demonstrations');
  console.log('-'.repeat(60));
  
  // Semantic search for web development
  console.log('\nQuery: "web development frontend"');
  result = await searchFactsTool.execute({
    query: 'web development frontend',
    limit: 3
  }, context);
  let searchResults = JSON.parse(result as string);
  console.log(`Found ${searchResults.count} results:`);
  for (const res of searchResults.results) {
    console.log(`  - ${res.key} (score: ${res.score.toFixed(3)}): ${res.text?.substring(0, 60)}...`);
  }
  
  // Semantic search for backend
  console.log('\nQuery: "server-side programming"');
  result = await searchFactsTool.execute({
    query: 'server-side programming',
    limit: 3
  }, context);
  searchResults = JSON.parse(result as string);
  console.log(`Found ${searchResults.count} results:`);
  for (const res of searchResults.results) {
    console.log(`  - ${res.key} (score: ${res.score.toFixed(3)}): ${res.text?.substring(0, 60)}...`);
  }
  
  // Semantic search for scientific discoveries
  console.log('\nQuery: "scientific breakthroughs in biology"');
  result = await searchFactsTool.execute({
    query: 'scientific breakthroughs in biology',
    limit: 3
  }, context);
  searchResults = JSON.parse(result as string);
  console.log(`Found ${searchResults.count} results:`);
  for (const res of searchResults.results) {
    console.log(`  - ${res.key} (score: ${res.score.toFixed(3)}): ${res.text?.substring(0, 60)}...`);
  }
  
  console.log('\n🔄 Step 4: Find similar facts');
  console.log('-'.repeat(60));
  
  console.log('\nFinding facts similar to "react-framework":');
  result = await findSimilarFactsTool.execute({
    key: 'react-framework',
    limit: 3
  }, context);
  let similarResults = JSON.parse(result as string);
  if (similarResults.success) {
    console.log(`Reference: ${similarResults.referenceText?.substring(0, 80)}...`);
    console.log(`\nSimilar facts:`);
    for (const fact of similarResults.similarFacts) {
      console.log(`  - ${fact.key} (similarity: ${fact.score.toFixed(3)})`);
      console.log(`    ${fact.text?.substring(0, 70)}...`);
    }
  }
  
  console.log('\n🏷️ Step 5: Filter by category and tags');
  console.log('-'.repeat(60));
  
  // List programming facts
  console.log('\nListing facts in "programming" category:');
  result = await listFactsTool.execute({
    category: 'programming',
    limit: 10
  }, context);
  let listResults = JSON.parse(result as string);
  console.log(`Found ${listResults.count} programming facts:`);
  for (const fact of listResults.facts) {
    console.log(`  - ${fact.key}: ${fact.text?.substring(0, 50)}...`);
  }
  
  // Search with tag filter
  console.log('\nSearching with tag filter [javascript]:');
  result = await searchFactsTool.execute({
    query: 'building applications',
    tags: ['javascript'],
    limit: 5
  }, context);
  searchResults = JSON.parse(result as string);
  console.log(`Found ${searchResults.count} JavaScript-related results:`);
  for (const res of searchResults.results) {
    console.log(`  - ${res.key}: ${res.text?.substring(0, 60)}...`);
  }
  
  console.log('\n🔬 Step 6: Compare search strategies');
  console.log('-'.repeat(60));
  
  const testQuery = 'JavaScript programming language';
  
  // Keyword search
  console.log(`\nQuery: "${testQuery}"`);
  console.log('\n1. Keyword Search:');
  result = await searchFactsTool.execute({
    query: testQuery,
    strategy: SearchStrategy.KEYWORD,
    limit: 3
  }, context);
  searchResults = JSON.parse(result as string);
  for (const res of searchResults.results) {
    console.log(`  - ${res.key} (score: ${res.score.toFixed(3)})`);
  }
  
  // Semantic search
  console.log('\n2. Semantic Search:');
  result = await searchFactsTool.execute({
    query: testQuery,
    strategy: SearchStrategy.SEMANTIC,
    limit: 3
  }, context);
  searchResults = JSON.parse(result as string);
  for (const res of searchResults.results) {
    console.log(`  - ${res.key} (score: ${res.score.toFixed(3)})`);
  }
  
  // Hybrid search
  console.log('\n3. Hybrid Search (default):');
  result = await searchFactsTool.execute({
    query: testQuery,
    strategy: SearchStrategy.HYBRID,
    limit: 3
  }, context);
  searchResults = JSON.parse(result as string);
  for (const res of searchResults.results) {
    console.log(`  - ${res.key} (score: ${res.score.toFixed(3)})`);
  }
  
  console.log('\n🧪 Step 7: Test different backend configurations');
  console.log('-'.repeat(60));
  
  // Switch to JSON backend (no embeddings)
  console.log('\nSwitching to JSON backend (keyword search only)...');
  configureVectorMemory({
    backend: StorageBackend.JSON,
    searchStrategy: SearchStrategy.KEYWORD
  });
  
  // Store a new fact in JSON mode
  await storeFactTool.execute({
    key: 'rust-language',
    value: { language: 'Rust', year: 2010, focus: 'Memory Safety' },
    text: 'Rust is a systems programming language focused on memory safety without garbage collection.',
    category: 'programming',
    tags: ['rust', 'systems', 'language']
  }, context);
  console.log('✓ Stored fact in JSON backend');
  
  // Search in JSON mode
  result = await searchFactsTool.execute({
    query: 'memory safety programming',
    limit: 3
  }, context);
  searchResults = JSON.parse(result as string);
  console.log('\nKeyword search results (JSON backend):');
  for (const res of searchResults.results) {
    console.log(`  - ${res.key} (score: ${res.score.toFixed(3)})`);
  }
  
  // Switch back to vector backend
  console.log('\nSwitching back to Vectra backend...');
  configureVectorMemory({
    backend: StorageBackend.VECTRA,
    searchStrategy: SearchStrategy.HYBRID,
    hybridAlpha: 0.7
  });
  
  console.log('\n🗑️ Step 8: Delete a fact');
  console.log('-'.repeat(60));
  
  result = await deleteFactTool.execute({ key: 'rust-language' }, context);
  let deleteResult = JSON.parse(result as string);
  console.log(`Deleted: ${deleteResult.message}`);
  
  // Verify deletion
  result = await getMemoryStatsTool.execute({}, context);
  stats = JSON.parse(result as string).stats;
  console.log(`Total facts after deletion: ${stats.totalFacts}`);
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Vector Memory Tool Example Complete!\n');
  console.log('Key Features Demonstrated:');
  console.log('✓ Vector embeddings with Vectra backend');
  console.log('✓ Semantic similarity search');
  console.log('✓ Hybrid search (keyword + semantic)');
  console.log('✓ Finding similar facts');
  console.log('✓ Category and tag filtering');
  console.log('✓ Configurable backends (JSON/Vectra)');
  console.log('✓ Configurable search strategies');
}

// Run the example
if (require.main === module) {
  console.log('🚀 Starting Vector Memory Tool Demo...\n');
  console.log('Note: First run will download the embedding model (~25MB).\n');
  runExample().catch(console.error);
}

export { runExample };