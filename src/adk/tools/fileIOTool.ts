/**
 * File I/O Tool - Read and write text, JSON, and CSV files
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Tool, ToolExecutor, FunctionToolConfig } from '../types.js';
import { createFunctionTool } from './index.js';

interface FileIOParams {
  action: 'read' | 'write';
  filepath: string;
  content?: string | Record<string, any> | any[];
  format?: 'text' | 'json' | 'csv';
  encoding?: BufferEncoding;
  csvOptions?: {
    delimiter?: string;
    headers?: boolean;
  };
}

interface FileIOResult {
  success: boolean;
  data?: string | Record<string, any> | any[];
  format?: string;
  error?: string;
  filepath?: string;
}

/**
 * Parse CSV content into array of objects
 */
const parseCSV = (content: string, options: { delimiter?: string; headers?: boolean } = {}): any[] => {
  const { delimiter = ',', headers = true } = options;
  const lines = content.trim().split('\n');
  
  if (lines.length === 0) return [];
  
  if (!headers) {
    return lines.map(line => line.split(delimiter).map(cell => cell.trim()));
  }
  
  const headerLine = lines[0];
  const headerFields = headerLine.split(delimiter).map(h => h.trim());
  const dataLines = lines.slice(1);
  
  return dataLines.map(line => {
    const values = line.split(delimiter).map(v => v.trim());
    const obj: Record<string, string> = {};
    headerFields.forEach((header, index) => {
      obj[header] = values[index] || '';
    });
    return obj;
  });
};

/**
 * Convert array of objects to CSV string
 */
const toCSV = (data: any[], options: { delimiter?: string; headers?: boolean } = {}): string => {
  const { delimiter = ',', headers = true } = options;
  
  if (data.length === 0) return '';
  
  // If data is array of arrays
  if (Array.isArray(data[0])) {
    return data.map(row => row.join(delimiter)).join('\n');
  }
  
  // If data is array of objects
  const keys = Object.keys(data[0]);
  const lines: string[] = [];
  
  if (headers) {
    lines.push(keys.join(delimiter));
  }
  
  data.forEach(obj => {
    const values = keys.map(key => String(obj[key] || ''));
    lines.push(values.join(delimiter));
  });
  
  return lines.join('\n');
};

/**
 * Detect file format from extension
 */
const detectFormat = (filepath: string): 'text' | 'json' | 'csv' => {
  const ext = path.extname(filepath).toLowerCase();
  switch (ext) {
    case '.json':
      return 'json';
    case '.csv':
      return 'csv';
    default:
      return 'text';
  }
};

/**
 * File I/O Tool executor
 */
const fileIOExecutor: ToolExecutor = async (params: FileIOParams, context?: any): Promise<FileIOResult> => {
  const { action, filepath, content, encoding = 'utf8', csvOptions } = params;
  let { format } = params;
  
  // Auto-detect format if not specified
  if (!format) {
    format = detectFormat(filepath);
  }
  
  try {
    if (action === 'read') {
      // Read file
      const fileContent = await fs.readFile(filepath, encoding);
      
      let data: string | Record<string, any> | any[];
      
      switch (format) {
        case 'json':
          data = JSON.parse(fileContent);
          break;
        case 'csv':
          data = parseCSV(fileContent, csvOptions);
          break;
        default:
          data = fileContent;
      }
      
      return {
        success: true,
        data,
        format,
        filepath
      };
      
    } else if (action === 'write') {
      // Write file
      if (!content) {
        throw new Error('Content is required for write action');
      }
      
      let fileContent: string;
      
      switch (format) {
        case 'json':
          fileContent = JSON.stringify(content, null, 2);
          break;
        case 'csv':
          if (!Array.isArray(content)) {
            throw new Error('CSV content must be an array');
          }
          fileContent = toCSV(content, csvOptions);
          break;
        default:
          fileContent = typeof content === 'string' ? content : String(content);
      }
      
      // Ensure directory exists
      const dir = path.dirname(filepath);
      await fs.mkdir(dir, { recursive: true });
      
      // Write file
      await fs.writeFile(filepath, fileContent, encoding);
      
      return {
        success: true,
        filepath,
        format
      };
      
    } else {
      throw new Error(`Invalid action: ${action}. Must be 'read' or 'write'`);
    }
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

/**
 * File I/O Tool configuration
 */
const fileIOToolConfig: FunctionToolConfig = {
  name: 'fileIO',
  description: 'Read and write text, JSON, and CSV files',
  parameters: [
    {
      name: 'action',
      type: 'string',
      description: 'Action to perform: "read" or "write"',
      required: true,
      enum: ['read', 'write']
    },
    {
      name: 'filepath',
      type: 'string',
      description: 'Path to the file',
      required: true
    },
    {
      name: 'content',
      type: 'any',
      description: 'Content to write (required for write action)',
      required: false
    },
    {
      name: 'format',
      type: 'string',
      description: 'File format: "text", "json", or "csv" (auto-detected if not specified)',
      required: false,
      enum: ['text', 'json', 'csv']
    },
    {
      name: 'encoding',
      type: 'string',
      description: 'File encoding (default: utf8)',
      required: false,
      default: 'utf8'
    },
    {
      name: 'csvOptions',
      type: 'object',
      description: 'CSV parsing/formatting options',
      required: false,
      properties: {
        delimiter: {
          type: 'string',
          description: 'CSV delimiter (default: ",")',
          default: ','
        },
        headers: {
          type: 'boolean',
          description: 'Whether CSV has headers (default: true)',
          default: true
        }
      }
    }
  ],
  execute: fileIOExecutor
};

/**
 * Create and export the File I/O Tool
 */
export const fileIOTool: Tool = createFunctionTool(fileIOToolConfig);

/**
 * Convenience functions for common operations
 */
export const readTextFile = async (filepath: string): Promise<string> => {
  const result = await fileIOExecutor({ action: 'read', filepath, format: 'text' });
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data as string;
};

export const readJSONFile = async <T = any>(filepath: string): Promise<T> => {
  const result = await fileIOExecutor({ action: 'read', filepath, format: 'json' });
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data as T;
};

export const readCSVFile = async (filepath: string, options?: { delimiter?: string; headers?: boolean }): Promise<any[]> => {
  const result = await fileIOExecutor({ action: 'read', filepath, format: 'csv', csvOptions: options });
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data as any[];
};

export const writeTextFile = async (filepath: string, content: string): Promise<void> => {
  const result = await fileIOExecutor({ action: 'write', filepath, content, format: 'text' });
  if (!result.success) {
    throw new Error(result.error);
  }
};

export const writeJSONFile = async (filepath: string, content: any): Promise<void> => {
  const result = await fileIOExecutor({ action: 'write', filepath, content, format: 'json' });
  if (!result.success) {
    throw new Error(result.error);
  }
};

export const writeCSVFile = async (filepath: string, content: any[], options?: { delimiter?: string; headers?: boolean }): Promise<void> => {
  const result = await fileIOExecutor({ action: 'write', filepath, content, format: 'csv', csvOptions: options });
  if (!result.success) {
    throw new Error(result.error);
  }
};