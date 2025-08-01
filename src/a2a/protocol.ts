/**
 * Pure functional JSON-RPC protocol handlers for A2A
 * All handlers are pure functions with no side effects
 */

import type {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
  SendMessageRequest,
  SendStreamingMessageRequest,
  GetTaskRequest,
  A2AAgent,
  A2ATask,
  A2AMessage,
  A2AError,
  A2AStreamEvent
} from './types.js';
import { A2AErrorCodes } from './types.js';
import { executeA2AAgent, executeA2AAgentWithStreaming } from './executor.js';
import { sendMessageRequestSchema } from './types.js';
import { A2ATaskProvider } from './memory/types.js';

// Pure function to validate JSON-RPC request
export const validateJSONRPCRequest = (request: any): request is JSONRPCRequest => {
  return (
    typeof request === 'object' &&
    request !== null &&
    request.jsonrpc === '2.0' &&
    (typeof request.id === 'string' || typeof request.id === 'number') &&
    typeof request.method === 'string'
  );
};

// Pure function to create JSON-RPC success response
export const createJSONRPCSuccessResponse = (id: string | number, result: any): JSONRPCResponse => ({
  jsonrpc: '2.0',
  id,
  result
});

// Pure function to create JSON-RPC error response
export const createJSONRPCErrorResponse = (
  id: string | number | null, 
  error: JSONRPCError
): JSONRPCResponse => ({
  jsonrpc: '2.0',
  id,
  error
});

// Pure function to create A2A error
export const createA2AError = (
  code: typeof A2AErrorCodes[keyof typeof A2AErrorCodes], 
  message: string, 
  data?: any
): A2AError => ({
  code,
  message,
  data
});

// Pure function to map JavaScript errors to A2A errors
export const mapErrorToA2AError = (error: unknown): A2AError => {
  if (error instanceof Error) {
    return createA2AError(
      A2AErrorCodes.INTERNAL_ERROR,
      error.message,
      { stack: error.stack }
    );
  }
  
  return createA2AError(
    A2AErrorCodes.INTERNAL_ERROR,
    typeof error === 'string' ? error : 'Unknown error occurred'
  );
};

// Pure function to validate send message request
export const validateSendMessageRequest = (request: JSONRPCRequest): {
  isValid: boolean;
  data?: SendMessageRequest;
  error?: A2AError;
} => {
  try {
    const validatedRequest = sendMessageRequestSchema.parse(request);
    return {
      isValid: true,
      data: validatedRequest as SendMessageRequest
    };
  } catch (error) {
    return {
      isValid: false,
      error: createA2AError(
        A2AErrorCodes.INVALID_PARAMS,
        'Invalid send message request parameters',
        error
      )
    };
  }
};

// Pure function to handle message/send method
export const handleMessageSend = async (
  request: SendMessageRequest,
  agent: A2AAgent,
  modelProvider: any
): Promise<JSONRPCResponse> => {
  try {
    const context = {
      message: request.params.message,
      sessionId: request.params.message.contextId || `session_${Date.now()}`,
      metadata: request.params.metadata
    };
    
    const result = await executeA2AAgent(context, agent, modelProvider);
    
    if (result.error) {
      return createJSONRPCErrorResponse(
        request.id,
        createA2AError(A2AErrorCodes.INTERNAL_ERROR, result.error)
      );
    }
    
    return createJSONRPCSuccessResponse(
      request.id,
      result.finalTask || { message: 'No result available' }
    );
  } catch (error) {
    return createJSONRPCErrorResponse(
      request.id,
      mapErrorToA2AError(error)
    );
  }
};

// Pure function to handle message/stream method
export const handleMessageStream = async function* (
  request: SendStreamingMessageRequest,
  agent: A2AAgent,
  modelProvider: any
): AsyncGenerator<JSONRPCResponse, void, unknown> {
  try {
    const context = {
      message: request.params.message,
      sessionId: request.params.message.contextId || `session_${Date.now()}`,
      metadata: request.params.metadata
    };
    
    for await (const event of executeA2AAgentWithStreaming(context, agent, modelProvider)) {
      yield createJSONRPCSuccessResponse(request.id, event);
    }
  } catch (error) {
    yield createJSONRPCErrorResponse(
      request.id,
      mapErrorToA2AError(error)
    );
  }
};

// Pure function to handle tasks/get method
export const handleTasksGet = async (
  request: GetTaskRequest,
  taskProvider: A2ATaskProvider
): Promise<JSONRPCResponse> => {
  try {
    const taskResult = await taskProvider.getTask(request.params.id);
    
    if (!taskResult.success) {
      return createJSONRPCErrorResponse(
        request.id,
        createA2AError(A2AErrorCodes.INTERNAL_ERROR, `Failed to get task: ${taskResult.error.message}`)
      );
    }

    const task = taskResult.data;
    if (!task) {
      return createJSONRPCErrorResponse(
        request.id,
        createA2AError(A2AErrorCodes.TASK_NOT_FOUND, `Task with id ${request.params.id} not found`)
      );
    }
    
    // Apply history length limit if specified
    let resultTask = task;
    if (request.params.historyLength && task.history) {
      const limitedHistory = task.history.slice(-request.params.historyLength);
      resultTask = { ...task, history: limitedHistory };
    }
    
    return createJSONRPCSuccessResponse(request.id, resultTask);
  } catch (error) {
    return createJSONRPCErrorResponse(
      request.id,
      mapErrorToA2AError(error)
    );
  }
};

