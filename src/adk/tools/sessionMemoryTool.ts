/**
 * Session Memory Tool
 * 
 * Provides lightweight key-value storage for storing and recalling data during a session.
 * Similar to mem0 but simpler - persists across tool calls within a session.
 */

import {
  Tool,
  ToolParameter,
  ToolContext,
  ToolResult,
  ToolParameterType,
  ToolSource,
  FunctionToolConfig
} from '../types';
import { createFunctionTool } from './index';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

// Memory store type
interface MemoryStore {
  [sessionId: string]: {
    [key: string]: unknown;
  };
}

// Store location - can be configured
const MEMORY_STORE_PATH = path.join(process.cwd(), '.session-memory.json');

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
 * Store a key-value pair in session memory
 */
export const storeMemoryTool = (): Tool => {
  return createFunctionTool({
    name: 'storeMemory',
    description: 'Store a key-value pair in session memory for later recall',
    execute: async (params, context) => {
      const { key, value, overwrite } = params as { 
        key: string; 
        value: unknown; 
        overwrite?: boolean;
      };
      
      const store = await loadMemoryStore();
      const sessionId = context.session.id;
      
      // Initialize session store if needed
      if (!store[sessionId]) {
        store[sessionId] = {};
      }
      
      // Check if key exists and handle overwrite
      if (store[sessionId][key] !== undefined && !overwrite) {
        return {
          success: false,
          message: `Key '${key}' already exists. Set overwrite=true to update.`,
          existingValue: store[sessionId][key]
        };
      }
      
      // Store the value
      const previousValue = store[sessionId][key];
      store[sessionId][key] = value;
      
      // Save to disk
      await saveMemoryStore(store);
      
      return {
        success: true,
        key,
        value,
        previousValue,
        message: previousValue !== undefined 
          ? `Updated '${key}' in session memory`
          : `Stored '${key}' in session memory`
      };
    },
    parameters: [
      {
        name: 'key',
        type: ToolParameterType.STRING,
        description: 'The key to store the value under',
        required: true
      },
      {
        name: 'value',
        type: ToolParameterType.OBJECT,
        description: 'The value to store (can be any JSON-serializable data)',
        required: true
      },
      {
        name: 'overwrite',
        type: ToolParameterType.BOOLEAN,
        description: 'Whether to overwrite an existing key',
        required: false,
        default: false
      }
    ],
    metadata: {
      source: ToolSource.FUNCTION,
      version: '1.0.0',
      tags: ['memory', 'storage', 'session']
    }
  });
};

/**
 * Recall a value from session memory by key
 */
export const recallMemoryTool = (): Tool => {
  return createFunctionTool({
    name: 'recallMemory',
    description: 'Recall a previously stored value from session memory by its key',
    execute: async (params, context) => {
      const { key, defaultValue } = params as { 
        key: string; 
        defaultValue?: unknown;
      };
      
      const store = await loadMemoryStore();
      const sessionId = context.session.id;
      
      // Check if session exists
      if (!store[sessionId]) {
        return {
          success: false,
          key,
          value: defaultValue,
          message: `No memory found for this session`,
          isDefault: defaultValue !== undefined
        };
      }
      
      // Get the value
      const value = store[sessionId][key];
      
      if (value === undefined) {
        return {
          success: false,
          key,
          value: defaultValue,
          message: `Key '${key}' not found in session memory`,
          isDefault: defaultValue !== undefined
        };
      }
      
      return {
        success: true,
        key,
        value,
        message: `Recalled '${key}' from session memory`
      };
    },
    parameters: [
      {
        name: 'key',
        type: ToolParameterType.STRING,
        description: 'The key to recall the value for',
        required: true
      },
      {
        name: 'defaultValue',
        type: ToolParameterType.OBJECT,
        description: 'Default value to return if key is not found',
        required: false
      }
    ],
    metadata: {
      source: ToolSource.FUNCTION,
      version: '1.0.0',
      tags: ['memory', 'retrieval', 'session']
    }
  });
};

/**
 * List all keys stored in session memory
 */
