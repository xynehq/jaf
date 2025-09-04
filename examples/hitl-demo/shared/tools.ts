import { z } from 'zod';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { Tool } from '../../../src/core/types';

export type FileSystemContext = {
  userId: string;
  workingDirectory: string;
  permissions: string[];
  [key: string]: any;
};

export const DEMO_DIR = path.join(process.cwd(), 'examples/hitl-demo/sandbox');

// File system tools
export const listFilesTool: Tool<{ directory?: string }, FileSystemContext> = {
  schema: {
    name: 'listFiles',
    description: 'List files and directories in the specified directory',
    parameters: z.object({
      directory: z.string().optional().describe('Directory to list (relative to working directory)')
    }) as z.ZodType<{ directory?: string }>,
  },
  needsApproval: false,
  execute: async ({ directory }, context) => {
    try {
      const targetDir = directory 
        ? path.resolve(context.workingDirectory, directory)
        : context.workingDirectory;
      
      if (!targetDir.startsWith(DEMO_DIR)) {
        return `Error: Access denied. Directory outside of sandbox: ${targetDir}`;
      }

      const items = await fs.readdir(targetDir, { withFileTypes: true });
      const fileList = items.map(item => ({
        name: item.name,
        type: item.isDirectory() ? 'directory' : 'file',
        path: path.relative(context.workingDirectory, path.join(targetDir, item.name))
      }));

      return `Directory listing for ${targetDir}:\n` + 
        fileList.map(item => `  ${item.type === 'directory' ? '📁' : '📄'} ${item.name}`).join('\n');
    } catch (error: any) {
      return `Error listing directory: ${error.message}`;
    }
  },
};

export const readFileTool: Tool<{ filepath: string }, FileSystemContext> = {
  schema: {
    name: 'readFile',
    description: 'Read the contents of a file',
    parameters: z.object({
      filepath: z.string().describe('Path to the file to read (relative to working directory)')
    }) as z.ZodType<{ filepath: string }>,
  },
  needsApproval: false,
  execute: async ({ filepath }, context) => {
    try {
      const targetPath = path.resolve(context.workingDirectory, filepath);
      
      if (!targetPath.startsWith(DEMO_DIR)) {
        return `Error: Access denied. File outside of sandbox: ${targetPath}`;
      }

      const content = await fs.readFile(targetPath, 'utf-8');
      return `Contents of ${filepath}:\n\`\`\`\n${content}\n\`\`\``;
    } catch (error: any) {
      return `Error reading file: ${error.message}`;
    }
  },
};

export const deleteFileTool: Tool<{ filepath: string; reason?: string }, FileSystemContext> = {
  schema: {
    name: 'deleteFile',
    description: 'Delete a file (requires approval)',
    parameters: z.object({
      filepath: z.string().describe('Path to the file to delete (relative to working directory)'),
      reason: z.string().optional().describe('Reason for deletion')
    }) as z.ZodType<{ filepath: string; reason?: string }>,
  },
  needsApproval: true,
  execute: async ({ filepath, reason }, context) => {
    try {
      const targetPath = path.resolve(context.workingDirectory, filepath);
      
      if (!targetPath.startsWith(DEMO_DIR)) {
        return `Error: Access denied. File outside of sandbox: ${targetPath}`;
      }

      await fs.unlink(targetPath);
      console.log(`🗑️  File deleted: ${filepath}`);
      if (reason) console.log(`   Reason: ${reason}`);
      
      if (context.deletionConfirmed) {
        console.log(`   Confirmed by: ${context.deletionConfirmed.confirmedBy}`);
        console.log(`   Backup created: ${context.deletionConfirmed.backupCreated}`);
      }
      
      return `Successfully deleted file: ${filepath}${reason ? ` (Reason: ${reason})` : ''}`;
    } catch (error: any) {
      return `Error deleting file: ${error.message}`;
    }
  },
};

export const editFileTool: Tool<{ filepath: string; content: string; backup?: boolean }, FileSystemContext> = {
  schema: {
    name: 'editFile',
    description: 'Edit or create a file with new content (requires approval)',
    parameters: z.object({
      filepath: z.string().describe('Path to the file to edit (relative to working directory)'),
      content: z.string().describe('New content for the file'),
      backup: z.boolean().optional().describe('Whether to create a backup before editing')
    }) as z.ZodType<{ filepath: string; content: string; backup?: boolean }>,
  },
  needsApproval: true,
  execute: async ({ filepath, content, backup }, context) => {
    try {
      const targetPath = path.resolve(context.workingDirectory, filepath);
      
      if (!targetPath.startsWith(DEMO_DIR)) {
        return `Error: Access denied. File outside of sandbox: ${targetPath}`;
      }

      let backupPath = '';
      if (backup && existsSync(targetPath)) {
        backupPath = `${targetPath}.backup.${Date.now()}`;
        await fs.copyFile(targetPath, backupPath);
        console.log(`💾 Backup created: ${backupPath}`);
      }

      await fs.writeFile(targetPath, content, 'utf-8');
      console.log(`✏️  File edited: ${filepath}`);
      
      if (context.editingApproved) {
        console.log(`   Approved by: ${context.editingApproved.approvedBy}`);
        console.log(`   Safety level: ${context.editingApproved.safetyLevel}`);
      }
      
      return `Successfully edited file: ${filepath}${backupPath ? ` (Backup: ${path.basename(backupPath)})` : ''}`;
    } catch (error: any) {
      return `Error editing file: ${error.message}`;
    }
  },
};