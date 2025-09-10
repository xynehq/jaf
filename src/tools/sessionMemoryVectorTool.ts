/**
 * Session Memory Vector Tool - Enhanced Implementation with Vector DB
 * 
 * Provides vector database storage using FAISS/Vectra with hybrid search capabilities.
 * Supports both keyword-based and semantic similarity search for facts retrieval.
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { Tool } from '../core/types';
import { LocalIndex } from 'vectra';
import { pipeline } from '@xenova/transformers';

// Context type for session memory tools
export type SessionMemoryContext = {
  sessionId?: string;
  userId?: string;
  [key: string]: any;
};

// Storage backend types
export enum StorageBackend {
  JSON = 'json',
  FAISS = 'faiss',
  VECTRA = 'vectra'
}

// Search strategy types  
export enum SearchStrategy {
  KEYWORD = 'keyword',
  SEMANTIC = 'semantic',
  HYBRID = 'hybrid'
}

// Memory item with metadata
interface MemoryItem {
  key: string;
  value: unknown;
  text?: string; // Text representation for semantic search
  embedding?: number[]; // Vector embedding
  metadata?: {
    timestamp: number;
    tags?: string[];
    category?: string;
  };
}

// Configuration for vector storage
export interface VectorMemoryConfig {
  backend?: StorageBackend;
  searchStrategy?: SearchStrategy;
  embeddingModel?: string;
  storePath?: string;
  vectorDimensions?: number;
  hybridAlpha?: number; // Weight for hybrid search (0 = pure keyword, 1 = pure semantic)
}

// Default configuration
const DEFAULT_CONFIG: Required<VectorMemoryConfig> = {
  backend: StorageBackend.VECTRA,
  searchStrategy: SearchStrategy.HYBRID,
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  storePath: process.env.SESSION_MEMORY_PATH || path.join(process.cwd(), '.session-memory-vector'),
  vectorDimensions: 384, // Default for all-MiniLM-L6-v2
  hybridAlpha: 0.5
};

// Global configuration and state
let globalConfig = { ...DEFAULT_CONFIG };
let embeddingPipeline: any = null;
let vectorIndices: Map<string, LocalIndex> = new Map();

/**
 * Initialize embedding pipeline
 */
const initEmbeddingPipeline = async () => {
  if (!embeddingPipeline) {
    embeddingPipeline = await pipeline('feature-extraction', globalConfig.embeddingModel);
  }
  return embeddingPipeline;
};

/**
 * Generate embedding for text
 */
const generateEmbedding = async (text: string): Promise<number[]> => {
  const pipe = await initEmbeddingPipeline();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
};

/**
 * Get or create vector index for session
 */
const getVectorIndex = async (sessionId: string): Promise<LocalIndex> => {
  if (!vectorIndices.has(sessionId)) {
    const indexPath = path.join(globalConfig.storePath, `${sessionId}.vectra`);
    const index = new LocalIndex(indexPath);
    
    if (await index.isIndexCreated()) {
      await index.beginUpdate();
    } else {
      await index.createIndex({ 
        dimensions: globalConfig.vectorDimensions,
        metric: 'cosine'
      });
    }
    
    vectorIndices.set(sessionId, index);
  }
  
  return vectorIndices.get(sessionId)!;
};

/**
 * Compute keyword similarity score
 */
const keywordSimilarity = (query: string, text: string): number => {
  const queryTokens = query.toLowerCase().split(/\s+/);
  const textTokens = text.toLowerCase().split(/\s+/);
  
  let matches = 0;
  for (const qToken of queryTokens) {
    if (textTokens.some(tToken => tToken.includes(qToken) || qToken.includes(tToken))) {
      matches++;
    }
  }
  
  return matches / queryTokens.length;
};

/**
 * Perform hybrid search combining keyword and semantic similarity
 */
