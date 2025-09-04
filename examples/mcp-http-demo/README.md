# MCP Streamable HTTP Transport Demo

This demo connects to a remote MCP server that uses the Streamable HTTP transport. It uses HTTP POST for sending messages and HTTP GET with Server-Sent Events for receiving messages, per the MCP specification.

## Features

- **Streamable HTTP Transport**: Uses the official MCP SDK's `StreamableHTTPClientTransport`
- **Session Management**: Supports session IDs for maintaining server-side state
- **Authentication**: Supports custom headers for API tokens or authentication
- **Custom Fetch**: Allows custom fetch implementation for proxy or middleware support

## Run

```bash
# From the repo root
pnpm --filter ./examples/mcp-http-demo dev

# Or
pnpm --filter ./examples/mcp-http-demo start
```

You can override the endpoint and credentials via environment variables:

```bash
MCP_HTTP_URL=https://your-mcp-server.com/mcp \
MCP_API_TOKEN=your-api-token \
pnpm --filter ./examples/mcp-http-demo start
```

## Running the JAF Server

To run a JAF server that integrates with your MCP server:

```bash
# Set your MCP server details
export MCP_HTTP_URL=https://your-mcp-server.com/mcp
export MCP_API_TOKEN=your-api-token

# Set your LLM provider details
export LITELLM_URL=http://localhost:4000
export LITELLM_API_KEY=your-api-key
export LITELLM_MODEL=gpt-3.5-turbo

# Start the server
pnpm --filter ./examples/mcp-http-demo run server
```

The script prints the tools discovered from the remote MCP server. You can then interact with the JAF server endpoints:

- `GET /health` - Health check
- `GET /agents` - List available agents
- `POST /agents/MCPHttpAgent/chat` - Chat with the MCP-powered agent

## Notes

- This demo uses `makeMCPClientHTTP` from JAF to connect with the MCP SDK's Streamable HTTP client transport
- The transport handles reconnection, session management, and OAuth authentication automatically
- For servers requiring authentication, configure the `headers` option with your API tokens
- Session IDs are automatically generated but can be customized for session persistence

## Transport Comparison

| Transport | Use Case | Connection | Message Flow |
|-----------|----------|------------|--------------|
| **STDIO** | Local MCP servers | subprocess | stdin/stdout |
| **SSE** | Simple remote servers | HTTP GET (SSE only) | Server-Sent Events |
| **Streamable HTTP** | Full-featured remote servers | HTTP POST + GET (SSE) | Bidirectional with sessions |

Choose Streamable HTTP when you need:
- Session management
- Authentication/authorization
- Bidirectional communication
- Reconnection handling
- Production-ready remote MCP servers