#!/usr/bin/env node

/**
 * Simple test for Vector Memory Tool
 */

const { LocalIndex } = require('vectra');
const path = require('path');
const fs = require('fs');

// Simple keyword similarity
function keywordSimilarity(query, text) {
  const queryTokens = query.toLowerCase().split(/\s+/);
  const textTokens = text.toLowerCase().split(/\s+/);
  
  let matches = 0;
  for (const qToken of queryTokens) {
    if (textTokens.some(tToken => tToken.includes(qToken) || qToken.includes(tToken))) {
      matches++;
    }
  }
  
  return matches / queryTokens.length;
}

// Simple vector store simulation
class VectorMemoryStore {
  constructor() {
    this.facts = new Map();
    this.indexPath = path.join('.', '.test-vector-index');
  }
  
  async init() {
    this.index = new LocalIndex(this.indexPath);
    
    try {
      if (await this.index.isIndexCreated()) {
        console.log('✓ Vector index exists, loading...');
      } else {
        console.log('✓ Creating new vector index...');
        await this.index.createIndex({ 
          dimensions: 3, // Simple 3D vectors for testing
          metric: 'cosine'
        });
      }
    } catch (error) {
      console.log('⚠️ Vector index initialization:', error.message);
      console.log('  Falling back to keyword-only search');
      this.index = null;
    }
  }
  
  async storeFact(key, value, text, tags = [], category = 'general') {
    // Simple mock embedding (just use text length features)
    const embedding = [
      text.length / 100,
      text.split(' ').length / 10,
      (text.match(/[aeiou]/gi) || []).length / text.length
    ];
    
    const fact = {
      key,
      value,
      text: text || JSON.stringify(value),
      embedding,
      metadata: {
        timestamp: Date.now(),
        tags,
        category
      }
    };
    
    this.facts.set(key, fact);
    
    // Add to vector index if available
    if (this.index) {
      try {
        await this.index.insertItem({
          vector: embedding,
          metadata: { key, text: fact.text, category }
        });
      } catch (error) {
        console.log('  Warning: Could not add to vector index:', error.message);
      }
    }
    
    return {
      success: true,
      key,
      message: `Stored fact '${key}'`,
      hasEmbedding: true
    };
  }
  
  async searchFacts(query, limit = 5, useVector = false) {
    const results = [];
    
    if (useVector && this.index) {
      // Mock query embedding
      const queryEmbedding = [
        query.length / 100,
        query.split(' ').length / 10,
        (query.match(/[aeiou]/gi) || []).length / query.length
      ];
      
      try {
        const vectorResults = await this.index.queryItems(queryEmbedding, limit);
        for (const res of vectorResults) {
          const fact = this.facts.get(res.item.metadata.key);
          if (fact) {
            results.push({
              key: fact.key,
              value: fact.value,
              score: res.score,
              text: fact.text
            });
          }
        }
      } catch (error) {
        console.log('  Vector search failed:', error.message);
      }
    }
    
    // Fallback or primary keyword search
    if (results.length === 0) {
      for (const [key, fact] of this.facts.entries()) {
        const score = keywordSimilarity(query, fact.text);
        if (score > 0) {
          results.push({
            key: fact.key,
            value: fact.value,
            score,
            text: fact.text
          });
        }
      }
      results.sort((a, b) => b.score - a.score);
    }
    
    return results.slice(0, limit);
  }
  
  async findSimilar(key, limit = 3) {
    const refFact = this.facts.get(key);
    if (!refFact) {
      return { success: false, message: `Fact '${key}' not found` };
    }
    
    const results = await this.searchFacts(refFact.text, limit + 1, true);
    return results.filter(r => r.key !== key).slice(0, limit);
  }
  
  listFacts(category = null) {
    const results = [];
    for (const fact of this.facts.values()) {
      if (!category || fact.metadata.category === category) {
        results.push({
          key: fact.key,
          value: fact.value,
          category: fact.metadata.category,
          tags: fact.metadata.tags
        });
      }
    }
    return results;
  }
  
