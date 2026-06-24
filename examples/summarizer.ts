#!/usr/bin/env npx tsx
/**
 * Summarizer Tool Example
 * 
 * Demonstrates the usage of the JAF summarizer tool with various text inputs
 * including file I/O integration for loading and summarizing documents.
 */

import { summarizerTool, createSummarizerTool } from '../src/adk/tools/summarizer-tool';
import { createFunctionTool } from '../src/adk/tools';
import { ToolContext } from '../src/adk/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { processDocument } from '../src/utils/document-processor';

const createFileLoaderTool = () => {
  return createFunctionTool({
    name: 'load_file',
    description: 'Load text content from a file',
    parameters: [
      {
        name: 'filepath',
        type: 'string',
        description: 'Path to the file to load',
        required: true,
      },
    ],
    execute: async (params: Record<string, unknown>) => {
      const filepath = params.filepath as string;
      const fullPath = path.resolve(filepath);
      
      try {
        const stats = await fs.stat(fullPath);
        if (!stats.isFile()) {
          throw new Error(`Path ${fullPath} is not a file`);
        }
        
        const extension = path.extname(fullPath).toLowerCase();
        
        if (['.pdf', '.docx', '.xlsx', '.csv'].includes(extension)) {
          const content = await processDocument(fullPath);
          return {
            success: true,
            data: {
              content,
              metadata: {
                filepath: fullPath,
                size: stats.size,
                extension,
              },
            },
          };
        } else {
          const content = await fs.readFile(fullPath, 'utf-8');
          return {
            success: true,
            data: {
              content,
              metadata: {
                filepath: fullPath,
                size: stats.size,
                extension,
              },
            },
          };
        }
      } catch (error) {
        return {
          success: false,
          error: `Failed to load file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    },
  });
};

const demonstrateSummarizer = async () => {
  console.log('🚀 JAF Summarizer Tool Demonstration\n');
  console.log('=' . repeat(50));
  
  const context: ToolContext = {
    userId: 'demo-user',
    permissions: ['read', 'write'],
  };
  
  const fileLoader = createFileLoaderTool();
  
  const sampleText = `
    The JavaScript Agent Framework (JAF) is a functional programming framework designed for building AI agents with immutable state management and composable tools. It emphasizes pure functions, type safety through TypeScript, and a clear separation of concerns between the core system, ADK layer, and provider implementations.
    
    Key features include:
    - Immutable state management ensuring predictable agent behavior
    - Tool composition allowing developers to build complex capabilities from simple functions
    - Support for multiple AI providers including OpenAI, Anthropic, and Google
    - Built-in memory providers for conversation history and context management
    - Human-in-the-loop capabilities for approval workflows
    - Comprehensive error handling and retry mechanisms
    - Type-safe interfaces throughout the system
    
    The framework is designed with functional programming principles at its core, avoiding classes and mutations in favor of pure functions and immutable data structures. This approach leads to more predictable, testable, and maintainable code.
  `;
  
  console.log('\n📝 Example 1: Summarizing inline text (paragraph style)');
  console.log('-' . repeat(50));
  
  const result1 = await summarizerTool.execute(
    {
      text: sampleText,
      maxLength: 100,
      style: 'paragraph',
    },
    context
  );
  
  if (result1.success) {
    console.log('✅ Summary generated successfully!');
    console.log('\nSummary:', result1.data.summary);
    console.log('\nMetadata:', JSON.stringify(result1.data.metadata, null, 2));
  } else {
    console.log('❌ Error:', result1.error);
  }
  
  console.log('\n📝 Example 2: Summarizing with bullet points');
  console.log('-' . repeat(50));
  
  const result2 = await summarizerTool.execute(
    {
      text: sampleText,
      maxLength: 150,
      style: 'bullet',
    },
    context
  );
  
  if (result2.success) {
    console.log('✅ Bullet point summary generated!');
    console.log('\nSummary:\n', result2.data.summary);
    console.log('\nCompression Ratio:', result2.data.metadata.compressionRatio);
  }
  
  console.log('\n📝 Example 3: Key points extraction');
  console.log('-' . repeat(50));
  
  const result3 = await summarizerTool.execute(
    {
      text: sampleText,
      maxLength: 120,
      style: 'key-points',
    },
    context
  );
  
  if (result3.success) {
    console.log('✅ Key points extracted!');
    console.log('\nKey Points:\n', result3.data.summary);
  }
  
  console.log('\n📝 Example 4: Summarizing a file (if README.md exists)');
  console.log('-' . repeat(50));
  
  const readmePath = './README.md';
  try {
    await fs.access(readmePath);
    console.log(`Loading file: ${readmePath}`);
    
    const fileResult = await fileLoader.execute({ filepath: readmePath }, context);
    
    if (fileResult.success) {
      console.log(`✅ File loaded successfully (${fileResult.data.metadata.size} bytes)`);
      
      const summaryResult = await summarizerTool.execute(
        {
          text: fileResult.data.content,
          maxLength: 200,
          style: 'paragraph',
        },
        context
      );
      
      if (summaryResult.success) {
        console.log('\n📄 README.md Summary:');
        console.log(summaryResult.data.summary);
        console.log('\nStats:');
        console.log(`- Original length: ${summaryResult.data.metadata.originalLength} chars`);
        console.log(`- Summary length: ${summaryResult.data.metadata.summaryLength} chars`);
        console.log(`- Compression: ${summaryResult.data.metadata.compressionRatio}`);
      }
    }
  } catch (error) {
    console.log('⚠️  README.md not found, skipping file example');
  }
  
  console.log('\n📝 Example 5: Using custom model (GPT-4)');
  console.log('-' . repeat(50));
  
  const customSummarizer = createSummarizerTool('gpt-4o');
  
  const result5 = await customSummarizer.execute(
    {
      text: 'The quick brown fox jumps over the lazy dog. This pangram contains all letters of the English alphabet at least once.',
      maxLength: 50,
      style: 'paragraph',
    },
    context
  );
  
  if (result5.success) {
    console.log('✅ Custom model summary:', result5.data.summary);
  }
  
  console.log('\n📝 Example 6: Error handling demonstration');
  console.log('-' . repeat(50));
  
  const errorResult = await summarizerTool.execute(
    {
      text: '',
      maxLength: 100,
    },
    context
  );
  
  if (!errorResult.success) {
    console.log('✅ Error handled correctly:', errorResult.error);
  }
  
  console.log('\n📝 Example 7: Long document summarization');
  console.log('-' . repeat(50));
  
  const longText = `
    ${sampleText}
    
    The framework's architecture consists of three main layers:
    
    The Core Layer provides fundamental types and interfaces that define the agent system's behavior. This includes agent definitions, tool interfaces, memory providers, and state management utilities. The core is designed to be provider-agnostic and focuses on the essential abstractions needed for agent operation.
    
    The ADK (Agent Development Kit) Layer offers high-level utilities and helpers for building agents quickly. It includes tool creation utilities, agent builders, common patterns, and integrations with external tool ecosystems like CrewAI and LangChain. The ADK simplifies the development experience while maintaining the functional programming principles of the core.
    
    The Provider Layer implements specific AI model integrations. JAF supports multiple providers including OpenAI, Anthropic's Claude, Google's Gemini, and any LiteLLM-compatible endpoint. Each provider implementation handles model-specific details like token counting, streaming responses, and error handling while conforming to the common provider interface.
    
    Memory management in JAF is handled through composable memory providers that can be combined to create sophisticated context management strategies. The framework includes built-in providers for conversation history, vector similarity search, and custom memory implementations. All memory operations are immutable, ensuring that agent state remains predictable and debuggable.
    
    The tool system allows developers to create reusable capabilities that agents can leverage. Tools are pure functions with defined schemas, making them easy to test, compose, and share. The framework includes adapters for popular tool ecosystems and supports OpenAPI-based tool generation for integrating with external APIs.
  `.trim();
  
  const longResult = await summarizerTool.execute(
    {
      text: longText,
      maxLength: 250,
      style: 'paragraph',
    },
    context
  );
  
  if (longResult.success) {
    console.log('✅ Long document summarized successfully!');
    console.log('\nOriginal length:', longResult.data.metadata.originalLength, 'characters');
    console.log('Summary length:', longResult.data.metadata.summaryLength, 'characters');
    console.log('Compression:', longResult.data.metadata.compressionRatio);
    console.log('\nSummary:');
    console.log(longResult.data.summary);
  }
  
  console.log('\n' + '=' . repeat(50));
  console.log('✨ Demonstration complete!');
};

const main = async () => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('⚠️  Warning: OPENAI_API_KEY not found in environment');
      console.log('Please set OPENAI_API_KEY in your environment');
      console.log('Example: export OPENAI_API_KEY=sk-...');
      console.log('\nSkipping API calls, showing structure only...\n');
      
      console.log('📝 Tool Structure:');
      console.log('- Name: summarize_text');
      console.log('- Parameters:');
      console.log('  • text (string, required): The text to summarize');
      console.log('  • maxLength (number, optional): Max tokens (default: 150)');
      console.log('  • style (enum, optional): bullet/paragraph/key-points');
      console.log('  • model (string, optional): OpenAI model (default: gpt-4o-mini)');
      console.log('\n✅ Tool implementation complete!');
      process.exit(0);
    }
    
    await demonstrateSummarizer();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
};

if (require.main === module) {
  main();
}