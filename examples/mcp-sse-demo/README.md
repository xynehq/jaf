## Cloudflare Docs MCP (Streamable HTTP + SSE) Demo

This demo connects to a remote MCP server that uses the Streamable HTTP transport with Server‑Sent Events (SSE). It lists the available tools from the Cloudflare Docs MCP endpoint.

Reference: https://docs.mcp.cloudflare.com/sse

### Run

```bash
# From the repo root
pnpm --filter ./examples/mcp-cloudflare-docs dev

# Or
pnpm --filter ./examples/mcp-cloudflare-docs start
```

You can also override the endpoint via env:

```bash
CF_MCP_URL=https://docs.mcp.cloudflare.com/sse pnpm --filter ./examples/mcp-cloudflare-docs start
```

The script prints the tools discovered from the remote MCP server. You can then adapt the tool list to JAF tools via `mcpToolToJAFTool` and attach them to an agent.

### Notes

- This demo uses `makeMCPClientSSE` from JAF to connect with `@modelcontextprotocol/sdk`’s SSE client transport.
- If your remote server requires authentication, update the server to use query params or an SDK version that supports passing headers to `SSEClientTransport`.