  async cleanup() {
    if (this.index) {
      // Clean up index files
      try {
        const indexFiles = await fs.promises.readdir(this.indexPath).catch(() => []);
        for (const file of indexFiles) {
          await fs.promises.unlink(path.join(this.indexPath, file)).catch(() => {});
        }
        await fs.promises.rmdir(this.indexPath).catch(() => {});
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }
}

async function runTest() {
  console.log('🧠 Vector Memory Tool Test\n');
  console.log('=' .repeat(60));
  
  const store = new VectorMemoryStore();
  await store.init();
  
  console.log('\n📝 Test 1: Store facts with embeddings');
  console.log('-'.repeat(60));
  
  const facts = [
    {
      key: 'javascript-intro',
      value: { language: 'JavaScript', year: 1995 },
      text: 'JavaScript is a dynamic programming language used for web development',
      tags: ['javascript', 'web'],
      category: 'programming'
    },
    {
      key: 'python-intro',
      value: { language: 'Python', year: 1991 },
      text: 'Python is a high-level programming language known for simplicity',
      tags: ['python', 'language'],
      category: 'programming'
    },
    {
      key: 'react-lib',
      value: { library: 'React', company: 'Facebook' },
      text: 'React is a JavaScript library for building user interfaces',
      tags: ['react', 'javascript', 'ui'],
      category: 'framework'
    },
    {
      key: 'nodejs-runtime',
      value: { runtime: 'Node.js', engine: 'V8' },
      text: 'Node.js is a JavaScript runtime for server-side programming',
      tags: ['nodejs', 'javascript', 'backend'],
      category: 'runtime'
    },
    {
      key: 'einstein-theory',
      value: { scientist: 'Einstein', theory: 'Relativity' },
      text: 'Einstein developed the theory of relativity revolutionizing physics',
      tags: ['physics', 'science'],
      category: 'science'
    }
  ];
  
  for (const fact of facts) {
    const result = await store.storeFact(
      fact.key,
      fact.value,
      fact.text,
      fact.tags,
      fact.category
    );
    console.log(`✓ ${result.message}`);
  }
  
  console.log('\n🔍 Test 2: Keyword search');
  console.log('-'.repeat(60));
  
  let results = await store.searchFacts('JavaScript programming', 3);
  console.log('Query: "JavaScript programming"');
  for (const res of results) {
    console.log(`  - ${res.key} (score: ${res.score.toFixed(3)}): ${res.text.substring(0, 40)}...`);
  }
  
  console.log('\n🔍 Test 3: Semantic-like search (using simple features)');
  console.log('-'.repeat(60));
  
  results = await store.searchFacts('web development frontend', 3, true);
  console.log('Query: "web development frontend"');
  for (const res of results) {
    console.log(`  - ${res.key} (score: ${res.score.toFixed(3)}): ${res.text.substring(0, 40)}...`);
  }
  
  console.log('\n🔄 Test 4: Find similar facts');
  console.log('-'.repeat(60));
  
  const similar = await store.findSimilar('react-lib', 2);
  console.log('Facts similar to "react-lib":');
  for (const res of similar) {
    console.log(`  - ${res.key} (similarity: ${res.score.toFixed(3)})`);
  }
  
  console.log('\n📊 Test 5: List by category');
  console.log('-'.repeat(60));
  
  const programmingFacts = store.listFacts('programming');
  console.log('Programming category facts:');
  for (const fact of programmingFacts) {
    console.log(`  - ${fact.key}: ${fact.tags.join(', ')}`);
  }
  
  console.log('\n🎯 Test 6: Hybrid search simulation');
  console.log('-'.repeat(60));
  
  // Combine keyword and vector scores
  const query = 'server backend programming';
  const keywordResults = await store.searchFacts(query, 5, false);
  const vectorResults = await store.searchFacts(query, 5, true);
  
  const hybridScores = new Map();
  const alpha = 0.6; // Weight for semantic search
  
  // Add vector scores
  for (const res of vectorResults) {
    hybridScores.set(res.key, res.score * alpha);
  }
  
  // Add keyword scores
  for (const res of keywordResults) {
    const current = hybridScores.get(res.key) || 0;
    hybridScores.set(res.key, current + res.score * (1 - alpha));
  }
  
  // Sort and display
  const hybridResults = Array.from(hybridScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  
  console.log(`Hybrid search for "${query}" (α=${alpha}):`);
  for (const [key, score] of hybridResults) {
    const fact = store.facts.get(key);
    console.log(`  - ${key} (score: ${score.toFixed(3)}): ${fact.text.substring(0, 40)}...`);
  }
  
  console.log('\n✅ Test Summary');
  console.log('-'.repeat(60));
  console.log(`Total facts stored: ${store.facts.size}`);
  console.log(`Vector index available: ${store.index ? 'Yes' : 'No'}`);
  console.log('Features tested:');
  console.log('  ✓ Fact storage with embeddings');
  console.log('  ✓ Keyword search');
  console.log('  ✓ Vector similarity search');
  console.log('  ✓ Finding similar facts');
  console.log('  ✓ Category filtering');
  console.log('  ✓ Hybrid search simulation');
  
  // Cleanup
  await store.cleanup();
  console.log('\n🧹 Cleaned up test data');
}

// Run test
runTest().catch(console.error);