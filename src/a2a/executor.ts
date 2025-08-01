/**
 * Pure functional A2A executor
 * Handles A2A protocol execution without classes or mutable state
 */

import type { 
  A2AAgent, 
  A2ATask, 
  A2AMessage,
  StreamEvent,
  AgentState,
  A2AStreamEvent
} from './types.js';
import {
  processAgentQuery,
  createInitialAgentState,
  extractTextFromA2AMessage,
  createA2ATask,
  updateA2ATaskStatus,
  addArtifactToA2ATask,
  completeA2ATask,
  createA2ATextMessage,
  createA2ADataMessage
} from './agent.js';

// Pure function types for execution
export type A2AExecutionContext = {
  readonly message: A2AMessage;
  readonly currentTask?: A2ATask;
  readonly sessionId: string;
  readonly metadata?: Readonly<Record<string, any>>;
};

export type A2AExecutionEvent = {
  readonly type: 'task_created' | 'status_update' | 'artifact_added' | 'completed' | 'failed';
  readonly data: any;
  readonly timestamp: string;
};

export type A2AExecutionResult = {
  readonly events: readonly A2AExecutionEvent[];
  readonly finalTask?: A2ATask;
  readonly error?: string;
};

// Pure function to execute A2A agent
export const executeA2AAgent = async (
  context: A2AExecutionContext,
  agent: A2AAgent,
  modelProvider: any
): Promise<A2AExecutionResult> => {
  const query = extractTextFromA2AMessage(context.message);
  let events: A2AExecutionEvent[] = [];
  
  // Create task if none exists (pure function)
  const currentTask = context.currentTask || createA2ATask(context.message, context.sessionId);
  
  if (!context.currentTask) {
    events = [...events, createTaskEvent(currentTask)];
  }
  
  try {
    // Process through agent (functional pipeline)
    const agentState = createInitialAgentState(context.sessionId);
    const processingResult = await processAgentStream(agent, query, agentState, modelProvider, currentTask);
    
    // Check if the task failed during processing
    if (processingResult.task.status.state === 'failed') {
      const errorMessage = processingResult.task.status.message ? 
        extractTextFromA2AMessage(processingResult.task.status.message) : 
        'Agent execution failed';
      
      return {
        events: [...events, ...processingResult.events],
        finalTask: processingResult.task,
        error: errorMessage
      };
    }
    
    return {
      events: [...events, ...processingResult.events],
      finalTask: processingResult.task
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failedTask = updateA2ATaskStatus(currentTask, 'failed', createA2ATextMessage(errorMessage, context.sessionId));
    
    return {
      events: [...events, createFailureEvent(errorMessage)],
      finalTask: failedTask,
      error: errorMessage
    };
  }
};

// Pure function to process agent stream
const processAgentStream = async (
  agent: A2AAgent,
  query: string,
  state: AgentState,
  modelProvider: any,
  task: A2ATask
): Promise<{ events: A2AExecutionEvent[]; task: A2ATask }> => {
  let events: A2AExecutionEvent[] = [];
  let currentState = state;
  let currentTask = task;
  
  // Add working status event
  events = [...events, createStatusUpdateEvent('working', 'Processing request...')];
  currentTask = updateA2ATaskStatus(currentTask, 'working');
  
  try {
    for await (const event of processAgentQuery(agent, query, currentState, modelProvider)) {
      if (event.newState) {
        currentState = event.newState;
      }
      
      if (!event.isTaskComplete) {
        // Intermediate processing update
        events = [...events, createStatusUpdateEvent('working', event.updates || 'Processing...')];
      } else {
        // Handle final result
        const resultEvents = handleAgentResult(event.content, currentTask);
        events = [...events, ...resultEvents.events];
        currentTask = resultEvents.task;
        break;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    events = [...events, createFailureEvent(errorMessage)];
    currentTask = updateA2ATaskStatus(currentTask, 'failed', createA2ATextMessage(errorMessage, task.contextId));
  }
  
  return { events, task: currentTask };
};

// Pure function to handle agent results
const handleAgentResult = (content: any, task: A2ATask) => {
  let events: A2AExecutionEvent[] = [];
  let updatedTask = task;
  
  try {
    // Handle error responses (from FAF engine errors)
    if (typeof content === 'string' && content.startsWith('Error: ')) {
      const errorMessage = content.substring(7); // Remove "Error: " prefix
      events = [...events, createFailureEvent(errorMessage)];
      updatedTask = updateA2ATaskStatus(
        updatedTask, 
        'failed',
        createA2ATextMessage(errorMessage, task.contextId, task.id)
      );
      return { events, task: updatedTask };
    }
    
    // Handle form responses
    if (typeof content === 'object' && content?.type === 'form') {
      const formData = typeof content === 'string' ? JSON.parse(content) : content;
      events = [...events, createStatusUpdateEvent('input_required', 'User input required')];
      updatedTask = updateA2ATaskStatus(
        updatedTask, 
        'input-required',
        createA2ADataMessage(formData, task.contextId, task.id)
      );
      updatedTask = addArtifactToA2ATask(
        updatedTask,
        [{ kind: 'data', data: formData }],
        'form_request'
      );
      return { events, task: updatedTask };
    }
    
    // Handle text responses
    if (typeof content === 'string') {
      events = [...events, createArtifactEvent('text', content)];
      updatedTask = addArtifactToA2ATask(
        updatedTask,
        [{ kind: 'text', text: content }],
        'response'
      );
      events = [...events, createCompletionEvent(content)];
      updatedTask = completeA2ATask(updatedTask, content);
      return { events, task: updatedTask };
    }
    
    // Handle structured responses
    if (typeof content === 'object') {
      events = [...events, createArtifactEvent('structured', content)];
      updatedTask = addArtifactToA2ATask(
        updatedTask,
        [{ kind: 'data', data: content }],
        'structured_response'
      );
      events = [...events, createCompletionEvent(content)];
      updatedTask = completeA2ATask(updatedTask, content);
      return { events, task: updatedTask };
    }
    
    // Fallback for unexpected content
    const fallbackMessage = 'Unexpected response format';
    events = [...events, createFailureEvent(fallbackMessage)];
    updatedTask = updateA2ATaskStatus(
      updatedTask, 
      'failed',
      createA2ATextMessage(fallbackMessage, task.contextId, task.id)
    );
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    events = [...events, createFailureEvent(errorMessage)];
    updatedTask = updateA2ATaskStatus(
      updatedTask, 
      'failed',
      createA2ATextMessage(errorMessage, task.contextId, task.id)
    );
  }
  
  return { events, task: updatedTask };
};

// Pure helper functions for event creation
const createTaskEvent = (task: A2ATask): A2AExecutionEvent => ({
  type: 'task_created',
  data: task,
  timestamp: new Date().toISOString()
});

const createStatusUpdateEvent = (status: string, message: string): A2AExecutionEvent => ({
  type: 'status_update',
  data: { status, message },
  timestamp: new Date().toISOString()
});

const createArtifactEvent = (type: string, content: any): A2AExecutionEvent => ({
  type: 'artifact_added',
  data: { type, content },
  timestamp: new Date().toISOString()
});

const createCompletionEvent = (result: any): A2AExecutionEvent => ({
  type: 'completed',
  data: { result },
  timestamp: new Date().toISOString()
});

const createFailureEvent = (error: string): A2AExecutionEvent => ({
  type: 'failed',
  data: { error },
  timestamp: new Date().toISOString()
});

// Pure function to convert execution events to A2A stream events
export const convertToA2AStreamEvents = async function* (
  events: readonly A2AExecutionEvent[],
  taskId: string,
  contextId: string
): AsyncGenerator<A2AStreamEvent, void, unknown> {
  for (const event of events) {
    switch (event.type) {
      case 'status_update':
        yield {
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: event.data.status as any,
            timestamp: event.timestamp
          },
          final: false
        };
        break;
        
      case 'artifact_added':
        yield {
          kind: 'artifact-update',
          taskId,
          contextId,
          artifact: {
            artifactId: `artifact_${Date.now()}`,
            name: event.data.type,
            parts: [
              event.data.type === 'text' 
                ? { kind: 'text', text: event.data.content }
                : { kind: 'data', data: event.data.content }
            ]
          }
        };
        break;
        
      case 'completed':
        yield {
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: 'completed',
            timestamp: event.timestamp
          },
          final: true
        };
        break;
        
      case 'failed':
        yield {
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: 'failed',
            message: createA2ATextMessage(event.data.error, contextId, taskId),
            timestamp: event.timestamp
          },
          final: true
        };
        break;
    }
  }
};

