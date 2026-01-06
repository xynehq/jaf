/**
 * JAF Streaming - Event Handler Integration
 * 
 * Provides integration between JAF's onEvent system and StreamProviders
 */

import { TraceEvent } from '../core/types.js';
import {
  StreamProvider,
  StreamEvent,
  StreamOutputConfig,
  StreamError,
  DEFAULT_STREAM_OUTPUT_CONFIG,
  isStreamFailure
} from './types.js';
import { safeConsole } from '../utils/logger.js';

/**
 * Create a stream event from a JAF TraceEvent
 */
const createStreamEvent = (
  event: TraceEvent,
  config: StreamOutputConfig<unknown>
): StreamEvent => {
  // Determine event type (use mapping if provided)
  const eventType = config.eventMapping?.[event.type] ?? event.type;
  
  // Transform data if transformer provided
  const eventData = event.data as Record<string, unknown>;
  const data = config.eventTransformer 
    ? config.eventTransformer(event)
    : eventData;
  
  // Extract traceId and runId from data (JAF stores them inside data)
  const traceId = eventData?.traceId as string | undefined;
  const runId = eventData?.runId as string | undefined;
  const agentName = eventData?.agentName as string | undefined;
  
  return {
    eventType,
    data,
    timestamp: new Date().toISOString(),
    metadata: {
      traceId,
      runId,
      agentName
    }
  };
};

/**
 * Extract session ID from context or event
 */
const extractSessionId = <Ctx>(
  config: StreamOutputConfig<Ctx>,
  context: Ctx,
  event: TraceEvent
): string | undefined => {
  if (typeof config.sessionId === 'string') {
    return config.sessionId;
  }
  
  if (typeof config.sessionId === 'function') {
    return config.sessionId(context, event);
  }
  
  return undefined;
};

/**
 * Create an onEvent handler that streams events to a StreamProvider
 * 
 * @example
 * ```typescript
 * const streamProvider = createInMemoryStreamProvider();
 * 
 * const config: RunConfig<MyContext> = {
 *   agentRegistry,
 *   modelProvider,
 *   onEvent: withStreamOutput(streamProvider, {
 *     sessionId: (ctx) => ctx.sessionId,
 *     eventFilter: (event) => ['tool_call_start', 'tool_call_end'].includes(event.type)
 *   })
 * };
 * ```
 */
export function withStreamOutput<Ctx = unknown>(
  provider: StreamProvider,
  config: StreamOutputConfig<Ctx>
): (event: TraceEvent, context?: Ctx) => void {
  const mergedConfig: StreamOutputConfig<Ctx> = {
    ...DEFAULT_STREAM_OUTPUT_CONFIG,
    ...config
  };
  
  return (event: TraceEvent, context?: Ctx): void => {
    // Apply event filter if provided
    if (mergedConfig.eventFilter && !mergedConfig.eventFilter(event)) {
      return;
    }
    
    // Extract session ID
    const sessionId = extractSessionId(mergedConfig, context as Ctx, event);
    if (!sessionId) {
      safeConsole.warn(
        `[JAF:STREAM] No session ID for event ${event.type}. ` +
        `Provide sessionId in config or ensure context has sessionId.`
      );
      return;
    }
    
    // Create stream event
    const streamEvent = createStreamEvent(event, mergedConfig as StreamOutputConfig<unknown>);
    
    // Push to stream (fire and forget by default)
    const pushPromise = provider.push(sessionId, streamEvent);
    
    if (mergedConfig.blocking) {
      // Blocking mode - wait for push to complete
      pushPromise.then(result => {
        if (isStreamFailure(result)) {
          mergedConfig.onPushError?.(result.error, event, sessionId);
        } else {
          mergedConfig.onPushSuccess?.(event, sessionId);
        }
      }).catch(error => {
        const streamError: StreamError = {
          _tag: 'StreamError',
          message: error instanceof Error ? error.message : String(error),
          code: 'PUSH_FAILED',
          provider: provider.name,
          cause: error instanceof Error ? error : undefined
        };
        mergedConfig.onPushError?.(streamError, event, sessionId);
      });
    } else {
      // Fire and forget - don't block the event handler
      pushPromise.then(result => {
        if (isStreamFailure(result)) {
          mergedConfig.onPushError?.(result.error, event, sessionId);
        } else {
          mergedConfig.onPushSuccess?.(event, sessionId);
        }
      }).catch(error => {
        // Log error but don't throw
        safeConsole.error(
          `[JAF:STREAM] Failed to push event ${event.type} to stream: ${error}`
        );
        const streamError: StreamError = {
          _tag: 'StreamError',
          message: error instanceof Error ? error.message : String(error),
          code: 'PUSH_FAILED',
          provider: provider.name,
          cause: error instanceof Error ? error : undefined
        };
        mergedConfig.onPushError?.(streamError, event, sessionId);
      });
    }
  };
}

