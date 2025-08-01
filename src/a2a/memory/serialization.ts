/**
 * A2A Task Serialization Functions for FAF
 * Pure functions for serializing/deserializing A2A tasks for storage
 */

import { A2ATask, A2AMessage, A2AArtifact } from '../types.js';
import { A2AResult, createA2ATaskStorageError, createSuccess, createFailure } from './types.js';

// Serialization interface for different storage backends
export interface A2ATaskSerialized {
  readonly taskId: string;
  readonly contextId: string;
  readonly state: string;
  readonly taskData: string; // JSON string of the full task
  readonly statusMessage?: string; // Serialized status message for quick access
  readonly createdAt: string; // ISO string
  readonly updatedAt: string; // ISO string
  readonly metadata?: string; // JSON string of metadata
}

/**
 * Pure function to serialize an A2A task for storage
 */
export const serializeA2ATask = (
  task: A2ATask,
  metadata?: Record<string, any>
): A2AResult<A2ATaskSerialized> => {
  try {
    const now = new Date().toISOString();
    
    // Extract status message for indexing if present
    let statusMessage: string | undefined;
    if (task.status.message) {
      try {
        statusMessage = JSON.stringify(task.status.message);
      } catch {
        // If message serialization fails, continue without it
      }
    }

    const serialized: A2ATaskSerialized = {
      taskId: task.id,
      contextId: task.contextId,
      state: task.status.state,
      taskData: JSON.stringify(task),
      statusMessage,
      createdAt: task.metadata?.createdAt || now,
      updatedAt: now,
      metadata: metadata ? JSON.stringify(metadata) : undefined
    };

    return createSuccess(serialized);
  } catch (error) {
    return createFailure(
      createA2ATaskStorageError('serialize', 'memory', task.id, error as Error)
    );
  }
};

/**
 * Pure function to deserialize an A2A task from storage
 */
export const deserializeA2ATask = (
  stored: A2ATaskSerialized
): A2AResult<A2ATask> => {
  try {
    const task = JSON.parse(stored.taskData) as A2ATask;
    
    // Validate that the deserialized task has required fields
    if (!task.id || !task.contextId || !task.status || !task.kind) {
      return createFailure(
        createA2ATaskStorageError('deserialize', 'memory', stored.taskId, 
          new Error('Invalid task structure after deserialization'))
      );
    }

    return createSuccess(task);
  } catch (error) {
    return createFailure(
      createA2ATaskStorageError('deserialize', 'memory', stored.taskId, error as Error)
    );
  }
};

/**
 * Pure function to create a minimal task representation for indexing
 */
export const createTaskIndex = (task: A2ATask): A2AResult<{
  readonly taskId: string;
  readonly contextId: string;
  readonly state: string;
  readonly timestamp: string;
  readonly hasHistory: boolean;
  readonly hasArtifacts: boolean;
}> => {
  try {
    return createSuccess({
      taskId: task.id,
      contextId: task.contextId,
      state: task.status.state,
      timestamp: task.status.timestamp || new Date().toISOString(),
      hasHistory: Boolean(task.history && task.history.length > 0),
      hasArtifacts: Boolean(task.artifacts && task.artifacts.length > 0)
    });
  } catch (error) {
    return createFailure(
      createA2ATaskStorageError('index', 'memory', task.id, error as Error)
    );
  }
};

/**
 * Pure function to extract searchable text from a task for full-text search
 */
export const extractTaskSearchText = (task: A2ATask): A2AResult<string> => {
  try {
    const textParts: string[] = [];

    // Extract text from status message
    if (task.status.message) {
      extractTextFromMessage(task.status.message, textParts);
    }

    // Extract text from history
    if (task.history) {
      task.history.forEach(message => {
        extractTextFromMessage(message, textParts);
      });
    }

    // Extract text from artifacts
    if (task.artifacts) {
      task.artifacts.forEach(artifact => {
        if (artifact.name) textParts.push(artifact.name);
        if (artifact.description) textParts.push(artifact.description);
        
        artifact.parts.forEach(part => {
          if (part.kind === 'text') {
            textParts.push(part.text);
          }
        });
      });
    }

    return createSuccess(textParts.join(' ').trim());
  } catch (error) {
    return createFailure(
      createA2ATaskStorageError('extract-text', 'memory', task.id, error as Error)
    );
  }
};

