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
import { run, runStream } from '../core/engine';
import { RunState, Message, createRunId, createTraceId, getTextContent } from '../core/types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Create and configure a JAF server instance
 * Functional implementation following JAF principles
 */
export function createJAFServer<Ctx>(config: ServerConfig<Ctx>): {
  app: FastifyInstance;
  start: () => Promise<void>;
  stop: () => Promise<void>;
} {
  const startTime = Date.now();
  
  const app = Fastify({ 
    logger: true,
    bodyLimit: 50 * 1024 * 1024, // 50MB limit for base64 images
    ajv: {
      customOptions: {
        removeAdditional: false,
        useDefaults: true,
        coerceTypes: true
      }
    }
  });

  const setupMiddleware = async (): Promise<void> => {
    if (config.cors !== false) {
      await app.register(cors, {
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
      });
    }

    // Add request/response validation
    app.addHook('preHandler', async (request, reply) => {
      // Add CORS headers for preflight requests
      if (request.method === 'OPTIONS') {
        void reply.header('Access-Control-Allow-Origin', '*');
        void reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        void reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return reply.code(200).send();
      }
    });
  };

  const setupRoutes = (): void => {
    // Health check endpoint
    app.get('/health', async (request: FastifyRequest, reply: FastifyReply): Promise<HealthResponse> => {
      const response: HealthResponse = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        uptime: Date.now() - startTime
      };
      
      return reply.code(200).send(response);
    });

    // List available agents
    app.get('/agents', async (request: FastifyRequest, reply: FastifyReply): Promise<AgentListResponse> => {
      try {
        const agents = Array.from(config.agentRegistry.entries()).map(([name, agent]) => ({
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
    app.post('/chat', {
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
                  content: {
                    oneOf: [
                      { type: 'string' },
                      {
                        type: 'array',
                        items: {
                          oneOf: [
                            {
                              type: 'object',
                              properties: {
                                type: { type: 'string', enum: ['text'] },
                                text: { type: 'string' }
                              },
                              required: ['type', 'text']
                            },
                            {
                              type: 'object',
                              properties: {
                                type: { type: 'string', enum: ['image_url'] },
                                image_url: {
                                  type: 'object',
                                  properties: {
                                    url: { type: 'string' },
                                    detail: { type: 'string', enum: ['low', 'high', 'auto'] }
                                  },
                                  required: ['url']
                                }
                              },
                              required: ['type', 'image_url']
                            }
                          ]
                        }
                      }
                    ]
                  }
                },
                required: ['role', 'content']
              }
            },
            agentName: { type: 'string' },
            context: {},
            maxTurns: { type: 'number' },
            stream: { type: 'boolean', default: false },
            conversationId: { type: 'string' },
            memory: {
              type: 'object',
              properties: {
                autoStore: { type: 'boolean', default: true },
                maxMessages: { type: 'number' },
                compressionThreshold: { type: 'number' }
              }
            }
          },
          required: ['messages', 'agentName']
        }
      }
    }, async (request: FastifyRequest<{ Body: ChatRequest }>, reply: FastifyReply): Promise<ChatResponse> => {
      const requestStartTime = Date.now();
      
      try {
        // Validate request body
        const validatedRequest = chatRequestSchema.parse(request.body);
        
        // Check if agent exists
        if (!config.agentRegistry.has(validatedRequest.agentName)) {
          const response: ChatResponse = {
            success: false,
            error: `Agent '${validatedRequest.agentName}' not found. Available agents: ${Array.from(config.agentRegistry.keys()).join(', ')}`
          };
          return reply.code(404).send(response);
        }

        // Convert HTTP messages to JAF messages
        const jafMessages: Message[] = validatedRequest.messages.map(msg => ({
          role: msg.role === 'system' ? 'user' : msg.role as 'user' | 'assistant',
          content: msg.content
        }));

        // Create initial state
        const runId = createRunId(uuidv4());
        const traceId = createTraceId(uuidv4());
        
        // Generate conversationId if not provided
        const conversationId = validatedRequest.conversationId || `conv-${uuidv4()}`;
        
        const initialState: RunState<Ctx> = {
          runId,
          traceId,
          messages: jafMessages,
          currentAgentName: validatedRequest.agentName,
          context: validatedRequest.context || {} as Ctx,
          turnCount: 0
        };

        // Create run config with memory configuration
        const runConfig = {
          ...config.runConfig,
          maxTurns: validatedRequest.maxTurns || config.runConfig.maxTurns || 10,
          conversationId,
          memory: config.defaultMemoryProvider ? {
            provider: config.defaultMemoryProvider,
            autoStore: validatedRequest.memory?.autoStore ?? true,
            maxMessages: validatedRequest.memory?.maxMessages,
            compressionThreshold: validatedRequest.memory?.compressionThreshold
          } : undefined
        };

        // Handle streaming vs non-streaming
        if (validatedRequest.stream) {
          // SSE headers
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no'
          });

          const send = (event: string, data: any) => {
            try {
              reply.raw.write(`event: ${event}\n`);
              reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
            } catch (e) {
              app.log.warn({ err: e }, 'SSE write failed');
            }
          };

          // Send initial metadata event
          send('stream_start', {
            runId,
            traceId,
            conversationId,
            agent: validatedRequest.agentName
          });

          let clientClosed = false;
          request.raw.on('close', () => {
            clientClosed = true;
            try { reply.raw.end(); } catch { /* ignore */ }
          });

          // Use the core streaming generator to forward events
          try {
            for await (const event of runStream<Ctx, unknown>(initialState, runConfig)) {
              if (clientClosed) break;
              send(event.type, event);

              // If run ends, we close the stream
              if (event.type === 'run_end') {
                break;
              }
            }
          } catch (streamErr) {
            send('error', { message: streamErr instanceof Error ? streamErr.message : String(streamErr) });
          } finally {
            if (!clientClosed) {
              send('stream_end', { ended: true });
              try { reply.raw.end(); } catch { /* ignore */ }
            }
          }

          // Fastify requires a return, but we've handled the response
          // Returning undefined indicates the response has been sent
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return undefined as any;
        }

        // Run the agent
        const result = await run(initialState, runConfig);
        const executionTime = Date.now() - requestStartTime;

        // Convert JAF messages back to HTTP messages, including tool interactions
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
            conversationId: conversationId,
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
        const executionTime = Date.now() - requestStartTime;
        
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
    app.post('/agents/:agentName/chat', {
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
                  content: {
                    oneOf: [
                      { type: 'string' },
                      {
                        type: 'array',
                        items: {
                          oneOf: [
                            {
                              type: 'object',
                              properties: {
                                type: { type: 'string', enum: ['text'] },
                                text: { type: 'string' }
                              },
                              required: ['type', 'text']
                            },
                            {
                              type: 'object',
                              properties: {
                                type: { type: 'string', enum: ['image_url'] },
                                image_url: {
                                  type: 'object',
                                  properties: {
                                    url: { type: 'string' },
                                    detail: { type: 'string', enum: ['low', 'high', 'auto'] }
                                  },
                                  required: ['url']
                                }
                              },
                              required: ['type', 'image_url']
                            }
                          ]
                        }
                      }
                    ]
                  }
                },
                required: ['role', 'content']
              }
            },
            context: {},
            maxTurns: { type: 'number' },
            stream: { type: 'boolean', default: false },
            conversationId: { type: 'string' },
            memory: {
              type: 'object',
              properties: {
                autoStore: { type: 'boolean', default: true },
                maxMessages: { type: 'number' },
                compressionThreshold: { type: 'number' }
              }
            }
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
      return app.inject({
        method: 'POST',
        url: '/chat',
        payload: chatRequest
      }).then((response: any) => JSON.parse(response.body));
    });

    // Memory management endpoints
    app.get('/conversations/:conversationId', async (
      request: FastifyRequest<{ Params: { conversationId: string } }>, 
      reply: FastifyReply
    ) => {
      if (!config.defaultMemoryProvider) {
        return reply.code(503).send({
          success: false,
          error: 'Memory provider not configured'
        });
      }

      const result = await config.defaultMemoryProvider.getConversation(request.params.conversationId);
      if (!result.success) {
        return reply.code(500).send({
          success: false,
          error: result.error.message
        });
      }

      return reply.code(200).send({
        success: true,
        data: result.data
      });
    });

    app.delete('/conversations/:conversationId', async (
      request: FastifyRequest<{ Params: { conversationId: string } }>, 
      reply: FastifyReply
    ) => {
      if (!config.defaultMemoryProvider) {
        return reply.code(503).send({
          success: false,
          error: 'Memory provider not configured'
        });
      }

      const result = await config.defaultMemoryProvider.deleteConversation(request.params.conversationId);
      if (!result.success) {
        return reply.code(500).send({
          success: false,
          error: result.error.message
        });
      }

      return reply.code(200).send({
        success: true,
        data: { deleted: result.data }
      });
    });

    app.get('/memory/health', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!config.defaultMemoryProvider) {
        return reply.code(503).send({
          success: false,
          error: 'Memory provider not configured'
        });
      }

      const result = await config.defaultMemoryProvider.healthCheck();
      if (!result.success) {
        return reply.code(500).send({
          success: false,
          error: 'Health check failed',
          details: result.error
        });
      }

      return reply.code(200).send({
        success: true,
        data: result.data
      });
    });
  };

  const start = async (): Promise<void> => {
    try {
      await setupMiddleware();
      setupRoutes();
      
      const host = config.host || 'localhost';
      const port = config.port || 3000;
      
      console.log(`🔧 Starting Fastify server on ${host}:${port}...`);
      await app.listen({ 
        port, 
        host 
      });
      console.log(`🔧 Fastify server started successfully`);
      
      console.log(`🚀 JAF Server running on http://${host}:${port}`);
      console.log(`📋 Available agents: ${Array.from(config.agentRegistry.keys()).join(', ')}`);
      console.log(`🏥 Health check: http://${host}:${port}/health`);
      console.log(`🤖 Agents list: http://${host}:${port}/agents`);
      console.log(`💬 Chat endpoint: http://${host}:${port}/chat`);
      
      if (config.defaultMemoryProvider) {
        console.log(`🧠 Memory provider: Configured`);
        console.log(`📊 Memory health: http://${host}:${port}/memory/health`);
        console.log(`💾 Conversation management: http://${host}:${port}/conversations/:id`);
      } else {
        console.log(`🧠 Memory provider: Not configured (conversations will not persist)`);
      }
    } catch (error) {
      app.log.error(error);
      process.exit(1);
    }
  };

  const stop = async (): Promise<void> => {
    await app.close();
    
    // Close memory provider if configured
    if (config.defaultMemoryProvider) {
      await config.defaultMemoryProvider.close();
    }
  };

  return {
    app,
    start,
    stop
  };
}
