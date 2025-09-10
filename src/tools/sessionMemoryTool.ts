/**
 * Session Memory Tool - Core Implementation
 * 
 * Provides lightweight key-value storage for storing and recalling data during a session.
 * Similar to mem0 but simpler - persists across tool calls within a session.
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { Tool } from '../core/types';

// Context type for session memory tools
export type SessionMemoryContext = {
  sessionId?: string;
  userId?: string;
  [key: string]: any;
};

// Memory store type
interface MemoryStore {
  [sessionId: string]: {
    [key: string]: unknown;
  };
}

// Store location - can be configured via environment variable
const MEMORY_STORE_PATH = process.env.SESSION_MEMORY_PATH || 
  path.join(process.cwd(), '.session-memory.json');

// In-memory cache for performance
let memoryCache: MemoryStore = {};
let cacheInitialized = false;

/**
 * Load memory store from disk
 */
const loadMemoryStore = async (): Promise<MemoryStore> => {
  if (!cacheInitialized) {
    try {
      if (existsSync(MEMORY_STORE_PATH)) {
        const data = await fs.readFile(MEMORY_STORE_PATH, 'utf-8');
        memoryCache = JSON.parse(data);
      } else {
        memoryCache = {};
      }
      cacheInitialized = true;
    } catch (error) {
      console.error('Error loading memory store:', error);
      memoryCache = {};
      cacheInitialized = true;
    }
  }
  return memoryCache;
};

/**
 * Save memory store to disk
 */