// Pure function to handle tasks/cancel method
export const handleTasksCancel = async (
  request: { id: string | number; params: { id: string } },
  taskProvider: A2ATaskProvider
): Promise<JSONRPCResponse> => {
  try {
    const taskResult = await taskProvider.getTask(request.params.id);
    
    if (!taskResult.success) {
      return createJSONRPCErrorResponse(
        request.id,
        createA2AError(A2AErrorCodes.INTERNAL_ERROR, `Failed to get task: ${taskResult.error.message}`)
      );
    }

    const task = taskResult.data;
    if (!task) {
      return createJSONRPCErrorResponse(
        request.id,
        createA2AError(A2AErrorCodes.TASK_NOT_FOUND, `Task with id ${request.params.id} not found`)
      );
    }
    
    // Check if task can be canceled
    if (task.status.state === 'completed' || task.status.state === 'failed' || task.status.state === 'canceled') {
      return createJSONRPCErrorResponse(
        request.id,
        createA2AError(A2AErrorCodes.TASK_NOT_CANCELABLE, `Task ${request.params.id} cannot be canceled in state ${task.status.state}`)
      );
    }
    
    // Update task status to canceled
    const updateResult = await taskProvider.updateTaskStatus(
      request.params.id,
      'canceled',
      undefined,
      new Date().toISOString()
    );

    if (!updateResult.success) {
      return createJSONRPCErrorResponse(
        request.id,
        createA2AError(A2AErrorCodes.INTERNAL_ERROR, `Failed to cancel task: ${updateResult.error.message}`)
      );
    }

    // Get the updated task to return
    const updatedTaskResult = await taskProvider.getTask(request.params.id);
    const canceledTask = updatedTaskResult.success ? updatedTaskResult.data : task;
    
    return createJSONRPCSuccessResponse(request.id, canceledTask);
  } catch (error) {
    return createJSONRPCErrorResponse(
      request.id,
      mapErrorToA2AError(error)
    );
  }
};

// Pure function to handle agent/getAuthenticatedExtendedCard method
export const handleGetAuthenticatedExtendedCard = async (
  request: { id: string | number },
  agentCard: any
): Promise<JSONRPCResponse> => {
  try {
    // In a real implementation, this would check authentication
    // For now, return the standard agent card
    return createJSONRPCSuccessResponse(request.id, agentCard);
  } catch (error) {
    return createJSONRPCErrorResponse(
      request.id,
      mapErrorToA2AError(error)
    );
  }
};

// Pure function to route A2A requests
export const routeA2ARequest = (
  request: any,
  agent: A2AAgent,
  modelProvider: any,
  taskProvider: A2ATaskProvider,
  agentCard: any
): Promise<JSONRPCResponse> | AsyncGenerator<JSONRPCResponse, void, unknown> => {
  if (!validateJSONRPCRequest(request)) {
    return Promise.resolve(createJSONRPCErrorResponse(
      request.id || null,
      createA2AError(A2AErrorCodes.INVALID_REQUEST, 'Invalid JSON-RPC request')
    ));
  }
  
  // request is now confirmed to be JSONRPCRequest
  const validRequest = request as JSONRPCRequest;
  
  switch (validRequest.method) {
    case 'message/send': {
      const validation = validateSendMessageRequest(validRequest);
      if (!validation.isValid) {
        return Promise.resolve(createJSONRPCErrorResponse(
          validRequest.id,
          validation.error!
        ));
      }
      return handleMessageSend(validation.data!, agent, modelProvider);
    }
    
    case 'message/stream': {
      const validation = validateSendMessageRequest(validRequest);
      if (!validation.isValid) {
        return (async function* () {
          yield createJSONRPCErrorResponse(validRequest.id, validation.error!);
        })();
      }
      // Convert to streaming request
      const streamingRequest: SendStreamingMessageRequest = {
        ...validation.data!,
        method: 'message/stream'
      };
      return handleMessageStream(streamingRequest, agent, modelProvider);
    }
    
    case 'tasks/get':
      return handleTasksGet(validRequest as GetTaskRequest, taskProvider);
    
    case 'tasks/cancel':
      return handleTasksCancel(validRequest as any, taskProvider);
    
    case 'agent/getAuthenticatedExtendedCard':
      return handleGetAuthenticatedExtendedCard(validRequest as any, agentCard);
    
    default:
      return Promise.resolve(createJSONRPCErrorResponse(
        validRequest.id,
        createA2AError(A2AErrorCodes.METHOD_NOT_FOUND, `Method ${validRequest.method} not found`)
      ));
  }
};

// Pure function to create protocol handler configuration
export const createProtocolHandlerConfig = (
  agents: ReadonlyMap<string, A2AAgent>,
  modelProvider: any,
  agentCard: any,
  taskProvider?: A2ATaskProvider
) => ({
  agents,
  modelProvider,
  agentCard,
  taskProvider,
  
  // Pure function to handle any A2A request
  handleRequest: (request: JSONRPCRequest, agentName?: string) => {
    const agent = agentName ? agents.get(agentName) : agents.values().next().value;
    
    if (!agent) {
      return Promise.resolve(createJSONRPCErrorResponse(
        request.id || null,
        createA2AError(A2AErrorCodes.INVALID_PARAMS, `Agent ${agentName} not found`)
      ));
    }
    
    if (!taskProvider) {
      return Promise.resolve(createJSONRPCErrorResponse(
        request.id || null,
        createA2AError(A2AErrorCodes.INTERNAL_ERROR, 'No task provider configured')
      ));
    }
    
    return routeA2ARequest(
      request,
      agent,
      modelProvider,
      taskProvider,
      agentCard
    );
  }
});