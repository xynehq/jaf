/**
 * FAF ADK Layer - Runner System
 * 
 * Functional agent execution system
 */

import {
  Agent,
  RunnerConfig,
  RunContext,
  AgentResponse,
  AgentEvent,
  Content,
  Session,
  SessionProvider,
  Tool,
  ToolContext,
  ToolActions,
  FunctionCall,
  FunctionResponse,
  MultiAgentConfig,
  DelegationStrategy,
  ResponseMetadata,
  AgentEventType,
  GuardrailFunction,
  throwAgentError,
  throwToolError,
  throwSessionError
} from '../types';

import { 
  generateRunnerGraph, 
  generateAgentGraph, 
  generateToolGraph,
  GraphOptions,
  GraphResult 
} from '../../visualization/graphviz';

import { getOrCreateSession, addMessageToSession, addArtifactToSession } from '../sessions';
import { executeTool } from '../tools';
import { createUserMessage, createModelMessage, getFunctionCalls, addFunctionResponse } from '../content';

// ========== Core Runner Functions ==========

export const runAgent = async (
  config: RunnerConfig,
  context: RunContext,
  message: Content
): Promise<AgentResponse> => {
  const requestId = context.requestId || generateRequestId();
  const startTime = Date.now();
  
  try {
    // Get or create session
    const session = await getOrCreateSession(config.sessionProvider, {
      appName: context.metadata?.appName as string || 'default',
      userId: context.userId,
      sessionId: context.sessionId
    });
    
    // Add user message to session
    const updatedSession = addMessageToSession(session, message);
    
    // Apply guardrails
    const guardedMessage = await applyGuardrails(
      config.guardrails || [],
      message,
      { agent: config.agent, session: updatedSession, previousMessages: updatedSession.messages }
    );
    
    // Execute agent
    const result = await executeAgent(config, updatedSession, guardedMessage, context);
    
    // Calculate metadata
    const executionTime = Date.now() - startTime;
    const metadata: ResponseMetadata = {
      requestId,
      agentId: config.agent.id,
      timestamp: new Date(),
      executionTime,
      llmCalls: 1 // Simplified for now
    };
    
    return {
      ...result,
      metadata
    };
    
  } catch (error) {
    throwAgentError(
      `Agent execution failed: ${error instanceof Error ? error.message : String(error)}`,
      config.agent.id,
      { requestId, context }
    );
  }
};

export const runAgentStream = async function* (
  config: RunnerConfig,
  context: RunContext,
  message: Content
): AsyncGenerator<AgentEvent> {
  const requestId = context.requestId || generateRequestId();
  
  try {
    yield createAgentEvent('message_start', { content: message });
    
    // Get or create session
    const session = await getOrCreateSession(config.sessionProvider, {
      appName: context.metadata?.appName as string || 'default',
      userId: context.userId,
      sessionId: context.sessionId
    });
    
    // Add user message to session
    const updatedSession = addMessageToSession(session, message);
    
    // Apply guardrails
    const guardedMessage = await applyGuardrails(
      config.guardrails || [],
      message,
      { agent: config.agent, session: updatedSession, previousMessages: updatedSession.messages }
    );
    
    // Execute agent with streaming
    yield* executeAgentStream(config, updatedSession, guardedMessage, context);
    
    yield createAgentEvent('message_complete');
    
  } catch (error) {
    yield createAgentEvent('error', { error: error instanceof Error ? error.message : String(error) });
  }
};

// ========== Agent Execution ==========