/**
 * Compose multiple event handlers into a single handler
 * 
 * @example
 * ```typescript
 * const config: RunConfig<MyContext> = {
 *   onEvent: composeEventHandlers([
 *     withStreamOutput(redisProvider, { sessionId: ctx => ctx.sessionId }),
 *     consoleTracer,
 *     metricsHandler
 *   ])
 * };
 * ```
 */
export function composeEventHandlers<Ctx = unknown>(
  handlers: ReadonlyArray<(event: TraceEvent, context?: Ctx) => void>
): (event: TraceEvent, context?: Ctx) => void {
  return (event: TraceEvent, context?: Ctx): void => {
    for (const handler of handlers) {
      try {
        handler(event, context);
      } catch (error) {
        // Log error but continue with other handlers
        safeConsole.error(
          `[JAF:STREAM] Event handler error: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  };
}

/**
 * Create a console logging event handler (for debugging)
 * 
 * @example
 * ```typescript
 * const config: RunConfig<MyContext> = {
 *   onEvent: composeEventHandlers([
 *     withStreamOutput(provider, config),
 *     createConsoleEventHandler({ 
 *       eventFilter: (e) => e.type === 'tool_call_start',
 *       pretty: true 
 *     })
 *   ])
 * };
 * ```
 */
export function createConsoleEventHandler(options?: {
  eventFilter?: (event: TraceEvent) => boolean;
  pretty?: boolean;
  prefix?: string;
}): (event: TraceEvent) => void {
  const { eventFilter, pretty = true, prefix = '[JAF:EVENT]' } = options ?? {};
  
  return (event: TraceEvent): void => {
    if (eventFilter && !eventFilter(event)) {
      return;
    }
    
    const output = pretty
      ? JSON.stringify(event, null, 2)
      : JSON.stringify(event);
    
    safeConsole.log(`${prefix} ${event.type}:`, output);
  };
}

/**
 * Filter events by type (flexible - accepts any string)
 * 
 * @example
 * ```typescript
 * const toolEvents = filterEventsByType(['tool_call_start', 'tool_call_end']);
 * ```
 */
export function filterEventsByType(
  types: ReadonlyArray<string>
): (event: TraceEvent) => boolean {
  const typeSet = new Set(types);
  return (event: TraceEvent): boolean => typeSet.has(event.type);
}

/**
 * Common event type filters
 * Note: Event types may vary by JAF version - these are common ones
 */
export const EventFilters = {
  /** All tool-related events */
  toolEvents: filterEventsByType([
    'tool_call_start',
    'tool_call_end',
    'before_tool_execution'
  ]),
  
  /** All message events */
  messageEvents: filterEventsByType([
    'assistant_message'
  ]),
  
  /** All control flow events */
  controlEvents: filterEventsByType([
    'run_start',
    'run_end',
    'turn_start',
    'turn_end',
    'handoff'
  ]),
  
  /** Events typically pushed to external streams (like your Python implementation) */
  externalStreamEvents: filterEventsByType([
    'tool_call_start',
    'tool_call_end',
    'assistant_message'
  ])
};

/**
 * Map event types to custom event names
 * 
 * @example
 * ```typescript
 * const mapping = createEventMapping({
 *   'tool_call_start': 'tool_input',
 *   'tool_call_end': 'tool_output',
 *   'assistant_message': 'agent_response'
 * });
 * ```
 */
export function createEventMapping(
  mapping: Record<string, string>
): Record<string, string> {
  return mapping;
}

/**
 * Common event mappings
 */
export const EventMappings = {
  /** Identity mapping (no change) */
  identity: createEventMapping({
    'tool_call_start': 'tool_call_start',
    'tool_call_end': 'tool_call_end',
    'assistant_message': 'assistant_message'
  })
};
