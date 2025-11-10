import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import {
  ServerConfig,
  ChatRequest,
  ChatResponse,
  AgentListResponse,
  HealthResponse,
  HttpMessage,
  chatRequestSchema,
  ApprovalMessage
} from './types.js';
import { run, runStream } from '../core/engine.js';
import { RunState, Message, createRunId, createTraceId } from '../core/types.js';
import { v4 as uuidv4 } from 'uuid';
import { safeConsole } from '../utils/logger.js';

// Helper: stable stringify to create deterministic signatures
function stableStringify(value: any): string {
  const seen = new WeakSet();
  const helper = (v: any): any => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(helper);
    const keys = Object.keys(v).sort();
    const obj: any = {};
    for (const k of keys) obj[k] = helper(v[k]);
    return obj;
  };
  try {
    return JSON.stringify(helper(value));
  } catch {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
}

function tryParseJSON(str: string): any {
  try { return JSON.parse(str); } catch { return str; }
}

function computeToolCallSignature(tc: { function: { name: string; arguments: string } }): string {
  return `${tc.function.name}:${stableStringify(tryParseJSON(tc.function.arguments))}`;
}

// Shared JSON Schema definitions to avoid duplication
const messageContentPartSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['text', 'image_url'] },
    text: { type: 'string' },
    image_url: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        detail: { type: 'string', enum: ['low', 'high', 'auto'] }
      },
      required: ['url']
    }
  },
  required: ['type']
};

const attachmentSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['image', 'audio', 'video', 'document', 'file'] },
    mimeType: { type: 'string' },
    name: { type: 'string' },
    url: { type: 'string' },
    data: { type: 'string' },
    format: { type: 'string' }
  }
};

const httpMessageSchema = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: ['user', 'assistant', 'system'] },
    content: { 
      oneOf: [
        { type: 'string' },
        {
          type: 'array',
          items: messageContentPartSchema
        }
      ]
    },
    attachments: {
      type: 'array',
      items: attachmentSchema
    }
  },
  required: ['role', 'content']
};

const chatRequestBodySchema = {
  type: 'object',
  properties: {
    messages: {
      type: 'array',
      items: httpMessageSchema
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
        compressionThreshold: { type: 'number' },
        storeOnCompletion: { type: 'boolean' }
      }
    }
  },
  required: ['messages', 'agentName']
};

/**
 * Create and configure a JAF server instance
 * Functional implementation following JAF principles
 */
