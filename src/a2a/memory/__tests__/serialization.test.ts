/**
 * A2A Memory Serialization Tests
 * Comprehensive tests for A2A task serialization and deserialization
 */

import {
  serializeA2ATask,
  deserializeA2ATask,
  createTaskIndex,
  extractTaskSearchText,
  validateTaskIntegrity,
  cloneTask,
  sanitizeTask,
  A2ATaskSerialized
} from '../serialization.js';
import { A2ATask, A2AMessage } from '../../types.js';

describe('A2A Memory Serialization', () => {
  // Helper function to create a test task
  const createTestTask = (): A2ATask => ({
    id: 'task_123',
    contextId: 'ctx_456',
    kind: 'task',
    status: {
      state: 'working',
      message: {
        role: 'agent',
        parts: [{ kind: 'text', text: 'Processing your request...' }],
        messageId: 'msg_789',
        contextId: 'ctx_456',
        kind: 'message'
      },
      timestamp: '2024-01-01T12:00:00.000Z'
    },
    history: [
      {
        role: 'user',
        parts: [{ kind: 'text', text: 'Hello, please help me' }],
        messageId: 'msg_001',
        contextId: 'ctx_456',
        kind: 'message'
      }
    ],
    artifacts: [
      {
        artifactId: 'art_001',
        name: 'test-artifact',
        description: 'A test artifact',
        parts: [{ kind: 'text', text: 'Artifact content' }]
      }
    ],
    metadata: {
      createdAt: '2024-01-01T10:00:00.000Z',
      priority: 'normal'
    }
  });

  describe('serializeA2ATask', () => {
    it('should serialize a complete task successfully', () => {
      const task = createTestTask();
      const result = serializeA2ATask(task);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.taskId).toBe('task_123');
        expect(result.data.contextId).toBe('ctx_456');
        expect(result.data.state).toBe('working');
        expect(result.data.taskData).toBe(JSON.stringify(task));
        expect(result.data.statusMessage).toBeDefined();
        expect(result.data.createdAt).toBeDefined();
        expect(result.data.updatedAt).toBeDefined();
      }
    });

    it('should serialize task with metadata', () => {
      const task = createTestTask();
      const metadata = { expiresAt: new Date('2024-12-31'), custom: 'value' };
      const result = serializeA2ATask(task, metadata);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata).toBe(JSON.stringify(metadata));
      }
    });

    it('should handle task without optional fields', () => {
      const minimalTask: A2ATask = {
        id: 'task_minimal',
        contextId: 'ctx_minimal',
        kind: 'task',
        status: {
          state: 'submitted'
        }
      };

      const result = serializeA2ATask(minimalTask);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.taskId).toBe('task_minimal');
        expect(result.data.statusMessage).toBeUndefined();
      }
    });

    it('should handle serialization errors gracefully', () => {
      // Create a task with circular reference to cause JSON.stringify to fail
      const circularTask = createTestTask();
      (circularTask as any).circular = circularTask;

      const result = serializeA2ATask(circularTask);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error._tag).toBe('A2ATaskStorageError');
      }
    });
  });

  describe('deserializeA2ATask', () => {
    it('should deserialize a valid serialized task', () => {
      const task = createTestTask();
      const serializeResult = serializeA2ATask(task);
      
      expect(serializeResult.success).toBe(true);
      if (serializeResult.success) {
        const deserializeResult = deserializeA2ATask(serializeResult.data);
        
        expect(deserializeResult.success).toBe(true);
        if (deserializeResult.success) {
          expect(deserializeResult.data.id).toBe(task.id);
          expect(deserializeResult.data.contextId).toBe(task.contextId);
          expect(deserializeResult.data.status.state).toBe(task.status.state);
          expect(deserializeResult.data.history).toHaveLength(1);
          expect(deserializeResult.data.artifacts).toHaveLength(1);
        }
      }
    });

    it('should handle invalid JSON in taskData', () => {
      const invalidSerialized: A2ATaskSerialized = {
        taskId: 'task_invalid',
        contextId: 'ctx_invalid',
        state: 'failed',
        taskData: 'invalid json {',
        createdAt: '2024-01-01T12:00:00.000Z',
        updatedAt: '2024-01-01T12:00:00.000Z'
      };

      const result = deserializeA2ATask(invalidSerialized);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error._tag).toBe('A2ATaskStorageError');
      }
    });

    it('should validate required fields after deserialization', () => {
      const incompleteSerialized: A2ATaskSerialized = {
        taskId: 'task_incomplete',
        contextId: 'ctx_incomplete',
        state: 'failed',
        taskData: JSON.stringify({ id: 'task_incomplete' }), // Missing required fields
        createdAt: '2024-01-01T12:00:00.000Z',
        updatedAt: '2024-01-01T12:00:00.000Z'
      };

      const result = deserializeA2ATask(incompleteSerialized);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error._tag).toBe('A2ATaskStorageError');
        expect(result.error.message).toContain('Failed to deserialize A2A task');
        expect((result.error as any).cause?.message).toContain('Invalid task structure');
      }
    });
  });

  describe('createTaskIndex', () => {
    it('should create index for task with all features', () => {
      const task = createTestTask();
      const result = createTaskIndex(task);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.taskId).toBe('task_123');
        expect(result.data.contextId).toBe('ctx_456');
        expect(result.data.state).toBe('working');
        expect(result.data.hasHistory).toBe(true);
        expect(result.data.hasArtifacts).toBe(true);
        expect(result.data.timestamp).toBeDefined();
      }
    });

    it('should create index for minimal task', () => {
      const minimalTask: A2ATask = {
        id: 'task_minimal',
        contextId: 'ctx_minimal',
        kind: 'task',
        status: { state: 'submitted' }
      };

      const result = createTaskIndex(minimalTask);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasHistory).toBe(false);
        expect(result.data.hasArtifacts).toBe(false);
      }
    });
  });

  describe('extractTaskSearchText', () => {
    it('should extract text from all task components', () => {
      const task = createTestTask();
      const result = extractTaskSearchText(task);

      expect(result.success).toBe(true);
      if (result.success) {
        const searchText = result.data;
        expect(searchText).toContain('Processing your request');
        expect(searchText).toContain('Hello, please help me');
        expect(searchText).toContain('test-artifact');
        expect(searchText).toContain('A test artifact');
        expect(searchText).toContain('Artifact content');
      }
    });

    it('should handle task with no searchable content', () => {
      const emptyTask: A2ATask = {
        id: 'task_empty',
        contextId: 'ctx_empty',
        kind: 'task',
        status: { state: 'submitted' }
      };

      const result = extractTaskSearchText(emptyTask);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trim()).toBe('');
      }
    });

    it('should extract text from data parts', () => {
      const taskWithData: A2ATask = {
        id: 'task_data',
        contextId: 'ctx_data',
        kind: 'task',
        status: {
          state: 'working',
          message: {
            role: 'agent',
            parts: [{ 
              kind: 'data', 
              data: { 
                title: 'Important Document',
                summary: 'This is a summary'
              } 
            }],
            messageId: 'msg_data',
            contextId: 'ctx_data',
            kind: 'message'
          }
        }
      };

      const result = extractTaskSearchText(taskWithData);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toContain('Important Document');
        expect(result.data).toContain('This is a summary');
      }
    });
  });

  describe('validateTaskIntegrity', () => {
    it('should validate a complete valid task', () => {
      const task = createTestTask();
      const result = validateTaskIntegrity(task);

      expect(result.success).toBe(true);
    });

    it('should reject task without required ID', () => {
      const invalidTask = createTestTask();
      delete (invalidTask as any).id;

      const result = validateTaskIntegrity(invalidTask);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Failed to validate A2A task');
        expect((result.error as any).cause?.message).toContain('Task ID is required');
      }
    });

    it('should reject task without contextId', () => {
      const invalidTask = createTestTask();
      delete (invalidTask as any).contextId;

      const result = validateTaskIntegrity(invalidTask);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Failed to validate A2A task');
        expect((result.error as any).cause?.message).toContain('Context ID is required');
      }
    });

    it('should reject task without status', () => {
      const invalidTask = createTestTask();
      delete (invalidTask as any).status;

      const result = validateTaskIntegrity(invalidTask);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Failed to validate A2A task');
        expect((result.error as any).cause?.message).toContain('Task status and state are required');
      }
    });

    it('should reject task with wrong kind', () => {
      const invalidTask = createTestTask();
      (invalidTask as any).kind = 'invalid';

      const result = validateTaskIntegrity(invalidTask);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Failed to validate A2A task');
        expect((result.error as any).cause?.message).toContain('Task kind must be "task"');
      }
    });

    it('should validate history array', () => {
      const invalidTask = createTestTask();
      (invalidTask as any).history = 'not an array';

      const result = validateTaskIntegrity(invalidTask);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Failed to validate A2A task');
        expect((result.error as any).cause?.message).toContain('Task history must be an array');
      }
    });

    it('should validate artifacts array', () => {
      const invalidTask = createTestTask();
      (invalidTask as any).artifacts = { invalid: 'object' };

      const result = validateTaskIntegrity(invalidTask);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Failed to validate A2A task');
        expect((result.error as any).cause?.message).toContain('Task artifacts must be an array');
      }
    });
  });

  describe('cloneTask', () => {
    it('should create a deep copy of a task', () => {
      const originalTask = createTestTask();
      const result = cloneTask(originalTask);

      expect(result.success).toBe(true);
      if (result.success) {
        const clonedTask = result.data;
        
        // Should be equal but not the same reference
        expect(clonedTask).toEqual(originalTask);
        expect(clonedTask).not.toBe(originalTask);
        expect(clonedTask.history).not.toBe(originalTask.history);
        expect(clonedTask.artifacts).not.toBe(originalTask.artifacts);
        
        // Modifying clone should not affect original
        if (clonedTask.history) {
          (clonedTask.history as A2AMessage[]).push({
            role: 'agent',
            parts: [{ kind: 'text', text: 'New message' }],
            messageId: 'msg_new',
            contextId: 'ctx_456',
            kind: 'message'
          });
        }
        
        expect(originalTask.history).toHaveLength(1);
        expect(clonedTask.history).toHaveLength(2);
      }
    });

    it('should handle tasks with circular references', () => {
      const circularTask = createTestTask();
      (circularTask as any).circular = circularTask;

      const result = cloneTask(circularTask);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error._tag).toBe('A2ATaskStorageError');
      }
    });
  });

  describe('sanitizeTask', () => {
    it('should sanitize and validate a task', () => {
      const task = createTestTask();
      const result = sanitizeTask(task);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(task.id);
        expect(result.data.contextId).toBe(task.contextId);
      }
    });

    it('should fix invalid timestamps', () => {
      const taskWithBadTimestamp = createTestTask();
      (taskWithBadTimestamp.status as any).timestamp = 'invalid-date';

      const result = sanitizeTask(taskWithBadTimestamp);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status.timestamp).toBeUndefined();
      }
    });

    it('should convert valid timestamp strings to ISO format', () => {
      const taskWithDateTimestamp = createTestTask();
      (taskWithDateTimestamp.status as any).timestamp = new Date('2024-01-01').toString();

      const result = sanitizeTask(taskWithDateTimestamp);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
    });

    it('should reject invalid tasks', () => {
      const invalidTask = createTestTask();
      delete (invalidTask as any).id;

      const result = sanitizeTask(invalidTask);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error._tag).toBe('A2ATaskStorageError');
      }
    });
  });

  describe('round-trip serialization', () => {
    it('should maintain task integrity through serialize/deserialize cycle', () => {
      const originalTask = createTestTask();
      
      // Serialize
      const serializeResult = serializeA2ATask(originalTask);
      expect(serializeResult.success).toBe(true);
      
      if (serializeResult.success) {
        // Deserialize
        const deserializeResult = deserializeA2ATask(serializeResult.data);
        expect(deserializeResult.success).toBe(true);
        
        if (deserializeResult.success) {
          const roundTripTask = deserializeResult.data;
          
          // Core fields should match
          expect(roundTripTask.id).toBe(originalTask.id);
          expect(roundTripTask.contextId).toBe(originalTask.contextId);
          expect(roundTripTask.kind).toBe(originalTask.kind);
          expect(roundTripTask.status.state).toBe(originalTask.status.state);
          
          // Complex fields should be preserved
          expect(roundTripTask.history).toHaveLength(originalTask.history?.length || 0);
          expect(roundTripTask.artifacts).toHaveLength(originalTask.artifacts?.length || 0);
        }
      }
    });
  });
});