const hybridSearch = async (
  index: LocalIndex,
  query: string,
  items: MemoryItem[],
  limit: number = 10
): Promise<Array<{ item: MemoryItem; score: number }>> => {
  const results: Array<{ item: MemoryItem; score: number }> = [];
  
  if (globalConfig.searchStrategy === SearchStrategy.KEYWORD) {
    // Pure keyword search
    for (const item of items) {
      const text = item.text || JSON.stringify(item.value);
      const score = keywordSimilarity(query, text);
      if (score > 0) {
        results.push({ item, score });
      }
    }
  } else if (globalConfig.searchStrategy === SearchStrategy.SEMANTIC) {
    // Pure semantic search
    const queryEmbedding = await generateEmbedding(query);
    const searchResults = await index.queryItems(queryEmbedding, limit);
    
    for (const result of searchResults) {
      const item = items.find(i => i.key === result.item.metadata.key);
      if (item) {
        results.push({ item, score: result.score });
      }
    }
  } else {
    // Hybrid search
    const queryEmbedding = await generateEmbedding(query);
    const semanticResults = await index.queryItems(queryEmbedding, limit * 2);
    
    const scoreMap = new Map<string, number>();
    
    // Add semantic scores
    for (const result of semanticResults) {
      scoreMap.set(result.item.metadata.key, result.score * globalConfig.hybridAlpha);
    }
    
    // Add keyword scores
    for (const item of items) {
      const text = item.text || JSON.stringify(item.value);
      const keywordScore = keywordSimilarity(query, text) * (1 - globalConfig.hybridAlpha);
      
      const currentScore = scoreMap.get(item.key) || 0;
      scoreMap.set(item.key, currentScore + keywordScore);
    }
    
    // Combine results
    for (const [key, score] of scoreMap.entries()) {
      const item = items.find(i => i.key === key);
      if (item && score > 0) {
        results.push({ item, score });
      }
    }
  }
  
  // Sort by score and limit
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
};

/**
 * Configure the vector memory system
 */
export const configureVectorMemory = (config: VectorMemoryConfig) => {
  globalConfig = { ...DEFAULT_CONFIG, ...config };
  // Clear cached indices when config changes
  vectorIndices.clear();
  embeddingPipeline = null;
};

/**
 * Store a fact with vector embedding
 */
export const storeFactTool: Tool<
  { 
    key: string; 
    value: unknown; 
    text?: string;
    tags?: string[];
    category?: string;
    overwrite?: boolean;
  },
  SessionMemoryContext
> = {
  schema: {
    name: 'storeFact',
    description: 'Store a fact with vector embedding for semantic search',
    parameters: z.object({
      key: z.string().describe('Unique identifier for the fact'),
      value: z.unknown().describe('The fact data to store'),
      text: z.string().optional().describe('Text representation for semantic search'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
      category: z.string().optional().describe('Category for the fact'),
      overwrite: z.boolean().optional().default(false).describe('Whether to overwrite existing fact')
    }) as z.ZodType<{ 
      key: string; 
      value: unknown; 
      text?: string;
      tags?: string[];
      category?: string;
      overwrite?: boolean;
    }>
  },
  needsApproval: false,
  execute: async ({ key, value, text, tags, category, overwrite = false }, context) => {
    const sessionId = context.sessionId || context.userId || 'default-session';
    
    try {
      // Load existing items
      const jsonPath = path.join(globalConfig.storePath, `${sessionId}.json`);
      let items: MemoryItem[] = [];
      
      if (existsSync(jsonPath)) {
        const data = await fs.readFile(jsonPath, 'utf-8');
        items = JSON.parse(data);
      }
      
      // Check for existing item
      const existingIndex = items.findIndex(i => i.key === key);
      if (existingIndex >= 0 && !overwrite) {
        return JSON.stringify({
          success: false,
          message: `Fact '${key}' already exists. Set overwrite=true to update.`,
          existingValue: items[existingIndex].value
        });
      }
      
      // Create text representation if not provided
      const factText = text || (typeof value === 'string' ? value : JSON.stringify(value));
      
      // Generate embedding if using vector backend
      let embedding: number[] | undefined;
      if (globalConfig.backend !== StorageBackend.JSON) {
        embedding = await generateEmbedding(factText);
        
        // Add to vector index
        const index = await getVectorIndex(sessionId);
        
        if (existingIndex >= 0) {
          // Update existing item in vector index
          await index.deleteItem(key);
        }
        
        await index.insertItem({
          vector: embedding,
          metadata: { 
            key,
            text: factText,
            tags: tags || [],
            category: category || 'general'
          }
        });
        
        await index.endUpdate();
      }
      
      // Create memory item
      const item: MemoryItem = {
        key,
        value,
        text: factText,
        embedding,
        metadata: {
          timestamp: Date.now(),
          tags,
          category
        }
      };
      
      // Update or add item
      if (existingIndex >= 0) {
        items[existingIndex] = item;
      } else {
        items.push(item);
      }
      
      // Save to JSON
      await fs.mkdir(path.dirname(jsonPath), { recursive: true });
      await fs.writeFile(jsonPath, JSON.stringify(items, null, 2), 'utf-8');
      
      return JSON.stringify({
        success: true,
        key,
        message: existingIndex >= 0 
          ? `Updated fact '${key}' with vector embedding`
          : `Stored fact '${key}' with vector embedding`,
        backend: globalConfig.backend,
        hasEmbedding: !!embedding
      });
      
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to store fact',
        key
      });
    }
  }
};

