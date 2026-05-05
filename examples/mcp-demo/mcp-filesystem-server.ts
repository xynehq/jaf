/**
 * Interactive MCP Filesystem Server
 * 
 * Simple JAF server with filesystem MCP tools that responds to curl requests.
 * Similar to RCA agent but for filesystem operations.
 */

import 'dotenv/config';
import { 
  runServer,
  Agent,
  Tool,
  makeLiteLLMProvider,
  ConsoleTraceCollector,
  ToolResponse,
  withErrorHandling,
  createInMemoryProvider,
  ToolErrorCodes
} from '@juspay-xyne-jaf/jaf';
import { makeMCPClient, mcpToolToJAFTool } from '@juspay-xyne-jaf/jaf/providers';
import { z } from 'zod';

// Context type for filesystem operations
type FilesystemContext = {
  userId: string;
  sessionId: string;
  workingDirectory?: string;
  allowedPaths?: string[];
};

// Setup filesystem MCP tools
async function setupFilesystemMCPTools(): Promise<Tool<any, FilesystemContext>[]> {
  try {
    console.log('🔌 Connecting to filesystem MCP server...');
    
    // Connect to filesystem MCP server using npx
    const mcpClient = await makeMCPClient('npx', [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '/Users',  // Allow access to Users directory
    ]);

    // List available filesystem tools
    const mcpTools = await mcpClient.listTools();
    console.log('📋 Available filesystem tools:');
    
    mcpTools.forEach((tool, index) => {
      console.log(`${index + 1}. ${tool.name}: ${tool.description?.substring(0, 80)}...`);
    });

    if (mcpTools.length === 0) {
      console.warn('⚠️  No filesystem tools found! Please check MCP server connection.');
      return [];
    }

    // Convert MCP tools to FAF tools
    const fafFilesystemTools = mcpTools.map(tool => {
      const fafTool = mcpToolToJAFTool<FilesystemContext>(mcpClient, tool);
      
      // Wrap with additional error handling and logging
      return {
        ...fafTool,
        execute: withErrorHandling(tool.name, async (args: any, context: FilesystemContext) => {
          try {
            console.log(`🔧 Executing ${tool.name} with args:`, args);
            
            // Add path validation for security
            if (args.path && typeof args.path === 'string') {
              const allowedPaths = ['/Users/harshpreet.singh/Desktop', '/tmp'];
              const isAllowed = allowedPaths.some(allowedPath => 
                args.path.startsWith(allowedPath)
              );
              
              if (!isAllowed) {
                return ToolResponse.error(
                  ToolErrorCodes.INVALID_INPUT,
                  `Path '${args.path}' is not in allowed directories: ${allowedPaths.join(', ')}`
                );
              }
            }
            
            const result = await fafTool.execute(args, context);
            console.log(`✅ ${tool.name} completed successfully`);
            return result;
          } catch (error) {
            console.error(`❌ Error in ${tool.name}:`, error);
            return ToolResponse.error(
              ToolErrorCodes.EXECUTION_FAILED,
              `Failed to execute ${tool.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        })
      };
    });

    console.log(`✅ Successfully integrated ${fafFilesystemTools.length} filesystem tools`);
    return fafFilesystemTools;

  } catch (error) {
    console.error('❌ Failed to connect to filesystem MCP server:', error);
    console.error('Make sure you have internet connection for npx to download the package');
    return [];
  }
}

// Create filesystem agents
async function createFilesystemAgents(filesystemTools: Tool<any, FilesystemContext>[]) {
  
  // Main Filesystem Agent - comprehensive file operations
  const filesystemAgent: Agent<FilesystemContext, string> = {
    name: 'FilesystemAgent',
    instructions: (state) => {
      const context = state.context;
      return `You are an intelligent filesystem assistant powered by MCP (Model Context Protocol) tools.

**Your Role:**
- Help users perform filesystem operations safely and efficiently
- Provide file and directory management capabilities
- Support content creation, reading, modification, and organization
- Ensure operations stay within allowed directories for security

**Available Operations:**
${filesystemTools.map(tool => `- ${tool.schema.name}: ${tool.schema.description}`).join('\n')}

**Security Boundaries:**
- Allowed directories: /Users/harshpreet.singh/Desktop, /tmp
- All file paths must be within these directories
- Always validate paths before operations

**Current Context:**
- User: ${context.userId}
- Session: ${context.sessionId}
${context.workingDirectory ? `- Working Directory: ${context.workingDirectory}` : ''}
${context.allowedPaths ? `- Custom Allowed Paths: ${context.allowedPaths.join(', ')}` : ''}

**Best Practices:**
- Always check if files/directories exist before operations
- Use absolute paths for clarity
- Provide helpful feedback about operations performed
- Suggest related operations when appropriate
- Handle errors gracefully and explain what went wrong

**Example Operations:**
- "List files in Desktop" → use list_directory
- "Create a test file" → use write_file 
- "Read file contents" → use read_text_file
- "Get file information" → use get_file_info
- "Find allowed directories" → use list_allowed_directories

Be helpful, safe, and informative in all filesystem operations!`;
    },
    tools: filesystemTools
  };

  // Quick File Operations Agent
  const quickFileAgent: Agent<FilesystemContext, string> = {
    name: 'QuickFileAgent',
    instructions: (state) => `You are a quick file operations specialist focusing on common file tasks.

**Your Role:**
- Handle simple, common file operations quickly
- Focus on basic read/write/list operations
- Provide concise, direct responses

**Available Tools:** ${filesystemTools.filter(t => 
      ['read_text_file', 'write_file', 'list_directory', 'get_file_info'].includes(t.schema.name)
    ).map(t => t.schema.name).join(', ')}

**Context:**
- User: ${state.context.userId}
- Session: ${state.context.sessionId}

Keep operations simple and responses brief but informative.`,
    tools: filesystemTools.filter(t => 
      ['read_text_file', 'write_file', 'list_directory', 'get_file_info'].includes(t.schema.name)
    )
  };

  return {
    filesystemAgent,
    quickFileAgent
  };
}

// Start filesystem server function
export async function startFilesystemServer() {
  console.log('🚀 Starting MCP Filesystem Agent Server...\n');

  // Setup MCP tools
  const filesystemTools = await setupFilesystemMCPTools();
  
  if (filesystemTools.length === 0) {
    console.error('❌ No filesystem tools available. Cannot start server.');
    process.exit(1);
  }

  // Create agents
  const { filesystemAgent, quickFileAgent } = await createFilesystemAgents(filesystemTools);

  const modelProvider = makeLiteLLMProvider(
    process.env.LITELLM_URL || 'http://localhost:4000',
    process.env.LITELLM_API_KEY
  ) as any;

  const traceCollector = new ConsoleTraceCollector();
  const memoryProvider = createInMemoryProvider();

  try {
    const server = await runServer(
      [filesystemAgent, quickFileAgent],
      {
        modelProvider,
        maxTurns: 10,
        modelOverride: process.env.LITELLM_MODEL || 'gemini-2.5-pro',
        onEvent: traceCollector.collect.bind(traceCollector),
        memory: {
          provider: memoryProvider,
          autoStore: true,
          maxMessages: 50
        }
      },
      {
        port: parseInt(process.env.PORT || '3003'),
        host: process.env.HOST || '127.0.0.1',
        cors: true,
        defaultMemoryProvider: memoryProvider
      }
    );

    console.log('✅ MCP Filesystem Server started successfully!');
    console.log(`🌐 Server running on http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || '3003'}`);
    
    console.log('\n🤖 Available Agents:');
    console.log('1. FilesystemAgent - Comprehensive filesystem operations');
    console.log('2. QuickFileAgent - Simple file operations specialist');
    
    console.log('\n🔧 Available Filesystem Tools:');
    filesystemTools.forEach((tool, index) => {
      console.log(`${index + 1}. ${tool.schema.name} - ${tool.schema.description?.substring(0, 60)}...`);
    });
    
    console.log('\n📚 Example curl commands:');
    
    console.log('\n📂 List Desktop files:');
    console.log('curl -X POST http://localhost:3003/chat \\');
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"messages":[{"role":"user","content":"List all files in my Desktop directory"}],"agentName":"FilesystemAgent","context":{"userId":"user_001","sessionId":"session_123"}}\'');
    
    console.log('\n📝 Create a test file:');
    console.log('curl -X POST http://localhost:3003/chat \\');
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"messages":[{"role":"user","content":"Create a file called hello.txt on my Desktop with the content: Hello from MCP filesystem agent!"}],"agentName":"FilesystemAgent","context":{"userId":"user_001","sessionId":"session_123"}}\'');
    
    console.log('\n📖 Read a file:');
    console.log('curl -X POST http://localhost:3003/chat \\');
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"messages":[{"role":"user","content":"Read the contents of /Desktop/hello.txt"}],"agentName":"FilesystemAgent","context":{"userId":"user_001","sessionId":"session_123"}}\'');
    
    console.log('\n📊 Get file info:');
    console.log('curl -X POST http://localhost:3003/chat \\');
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"messages":[{"role":"user","content":"Get information about the file /Desktop/hello.txt"}],"agentName":"FilesystemAgent","context":{"userId":"user_001","sessionId":"session_123"}}\'');
    
    console.log('\n🗂️ Check allowed directories:');
    console.log('curl -X POST http://localhost:3003/chat \\');
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"messages":[{"role":"user","content":"What directories am I allowed to access?"}],"agentName":"FilesystemAgent","context":{"userId":"user_001","sessionId":"session_123"}}\'');
    
    console.log('\n📊 Server endpoints:');
    console.log('   GET  /health         - Health check');
    console.log('   GET  /agents         - List available agents');
    console.log('   POST /chat           - Perform filesystem operations');

    console.log('\n💡 Key Features:');
    console.log('   • Real MCP integration with @modelcontextprotocol/server-filesystem');
    console.log('   • Secure path validation (Desktop and /tmp only)');
    console.log('   • Interactive agent responses via curl/HTTP');
    console.log('   • Comprehensive filesystem operations');
    console.log('   • Error handling and user-friendly feedback');

    console.log('\n🔒 Security:');
    console.log('   • Operations restricted to allowed directories only');
    console.log('   • Path validation on all file operations');
    console.log('   • Safe MCP tool integration');

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n🔄 Received ${signal}, shutting down gracefully...`);
      await server.stop();
      console.log('🛑 Filesystem Server stopped');
      process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  } catch (error) {
    console.error('❌ Failed to start filesystem server:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  startFilesystemServer().catch(console.error);
}

// Export for testing
export type { FilesystemContext };
