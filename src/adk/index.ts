/**
 * JAF ADK Layer - Main Export
 * 
 * Functional Agent Development Kit for JAF
 */

// ========== Core Types ==========
export * from './types.js';

// ========== Model Definitions ==========
export { 
  Model, 
  ModelCategory, 
  isValidModel, 
  getModelProvider, 
  getModelCategory,
  // Backward compatibility aliases
  CLAUDE_3_OPUS,
  CLAUDE_3_SONNET,
  CLAUDE_3_HAIKU
} from './models.js';

// ========== Content System ==========
export {
  // Content Creation
  createContent,
  createUserMessage,
  createModelMessage,
  createSystemMessage,
  createTextPart,
  createImagePart,
  createAudioPart,
  createFunctionCallPart,
  createFunctionResponsePart,
  createFunctionCall,
  createFunctionResponse,
  
  // Content Manipulation
  addPart,
  addTextPart,
  addFunctionCall,
  addFunctionResponse,
  
  // Content Query
  getTextContent,
  getFunctionCalls,
  getFunctionResponses,
  hasTextContent,
  hasFunctionCalls,
  hasFunctionResponses,
  
  // Content Conversion
  contentToString,
  parseContent,
  
  // Content Validation
  isValidContent,
  isValidPart,
  
  // Content Utilities
  mergeContent,
  cloneContent,
  filterContentByRole,
  getLastUserMessage,
  getLastModelMessage,
  getContentStats,
  getConversationStats
} from './content/index.js';

// ========== Agent System ==========
export {
  // Agent Creation
  createAgent,
  createSimpleAgent,
  createMultiAgent,
  
  // Agent Validation
  validateAgent,
  validateAgentConfig,
  
  // Agent Manipulation
  cloneAgent,
  updateAgent,
  addToolToAgent,
  removeToolFromAgent,
  addSubAgent,
  removeSubAgent,
  
  // Agent Query
  getAgentTool,
  hasAgentTool,
  getAgentSubAgent,
  hasSubAgent,
  isMultiAgent,
  getAgentToolNames,
  getSubAgentNames,
  getAgentStats,
  
  // Agent Templates
  createWeatherAgent,
  createChatAgent,
  createCodeAgent,
  
  // Agent Utilities
  agentToJSON,
  agentFromJSON,
  compareAgents,
  
  // Error Handling
  createAgentError,
  withAgentErrorHandling
} from './agents/index.js';

// ========== Tool System ==========
export {
  // Tool Creation
  createFunctionTool,
  createAsyncFunctionTool,
  createOpenAPIToolset,
  createCrewAIAdapter,
  createLangChainAdapter,
  
  // Tool Validation
  validateTool,
  validateToolParameter,
  validateToolParameters,
  
  // Tool Execution
  executeTool,
  executeTools,
  
  // Tool Utilities
  getToolByName,
  hasToolByName,
  filterToolsBySource,
  getToolNames,
  cloneTool,
  createToolError,
  
  // Built-in Tools
  createEchoTool,
  createCalculatorTool,
  createTimestampTool
} from './tools/index.js';

// ========== Session Management ==========
export {
  // Session Creation
  createSession,
  generateSessionId,
  
  // Session Providers
  createInMemorySessionProvider,
  createRedisSessionProvider,
  createPostgresSessionProvider,
  
  // Session Operations
  addMessageToSession,
  addArtifactToSession,
  removeArtifactFromSession,
  updateSessionMetadata,
  clearSessionMessages,
  
  // Session Validation
  validateSession,
  validateSessionContext,
  
  // Session Utilities
  getOrCreateSession,
  getSessionStats,
  cloneSession,
  mergeSessionArtifacts,
  
  // Session Query
  getLastUserMessage as getLastUserMessageFromSession,
  getLastModelMessage as getLastModelMessageFromSession,
  getMessagesByRole,
  hasArtifact,
  getArtifact,
  getArtifactKeys,
  
  // Memory Provider Bridge
  createMemoryProviderBridge,
  
  // Error Handling
  createSessionError,
  withSessionErrorHandling
} from './sessions/index.js';