/**
 * Helper function to extract text from A2A message parts
 */
const extractTextFromMessage = (message: A2AMessage, textParts: string[]): void => {
  message.parts.forEach(part => {
    if (part.kind === 'text') {
      textParts.push(part.text);
    } else if (part.kind === 'data' && part.data) {
      // Extract any string values from data
      Object.values(part.data).forEach(value => {
        if (typeof value === 'string') {
          textParts.push(value);
        }
      });
    } else if (part.kind === 'file' && part.file.name) {
      textParts.push(part.file.name);
    }
  });
};

/**
 * Pure function to validate task data integrity
 */
export const validateTaskIntegrity = (task: A2ATask): A2AResult<true> => {
  try {
    // Check required fields
    if (!task.id || typeof task.id !== 'string') {
      return createFailure(
        createA2ATaskStorageError('validate', 'memory', task.id, 
          new Error('Task ID is required and must be a string'))
      );
    }

    if (!task.contextId || typeof task.contextId !== 'string') {
      return createFailure(
        createA2ATaskStorageError('validate', 'memory', task.id, 
          new Error('Context ID is required and must be a string'))
      );
    }

    if (!task.status || !task.status.state) {
      return createFailure(
        createA2ATaskStorageError('validate', 'memory', task.id, 
          new Error('Task status and state are required'))
      );
    }

    if (task.kind !== 'task') {
      return createFailure(
        createA2ATaskStorageError('validate', 'memory', task.id, 
          new Error('Task kind must be "task"'))
      );
    }

    // Validate history if present
    if (task.history) {
      if (!Array.isArray(task.history)) {
        return createFailure(
          createA2ATaskStorageError('validate', 'memory', task.id, 
            new Error('Task history must be an array'))
        );
      }

      for (const message of task.history) {
        if (!message.messageId || !message.parts || !Array.isArray(message.parts)) {
          return createFailure(
            createA2ATaskStorageError('validate', 'memory', task.id, 
              new Error('Invalid message in task history'))
          );
        }
      }
    }

    // Validate artifacts if present
    if (task.artifacts) {
      if (!Array.isArray(task.artifacts)) {
        return createFailure(
          createA2ATaskStorageError('validate', 'memory', task.id, 
            new Error('Task artifacts must be an array'))
        );
      }

      for (const artifact of task.artifacts) {
        if (!artifact.artifactId || !artifact.parts || !Array.isArray(artifact.parts)) {
          return createFailure(
            createA2ATaskStorageError('validate', 'memory', task.id, 
              new Error('Invalid artifact in task'))
          );
        }
      }
    }

    return createSuccess(true);
  } catch (error) {
    return createFailure(
      createA2ATaskStorageError('validate', 'memory', task.id, error as Error)
    );
  }
};

/**
 * Pure function to create a deep copy of a task (for immutability)
 */
export const cloneTask = (task: A2ATask): A2AResult<A2ATask> => {
  try {
    // Use JSON serialization for deep cloning
    const cloned = JSON.parse(JSON.stringify(task)) as A2ATask;
    return createSuccess(cloned);
  } catch (error) {
    return createFailure(
      createA2ATaskStorageError('clone', 'memory', task.id, error as Error)
    );
  }
};

/**
 * Pure function to sanitize task data for storage
 * Removes any potentially dangerous or invalid data
 */
export const sanitizeTask = (task: A2ATask): A2AResult<A2ATask> => {
  try {
    const validationResult = validateTaskIntegrity(task);
    if (!validationResult.success) {
      return validationResult as any;
    }

    // Clone the task to avoid mutation
    const cloneResult = cloneTask(task);
    if (!cloneResult.success) {
      return cloneResult;
    }

    let sanitized = cloneResult.data;

    // Ensure timestamps are valid ISO strings
    if (sanitized.status.timestamp) {
      try {
        const date = new Date(sanitized.status.timestamp);
        sanitized = {
          ...sanitized,
          status: {
            ...sanitized.status,
            timestamp: date.toISOString()
          }
        };
      } catch {
        // Remove invalid timestamp
        sanitized = {
          ...sanitized,
          status: {
            ...sanitized.status,
            timestamp: undefined
          }
        };
      }
    }

    return createSuccess(sanitized);
  } catch (error) {
    return createFailure(
      createA2ATaskStorageError('sanitize', 'memory', task.id, error as Error)
    );
  }
};