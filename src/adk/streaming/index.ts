/**
 * JAF ADK Layer - Streaming System
 *
 * Functional streaming and live interaction utilities
 */

import {
  LiveRequestQueue,
  Content,
  AgentEvent,
  AgentEventType,
  StreamConfig,
  ResponseModality,
  FunctionCall,
  FunctionResponse
} from '../types';
import { safeConsole } from '../../utils/logger.js';

// ========== Live Request Queue ==========

const generateQueueId = (): string => {
  // Use crypto-based ID generation for pure functional approach
  return `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const createLiveRequestQueue = (): LiveRequestQueue => {
  const id = generateQueueId();
  let queueState = {
    items: [] as Content[],
    closed: false
  };
  
  return {
    id,
    
    enqueue: async (message: Content): Promise<void> => {
      if (queueState.closed) {
        throw new Error('Queue is closed');
      }
      // Create new state with immutable update
      queueState = {
        ...queueState,
        items: [...queueState.items, message]
      };
    },
    
    dequeue: async (): Promise<Content | null> => {
      if (queueState.items.length === 0) {
        return null;
      }
      
      const [first, ...rest] = queueState.items;
      // Create new state with immutable update
      queueState = {
        ...queueState,
        items: rest
      };
      
      return first;
    },
    
    isEmpty: (): boolean => {
      return queueState.items.length === 0;
    },
    
    close: (): void => {
      queueState = {
        ...queueState,
        closed: true
      };
    }
  };
};

// ========== Event Creation ==========

export const createAgentEvent = (
  type: AgentEventType,
  data?: {
    content?: Content;
    functionCall?: FunctionCall;
    functionResponse?: FunctionResponse;
    error?: string;
    metadata?: Record<string, unknown>;
  }
): AgentEvent => ({
  type,
  timestamp: new Date(),
  content: data?.content,
  functionCall: data?.functionCall,
  functionResponse: data?.functionResponse,
  error: data?.error,
  metadata: data?.metadata
});

export const createMessageStartEvent = (content?: Content): AgentEvent =>
  createAgentEvent('message_start', { content });

export const createMessageDeltaEvent = (content: Content): AgentEvent =>
  createAgentEvent('message_delta', { content });

export const createMessageCompleteEvent = (content?: Content): AgentEvent =>
  createAgentEvent('message_complete', { content });

export const createFunctionCallStartEvent = (functionCall: FunctionCall): AgentEvent =>
  createAgentEvent('function_call_start', { functionCall });

export const createFunctionCallCompleteEvent = (functionResponse: FunctionResponse): AgentEvent =>
  createAgentEvent('function_call_complete', { functionResponse });

export const createAgentTransferEvent = (targetAgent: string, metadata?: Record<string, unknown>): AgentEvent =>
  createAgentEvent('agent_transfer', { metadata: { ...metadata, targetAgent } });

export const createConversationEndEvent = (metadata?: Record<string, unknown>): AgentEvent =>
  createAgentEvent('conversation_end', { metadata });

export const createErrorEvent = (error: string, metadata?: Record<string, unknown>): AgentEvent =>
  createAgentEvent('error', { error, metadata });

// ========== Stream Utilities ==========

export const streamToQueue = async (
  stream: AsyncGenerator<AgentEvent>,
  queue: LiveRequestQueue
): Promise<void> => {
  try {
    for await (const event of stream) {
      if (event.content) {
        await queue.enqueue(event.content);
      }
    }
  } finally {
    queue.close();
  }
};

export const queueToStream = async function* (
  queue: LiveRequestQueue
): AsyncGenerator<AgentEvent> {
  // Read the queue's state to check if it's closed
  // For now, we'll process until the queue is empty
  while (!queue.isEmpty()) {
    const message = await queue.dequeue();
    
    if (message) {
      yield createMessageDeltaEvent(message);
    } else {
      break; // Queue is empty
    }
  }
};

export const combineStreams = async function* (
  ...streams: AsyncGenerator<AgentEvent>[]
): AsyncGenerator<AgentEvent> {
  if (streams.length === 0) {
    return;
  }

  // Collect all events from all streams concurrently
  const streamPromises = streams.map(async (stream) => {
    const events: AgentEvent[] = [];
    try {
      for await (const event of stream) {
        events.push(event);
      }
    } catch (error) {
      events.push(createErrorEvent(`Stream error: ${error instanceof Error ? error.message : String(error)}`));
    }
    return events;
  });

  try {
    const allStreamEvents = await Promise.all(streamPromises);
    
    // Flatten all events and yield them
    // This gives us all events from all streams, though not in real-time order
    for (const streamEvents of allStreamEvents) {
      for (const event of streamEvents) {
        yield event;
      }
    }
  } catch (error) {
    yield createErrorEvent(`Combined stream error: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const filterEventStream = async function* (
  stream: AsyncGenerator<AgentEvent>,
  predicate: (event: AgentEvent) => boolean
): AsyncGenerator<AgentEvent> {
  for await (const event of stream) {
    if (predicate(event)) {
      yield event;
    }
  }
};

export const mapEventStream = async function* <T>(
  stream: AsyncGenerator<AgentEvent>,
  mapper: (event: AgentEvent) => T
): AsyncGenerator<T> {
  for await (const event of stream) {
    yield mapper(event);
  }
};

// ========== Stream Configuration ==========

export const createStreamConfig = (
  responseModalities: ResponseModality[] = ['TEXT'],
  options?: {
    bufferSize?: number;
    timeout?: number;
  }
): StreamConfig => ({
  responseModalities,
  bufferSize: options?.bufferSize || 1000,
  timeout: options?.timeout || 30000
});

export const createTextStreamConfig = (): StreamConfig =>
  createStreamConfig(['TEXT']);

export const createAudioStreamConfig = (): StreamConfig =>
  createStreamConfig(['AUDIO']);

export const createMultiModalStreamConfig = (): StreamConfig =>
  createStreamConfig(['TEXT', 'AUDIO', 'IMAGE']);

// ========== Buffered Streaming ==========

export const createBufferedStream = async function* (
  stream: AsyncGenerator<AgentEvent>,
  bufferSize: number = 10
): AsyncGenerator<AgentEvent[]> {
  let buffer: AgentEvent[] = [];
  
  for await (const event of stream) {
    buffer.push(event);
    
    if (buffer.length >= bufferSize) {
      yield [...buffer];
      buffer = [];
    }
  }
  
  // Yield remaining events
  if (buffer.length > 0) {
    yield buffer;
  }
};

export const createThrottledStream = async function* (
  stream: AsyncGenerator<AgentEvent>,
  intervalMs: number = 100
): AsyncGenerator<AgentEvent> {
  let lastEmit = 0;
  
  for await (const event of stream) {
    const now = Date.now();
    
    if (now - lastEmit >= intervalMs) {
      yield event;
      lastEmit = now;
    } else {
      // Wait for the remaining time
      const waitTime = intervalMs - (now - lastEmit);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      yield event;
      lastEmit = Date.now();
    }
  }
};

export const createDebouncedStream = async function* (
  stream: AsyncGenerator<AgentEvent>,
  delayMs: number = 200
): AsyncGenerator<AgentEvent> {
  let timeoutId: NodeJS.Timeout | null = null;
  let pendingEvent: AgentEvent | null = null;
  
  for await (const event of stream) {
    pendingEvent = event;
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      if (pendingEvent) {
        // This won't work directly in a generator
        // In a real implementation, you'd need a different approach
        // such as using a queue or event emitter
      }
    }, delayMs);
  }
  
  // Clean up
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  
  if (pendingEvent) {
    yield pendingEvent;
  }
};