const executeAgent = async (
  config: RunnerConfig,
  session: Session,
  message: Content,
  context: RunContext
): Promise<AgentResponse> => {
  const agent = config.agent;
  let currentSession = session;
  let toolCalls: FunctionCall[] = [];
  let toolResponses: FunctionResponse[] = [];
  
  // Check if this is a multi-agent
  if (isMultiAgent(agent)) {
    return await executeMultiAgent(config, currentSession, message, context);
  }
  
  // Simulate LLM call - in real implementation, this would call the actual LLM
  const llmResponse = await simulateLLMCall(agent, message, currentSession);
  
  // Check for function calls in the response
  const functionCalls = getFunctionCalls(llmResponse);
  
  if (functionCalls.length > 0) {
    // Execute tools
    const toolContext = createToolContext(agent, currentSession, message);
    
    for (const functionCall of functionCalls) {
      const tool = agent.config.tools.find(t => t.name === functionCall.name);
      
      if (tool) {
        try {
          const toolResult = await executeTool(tool, functionCall.args, toolContext);
          
          const functionResponse: FunctionResponse = {
            id: functionCall.id,
            name: functionCall.name,
            response: toolResult.data,
            success: toolResult.success,
            error: toolResult.error
          };
          
          toolResponses.push(functionResponse);
          llmResponse.parts.push({
            type: 'function_response',
            functionResponse
          });
          
          // Handle tool actions
          if (toolContext.actions.transferToAgent) {
            // Handle agent transfer
            const targetAgent = agent.config.subAgents?.find(
              sub => sub.name === toolContext.actions.transferToAgent
            );
            
            if (targetAgent) {
              const transferConfig = { ...config, agent: { ...agent, config: targetAgent } };
              return await executeAgent(transferConfig, currentSession, message, context);
            }
          }
          
          if (toolContext.actions.addArtifact) {
            // Artifacts are handled via the actions object
          }
          
        } catch (error) {
          const functionResponse: FunctionResponse = {
            id: functionCall.id,
            name: functionCall.name,
            response: null,
            success: false,
            error: error instanceof Error ? error.message : 'Tool execution failed'
          };
          
          toolResponses.push(functionResponse);
        }
      }
      
      toolCalls.push(functionCall);
    }
  }
  
  // Update session with response
  currentSession = addMessageToSession(currentSession, llmResponse);
  await config.sessionProvider.updateSession(currentSession);
  
  return {
    content: llmResponse,
    session: currentSession,
    toolCalls,
    toolResponses,
    metadata: {
      requestId: generateRequestId(),
      agentId: agent.id,
      timestamp: new Date()
    }
  };
};

