/**
 * Pure functional A2A types for JAF
 * Maintains immutability and type safety
 */

import { z } from 'zod';

// Core A2A Protocol Types
export type A2AMessage = {
  readonly role: 'user' | 'agent';
  readonly parts: readonly A2APart[];
  readonly messageId: string;
  readonly contextId?: string;
  readonly taskId?: string;
  readonly kind: 'message';
  readonly metadata?: Readonly<Record<string, any>>;
  readonly extensions?: readonly string[];
  readonly referenceTaskIds?: readonly string[];
};

export type A2APart = 
  | { readonly kind: 'text'; readonly text: string; readonly metadata?: Readonly<Record<string, any>> }
  | { readonly kind: 'data'; readonly data: Readonly<Record<string, any>>; readonly metadata?: Readonly<Record<string, any>> }
  | { readonly kind: 'file'; readonly file: A2AFile; readonly metadata?: Readonly<Record<string, any>> };

export type A2AFile = 
  | { readonly bytes: string; readonly name?: string; readonly mimeType?: string }
  | { readonly uri: string; readonly name?: string; readonly mimeType?: string };

export type TaskState = 
  | 'submitted'
  | 'working' 
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'auth-required'
  | 'unknown';

export type A2ATask = {
  readonly id: string;
  readonly contextId: string;
  readonly status: {
    readonly state: TaskState;
    readonly message?: A2AMessage;
    readonly timestamp?: string;
  };
  readonly history?: readonly A2AMessage[];
  readonly artifacts?: readonly A2AArtifact[];
  readonly metadata?: Readonly<Record<string, any>>;
  readonly kind: 'task';
};

export type A2AArtifact = {
  readonly artifactId: string;
  readonly name?: string;
  readonly description?: string;
  readonly parts: readonly A2APart[];
  readonly metadata?: Readonly<Record<string, any>>;
  readonly extensions?: readonly string[];
};

export type AgentCard = {
  readonly protocolVersion: string;
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly preferredTransport?: string;
  readonly version: string;
  readonly provider?: {
    readonly organization: string;
    readonly url: string;
  };
  readonly capabilities: {
    readonly streaming?: boolean;
    readonly pushNotifications?: boolean;
    readonly stateTransitionHistory?: boolean;
  };
  readonly defaultInputModes: readonly string[];
  readonly defaultOutputModes: readonly string[];
  readonly skills: readonly AgentSkill[];
  readonly securitySchemes?: Readonly<Record<string, any>>;
  readonly security?: readonly Record<string, readonly string[]>[];
};

export type AgentSkill = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly examples?: readonly string[];
  readonly inputModes?: readonly string[];
  readonly outputModes?: readonly string[];
};

// JSON-RPC Types
export type JSONRPCRequest = {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly method: string;
  readonly params?: Readonly<Record<string, any>>;
};

export type JSONRPCResponse = {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
} & (
  | { readonly result: any; readonly error?: never }
  | { readonly result?: never; readonly error: JSONRPCError }
);

export type JSONRPCError = {
  readonly code: number;
  readonly message: string;
  readonly data?: any;
};

// A2A Request/Response Types
export type SendMessageRequest = JSONRPCRequest & {
  readonly method: 'message/send';
  readonly params: {
    readonly message: A2AMessage;
    readonly configuration?: MessageSendConfiguration;
    readonly metadata?: Readonly<Record<string, any>>;
  };
};

export type SendStreamingMessageRequest = JSONRPCRequest & {
  readonly method: 'message/stream';
  readonly params: {
    readonly message: A2AMessage;
    readonly configuration?: MessageSendConfiguration;
    readonly metadata?: Readonly<Record<string, any>>;
  };
};

export type MessageSendConfiguration = {
  readonly acceptedOutputModes?: readonly string[];
  readonly historyLength?: number;
  readonly blocking?: boolean;
};

export type SendMessageResponse = JSONRPCResponse & {
  readonly result: A2AMessage | A2ATask;
};

export type GetTaskRequest = JSONRPCRequest & {
  readonly method: 'tasks/get';
  readonly params: {
    readonly id: string;
    readonly historyLength?: number;
    readonly metadata?: Readonly<Record<string, any>>;
  };
};

