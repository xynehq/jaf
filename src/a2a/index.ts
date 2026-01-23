/**
 * A2A Integration for JAF - Main Export
 * Pure functional A2A protocol support for Juspay Agent Framework
 */

// Core A2A Types
export type {
  A2AAgent,
  A2AAgentTool,
  A2AMessage,
  A2APart,
  A2ATask,
  A2AArtifact,
  A2AError,
  A2AStreamEvent,
  AgentCard,
  AgentSkill,
  AgentState,
  StreamEvent,
  ToolContext,
  A2AToolResult,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
  SendMessageRequest,
  SendStreamingMessageRequest,
  GetTaskRequest,
  MessageSendConfiguration,
  A2AServerConfig,
  A2AClientConfig,
  A2AClientState
} from './types.js';

// Executor Types
export type {
  A2AExecutionContext,
  A2AExecutionEvent,
  A2AExecutionResult
} from './executor.js';

// Agent Creation Functions
import { 
  createA2AAgent, 
  createA2ATool 
} from './agent.js';
export {
  createA2AAgent,
  createA2ATool,
  getProcessingMessage,
  createInitialAgentState,
  addMessageToState,
  updateStateFromRunResult,
  createUserMessage,
  transformA2AAgentToJAF,
  transformA2AToolToJAF,
  createRunConfigForA2AAgent,
  transformToRunState,
  processAgentQuery,
  extractTextFromA2AMessage,
  createA2ATextMessage,
  createA2ADataMessage,
  createA2ATask,
  updateA2ATaskStatus,
  addArtifactToA2ATask,
  completeA2ATask
} from './agent.js';

// Execution Functions
export {
  executeA2AAgent,
  convertToA2AStreamEvents,
  executeA2AAgentWithStreaming
} from './executor.js';

// Protocol Handlers
import {
  validateJSONRPCRequest,
  createJSONRPCSuccessResponse,
  createJSONRPCErrorResponse
} from './protocol.js';
export {
  validateJSONRPCRequest,
  createJSONRPCSuccessResponse,
  createJSONRPCErrorResponse,
  createA2AError,
  mapErrorToA2AError,
  validateSendMessageRequest,
  handleMessageSend,
  handleMessageStream,
  handleTasksGet,
  handleTasksCancel,
  handleGetAuthenticatedExtendedCard,
  routeA2ARequest,
  createProtocolHandlerConfig
} from './protocol.js';

// Agent Card Generation
import {
  generateAgentCard,
  validateAgentCard,
  createMinimalAgentCard
} from './agent-card.js';
export {
  generateAgentCard,
  generateSkillsFromAgents,
  generateExamplesForAgent,
  generateExamplesForTool,
  generateSecuritySchemes,
  generateSecurityRequirements,
  generateAgentCardForAgent,
  validateAgentCard,
  createMinimalAgentCard,
  mergeAgentCards,
  createAgentCardFromConfig
} from './agent-card.js';

// Server Functions
import {
  createA2AServer,
  startA2AServer
} from './server.js';
export {
  createA2AServer,
  startA2AServer
} from './server.js';

// Client Functions
import {
  createA2AClient,
  discoverAgents,
  connectToA2AAgent
} from './client.js';

// Memory Functions
import {
  createA2ATaskProvider,
  createSimpleA2ATaskProvider,
  createCompositeA2ATaskProvider,
  createA2ATaskProviderFromEnv,
  validateA2ATaskProviderConfig
} from './memory/factory.js';
export {
  createA2AClient,
  createMessageRequest,
  createStreamingMessageRequest,
  sendA2ARequest,
  sendMessage,
  streamMessage,
  getAgentCard,
  discoverAgents,
  sendMessageToAgent,
  streamMessageToAgent,
  extractTextResponse,
  checkA2AHealth,
  getA2ACapabilities,
  connectToA2AAgent
} from './client.js';

// Error Codes
export { A2AErrorCodes } from './types.js';

// Validation Schemas
export { a2aMessageSchema, sendMessageRequestSchema } from './types.js';

// Memory and Task Provider Support
export * from './memory/index.js';

// Example Agents (optional, for development and testing)
export { createWeatherAgent, getWeatherAgentProcessingMessage, weatherAgentExamples } from './examples/weather-agent.js';
export { createCalculatorAgent, createGreetingAgent, startExampleServer } from './examples/server-example.js';

// Convenience functions for common use cases
export const A2A = {
  // Quick agent creation
  agent: createA2AAgent,
  tool: createA2ATool,
  
  // Quick server setup
  server: {
    create: createA2AServer,
    start: startA2AServer
  },
  
  // Quick client setup
  client: {
    create: createA2AClient,
    connect: connectToA2AAgent,
    discover: discoverAgents
  },
  
  // Protocol utilities
  protocol: {
    validate: validateJSONRPCRequest,
    createSuccess: createJSONRPCSuccessResponse,
    createError: createJSONRPCErrorResponse
  },
  
  // Agent card utilities
  card: {
    generate: generateAgentCard,
    validate: validateAgentCard,
    minimal: createMinimalAgentCard
  },

  // Task memory utilities
  memory: {
    createTaskProvider: createA2ATaskProvider,
    createSimpleTaskProvider: createSimpleA2ATaskProvider,
    createCompositeTaskProvider: createCompositeA2ATaskProvider,
    createTaskProviderFromEnv: createA2ATaskProviderFromEnv,
    validateTaskProviderConfig: validateA2ATaskProviderConfig
  }
} as const;

// Default export for convenience
export default A2A;