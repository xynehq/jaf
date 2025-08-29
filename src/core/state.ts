import { RunState, Interruption } from './types';

export function approve<Ctx>(
  state: RunState<Ctx>,
  interruption: Interruption<Ctx>,
): RunState<Ctx> {
  if (interruption.type === 'tool_approval') {
    const newApprovals = new Map(state.approvals);
    newApprovals.set(interruption.toolCall.id, true);
    return {
      ...state,
      approvals: newApprovals,
    };
  }
  return state;
}

export function reject<Ctx>(
  state: RunState<Ctx>,
  interruption: Interruption<Ctx>,
): RunState<Ctx> {
  if (interruption.type === 'tool_approval') {
    const newApprovals = new Map(state.approvals);
    newApprovals.set(interruption.toolCall.id, false);
    return {
      ...state,
      approvals: newApprovals,
    };
  }
  return state;
}
