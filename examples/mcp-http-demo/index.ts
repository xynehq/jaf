import 'dotenv/config'
import { makeMCPClientHTTP } from '../../src/providers/mcp'

async function main() {
  // Example MCP server with Streamable HTTP transport
  const endpoint = process.env.MCP_HTTP_URL || 'http://127.0.0.1:8000/mcp'

  console.log('Connecting to remote MCP server (Streamable HTTP):', endpoint)
  
  try {
    const client = await makeMCPClientHTTP(endpoint, {
      headers: {
        // Optional: include auth or custom headers for the remote MCP server
        Authorization: `Bearer ${process.env.MCP_API_TOKEN ?? ''}`,
      },
      // sessionId: Let the server generate a session ID automatically
    })

    try {
      const tools = await client.listTools()
      console.log(`\nDiscovered ${tools.length} tools from MCP server:`)
      for (const t of tools) {
        console.log(`- ${t.name}${t.description ? `: ${t.description}` : ''}`)
      }

      console.log('\nExample complete. You can now wire these tools into a JAF agent via mcpToolToJAFTool.')
    } finally {
      await client.close()
    }
  } catch (error) {
    console.error('Failed to connect to MCP server:', error)
    console.log('\nTip: Set MCP_HTTP_URL environment variable to point to your MCP server endpoint')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('MCP HTTP demo failed:', err)
  process.exit(1)
})