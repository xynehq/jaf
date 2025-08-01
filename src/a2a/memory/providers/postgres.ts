/**
 * A2A PostgreSQL Task Provider for FAF
 * Pure functional PostgreSQL-based storage for A2A tasks
 */

import { A2ATask, TaskState } from '../../types.js';
import { 
  A2ATaskProvider, 
  A2ATaskQuery, 
  A2APostgresTaskConfig,
  createA2ATaskNotFoundError,
  createA2ATaskStorageError,
  createSuccess,
  createFailure
} from '../types.js';
import { 
  serializeA2ATask, 
  deserializeA2ATask, 
  validateTaskIntegrity,
  sanitizeTask,
  A2ATaskSerialized
} from '../serialization.js';

/**
 * SQL queries for A2A task operations
 */
const SQL_QUERIES = {
  CREATE_TABLE: `
    CREATE TABLE IF NOT EXISTS a2a_tasks (
      task_id VARCHAR(255) PRIMARY KEY,
      context_id VARCHAR(255) NOT NULL,
      state VARCHAR(50) NOT NULL,
      task_data JSONB NOT NULL,
      status_message JSONB,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE,
      metadata JSONB
    );
    
    CREATE INDEX IF NOT EXISTS idx_a2a_tasks_context_id ON a2a_tasks (context_id);
    CREATE INDEX IF NOT EXISTS idx_a2a_tasks_state ON a2a_tasks (state);
    CREATE INDEX IF NOT EXISTS idx_a2a_tasks_created_at ON a2a_tasks (created_at);
    CREATE INDEX IF NOT EXISTS idx_a2a_tasks_expires_at ON a2a_tasks (expires_at) WHERE expires_at IS NOT NULL;
  `,

  INSERT_TASK: `
    INSERT INTO a2a_tasks (
      task_id, context_id, state, task_data, status_message, 
      created_at, updated_at, expires_at, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `,

  SELECT_TASK: `
    SELECT task_id, context_id, state, task_data, status_message, 
           created_at, updated_at, expires_at, metadata
    FROM a2a_tasks 
    WHERE task_id = $1 
      AND (expires_at IS NULL OR expires_at > NOW())
  `,

  UPDATE_TASK: `
    UPDATE a2a_tasks 
    SET state = $2, task_data = $3, status_message = $4, 
        updated_at = $5, metadata = $6
    WHERE task_id = $1
      AND (expires_at IS NULL OR expires_at > NOW())
  `,

  DELETE_TASK: `
    DELETE FROM a2a_tasks 
    WHERE task_id = $1
  `,

  DELETE_TASKS_BY_CONTEXT: `
    DELETE FROM a2a_tasks 
    WHERE context_id = $1
  `,

  CLEANUP_EXPIRED: `
    DELETE FROM a2a_tasks 
    WHERE expires_at IS NOT NULL AND expires_at <= NOW()
  `,

  COUNT_TASKS: `
    SELECT COUNT(*) as total 
    FROM a2a_tasks 
    WHERE (expires_at IS NULL OR expires_at > NOW())
  `,

  COUNT_TASKS_BY_CONTEXT: `
    SELECT COUNT(*) as total 
    FROM a2a_tasks 
    WHERE context_id = $1 
      AND (expires_at IS NULL OR expires_at > NOW())
  `,

  STATS_BY_STATE: `
    SELECT state, COUNT(*) as count 
    FROM a2a_tasks 
    WHERE (expires_at IS NULL OR expires_at > NOW())
      AND ($1::text IS NULL OR context_id = $1)
    GROUP BY state
  `,

  DATE_RANGE: `
    SELECT MIN(created_at) as oldest, MAX(created_at) as newest
    FROM a2a_tasks 
    WHERE (expires_at IS NULL OR expires_at > NOW())
      AND ($1::text IS NULL OR context_id = $1)
  `
};

/**
 * Create a PostgreSQL-based A2A task provider
 */