export type GetTaskResponse = JSONRPCResponse & {
  readonly result: A2ATask;
};

// Stream Event Types
export type StreamEvent = {
  readonly isTaskComplete: boolean;
  readonly content?: any;
  readonly updates?: string;
  readonly newState?: AgentState;
  readonly timestamp: string;
};

export type A2AStreamEvent = 
  | { readonly kind: 'status-update'; readonly taskId: string; readonly contextId: string; readonly status: A2ATask['status']; readonly final: boolean }
  | { readonly kind: 'artifact-update'; readonly taskId: string; readonly contextId: string; readonly artifact: A2AArtifact; readonly append?: boolean; readonly lastChunk?: boolean }
  | { readonly kind: 'message'; readonly message: A2AMessage };

// Agent State Types
export type AgentState = {
  readonly sessionId: string;
  readonly messages: readonly any[];
  readonly context: Readonly<Record<string, any>>;
  readonly artifacts: readonly any[];
  readonly timestamp: string;
};

export type ToolContext = {
  readonly actions: {
    readonly requiresInput: boolean;
    readonly skipSummarization: boolean;
    readonly escalate: boolean;
  };
  readonly metadata: Readonly<Record<string, any>>;
};

export type A2AToolResult = {
  readonly result: any;
  readonly context?: ToolContext;
};

// JAF Agent Types for A2A
export type A2AAgentTool = {
  readonly name: string;
  readonly description: string;
  readonly parameters: z.ZodType<any>;
  readonly execute: (args: any, context?: ToolContext) => Promise<any | A2AToolResult>;
};

export type A2AAgent = {
  readonly name: string;
  readonly description: string;
  readonly supportedContentTypes: readonly string[];
  readonly instruction: string;
  readonly tools: readonly A2AAgentTool[];
};

// Server Configuration Types
export type A2AServerConfig = {
  readonly agents: ReadonlyMap<string, A2AAgent>;
  readonly agentCard: {
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly provider: {
      readonly organization: string;
      readonly url: string;
    };
  };
  readonly port: number;
  readonly host?: string;
  readonly capabilities?: Partial<AgentCard['capabilities']>;
  readonly taskProvider?: {
    readonly type: 'memory' | 'redis' | 'postgres';
    readonly config?: any; // Provider-specific configuration
    readonly externalClients?: {
      readonly redis?: any;
      readonly postgres?: any;
    };
  };
};

// Client Types
export type A2AClientConfig = {
  readonly baseUrl: string;
  readonly timeout?: number;
};

export type A2AClientState = {
  readonly config: A2AClientConfig;
  readonly sessionId: string;
};

// Error Types
export const A2AErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006
} as const;

export type A2AError = {
  readonly code: typeof A2AErrorCodes[keyof typeof A2AErrorCodes];
  readonly message: string;
  readonly data?: any;
};

// Validation Schemas
export const a2aMessageSchema = z.object({
  role: z.enum(['user', 'agent']),
  parts: z.array(z.union([
    z.object({
      kind: z.literal('text'),
      text: z.string(),
      metadata: z.record(z.any()).optional()
    }),
    z.object({
      kind: z.literal('data'),
      data: z.record(z.any()),
      metadata: z.record(z.any()).optional()
    }),
    z.object({
      kind: z.literal('file'),
      file: z.union([
        z.object({
          bytes: z.string(),
          name: z.string().optional(),
          mimeType: z.string().optional()
        }),
        z.object({
          uri: z.string(),
          name: z.string().optional(),
          mimeType: z.string().optional()
        })
      ]),
      metadata: z.record(z.any()).optional()
    })
  ])),
  messageId: z.string(),
  contextId: z.string().optional(),
  taskId: z.string().optional(),
  kind: z.literal('message'),
  metadata: z.record(z.any()).optional(),
  extensions: z.array(z.string()).optional(),
  referenceTaskIds: z.array(z.string()).optional()
});

export const sendMessageRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.literal('message/send'),
  params: z.object({
    message: a2aMessageSchema,
    configuration: z.object({
      acceptedOutputModes: z.array(z.string()).optional(),
      historyLength: z.number().optional(),
      blocking: z.boolean().optional()
    }).optional(),
    metadata: z.record(z.any()).optional()
  })
});