const saveMemoryStore = async (store: MemoryStore): Promise<void> => {
  try {
    await fs.writeFile(MEMORY_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
    memoryCache = store;
  } catch (error) {
    console.error('Error saving memory store:', error);
  }
};

/**
 * Get session ID from context
 */
const getSessionId = (context: SessionMemoryContext): string => {
  return context.sessionId || context.userId || 'default-session';
};

/**
 * Store a key-value pair in session memory
 */
export const storeMemoryTool: Tool<
  { key: string; value: unknown; overwrite?: boolean },
  SessionMemoryContext
> = {
  schema: {
    name: 'storeMemory',
    description: 'Store a key-value pair in session memory for later recall',
    parameters: z.object({
      key: z.string().describe('The key to store the value under'),
      value: z.unknown().describe('The value to store (can be any JSON-serializable data)'),
      overwrite: z.boolean().optional().default(false).describe('Whether to overwrite an existing key')
    }) as z.ZodType<{ key: string; value: unknown; overwrite?: boolean }>
  },
  needsApproval: false,
  execute: async ({ key, value, overwrite = false }, context) => {
    const store = await loadMemoryStore();
    const sessionId = getSessionId(context);
    
    // Initialize session store if needed
    if (!store[sessionId]) {
      store[sessionId] = {};
    }
    
    // Check if key exists and handle overwrite
    if (store[sessionId][key] !== undefined && !overwrite) {
      return JSON.stringify({
        success: false,
        message: `Key '${key}' already exists. Set overwrite=true to update.`,
        existingValue: store[sessionId][key]
      });
    }
    
    // Store the value
    const previousValue = store[sessionId][key];
    store[sessionId][key] = value;
    
    // Save to disk
    await saveMemoryStore(store);
    
    return JSON.stringify({
      success: true,
      key,
      value,
      previousValue,
      message: previousValue !== undefined 
        ? `Updated '${key}' in session memory`
        : `Stored '${key}' in session memory`
    });
  }
};

/**
 * Recall a value from session memory by key
 */
export const recallMemoryTool: Tool<
  { key: string; defaultValue?: unknown },
  SessionMemoryContext
> = {
  schema: {
    name: 'recallMemory',
    description: 'Recall a previously stored value from session memory by its key',
    parameters: z.object({
      key: z.string().describe('The key to recall the value for'),
      defaultValue: z.unknown().optional().describe('Default value to return if key is not found')
    }) as z.ZodType<{ key: string; defaultValue?: unknown }>
  },
  needsApproval: false,
  execute: async ({ key, defaultValue }, context) => {
    const store = await loadMemoryStore();
    const sessionId = getSessionId(context);
    
    // Check if session exists
    if (!store[sessionId]) {
      return JSON.stringify({
        success: false,
        key,
        value: defaultValue,
        message: `No memory found for this session`,
        isDefault: defaultValue !== undefined
      });
    }
    
    // Get the value
    const value = store[sessionId][key];
    
    if (value === undefined) {
      return JSON.stringify({
        success: false,
        key,
        value: defaultValue,
        message: `Key '${key}' not found in session memory`,
        isDefault: defaultValue !== undefined
      });
    }
    
    return JSON.stringify({
      success: true,
      key,
      value,
      message: `Recalled '${key}' from session memory`
    });
  }
};

/**
 * List all keys stored in session memory
 */
export const listMemoryKeysTool: Tool<
  { pattern?: string },
  SessionMemoryContext
> = {
  schema: {
    name: 'listMemoryKeys',
    description: 'List all keys currently stored in session memory',
    parameters: z.object({
      pattern: z.string().optional().describe('Optional regex pattern to filter keys')
    }) as z.ZodType<{ pattern?: string }>
  },
  needsApproval: false,
  execute: async ({ pattern }, context) => {
    const store = await loadMemoryStore();
    const sessionId = getSessionId(context);
    
    // Check if session exists
    if (!store[sessionId] || Object.keys(store[sessionId]).length === 0) {
      return JSON.stringify({
        success: true,
        keys: [],
        count: 0,
        message: 'No keys found in session memory'
      });
    }
    
    // Get all keys
    let keys = Object.keys(store[sessionId]);
    
    // Filter by pattern if provided
    if (pattern) {
      const regex = new RegExp(pattern, 'i');
      keys = keys.filter(key => regex.test(key));
    }
    
    return JSON.stringify({
      success: true,
      keys,
      count: keys.length,
      message: pattern 
        ? `Found ${keys.length} keys matching pattern '${pattern}'`
        : `Found ${keys.length} keys in session memory`
    });
  }
};

/**
 * Delete a key from session memory
 */
export const deleteMemoryTool: Tool<
  { key: string },
  SessionMemoryContext
> = {
  schema: {
    name: 'deleteMemory',
    description: 'Delete a key-value pair from session memory',
    parameters: z.object({
      key: z.string().describe('The key to delete from memory')
    }) as z.ZodType<{ key: string }>
  },
  needsApproval: false,
  execute: async ({ key }, context) => {
    const store = await loadMemoryStore();
    const sessionId = getSessionId(context);
    
    // Check if session exists
    if (!store[sessionId]) {
      return JSON.stringify({
        success: false,
        key,
        message: `No memory found for this session`
      });
    }
    
    // Check if key exists
    if (store[sessionId][key] === undefined) {
      return JSON.stringify({
        success: false,
        key,
        message: `Key '${key}' not found in session memory`
      });
    }
    
    // Delete the key
    const deletedValue = store[sessionId][key];
    delete store[sessionId][key];
    
    // Clean up empty session
    if (Object.keys(store[sessionId]).length === 0) {
      delete store[sessionId];
    }
    
    // Save to disk
    await saveMemoryStore(store);
    
    return JSON.stringify({
      success: true,
      key,
      deletedValue,
      message: `Deleted '${key}' from session memory`
    });
  }
};

/**
 * Clear all session memory
 */
export const clearMemoryTool: Tool<
  { confirm: boolean },
  SessionMemoryContext
> = {
  schema: {
    name: 'clearMemory',
    description: 'Clear all key-value pairs from session memory',
    parameters: z.object({
      confirm: z.boolean().describe('Confirmation flag to prevent accidental clearing')
    }) as z.ZodType<{ confirm: boolean }>
  },
  needsApproval: false,
  execute: async ({ confirm }, context) => {
    if (!confirm) {
      return JSON.stringify({
        success: false,
        message: 'Set confirm=true to clear all session memory'
      });
    }
    
    const store = await loadMemoryStore();
    const sessionId = getSessionId(context);
    
    // Check if session exists
    if (!store[sessionId]) {
      return JSON.stringify({
        success: true,
        message: 'Session memory is already empty'
      });
    }
    
    // Count keys before clearing
    const keyCount = Object.keys(store[sessionId]).length;
    
    // Clear session memory
    delete store[sessionId];
    
    // Save to disk
    await saveMemoryStore(store);
    
    return JSON.stringify({
      success: true,
      clearedKeys: keyCount,
      message: `Cleared ${keyCount} keys from session memory`
    });
  }
};

/**
 * Get all session memory tools as an array
 */
export const getSessionMemoryTools = (): Tool<any, SessionMemoryContext>[] => {
  return [
    storeMemoryTool,
    recallMemoryTool,
    listMemoryKeysTool,
    deleteMemoryTool,
    clearMemoryTool
  ];
};