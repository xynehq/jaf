/**
 * Codegen Pipeline Tools
 * 
 * These tools handle code generation, repository management, and build validation
 */

import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import type { Tool } from '../../../src/core/types';
import type { PipelineContext, BuildResult, XyneExecutionResult, GeneratePromptParams } from '../types';

const execAsync = promisify(exec);

export const selectConnectorTool: Tool<{ connectorName: string }, PipelineContext> = {
  schema: {
    name: 'select_connector',
    description: 'Select and validate a connector for migration',
    parameters: z.object({
      connectorName: z.string().describe('Name of the connector to migrate')
    })
  },
  execute: async (args, context) => {
    const { connectorName } = args;
    
    if (!connectorName || !connectorName.trim()) {
      throw new Error('Connector name is required');
    }

    // Update context with selected connector
    context.connectorName = connectorName.trim();
    
    return `✅ Selected connector: ${connectorName}`;
  }
};

export const generateMigrationFilesTool: Tool<GeneratePromptParams, PipelineContext> = {
  schema: {
    name: 'generate_migration_files',
    description: 'Generate migration files using the Python script',
    parameters: z.object({
      connector: z.string().describe('Connector name'),
      eulerPath: z.string().describe('Path to Euler repository'),
      ucsPath: z.string().describe('Path to UCS repository'),
      output: z.string().describe('Output directory for generated files'),
      upiFlowsOnly: z.boolean().optional().describe('Generate UPI flows only')
    })
  },
  execute: async (args, context) => {
    const { connector, eulerPath, ucsPath, output, upiFlowsOnly } = args;
    
    // Ensure output directory exists
    await mkdir(output, { recursive: true });
    
    // Build command arguments - use the actual script path
    const scriptPath = '/Users/shivral.somani/Documents/Repos/mockApiTest/generate_prompt.py';
    const command = [
      'python3', scriptPath,
      '--connector', connector,
      '--euler-path', eulerPath,
      '--ucs-path', ucsPath,
      '--output', output
    ];
    
    if (upiFlowsOnly) {
      command.push('--upi-flows-only');
    }
    
    try {
      console.log(`🚀 Running generate_prompt.py for connector: ${connector}`);
      console.log(`Command: ${command.join(' ')}`);
      
      // Check if the script file exists first
      if (!existsSync(scriptPath)) {
        throw new Error(`Script file not found: ${scriptPath}`);
      }
      
      const { stdout, stderr } = await execAsync(command.join(' '));
      
      console.log(`✅ generate_prompt.py completed successfully`);
      if (stdout) console.log(`Output: ${stdout}`);
      if (stderr) console.log(`Warnings: ${stderr}`);
      
      // Read generated files
      const eulerFile = path.join(output, `${connector}_euler.md`);
      const ucsFile = path.join(output, `${connector}_ucs.md`);
      
      let eulerInstruction = '';
      let ucsInstruction = '';
      
      if (existsSync(eulerFile)) {
        eulerInstruction = await readFile(eulerFile, 'utf-8');
        console.log(`✅ Read ${eulerFile}`);
      } else {
        console.log(`❌ Warning: ${eulerFile} not found`);
      }
      
      if (existsSync(ucsFile)) {
        ucsInstruction = await readFile(ucsFile, 'utf-8');
        console.log(`✅ Read ${ucsFile}`);
      } else {
        console.log(`❌ Warning: ${ucsFile} not found`);
      }
      
      return {
        eulerInstruction,
        ucsInstruction,
        files: { eulerFile, ucsFile }
      };
      
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || 'Unknown error occurred';
      const errorCode = error?.code || 'No error code';
      const errorStderr = error?.stderr || 'No stderr output';
      console.error(`❌ generateMigrationFilesTool failed:`, {
        message: errorMessage,
        code: errorCode,
        stderr: errorStderr,
        error: error
      });
      throw new Error(`Failed to generate migration files: ${errorMessage} (code: ${errorCode})`);
    }
  }
};