export const listMemoryKeysTool = (): Tool => {
  return createFunctionTool({
    name: 'listMemoryKeys',
    description: 'List all keys currently stored in session memory',
    execute: async (params, context) => {
      const { pattern } = params as { pattern?: string };
      
      const store = await loadMemoryStore();
      const sessionId = context.session.id;
      
      // Check if session exists
      if (!store[sessionId] || Object.keys(store[sessionId]).length === 0) {
        return {
          success: true,
          keys: [],
          count: 0,
          message: 'No keys found in session memory'
        };
      }
      
      // Get all keys
      let keys = Object.keys(store[sessionId]);
      
      // Filter by pattern if provided
      if (pattern) {
        const regex = new RegExp(pattern, 'i');
        keys = keys.filter(key => regex.test(key));
      }
      
      return {
        success: true,
        keys,
        count: keys.length,
        message: pattern 
          ? `Found ${keys.length} keys matching pattern '${pattern}'`
          : `Found ${keys.length} keys in session memory`
      };
    },
    parameters: [
      {
        name: 'pattern',
        type: ToolParameterType.STRING,
        description: 'Optional regex pattern to filter keys',
        required: false
      }
    ],
    metadata: {
      source: ToolSource.FUNCTION,
      version: '1.0.0',
      tags: ['memory', 'listing', 'session']
    }
  });
};

/**
 * Delete a key from session memory
 */
export const deleteMemoryTool = (): Tool => {
  return createFunctionTool({
    name: 'deleteMemory',
    description: 'Delete a key-value pair from session memory',
    execute: async (params, context) => {
      const { key } = params as { key: string };
      
      const store = await loadMemoryStore();
      const sessionId = context.session.id;
      
      // Check if session exists
      if (!store[sessionId]) {
        return {
          success: false,
          key,
          message: `No memory found for this session`
        };
      }
      
      // Check if key exists
      if (store[sessionId][key] === undefined) {
        return {
          success: false,
          key,
          message: `Key '${key}' not found in session memory`
        };
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
      
      return {
        success: true,
        key,
        deletedValue,
        message: `Deleted '${key}' from session memory`
      };
    },
    parameters: [
      {
        name: 'key',
        type: ToolParameterType.STRING,
        description: 'The key to delete from memory',
        required: true
      }
    ],
    metadata: {
      source: ToolSource.FUNCTION,
      version: '1.0.0',
      tags: ['memory', 'deletion', 'session']
    }
  });
};

/**
 * Clear all session memory
 */
export const clearMemoryTool = (): Tool => {
  return createFunctionTool({
    name: 'clearMemory',
    description: 'Clear all key-value pairs from session memory',
    execute: async (params, context) => {
      const { confirm } = params as { confirm: boolean };
      
      if (!confirm) {
        return {
          success: false,
          message: 'Set confirm=true to clear all session memory'
        };
      }
      
      const store = await loadMemoryStore();
      const sessionId = context.session.id;
      
      // Check if session exists
      if (!store[sessionId]) {
        return {
          success: true,
          message: 'Session memory is already empty'
        };
      }
      
      // Count keys before clearing
      const keyCount = Object.keys(store[sessionId]).length;
      
      // Clear session memory
      delete store[sessionId];
      
      // Save to disk
      await saveMemoryStore(store);
      
      return {
        success: true,
        clearedKeys: keyCount,
        message: `Cleared ${keyCount} keys from session memory`
      };
    },
    parameters: [
      {
        name: 'confirm',
        type: ToolParameterType.BOOLEAN,
        description: 'Confirmation flag to prevent accidental clearing',
        required: true
      }
    ],
    metadata: {
      source: ToolSource.FUNCTION,
      version: '1.0.0',
      tags: ['memory', 'clearing', 'session']
    }
  });
};

/**
 * Get all session memory tools as an array
 */
export const getSessionMemoryTools = (): Tool[] => {
  return [
    storeMemoryTool(),
    recallMemoryTool(),
    listMemoryKeysTool(),
    deleteMemoryTool(),
    clearMemoryTool()
  ];
};

/**
 * Create a session memory tool with custom configuration
 */
export const createSessionMemoryTool = (
  storePath?: string,
  persistToDisk: boolean = true
): Tool[] => {
  // Override store path if provided
  if (storePath) {
    Object.defineProperty(module.exports, 'MEMORY_STORE_PATH', {
      value: storePath,
      writable: false
    });
  }
  
  // If not persisting to disk, modify save/load functions
  if (!persistToDisk) {
    // Use in-memory only storage
    cacheInitialized = true;
    memoryCache = {};
  }
  
  return getSessionMemoryTools();
};