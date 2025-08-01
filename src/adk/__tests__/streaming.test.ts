/**
 * FAF ADK Layer - Streaming System Tests
 */

import {
  createLiveRequestQueue,
  createAgentEvent,
  createMessageStartEvent,
  createMessageDeltaEvent,
  createMessageCompleteEvent,
  createFunctionCallStartEvent,
  createFunctionCallCompleteEvent,
  createAgentTransferEvent,
  createConversationEndEvent,
  createErrorEvent,
  streamToQueue,
  queueToStream,
  combineStreams,
  filterEventStream,
  mapEventStream,
  createStreamConfig,
  createTextStreamConfig,
  createAudioStreamConfig,
  createMultiModalStreamConfig,
  createBufferedStream,
  createThrottledStream,
  collectEvents,
  findFirstEvent,
  waitForEvent,
  countEvents,
  isMessageEvent,
  isFunctionEvent,
  isControlEvent,
  isErrorEvent,
  filterMessageEvents,
  filterFunctionEvents,
  filterControlEvents,
  filterErrorEvents,
  monitorStream,
  logStream,
  metricsMonitor,
  withStreamErrorHandling,
  retryStream,
  createBidirectionalStream,
  streamToArray,
  takeFromStream,
  skipFromStream
} from '../streaming';

import { createUserMessage, createFunctionCall, createFunctionResponse } from '../content';
import { AgentEvent, AgentEventType } from '../types';

