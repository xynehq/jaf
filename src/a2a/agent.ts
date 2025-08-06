/**
 * Pure functional A2A agent creation utilities
 * No classes, only pure functions and immutable data
 */

import { z } from 'zod';
import type { A2AAgent, A2AAgentTool, ToolContext, A2AToolResult, AgentState, StreamEvent } from './types.js';
import { run } from '../core/engine.js';
import { createRunId, createTraceId, type RunState, type Message, type Agent, type Tool, type RunConfig } from '../core/types.js';

// Pure function to create A2A compatible agent
export const createA2AAgent = (config: {
  readonly name: string;
  readonly description: string;
  readonly instruction: string;
  readonly tools: readonly A2AAgentTool[];
  readonly supportedContentTypes?: readonly string[];
}): A2AAgent => ({
  name: config.name,
  description: config.description,
  supportedContentTypes: config.supportedContentTypes || ['text/plain', 'application/json'],
  instruction: config.instruction,
  tools: config.tools
});

// Pure function to create A2A tool
export const createA2ATool = <T>(config: {
  readonly name: string;
  readonly description: string;
  readonly parameters: z.ZodType<T>;
  readonly execute: (args: T, context?: ToolContext) => Promise<any | A2AToolResult>;
}): A2AAgentTool => ({
  name: config.name,
  description: config.description,
  parameters: config.parameters,
  execute: config.execute
});

// Pure function to get processing message
export const getProcessingMessage = (agentName: string) => 
  `${agentName} is processing your request...`;

// Pure function to create initial agent state
export const createInitialAgentState = (sessionId: string): AgentState => ({
  sessionId,
  messages: [],
  context: {},
  artifacts: [],
  timestamp: new Date().toISOString()
});

// Pure function to add message to state
export const addMessageToState = (state: AgentState, message: any): AgentState => ({
  ...state,
  messages: [...state.messages, message],
  timestamp: new Date().toISOString()
});

// Pure function to update state from run result
export const updateStateFromRunResult = (state: AgentState, outcome: any): AgentState => ({
  ...state,
  artifacts: outcome.artifacts ? [...state.artifacts, ...outcome.artifacts] : state.artifacts,
  timestamp: new Date().toISOString()
});

// Pure function to create user message
export const createUserMessage = (text: string): Message => ({
  role: 'user',
  content: text
});

// Pure function to transform A2A agent to JAF agent
export const transformA2AAgentToJAF = (a2aAgent: A2AAgent): Agent<any, string> => ({
  name: a2aAgent.name,
  instructions: () => a2aAgent.instruction,
  tools: a2aAgent.tools.map(transformA2AToolToJAF),
  outputCodec: z.string()
});

// Pure function to transform A2A tool to JAF tool
export const transformA2AToolToJAF = (a2aTool: A2AAgentTool): Tool<any, any> => ({
  schema: {
    name: a2aTool.name,
    description: a2aTool.description,
    parameters: a2aTool.parameters
  },
  execute: async (args: any, context: any) => {
    const toolContext: ToolContext = {
      actions: {
        requiresInput: false,
        skipSummarization: false,
        escalate: false
      },
      metadata: context || {}
    };
    
    const result = await a2aTool.execute(args, toolContext);
    
    // Handle ToolResult format
    if (typeof result === 'object' && result !== null && 'result' in result) {
      return result.result;
    }
    
    return result;
  }
});

// Pure function to create run configuration for A2A agent
export const createRunConfigForA2AAgent = (
  a2aAgent: A2AAgent,
  modelProvider: any
): RunConfig<any> => {
  const jafAgent = transformA2AAgentToJAF(a2aAgent);
  
  return {
    agentRegistry: new Map([[a2aAgent.name, jafAgent]]),
    modelProvider,
    maxTurns: 10,
    onEvent: (event) => {
      console.log(`[A2A:${a2aAgent.name}] ${event.type}:`, event.data);
    }
  };
};