/**
 * Search for facts using hybrid search
 */
export const searchFactsTool: Tool<
  { 
    query: string;
    limit?: number;
    strategy?: SearchStrategy;
    category?: string;
    tags?: string[];
  },
  SessionMemoryContext
> = {
  schema: {
    name: 'searchFacts',
    description: 'Search for facts using keyword, semantic, or hybrid search',
    parameters: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().default(10).describe('Maximum number of results'),
      strategy: z.enum(['keyword', 'semantic', 'hybrid']).optional().describe('Search strategy to use'),
      category: z.string().optional().describe('Filter by category'),
      tags: z.array(z.string()).optional().describe('Filter by tags')
    }) as z.ZodType<{ 
      query: string;
      limit?: number;
      strategy?: SearchStrategy;
      category?: string;
      tags?: string[];
    }>
  },
  needsApproval: false,
  execute: async ({ query, limit = 10, strategy, category, tags }, context) => {
    const sessionId = context.sessionId || context.userId || 'default-session';
    
    try {
      // Load items
      const jsonPath = path.join(globalConfig.storePath, `${sessionId}.json`);
      
      if (!existsSync(jsonPath)) {
        return JSON.stringify({
          success: true,
          results: [],
          message: 'No facts found in memory'
        });
      }
      
      const data = await fs.readFile(jsonPath, 'utf-8');
      let items: MemoryItem[] = JSON.parse(data);
      
      // Apply filters
      if (category) {
        items = items.filter(i => i.metadata?.category === category);
      }
      
      if (tags && tags.length > 0) {
        items = items.filter(i => 
          tags.some(tag => i.metadata?.tags?.includes(tag))
        );
      }
      
      // Use specified strategy or global config
      const searchStrategy = strategy || globalConfig.searchStrategy;
      const originalStrategy = globalConfig.searchStrategy;
      
      if (strategy) {
        globalConfig.searchStrategy = strategy;
      }
      
      // Perform search
      let results: Array<{ item: MemoryItem; score: number }> = [];
      
      if (globalConfig.backend === StorageBackend.JSON) {
        // Fallback to keyword search for JSON backend
        for (const item of items) {
          const text = item.text || JSON.stringify(item.value);
          const score = keywordSimilarity(query, text);
          if (score > 0) {
            results.push({ item, score });
          }
        }
        results.sort((a, b) => b.score - a.score);
        results = results.slice(0, limit);
      } else {
        // Use vector index for search
        const index = await getVectorIndex(sessionId);
        results = await hybridSearch(index, query, items, limit);
      }
      
      // Restore original strategy
      globalConfig.searchStrategy = originalStrategy;
      
      // Format results
      const formattedResults = results.map(r => ({
        key: r.item.key,
        value: r.item.value,
        score: r.score,
        text: r.item.text,
        metadata: r.item.metadata
      }));
      
      return JSON.stringify({
        success: true,
        query,
        strategy: searchStrategy,
        backend: globalConfig.backend,
        count: formattedResults.length,
        results: formattedResults,
        message: `Found ${formattedResults.length} matching facts`
      });
      
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
        query
      });
    }
  }
};

/**
 * Get similar facts based on a reference fact
 */
