export * from './core/types.js';
export * from './core/engine.js';
export * from './core/tracing.js';
export * from './core/errors.js';
export * from './core/tool-results.js';
export * from './core/agent-as-tool.js';

export * from './providers/model.js';
// export * from './providers/mcp.js'; // Commented out for test compatibility

export * from './policies/validation.js';
export * from './policies/handoff.js';

export * from './server/index.js';

// Built-in tools
export * from './tools/index.js';

// Memory providers
export * from './memory/types.js';
export * from './memory/factory.js';
export * from './memory/providers/in-memory.js';
export * from './memory/providers/redis.js';
export * from './memory/providers/postgres.js';

// A2A Protocol Support
export * from './a2a/index.js';

// ADK Layer - Functional Agent Development Kit
// Re-export specific ADK modules to avoid conflicts
export * as ADK from './adk/index.js';

import { v4 as uuidv4 } from 'uuid';
import { TraceId, RunId, createTraceId, createRunId } from './core/types.js';

export function generateTraceId(): TraceId {
  return createTraceId(uuidv4());
}

export function generateRunId(): RunId {
  return createRunId(uuidv4());
}
