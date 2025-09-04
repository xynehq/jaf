import { Agent } from '../../../src/core/types';
import { FileSystemContext, listFilesTool, readFileTool, deleteFileTool, editFileTool } from './tools';
import * as fs from 'fs';
import * as path from 'path';

// Load .env file if it exists
try {
  const envPath = path.join(process.cwd(), 'examples/hitl-demo/.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    });
  }
} catch (error) {
  // Ignore errors loading .env file
}

// Environment configuration
export const LITELLM_BASE_URL = process.env.LITELLM_BASE_URL || process.env.LITELLM_URL || 'http://localhost:4000';
export const LITELLM_API_KEY = process.env.LITELLM_API_KEY || 'sk-demo';
export const LITELLM_MODEL = process.env.LITELLM_MODEL || 'gpt-3.5-turbo';

// File system agent
export const fileSystemAgent: Agent<FileSystemContext, any> = {
  name: 'FileSystemAgent',
  instructions: () => `You are a helpful file system assistant working in a sandboxed directory.

Available operations:
- listFiles: List files and directories
- readFile: Read file contents  
- deleteFile: Delete a file
- editFile: Edit or create a file`,
  tools: [listFilesTool, readFileTool, deleteFileTool, editFileTool],
  modelConfig: {
    name: LITELLM_MODEL,
    temperature: 0.1,
  },
};