// Pure function to transform agent state to JAF run state
export const transformToRunState = (
  state: AgentState, 
  agentName: string,
  context: any = {}
): RunState<any> => ({
  runId: createRunId(`run_${Date.now()}`),
  traceId: createTraceId(`trace_${Date.now()}`),
  messages: state.messages,
  currentAgentName: agentName,
  context,
  turnCount: 0
});

// Pure async generator function to process agent query
export const processAgentQuery = async function* (
  agent: A2AAgent,
  query: string,
  state: AgentState,
  modelProvider: any
): AsyncGenerator<StreamEvent, void, unknown> {
  // Transform query to JAF message format
  const userMessage = createUserMessage(query);
  const newState = addMessageToState(state, userMessage);
  
  // Create JAF configuration
  const runConfig = createRunConfigForA2AAgent(agent, modelProvider);
  const runState = transformToRunState(newState, agent.name);
  
  try {
    // Execute JAF engine (pure function)
    const result = await run(runState, runConfig);
    
    if (result.outcome.status === 'completed') {
      const finalState = updateStateFromRunResult(newState, result.outcome);
      yield {
        isTaskComplete: true,
        content: result.outcome.output,
        newState: finalState,
        timestamp: new Date().toISOString()
      };
    } else {
      const finalState = updateStateFromRunResult(newState, result.outcome);
      yield {
        isTaskComplete: true,
        content: `Error: ${JSON.stringify(result.outcome.error)}`,
        newState: finalState,
        timestamp: new Date().toISOString()
      };
    }
  } catch (error) {
    yield {
      isTaskComplete: true,
      content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      newState,
      timestamp: new Date().toISOString()
    };
  }
};

// Pure function to extract text from A2A message
export const extractTextFromA2AMessage = (message: any): string => {
  if (!message?.parts) return '';
  
  return message.parts
    .filter((part: any) => part.kind === 'text')
    .map((part: any) => part.text)
    .join('\n');
};

// Pure function to create A2A text message
export const createA2ATextMessage = (
  text: string, 
  contextId: string, 
  taskId?: string
): any => ({
  role: 'agent' as const,
  parts: [{ kind: 'text' as const, text }],
  messageId: `msg_${Date.now()}`,
  contextId,
  taskId,
  kind: 'message' as const,
  timestamp: new Date().toISOString()
});

// Pure function to create A2A data message
export const createA2ADataMessage = (
  data: Record<string, any>, 
  contextId: string, 
  taskId?: string
): any => ({
  role: 'agent' as const,
  parts: [{ kind: 'data' as const, data }],
  messageId: `msg_${Date.now()}`,
  contextId,
  taskId,
  kind: 'message' as const,
  timestamp: new Date().toISOString()
});

// Pure function to create A2A task
export const createA2ATask = (
  message: any,
  contextId?: string
): any => ({
  id: `task_${Date.now()}`,
  contextId: contextId || `ctx_${Date.now()}`,
  status: {
    state: 'submitted' as const,
    timestamp: new Date().toISOString()
  },
  history: [message],
  artifacts: [],
  kind: 'task' as const
});

// Pure function to update A2A task status
export const updateA2ATaskStatus = (
  task: any,
  state: any,
  message?: any
): any => ({
  ...task,
  status: {
    state,
    message,
    timestamp: new Date().toISOString()
  }
});

// Pure function to add artifact to A2A task
export const addArtifactToA2ATask = (
  task: any,
  parts: readonly any[],
  name: string
): any => ({
  ...task,
  artifacts: [
    ...task.artifacts,
    {
      artifactId: `artifact_${Date.now()}`,
      name,
      parts,
      timestamp: new Date().toISOString()
    }
  ]
});

// Pure function to complete A2A task
export const completeA2ATask = (task: any, result?: any): any => ({
  ...task,
  status: {
    state: 'completed' as const,
    timestamp: new Date().toISOString()
  },
  ...(result && {
    artifacts: [
      ...task.artifacts,
      {
        artifactId: `result_${Date.now()}`,
        name: 'final_result',
        parts: [{ kind: 'text' as const, text: String(result) }],
        timestamp: new Date().toISOString()
      }
    ]
  })
});