export const executeXyneCommandTool: Tool<{ 
  instruction: string; 
  repositoryPath: string;
  stepNum: number;
  isUCSRepo: boolean;
}, PipelineContext> = {
  schema: {
    name: 'execute_xyne_command',
    description: 'Execute Xyne code generation command',
    parameters: z.object({
      instruction: z.string().describe('Instruction for Xyne to execute'),
      repositoryPath: z.string().describe('Path to the repository'),
      stepNum: z.number().describe('Step number in the pipeline'),
      isUCSRepo: z.boolean().describe('Whether this is a UCS repository')
    })
  },
  execute: async (args, context) => {
    const { instruction, repositoryPath, stepNum, isUCSRepo } = args;
    
    try {
      // Generate detailed migration instructions first
      let detailedInstruction = instruction;
      
      if (instruction.includes('Generate code for') && context.connectorName) {
        console.log(`🔄 Generating detailed migration instructions for ${context.connectorName}...`);
        
        // Call generateMigrationFilesTool to get proper instructions
        const migrationArgs = {
          connector: context.connectorName,
          eulerPath: context.repositoryPaths?.eulerPath || '/Users/shivral.somani/Documents/Repos/euler-api-txns/euler-x',
          ucsPath: context.repositoryPaths?.ucsPath || '/Users/shivral.somani/Documents/Repos/hyperswitch/ucs/connector-service',
          output: context.repositoryPaths?.outputDir || '/tmp/migration-output'
        };
        
        try {
          const migrationResult = await generateMigrationFilesTool.execute(migrationArgs, context);
          
          // Check if result is an object with the expected properties
          if (typeof migrationResult === 'object' && migrationResult !== null && 
              'eulerInstruction' in migrationResult && 'ucsInstruction' in migrationResult) {
            // Use the appropriate instruction based on repository type
            if (isUCSRepo) {
              detailedInstruction = (migrationResult as any).ucsInstruction;
              console.log(`✅ Using UCS migration instructions (${(migrationResult as any).ucsInstruction.length} chars)`);
            } else {
              detailedInstruction = (migrationResult as any).eulerInstruction;
              console.log(`✅ Using Euler migration instructions (${(migrationResult as any).eulerInstruction.length} chars)`);
            }
          } else {
            console.log(`⚠️ Migration result format unexpected, using generic instruction`);
            console.log(`Migration result type: ${typeof migrationResult}`);
          }
        } catch (migrationError: any) {
          console.log(`⚠️ Failed to generate detailed instructions, using generic: ${migrationError.message}`);
          // Fall back to generic instruction
        }
      }
      
      // Write detailed instruction to temp file
      const instructionFile = path.join(repositoryPath, 'temp_instruction.txt');
      await writeFile(instructionFile, detailedInstruction, 'utf-8');
      console.log(`✅ Detailed instruction written to ${instructionFile}`);
      
      // Execute Xyne command
      const xyneCommand = `xyne prompt "$(cat '${instructionFile}') " --debug`;
      console.log('Starting Xyne evaluation...');
      console.log(`Xyne event log id: xyne-pr-eval-${Date.now()}-${stepNum}`);
      
      const { stdout, stderr } = await execAsync(xyneCommand, { cwd: repositoryPath });
      console.log('Xyne evaluation completed.');
      
      if (stderr) {
        console.log(`⚠️ Xyne warnings: ${stderr}`);
      }
      
      return {
        success: true,
        output: stdout,
        filesModified: [], // TODO: Parse from Xyne output
        instructionFile
      };
      
    } catch (error: any) {
      console.log(`⚠️ Xyne evaluation failed: ${error.message}`);
      console.log('Continuing with next steps...');
      
      return {
        success: false,
        error: error.message,
        output: '',
        filesModified: []
      };
    }
  }
};