export const findSimilarFactsTool: Tool<
  { 
    key: string;
    limit?: number;
  },
  SessionMemoryContext
> = {
  schema: {
    name: 'findSimilarFacts',
    description: 'Find facts similar to a reference fact',
    parameters: z.object({
      key: z.string().describe('Key of the reference fact'),
      limit: z.number().optional().default(5).describe('Maximum number of similar facts')
    }) as z.ZodType<{ 
      key: string;
      limit?: number;
    }>
  },
  needsApproval: false,
  execute: async ({ key, limit = 5 }, context) => {
    const sessionId = context.sessionId || context.userId || 'default-session';
    
    try {
      // Load items
      const jsonPath = path.join(globalConfig.storePath, `${sessionId}.json`);
      
      if (!existsSync(jsonPath)) {
        return JSON.stringify({
          success: false,
          message: 'No facts found in memory'
        });
      }
      
      const data = await fs.readFile(jsonPath, 'utf-8');
      const items: MemoryItem[] = JSON.parse(data);
      
      // Find reference item
      const refItem = items.find(i => i.key === key);
      if (!refItem) {
        return JSON.stringify({
          success: false,
          message: `Fact '${key}' not found`
        });
      }
      
      // Use the text of the reference item as query
      const query = refItem.text || JSON.stringify(refItem.value);
      
      // Search for similar items (excluding the reference)
      const otherItems = items.filter(i => i.key !== key);
      
      let results: Array<{ item: MemoryItem; score: number }> = [];
      
      if (globalConfig.backend === StorageBackend.JSON) {
        // Keyword similarity
        for (const item of otherItems) {
          const text = item.text || JSON.stringify(item.value);
          const score = keywordSimilarity(query, text);
          if (score > 0) {
            results.push({ item, score });
          }
        }
      } else {
        // Vector similarity
        const index = await getVectorIndex(sessionId);
        results = await hybridSearch(index, query, otherItems, limit);
      }
      
      // Sort and limit
      results.sort((a, b) => b.score - a.score);
      results = results.slice(0, limit);
      
      // Format results
      const formattedResults = results.map(r => ({
        key: r.item.key,
        value: r.item.value,
        score: r.score,
        text: r.item.text,
        metadata: r.item.metadata
      }));
      
      return JSON.stringify({
        success: true,
        referenceKey: key,
        referenceText: refItem.text,
        count: formattedResults.length,
        similarFacts: formattedResults,
        message: `Found ${formattedResults.length} similar facts`
      });
      
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to find similar facts',
        key
      });
    }
  }
};

/**
 * Delete a fact from memory
 */
export const deleteFactTool: Tool<
  { key: string },
  SessionMemoryContext
> = {
  schema: {
    name: 'deleteFact',
    description: 'Delete a fact from memory',
    parameters: z.object({
      key: z.string().describe('Key of the fact to delete')
    }) as z.ZodType<{ key: string }>
  },
  needsApproval: false,
  execute: async ({ key }, context) => {
    const sessionId = context.sessionId || context.userId || 'default-session';
    
    try {
      // Load items
      const jsonPath = path.join(globalConfig.storePath, `${sessionId}.json`);
      
      if (!existsSync(jsonPath)) {
        return JSON.stringify({
          success: false,
          message: 'No facts found in memory'
        });
      }
      
      const data = await fs.readFile(jsonPath, 'utf-8');
      const items: MemoryItem[] = JSON.parse(data);
      
      // Find and remove item
      const index = items.findIndex(i => i.key === key);
      if (index < 0) {
        return JSON.stringify({
          success: false,
          message: `Fact '${key}' not found`
        });
      }
      
      const deletedItem = items[index];
      items.splice(index, 1);
      
      // Remove from vector index if using vector backend
      if (globalConfig.backend !== StorageBackend.JSON) {
        const vectorIndex = await getVectorIndex(sessionId);
        await vectorIndex.deleteItem(key);
        await vectorIndex.endUpdate();
      }
      
      // Save updated items
      await fs.writeFile(jsonPath, JSON.stringify(items, null, 2), 'utf-8');
      
      return JSON.stringify({
        success: true,
        key,
        deletedValue: deletedItem.value,
        message: `Deleted fact '${key}'`
      });
      
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete fact',
        key
      });
    }
  }
};

