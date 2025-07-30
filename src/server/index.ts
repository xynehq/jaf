import { createFAFServer } from './server';
import { ServerConfig } from './types';
import { Agent, RunConfig } from '../core/types';

/**
 * Start a development server for testing agents locally (functional approach)
 * 
 * @param agents - Map of agent name to agent definition, or array of agents
 * @param runConfig - Configuration for running agents
 * @param options - Server configuration options (including optional memory provider)
 * @returns Promise that resolves to server instance
 * 
 * @example
 * ```typescript
 * import { runServer, makeLiteLLMProvider, createInMemoryProvider } from 'functional-agent-framework';
 * 
 * const myAgent = {
 *   name: 'MyAgent',
 *   instructions: 'You are a helpful assistant',
 *   tools: []
 * };
 * 
 * const modelProvider = makeLiteLLMProvider('http://localhost:4000');
 * const memoryProvider = createInMemoryProvider();
 * 
 * const server = await runServer(
 *   [myAgent], 
 *   { modelProvider },
 *   { port: 3000, defaultMemoryProvider: memoryProvider }
 * );
 * ```
 */
export async function runServer<Ctx>(
  agents: Map<string, Agent<Ctx, any>> | Agent<Ctx, any>[],
  runConfig: Omit<RunConfig<Ctx>, 'agentRegistry'>,
  options: Partial<Omit<ServerConfig<Ctx>, 'runConfig' | 'agentRegistry'>> = {}
): Promise<ReturnType<typeof createFAFServer<Ctx>>> {
  // Convert agents array to Map if needed
  let agentRegistry: Map<string, Agent<Ctx, any>>;
  
  if (Array.isArray(agents)) {
    agentRegistry = new Map();
    for (const agent of agents) {
      agentRegistry.set(agent.name, agent);
    }
  } else {
    agentRegistry = agents;
  }

  // Validate that we have at least one agent
  if (agentRegistry.size === 0) {
    throw new Error('At least one agent must be provided');
  }

  // Create complete run config
  const completeRunConfig: RunConfig<Ctx> = {
    agentRegistry,
    ...runConfig
  };

  // Create server config
  const serverConfig: ServerConfig<Ctx> = {
    port: 3000,
    host: '127.0.0.1',
    cors: false,
    ...options,
    runConfig: completeRunConfig,
    agentRegistry
  };

  // Create and start functional server
  const server = createFAFServer(serverConfig);
  await server.start();
  
  return server;
}


export { createFAFServer } from './server';
// runServer is exported above
export type { 
  ServerConfig, 
  ChatRequest, 
  ChatResponse, 
  AgentListResponse, 
  HealthResponse 
} from './types';