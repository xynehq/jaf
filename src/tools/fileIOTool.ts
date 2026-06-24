/**
 * File I/O Tool - Read and write text, JSON, and CSV files
 * Core utility tool for file operations
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { Tool } from '../core/types.js';
import { success, error, ToolResult } from '../core/tool-results.js';

// ========== CSV Utilities ==========

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

// ========== Schema Definitions ==========

const FileIOSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('read'),
    filepath: z.string().describe('Path to the file to read'),
    format: z.enum(['text', 'json', 'csv']).optional().describe('File format (auto-detected if not specified)'),
    encoding: z.string().optional().default('utf8').describe('File encoding'),
    csvOptions: z.object({
      delimiter: z.string().optional().default(','),
      headers: z.boolean().optional().default(true)
    }).optional()
  }),
  z.object({
    action: z.literal('write'),
    filepath: z.string().describe('Path to the file to write'),
    content: z.any().describe('Content to write to the file'),
    format: z.enum(['text', 'json', 'csv']).optional().describe('File format (auto-detected if not specified)'),
    encoding: z.string().optional().default('utf8').describe('File encoding'),
    csvOptions: z.object({
      delimiter: z.string().optional().default(','),
      headers: z.boolean().optional().default(true)
    }).optional()
  })
]);

type FileIOParams = z.infer<typeof FileIOSchema>;

// ========== Tool Implementation ==========

/**
 * File I/O Tool - Read and write text, JSON, and CSV files
 */
export function createFileIOTool<Ctx>(): Tool<FileIOParams, Ctx> {
  return {
    schema: {
      name: 'fileIO',
      description: 'Read and write text, JSON, and CSV files. Supports automatic format detection.',
      parameters: FileIOSchema
    },
    
    execute: async (params: FileIOParams): Promise<string | ToolResult> => {
      const { action, filepath, encoding = 'utf8' } = params;
      let format = params.format;
      
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
              data = parseCSV(fileContent, params.csvOptions);
              break;
            default:
              data = fileContent;
          }
          
          return success({
            data,
            format,
            filepath,
            message: `Successfully read ${format} file: ${filepath}`
          });
          
        } else {
          // Write file
          const { content } = params;
          if (content === undefined || content === null) {
            return error('Content is required for write action');
          }
          
          let fileContent: string;
          
          switch (format) {
            case 'json':
              fileContent = JSON.stringify(content, null, 2);
              break;
            case 'csv':
              if (!Array.isArray(content)) {
                return error('CSV content must be an array');
              }
              fileContent = toCSV(content, params.csvOptions);
              break;
            default:
              fileContent = typeof content === 'string' ? content : String(content);
          }
          
          // Ensure directory exists
          const dir = path.dirname(filepath);
          await fs.mkdir(dir, { recursive: true });
          
          // Write file
          await fs.writeFile(filepath, fileContent, encoding);
          
          return success({
            filepath,
            format,
            message: `Successfully wrote ${format} file: ${filepath}`
          });
        }
        
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return error(`File I/O operation failed: ${errorMessage}`);
      }
    }
  };
}

// ========== Convenience Functions ==========

/**
 * Read a text file
 */
export async function readTextFile(filepath: string): Promise<string> {
  const content = await fs.readFile(filepath, 'utf8');
  return content;
}

/**
 * Read a JSON file
 */
export async function readJSONFile<T = any>(filepath: string): Promise<T> {
  const content = await fs.readFile(filepath, 'utf8');
  return JSON.parse(content);
}

/**
 * Read a CSV file
 */
export async function readCSVFile(
  filepath: string, 
  options?: { delimiter?: string; headers?: boolean }
): Promise<any[]> {
  const content = await fs.readFile(filepath, 'utf8');
  return parseCSV(content, options);
}

/**
 * Write a text file
 */
export async function writeTextFile(filepath: string, content: string): Promise<void> {
  const dir = path.dirname(filepath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filepath, content, 'utf8');
}

/**
 * Write a JSON file
 */
export async function writeJSONFile(filepath: string, content: any): Promise<void> {
  const dir = path.dirname(filepath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(content, null, 2), 'utf8');
}

/**
 * Write a CSV file
 */
export async function writeCSVFile(
  filepath: string, 
  content: any[], 
  options?: { delimiter?: string; headers?: boolean }
): Promise<void> {
  const dir = path.dirname(filepath);
  await fs.mkdir(dir, { recursive: true });
  const csvContent = toCSV(content, options);
  await fs.writeFile(filepath, csvContent, 'utf8');
}

// Export the default tool instance
export const fileIOTool = createFileIOTool();