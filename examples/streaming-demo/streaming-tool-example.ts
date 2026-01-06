/**
 * Streaming Tool Example
 * 
 * Demonstrates how to push events to stream from within a tool's execution.
 * Perfect for tools that have streaming API responses or long-running operations.
 * 
 * Run: pnpm exec tsx streaming-tool-example.ts
 */

import { z } from 'zod';
import {
  run,
  Agent,
  RunConfig,
  Tool,
  createTraceId,
  createRunId,
  Message,
  Streaming,
  agentAsTool
} from '../../src/index.js';
import type { StreamProvider } from '../../src/streaming/types.js';

// ========== Extended Context with StreamProvider ==========

type MyContext = {
  sessionId: string;
  streamProvider?: StreamProvider;  // Optional stream provider
};

// ========== Streaming Search Tool ==========

const SearchArgsSchema = z.object({
  query: z.string().describe('Search query')
});

type SearchArgs = z.infer<typeof SearchArgsSchema>;

/**
 * A search tool that streams results as they come in
 * Simulates API that returns results incrementally
 */
const streamingSearchTool: Tool<SearchArgs, MyContext> = {
  schema: {
    name: 'streaming_search',
    description: 'Search with streaming results',
    parameters: SearchArgsSchema
  },
  execute: async (args, context) => {
    console.log(`\n🔍 Starting search for: ${args.query}`);

    const provider = context.streamProvider;
    const sessionId = context.sessionId;

    // Simulate streaming search results
    const results = [
      { title: 'Result 1', snippet: 'First result about ' + args.query },
      { title: 'Result 2', snippet: 'Second result about ' + args.query },
      { title: 'Result 3', snippet: 'Third result about ' + args.query }
    ];

    let allResults = '';

    for (let i = 0; i < results.length; i++) {
      const result = results[i];

      // Simulate delay (API latency)
      await new Promise(r => setTimeout(r, 500));

      // Push intermediate result to stream
      if (provider && sessionId) {
        await provider.push(sessionId, {
          eventType: 'tool_partial_result',
          data: {
            toolName: 'streaming_search',
            query: args.query,
            partialResult: result,
            index: i + 1,
            total: results.length,
            isComplete: i === results.length - 1
          },
          timestamp: new Date().toISOString(),
          metadata: {
            progressive: true
          }
        });

        console.log(`  📤 Pushed result ${i + 1}/${results.length} to stream`);
      }

      allResults += `${result.title}: ${result.snippet}\n`;
    }

    console.log('✅ Search complete\n');
    return allResults;
  }
};

// ========== Streaming Text Generator Tool ==========

const GenerateArgsSchema = z.object({
  prompt: z.string().describe('Text generation prompt'),
  sentences: z.number().optional().describe('Number of sentences to generate')
});

type GenerateArgs = z.infer<typeof GenerateArgsSchema>;

/**
 * A text generation tool that streams output sentence by sentence
 * Like GPT streaming - shows progress as it generates
 */
const streamingGeneratorTool: Tool<GenerateArgs, MyContext> = {
  schema: {
    name: 'generate_text',
    description: 'Generate text with streaming output',
    parameters: GenerateArgsSchema
  },
  execute: async (args, context) => {
    console.log(`\n✍️  Generating text for: ${args.prompt}`);

    const provider = context.streamProvider;
    const sessionId = context.sessionId;
    const numSentences = args.sentences || 3;

    const sentences = [
      `This is the first sentence about ${args.prompt}.`,
      `Here's more detail about ${args.prompt} in the second sentence.`,
      `Finally, this third sentence concludes the topic of ${args.prompt}.`
    ].slice(0, numSentences);

    let fullText = '';

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];

      // Simulate generation delay
      await new Promise(r => setTimeout(r, 300));

      fullText += sentence + ' ';

      // Push progressive update to stream
      if (provider && sessionId) {
        await provider.push(sessionId, {
          eventType: 'tool_streaming_output',
          data: {
            toolName: 'generate_text',
            prompt: args.prompt,
            delta: sentence,  // New text added
            fullText: fullText.trim(),  // Full text so far
            progress: {
              current: i + 1,
              total: numSentences,
              percentage: Math.round(((i + 1) / numSentences) * 100)
            }
          },
          timestamp: new Date().toISOString(),
          metadata: {
            streaming: true
          }
        });

        console.log(`  📤 Streamed sentence ${i + 1}/${numSentences}`);
      }
    }

    console.log('✅ Generation complete\n');
    return fullText.trim();
  }
};