describe('Streaming System', () => {
  describe('Live Request Queue', () => {
    test('createLiveRequestQueue should create queue', () => {
      const queue = createLiveRequestQueue();
      
      expect(queue.id).toBeDefined();
      expect(queue.id).toMatch(/^queue_\d+_[a-z0-9]+$/);
      expect(queue.isEmpty()).toBe(true);
    });

    test('queue should handle enqueue and dequeue', async () => {
      const queue = createLiveRequestQueue();
      const message = createUserMessage('Hello');
      
      await queue.enqueue(message);
      expect(queue.isEmpty()).toBe(false);
      
      const dequeued = await queue.dequeue();
      expect(dequeued).toEqual(message);
      expect(queue.isEmpty()).toBe(true);
    });

    test('queue should return null when empty', async () => {
      const queue = createLiveRequestQueue();
      const result = await queue.dequeue();
      expect(result).toBeNull();
    });

    test('queue should handle multiple messages', async () => {
      const queue = createLiveRequestQueue();
      const message1 = createUserMessage('First');
      const message2 = createUserMessage('Second');
      
      await queue.enqueue(message1);
      await queue.enqueue(message2);
      
      expect(await queue.dequeue()).toEqual(message1);
      expect(await queue.dequeue()).toEqual(message2);
      expect(await queue.dequeue()).toBeNull();
    });

    test('queue should handle close', async () => {
      const queue = createLiveRequestQueue();
      
      queue.close();
      
      await expect(queue.enqueue(createUserMessage('Test')))
        .rejects.toThrow('Queue is closed');
    });
  });

  describe('Event Creation', () => {
    test('createAgentEvent should create basic event', () => {
      const event = createAgentEvent('message_start');
      
      expect(event.type).toBe('message_start');
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    test('createAgentEvent should accept data', () => {
      const content = createUserMessage('Test');
      const event = createAgentEvent('message_delta', { content });
      
      expect(event.type).toBe('message_delta');
      expect(event.content).toEqual(content);
    });

    test('createMessageStartEvent should create message start event', () => {
      const content = createUserMessage('Start');
      const event = createMessageStartEvent(content);
      
      expect(event.type).toBe('message_start');
      expect(event.content).toEqual(content);
    });

    test('createMessageDeltaEvent should create message delta event', () => {
      const content = createUserMessage('Delta');
      const event = createMessageDeltaEvent(content);
      
      expect(event.type).toBe('message_delta');
      expect(event.content).toEqual(content);
    });

    test('createMessageCompleteEvent should create message complete event', () => {
      const event = createMessageCompleteEvent();
      
      expect(event.type).toBe('message_complete');
    });

    test('createFunctionCallStartEvent should create function call start event', () => {
      const functionCall = createFunctionCall('call_1', 'test_func', {});
      const event = createFunctionCallStartEvent(functionCall);
      
      expect(event.type).toBe('function_call_start');
      expect(event.functionCall).toEqual(functionCall);
    });

    test('createFunctionCallCompleteEvent should create function call complete event', () => {
      const functionResponse = createFunctionResponse('call_1', 'test_func', 'result');
      const event = createFunctionCallCompleteEvent(functionResponse);
      
      expect(event.type).toBe('function_call_complete');
      expect(event.functionResponse).toEqual(functionResponse);
    });

    test('createAgentTransferEvent should create transfer event', () => {
      const event = createAgentTransferEvent('target_agent', { reason: 'delegation' });
      
      expect(event.type).toBe('agent_transfer');
      expect(event.metadata?.targetAgent).toBe('target_agent');
      expect(event.metadata?.reason).toBe('delegation');
    });

    test('createConversationEndEvent should create end event', () => {
      const event = createConversationEndEvent({ reason: 'completed' });
      
      expect(event.type).toBe('conversation_end');
      expect(event.metadata?.reason).toBe('completed');
    });

    test('createErrorEvent should create error event', () => {
      const event = createErrorEvent('Something went wrong', { context: 'test' });
      
      expect(event.type).toBe('error');
      expect(event.error).toBe('Something went wrong');
      expect(event.metadata?.context).toBe('test');
    });
  });

  describe('Stream Utilities', () => {
    async function* createMockEventStream(): AsyncGenerator<AgentEvent> {
      yield createMessageStartEvent();
      yield createMessageDeltaEvent(createUserMessage('Hello'));
      yield createMessageDeltaEvent(createUserMessage(' world'));
      yield createMessageCompleteEvent();
    }

    test('streamToQueue should transfer stream to queue', async () => {
      const queue = createLiveRequestQueue();
      const stream = createMockEventStream();
      
      await streamToQueue(stream, queue);
      
      expect(queue.isEmpty()).toBe(false);
      
      // Should have transferred messages (not start/complete events)
      const message1 = await queue.dequeue();
      const message2 = await queue.dequeue();
      
      expect(message1?.parts[0].text).toBe('Hello');
      expect(message2?.parts[0].text).toBe(' world');
    });

    test('queueToStream should convert queue to stream', async () => {
      const queue = createLiveRequestQueue();
      await queue.enqueue(createUserMessage('Test 1'));
      await queue.enqueue(createUserMessage('Test 2'));
      queue.close();
      
      const stream = queueToStream(queue);
      const events: AgentEvent[] = [];
      
      // Collect a few events (the stream would run indefinitely otherwise)
      let count = 0;
      for await (const event of stream) {
        events.push(event);
        count++;
        if (count >= 2) break;
      }
      
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('message_delta');
      expect(events[1].type).toBe('message_delta');
    });

    test('combineStreams should merge multiple streams', async () => {
      async function* stream1(): AsyncGenerator<AgentEvent> {
        yield createMessageDeltaEvent(createUserMessage('Stream 1'));
      }
      
      async function* stream2(): AsyncGenerator<AgentEvent> {
        yield createMessageDeltaEvent(createUserMessage('Stream 2'));
      }
      
      const combined = combineStreams(stream1(), stream2());
      const events = await streamToArray(combined);
      
      expect(events).toHaveLength(2);
      expect(events.some(e => e.content?.parts[0].text === 'Stream 1')).toBe(true);
      expect(events.some(e => e.content?.parts[0].text === 'Stream 2')).toBe(true);
    });

    test('filterEventStream should filter events', async () => {
      const stream = createMockEventStream();
      const filtered = filterEventStream(stream, isMessageEvent);
      const events = await streamToArray(filtered);
      
      expect(events.every(isMessageEvent)).toBe(true);
      expect(events).toHaveLength(4); // start, 2 deltas, complete
    });

    test('mapEventStream should transform events', async () => {
      const stream = createMockEventStream();
      const mapped = mapEventStream(stream, event => event.type);
      const types = await streamToArray(mapped);
      
      expect(types).toEqual([
        'message_start',
        'message_delta',
        'message_delta',
        'message_complete'
      ]);
    });
  });

  describe('Stream Configuration', () => {
    test('createStreamConfig should create config with defaults', () => {
      const config = createStreamConfig(['TEXT']);
      
      expect(config.responseModalities).toEqual(['TEXT']);
      expect(config.bufferSize).toBe(1000);
      expect(config.timeout).toBe(30000);
    });

    test('createStreamConfig should accept options', () => {
      const config = createStreamConfig(['AUDIO'], {
        bufferSize: 500,
        timeout: 60000
      });
      
      expect(config.responseModalities).toEqual(['AUDIO']);
      expect(config.bufferSize).toBe(500);
      expect(config.timeout).toBe(60000);
    });

    test('createTextStreamConfig should create text config', () => {
      const config = createTextStreamConfig();
      expect(config.responseModalities).toEqual(['TEXT']);
    });

    test('createAudioStreamConfig should create audio config', () => {
      const config = createAudioStreamConfig();
      expect(config.responseModalities).toEqual(['AUDIO']);
    });

    test('createMultiModalStreamConfig should create multi-modal config', () => {
      const config = createMultiModalStreamConfig();
      expect(config.responseModalities).toEqual(['TEXT', 'AUDIO', 'IMAGE']);
    });
  });

  describe('Buffered Streaming', () => {
    async function* createNumberStream(): AsyncGenerator<AgentEvent> {
      for (let i = 1; i <= 10; i++) {
        yield createMessageDeltaEvent(createUserMessage(i.toString()));
      }
    }

    test('createBufferedStream should buffer events', async () => {
      const stream = createNumberStream();
      const buffered = createBufferedStream(stream, 3);
      
      const buffers: AgentEvent[][] = [];
      for await (const buffer of buffered) {
        buffers.push(buffer);
      }
      
      expect(buffers).toHaveLength(4); // 3 full buffers + 1 partial
      expect(buffers[0]).toHaveLength(3);
      expect(buffers[1]).toHaveLength(3);
      expect(buffers[2]).toHaveLength(3);
      expect(buffers[3]).toHaveLength(1);
    });

    test('createThrottledStream should throttle events', async () => {
      const stream = createNumberStream();
      const throttled = createThrottledStream(stream, 50);
      
      const startTime = Date.now();
      const events = await streamToArray(throttled);
      const endTime = Date.now();
      
      expect(events).toHaveLength(10);
      expect(endTime - startTime).toBeGreaterThan(450); // At least 9 * 50ms delays
    });
  });

  describe('Event Processing', () => {
    async function* createMixedEventStream(): AsyncGenerator<AgentEvent> {
      yield createMessageStartEvent();
      yield createFunctionCallStartEvent(createFunctionCall('1', 'test', {}));
      yield createMessageDeltaEvent(createUserMessage('Text'));
      yield createFunctionCallCompleteEvent(createFunctionResponse('1', 'test', 'result'));
      yield createErrorEvent('Test error');
      yield createMessageCompleteEvent();
    }

    test('collectEvents should collect all events', async () => {
      const stream = createMixedEventStream();
      const events = await collectEvents(stream);
      
      expect(events).toHaveLength(6);
    });

    test('collectEvents should filter with predicate', async () => {
      const stream = createMixedEventStream();
      const messageEvents = await collectEvents(stream, isMessageEvent);
      
      expect(messageEvents.every(isMessageEvent)).toBe(true);
      expect(messageEvents).toHaveLength(3);
    });

    test('findFirstEvent should find first matching event', async () => {
      const stream = createMixedEventStream();
      const firstError = await findFirstEvent(stream, isErrorEvent);
      
      expect(firstError).not.toBeNull();
      expect(firstError?.type).toBe('error');
    });

    test('findFirstEvent should return null if not found', async () => {
      async function* emptyStream(): AsyncGenerator<AgentEvent> {
        yield createMessageDeltaEvent(createUserMessage('Test'));
      }
      
      const stream = emptyStream();
      const result = await findFirstEvent(stream, isErrorEvent);
      
      expect(result).toBeNull();
    });

    test('waitForEvent should wait for specific event type', async () => {
      const stream = createMixedEventStream();
      const errorEvent = await waitForEvent(stream, 'error');
      
      expect(errorEvent).not.toBeNull();
      expect(errorEvent?.type).toBe('error');
    });

    test('waitForEvent should respect timeout', async () => {
      async function* slowStream(): AsyncGenerator<AgentEvent> {
        await new Promise(resolve => setTimeout(resolve, 200));
        yield createErrorEvent('Late error');
      }
      
      const stream = slowStream();
      const result = await waitForEvent(stream, 'error', 100);
      
      expect(result).toBeNull();
    });

    test('countEvents should count all events', async () => {
      const stream = createMixedEventStream();
      const count = await countEvents(stream);
      
      expect(count).toBe(6);
    });

    test('countEvents should count with predicate', async () => {
      const stream = createMixedEventStream();
      const messageCount = await countEvents(stream, isMessageEvent);
      
      expect(messageCount).toBe(3);
    });
  });

  describe('Event Type Filters', () => {
    const events: AgentEvent[] = [
      createMessageStartEvent(),
      createMessageDeltaEvent(createUserMessage('Test')),
      createFunctionCallStartEvent(createFunctionCall('1', 'test', {})),
      createAgentTransferEvent('target'),
      createErrorEvent('Error'),
      createMessageCompleteEvent()
    ];

    test('isMessageEvent should identify message events', () => {
      const messageEvents = events.filter(isMessageEvent);
      expect(messageEvents).toHaveLength(3);
    });

    test('isFunctionEvent should identify function events', () => {
      const functionEvents = events.filter(isFunctionEvent);
      expect(functionEvents).toHaveLength(1);
    });

    test('isControlEvent should identify control events', () => {
      const controlEvents = events.filter(isControlEvent);
      expect(controlEvents).toHaveLength(1);
    });

    test('isErrorEvent should identify error events', () => {
      const errorEvents = events.filter(isErrorEvent);
      expect(errorEvents).toHaveLength(1);
    });

    test('filter functions should work with streams', async () => {
      async function* eventStream(): AsyncGenerator<AgentEvent> {
        for (const event of events) {
          yield event;
        }
      }
      
      const messageEvents = await streamToArray(filterMessageEvents(eventStream()));
      const functionEvents = await streamToArray(filterFunctionEvents(eventStream()));
      const controlEvents = await streamToArray(filterControlEvents(eventStream()));
      const errorEvents = await streamToArray(filterErrorEvents(eventStream()));
      
      expect(messageEvents).toHaveLength(3);
      expect(functionEvents).toHaveLength(1);
      expect(controlEvents).toHaveLength(1);
      expect(errorEvents).toHaveLength(1);
    });
  });

  describe('Stream Monitoring', () => {
    test('monitorStream should call monitor function', async () => {
      const monitorCalls: AgentEvent[] = [];
      const monitor = (event: AgentEvent) => {
        monitorCalls.push(event);
      };
      
      async function* testStream(): AsyncGenerator<AgentEvent> {
        yield createMessageDeltaEvent(createUserMessage('Test 1'));
        yield createMessageDeltaEvent(createUserMessage('Test 2'));
      }
      
      const monitored = monitorStream(testStream(), monitor);
      const events = await streamToArray(monitored);
      
      expect(events).toHaveLength(2);
      expect(monitorCalls).toHaveLength(2);
      expect(monitorCalls).toEqual(events);
    });

    test('monitorStream should handle monitor errors gracefully', async () => {
      const monitor = () => {
        throw new Error('Monitor error');
      };
      
      async function* testStream(): AsyncGenerator<AgentEvent> {
        yield createMessageDeltaEvent(createUserMessage('Test'));
      }
      
      const monitored = monitorStream(testStream(), monitor);
      const events = await streamToArray(monitored);
      
      // Should still yield events despite monitor errors
      expect(events).toHaveLength(1);
    });

    test('logStream should create logger function', () => {
      const logger = logStream('TEST');
      const event = createMessageDeltaEvent(createUserMessage('Test'));
      
      // Mock console.log to capture output
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      logger(event);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        '[TEST] message_delta:',
        expect.objectContaining({
          timestamp: expect.any(Date),
          content: 'present'
        })
      );
      
      consoleSpy.mockRestore();
    });

    test('metricsMonitor should track metrics', async () => {
      const monitor = metricsMonitor();
      
      monitor.monitor(createMessageDeltaEvent(createUserMessage('Test')));
      
      // Add a small delay between events to ensure duration tracking
      await new Promise(resolve => setTimeout(resolve, 10));
      
      monitor.monitor(createErrorEvent('Error'));
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      monitor.monitor(createMessageCompleteEvent());
      
      const metrics = monitor.getMetrics();
      
      expect(metrics.eventCount).toBe(3);
      expect(metrics.eventsByType.message_delta).toBe(1);
      expect(metrics.eventsByType.error).toBe(1);
      expect(metrics.eventsByType.message_complete).toBe(1);
      expect(metrics.errors).toBe(1);
      expect(metrics.duration).toBeGreaterThanOrEqual(20);
    });
  });

  describe('Stream Error Handling', () => {
    test('withStreamErrorHandling should catch stream errors', async () => {
      async function* errorStream(): AsyncGenerator<AgentEvent> {
        yield createMessageDeltaEvent(createUserMessage('Before error'));
        throw new Error('Stream error');
      }
      
      const handled = withStreamErrorHandling(errorStream());
      const events = await streamToArray(handled);
      
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('message_delta');
      expect(events[1].type).toBe('error');
      expect(events[1].error).toBe('Stream error: Stream error');
    });

    test('withStreamErrorHandling should use custom error handler', async () => {
      async function* errorStream(): AsyncGenerator<AgentEvent> {
        throw new Error('Custom error');
        yield createMessageDeltaEvent(createUserMessage('This will not run'));
      }
      
      const customHandler = (error: Error) => 
        createErrorEvent(`Custom: ${error.message}`);
      
      const handled = withStreamErrorHandling(errorStream(), customHandler);
      const events = await streamToArray(handled);
      
      expect(events).toHaveLength(1);
      expect(events[0].error).toBe('Custom: Custom error');
    });

    test('retryStream should retry failed streams', async () => {
      let attempts = 0;
      
      const streamFactory = async function* (): AsyncGenerator<AgentEvent> {
        attempts++;
        if (attempts < 3) {
          throw new Error(`Attempt ${attempts} failed`);
        }
        yield createMessageDeltaEvent(createUserMessage('Success'));
      };
      
      const retried = retryStream(streamFactory, 3, 10);
      const events = await streamToArray(retried);
      
      expect(attempts).toBe(3);
      expect(events.some(e => e.type === 'message_delta')).toBe(true);
      expect(events.some(e => e.type === 'error')).toBe(true); // Retry errors
    });

    test('retryStream should give up after max retries', async () => {
      const streamFactory = async function* (): AsyncGenerator<AgentEvent> {
        yield createErrorEvent('Always fails');  // Yield an error event before throwing
        throw new Error('Always fails');
      };
      
      const retried = retryStream(streamFactory, 2, 10);
      const events = await streamToArray(retried);
      
      expect(events.every(e => e.type === 'error')).toBe(true);
      expect(events.some(e => e.error?.includes('failed after 2 retries'))).toBe(true);
    });
  });

  describe('Bidirectional Streaming', () => {
    test('createBidirectionalStream should create bidirectional stream', () => {
      const biStream = createBidirectionalStream();
      
      expect(biStream.send).toBeInstanceOf(Function);
      expect(biStream.receive).toBeInstanceOf(Function);
      expect(biStream.close).toBeInstanceOf(Function);
    });

    test('bidirectional stream should handle send and receive', async () => {
      const biStream = createBidirectionalStream();
      const message = createUserMessage('Test message');
      
      // This is a simplified test - real implementation would be more complex
      await biStream.send(message);
      
      // In real implementation, receive would yield events based on sent messages
      const events = biStream.receive();
      let eventCount = 0;
      
      for await (const event of events) {
        eventCount++;
        if (eventCount >= 1) break; // Prevent infinite loop
      }
      
      biStream.close();
    });
  });

  describe('Stream Utilities', () => {
    test('streamToArray should convert stream to array', async () => {
      async function* testStream(): AsyncGenerator<string> {
        yield 'a';
        yield 'b';
        yield 'c';
      }
      
      const array = await streamToArray(testStream());
      expect(array).toEqual(['a', 'b', 'c']);
    });

    test('takeFromStream should take limited items', async () => {
      async function* infiniteStream(): AsyncGenerator<number> {
        let i = 0;
        while (true) {
          yield i++;
        }
      }
      
      const taken = takeFromStream(infiniteStream(), 3);
      const array = await streamToArray(taken);
      
      expect(array).toEqual([0, 1, 2]);
    });

    test('skipFromStream should skip items', async () => {
      async function* testStream(): AsyncGenerator<number> {
        for (let i = 0; i < 5; i++) {
          yield i;
        }
      }
      
      const skipped = skipFromStream(testStream(), 2);
      const array = await streamToArray(skipped);
      
      expect(array).toEqual([2, 3, 4]);
    });
  });

  describe('Integration Tests', () => {
    test('should handle complex streaming pipeline', async () => {
      // Create a complex stream with multiple event types
      async function* complexStream(): AsyncGenerator<AgentEvent> {
        yield createMessageStartEvent();
        
        for (let i = 1; i <= 5; i++) {
          yield createMessageDeltaEvent(createUserMessage(`Chunk ${i}`));
        }
        
        yield createFunctionCallStartEvent(createFunctionCall('1', 'process', {}));
        yield createFunctionCallCompleteEvent(createFunctionResponse('1', 'process', 'done'));
        yield createMessageCompleteEvent();
      }
      
      // Apply multiple transformations
      const stream = complexStream();
      const filtered = filterMessageEvents(stream);
      const monitored = monitorStream(filtered, logStream('COMPLEX'));
      const buffered = createBufferedStream(monitored, 2);
      
      const buffers: AgentEvent[][] = [];
      for await (const buffer of buffered) {
        buffers.push(buffer);
      }
      
      // Should have start + 5 deltas + complete = 7 message events
      // Buffered by 2: [2, 2, 2, 1]
      expect(buffers).toHaveLength(4);
      expect(buffers.flat()).toHaveLength(7);
    });

    test('should handle error recovery in pipeline', async () => {
      async function* errorProneStream(): AsyncGenerator<AgentEvent> {
        yield createMessageDeltaEvent(createUserMessage('Before'));
        throw new Error('Pipeline error');
      }
      
      const stream = errorProneStream();
      const withErrorHandling = withStreamErrorHandling(stream);
      const monitored = monitorStream(withErrorHandling, logStream('ERROR'));
      
      const events = await streamToArray(monitored);
      
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('message_delta');
      expect(events[1].type).toBe('error');
    });
  });
});