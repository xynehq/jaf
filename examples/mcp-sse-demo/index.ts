import 'dotenv/config'
import { makeMCPClientSSE } from '../../src/providers/mcp'

async function main() {
  // Cloudflare Docs MCP server (Streamable HTTP + SSE)
  const endpoint = process.env.CF_MCP_URL || 'https://docs.mcp.cloudflare.com/sse'

  console.log('Connecting to remote MCP server (SSE):', endpoint)
  const client = await makeMCPClientSSE(endpoint)

  try {
    const tools = await client.listTools()
    console.log(`\nDiscovered ${tools.length} tools from Cloudflare Docs MCP:`)
    for (const t of tools) {
      console.log(`- ${t.name}${t.description ? `: ${t.description}` : ''}`)
    }

    console.log('\nExample complete. You can now wire these tools into a JAF agent via mcpToolToJAFTool.')
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error('MCP Cloudflare docs demo failed:', err)
  process.exit(1)
})