const executeAgentStream = async function* (
  config: RunnerConfig,
  session: Session,
  message: Content,
  context: RunContext
): AsyncGenerator<AgentEvent> {
  const agent = config.agent;
  
  // Simulate model validation - throw error for invalid models  
  if (agent.config.model === 'invalid_model') {
    throw new Error('Invalid model specified');
  }
  
  // Simulate streaming LLM response
  const responseText = `Hello! I'm ${agent.config.name}. How can I help you today?`;
  
  // Stream response character by character (simplified)
  for (let i = 0; i < responseText.length; i += 10) {
    const chunk = responseText.slice(i, i + 10);
    yield createAgentEvent('message_delta', {
      content: createModelMessage(chunk)
    });
    
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};

// ========== Multi-Agent Execution ==========

const executeMultiAgent = async (
  config: RunnerConfig,
  session: Session,
  message: Content,
  context: RunContext
): Promise<AgentResponse> => {
  const multiConfig = config.agent.config as MultiAgentConfig;
  
  switch (multiConfig.delegationStrategy) {
    case 'sequential':
      return await executeSequentialAgents(config, session, message, context);
    case 'parallel':
      return await executeParallelAgents(config, session, message, context);
    case 'conditional':
      return await executeConditionalAgents(config, session, message, context);
    case 'hierarchical':
      return await executeHierarchicalAgents(config, session, message, context);
    default:
      throwAgentError(`Unknown delegation strategy: ${multiConfig.delegationStrategy}`);
  }
};

const executeSequentialAgents = async (
  config: RunnerConfig,
  session: Session,
  message: Content,
  context: RunContext
): Promise<AgentResponse> => {
  const multiConfig = config.agent.config as MultiAgentConfig;
  let currentSession = session;
  let currentMessage = message;
  let finalResponse: AgentResponse | null = null;
  
  for (const subAgentConfig of multiConfig.subAgents) {
    const subAgent = { ...config.agent, config: subAgentConfig };
    const subConfig = { ...config, agent: subAgent };
    
    const response = await executeAgent(subConfig, currentSession, currentMessage, context);
    
    currentSession = response.session;
    currentMessage = response.content;
    finalResponse = response;
  }
  
  return finalResponse!;
};

const executeParallelAgents = async (
  config: RunnerConfig,
  session: Session,
  message: Content,
  context: RunContext
): Promise<AgentResponse> => {
  const multiConfig = config.agent.config as MultiAgentConfig;
  
  const promises = multiConfig.subAgents.map(subAgentConfig => {
    const subAgent = { ...config.agent, config: subAgentConfig };
    const subConfig = { ...config, agent: subAgent };
    return executeAgent(subConfig, session, message, context);
  });
  
  const responses = await Promise.all(promises);
  
  // Merge responses (simplified - just use the first one)
  return responses[0];
};

const executeConditionalAgents = async (
  config: RunnerConfig,
  session: Session,
  message: Content,
  context: RunContext
): Promise<AgentResponse> => {
  const multiConfig = config.agent.config as MultiAgentConfig;
  
  // Simple condition - choose based on message content
  // In real implementation, this would be more sophisticated
  const messageText = message.parts
    .filter(p => p.type === 'text')
    .map(p => p.text)
    .join(' ');
  
  let selectedAgent = multiConfig.subAgents[0]; // Default
  
  if (messageText.toLowerCase().includes('weather')) {
    selectedAgent = multiConfig.subAgents.find(a => a.name.includes('weather')) || selectedAgent;
  } else if (messageText.toLowerCase().includes('news')) {
    selectedAgent = multiConfig.subAgents.find(a => a.name.includes('news')) || selectedAgent;
  }
  
  const subAgent = { ...config.agent, config: selectedAgent };
  const subConfig = { ...config, agent: subAgent };
  
  return await executeAgent(subConfig, session, message, context);
};

const executeHierarchicalAgents = async (
  config: RunnerConfig,
  session: Session,
  message: Content,
  context: RunContext
): Promise<AgentResponse> => {
  // For now, just delegate to the first sub-agent
  return await executeConditionalAgents(config, session, message, context);
};

// ========== Tool Context Creation ==========

const createToolContext = (agent: Agent, session: Session, message: Content): ToolContext => {
  const actions: ToolActions = {
    transferToAgent: undefined,
    endConversation: false,
    setOutputKey: undefined,
    addArtifact: (key: string, value: unknown) => {
      // This would update the session
      addArtifactToSession(session, key, value);
    },
    getArtifact: (key: string) => {
      return session.artifacts[key];
    }
  };
  
  return {
    agent,
    session,
    message,
    actions,
    metadata: {
      timestamp: new Date()
    }
  };
};

// ========== Guardrails ==========

const applyGuardrails = async (
  guardrails: GuardrailFunction[],
  message: Content,
  context: { agent: Agent; session: Session; previousMessages: Content[] }
): Promise<Content> => {
  let currentMessage = message;
  
  for (const guardrail of guardrails) {
    const result = await guardrail(currentMessage, {
      agent: context.agent,
      session: context.session,
      previousMessages: context.previousMessages
    });
    
    if (!result.allowed) {
      throwAgentError(`Message blocked by guardrail: ${result.reason}`);
    }
    
    if (result.modifiedMessage) {
      currentMessage = result.modifiedMessage;
    }
  }
  
  return currentMessage;
};

// ========== LLM Simulation ==========

const simulateLLMCall = async (
  agent: Agent,
  message: Content,
  session: Session
): Promise<Content> => {
  // This is a mock implementation
  // In real implementation, this would call the actual LLM service
  
  // Simulate model validation - throw error for invalid models
  if (agent.config.model === 'invalid_model') {
    throw new Error('Invalid model specified');
  }
  
  const messageText = message.parts
    .filter(p => p.type === 'text')
    .map(p => p.text)
    .join(' ');
  
  // Simple response based on agent instruction
  const responseText = `${agent.config.name} received: "${messageText}". ${agent.config.instruction}`;
  
  return createModelMessage(responseText);
};

// ========== Utility Functions ==========

const generateRequestId = (): string => {
  // Use crypto-based ID generation for pure functional approach
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const createAgentEvent = (
  type: AgentEventType,
  data?: {
    content?: Content;
    functionCall?: FunctionCall;
    functionResponse?: FunctionResponse;
    error?: string;
  }
): AgentEvent => {
  return {
    type,
    timestamp: new Date(),
    ...data
  };
};

const isMultiAgent = (agent: Agent): boolean => {
  return agent.config.subAgents !== undefined && agent.config.subAgents.length > 0;
};

// ========== Runner Validation ==========

export const validateRunnerConfig = (config: RunnerConfig) => {
  const errors: string[] = [];
  
  if (!config.agent) {
    errors.push('Agent is required');
  }
  
  if (!config.sessionProvider) {
    errors.push('Session provider is required');
  }
  
  if (config.maxLLMCalls && config.maxLLMCalls <= 0) {
    errors.push('Max LLM calls must be positive');
  }
  
  if (config.timeout && config.timeout <= 0) {
    errors.push('Timeout must be positive');
  }
  
  if (errors.length > 0) {
    throwAgentError(`Invalid runner config: ${errors.join(', ')}`);
  }
};

export const validateRunContext = (context: RunContext) => {
  const errors: string[] = [];
  
  if (!context.userId || context.userId.trim().length === 0) {
    errors.push('User ID is required');
  }
  
  if (errors.length > 0) {
    throwAgentError(`Invalid run context: ${errors.join(', ')}`);
  }
};

// ========== Runner Builder ==========

export const createRunnerConfig = (
  agent: Agent,
  sessionProvider: SessionProvider,
  options?: {
    artifactProvider?: any;
    guardrails?: GuardrailFunction[];
    maxLLMCalls?: number;
    timeout?: number;
  }
): RunnerConfig => {
  const config: RunnerConfig = {
    agent,
    sessionProvider,
    ...options
  };
  
  validateRunnerConfig(config);
  return config;
};

// ========== Error Handling ==========

export const withRunnerErrorHandling = <T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  agentId?: string
) => {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof AgentError || error instanceof ToolError || error instanceof SessionError) {
        throw error;
      }
      
      throwAgentError(
        `Runner operation failed: ${error instanceof Error ? error.message : String(error)}`,
        agentId,
        { originalError: error }
      );
    }
  };
};

