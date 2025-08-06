/**
 * JAF ADK Layer - Core Types
 * 
 * Functional equivalents of Google ADK primitives following JAF's no-classes principle
 */

// Import Model type for use in interfaces
import { Model } from './models.js';

// ========== Core Primitives ==========

export enum ContentRole {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

// Re-export Model enum and utilities from models.ts
export { Model, ModelCategory, isValidModel, getModelProvider, getModelCategory } from './models.js';

export interface Content {
  role: ContentRole | 'user' | 'model' | 'system';
  parts: Part[];
  metadata?: Record<string, unknown>;
}

export enum PartType {
  TEXT = 'text',
  IMAGE = 'image',
  AUDIO = 'audio',
  FUNCTION_CALL = 'function_call',
  FUNCTION_RESPONSE = 'function_response'
}

export interface Part {
  type: PartType | 'text' | 'image' | 'audio' | 'function_call' | 'function_response';
  text?: string;
  data?: ArrayBuffer | string;
  functionCall?: FunctionCall;
  functionResponse?: FunctionResponse;
  metadata?: Record<string, unknown>;
}

export interface FunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface FunctionResponse {
  id: string;
  name: string;
  response: unknown;
  success: boolean;
  error?: string;
}

// ========== Agent System ==========

export interface Agent {
  id: string;
  config: AgentConfig;
  metadata: AgentMetadata;
}

export interface AgentConfig {
  name: string;
  model: Model | string;
  instruction: string;
  description?: string;
  tools: Tool[];
  subAgents?: AgentConfig[];
  inputSchema?: SchemaValidator<unknown>;
  outputSchema?: SchemaValidator<unknown>;
  outputKey?: string;
  guardrails?: GuardrailFunction[];
  examples?: Example[];
}

export interface AgentMetadata {
  created: Date;
  version: string;
  lastModified?: Date;
  tags?: string[];
}

// ========== Tool System ==========

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: ToolExecutor;
  metadata?: ToolMetadata;
}

export interface FunctionToolConfig {
  name: string;
  description: string;
  execute: (params: Record<string, unknown>, context: ToolContext) => unknown | Promise<unknown>;
  parameters?: ToolParameter[];
  metadata?: Partial<ToolMetadata>;
}

export enum ToolParameterType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  OBJECT = 'object',
  ARRAY = 'array'
}

export enum ToolSource {
  FUNCTION = 'function',
  OPENAPI = 'openapi',
  CREWAI = 'crewai',
  LANGCHAIN = 'langchain',
  MCP = 'mcp'
}

export interface ToolParameter {
  name: string;
  type: ToolParameterType | 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, ToolParameter>;
  items?: ToolParameter;
}

export interface ToolMetadata {
  source: ToolSource | 'function' | 'openapi' | 'crewai' | 'langchain' | 'mcp';
  version?: string;
  author?: string;
  tags?: string[];
}

