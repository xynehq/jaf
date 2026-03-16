import { RunId, TraceId } from '../core/types';
import { Result, createSuccess, createFailure, createMemoryStorageError } from './types';

/**
 * Clarification value stored for a clarification request
 */
export type ClarificationValue = {
  readonly selectedOption: string;
  readonly additionalContext?: Record<string, any>;
};

/**
 * Clarification storage interface for managing clarification responses
 * Similar to ApprovalStorage but for handling user clarification selections
 */
export interface ClarificationStorage {
  /**
   * Store clarification response for a clarification request
   */
  readonly storeClarification: (
    runId: RunId,
    clarificationId: string,
    clarification: ClarificationValue,
    metadata?: { traceId?: TraceId; [key: string]: any }
  ) => Promise<Result<void>>;

  /**
   * Retrieve clarification for a specific clarification request
   */
  readonly getClarification: (
    runId: RunId,
    clarificationId: string
  ) => Promise<Result<ClarificationValue | null>>;

  /**
   * Get all clarifications for a run
   */
  readonly getRunClarifications: (
    runId: RunId
  ) => Promise<Result<ReadonlyMap<string, string>>>;

  /**
   * Update existing clarification with additional context
   */
  readonly updateClarification: (
    runId: RunId,
    clarificationId: string,
    updates: Partial<ClarificationValue>
  ) => Promise<Result<void>>;

  /**
   * Delete clarification for a clarification request
   */
  readonly deleteClarification: (
    runId: RunId,
    clarificationId: string
  ) => Promise<Result<boolean>>;

  /**
   * Clear all clarifications for a run
   */
  readonly clearRunClarifications: (runId: RunId) => Promise<Result<number>>;

  /**
   * Get clarification statistics
   */
  readonly getStats: () => Promise<Result<{
    totalClarifications: number;
    runsWithClarifications: number;
  }>>;

  /**
   * Health check for the clarification storage
   */
  readonly healthCheck: () => Promise<Result<{ healthy: boolean; latencyMs?: number; error?: string }>>;

  /**
   * Close/cleanup the storage
   */
  readonly close: () => Promise<Result<void>>;
}

/**
 * In-memory implementation of ClarificationStorage
 * Non-persistent, good for development and testing
 */
export function createInMemoryClarificationStorage(): ClarificationStorage {
  const clarifications = new Map<string, Map<string, ClarificationValue>>();

  const getRunKey = (runId: RunId): string => `run:${runId}`;

  return {
    storeClarification: async (runId, clarificationId, clarification) => {
      try {
        const runKey = getRunKey(runId);

        if (!clarifications.has(runKey)) {
          clarifications.set(runKey, new Map());
        }

        const runClarifications = clarifications.get(runKey)!;
        runClarifications.set(clarificationId, clarification);

        return createSuccess(undefined);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'store clarification',
          'InMemoryClarificationStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    },

    getClarification: async (runId, clarificationId) => {
      try {
        const runKey = getRunKey(runId);
        const runClarifications = clarifications.get(runKey);

        if (!runClarifications) {
          return createSuccess(null);
        }

        const clarification = runClarifications.get(clarificationId) || null;
        return createSuccess(clarification);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'get clarification',
          'InMemoryClarificationStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    },

    getRunClarifications: async (runId) => {
      try {
        const runKey = getRunKey(runId);
        const runClarifications = clarifications.get(runKey);

        if (!runClarifications) {
          return createSuccess(new Map<string, string>() as ReadonlyMap<string, string>);
        }

        // Convert ClarificationValue map to string map (just the selectedOption)
        const resultMap = new Map<string, string>();
        for (const [id, value] of runClarifications.entries()) {
          resultMap.set(id, value.selectedOption);
        }

        return createSuccess(resultMap as ReadonlyMap<string, string>);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'get run clarifications',
          'InMemoryClarificationStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    },

    updateClarification: async (runId, clarificationId, updates) => {
      try {
        const runKey = getRunKey(runId);
        const runClarifications = clarifications.get(runKey);

        if (!runClarifications || !runClarifications.has(clarificationId)) {
          return createFailure(createMemoryStorageError(
            'update clarification',
            'InMemoryClarificationStorage',
            new Error(`Clarification not found for ${clarificationId} in run ${runId}`)
          ));
        }

        const existingClarification = runClarifications.get(clarificationId)!;
        const updatedClarification: ClarificationValue = {
          ...existingClarification,
          ...updates,
          additionalContext: {
            ...existingClarification.additionalContext,
            ...updates.additionalContext
          }
        };

        runClarifications.set(clarificationId, updatedClarification);
        return createSuccess(undefined);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'update clarification',
          'InMemoryClarificationStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    },

    deleteClarification: async (runId, clarificationId) => {
      try {
        const runKey = getRunKey(runId);
        const runClarifications = clarifications.get(runKey);

        if (!runClarifications) {
          return createSuccess(false);
        }

        const deleted = runClarifications.delete(clarificationId);

        // Clean up empty run maps
        if (runClarifications.size === 0) {
          clarifications.delete(runKey);
        }

        return createSuccess(deleted);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'delete clarification',
          'InMemoryClarificationStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    },

    clearRunClarifications: async (runId) => {
      try {
        const runKey = getRunKey(runId);
        const runClarifications = clarifications.get(runKey);

        if (!runClarifications) {
          return createSuccess(0);
        }

        const count = runClarifications.size;
        clarifications.delete(runKey);

        return createSuccess(count);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'clear run clarifications',
          'InMemoryClarificationStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    },

    getStats: async () => {
      try {
        let totalClarifications = 0;
        const runsWithClarifications = clarifications.size;

        for (const [, runClarifications] of clarifications) {
          totalClarifications += runClarifications.size;
        }

        return createSuccess({
          totalClarifications,
          runsWithClarifications
        });
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'get stats',
          'InMemoryClarificationStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    },

    healthCheck: async () => {
      try {
        const start = Date.now();
        // Simple operation to test functionality
        await Promise.resolve();
        const latencyMs = Date.now() - start;

        return createSuccess({
          healthy: true,
          latencyMs
        });
      } catch (error) {
        return createSuccess({
          healthy: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    },

    close: async () => {
      try {
        clarifications.clear();
        return createSuccess(undefined);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'close',
          'InMemoryClarificationStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    }
  };
}
