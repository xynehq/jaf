import { FAFServer } from './server';
import { ServerConfig } from './types';
import { Agent, RunConfig } from '../core/types';

/**
 * Start a development server for testing agents locally
 * 
 * @param agents - Map of agent name to agent definition, or array of agents
 * @param runConfig - Configuration for running agents
 * @param options - Server configuration options
 * @returns Promise that resolves when server starts
 * 
 * @example
 * ```typescript
 * import { runServer, makeLiteLLMProvider } from 'functional-agent-framework';
 * 
 * const myAgent = {
 *   name: 'MyAgent',
 *   instructions: 'You are a helpful assistant',
 *   tools: []
 * };
 * 
 * const modelProvider = makeLiteLLMProvider('http://localhost:4000');
 * 
 * await runServer(
 *   [myAgent], 
 *   { modelProvider },
 *   { port: 3000 }
 * );
 * ```
 */
export async function runServer<Ctx>(
  agents: Map<string, Agent<Ctx, any>> | Agent<Ctx, any>[],
  runConfig: Omit<RunConfig<Ctx>, 'agentRegistry'>,
  options: Partial<Omit<ServerConfig<Ctx>, 'runConfig' | 'agentRegistry'>> = {}
): Promise<FAFServer<Ctx>> {
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
    host: '0.0.0.0',
    cors: true,
    ...options,
    runConfig: completeRunConfig,
    agentRegistry
  };

  // Create and start server
  const server = new FAFServer(serverConfig);
  await server.start();
  
  return server;
}

/**
 * Create a development server instance without starting it
 * Useful for testing or when you want to customize the server further
 */
export function createServer<Ctx>(
  agents: Map<string, Agent<Ctx, any>> | Agent<Ctx, any>[],
  runConfig: Omit<RunConfig<Ctx>, 'agentRegistry'>,
  options: Partial<Omit<ServerConfig<Ctx>, 'runConfig' | 'agentRegistry'>> = {}
): FAFServer<Ctx> {
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
    host: '0.0.0.0',
    cors: true,
    ...options,
    runConfig: completeRunConfig,
    agentRegistry
  };

  return new FAFServer(serverConfig);
}

export { FAFServer } from './server';
export type { 
  ServerConfig, 
  ChatRequest, 
  ChatResponse, 
  AgentListResponse, 
  HealthResponse 
} from './types';