// ========== Artifact Storage ==========
export {
  // Types
  type Artifact,
  type ArtifactMetadata,
  type ArtifactStorage,
  type ArtifactStorageConfig,
  
  // Storage Implementations
  createMemoryArtifactStorage,
  createRedisArtifactStorage,
  createPostgresArtifactStorage,
  createArtifactStorage,
  
  // Session Integration
  getSessionArtifact,
  setSessionArtifact,
  deleteSessionArtifact,
  clearSessionArtifacts,
  listSessionArtifacts
} from './artifacts/index.js';

// ========== Runner System ==========
export {
  // Core Runner Functions
  runAgent,
  runAgentStream,
  
  // Runner Configuration
  createRunnerConfig,
  validateRunnerConfig,
  validateRunContext,
  
  // Runner Statistics
  getRunnerStats,
  
  // Error Handling
  withRunnerErrorHandling
} from './runners/index.js';

// ========== LLM Provider System ==========
export {
  // LLM Service Functions
  createAdkLLMService,
  createDefaultAdkLLMService
} from './providers/llm-service.js';

export {
  // Configuration Functions
  createAdkLLMConfig,
  createDefaultAdkLLMConfig,
  createAdkLLMConfigFromEnvironment,
  debugAdkLLMConfig,
  validateAdkLLMConfig,
  
  // Model and Provider Utils
  getModelConfig,
  getModelsForProvider,
  getAllAvailableModels,
  getProviderForModel,
  mapAdkModelToProviderModel,
  
  // Configuration Types and Constants
  DEFAULT_PROVIDER_CONFIGS,
  loadEnvironmentConfig
} from './config/llm-config.js';

export {
  // Type Converters
  convertAdkContentToCoreMessage,
  convertCoreMessageToAdkContent,
  convertAdkAgentToCoreAgent,
  convertCoreAgentToAdkAgent,
  safeJsonParse,
  safeJsonStringify
} from './providers/type-converters.js';

// ========== Schema Validation ==========
export {
  // Schema Validator Creation
  createSchemaValidator,
  validateAgainstJsonSchema,
  
  // Type Guards
  isString,
  isNumber,
  isBoolean,
  isObject,
  isArray,
  isNull,
  isUndefined,
  
  // Schema Builders
  stringSchema,
  numberSchema,
  booleanSchema,
  objectSchema,
  arraySchema,
  
  // Common Validators
  createStringValidator,
  createNumberValidator,
  createBooleanValidator,
  createObjectValidator,
  createArrayValidator,
  
  // Composite Type Guards
  isOptional,
  isNullable,
  isUnion,
  hasProperty,
  hasProperties,
  
  // Validation Utilities
  validateInput,
  validateOutput,
  assertValid,
  isValid,
  
  // Schema Transformation
  transformAndValidate,
  validateAndTransform,
  
  // Example Schemas
  weatherQueryValidator,
  weatherResponseValidator,
  
  // Error Handling
  createValidationError,
  withSchemaValidation
} from './schemas/index.js';

// ========== Streaming System ==========
export {
  // Live Request Queue
  createLiveRequestQueue,
  
  // Event Creation
  createAgentEvent,
  createMessageStartEvent,
  createMessageDeltaEvent,
  createMessageCompleteEvent,
  createFunctionCallStartEvent,
  createFunctionCallCompleteEvent,
  createAgentTransferEvent,
  createConversationEndEvent,
  createErrorEvent,
  
  // Stream Utilities
  streamToQueue,
  queueToStream,
  combineStreams,
  filterEventStream,
  mapEventStream,
  
  // Stream Configuration
  createStreamConfig,
  createTextStreamConfig,
  createAudioStreamConfig,
  createMultiModalStreamConfig,
  
  // Buffered Streaming
  createBufferedStream,
  createThrottledStream,
  createDebouncedStream,
  
  // Event Processing
  collectEvents,
  findFirstEvent,
  waitForEvent,
  countEvents,
  
  // Event Type Filters
  isMessageEvent,
  isFunctionEvent,
  isControlEvent,
  isErrorEvent,
  filterMessageEvents,
  filterFunctionEvents,
  filterControlEvents,
  filterErrorEvents,
  
  // Stream Monitoring
  monitorStream,
  logStream,
  metricsMonitor,
  
  // Stream Error Handling
  withStreamErrorHandling,
  retryStream,
  
  // Bidirectional Streaming
  createBidirectionalStream,
  
  // Stream Utilities
  streamToArray,
  takeFromStream,
  skipFromStream
} from './streaming/index.js';