export type ToolExecutor = (
  params: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

export interface ToolContext {
  agent: Agent;
  session: Session;
  message: Content;
  actions: ToolActions;
  metadata?: Record<string, unknown>;
}

export interface ToolActions {
  transferToAgent?: string;
  endConversation?: boolean;
  setOutputKey?: string;
  addArtifact?: (key: string, value: unknown) => void;
  getArtifact?: (key: string) => unknown;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ========== Session Management ==========

export interface Session {
  id: string;
  appName: string;
  userId: string;
  messages: Content[];
  artifacts: Record<string, unknown>;
  metadata: SessionMetadata;
}

export interface SessionMetadata {
  created: Date;
  lastAccessed?: Date;
  tags?: string[];
  properties?: Record<string, unknown>;
}

export interface SessionContext {
  appName: string;
  userId: string;
  sessionId?: string;
}

export interface SessionProvider {
  createSession: (context: SessionContext) => Promise<Session>;
  getSession: (sessionId: string) => Promise<Session | null>;
  updateSession: (session: Session) => Promise<Session>;
  listSessions: (userId: string) => Promise<Session[]>;
  deleteSession: (sessionId: string) => Promise<boolean>;
}

// ========== Runner System ==========

export interface RunnerConfig {
  agent: Agent;
  sessionProvider: SessionProvider;
  artifactProvider?: ArtifactProvider;
  guardrails?: GuardrailFunction[];
  maxLLMCalls?: number;
  timeout?: number;
}

export interface RunContext {
  userId: string;
  sessionId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentResponse {
  content: Content;
  session: Session;
  toolCalls: FunctionCall[];
  toolResponses: FunctionResponse[];
  metadata: ResponseMetadata;
}

export interface ResponseMetadata {
  requestId: string;
  agentId: string;
  timestamp: Date;
  tokensUsed?: number;
  executionTime?: number;
  llmCalls?: number;
}

// ========== Event System ==========

export interface AgentEvent {
  type: AgentEventType;
  timestamp: Date;
  content?: Content;
  functionCall?: FunctionCall;
  functionResponse?: FunctionResponse;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type AgentEventType = 
  | 'message_start'
  | 'message_delta' 
  | 'message_complete'
  | 'function_call_start'
  | 'function_call_complete'
  | 'agent_transfer'
  | 'conversation_end'
  | 'error';

// ========== Streaming ==========

export interface LiveRequestQueue {
  id: string;
  enqueue: (message: Content) => Promise<void>;
  dequeue: () => Promise<Content | null>;
  isEmpty: () => boolean;
  close: () => void;
}

export interface StreamConfig {
  responseModalities: ResponseModality[];
  bufferSize?: number;
  timeout?: number;
}

export type ResponseModality = 'TEXT' | 'AUDIO' | 'IMAGE';

// ========== Schema Validation ==========

export interface SchemaValidator<T> {
  schema: JsonSchema;
  validate: (data: unknown) => ValidationResult<T>;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
}

// ========== Guardrails ==========

export type GuardrailFunction = (
  message: Content,
  context: GuardrailContext
) => Promise<GuardrailResult>;

export interface GuardrailContext {
  agent: Agent;
  session: Session;
  previousMessages: Content[];
}

export interface GuardrailResult {
  allowed: boolean;
  modifiedMessage?: Content;
  reason?: string;
  action?: 'block' | 'modify' | 'warn';
}

// ========== Examples System ==========

export interface Example {
  input: Content;
  output: Content[];
  description?: string;
  tags?: string[];
}

export interface ExampleProvider {
  getExamples: (query: string) => Promise<Example[]>;
}

// ========== Artifact Management ==========

export interface ArtifactProvider {
  store: (key: string, value: unknown, metadata?: Record<string, unknown>) => Promise<string>;
  retrieve: (key: string) => Promise<unknown | null>;
  delete: (key: string) => Promise<boolean>;
  list: (pattern?: string) => Promise<string[]>;
}

// ========== Multi-Agent ==========

export interface MultiAgentConfig extends AgentConfig {
  subAgents: AgentConfig[];
  delegationStrategy: DelegationStrategy;
  coordinationRules?: CoordinationRule[];
}

export type DelegationStrategy = 
  | 'sequential'     // Run agents in order
  | 'parallel'       // Run agents concurrently  
  | 'conditional'    // Choose agent based on conditions
  | 'hierarchical';  // Delegate based on capability

export interface CoordinationRule {
  condition: (message: Content, context: RunContext) => boolean;
  action: 'delegate' | 'parallel' | 'sequential';
  targetAgents?: string[];
}

// ========== Integration Types ==========

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, Record<string, OperationObject>>;
  components?: {
    schemas?: Record<string, JsonSchema>;
  };
}

export interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
}

export interface ParameterObject {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  description?: string;
  required?: boolean;
  schema: JsonSchema;
}

export interface RequestBodyObject {
  description?: string;
  content: Record<string, MediaTypeObject>;
  required?: boolean;
}

export interface ResponseObject {
  description: string;
  content?: Record<string, MediaTypeObject>;
}

export interface MediaTypeObject {
  schema: JsonSchema;
}

// ========== Utility Types ==========

export type TypeGuard<T> = (value: unknown) => value is T;

export interface IdGenerator {
  generate: () => string;
}

export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

// ========== Error Types ==========

// ========== Functional Error Types ==========

export interface AdkErrorObject {
  name: string;
  message: string;
  code: string;
  context?: Record<string, unknown>;
  stack?: string;
}

export interface ValidationErrorObject extends AdkErrorObject {
  errors: string[];
}

export interface ToolErrorObject extends AdkErrorObject {
  toolName: string;
}

export interface SessionErrorObject extends AdkErrorObject {
  sessionId?: string;
}

export interface AgentErrorObject extends AdkErrorObject {
  agentId?: string;
}

// ========== Error Factory Functions ==========

export const createAdkError = (
  message: string,
  code: string,
  context?: Record<string, unknown>
): AdkErrorObject => ({
  name: 'AdkError',
  message,
  code,
  context,
  stack: new Error().stack
});

export const createValidationError = (
  message: string,
  errors: string[],
  context?: Record<string, unknown>
): ValidationErrorObject => ({
  ...createAdkError(message, 'VALIDATION_ERROR', context),
  name: 'ValidationError',
  errors
});

export const createToolError = (
  message: string,
  toolName: string,
  context?: Record<string, unknown>
): ToolErrorObject => ({
  ...createAdkError(message, 'TOOL_ERROR', context),
  name: 'ToolError',
  toolName
});

export const createSessionError = (
  message: string,
  sessionId?: string,
  context?: Record<string, unknown>
): SessionErrorObject => ({
  ...createAdkError(message, 'SESSION_ERROR', context),
  name: 'SessionError',
  sessionId
});

export const createAgentError = (
  message: string,
  agentId?: string,
  context?: Record<string, unknown>
): AgentErrorObject => ({
  ...createAdkError(message, 'AGENT_ERROR', context),
  name: 'AgentError',
  agentId
});

// ========== Error Throwing Utilities ==========

export const throwAdkError = (
  message: string,
  code: string,
  context?: Record<string, unknown>
): never => {
  const error = new Error(message);
  error.name = 'AdkError';
  (error as any).code = code;
  (error as any).context = context;
  throw error;
};

export const throwValidationError = (
  message: string,
  errors: string[],
  context?: Record<string, unknown>
): never => {
  const error = new Error(message);
  error.name = 'ValidationError';
  (error as any).code = 'VALIDATION_ERROR';
  (error as any).errors = errors;
  (error as any).context = context;
  throw error;
};

export const throwToolError = (
  message: string,
  toolName: string,
  context?: Record<string, unknown>
): never => {
  const error = new Error(message);
  error.name = 'ToolError';
  (error as any).code = 'TOOL_ERROR';
  (error as any).toolName = toolName;
  (error as any).context = context;
  throw error;
};

export const throwSessionError = (
  message: string,
  sessionId?: string,
  context?: Record<string, unknown>
): never => {
  const error = new Error(message);
  error.name = 'SessionError';
  (error as any).code = 'SESSION_ERROR';
  (error as any).sessionId = sessionId;
  (error as any).context = context;
  throw error;
};

export const throwAgentError = (
  message: string,
  agentId?: string,
  context?: Record<string, unknown>
): never => {
  const error = new Error(message);
  error.name = 'AgentError';
  (error as any).code = 'AGENT_ERROR';
  (error as any).agentId = agentId;
  (error as any).context = context;
  throw error;
};

// ========== Legacy Type Aliases (for compatibility) ==========

export type AdkError = AdkErrorObject;
export type ValidationError = ValidationErrorObject;
export type ToolError = ToolErrorObject;
export type SessionError = SessionErrorObject;
export type AgentError = AgentErrorObject;