export function createJAFServer<Ctx>(config: ServerConfig<Ctx>): {
  app: FastifyInstance;
  start: () => Promise<void>;
  stop: () => Promise<void>;
} {
  // BACKWARDS COMPATIBILITY: Handle legacy agentRegistry at top level
  if (config.agentRegistry && !config.runConfig.agentRegistry) {
    safeConsole.warn('[JAF:SERVER] DEPRECATED: agentRegistry should be provided in runConfig.agentRegistry. Using legacy configuration for backwards compatibility.');
    (config.runConfig as any).agentRegistry = config.agentRegistry;
  }
  
  // Ensure agentRegistry exists
  if (!config.runConfig.agentRegistry) {
    throw new Error('agentRegistry must be provided either in config.agentRegistry (deprecated) or config.runConfig.agentRegistry');
  }

  const startTime = Date.now();
  // SSE subscribers for approval-related events
  const approvalSubscribers = new Set<{ res: any; filterConversationId?: string }>();

  const sseSend = (res: any, event: string, data: any) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { /* ignore */ }
  };

  const broadcastApprovalRequired = (payload: {
    conversationId: string;
    sessionId: string;
    toolCallId: string;
    toolName: string;
    args: any;
    signature?: string;
    timestamp?: string;
  }) => {
    for (const client of approvalSubscribers) {
      if (client.filterConversationId && client.filterConversationId !== payload.conversationId) continue;
      sseSend(client.res, 'approval_required', { ...payload, timestamp: payload.timestamp || new Date().toISOString() });
    }
  };

  const broadcastApprovalDecision = (payload: {
    conversationId: string;
    sessionId: string;
    toolCallId: string;
    status: 'approved' | 'rejected';
    additionalContext?: any;
    timestamp?: string;
  }) => {
    for (const client of approvalSubscribers) {
      if (client.filterConversationId && client.filterConversationId !== payload.conversationId) continue;
      sseSend(client.res, 'approval_decision', { ...payload, timestamp: payload.timestamp || new Date().toISOString() });
    }
  };
  
  const app = Fastify({ 
    logger: true,
    bodyLimit: config.maxBodySize ?? 50 * 1024 * 1024, // Configurable body size limit
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
        const agents = Array.from(config.runConfig.agentRegistry.entries()).map(([name, agent]) => ({
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
        body: chatRequestBodySchema
      }
    }, async (request: FastifyRequest<{ Body: ChatRequest }>, reply: FastifyReply): Promise<ChatResponse> => {
      const requestStartTime = Date.now();
      
      try {
        // Validate request body
        const validatedRequest = chatRequestSchema.parse(request.body);
        
        // Check if agent exists
        if (!config.runConfig.agentRegistry.has(validatedRequest.agentName)) {
          const response: ChatResponse = {
            success: false,
            error: `Agent '${validatedRequest.agentName}' not found. Available agents: ${Array.from(config.runConfig.agentRegistry.keys()).join(', ')}`
          };
          return reply.code(404).send(response);
        }
        
        // Convert HTTP messages to JAF messages
        const jafMessages: Message[] = validatedRequest.messages.map(msg => ({
          role: msg.role === 'system' ? 'user' : msg.role as 'user' | 'assistant',
          content: msg.content,
          attachments: (msg as any).attachments
        }));

        // Create initial state
        const runId = createRunId(uuidv4());
        const traceId = createTraceId(uuidv4());
        
        // Generate conversationId if not provided
        const conversationId = validatedRequest.conversationId || `conv-${uuidv4()}`;
        
        // Handle approval message(s) if present
        const initialApprovals = new Map();
        const initialStateMessages = jafMessages;

        const approvalsList: ApprovalMessage[] = validatedRequest.approvals ?? [];

        const persistApproval = async (convId: string, appr: ApprovalMessage): Promise<void> => {
          if (!config.defaultMemoryProvider) return;
          const provider = config.defaultMemoryProvider;
          // Keyed by previous run/session id + toolCallId for uniqueness
          const approvalKey = `${appr.sessionId}:${appr.toolCallId}`;
          const baseEntry: any = {
            approved: appr.approved,
            status: appr.approved ? 'approved' : 'rejected',
            additionalContext: appr.additionalContext,
            sessionId: appr.sessionId,
            toolCallId: appr.toolCallId,
          };

          try {
            const existing = await provider.getConversation(convId);
            if (existing.success && existing.data) {
              // Try to enrich entry with tool name and signature for robust matching
              try {
                const msgs = existing.data.messages as Message[];
                for (let i = msgs.length - 1; i >= 0; i--) {
                  const m = msgs[i];
                  if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
                    const match = m.tool_calls.find(tc => tc.id === appr.toolCallId);
                    if (match) {
                      baseEntry.toolName = match.function.name;
                      baseEntry.signature = computeToolCallSignature(match as any);
                      break;
                    }
                  }
                }
              } catch { /* best-effort */ }

              const existingApprovals = (existing.data.metadata?.toolApprovals ?? {}) as Record<string, any>;
              const prev = existingApprovals[approvalKey];

              // Merge additionalContext shallowly and avoid regressions
              const mergedAdditional = {
                ...(prev?.additionalContext || {}),
                ...(baseEntry.additionalContext || {}),
              };

              const nextEntry = {
                ...prev,
                ...baseEntry,
                additionalContext: mergedAdditional,
                // Preserve earliest timestamp if no effective change; else update
                timestamp: prev && (
                  prev.status === baseEntry.status &&
                  stableStringify(prev.additionalContext) === stableStringify(mergedAdditional)
                ) ? prev.timestamp : new Date().toISOString(),
              };

              const noChange = prev &&
                prev.status === nextEntry.status &&
                stableStringify(prev.additionalContext) === stableStringify(nextEntry.additionalContext) &&
                (prev.toolName ?? null) === (nextEntry.toolName ?? null) &&
                (prev.signature ?? null) === (nextEntry.signature ?? null);

              if (!noChange) {
                const mergedApprovals = { ...existingApprovals, [approvalKey]: nextEntry };
                await provider.appendMessages(convId, [], { toolApprovals: mergedApprovals, traceId });
              }
            } else if (existing.success && !existing.data) {
              // Create conversation shell with just metadata if not present
              const entry = { ...baseEntry, timestamp: new Date().toISOString() };
              await provider.storeMessages(convId, [], { toolApprovals: { [approvalKey]: entry }, traceId });
            }
            // If provider call failed, we intentionally do not throw; run will proceed
          } catch {
            // Ignore persistence errors here to avoid breaking the request path
          }
          // Broadcast decision to approvals SSE
          try {
            broadcastApprovalDecision({
              conversationId: convId,
              sessionId: appr.sessionId,
              toolCallId: appr.toolCallId,
              status: appr.approved ? 'approved' : 'rejected',
              additionalContext: appr.additionalContext
            });
          } catch { /* ignore */ }
        };

        if (approvalsList.length > 0) {
          for (const approval of approvalsList) {
            if (approval.sessionId) {
              initialApprovals.set(approval.toolCallId, {
                status: approval.approved ? 'approved' : 'rejected',
                approved: approval.approved,
                additionalContext: approval.additionalContext
              });
            }
            await persistApproval(conversationId, approval);
          }
        }

        // Seed approvals from persisted conversation metadata (toolApprovals)
        // This allows previously stored decisions to be applied even if the client
        // does not resend them in the current request.
        if (config.defaultMemoryProvider) {
          try {
            const conv = await config.defaultMemoryProvider.getConversation(conversationId);
            if (conv.success && conv.data) {
              const toolApprovals = (conv.data.metadata?.toolApprovals ?? null) as null | Record<string, any>;
              if (toolApprovals) {
                // Collect candidate tool_call ids and signatures from latest assistant message with tool_calls
                const allMessages = conv.data.messages as Message[];
                const assistantWithTools = [...allMessages].reverse().find(m => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
                const candidateIds = new Set<string>(assistantWithTools?.tool_calls?.map(tc => tc.id) ?? []);
                const candidateSignatures = new Map<string, string>();
                if (assistantWithTools?.tool_calls) {
                  for (const tc of assistantWithTools.tool_calls) {
                    try {
                      candidateSignatures.set(tc.id, computeToolCallSignature(tc as any));
                    } catch { /* ignore */ }
                  }
                }

                // Prefer explicit approval from request; otherwise seed from persisted entries
                const existingKeys = new Set<string>(Array.from(initialApprovals.keys()));

                for (const [, entry] of Object.entries(toolApprovals)) {
                  const persistedToolCallId = (entry && (entry as any).toolCallId) as string | undefined;
                  const persistedSignature = (entry && (entry as any).signature) as string | undefined;

                  // Try direct id match first
                  let targetId: string | undefined = undefined;
                  if (persistedToolCallId && candidateIds.has(persistedToolCallId)) {
                    targetId = persistedToolCallId;
                  } else if (persistedSignature) {
                    // Signature match fallback
                    for (const [cid, sig] of candidateSignatures.entries()) {
                      if (sig === persistedSignature) { targetId = cid; break; }
                    }
                  }
                  if (!targetId) continue;
                  if (existingKeys.has(targetId)) continue;

                  const status = (entry as any).status ?? ((entry as any).approved === true ? 'approved' : ((entry as any).additionalContext?.status === 'pending' ? 'pending' : 'rejected'));
                  initialApprovals.set(targetId, {
                    status,
                    approved: !!(entry as any).approved,
                    additionalContext: (entry as any).additionalContext
                  });
                }
              }
            }
          } catch (e) {
            app.log.warn({ err: e }, 'Failed to seed approvals from metadata');
          }
        }
        
        const initialState: RunState<Ctx> = {
          runId,
          traceId,
          messages: initialStateMessages,
          currentAgentName: validatedRequest.agentName,
          context: validatedRequest.context || ({} as Ctx),
          turnCount: 0,
          approvals: initialApprovals,
        };

        // Create run config with memory configuration
        const runConfig = {
          ...config.runConfig,
          maxTurns: validatedRequest.maxTurns || config.runConfig.maxTurns || 10,
          conversationId,
          memory: config.defaultMemoryProvider ? {
            provider: config.defaultMemoryProvider,
            autoStore: validatedRequest.memory?.autoStore ?? config.runConfig.memory?.autoStore ?? true,
            maxMessages: validatedRequest.memory?.maxMessages ?? config.runConfig.memory?.maxMessages,
            compressionThreshold: validatedRequest.memory?.compressionThreshold ?? config.runConfig.memory?.compressionThreshold,
            storeOnCompletion: validatedRequest.memory?.storeOnCompletion ?? config.runConfig.memory?.storeOnCompletion
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
                // Broadcast approval_required to approvals SSE if interrupted
                try {
                  const outcome = (event as any).data?.outcome;
                  if (outcome && outcome.status === 'interrupted') {
                    const interruptions = outcome.interruptions as Array<{ type: string; toolCall: any; sessionId?: string }>;
                    for (const intr of interruptions) {
                      if (intr.type === 'tool_approval') {
                        const toolCall = intr.toolCall;
                        const args = tryParseJSON(toolCall.function.arguments);
                        broadcastApprovalRequired({
                          conversationId,
                          sessionId: intr.sessionId || runId,
                          toolCallId: toolCall.id,
                          toolName: toolCall.function.name,
                          args,
                          signature: computeToolCallSignature(toolCall)
                        });
                      }
                    }
                  }
                } catch { /* ignore */ }
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
              content: msg.content,
              ...(msg.attachments ? { attachments: msg.attachments } : {})
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
              error: result.outcome.status === 'error' ? result.outcome.error : undefined,
              interruptions: result.outcome.status === 'interrupted'
                ? result.outcome.interruptions.map(interruption => {
                    if (interruption.type === 'tool_approval') {
                      return {
                        type: interruption.type,
                        toolCall: interruption.toolCall,
                        sessionId: interruption.sessionId || result.finalState.runId
                      };
                    } else {
                      // clarification_required
                      return {
                        type: interruption.type,
                        clarificationId: interruption.clarificationId,
                        question: interruption.question,
                        options: [...interruption.options],
                        context: interruption.context
                      };
                    }
                  })
                : undefined
            },
            turnCount: result.finalState.turnCount,
            executionTimeMs: executionTime
          }
        };

        // Broadcast approval_required to approvals SSE if interrupted (non-streaming)
        if (result.outcome.status === 'interrupted') {
          try {
            for (const intr of result.outcome.interruptions) {
              if (intr.type === 'tool_approval') {
                const toolCall = intr.toolCall;
                const args = tryParseJSON(toolCall.function.arguments);
                broadcastApprovalRequired({
                  conversationId,
                  sessionId: intr.sessionId || runId,
                  toolCallId: toolCall.id,
                  toolName: toolCall.function.name,
                  args,
                  signature: computeToolCallSignature(toolCall)
                });
              }
            }
          } catch { /* ignore */ }
        }

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
        body: chatRequestBodySchema
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

    // List pending approvals for a conversation (best-effort from stored history)
    app.get('/approvals/pending', async (
      request: FastifyRequest<{ Querystring: { conversationId?: string } }>,
      reply: FastifyReply
    ) => {
      if (!config.defaultMemoryProvider) {
        return reply.code(503).send({ success: false, error: 'Memory provider not configured' });
      }

      const conversationId = request.query.conversationId;
      if (!conversationId) {
        return reply.code(400).send({ success: false, error: 'conversationId is required' });
      }

      const conv = await config.defaultMemoryProvider.getConversation(conversationId);
      if (!conv.success) {
        return reply.code(500).send({ success: false, error: conv.error.message });
      }
      if (!conv.data) {
        return reply.code(200).send({ success: true, data: { pending: [] } });
      }

      const messages = conv.data.messages as Message[];
      const approvalsMeta = (conv.data.metadata?.toolApprovals ?? {}) as Record<string, any>;

      // Find most recent assistant message with tool calls
      const assistantIndex = [...messages].reverse().findIndex(m => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
      if (assistantIndex === -1) {
        return reply.code(200).send({ success: true, data: { pending: [] } });
      }
      const realIndex = messages.length - 1 - assistantIndex;
      const assistantMsg = messages[realIndex];

      // Which tool_calls have already produced results?
      const toolIds = new Set((assistantMsg.tool_calls ?? []).map(tc => tc.id));
      const executed = new Set<string>();
      for (let j = realIndex + 1; j < messages.length; j++) {
        const m = messages[j];
        if (m.role === 'tool' && m.tool_call_id && toolIds.has(m.tool_call_id)) {
          executed.add(m.tool_call_id);
        }
      }

      const pending: Array<{
        conversationId: string;
        toolCallId: string;
        toolName: string;
        args: any;
        signature?: string;
        status: 'pending';
        sessionId?: string;
      }> = [];

      const entries = Object.values(approvalsMeta) as any[];
      for (const tc of assistantMsg.tool_calls ?? []) {
        if (executed.has(tc.id)) continue; // already resolved

        const match = entries.find(e => e && e.toolCallId === tc.id);
        const status = (match?.status as any) ?? (match?.approved === true ? 'approved' : (match?.additionalContext?.status === 'pending' ? 'pending' : undefined));
        const decisionPending = !match || status === 'pending';
        if (!decisionPending) continue;

        pending.push({
          conversationId,
          toolCallId: tc.id,
          toolName: tc.function.name,
          args: tryParseJSON(tc.function.arguments),
          signature: computeToolCallSignature(tc as any),
          status: 'pending',
          sessionId: (conv.data.metadata as any)?.runId,
        });
      }

      return reply.code(200).send({ success: true, data: { pending } });
    });
  };

  const start = async (): Promise<void> => {
    try {
      await setupMiddleware();
      setupRoutes();
      
      const host = config.host || 'localhost';
      const port = config.port || 3000;

    // Approvals SSE stream
    app.get('/approvals/stream', async (
      request: FastifyRequest<{ Querystring: { conversationId?: string } }>,
      reply: FastifyReply
    ) => {
      // SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      const filterConversationId = (request.query && (request.query as any).conversationId) || undefined;
      const client = { res: reply.raw, filterConversationId };
      approvalSubscribers.add(client);

      // Initial greeting
      sseSend(reply.raw, 'stream_start', { conversationId: filterConversationId || null });

      // Heartbeat
      const interval = setInterval(() => {
        try { sseSend(reply.raw, 'ping', { ts: Date.now() }); } catch { /* ignore */ }
      }, 15000);

      // Cleanup on close
      request.raw.on('close', () => {
        clearInterval(interval);
        approvalSubscribers.delete(client);
        try { reply.raw.end(); } catch { /* ignore */ }
      });

      // Fastify route handled via raw stream
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return undefined as any;
    });
      safeConsole.log(`🔧 Starting Fastify server on ${host}:${port}...`);
      await app.listen({
        port,
        host
      });
      safeConsole.log(`🔧 Fastify server started successfully`);

      safeConsole.log(`🚀 JAF Server running on http://${host}:${port}`);
      safeConsole.log(`📋 Available agents: ${Array.from(config.runConfig.agentRegistry.keys()).join(', ')}`);
      safeConsole.log(`🏥 Health check: http://${host}:${port}/health`);
      safeConsole.log(`🤖 Agents list: http://${host}:${port}/agents`);
      safeConsole.log(`💬 Chat endpoint: http://${host}:${port}/chat`);

      if (config.defaultMemoryProvider) {
        safeConsole.log(`🧠 Memory provider: Configured`);
        safeConsole.log(`📊 Memory health: http://${host}:${port}/memory/health`);
        safeConsole.log(`💾 Conversation management: http://${host}:${port}/conversations/:id`);
      } else {
        safeConsole.log(`🧠 Memory provider: Not configured (conversations will not persist)`);
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