// ========== Convenience Functions ==========

import { 
  createAgent, 
  createSimpleAgent,
  createInMemorySessionProvider, 
  createRunnerConfig,
  runAgent,
  runAgentStream,
  createFunctionTool
} from './index.js';
import { Agent, Tool, RunnerConfig, SessionProvider, Model, ToolParameterType } from './types.js';

/**
 * Quick setup for a simple agent with in-memory session management
 */
export const quickSetup = (
  name: string,
  model: Model | string,
  instruction: string,
  tools: Tool[] = []
) => {
  const agent = createSimpleAgent(name, model, instruction, tools);
  const sessionProvider = createInMemorySessionProvider();
  const runnerConfig = createRunnerConfig(agent, sessionProvider);
  
  return {
    agent,
    sessionProvider,
    runnerConfig,
    run: runAgent.bind(null, runnerConfig),
    stream: runAgentStream.bind(null, runnerConfig)
  };
};

/**
 * Create a weather agent with built-in tools
 */
export const createQuickWeatherAgent = () => {
  const weatherTool = createFunctionTool({
    name: 'get_weather',
    description: 'Get current weather information',
    execute: (params, context) => {
      const { location } = params as { location: string };
      return {
        location,
        temperature: 22,
        condition: 'sunny',
        humidity: 65
      };
    },
    parameters: [
      {
        name: 'location',
        type: ToolParameterType.STRING,
        description: 'City or location name',
        required: true
      }
    ]
  });
  
  return quickSetup(
    'weather_agent',
    Model.GEMINI_2_0_FLASH,
    'You are a helpful weather assistant. Use the get_weather tool to provide accurate weather information.',
    [weatherTool]
  );
};

/**
 * Create a chat agent with calculator capabilities
 */
export const createQuickChatAgent = () => {
  const calcTool = createFunctionTool({
    name: 'calculate',
    description: 'Perform mathematical calculations',
    execute: (params, context) => {
      const { expression } = params as { expression: string };
      try {
        // Use safe math evaluator instead of eval
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { evaluateMathExpression } = require('../utils/safe-math');
        const result = evaluateMathExpression(expression);
        return { result, expression };
      } catch (error) {
        throw new Error(`Invalid expression: ${expression}. ${error instanceof Error ? error.message : ''}`);
      }
    },
    parameters: [
      {
        name: 'expression',
        type: ToolParameterType.STRING,
        description: 'Mathematical expression to evaluate',
        required: true
      }
    ]
  });
  
  return quickSetup(
    'chat_agent',
    Model.GEMINI_2_0_FLASH,
    'You are a friendly assistant that can help with general questions and math calculations.',
    [calcTool]
  );
};

// ========== Version Info ==========
export const VERSION = '1.0.0';
export const ADK_LAYER_VERSION = '1.0.0';

// ========== Framework Integration ==========

/**
 * Bridge to JAF core types
 */
export const bridgeToJAF = (jafAgent: any) => {
  // Convert JAF agent to ADK agent
  // This would need to be implemented based on JAF's actual structure
  return createAgent({
    name: jafAgent.name || 'jaf_agent',
    model: jafAgent.model || Model.GEMINI_2_0_FLASH,
    instruction: jafAgent.instruction || 'JAF agent',
    tools: jafAgent.tools || []
  });
};

/**
 * Bridge from ADK back to JAF
 */
export const bridgeFromADK = (adkAgent: Agent) => {
  // Convert ADK agent back to JAF format
  return {
    name: adkAgent.config.name,
    model: adkAgent.config.model,
    instruction: adkAgent.config.instruction,
    tools: adkAgent.config.tools
  };
};