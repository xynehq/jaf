export * from './core/types';
export * from './core/engine';
export * from './core/tracing';
export * from './core/errors';
export * from './core/tool-results';

export * from './providers/model';
// export * from './providers/mcp'; // Commented out for test compatibility

export * from './policies/validation';
export * from './policies/handoff';

export * from './server';

import { v4 as uuidv4 } from 'uuid';
import { TraceId, RunId, createTraceId, createRunId } from './core/types';

export function generateTraceId(): TraceId {
  return createTraceId(uuidv4());
}

export function generateRunId(): RunId {
  return createRunId(uuidv4());
}