// ========== Long-Running Analysis Tool ==========

const AnalyzeArgsSchema = z.object({
  data: z.string().describe('Data to analyze')
});

type AnalyzeArgs = z.infer<typeof AnalyzeArgsSchema>;

/**
 * A tool that performs multi-step analysis and reports progress
 */
const analyzingTool: Tool<AnalyzeArgs, MyContext> = {
  schema: {
    name: 'analyze_data',
    description: 'Analyze data with progress updates',
    parameters: AnalyzeArgsSchema
  },
  execute: async (args, context) => {
    console.log(`\n📊 Analyzing: ${args.data}`);

    const provider = context.streamProvider;
    const sessionId = context.sessionId;

    const steps = [
      { name: 'Preprocessing', duration: 200 },
      { name: 'Feature extraction', duration: 300 },
      { name: 'Model inference', duration: 400 },
      { name: 'Post-processing', duration: 200 }
    ];

    const results: string[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Push step start event
      if (provider && sessionId) {
        await provider.push(sessionId, {
          eventType: 'tool_progress_update',
          data: {
            toolName: 'analyze_data',
            step: step.name,
            status: 'started',
            stepNumber: i + 1,
            totalSteps: steps.length
          },
          timestamp: new Date().toISOString()
        });
      }

      console.log(`  🔄 Step ${i + 1}/${steps.length}: ${step.name}...`);

      // Simulate step execution
      await new Promise(r => setTimeout(r, step.duration));

      const stepResult = `${step.name} completed with 95% confidence`;
      results.push(stepResult);

      // Push step completion event
      if (provider && sessionId) {
        await provider.push(sessionId, {
          eventType: 'tool_progress_update',
          data: {
            toolName: 'analyze_data',
            step: step.name,
            status: 'completed',
            stepNumber: i + 1,
            totalSteps: steps.length,
            result: stepResult
          },
          timestamp: new Date().toISOString()
        });

        console.log(`  📤 Pushed progress: ${step.name} complete`);
      }
    }

    console.log('✅ Analysis complete\n');
    return `Analysis complete:\n${results.join('\n')}`;
  }
};

// ========== AGENT-AS-TOOL EXAMPLE ==========

/**
 * Tool inside the sub-agent that also streams
 */
const ProcessArgsSchema = z.object({
  data: z.string().describe('Data to process')
});

const subAgentProcessingTool: Tool<z.infer<typeof ProcessArgsSchema>, MyContext> = {
  schema: {
    name: 'process_data',
    description: 'Process data with streaming progress',
    parameters: ProcessArgsSchema
  },
  execute: async (args, context) => {
    console.log(`  🔧 [SUB-AGENT TOOL] Processing: ${args.data}`);
    
    const provider = context.streamProvider;
    const sessionId = context.sessionId;
    
    const phases = ['Validating', 'Transforming', 'Optimizing'];
    
    for (let i = 0; i < phases.length; i++) {
      await new Promise(r => setTimeout(r, 250));
      
      if (provider && sessionId) {
        await provider.push(sessionId, {
          eventType: 'subagent_tool_phase',
          data: {
            toolName: 'process_data',
            phase: phases[i],
            phaseNumber: i + 1,
            totalPhases: phases.length
          },
          timestamp: new Date().toISOString()
        });
        console.log(`    📤 [SUB-AGENT TOOL] Phase ${i + 1}/3: ${phases[i]}`);
      }
    }
    
    console.log(`  ✅ [SUB-AGENT TOOL] Processing complete\n`);
    return `Processed "${args.data}" through ${phases.length} phases`;
  }
};

