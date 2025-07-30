import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { 
  ServerConfig, 
  ChatRequest, 
  ChatResponse, 
  AgentListResponse,
  HealthResponse,
  HttpMessage,
  chatRequestSchema
} from './types';
import { run } from '../core/engine';
import { RunState, Message, createRunId, createTraceId } from '../core/types';
import { v4 as uuidv4 } from 'uuid';

export class FAFServer<Ctx> {
  private app: FastifyInstance;
  private config: ServerConfig<Ctx>;
  private startTime: number;

  constructor(config: ServerConfig<Ctx>) {
    this.config = config;
    this.startTime = Date.now();
    this.app = Fastify({ 
      logger: true,
      ajv: {
        customOptions: {
          removeAdditional: false,
          useDefaults: true,
          coerceTypes: true
        }
      }
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  private async setupMiddleware() {
    if (this.config.cors !== false) {
      await this.app.register(cors, {
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
      });
    }

    // Add request/response validation
    this.app.addHook('preHandler', async (request, reply) => {
      // Add CORS headers for preflight requests
      if (request.method === 'OPTIONS') {
        void reply.header('Access-Control-Allow-Origin', '*');
        void reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        void reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return reply.code(200).send();
      }
    });
  }

  private setupRoutes() {
    // Health check endpoint
    this.app.get('/health', async (request: FastifyRequest, reply: FastifyReply): Promise<HealthResponse> => {
      const response: HealthResponse = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        uptime: Date.now() - this.startTime
      };
      
      return reply.code(200).send(response);
    });

    // List available agents
    this.app.get('/agents', async (request: FastifyRequest, reply: FastifyReply): Promise<AgentListResponse> => {
      try {
        const agents = Array.from(this.config.agentRegistry.entries()).map(([name, agent]) => ({
          name,
          description: typeof agent.instructions === 'function' 
            ? 'Agent description' // Safe fallback since we don't have context
            : agent.instructions,
          tools: agent.tools?.map(tool => tool.schema.name) || []
        }));

        const response: AgentListResponse = {
          success: true,
          data: { agents }
        };

        return reply.code(200).send(response);
      } catch (error) {
        const response: AgentListResponse = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        
        return reply.code(500).send(response);
      }
    });

    // Chat completion endpoint
    this.app.post('/chat', {
      schema: {
        body: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant', 'system'] },
                  content: { type: 'string' }
                },
                required: ['role', 'content']
              }
            },
            agentName: { type: 'string' },
            context: {},
            maxTurns: { type: 'number' },
            stream: { type: 'boolean', default: false }
          },
          required: ['messages', 'agentName']
        }
      }
    }, async (request: FastifyRequest<{ Body: ChatRequest }>, reply: FastifyReply): Promise<ChatResponse> => {
      const startTime = Date.now();
      
      try {
        // Validate request body
        const validatedRequest = chatRequestSchema.parse(request.body);
        
        // Check if agent exists
        if (!this.config.agentRegistry.has(validatedRequest.agentName)) {
          const response: ChatResponse = {
            success: false,
            error: `Agent '${validatedRequest.agentName}' not found. Available agents: ${Array.from(this.config.agentRegistry.keys()).join(', ')}`
          };
          return reply.code(404).send(response);
        }

        // Convert HTTP messages to FAF messages
        const fafMessages: Message[] = validatedRequest.messages.map(msg => ({
          role: msg.role === 'system' ? 'user' : msg.role as 'user' | 'assistant',
          content: msg.content
        }));

        // Create initial state
        const runId = createRunId(uuidv4());
        const traceId = createTraceId(uuidv4());
        
        const initialState: RunState<Ctx> = {
          runId,
          traceId,
          messages: fafMessages,
          currentAgentName: validatedRequest.agentName,
          context: validatedRequest.context || {} as Ctx,
          turnCount: 0
        };

        // Create run config with optional overrides
        const runConfig = {
          ...this.config.runConfig,
          maxTurns: validatedRequest.maxTurns || this.config.runConfig.maxTurns || 10
        };

        // Handle streaming vs non-streaming
        if (validatedRequest.stream) {
          // For streaming, we'd need to implement Server-Sent Events
          // For now, return an error indicating streaming is not yet implemented
          const response: ChatResponse = {
            success: false,
            error: 'Streaming is not yet implemented. Set stream: false.'
          };
          return reply.code(501).send(response);
        }

        // Run the agent
        const result = await run(initialState, runConfig);
        const executionTime = Date.now() - startTime;

        // Convert FAF messages back to HTTP messages, including tool interactions
        const httpMessages: any[] = result.finalState.messages.map(msg => {
          if (msg.role === 'tool') {
            // Include tool messages with special formatting
            return {
              role: 'tool',
              content: msg.content,
              tool_call_id: msg.tool_call_id
            };
          } else if (msg.role === 'assistant' && msg.tool_calls) {
            // Include assistant messages with tool calls
            return {
              role: msg.role,
              content: msg.content || '',
              tool_calls: msg.tool_calls.map(tc => ({
                id: tc.id,
                type: tc.type,
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments
                }
              }))
            };
          } else {
            // Regular user/assistant messages
            return {
              role: msg.role as 'user' | 'assistant',
              content: msg.content
            };
          }
        });

        const response: ChatResponse = {
          success: true,
          data: {
            runId: result.finalState.runId,
            traceId: result.finalState.traceId,
            messages: httpMessages,
            outcome: {
              status: result.outcome.status,
              output: result.outcome.status === 'completed' ? String(result.outcome.output) : undefined,
              error: result.outcome.status === 'error' ? result.outcome.error : undefined
            },
            turnCount: result.finalState.turnCount,
            executionTimeMs: executionTime
          }
        };

        return reply.code(200).send(response);

      } catch (error) {
        const executionTime = Date.now() - startTime;
        
        const response: ChatResponse = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        };

        request.log.error({
          error: error,
          executionTimeMs: executionTime,
          requestBody: request.body
        }, 'Chat endpoint error');

        return reply.code(500).send(response);
      }
    });

    // Agent-specific chat endpoint (convenience)
    this.app.post('/agents/:agentName/chat', {
      schema: {
        params: {
          type: 'object',
          properties: {
            agentName: { type: 'string' }
          },
          required: ['agentName']
        },
        body: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant', 'system'] },
                  content: { type: 'string' }
                },
                required: ['role', 'content']
              }
            },
            context: {},
            maxTurns: { type: 'number' },
            stream: { type: 'boolean', default: false }
          },
          required: ['messages']
        }
      }
    }, async (
      request: FastifyRequest<{ 
        Params: { agentName: string }, 
        Body: Omit<ChatRequest, 'agentName'> 
      }>, 
      reply: FastifyReply
    ): Promise<ChatResponse> => {
      // Delegate to main chat endpoint
      const chatRequest: ChatRequest = {
        ...request.body,
        agentName: request.params.agentName
      };

      // Create a new request object for the main handler
      const newRequest = {
        ...request,
        body: chatRequest
      } as FastifyRequest<{ Body: ChatRequest }>;

      // Call the main chat handler
      return this.app.inject({
        method: 'POST',
        url: '/chat',
        payload: chatRequest
      }).then((response: any) => JSON.parse(response.body));
    });
  }

  async start(): Promise<void> {
    try {
      const host = this.config.host || 'localhost';
      const port = this.config.port || 3000;
      
      console.log(`🔧 Starting Fastify server on ${host}:${port}...`);
      await this.app.listen({ 
        port, 
        host 
      });
      console.log(`🔧 Fastify server started successfully`);
      
      console.log(`🚀 FAF Server running on http://${host}:${port}`);
      console.log(`📋 Available agents: ${Array.from(this.config.agentRegistry.keys()).join(', ')}`);
      console.log(`🏥 Health check: http://${host}:${port}/health`);
      console.log(`🤖 Agents list: http://${host}:${port}/agents`);
      console.log(`💬 Chat endpoint: http://${host}:${port}/chat`);
    } catch (error) {
      this.app.log.error(error);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    await this.app.close();
  }

  get server(): FastifyInstance {
    return this.app;
  }
}