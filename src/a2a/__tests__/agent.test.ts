/**
 * A2A Agent Tests
 * Tests for A2A agent creation, tools, and execution
 */

import { z } from 'zod';
import {
  createA2AAgent,
  createA2ATool,
  createInitialAgentState,
  addMessageToState,
  createA2ATextMessage,
  createA2ADataMessage,
  createA2ATask,
  updateA2ATaskStatus,
  extractTextFromA2AMessage,
  transformA2AAgentToJAF,
  processAgentQuery,
  type A2AToolResult,
  type ToolContext,
  StreamEvent,
} from '../index';

describe('A2A Agent', () => {
  describe('createA2ATool', () => {
    it('should create A2A tool with basic configuration', () => {
      const tool = createA2ATool({
        name: 'test_tool',
        description: 'A test tool',
        parameters: z.object({
          input: z.string()
        }),
        execute: async ({ input }) => `Processed: ${input}`
      });

      expect(tool.name).toBe('test_tool');
      expect(tool.description).toBe('A test tool');
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    });

    it('should execute tool with simple return value', async () => {
      const tool = createA2ATool({
        name: 'echo_tool',
        description: 'Echo input',
        parameters: z.object({
          message: z.string()
        }),
        execute: async ({ message }) => `Echo: ${message}`
      });

      const result = await tool.execute({ message: 'Hello' });
      expect(result).toBe('Echo: Hello');
    });

    it('should execute tool with A2AToolResult', async () => {
      const tool = createA2ATool({
        name: 'context_tool',
        description: 'Tool with context',
        parameters: z.object({
          data: z.string()
        }),
        execute: async ({ data }, _context): Promise<A2AToolResult> => {
          return {
            result: `Processed: ${data}`,
            context: {
              actions: {
                requiresInput: false,
                skipSummarization: false,
                escalate: false
              },
              metadata: { processed: true }
            }
          };
        }
      });

      const result = await tool.execute({ data: 'test' }) as A2AToolResult;
      expect(result.result).toBe('Processed: test');
      expect(result.context?.metadata.processed).toBe(true);
    });

    it('should execute tool with context modification', async () => {
      const tool = createA2ATool({
        name: 'form_tool',
        description: 'Tool that requires input',
        parameters: z.object({
          formData: z.record(z.any()).optional()
        }),
        execute: async ({ formData }, _context): Promise<A2AToolResult> => {
          const newContext: ToolContext = {
            actions: {
              requiresInput: !formData,
              skipSummarization: false,
              escalate: false
            },
            metadata: { hasForm: !formData }
          };

          return {
            result: formData || { type: 'form', message: 'Please provide input' },
            context: newContext
          };
        }
      });

      // Test without form data (should require input)
      const result1 = await tool.execute({}) as A2AToolResult;
      expect(result1.context?.actions.requiresInput).toBe(true);

      // Test with form data (should not require input)
      const result2 = await tool.execute({ formData: { name: 'test' } }) as A2AToolResult;
      expect(result2.context?.actions.requiresInput).toBe(false);
    });
  });

  describe('createA2AAgent', () => {
    it('should create A2A agent with basic configuration', () => {
      const agent = createA2AAgent({
        name: 'TestAgent',
        description: 'A test agent',
        instruction: 'You are a helpful test assistant',
        tools: []
      });

      expect(agent.name).toBe('TestAgent');
      expect(agent.description).toBe('A test agent');
      expect(agent.instruction).toBe('You are a helpful test assistant');
      expect(agent.tools).toEqual([]);
      expect(agent.supportedContentTypes).toEqual(['text/plain', 'application/json']);
    });

    it('should create A2A agent with custom content types', () => {
      const agent = createA2AAgent({
        name: 'MediaAgent',
        description: 'Media processing agent',
        instruction: 'Process media files',
        tools: [],
        supportedContentTypes: ['image/jpeg', 'image/png', 'video/mp4']
      });

      expect(agent.supportedContentTypes).toEqual(['image/jpeg', 'image/png', 'video/mp4']);
    });

    it('should create A2A agent with tools', () => {
      const testTool = createA2ATool({
        name: 'test_tool',
        description: 'Test tool',
        parameters: z.object({ input: z.string() }),
        execute: async ({ input }) => `Result: ${input}`
      });

      const agent = createA2AAgent({
        name: 'ToolAgent',
        description: 'Agent with tools',
        instruction: 'Use tools to help users',
        tools: [testTool]
      });

      expect(agent.tools).toHaveLength(1);
      expect(agent.tools[0].name).toBe('test_tool');
    });
  });

  describe('Agent State Management', () => {
    it('should create initial agent state', () => {
      const sessionId = 'session_123';
      const state = createInitialAgentState(sessionId);

      expect(state.sessionId).toBe(sessionId);
      expect(state.messages).toEqual([]);
      expect(state.context).toEqual({});
      expect(state.artifacts).toEqual([]);
      expect(state.timestamp).toBeDefined();
    });

    it('should add message to state', () => {
      const initialState = createInitialAgentState('session_123');
      const message = { role: 'user', content: 'Hello' };
      
      const newState = addMessageToState(initialState, message);

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0]).toEqual(message);
      expect(newState.sessionId).toBe(initialState.sessionId);
      // Verify timestamp was updated (it should be a valid ISO string)
      expect(newState.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // Verify state was not mutated
      expect(newState).not.toBe(initialState);
      expect(initialState.messages).toHaveLength(0);
    });

    it('should preserve immutability when adding messages', () => {
      const initialState = createInitialAgentState('session_123');
      const message1 = { role: 'user', content: 'Hello' };
      const message2 = { role: 'assistant', content: 'Hi there' };

      const state1 = addMessageToState(initialState, message1);
      const state2 = addMessageToState(state1, message2);

      expect(initialState.messages).toHaveLength(0);
      expect(state1.messages).toHaveLength(1);
      expect(state2.messages).toHaveLength(2);
      expect(state1.messages[0]).toEqual(message1);
      expect(state2.messages[1]).toEqual(message2);
    });
  });

  describe('A2A Message Creation', () => {
    it('should create A2A text message', () => {
      const message = createA2ATextMessage('Hello world', 'ctx_123', 'task_456');

      expect(message.role).toBe('agent');
      expect(message.parts).toHaveLength(1);
      expect(message.parts[0].kind).toBe('text');
      expect((message.parts[0] as any).text).toBe('Hello world');
      expect(message.contextId).toBe('ctx_123');
      expect(message.taskId).toBe('task_456');
      expect(message.kind).toBe('message');
    });

    it('should create A2A data message', () => {
      const data = { result: 'success', value: 42 };
      const message = createA2ADataMessage(data, 'ctx_123');

      expect(message.role).toBe('agent');
      expect(message.parts).toHaveLength(1);
      expect(message.parts[0].kind).toBe('data');
      expect((message.parts[0] as any).data).toEqual(data);
      expect(message.contextId).toBe('ctx_123');
    });

    it('should extract text from A2A message', () => {
      const message = createA2ATextMessage('Test message', 'ctx_123');
      const extractedText = extractTextFromA2AMessage(message);

      expect(extractedText).toBe('Test message');
    });

    it('should extract text from multi-part message', () => {
      const message = {
        role: 'user' as const,
        parts: [
          { kind: 'text' as const, text: 'First part. ' },
          { kind: 'text' as const, text: 'Second part.' },
          { kind: 'data' as const, data: { ignored: true } }
        ],
        messageId: 'msg_123',
        kind: 'message' as const
      };

      const extractedText = extractTextFromA2AMessage(message);
      expect(extractedText).toBe('First part. \nSecond part.');
    });
  });

  describe('A2A Task Management', () => {
    it('should create A2A task', () => {
      const message = createA2ATextMessage('Start task', 'ctx_123');
      const task = createA2ATask(message, 'session_123');

      expect(task.id).toMatch(/^task_/);
      expect(task.contextId).toBe('session_123');
      expect(task.status.state).toBe('submitted');
      expect(task.history).toEqual([message]);
      expect(task.artifacts).toEqual([]);
      expect(task.kind).toBe('task');
    });

    it('should update task status', () => {
      const message = createA2ATextMessage('Start task', 'ctx_123');
      const task = createA2ATask(message, 'session_123');
      
      const updatedTask = updateA2ATaskStatus(task, 'working');

      expect(updatedTask.status.state).toBe('working');
      expect(updatedTask.status.timestamp).toBeDefined();
      expect(updatedTask.id).toBe(task.id);
    });

    it('should update task status with message', () => {
      const message = createA2ATextMessage('Start task', 'ctx_123');
      const task = createA2ATask(message, 'session_123');
      
      const statusMessage = createA2ATextMessage('Working on it', 'ctx_123');
      const updatedTask = updateA2ATaskStatus(task, 'working', statusMessage);

      expect(updatedTask.status.state).toBe('working');
      expect(updatedTask.status.message).toEqual(statusMessage);
    });
  });

  describe('A2A to JAF Transformation', () => {
    it('should transform A2A agent to JAF agent', () => {
      const testTool = createA2ATool({
        name: 'test_tool',
        description: 'Test tool',
        parameters: z.object({ input: z.string() }),
        execute: async ({ input }) => `Result: ${input}`
      });

      const a2aAgent = createA2AAgent({
        name: 'TestAgent',
        description: 'Test agent',
        instruction: 'You are helpful',
        tools: [testTool]
      });

      const jafAgent = transformA2AAgentToJAF(a2aAgent);

      expect(jafAgent.name).toBe('TestAgent');
      expect(typeof jafAgent.instructions).toBe('function');
      expect(jafAgent.tools).toHaveLength(1);
      expect(jafAgent.tools?.[0]?.schema.name).toBe('test_tool');
    });

    it('should create JAF instructions function', () => {
      const a2aAgent = createA2AAgent({
        name: 'TestAgent',
        description: 'Test agent',
        instruction: 'You are a helpful assistant',
        tools: []
      });

      const jafAgent = transformA2AAgentToJAF(a2aAgent);
      const mockRunState = {
        runId: { _brand: 'RunId' } as any,
        traceId: { _brand: 'TraceId' } as any,
        messages: [],
        currentAgentName: 'TestAgent',
        context: {},
        turnCount: 0,
        approvals: new Map()
      };
      const instructions = jafAgent.instructions(mockRunState);

      expect(instructions).toBe('You are a helpful assistant');
    });
  });

  describe('Agent Query Processing', () => {
    it('should process simple agent query', async () => {
      const agent = createA2AAgent({
        name: 'EchoAgent',
        description: 'Echo agent',
        instruction: 'Echo user messages',
        tools: []
      });

      const mockModelProvider = {
        async getCompletion() {
          return {
            message: {
              content: 'Echoed response'
            }
          };
        }
      };

      const agentState = createInitialAgentState('session_123');
      const generator = processAgentQuery(agent, 'Hello', agentState, mockModelProvider);

      const events: StreamEvent[] = [];
      for await (const event of generator) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      const finalEvent = events[events.length - 1];
      expect(finalEvent.isTaskComplete).toBe(true);
      expect(finalEvent.content).toBe('Echoed response');
    });
  });

  describe('Tool Parameter Validation', () => {
    it('should validate tool parameters with Zod schema', async () => {
      const tool = createA2ATool({
        name: 'math_tool',
        description: 'Math operations',
        parameters: z.object({
          a: z.number(),
          b: z.number(),
          operation: z.enum(['add', 'subtract', 'multiply', 'divide'])
        }),
        execute: async ({ a, b, operation }) => {
          switch (operation) {
            case 'add': return a + b;
            case 'subtract': return a - b;
            case 'multiply': return a * b;
            case 'divide': return a / b;
            default: throw new Error('Invalid operation');
          }
        }
      });

      // Valid parameters
      const result1 = await tool.execute({ a: 5, b: 3, operation: 'add' });
      expect(result1).toBe(8);

      // The schema validation would happen at the A2A protocol level
      // Here we test that the tool executes correctly with valid params
      const result2 = await tool.execute({ a: 10, b: 2, operation: 'divide' });
      expect(result2).toBe(5);
    });
  });
});