export const createA2APostgresTaskProvider = async (
  config: A2APostgresTaskConfig,
  client: any // PostgreSQL client (pg.Client or pg.Pool)
): Promise<A2ATaskProvider> => {
  const tableName = config.tableName || 'a2a_tasks';

  // Initialize database schema
  await client.query(SQL_QUERIES.CREATE_TABLE.replace(/a2a_tasks/g, tableName));

  // Pure function to convert database row to serialized task
  const rowToSerializedTask = (row: any): A2ATaskSerialized => ({
    taskId: row.task_id,
    contextId: row.context_id,
    state: row.state,
    taskData: typeof row.task_data === 'string' ? row.task_data : JSON.stringify(row.task_data),
    statusMessage: row.status_message ? 
      (typeof row.status_message === 'string' ? row.status_message : JSON.stringify(row.status_message)) : 
      undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    metadata: row.metadata ? 
      (typeof row.metadata === 'string' ? row.metadata : JSON.stringify(row.metadata)) : 
      undefined
  });

  // Pure function to build WHERE clause for queries
  const buildWhereClause = (query: A2ATaskQuery): { clause: string; params: any[] } => {
    const conditions: string[] = ['(expires_at IS NULL OR expires_at > NOW())'];
    const params: any[] = [];
    let paramIndex = 1;

    if (query.taskId) {
      conditions.push(`task_id = $${paramIndex++}`);
      params.push(query.taskId);
    }

    if (query.contextId) {
      conditions.push(`context_id = $${paramIndex++}`);
      params.push(query.contextId);
    }

    if (query.state) {
      conditions.push(`state = $${paramIndex++}`);
      params.push(query.state);
    }

    if (query.since) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(query.since);
    }

    if (query.until) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(query.until);
    }

    return {
      clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      params
    };
  };

  // Forward declare provider for recursive calls  
  // let provider: A2ATaskProvider;

  const providerImpl = {
    storeTask: async (task: A2ATask, metadata?: { expiresAt?: Date; [key: string]: any }) => {
      try {
        // Validate and sanitize task
        const sanitizeResult = sanitizeTask(task);
        if (!sanitizeResult.success) {
          return sanitizeResult as any;
        }

        // Serialize task
        const serializeResult = serializeA2ATask(sanitizeResult.data, metadata);
        if (!serializeResult.success) {
          return serializeResult as any;
        }

        const serialized = serializeResult.data;

        const query = SQL_QUERIES.INSERT_TASK.replace(/a2a_tasks/g, tableName);
        await client.query(query, [
          serialized.taskId,
          serialized.contextId,
          serialized.state,
          serialized.taskData,
          serialized.statusMessage,
          new Date(serialized.createdAt),
          new Date(serialized.updatedAt),
          metadata?.expiresAt || null,
          metadata ? JSON.stringify(metadata) : null
        ]);

        return createSuccess(undefined);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('store', 'postgres', task.id, error as Error)
        );
      }
    },

    getTask: async (taskId: string) => {
      try {
        const query = SQL_QUERIES.SELECT_TASK.replace(/a2a_tasks/g, tableName);
        const result = await client.query(query, [taskId]);

        if (result.rows.length === 0) {
          return createSuccess(null);
        }

        const row = result.rows[0];
        const serialized = rowToSerializedTask(row);
        const deserializeResult = deserializeA2ATask(serialized);

        if (!deserializeResult.success) {
          return deserializeResult;
        }

        return createSuccess(deserializeResult.data);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('get', 'postgres', taskId, error as Error)
        );
      }
    },

    updateTask: async (task: A2ATask, metadata?: { [key: string]: any }) => {
      try {
        // Check if task exists
        const existingResult = await providerImpl.getTask(task.id);
        if (!existingResult.success) {
          return existingResult;
        }
        if (!existingResult.data) {
          return createFailure(createA2ATaskNotFoundError(task.id, 'postgres'));
        }

        // Validate and sanitize task
        const sanitizeResult = sanitizeTask(task);
        if (!sanitizeResult.success) {
          return sanitizeResult as any;
        }

        // Merge metadata
        const existingQuery = SQL_QUERIES.SELECT_TASK.replace(/a2a_tasks/g, tableName);
        const existingData = await client.query(existingQuery, [task.id]);
        const existingMetadata = existingData.rows[0]?.metadata || {};
        const mergedMetadata = { ...existingMetadata, ...metadata };

        // Serialize updated task
        const serializeResult = serializeA2ATask(sanitizeResult.data, mergedMetadata);
        if (!serializeResult.success) {
          return serializeResult as any;
        }

        const serialized = serializeResult.data;

        const query = SQL_QUERIES.UPDATE_TASK.replace(/a2a_tasks/g, tableName);
        const result = await client.query(query, [
          task.id,
          serialized.state,
          serialized.taskData,
          serialized.statusMessage,
          new Date(serialized.updatedAt),
          JSON.stringify(mergedMetadata)
        ]);

        if (result.rowCount === 0) {
          return createFailure(createA2ATaskNotFoundError(task.id, 'postgres'));
        }

        return createSuccess(undefined);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('update', 'postgres', task.id, error as Error)
        );
      }
    },

    updateTaskStatus: async (taskId: string, newState: TaskState, statusMessage?: any, timestamp?: string) => {
      try {
        // Get existing task
        const existingResult = await providerImpl.getTask(taskId);
        if (!existingResult.success) {
          return existingResult;
        }
        if (!existingResult.data) {
          return createFailure(createA2ATaskNotFoundError(taskId, 'postgres'));
        }

        const task = existingResult.data;

        // Update task status
        const updatedTask: A2ATask = {
          ...task,
          status: {
            ...task.status,
            state: newState,
            message: statusMessage || task.status.message,
            timestamp: timestamp || new Date().toISOString()
          }
        };

        return providerImpl.updateTask(updatedTask);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('update-status', 'postgres', taskId, error as Error)
        );
      }
    },

    findTasks: async (query: A2ATaskQuery) => {
      try {
        const { clause, params } = buildWhereClause(query);
        
        let sql = `
          SELECT task_id, context_id, state, task_data, status_message, 
                 created_at, updated_at, expires_at, metadata
          FROM ${tableName} 
          ${clause}
          ORDER BY created_at DESC
        `;

        // Add pagination
        if (query.limit) {
          sql += ` LIMIT ${query.limit}`;
        }
        if (query.offset) {
          sql += ` OFFSET ${query.offset}`;
        }

        const result = await client.query(sql, params);
        const tasks: A2ATask[] = [];

        for (const row of result.rows) {
          const serialized = rowToSerializedTask(row);
          const deserializeResult = deserializeA2ATask(serialized);
          
          if (deserializeResult.success) {
            tasks.push(deserializeResult.data);
          }
        }

        return createSuccess(tasks);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('find', 'postgres', undefined, error as Error)
        );
      }
    },

    getTasksByContext: async (contextId: string, limit?: number) => {
      return providerImpl.findTasks({ contextId, limit });
    },

    deleteTask: async (taskId: string) => {
      try {
        const query = SQL_QUERIES.DELETE_TASK.replace(/a2a_tasks/g, tableName);
        const result = await client.query(query, [taskId]);

        return createSuccess(result.rowCount > 0);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('delete', 'postgres', taskId, error as Error)
        );
      }
    },

    deleteTasksByContext: async (contextId: string) => {
      try {
        const query = SQL_QUERIES.DELETE_TASKS_BY_CONTEXT.replace(/a2a_tasks/g, tableName);
        const result = await client.query(query, [contextId]);

        return createSuccess(result.rowCount || 0);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('delete-by-context', 'postgres', undefined, error as Error)
        );
      }
    },

    cleanupExpiredTasks: async () => {
      try {
        const query = SQL_QUERIES.CLEANUP_EXPIRED.replace(/a2a_tasks/g, tableName);
        const result = await client.query(query);

        return createSuccess(result.rowCount || 0);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('cleanup', 'postgres', undefined, error as Error)
        );
      }
    },

    getTaskStats: async (contextId?: string) => {
      try {
        const tasksByState: Record<TaskState, number> = {
          submitted: 0,
          working: 0,
          'input-required': 0,
          completed: 0,
          canceled: 0,
          failed: 0,
          rejected: 0,
          'auth-required': 0,
          unknown: 0
        };

        // Get state counts
        const stateQuery = SQL_QUERIES.STATS_BY_STATE.replace(/a2a_tasks/g, tableName);
        const stateResult = await client.query(stateQuery, [contextId || null]);
        
        let totalTasks = 0;
        for (const row of stateResult.rows) {
          const state = row.state as TaskState;
          const count = parseInt(row.count);
          if (state in tasksByState) {
            tasksByState[state] = count;
          }
          totalTasks += count;
        }

        // Get date range
        const dateQuery = SQL_QUERIES.DATE_RANGE.replace(/a2a_tasks/g, tableName);
        const dateResult = await client.query(dateQuery, [contextId || null]);
        
        let oldestTask: Date | undefined;
        let newestTask: Date | undefined;
        
        if (dateResult.rows.length > 0 && dateResult.rows[0].oldest) {
          oldestTask = new Date(dateResult.rows[0].oldest);
          newestTask = new Date(dateResult.rows[0].newest);
        }

        return createSuccess({
          totalTasks,
          tasksByState,
          oldestTask,
          newestTask
        });
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('stats', 'postgres', undefined, error as Error)
        );
      }
    },

    healthCheck: async () => {
      try {
        const startTime = Date.now();
        
        // Simple query to check database connectivity
        await client.query('SELECT 1');
        
        const latencyMs = Date.now() - startTime;

        return createSuccess({
          healthy: true,
          latencyMs
        });
      } catch (error) {
        return createSuccess({
          healthy: false,
          error: (error as Error).message
        });
      }
    },

    close: async () => {
      try {
        // PostgreSQL client cleanup is typically handled externally
        // We don't close the client here as it might be a pool or shared connection
        return createSuccess(undefined);
      } catch (error) {
        return createFailure(
          createA2ATaskStorageError('close', 'postgres', undefined, error as Error)
        );
      }
    }
  };

  return providerImpl;
};