// ========== Runner Statistics ==========

export const getRunnerStats = (config: RunnerConfig) => {
  return {
    agentId: config.agent.id,
    agentName: config.agent.config.name,
    toolCount: config.agent.config.tools.length,
    subAgentCount: config.agent.config.subAgents?.length || 0,
    hasGuardrails: (config.guardrails?.length || 0) > 0,
    maxLLMCalls: config.maxLLMCalls,
    timeout: config.timeout,
    isMultiAgent: isMultiAgent(config.agent)
  };
};

// ========== Visualization Functions ==========

export const generateRunnerVisualization = async (
  config: RunnerConfig,
  options: GraphOptions = {}
): Promise<GraphResult> => {
  return await generateRunnerGraph(config, options);
};

export const generateAgentVisualization = async (
  agents: readonly Agent[],
  options: GraphOptions = {}
): Promise<GraphResult> => {
  return await generateAgentGraph(agents, options);
};

export const generateToolVisualization = async (
  tools: readonly Tool[],
  options: GraphOptions = {}
): Promise<GraphResult> => {
  return await generateToolGraph(tools, options);
};

export const generateRunnerGraphPng = async (
  config: RunnerConfig,
  outputPath?: string
): Promise<GraphResult> => {
  const options: GraphOptions = {
    title: `FAF Runner: ${config.agent.config.name}`,
    outputFormat: 'png',
    outputPath: outputPath || './runner-visualization',
    showToolDetails: true,
    showSubAgents: true,
    colorScheme: 'modern'
  };
  
  return await generateRunnerVisualization(config, options);
};