/**
 * Sub-agent that can also push events during its execution
 */
const processingSubAgent: Agent<MyContext, string> = {
  name: 'processing-specialist',
  instructions: (state) => {
    // Sub-agent can push events from instructions!
    const provider = state.context.streamProvider;
    const sessionId = state.context.sessionId;
    
    if (provider && sessionId) {
      provider.push(sessionId, {
        eventType: 'subagent_started',
        data: {
          agentName: 'processing-specialist',
          message: 'Processing specialist sub-agent activated'
        },
        timestamp: new Date().toISOString()
      }).catch(console.error);
      console.log(`  📤 [SUB-AGENT] Activation event pushed\n`);
    }
    
    return 'You are a data processing specialist. Use process_data to handle data.';
  },
  tools: [subAgentProcessingTool],  // Sub-agent has its own streaming tool
  modelConfig: {
    name: 'gpt-4o-mini'
  }
};

// Wrap sub-agent as a tool
const processingAgentTool = agentAsTool(processingSubAgent, {
  toolName: 'processing_specialist',
  toolDescription: 'Advanced data processing using specialist sub-agent',
  maxTurns: 3
});

// ========== Define the Main Agent ==========

const streamingAgent: Agent<MyContext, string> = {
  name: 'streaming-demo-agent',
  instructions: () => `
You are a helpful assistant with streaming tools.
- streaming_search: Regular tool with streaming
- generate_text: Regular tool with streaming  
- analyze_data: Regular tool with streaming
- processing_specialist: Agent-as-tool with streaming (sub-agent)
`,
  tools: [
    streamingSearchTool,       // Regular tool
    streamingGeneratorTool,    // Regular tool
    analyzingTool,             // Regular tool
    processingAgentTool        // Agent-as-tool (sub-agent)
  ],
  modelConfig: {
    name: 'gpt-4o-mini',
    temperature: 0.7
  }
};

// ========== Mock Model Provider ==========

const mockModelProvider = {
  name: 'mock-provider',

  getCompletion: async (state: any) => {
    const lastMessage = state.messages[state.messages.length - 1];
    const content = typeof lastMessage.content === 'string' ? lastMessage.content : '';

    // On first user message, call the search tool
    if (lastMessage.role === 'user' && content.toLowerCase().includes('search')) {
      console.log('[MOCK] Returning tool call for streaming_search');
      return {
        message: {
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function' as const,
            function: {
              name: 'streaming_search',
              arguments: JSON.stringify({ query: 'AI agents' })
            }
          }]
        }
      };
    }

    // After tool execution, return final response
    if (lastMessage.role === 'tool') {
      console.log('[MOCK] Tool executed, returning final response');
      return {
        message: {
          content: 'I found some great results about AI agents for you!',
          tool_calls: undefined
        }
      };
    }

    if (content.toLowerCase().includes('generate')) {
      return {
        message: {
          content: null,
          tool_calls: [{
            id: 'call_2',
            type: 'function' as const,
            function: {
              name: 'generate_text',
              arguments: JSON.stringify({ prompt: 'AI technology', sentences: 3 })
            }
          }]
        }
      };
    }

    if (content.toLowerCase().includes('analyze')) {
      return {
        message: {
          content: null,
          tool_calls: [{
            id: 'call_3',
            type: 'function' as const,
            function: {
              name: 'analyze_data',
              arguments: JSON.stringify({ data: 'sample dataset' })
            }
          }]
        }
      };
    }

    return {
      message: {
        content: 'Hello! I can search, generate text, or analyze data with streaming updates. What would you like to do?',
        tool_calls: undefined
      }
    };
  },

  getCompletionStream: async function* () {
    yield { delta: 'Streaming not implemented in mock' };
  }
};

// ========== Main Demo Function ==========