// ========== Event Processing ==========

export const collectEvents = async (
  stream: AsyncGenerator<AgentEvent>,
  predicate?: (event: AgentEvent) => boolean
): Promise<AgentEvent[]> => {
  const events: AgentEvent[] = [];
  
  for await (const event of stream) {
    if (!predicate || predicate(event)) {
      events.push(event);
    }
  }
  
  return events;
};

export const findFirstEvent = async (
  stream: AsyncGenerator<AgentEvent>,
  predicate: (event: AgentEvent) => boolean
): Promise<AgentEvent | null> => {
  for await (const event of stream) {
    if (predicate(event)) {
      return event;
    }
  }
  
  return null;
};

export const waitForEvent = async (
  stream: AsyncGenerator<AgentEvent>,
  type: AgentEventType,
  timeout?: number
): Promise<AgentEvent | null> => {
  if (!timeout) {
    // No timeout, iterate normally
    for await (const event of stream) {
      if (event.type === type) {
        return event;
      }
    }
    return null;
  }

  // Use Promise.race to handle timeout properly
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeout);
  });

  const streamPromise = (async () => {
    for await (const event of stream) {
      if (event.type === type) {
        return event;
      }
    }
    return null;
  })();

  return await Promise.race([streamPromise, timeoutPromise]);
};

export const countEvents = async (
  stream: AsyncGenerator<AgentEvent>,
  predicate?: (event: AgentEvent) => boolean
): Promise<number> => {
  let count = 0;
  
  for await (const event of stream) {
    if (!predicate || predicate(event)) {
      count++;
    }
  }
  
  return count;
};

// ========== Event Type Filters ==========

export const isMessageEvent = (event: AgentEvent): boolean =>
  ['message_start', 'message_delta', 'message_complete'].includes(event.type);

export const isFunctionEvent = (event: AgentEvent): boolean =>
  ['function_call_start', 'function_call_complete'].includes(event.type);

export const isControlEvent = (event: AgentEvent): boolean =>
  ['agent_transfer', 'conversation_end'].includes(event.type);

export const isErrorEvent = (event: AgentEvent): boolean =>
  event.type === 'error';

export const filterMessageEvents = (stream: AsyncGenerator<AgentEvent>) =>
  filterEventStream(stream, isMessageEvent);

export const filterFunctionEvents = (stream: AsyncGenerator<AgentEvent>) =>
  filterEventStream(stream, isFunctionEvent);

export const filterControlEvents = (stream: AsyncGenerator<AgentEvent>) =>
  filterEventStream(stream, isControlEvent);

