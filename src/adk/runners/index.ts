/**
 * JAF ADK Layer - Runner System
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
  Part,
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
  AgentConfig,
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
import { createModelMessage, getFunctionCalls, createUserMessage } from '../content';
import { createAdkLLMService } from '../providers/llm-service.js';
import { createAdkLLMConfigFromEnvironment, createAdkLLMServiceConfig } from '../config/llm-config.js';

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
    
    // Apply guardrails before adding to session
    const guardedMessage = await applyGuardrails(
      config.guardrails || [],
      message,
      { agent: config.agent, session, previousMessages: session.messages }
    );
    
    // Add guarded message to session
    const updatedSession = addMessageToSession(session, guardedMessage);
    
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
  
  // This should never be reached due to throwAgentError throwing
  throw new Error('Unreachable code');
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
    
    // Apply guardrails before adding to session
    const guardedMessage = await applyGuardrails(
      config.guardrails || [],
      message,
      { agent: config.agent, session, previousMessages: session.messages }
    );
    
    // Add guarded message to session
    const updatedSession = addMessageToSession(session, guardedMessage);
    
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
  const toolCalls: FunctionCall[] = [];
  const toolResponses: FunctionResponse[] = [];
  
  // Check if this is a multi-agent
  if (isMultiAgent(agent)) {
    return await executeMultiAgent(config, currentSession, message, context);
  }
  
  // Call real LLM service
  const llmResponse = await callRealLLM(agent, message, currentSession);
  
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
    
    // If tools were executed, make a second LLM call to get final response with tool results
    if (toolResponses.length > 0) {
      // Update session with the tool calls and responses first
      currentSession = addMessageToSession(currentSession, llmResponse);
      
      // Create tool response messages for each tool call (required by OpenAI format)
      for (const toolResponse of toolResponses) {
        const toolResultMessage: Content = {
          role: 'tool' as any, // Tool responses must have role 'tool' for OpenAI API
          parts: [{
            type: 'function_response',
            functionResponse: toolResponse
          }],
          metadata: {}
        };
        
        // Add each tool response message to session
        currentSession = addMessageToSession(currentSession, toolResultMessage);
      }
      
      // Create a user message asking the LLM to provide a final response
      const followUpMessage = createUserMessage('Please provide a final response based on the tool results.');
      
      // Make second LLM call to get final response
      const finalResponse = await callRealLLM(agent, followUpMessage, currentSession);
      
      // Update session with final response
      currentSession = addMessageToSession(currentSession, finalResponse);
      await config.sessionProvider.updateSession(currentSession);
      
      // Return the final response that includes tool results
      return {
        content: finalResponse,
        session: currentSession,
        toolCalls,
        toolResponses,
        metadata: {
          requestId: generateRequestId(),
          agentId: agent.id,
          llmCalls: 2, // Two LLM calls made
          timestamp: new Date()
        }
      };
    }
  }
  
  // Update session with response (no tools were called)
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
      llmCalls: 1, // One LLM call made
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
  
  try {
    // Create LLM service instance with environment-based configuration
    const llmConfig = createAdkLLMConfigFromEnvironment();
    const llmService = createAdkLLMService(createAdkLLMServiceConfig(llmConfig));
    
    // Call real streaming LLM
    const streamGenerator = llmService.generateStreamingResponse(agent, session, message, {
      modelOverride: typeof agent.config.model === 'string' ? agent.config.model : undefined,
      temperature: 0.7,
      maxTokens: 2000
    });
    
    // Stream real LLM responses
    for await (const chunk of streamGenerator) {
      if (chunk.isDone) {
        break;
      }
      
      if (chunk.delta) {
        yield createAgentEvent('message_delta', {
          content: createModelMessage(chunk.delta)
        });
      }
      
      if (chunk.functionCall) {
        yield createAgentEvent('function_call_start', {
          functionCall: chunk.functionCall as FunctionCall
        });
      }
    }
  } catch (error) {
    console.error('[ADK:STREAM] Real streaming failed:', error);
    
    // Fallback to error message
    yield createAgentEvent('error', {
      error: `Streaming error: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
};

// ========== Multi-Agent Helper Functions ==========

const mergeParallelResponses = (
  responses: AgentResponse[],
  config: MultiAgentConfig
): AgentResponse => {
  if (responses.length === 0) {
    throwAgentError('No responses to merge from parallel execution');
  }
  
  // Merge all response content
  const mergedParts: Part[] = [];
  const mergedArtifacts: Record<string, unknown> = {};
  
  responses.forEach((response, index) => {
    // Add agent identifier to each response part
    const agentName = config.subAgents[index]?.name || `agent_${index}`;
    
    response.content.parts.forEach(part => {
      if (part.type === 'text') {
        mergedParts.push({
          type: 'text',
          text: `[${agentName}]: ${part.text}`
        });
      } else {
        mergedParts.push(part);
      }
    });
    
    // Merge artifacts
    Object.entries(response.session.artifacts).forEach(([key, value]) => {
      mergedArtifacts[`${agentName}_${key}`] = value;
    });
    
    // Merge metrics if available
    // Note: metrics field is not part of AgentResponse type yet
  });
  
  // Use the first response as base and merge content
  const baseResponse = responses[0];
  return {
    ...baseResponse,
    content: {
      role: 'model' as const,
      parts: mergedParts
    },
    session: {
      ...baseResponse.session,
      artifacts: mergedArtifacts
    }
  };
};

const selectBestAgent = (
  subAgents: AgentConfig[],
  message: Content,
  context: RunContext
): AgentConfig => {
  const messageText = message.parts
    .filter(p => p.type === 'text')
    .map(p => p.text)
    .join(' ')
    .toLowerCase();
  
  // Score each agent based on relevance
  const scores = subAgents.map((agent: AgentConfig) => {
    let score = 0;
    const agentNameLower = agent.name.toLowerCase();
    const instructionLower = agent.instruction.toLowerCase();
    
    // Check for keyword matches in agent name and instruction
    const keywords = extractKeywords(messageText);
    keywords.forEach(keyword => {
      if (agentNameLower.includes(keyword)) score += 3;
      if (instructionLower.includes(keyword)) score += 2;
    });
    
    // Check for tool relevance
    agent.tools.forEach((tool: Tool) => {
      const toolNameLower = tool.name.toLowerCase();
      const toolDescLower = tool.description.toLowerCase();
      keywords.forEach(keyword => {
        if (toolNameLower.includes(keyword)) score += 2;
        if (toolDescLower.includes(keyword)) score += 1;
      });
    });
    
    return { agent, score };
  });
  
  // Sort by score and return the best match
  scores.sort((a, b) => b.score - a.score);
  
  // If no clear winner, use the first agent
  if (scores[0].score === 0) {
    return subAgents[0];
  }
  
  return scores[0].agent;
};

const extractKeywords = (text: string): string[] => {
  // Extract meaningful keywords from the message
  const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'what', 'how', 'when', 'where', 'why', 'who']);
  
  const words = text
    .split(/\s+/)
    .map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 2 && !commonWords.has(w));
  
  return [...new Set(words)];
};

const executeWithCoordinationRules = async (
  config: RunnerConfig,
  session: Session,
  message: Content,
  context: RunContext,
  multiConfig: MultiAgentConfig
): Promise<AgentResponse> => {
  // Evaluate coordination rules
  for (const rule of multiConfig.coordinationRules || []) {
    if (rule.condition(message, context)) {
      switch (rule.action) {
        case 'delegate': {
          // Delegate to specific agent(s)
          const targetAgent = rule.targetAgents?.[0];
          if (targetAgent) {
            const agentConfig = multiConfig.subAgents.find(a => a.name === targetAgent);
            if (agentConfig) {
              const subAgent = { ...config.agent, config: agentConfig };
              const subConfig = { ...config, agent: subAgent };
              return await executeAgent(subConfig, session, message, context);
            }
          }
          break;
        }
        
        case 'parallel': {
          // Execute specified agents in parallel
          const targetConfigs = rule.targetAgents
            ? multiConfig.subAgents.filter(a => rule.targetAgents?.includes(a.name))
            : multiConfig.subAgents;
          
          const promises = targetConfigs.map(subAgentConfig => {
            const subAgent = { ...config.agent, config: subAgentConfig };
            const subConfig = { ...config, agent: subAgent };
            return executeAgent(subConfig, session, message, context);
          });
          
          const responses = await Promise.all(promises);
          return mergeParallelResponses(responses, multiConfig);
        }
        
        case 'sequential': {
          // Execute specified agents sequentially
          const targetConfigs = rule.targetAgents
            ? multiConfig.subAgents.filter(a => rule.targetAgents?.includes(a.name))
            : multiConfig.subAgents;
          
          let currentSession = session;
          let currentMessage = message;
          let finalResponse: AgentResponse | null = null;
          
          for (const subAgentConfig of targetConfigs) {
            const subAgent = { ...config.agent, config: subAgentConfig };
            const subConfig = { ...config, agent: subAgent };
            
            const response = await executeAgent(subConfig, currentSession, currentMessage, context);
            
            currentSession = response.session;
            currentMessage = response.content;
            finalResponse = response;
          }
          
          return finalResponse!;
        }
      }
    }
  }
  
  // If no rules match, fall back to intelligent selection
  const selectedAgent = selectBestAgent(multiConfig.subAgents, message, context);
  const subAgent = { ...config.agent, config: selectedAgent };
  const subConfig = { ...config, agent: subAgent };
  
  return await executeAgent(subConfig, session, message, context);
};

const extractDelegationDecision = (response: AgentResponse): { targetAgent?: string } | null => {
  // Try to extract delegation decision from response
  const responseText = response.content.parts
    .filter(p => p.type === 'text')
    .map(p => p.text)
    .join(' ');
  
  // Look for delegation patterns
  const delegatePattern = /delegate to (\w+)|transfer to (\w+)|handoff to (\w+)/i;
  const match = responseText.match(delegatePattern);
  
  if (match) {
    const targetAgent = match[1] || match[2] || match[3];
    return { targetAgent };
  }
  
  // Check for tool calls that might indicate delegation
  const toolCalls = response.content.parts.filter(p => p.type === 'function_call');
  for (const toolCall of toolCalls) {
    if (toolCall.type === 'function_call' && toolCall.functionCall) {
      const funcName = toolCall.functionCall.name;
      if (funcName === 'delegate' || funcName === 'handoff') {
        return { targetAgent: (toolCall.functionCall.args as any)?.targetAgent };
      }
    }
  }
  
  return null;
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
  
  // This should never be reached due to throwAgentError throwing
  throw new Error('Unreachable code');
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
  
  // Merge parallel responses intelligently
  return mergeParallelResponses(responses, multiConfig);
};

const executeConditionalAgents = async (
  config: RunnerConfig,
  session: Session,
  message: Content,
  context: RunContext
): Promise<AgentResponse> => {
  const multiConfig = config.agent.config as MultiAgentConfig;
  
  // Use coordination rules if provided
  if (multiConfig.coordinationRules && multiConfig.coordinationRules.length > 0) {
    return await executeWithCoordinationRules(config, session, message, context, multiConfig);
  }
  
  // Otherwise use intelligent agent selection
  const selectedAgent = selectBestAgent(multiConfig.subAgents, message, context);
  
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
  const multiConfig = config.agent.config as MultiAgentConfig;
  
  // Execute coordinator agent first
  const coordinatorAgent = multiConfig.subAgents[0];
  const coordinatorSubAgent = { ...config.agent, config: coordinatorAgent };
  const coordinatorConfig = { ...config, agent: coordinatorSubAgent };
  
  const coordinatorResponse = await executeAgent(coordinatorConfig, session, message, context);
  
  // Extract delegation decision from coordinator response
  const delegationDecision = extractDelegationDecision(coordinatorResponse);
  
  if (delegationDecision && delegationDecision.targetAgent) {
    // Find and execute the target agent
    const targetAgentConfig = multiConfig.subAgents.find(
      a => a.name === delegationDecision.targetAgent
    );
    
    if (targetAgentConfig) {
      const targetAgent = { ...config.agent, config: targetAgentConfig };
      const targetConfig = { ...config, agent: targetAgent };
      
      return await executeAgent(
        targetConfig,
        coordinatorResponse.session,
        coordinatorResponse.content,
        context
      );
    }
  }
  
  // If no delegation, return coordinator response
  return coordinatorResponse;
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

// ========== Real LLM Integration ==========

const callRealLLM = async (
  agent: Agent,
  message: Content,
  session: Session
): Promise<Content> => {
  try {
    // Create LLM service instance with environment-based configuration
    const llmConfig = createAdkLLMConfigFromEnvironment();
    const llmService = createAdkLLMService(createAdkLLMServiceConfig(llmConfig));
    
    // Call real LLM
    const response = await llmService.generateResponse(agent, session, message, {
      modelOverride: typeof agent.config.model === 'string' ? agent.config.model : undefined,
      temperature: 0.7,
      maxTokens: 2000
    });
    
    return response.content;
  } catch (error) {
    console.error('[ADK:LLM] Real LLM call failed:', error);
    
    // Check if this is a critical error that should propagate
    if (error instanceof Error && error.message.includes('Invalid model')) {
      throw error;
    }
    
    // Fallback to a simple error response for other errors
    return createModelMessage(`I apologize, but I'm experiencing technical difficulties. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// ========== Mock Tool Detection Logic Removed ==========
// This mock logic has been removed since real LLM now handles tool calling decisions

const generateCallId = (): string => {
  return `call_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
};

// ========== Utility Functions ==========

const generateRequestId = (): string => {
  // Use crypto-based ID generation for pure functional approach
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
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
      if (error instanceof Error && 
          (error.name === 'AgentError' || error.name === 'ToolError' || error.name === 'SessionError')) {
        throw error;
      }
      
      throwAgentError(
        `Runner operation failed: ${error instanceof Error ? error.message : String(error)}`,
        agentId,
        { originalError: error }
      );
      
      // This should never be reached due to throwAgentError throwing
      throw new Error('Unreachable code');
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
    title: `JAF Runner: ${config.agent.config.name}`,
    outputFormat: 'png',
    outputPath: outputPath || './runner-visualization',
    showToolDetails: true,
    showSubAgents: true,
    colorScheme: 'modern'
  };
  
  return await generateRunnerVisualization(config, options);
};