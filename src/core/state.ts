import { RunState, Interruption, RunConfig } from './types.js';
import { safeConsole } from '../utils/logger.js';

export async function approve<Ctx>(
  state: RunState<Ctx>,
  interruption: Interruption<Ctx>,
  additionalContext?: Record<string, any>,
  config?: RunConfig<Ctx>
): Promise<RunState<Ctx>> {
  if (interruption.type === 'tool_approval') {
    const approvalValue = {
      status: 'approved',
      approved: true,
      additionalContext: { ...(additionalContext || {}), status: 'approved' },
    } as const;

    // Store in approval storage if available
    if (config?.approvalStorage) {
      const result = await config.approvalStorage.storeApproval(
        state.runId,
        interruption.toolCall.id,
        approvalValue
      );
      if (!result.success) {
        safeConsole.warn('Failed to store approval:', result.error);
        // Continue with in-memory fallback
      }
    }

    // Update in-memory state
    const newApprovals = new Map(state.approvals ?? []);
    newApprovals.set(interruption.toolCall.id, approvalValue);
    return {
      ...state,
      approvals: newApprovals,
    };
  }
  return state;
}

export async function reject<Ctx>(
  state: RunState<Ctx>,
  interruption: Interruption<Ctx>,
  additionalContext?: Record<string, any>,
  config?: RunConfig<Ctx>
): Promise<RunState<Ctx>> {
  if (interruption.type === 'tool_approval') {
    const approvalValue = {
      status: 'rejected',
      approved: false,
      additionalContext: { ...(additionalContext || {}), status: 'rejected' },
    } as const;

    // Store in approval storage if available
    if (config?.approvalStorage) {
      const result = await config.approvalStorage.storeApproval(
        state.runId,
        interruption.toolCall.id,
        approvalValue
      );
      if (!result.success) {
        safeConsole.warn('Failed to store approval:', result.error);
        // Continue with in-memory fallback
      }
    }

    // Update in-memory state
    const newApprovals = new Map(state.approvals ?? []);
    newApprovals.set(interruption.toolCall.id, approvalValue);
    return {
      ...state,
      approvals: newApprovals,
    };
  }
  return state;
}

// Helper function to load approvals from storage into state
export async function loadApprovalsIntoState<Ctx>(
  state: RunState<Ctx>,
  config?: RunConfig<Ctx>
): Promise<RunState<Ctx>> {
  if (!config?.approvalStorage) {
    return state;
  }

  const result = await config.approvalStorage.getRunApprovals(state.runId);
  if (result.success) {
    return {
      ...state,
      approvals: result.data,
    };
  } else {
    safeConsole.warn('Failed to load approvals:', result.error);
    return state;
  }
}
