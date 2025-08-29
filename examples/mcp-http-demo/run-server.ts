import 'dotenv/config'
import { runServer, Agent, makeLiteLLMProvider, ConsoleTraceCollector, createMemoryProviderFromEnv } from '@xynehq/jaf'
import { makeMCPClientHTTP, mcpToolToJAFTool } from '../../src/providers/mcp'

type Ctx = Record<string, never>

async function start() {
  const endpoint = process.env.MCP_HTTP_URL || 'https://example.com/mcp'
  console.log('Connecting to remote MCP server (Streamable HTTP):', endpoint)

  // Connect MCP and load tools
  const mcp = await makeMCPClientHTTP(endpoint, {
    headers: {
      Authorization: `Bearer ${process.env.MCP_API_TOKEN ?? ''}`,
    },
    // sessionId: Let the server generate a session ID automatically
  })
  const mcpTools = await mcp.listTools()
  console.log(`Loaded ${mcpTools.length} MCP tools`)

  // Convert MCP tools to JAF tools
  const jafTools = mcpTools.map(td => mcpToolToJAFTool<Ctx>(mcp, td))

  // Define a simple agent that uses the MCP tools
  const agent: Agent<Ctx, string> = {
    name: 'MCPHttpAgent',
    instructions: () => 'You are an assistant that answers questions using MCP tools over Streamable HTTP transport. Prefer calling tools to fetch authoritative answers.',
    tools: jafTools,
    modelConfig: { name: process.env.LITELLM_MODEL || 'gpt-3.5-turbo' }
  }

  // Model provider via LiteLLM (or OpenAI-compatible proxy)
  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000'
  const litellmKey = process.env.LITELLM_API_KEY
  console.log(`LiteLLM URL: ${litellmUrl} (key ${litellmKey ? 'set' : 'not set'})`)
  const modelProvider = makeLiteLLMProvider<Ctx>(litellmUrl, litellmKey)

  // Memory provider from env (in-memory by default)
  const memoryProvider = await createMemoryProviderFromEnv({})

  const trace = new ConsoleTraceCollector()

  // Start built-in JAF server
  await runServer<Ctx>(
    [agent],
    {
      modelProvider,
      maxTurns: 4,
      onEvent: trace.collect.bind(trace),
      memory: {
        provider: memoryProvider,
        autoStore: true,
        maxMessages: 100
      }
    },
    {
      port: parseInt(process.env.PORT || '4002', 10),
      host: process.env.HOST || '127.0.0.1',
      cors: false,
      defaultMemoryProvider: memoryProvider
    }
  )

  console.log('\nServer ready:')
  console.log('  GET  /health')
  console.log('  GET  /agents')
  console.log('  POST /chat')
  console.log('  POST /agents/MCPHttpAgent/chat')
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start JAF server:', err)
  process.exit(1)
})