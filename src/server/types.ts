import { z } from 'zod';
import { Agent, RunConfig } from '../core/types';
import { MemoryProvider } from '../memory/types';

export interface ServerConfig<Ctx> {
  port?: number;
  host?: string;
  cors?: boolean;
  runConfig: RunConfig<Ctx>;
  agentRegistry: Map<string, Agent<Ctx, any>>;
  defaultMemoryProvider?: MemoryProvider;
}

// Request/Response schemas
export const httpMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string()
});

// Approval message schema for HITL
export const approvalMessageSchema = z.object({
  type: z.literal('approval'),
  sessionId: z.string(),
  toolCallId: z.string(),
  approved: z.boolean(),
  additionalContext: z.record(z.any()).optional()
});

export const chatRequestSchema = z.object({
  messages: z.array(httpMessageSchema),
  agentName: z.string(),
  context: z.any().optional(),
  maxTurns: z.number().optional(),
  stream: z.boolean().default(false),
  conversationId: z.string().optional(),
  memory: z.object({
    autoStore: z.boolean().default(true),
    maxMessages: z.number().optional(),
    compressionThreshold: z.number().optional()
  }).optional(),
  approvals: z.array(approvalMessageSchema).optional()
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type HttpMessage = z.infer<typeof httpMessageSchema>;
export type ApprovalMessage = z.infer<typeof approvalMessageSchema>;

// Extended message schema that includes tool calls and responses
export const fullMessageSchema = z.union([
  httpMessageSchema,
  z.object({
    role: z.literal('assistant'),
    content: z.string(),
    tool_calls: z.array(z.object({
      id: z.string(),
      type: z.literal('function'),
      function: z.object({
        name: z.string(),
        arguments: z.string()
      })
    })).optional()
  }),
  z.object({
    role: z.literal('tool'),
    content: z.string(),
    tool_call_id: z.string().optional()
  })
]);

export const chatResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
      runId: z.string(),
      traceId: z.string(),
    conversationId: z.string().optional(),
    messages: z.array(fullMessageSchema),
      outcome: z.object({
        status: z.enum(['completed', 'error', 'max_turns', 'interrupted']),
        output: z.string().optional(),
      error: z.any().optional(),
        interruptions: z.array(z.object({
          type: z.literal('tool_approval'),
          toolCall: z.object({
            id: z.string(),
            type: z.literal('function'),
            function: z.object({
              name: z.string(),
              arguments: z.string()
            })
          }),
          sessionId: z.string()
        })).optional()
      }),
      turnCount: z.number(),
    executionTimeMs: z.number()
  }).optional(),
  error: z.string().optional()
});

export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const agentListResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    agents: z.array(z.object({
      name: z.string(),
      description: z.string(),
      tools: z.array(z.string())
    }))
  }).optional(),
  error: z.string().optional()
});

export type AgentListResponse = z.infer<typeof agentListResponseSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('healthy'),
  timestamp: z.string(),
  version: z.string(),
  uptime: z.number()
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