export const validateBuildTool: Tool<{
  repositoryPath: string;
  isUCSRepo: boolean;
  maxAttempts?: number;
}, PipelineContext> = {
  schema: {
    name: 'validate_build',
    description: 'Validate build and attempt to fix errors',
    parameters: z.object({
      repositoryPath: z.string().describe('Path to the repository'),
      isUCSRepo: z.boolean().describe('Whether this is a UCS repository'),
      maxAttempts: z.number().optional().default(5).describe('Maximum build attempts')
    })
  },
  execute: async (args) => {
    const { repositoryPath, isUCSRepo, maxAttempts = 5 } = args;
    
    const buildType = isUCSRepo ? 'Cargo' : 'Nix';
    const buildCommand = isUCSRepo ? 'cargo build' : 'nix develop -c cabal build all';
    
    console.log(`\n=== ${buildType} Build Validation ===`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`${buildType} build validation attempt ${attempt}/${maxAttempts}...`);
      
      try {
        const { stdout, stderr } = await execAsync(buildCommand, { cwd: repositoryPath });
        console.log(`✅ ${buildType} build successful!`);
        return {
          success: true,
          output: stdout,
          stderr: stderr || '',
          exitCode: 0
        };
      } catch (error: any) {
        const exitCode = error?.code || error?.status || 1;
        console.log(`❌ ${buildType} build failed (exit code: ${exitCode})`);
        
        if (attempt === maxAttempts) {
          console.log(`❌ Maximum attempts reached. ${buildType} build validation failed.`);
          console.log(`⚠️  Continuing with commit and push despite build failures...`);
          break;
        }
        
        // Generate fix instruction
        console.log(`Generating fix instruction for ${buildType.toLowerCase()} build errors...`);
        const errorOutput = error?.stderr || error?.stdout || error?.message || `${buildType} build failed with unknown error`;
        
        let fixInstruction: string;
        if (isUCSRepo) {
          // Try to read comprehensive cargo build fix prompt
          const cargoPromptPath = 'cargo-build-fix-prompt.txt';
          let cargoPrompt: string;
          
          try {
            cargoPrompt = await readFile(cargoPromptPath, 'utf-8');
            console.log('Successfully loaded comprehensive cargo build fix prompt');
          } catch {
            console.log(`Warning: Could not read cargo-build-fix-prompt.txt, using fallback prompt`);
            cargoPrompt = 'You are an Autonomous Rust Build Error Detection and Auto-Fix Agent. Automatically detect, analyze, and fix build errors using available tools.';
          }
          
          fixInstruction = `${cargoPrompt}\n\n=== CURRENT BUILD ERROR ===\n${errorOutput}\n\n=== TASK ===\nAnalyze the above cargo build error and automatically fix it using the strategies outlined in the prompt. Run the necessary commands to resolve the build issues and ensure cargo build succeeds. CONTEXT: The previous instruction used to implement code changes is available in 'temp_instruction.txt'`;
        } else {
          fixInstruction = `Fix the following nix/cabal build errors (command: nix develop -c cabal build all):

${errorOutput}

CONTEXT: The previous instruction used to implement code changes is available in 'temp_instruction.txt'. Please review this file to understand what was previously implemented, validate the implementation, and fix any issues before building.

Please analyze the errors and make the necessary code changes to fix the compilation issues. Focus on:
- Haskell syntax errors
- Missing dependencies in cabal.project or *.cabal files
- Type mismatches and compilation errors
- Nix environment setup issues
- Validating that the previous implementation in temp_instruction.txt was done correctly
- Any other compilation errors shown above.

Ensure the code compiles successfully with 'nix develop -c cabal build all'.
CRITICAL CHECKS:
1. Verify the new CONNECTOR_NAME.hs module is added to euler-x.cabal file ONLY under library/exposed modules.
2. Verify the Changes are done Correctly in ConnectorService/CONNECTOR_NAME.hs.
3. Verify the changes are done correctly in ConnectorService/Flow.hs file.`;
        }
        
        const instructionFilePath = path.join(repositoryPath, 'temp_instructions.txt');
        await writeFile(instructionFilePath, fixInstruction, 'utf-8');
        console.log(`✅ Fix instruction written to ${instructionFilePath}`);
        
        // Run Xyne evaluation to fix build errors
        console.log(`Running Xyne evaluation to fix ${buildType.toLowerCase()} build errors...`);
        const evalCommand = `xyne prompt "$(cat '${instructionFilePath}')" --debug`;
        
        try {
          await execAsync(evalCommand, { cwd: repositoryPath });
          console.log(`Xyne evaluation for ${buildType.toLowerCase()} build fix completed.`);
        } catch (evalError: any) {
          console.log(`⚠️ Xyne evaluation failed: ${evalError.message}`);
          console.log(`Continuing with next ${buildType.toLowerCase()} build attempt...`);
        }
      }
    }
    
    return {
      success: false,
      output: '',
      stderr: 'Build validation failed after maximum attempts',
      exitCode: 1
    };
  }
};

export const commitAndPushTool: Tool<{
  repositoryPath: string;
  branchName: string;
  commitMessage: string;
}, PipelineContext> = {
  schema: {
    name: 'commit_and_push',
    description: 'Commit changes and push to repository',
    parameters: z.object({
      repositoryPath: z.string().describe('Path to the repository'),
      branchName: z.string().describe('Branch name to create and push'),
      commitMessage: z.string().describe('Commit message')
    })
  },
  execute: async (args) => {
    const { repositoryPath, branchName, commitMessage } = args;
    
    try {
      console.log('Creating and switching to new branch...');
      await execAsync(`git checkout -b ${branchName}`, { cwd: repositoryPath });
      
      console.log('Staging changes...');
      await execAsync('git add .', { cwd: repositoryPath });
      
      console.log('Committing changes...');
      await execAsync(`git commit -m "${commitMessage}"`, { cwd: repositoryPath });
      
      console.log('Pushing new branch to origin...');
      await execAsync(`git push origin ${branchName} --force`, { cwd: repositoryPath });
      
      // Get commit ID
      const { stdout: commitId } = await execAsync('git rev-parse --short HEAD', { cwd: repositoryPath });
      
      console.log('Changes committed and pushed successfully.');
      console.log(`Commit ID: ${commitId.trim()}`);
      
      return {
        success: true,
        commitId: commitId.trim(),
        branchName
      };
      
    } catch (error: any) {
      throw new Error(`Failed to commit and push: ${error.message}`);
    }
  }
};