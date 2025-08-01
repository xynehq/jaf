/**
 * Pure functional A2A server integration with FAF
 * Extends FAF server with A2A protocol support
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import type { 
  A2AServerConfig, 
  JSONRPCRequest, 
  JSONRPCResponse, 
  AgentCard,
  A2AAgent,
  A2ATask
} from './types.js';
import { generateAgentCard } from './agent-card.js';
import { createProtocolHandlerConfig } from './protocol.js';
import { createA2ATaskProvider, createSimpleA2ATaskProvider } from './memory/factory.js';

// Pure function to create A2A server configuration
export const createA2AServerConfig = async (config: A2AServerConfig) => {
  const host = config.host || 'localhost';
  const capabilities = config.capabilities || {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true
  };
  
  const agentCard = generateAgentCard(
    config.agentCard,
    config.agents,
    `http://${host}:${config.port}`
  );
  
  // Override the capabilities in the generated agent card
  const updatedAgentCard = {
    ...agentCard,
    capabilities
  };

  // Create task provider if configured
  let taskProvider;
  if (config.taskProvider) {
    try {
      taskProvider = await createA2ATaskProvider(
        { 
          type: config.taskProvider.type,
          ...config.taskProvider.config
        },
        config.taskProvider.externalClients
      );
    } catch (error) {
      console.warn(`Failed to create A2A task provider: ${(error as Error).message}. Falling back to in-memory provider.`);
      taskProvider = await createSimpleA2ATaskProvider('memory');
    }
  } else {
    // Default to in-memory task provider
    taskProvider = await createSimpleA2ATaskProvider('memory');
  }
  
  return {
    ...config,
    host,
    capabilities,
    agentCard: updatedAgentCard,
    taskProvider,
    protocolHandler: createProtocolHandlerConfig(
      config.agents,
      null, // modelProvider will be injected
      null, // agentCard will be injected
      taskProvider
    )
  };
};

// Pure function to create A2A server instance
export const createA2AServer = async (config: A2AServerConfig) => {
  const serverConfig = await createA2AServerConfig(config);
  const app = createFastifyApp();
  
  return {
    app,
    config: serverConfig,
    start: () => startA2AServerInternal(app, serverConfig),
    stop: async () => {
      if (serverConfig.taskProvider) {
        await serverConfig.taskProvider.close();
      }
      return stopA2AServer(app);
    },
    addAgent: (name: string, agent: A2AAgent) => addAgentToServer(serverConfig, name, agent),
    removeAgent: (name: string) => removeAgentFromServer(serverConfig, name),
    getAgentCard: () => serverConfig.agentCard,
    handleRequest: (request: JSONRPCRequest) => handleA2ARequest(serverConfig, request)
  };
};

// Pure function to create Fastify app instance
const createFastifyApp = (): FastifyInstance => {
  // Use simple logging for tests, fancy logging for production
  const isTest = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
  
  return Fastify({
    logger: isTest ? false : {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname'
        }
      }
    },
    ajv: {
      customOptions: {
        removeAdditional: false,
        useDefaults: true,
        coerceTypes: true
      }
    }
  });
};

// Pure function to setup A2A routes
const setupA2ARoutes = (app: FastifyInstance, config: Awaited<ReturnType<typeof createA2AServerConfig>>) => {
  // Agent Card endpoint (A2A discovery)
  app.get('/.well-known/agent-card', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            protocolVersion: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            url: { type: 'string' },
            version: { type: 'string' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(config.agentCard);
  });

  // Main A2A JSON-RPC endpoint
  app.post('/a2a', {
    schema: {
      body: {
        type: 'object',
        properties: {
          jsonrpc: { type: 'string', const: '2.0' },
          id: { type: ['string', 'number'] },
          method: { type: 'string' },
          params: { type: 'object' }
        },
        required: ['jsonrpc', 'id', 'method']
      }
    }
  }, async (request: FastifyRequest<{ Body: JSONRPCRequest }>, reply: FastifyReply) => {
    try {
      const result = await handleA2ARequest(config, request.body);
      
      // Handle streaming responses
      if (isAsyncIterable(result)) {
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');
        
        for await (const chunk of result) {
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        reply.raw.end();
        return;
      }
      
      return reply.code(200).send(result);
    } catch (error) {
      const errorResponse: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: request.body.id || null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
          data: error instanceof Error ? { stack: error.stack } : undefined
        }
      };
      
      return reply.code(500).send(errorResponse);
    }
  });

  // Agent-specific endpoints
  config.agents.forEach((agent, agentName) => {
    // Agent-specific JSON-RPC endpoint
    app.post(`/a2a/agents/${agentName}`, {
      schema: {
        body: {
          type: 'object',
          properties: {
            jsonrpc: { type: 'string', const: '2.0' },
            id: { type: ['string', 'number'] },
            method: { type: 'string' },
            params: { type: 'object' }
          },
          required: ['jsonrpc', 'id', 'method']
        }
      }
    }, async (request: FastifyRequest<{ Body: JSONRPCRequest }>, reply: FastifyReply) => {
      try {
        const result = await handleA2ARequestForAgent(config, request.body, agentName);
        
        if (isAsyncIterable(result)) {
          reply.header('Content-Type', 'text/event-stream');
          reply.header('Cache-Control', 'no-cache');
          reply.header('Connection', 'keep-alive');
          
          for await (const chunk of result) {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          reply.raw.end();
          return;
        }
        
        return reply.code(200).send(result);
      } catch (error) {
        const errorResponse: JSONRPCResponse = {
          jsonrpc: '2.0',
          id: request.body.id || null,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Internal error'
          }
        };
        
        return reply.code(500).send(errorResponse);
      }
    });

    // Agent-specific card endpoint
    app.get(`/a2a/agents/${agentName}/card`, async (request: FastifyRequest, reply: FastifyReply) => {
      const agentCard = generateAgentCard(
        { 
          name: agent.name, 
          description: agent.description, 
          version: '1.0.0',
          provider: config.agentCard.provider || { organization: 'Unknown', url: '' }
        },
        new Map([[agentName, agent]]),
        `http://${config.host || 'localhost'}:${config.port}`
      );
      
      return reply.code(200).send(agentCard);
    });
  });

  // Health check for A2A
  app.get('/a2a/health', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      status: 'healthy',
      protocol: 'A2A',
      version: '0.3.0',
      agents: Array.from(config.agents.keys()),
      timestamp: new Date().toISOString()
    });
  });

  // A2A capabilities endpoint
  app.get('/a2a/capabilities', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      supportedMethods: [
        'message/send',
        'message/stream',
        'tasks/get',
        'tasks/cancel',
        'agent/getAuthenticatedExtendedCard'
      ],
      supportedTransports: ['JSONRPC'],
      capabilities: config.agentCard.capabilities,
      inputModes: config.agentCard.defaultInputModes,
      outputModes: config.agentCard.defaultOutputModes
    });
  });
};

// Pure function to setup middleware
const setupMiddleware = async (app: FastifyInstance) => {
  // CORS support
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
  });

  // Request logging
  app.addHook('preHandler', async (request, reply) => {
    if (request.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
      return reply.code(200).send();
    }
  });

  // A2A request validation
  app.addHook('preValidation', async (request, reply) => {
    if (request.url.startsWith('/a2a') && request.method === 'POST') {
      const contentType = request.headers['content-type'];
      if (!contentType?.includes('application/json')) {
        return reply.code(400).send({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Content-Type must be application/json for A2A requests'
          }
        });
      }
    }
  });
};

// Pure function to start A2A server (internal)
const startA2AServerInternal = async (
  app: FastifyInstance, 
  config: Awaited<ReturnType<typeof createA2AServerConfig>>
) => {
  try {
    await setupMiddleware(app);
    setupA2ARoutes(app, config);
    
    const host = config.host || 'localhost';
    const port = config.port;
    
    console.log(`🔧 Starting A2A-enabled FAF server on ${host}:${port}...`);
    await app.listen({ port, host });
    
    console.log(`🚀 A2A Server running on http://${host}:${port}`);
    console.log(`🤖 Available agents: ${Array.from(config.agents.keys()).join(', ')}`);
    console.log(`📋 Agent Card: http://${host}:${port}/.well-known/agent-card`);
    console.log(`🔗 A2A Endpoint: http://${host}:${port}/a2a`);
    console.log(`🏥 A2A Health: http://${host}:${port}/a2a/health`);
    console.log(`⚡ A2A Capabilities: http://${host}:${port}/a2a/capabilities`);
    
    config.agents.forEach((agent, name) => {
      console.log(`🎯 Agent ${name}: http://${host}:${port}/a2a/agents/${name}`);
    });
    
  } catch (error) {
    console.error('Failed to start A2A server:', error);
    process.exit(1);
  }
};

// Pure function to stop A2A server
const stopA2AServer = async (app: FastifyInstance) => {
  await app.close();
  console.log('🛑 A2A Server stopped');
};

// Pure function to handle A2A requests
const handleA2ARequest = async (
  config: Awaited<ReturnType<typeof createA2AServerConfig>>,
  request: JSONRPCRequest
): Promise<JSONRPCResponse | AsyncIterable<JSONRPCResponse>> => {
  // Use the first available agent by default
  const firstAgent = config.agents.values().next().value;
  if (!firstAgent) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32001,
        message: 'No agents available'
      }
    };
  }
  
  return config.protocolHandler.handleRequest(request);
};

// Pure function to handle agent-specific A2A requests
const handleA2ARequestForAgent = async (
  config: Awaited<ReturnType<typeof createA2AServerConfig>>,
  request: JSONRPCRequest,
  agentName: string
): Promise<JSONRPCResponse | AsyncIterable<JSONRPCResponse>> => {
  return config.protocolHandler.handleRequest(request, agentName);
};

// Pure helper function to check if value is async iterable
const isAsyncIterable = (value: any): value is AsyncIterable<any> => {
  return value != null && typeof value[Symbol.asyncIterator] === 'function';
};

// Pure function to add agent to server
const addAgentToServer = (
  config: Awaited<ReturnType<typeof createA2AServerConfig>>,
  name: string,
  agent: A2AAgent
): Awaited<ReturnType<typeof createA2AServerConfig>> => {
  const newAgents = new Map(config.agents);
  newAgents.set(name, agent);
  
  return {
    ...config,
    agents: newAgents,
    agentCard: generateAgentCard(
      {
        ...config.agentCard,
        provider: config.agentCard.provider || { organization: 'Unknown', url: '' }
      },
      newAgents,
      config.agentCard.url.replace('/a2a', '')
    )
  };
};

// Pure function to remove agent from server
const removeAgentFromServer = (
  config: Awaited<ReturnType<typeof createA2AServerConfig>>,
  name: string
): Awaited<ReturnType<typeof createA2AServerConfig>> => {
  const newAgents = new Map(config.agents);
  newAgents.delete(name);
  
  return {
    ...config,
    agents: newAgents,
    agentCard: generateAgentCard(
      {
        ...config.agentCard,
        provider: config.agentCard.provider || { organization: 'Unknown', url: '' }
      },
      newAgents,
      config.agentCard.url.replace('/a2a', '')
    )
  };
};

// Pure function for one-line server creation and startup
export const startA2AServer = async (config: A2AServerConfig) => {
  const server = await createA2AServer(config);
  await server.start();
  return server;
};