/**
 * List all facts with optional filtering
 */
export const listFactsTool: Tool<
  { 
    category?: string;
    tags?: string[];
    limit?: number;
  },
  SessionMemoryContext
> = {
  schema: {
    name: 'listFacts',
    description: 'List all stored facts with optional filtering',
    parameters: z.object({
      category: z.string().optional().describe('Filter by category'),
      tags: z.array(z.string()).optional().describe('Filter by tags'),
      limit: z.number().optional().default(50).describe('Maximum number of facts to return')
    }) as z.ZodType<{ 
      category?: string;
      tags?: string[];
      limit?: number;
    }>
  },
  needsApproval: false,
  execute: async ({ category, tags, limit = 50 }, context) => {
    const sessionId = context.sessionId || context.userId || 'default-session';
    
    try {
      // Load items
      const jsonPath = path.join(globalConfig.storePath, `${sessionId}.json`);
      
      if (!existsSync(jsonPath)) {
        return JSON.stringify({
          success: true,
          facts: [],
          count: 0,
          message: 'No facts stored in memory'
        });
      }
      
      const data = await fs.readFile(jsonPath, 'utf-8');
      let items: MemoryItem[] = JSON.parse(data);
      
      // Apply filters
      if (category) {
        items = items.filter(i => i.metadata?.category === category);
      }
      
      if (tags && tags.length > 0) {
        items = items.filter(i => 
          tags.some(tag => i.metadata?.tags?.includes(tag))
        );
      }
      
      // Sort by timestamp (newest first) and limit
      items.sort((a, b) => 
        (b.metadata?.timestamp || 0) - (a.metadata?.timestamp || 0)
      );
      items = items.slice(0, limit);
      
      // Format results
      const facts = items.map(item => ({
        key: item.key,
        value: item.value,
        text: item.text,
        metadata: item.metadata
      }));
      
      return JSON.stringify({
        success: true,
        count: facts.length,
        totalCount: items.length,
        facts,
        message: `Listed ${facts.length} facts`
      });
      
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list facts'
      });
    }
  }
};

/**
 * Get memory statistics
 */
export const getMemoryStatsTool: Tool<
  {},
  SessionMemoryContext
> = {
  schema: {
    name: 'getMemoryStats',
    description: 'Get statistics about stored facts',
    parameters: z.object({}) as z.ZodType<{}>
  },
  needsApproval: false,
  execute: async ({}, context) => {
    const sessionId = context.sessionId || context.userId || 'default-session';
    
    try {
      const jsonPath = path.join(globalConfig.storePath, `${sessionId}.json`);
      
      if (!existsSync(jsonPath)) {
        return JSON.stringify({
          success: true,
          stats: {
            totalFacts: 0,
            categories: [],
            tags: [],
            backend: globalConfig.backend,
            searchStrategy: globalConfig.searchStrategy
          }
        });
      }
      
      const data = await fs.readFile(jsonPath, 'utf-8');
      const items: MemoryItem[] = JSON.parse(data);
      
      // Collect statistics
      const categories = new Set<string>();
      const allTags = new Set<string>();
      
      for (const item of items) {
        if (item.metadata?.category) {
          categories.add(item.metadata.category);
        }
        if (item.metadata?.tags) {
          item.metadata.tags.forEach(tag => allTags.add(tag));
        }
      }
      
      return JSON.stringify({
        success: true,
        stats: {
          totalFacts: items.length,
          categories: Array.from(categories),
          tags: Array.from(allTags),
          backend: globalConfig.backend,
          searchStrategy: globalConfig.searchStrategy,
          embeddingModel: globalConfig.embeddingModel,
          vectorDimensions: globalConfig.vectorDimensions,
          hybridAlpha: globalConfig.hybridAlpha
        }
      });
      
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get statistics'
      });
    }
  }
};

/**
 * Get all vector memory tools as an array
 */
export const getVectorMemoryTools = (): Tool<any, SessionMemoryContext>[] => {
  return [
    storeFactTool,
    searchFactsTool,
    findSimilarFactsTool,
    deleteFactTool,
    listFactsTool,
    getMemoryStatsTool
  ];
};