import { RunId, TraceId, ApprovalValue } from '../core/types.js';
import { Result, createSuccess, createFailure, createMemoryStorageError } from './types.js';

/**
 * Approval storage interface for managing tool approval states
 * Extends the memory provider concept to handle approvals with persistence
 */
export interface ApprovalStorage {
  /**
   * Store approval decision for a tool call
   */
  readonly storeApproval: (
    runId: RunId,
    toolCallId: string,
    approval: ApprovalValue,
    metadata?: { traceId?: TraceId; [key: string]: any }
  ) => Promise<Result<void>>;

  /**
   * Retrieve approval for a specific tool call
   */
  readonly getApproval: (
    runId: RunId,
    toolCallId: string
  ) => Promise<Result<ApprovalValue | null>>;

  /**
   * Get all approvals for a run
   */
  readonly getRunApprovals: (
    runId: RunId
  ) => Promise<Result<ReadonlyMap<string, ApprovalValue>>>;

  /**
   * Update existing approval with additional context
   */
  readonly updateApproval: (
    runId: RunId,
    toolCallId: string,
    updates: Partial<ApprovalValue>
  ) => Promise<Result<void>>;

  /**
   * Delete approval for a tool call
   */
  readonly deleteApproval: (
    runId: RunId,
    toolCallId: string
  ) => Promise<Result<boolean>>;

  /**
   * Clear all approvals for a run
   */
  readonly clearRunApprovals: (runId: RunId) => Promise<Result<number>>;

  /**
   * Get approval statistics
   */
  readonly getStats: () => Promise<Result<{
    totalApprovals: number;
    approvedCount: number;
    rejectedCount: number;
    runsWithApprovals: number;
  }>>;

  /**
   * Health check for the approval storage
   */
  readonly healthCheck: () => Promise<Result<{ healthy: boolean; latencyMs?: number; error?: string }>>;

  /**
   * Close/cleanup the storage
   */
  readonly close: () => Promise<Result<void>>;
}

/**
 * In-memory implementation of ApprovalStorage
 * Non-persistent, good for development and testing
 */
export function createInMemoryApprovalStorage(): ApprovalStorage {
  const approvals = new Map<string, Map<string, ApprovalValue>>();
  
  const getRunKey = (runId: RunId): string => `run:${runId}`;

  return {
    storeApproval: async (runId, toolCallId, approval) => {
      try {
        const runKey = getRunKey(runId);
        
        if (!approvals.has(runKey)) {
          approvals.set(runKey, new Map());
        }
        
        const runApprovals = approvals.get(runKey)!;
        runApprovals.set(toolCallId, approval);
        
        return createSuccess(undefined);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'store approval',
          'InMemoryApprovalStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    },

    getApproval: async (runId, toolCallId) => {
      try {
        const runKey = getRunKey(runId);
        const runApprovals = approvals.get(runKey);
        
        if (!runApprovals) {
          return createSuccess(null);
        }
        
        const approval = runApprovals.get(toolCallId) || null;
        return createSuccess(approval);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'get approval',
          'InMemoryApprovalStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    },

    getRunApprovals: async (runId) => {
      try {
        const runKey = getRunKey(runId);
        const runApprovals = approvals.get(runKey);
        
        if (!runApprovals) {
          return createSuccess(new Map<string, ApprovalValue>() as ReadonlyMap<string, ApprovalValue>);
        }
        
        return createSuccess(new Map(runApprovals) as ReadonlyMap<string, ApprovalValue>);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'get run approvals',
          'InMemoryApprovalStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    },

    updateApproval: async (runId, toolCallId, updates) => {
      try {
        const runKey = getRunKey(runId);
        const runApprovals = approvals.get(runKey);
        
        if (!runApprovals || !runApprovals.has(toolCallId)) {
          return createFailure(createMemoryStorageError(
            'update approval',
            'InMemoryApprovalStorage',
            new Error(`Approval not found for tool call ${toolCallId} in run ${runId}`)
          ));
        }
        
        const existingApproval = runApprovals.get(toolCallId)!;
        const updatedApproval: ApprovalValue = {
          ...existingApproval,
          ...updates,
          additionalContext: {
            ...existingApproval.additionalContext,
            ...updates.additionalContext
          }
        };
        
        runApprovals.set(toolCallId, updatedApproval);
        return createSuccess(undefined);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'update approval',
          'InMemoryApprovalStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    },

    deleteApproval: async (runId, toolCallId) => {
      try {
        const runKey = getRunKey(runId);
        const runApprovals = approvals.get(runKey);
        
        if (!runApprovals) {
          return createSuccess(false);
        }
        
        const deleted = runApprovals.delete(toolCallId);
        
        // Clean up empty run maps
        if (runApprovals.size === 0) {
          approvals.delete(runKey);
        }
        
        return createSuccess(deleted);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'delete approval',
          'InMemoryApprovalStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    },

    clearRunApprovals: async (runId) => {
      try {
        const runKey = getRunKey(runId);
        const runApprovals = approvals.get(runKey);
        
        if (!runApprovals) {
          return createSuccess(0);
        }
        
        const count = runApprovals.size;
        approvals.delete(runKey);
        
        return createSuccess(count);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'clear run approvals',
          'InMemoryApprovalStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    },

    getStats: async () => {
      try {
        let totalApprovals = 0;
        let approvedCount = 0;
        let rejectedCount = 0;
        const runsWithApprovals = approvals.size;
        
        for (const [, runApprovals] of approvals) {
          for (const approval of runApprovals.values()) {
            totalApprovals++;
            if (approval.approved) {
              approvedCount++;
            } else {
              rejectedCount++;
            }
          }
        }
        
        return createSuccess({
          totalApprovals,
          approvedCount,
          rejectedCount,
          runsWithApprovals
        });
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'get stats',
          'InMemoryApprovalStorage',
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
        approvals.clear();
        return createSuccess(undefined);
      } catch (error) {
        return createFailure(createMemoryStorageError(
          'close',
          'InMemoryApprovalStorage',
          error instanceof Error ? error : new Error(String(error))
        ));
      }
    }
  };
}