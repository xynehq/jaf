import { RunState, Interruption, RunConfig, ClarificationInterruption } from './types';
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

/**
 * Provide clarification selection for a clarification request
 */
export async function provideClarification<Ctx>(
  state: RunState<Ctx>,
  interruption: ClarificationInterruption<Ctx>,
  selectedOption: string,
  additionalContext?: Record<string, any>,
  config?: RunConfig<Ctx>
): Promise<RunState<Ctx>> {
  if (interruption.type === 'clarification_required') {
    const clarificationValue = {
      selectedOption,
      additionalContext: {
        timestamp: new Date().toISOString(),
        ...(additionalContext || {})
      }
    };

    // Store in clarification storage if available
    if (config?.clarificationStorage) {
      const result = await config.clarificationStorage.storeClarification(
        state.runId,
        interruption.clarificationId,
        clarificationValue
      );
      if (!result.success) {
        safeConsole.warn('Failed to store clarification:', result.error);
        // Continue with in-memory fallback
      }
    }

    // Update in-memory state
    const newClarifications = new Map(state.clarifications ?? []);
    newClarifications.set(interruption.clarificationId, selectedOption);
    return {
      ...state,
      clarifications: newClarifications,
    };
  }
  return state;
}

/**
 * Helper function to load clarifications from storage into state
 * This is called automatically by the engine when resuming a run
 */
export async function loadClarificationsIntoState<Ctx>(
  state: RunState<Ctx>,
  config?: RunConfig<Ctx>
): Promise<RunState<Ctx>> {
  if (!config?.clarificationStorage) {
    return state;
  }

  const result = await config.clarificationStorage.getRunClarifications(state.runId);
  if (result.success) {
    return {
      ...state,
      clarifications: result.data,
    };
  } else {
    safeConsole.warn('Failed to load clarifications:', result.error);
    return state;
  }
}