export const filterErrorEvents = (stream: AsyncGenerator<AgentEvent>) =>
  filterEventStream(stream, isErrorEvent);

// ========== Stream Monitoring ==========

export const monitorStream = async function* (
  stream: AsyncGenerator<AgentEvent>,
  monitor: (event: AgentEvent) => void
): AsyncGenerator<AgentEvent> {
  for await (const event of stream) {
    try {
      monitor(event);
    } catch (error) {
      // Monitor errors shouldn't break the stream
      safeConsole.warn('Stream monitor error:', error);
    }

    yield event;
  }
};

export const logStream = (prefix: string = 'STREAM') =>
  (event: AgentEvent) => {
    safeConsole.log(`[${prefix}] ${event.type}:`, {
      timestamp: event.timestamp,
      content: event.content ? 'present' : 'none',
      error: event.error,
      metadata: event.metadata
    });
  };

export const metricsMonitor = () => {
  const metrics = {
    eventCount: 0,
    eventsByType: {} as Record<AgentEventType, number>,
    errors: 0,
    startTime: Date.now(),
    firstEventTime: null as number | null,
    lastEventTime: null as number | null
  };
  
  return {
    monitor: (event: AgentEvent) => {
      const now = Date.now();
      
      if (metrics.firstEventTime === null) {
        metrics.firstEventTime = now;
      }
      metrics.lastEventTime = now;
      
      metrics.eventCount++;
      metrics.eventsByType[event.type] = (metrics.eventsByType[event.type] || 0) + 1;
      
      if (event.type === 'error') {
        metrics.errors++;
      }
    },
    
    getMetrics: () => {
      // Calculate duration based on actual event processing time if available
      const duration = metrics.firstEventTime && metrics.lastEventTime
        ? metrics.lastEventTime - metrics.firstEventTime
        : Date.now() - metrics.startTime;
      
      return {
        ...metrics,
        duration: Math.max(duration, 0), // Ensure non-negative duration
        eventsPerSecond: metrics.eventCount > 0 && duration > 0
          ? metrics.eventCount / (duration / 1000)
          : 0
      };
    }
  };
};

// ========== Stream Error Handling ==========

export const withStreamErrorHandling = async function* (
  stream: AsyncGenerator<AgentEvent>,
  errorHandler?: (error: Error) => AgentEvent | null
): AsyncGenerator<AgentEvent> {
  try {
    for await (const event of stream) {
      yield event;
    }
  } catch (error) {
    const handledEvent = errorHandler ? 
      errorHandler(error as Error) : 
      createErrorEvent(`Stream error: ${(error as Error).message}`);
    
    if (handledEvent) {
      yield handledEvent;
    }
  }
};

export const retryStream = async function* (
  streamFactory: () => AsyncGenerator<AgentEvent>,
  maxRetries: number = 3,
  delayMs: number = 1000
): AsyncGenerator<AgentEvent> {
  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      const stream = streamFactory();
      
      for await (const event of stream) {
        yield event;
      }
      
      return; // Success, exit
      
    } catch (error) {
      retries++;
      
      if (retries > maxRetries) {
        yield createErrorEvent(`Stream failed after ${maxRetries} retries: ${(error as Error).message}`);
        return;
      }
      
      yield createErrorEvent(`Stream error (retry ${retries}/${maxRetries}): ${(error as Error).message}`);
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delayMs * retries));
    }
  }
};

// ========== Bidirectional Streaming ==========

export interface BidirectionalStream {
  send: (message: Content) => Promise<void>;
  receive: () => AsyncGenerator<AgentEvent>;
  close: () => void;
}

export const createBidirectionalStream = (): BidirectionalStream => {
  const inputQueue = createLiveRequestQueue();
  const outputQueue = createLiveRequestQueue();
  let closed = false;
  
  return {
    send: async (message: Content) => {
      await inputQueue.enqueue(message);
      // For demo purposes, echo the message to the output queue
      await outputQueue.enqueue(message);
    },
    
    receive: async function* () {
      while (!closed) {
        const message = await outputQueue.dequeue();
        if (message) {
          yield createMessageDeltaEvent(message);
        } else if (outputQueue.isEmpty() && closed) {
          break;
        } else {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    },
    
    close: () => {
      closed = true;
      inputQueue.close();
      outputQueue.close();
    }
  };
};

// ========== Stream Utilities ==========

export const streamToArray = async <T>(
  stream: AsyncGenerator<T>
): Promise<T[]> => {
  const results: T[] = [];
  
  for await (const item of stream) {
    results.push(item);
  }
  
  return results;
};

export const takeFromStream = async function* <T>(
  stream: AsyncGenerator<T>,
  count: number
): AsyncGenerator<T> {
  let taken = 0;
  
  for await (const item of stream) {
    if (taken >= count) {
      break;
    }
    
    yield item;
    taken++;
  }
};

export const skipFromStream = async function* <T>(
  stream: AsyncGenerator<T>,
  count: number
): AsyncGenerator<T> {
  let skipped = 0;
  
  for await (const item of stream) {
    if (skipped < count) {
      skipped++;
      continue;
    }
    
    yield item;
  }
};