// Pure function to execute with streaming
export const executeA2AAgentWithStreaming = async function* (
  context: A2AExecutionContext,
  agent: A2AAgent,
  modelProvider: any
): AsyncGenerator<A2AStreamEvent, void, unknown> {
  const query = extractTextFromA2AMessage(context.message);
  // Create task if none exists
  const currentTask = context.currentTask || createA2ATask(context.message, context.sessionId);
  
  if (!context.currentTask) {
    yield {
      kind: 'status-update',
      taskId: currentTask.id,
      contextId: currentTask.contextId,
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      final: false
    };
  }
  yield {
    kind: 'status-update',
    taskId: currentTask.id,
    contextId: currentTask.contextId,
    status: { state: 'working', timestamp: new Date().toISOString() },
    final: false
  };
  
  try {
    const agentState = createInitialAgentState(context.sessionId);
    
    for await (const event of processAgentQuery(agent, query, agentState, modelProvider)) {
      if (!event.isTaskComplete) {
        yield {
          kind: 'status-update',
          taskId: currentTask.id,
          contextId: currentTask.contextId,
          status: { 
            state: 'working',
            message: createA2ATextMessage(event.updates || 'Processing...', currentTask.contextId, currentTask.id),
            timestamp: event.timestamp
          },
          final: false
        };
      } else {
        // Handle final result
        if (typeof event.content === 'string') {
          yield {
            kind: 'artifact-update',
            taskId: currentTask.id,
            contextId: currentTask.contextId,
            artifact: {
              artifactId: `result_${Date.now()}`,
              name: 'response',
              parts: [{ kind: 'text', text: event.content }]
            }
          };
          
          yield {
            kind: 'status-update',
            taskId: currentTask.id,
            contextId: currentTask.contextId,
            status: { state: 'completed', timestamp: event.timestamp },
            final: true
          };
        } else if (typeof event.content === 'object' && event.content?.type === 'form') {
          yield {
            kind: 'artifact-update',
            taskId: currentTask.id,
            contextId: currentTask.contextId,
            artifact: {
              artifactId: `form_${Date.now()}`,
              name: 'form_request',
              parts: [{ kind: 'data', data: event.content }]
            }
          };
          
          yield {
            kind: 'status-update',
            taskId: currentTask.id,
            contextId: currentTask.contextId,
            status: { state: 'input-required', timestamp: event.timestamp },
            final: true
          };
        }
        break;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    yield {
      kind: 'status-update',
      taskId: currentTask.id,
      contextId: currentTask.contextId,
      status: { 
        state: 'failed',
        message: createA2ATextMessage(errorMessage, currentTask.contextId, currentTask.id),
        timestamp: new Date().toISOString()
      },
      final: true
    };
  }
};