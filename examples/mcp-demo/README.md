# MCP Filesystem Server Demo

This demo showcases the integration of **Model Context Protocol (MCP)** with the **Juspay Agent Framework (JAF)**. It demonstrates how to build AI agents that can perform filesystem operations using MCP tools, providing a secure and interactive file management system.

## 🎯 Features Demonstrated

- **Real MCP Integration**: Uses official @modelcontextprotocol/server-filesystem
- **Secure File Operations**: Path validation and restricted directory access
- **Interactive Agents**: HTTP endpoints for filesystem operations via curl
- **Multiple Agent Types**: Comprehensive and quick file operation specialists
- **Error Handling**: Robust error management with user-friendly feedback
- **JAF Integration**: Full framework orchestration with memory and tracing

## 🛠️ Setup Requirements

### 1. Install Dependencies

```bash
# In the mcp-demo directory
npm install
```

### 2. Environment Configuration

```bash
# Copy the example environment file
cp .env.example .env

# Edit the .env file with your configuration
nano .env
```

Required environment variables:
- `LITELLM_URL`: Your LiteLLM proxy endpoint (default: http://localhost:4000)
- `LITELLM_API_KEY`: Your LiteLLM API key
- `LITELLM_MODEL`: The model name (default: gemini-2.5-pro)
- `PORT`: Server port (default: 3003)
- `HOST`: Server host (default: 127.0.0.1)

### 3. MCP Server Requirements

This demo uses the official MCP filesystem server via npx:
- No additional installation required
- Automatically downloads @modelcontextprotocol/server-filesystem
- Requires internet connection for initial download

## 🚀 Running the Demo

```bash
# Make sure you have your .env file configured
cp .env.example .env
# Edit .env with your actual values

# Run the demo
npm run dev

# Or start normally
npm start

# Or build and run
npm run build
```

## 📁 Project Structure

```
mcp-demo/
├── mcp-filesystem-server.ts  # Main MCP filesystem server implementation
├── package.json              # Dependencies and scripts
├── tsconfig.json            # TypeScript configuration
├── .env.example             # Environment variables template
└── README.md                # This file
```

## 🔧 Configuration

### Security Configuration

The demo is configured with secure path restrictions:

```typescript
const allowedPaths = ['/Users'];
```

**To modify allowed directories:**

1. Update the `allowedPaths` array in `mcp-filesystem-server.ts`
2. Ensure paths are absolute and secure
3. Test path validation before deployment

### MCP Server Configuration

The demo connects to the filesystem MCP server using:

```typescript
const mcpClient = await makeMCPClient('npx', [
  '-y',
  '@modelcontextprotocol/server-filesystem',
  '/Users',  // Root directory for filesystem access
]);
```

## 🎮 Demo Scenarios

### 1. List Desktop Files

```bash
curl -X POST http://localhost:3003/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "List all files in my Desktop directory"}],
    "agentName": "FilesystemAgent",
    "context": {"userId": "user_001", "sessionId": "session_123"}
  }'
```

### 2. Create a Test File

```bash
curl -X POST http://localhost:3003/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Create a file called hello.txt on my Desktop with the content: Hello from MCP filesystem agent!"}],
    "agentName": "FilesystemAgent",
    "context": {"userId": "user_001", "sessionId": "session_123"}
  }'
```

### 3. Read File Contents

```bash
curl -X POST http://localhost:3003/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Read the contents of /Users/harshpreet.singh/Desktop/hello.txt"}],
    "agentName": "FilesystemAgent",
    "context": {"userId": "user_001", "sessionId": "session_123"}
  }'
```

### 4. Get File Information

```bash
curl -X POST http://localhost:3003/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Get information about the file /Users/harshpreet.singh/Desktop/hello.txt"}],
    "agentName": "FilesystemAgent",
    "context": {"userId": "user_001", "sessionId": "session_123"}
  }'
```

### 5. Quick File Operations

```bash
curl -X POST http://localhost:3003/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Quickly list files in Desktop"}],
    "agentName": "QuickFileAgent",
    "context": {"userId": "user_001", "sessionId": "session_123"}
  }'
```

## 📊 Available Agents

### 1. FilesystemAgent
- **Purpose**: Comprehensive filesystem operations
- **Capabilities**: All MCP filesystem tools
- **Use Case**: Complex file management tasks

### 2. QuickFileAgent
- **Purpose**: Simple, fast file operations
- **Capabilities**: Basic read/write/list operations
- **Use Case**: Quick file tasks with minimal overhead

## 🔧 Available MCP Tools

The demo integrates the following MCP filesystem tools:

- **read_text_file**: Read contents of text files
- **write_file**: Create or overwrite files
- **list_directory**: List directory contents
- **get_file_info**: Get file metadata and information
- **create_directory**: Create new directories
- **move_file**: Move or rename files
- **copy_file**: Copy files to new locations
- **delete_file**: Delete files (with confirmation)

## 📊 Sample Output

```
🚀 Starting MCP Filesystem Agent Server...

🔌 Connecting to filesystem MCP server...
📋 Available filesystem tools:
1. read_text_file: Read the complete contents of a text file...
2. write_file: Write content to a file at the specified path...
3. list_directory: Get the contents of a directory...
4. get_file_info: Get metadata and information about a file or directory...

✅ Successfully integrated 8 filesystem tools
✅ MCP Filesystem Server started successfully!
🌐 Server running on http://127.0.0.1:3003

🤖 Available Agents:
1. FilesystemAgent - Comprehensive filesystem operations
2. QuickFileAgent - Simple file operations specialist

🔧 Available Filesystem Tools:
1. read_text_file - Read the complete contents of a text file...
2. write_file - Write content to a file at the specified path...
3. list_directory - Get the contents of a directory...
4. get_file_info - Get metadata and information about a file or directory...

📊 Server endpoints:
   GET  /health         - Health check
   GET  /agents         - List available agents
   POST /chat           - Perform filesystem operations

💡 Key Features:
   • Real MCP integration with @modelcontextprotocol/server-filesystem
   • Secure path validation (Desktop and /tmp only)
   • Interactive agent responses via curl/HTTP
   • Comprehensive filesystem operations
   • Error handling and user-friendly feedback

🔒 Security:
   • Operations restricted to allowed directories only
   • Path validation on all file operations
   • Safe MCP tool integration
```

## 🔒 Security Features

- **Path Validation**: All file operations validate paths against allowed directories
- **Directory Restrictions**: Limited to `/Users/harshpreet.singh/Desktop` and `/tmp`
- **Input Sanitization**: Comprehensive input validation using Zod schemas
- **Error Isolation**: Safe error handling prevents system exposure
- **MCP Security**: Leverages MCP's built-in security features

## 🐛 Troubleshooting

### MCP Connection Issues

If you see "Failed to connect to filesystem MCP server":

```bash
# Ensure internet connection for npx download
# Check if npx is available
npx --version

# Manually test MCP server
npx -y @modelcontextprotocol/server-filesystem /Users
```

### Path Permission Errors

If you see "Path not in allowed directories":

```bash
# Check the allowed paths in mcp-filesystem-server.ts
# Ensure you're using absolute paths
# Verify directory permissions
```

### LiteLLM Connection Issues

```bash
# Check LiteLLM server status
curl http://localhost:4000/health

# Verify API key format
# Ensure model is available
curl http://localhost:4000/v1/models
```

### Port Already in Use

```bash
# Check what's using port 3003
lsof -i :3003

# Use a different port
PORT=3004 npm start
```

## 🎯 Integration Points

This demo shows how JAF integrates with MCP:

1. **MCP Client Setup**: Connecting to external MCP servers
2. **Tool Conversion**: Converting MCP tools to JAF format
3. **Security Layer**: Adding validation and restrictions
4. **Agent Integration**: Using MCP tools in JAF agents
5. **Error Handling**: Robust error management
6. **HTTP Interface**: Exposing MCP functionality via REST API

## 🚀 Next Steps

- **Custom MCP Servers**: Create your own MCP servers for specific domains
- **Multi-Protocol Integration**: Combine MCP with other protocols
- **Advanced Security**: Implement user-based permissions
- **File Type Support**: Add support for binary files and media
- **Batch Operations**: Implement bulk file operations
- **Audit Logging**: Add comprehensive operation logging

## 📚 Related Documentation

- [JAF Framework Documentation](../../README.md)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP Filesystem Server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)
- [JAF MCP Integration](../../src/providers/mcp.ts)

---

**Ready to explore AI agents with real filesystem capabilities!** 🗂️