async function main() {
  console.log('='.repeat(60));
  console.log('STREAMING TOOL DEMO - Tools That Push to Stream');
  console.log('='.repeat(60));

  // Create stream provider
  const streamProvider = Streaming.createInMemoryStreamProvider({
    maxEventsPerSession: 200
  });

  console.log('\n✅ Created InMemory stream provider');

  const sessionId = `session-${Date.now()}`;

  // Create context WITH stream provider
  const context: MyContext = {
    sessionId,
    streamProvider  // Pass stream provider to tools!
  };

  // Setup event handler for JAF events
  const streamHandler = Streaming.withStreamOutput(streamProvider, {
    sessionId: sessionId,
    onPushSuccess: (event) => {
      if (event.type.startsWith('tool_')) {
        console.log(`  📋 JAF Event: ${event.type}`);
      }
    }
  });

  console.log('✅ Stream provider passed to tool context\n');

  // Create agent registry
  const agentRegistry = new Map();
  agentRegistry.set('streaming-demo-agent', streamingAgent);

  // Create run config
  const config: RunConfig<MyContext> = {
    agentRegistry,
    modelProvider: mockModelProvider as any,
    maxTurns: 5,
    onEvent: streamHandler
  };

  // Create initial state
  const initialState = {
    runId: createRunId(`run-${Date.now()}`),
    traceId: createTraceId(`trace-${Date.now()}`),
    messages: [
      { role: 'user' as const, content: 'Please search for AI agents' }
    ],
    currentAgentName: 'streaming-demo-agent',
    context,
    turnCount: 0
  };

  console.log('Running streaming tool demo...\n');
  console.log('-'.repeat(60));

  // Run the agent
  try {
    const result = await run(initialState, config);

    console.log('-'.repeat(60));
    console.log('\n📊 Run Result:');
    console.log(`   Status: ${result.outcome.status}`);
    console.log(`   Turns: ${result.finalState.turnCount}`);

    // Get ALL events (JAF events + tool custom events)
    const allEvents = streamProvider.getEvents(sessionId);

    console.log(`\n📦 Total Events Streamed: ${allEvents.length}`);

    // Categorize events
    const jafEvents = allEvents.filter(e =>
      !e.eventType.startsWith('tool_partial') &&
      !e.eventType.startsWith('tool_streaming') &&
      !e.eventType.startsWith('tool_progress')
    );

    const toolProgressEvents = allEvents.filter(e =>
      e.eventType.startsWith('tool_partial') ||
      e.eventType.startsWith('tool_streaming') ||
      e.eventType.startsWith('tool_progress')
    );

    console.log(`\n📋 JAF Events (${jafEvents.length}):`);
    jafEvents.forEach((e, i) => {
      console.log(`   ${i + 1}. ${e.eventType}`);
    });

    console.log(`\n🔧 Tool Progress Events (${toolProgressEvents.length}):`);
    toolProgressEvents.forEach((e, i) => {
      console.log(`   ${i + 1}. ${e.eventType}`);
      if (e.eventType === 'tool_partial_result') {
        console.log(`      → Partial result ${(e.data as any).index}/${(e.data as any).total}`);
      } else if (e.eventType === 'tool_streaming_output') {
        console.log(`      → Progress: ${(e.data as any).progress?.percentage}%`);
      } else if (e.eventType === 'tool_progress_update') {
        console.log(`      → Step: ${(e.data as any).step} (${(e.data as any).status})`);
      }
    });

  } catch (error) {
    console.error('Error:', error);
  }

  await streamProvider.close();
  console.log('\n✅ Demo complete!\n');

  console.log('='.repeat(60));
  console.log('KEY TAKEAWAY');
  console.log('='.repeat(60));
  console.log(`
✅ Tools can push custom events during execution!

Pattern:
1. Add streamProvider to your context type
2. Pass it when creating the context
3. Tools access it via context.streamProvider
4. Push events: await context.streamProvider.push(sessionId, event)

Use Cases:
• Streaming API responses (like GPT)
• Progress updates for long operations
• Partial results from search
• Multi-step process tracking
• Real-time status updates

All events (JAF + custom) go to the same stream!
`);
}

// Run the demo
main().catch(console.error);
