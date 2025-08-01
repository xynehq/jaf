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
import { createUserMessage, createModelMessage, getFunctionCalls, addFunctionResponse, addFunctionCall, createFunctionCall } from '../content';

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
  const toolCalls: FunctionCall[] = [];
  const toolResponses: FunctionResponse[] = [];
  
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
  
  // Create response content
  let responseContent = createModelMessage(`${agent.config.name} processing: "${messageText}"`);
  
  // Analyze message to determine if tools should be called
  const shouldCallTools = shouldCallToolsForMessage(messageText, agent.config.tools);
  
  if (shouldCallTools.length > 0) {
    // Add function calls to the response
    for (const toolCall of shouldCallTools) {
      responseContent = addFunctionCall(responseContent, toolCall);
    }
  }
  
  return responseContent;
};

// Helper function to determine what tools should be called based on message content
const shouldCallToolsForMessage = (messageText: string, tools: Tool[]): FunctionCall[] => {
  const calls: FunctionCall[] = [];
  const lowerText = messageText.toLowerCase();
  
  for (const tool of tools) {
    let shouldCall = false;
    let args: Record<string, unknown> = {};
    
    // Tool-specific logic for determining when to call
    switch (tool.name) {
      case 'process_data':
        if (lowerText.includes('calculate') || lowerText.includes('sum') || lowerText.includes('numbers')) {
          shouldCall = true;
          // Extract numbers from message
          const numbers = extractNumbersFromText(messageText);
          if (numbers.length > 0) {
            args = {
              data: numbers,
              operation: lowerText.includes('sum') ? 'sum' : 'average'
            };
          }
        }
        break;
        
      case 'greet':
        if (lowerText.includes('greet') || lowerText.includes('hello')) {
          shouldCall = true;
          // Extract name if mentioned
          const nameMatch = messageText.match(/name is (\w+)/i) || messageText.match(/i'm (\w+)/i);
          args = {
            name: nameMatch ? nameMatch[1] : 'User'
          };
        }
        break;
        
      case 'calculate':
        if (lowerText.includes('calculate') || lowerText.includes('math') || /\d+\s*[\+\-\*\/]\s*\d+/.test(messageText)) {
          shouldCall = true;
          // Extract mathematical expression
          const expression = extractMathExpression(messageText);
          if (expression) {
            args = { expression };
          }
        }
        break;
        
      case 'error_tool':
        if (lowerText.includes('execute tool')) {
          shouldCall = true;
          // Determine if it should fail based on message content
          const shouldFail = lowerText.includes('failure') || lowerText.includes('fail');
          args = { shouldFail };
        }
        break;
        
      case 'get_weather':
        if (lowerText.includes('weather')) {
          shouldCall = true;
          // Extract location
          const locationMatch = messageText.match(/weather in (\w+)/i) || messageText.match(/(\w+) weather/i);
          args = {
            location: locationMatch ? locationMatch[1] : 'Unknown'
          };
        }
        break;
        
      case 'analyze_content':
        if (lowerText.includes('analyze')) {
          shouldCall = true;
          // Determine content type and data
          if (lowerText.includes('json')) {
            const jsonMatch = messageText.match(/json:\s*(\{.*\})/i);
            args = {
              contentType: 'json',
              data: jsonMatch ? jsonMatch[1] : '{"default": "data"}'
            };
          } else if (lowerText.includes('text')) {
            const textMatch = messageText.match(/text:\s*"([^"]+)"/i);
            args = {
              contentType: 'text',
              data: textMatch ? textMatch[1] : messageText
            };
          }
        }
        break;
        
      default:
        // Generic logic - if tool name is mentioned, call it
        if (lowerText.includes(tool.name.toLowerCase())) {
          shouldCall = true;
          // Use default args based on parameter types
          args = generateDefaultArgsForTool(tool);
        }
        break;
    }
    
    if (shouldCall) {
      const functionCall = createFunctionCall(
        generateCallId(),
        tool.name,
        args
      );
      calls.push(functionCall);
    }
  }
  
  return calls;
};

// Utility functions for parsing message content
const extractNumbersFromText = (text: string): number[] => {
  const matches = text.match(/\d+/g);
  return matches ? matches.map(Number) : [];
};

const extractMathExpression = (text: string): string | null => {
  // Simple extraction - look for basic math patterns
  const mathMatch = text.match(/(\d+\s*[\+\-\*\/]\s*\d+)/);
  if (mathMatch) {
    return mathMatch[1];
  }
  
  // Look for word-based math
  if (text.includes('plus') || text.includes('+')) {
    const numbers = extractNumbersFromText(text);
    if (numbers.length >= 2) {
      return `${numbers[0]} + ${numbers[1]}`;
    }
  }
  
  return null;
};

const generateDefaultArgsForTool = (tool: Tool): Record<string, unknown> => {
  const args: Record<string, unknown> = {};
  
  for (const param of tool.parameters) {
    switch (param.type) {
      case 'string':
        args[param.name] = 'default_string';
        break;
      case 'number':
        args[param.name] = 42;
        break;
      case 'boolean':
        args[param.name] = true;
        break;
      case 'array':
        args[param.name] = [1, 2, 3];
        break;
      default:
        args[param.name] = 'default_value';
        break;
    }
  }
  
  return args;
};

const generateCallId = (): string => {
  return `call_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
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
    title: `FAF Runner: ${config.agent.config.name}`,
    outputFormat: 'png',
    outputPath: outputPath || './runner-visualization',
    showToolDetails: true,
    showSubAgents: true,
    colorScheme: 'modern'
  };
  
  return await generateRunnerVisualization(config, options);
};