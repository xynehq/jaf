/**
 * HITL (Human-in-the-Loop) Clarification Demo with Streaming
 *
 * This example demonstrates the LLM-driven clarification feature using runStream.
 * Events are streamed in real-time, and execution can be paused for user input.
 *
 * Key Features:
 * - Real-time event streaming with runStream
 * - LLM-driven clarification detection
 * - Pause stream when clarification is needed
 * - Resume with user selection
 * - See all events as they happen
 */

import 'dotenv/config';
import { z } from 'zod';
import {
  runStream,
  Agent,
  Tool,
  TraceEvent,
  RunState,
  RunConfig,
  generateRunId,
  generateTraceId,
  makeLiteLLMProvider
} from '@xynehq/jaf';
import { ClarificationInterruption } from '../src/core/types';

type DemoCtx = { userId: string };

// Simulated database of contacts
const CONTACTS = [
  { id: '1', name: 'Sahil Kumar', email: 'sahil.kumar@example.com', department: 'Engineering' },
  { id: '2', name: 'Sahil Nagarale', email: 'sahil.nagarale@example.com', department: 'Product' },
  { id: '3', name: 'Sahil Bansal', email: 'sahil.bansal@example.com', department: 'Sales' },
  { id: '4', name: 'John Smith', email: 'john.smith@example.com', department: 'Marketing' },
];

const MESSAGES = [
  { from: '1', text: 'Hey, can you review my PR?', timestamp: '2024-01-15T10:30:00Z' },
  { from: '1', text: 'The new feature is ready for testing', timestamp: '2024-01-15T10:31:00Z' },
  { from: '2', text: 'Product roadmap meeting at 2 PM', timestamp: '2024-01-14T14:20:00Z' },
  { from: '2', text: 'Please prioritize user feedback', timestamp: '2024-01-14T14:21:00Z' },
  { from: '3', text: 'Client demo went great!', timestamp: '2024-01-13T09:15:00Z' },
  { from: '3', text: 'Need help with the proposal', timestamp: '2024-01-13T09:16:00Z' },
  { from: '4', text: 'Campaign metrics look good', timestamp: '2024-01-15T08:00:00Z' },
];

// Define tools
const searchContactsTool: Tool<{ name: string }, DemoCtx> = {
  schema: {
    name: 'search_contacts',
    description: 'Search for contacts by name. Returns all matching contacts with their details.',
    parameters: z.object({
      name: z.string()
    }) as any
  },
  execute: async (args) => {
    const matches = CONTACTS.filter(c =>
      c.name.toLowerCase().includes(args.name.toLowerCase())
    );

    return JSON.stringify({
      status: 'success',
      data: {
        query: args.name,
        matches: matches.map(m => ({
          id: m.id,
          name: m.name,
          email: m.email,
          department: m.department
        })),
        count: matches.length
      }
    });
  }
};

const getMessagesTool: Tool<{ contactId: string }, DemoCtx> = {
  schema: {
    name: 'get_messages',
    description: 'Get messages from a specific contact by their ID',
    parameters: z.object({
      contactId: z.string()
    }) as any
  },
  execute: async (args) => {
    const contact = CONTACTS.find(c => c.id === args.contactId);
    if (!contact) {
      return JSON.stringify({
        status: 'error',
        error: 'Contact not found'
      });
    }

    const messages = MESSAGES.filter(m => m.from === args.contactId);

    return JSON.stringify({
      status: 'success',
      data: {
        contact: {
          name: contact.name,
          email: contact.email,
          department: contact.department
        },
        messages: messages.map(m => ({
          text: m.text,
          timestamp: m.timestamp
        })),
        count: messages.length
      }
    });
  }
};

// Define agent
const messageAgent: Agent<DemoCtx, any> = {
  name: 'MessageAssistant',
  instructions: () => `You are a helpful assistant that helps users find and read their messages.

IMPORTANT: When searching for contacts, you MUST follow this workflow:

1. First, use the search_contacts tool to find matching contacts
2. Analyze the results:
   - If you find EXACTLY ONE match → proceed to get_messages for that contact
   - If you find MULTIPLE DISTINCT people (different individuals, not just variations) → you MUST use the request_user_clarification tool IMMEDIATELY
   - If you find NO matches → inform the user

3. When using request_user_clarification:
   - Ask a clear question like "Which Sahil do you mean?"
   - Provide options with BOTH name and department (e.g., "Sahil Kumar (Engineering)")
   - Use the contact ID as the option ID
   - You MUST call this tool when there are multiple distinct people - DO NOT try to guess or pick one

4. After clarification or finding a unique contact:
   - Use get_messages with the contact ID
   - Summarize the messages for the user

Remember: MULTIPLE distinct people = MUST use request_user_clarification tool!`,
  tools: [searchContactsTool, getMessagesTool]
  // Note: outputCodec removed to avoid JSON mode conflicts with tool calling
};

// Helper function to simulate user input
function simulateUserSelection(options: readonly { id: string; label: string }[], preferredIndex: number = 0): string {
  console.log('\n🤔 Simulating user selection...');
  const selected = options[preferredIndex];
  console.log(`👤 User selects: ${selected.label} (ID: ${selected.id})\n`);
  return selected.id;
}

// Main demo function using runStream
async function streamingDemo() {
  console.log('=== HITL Clarification Demo with Streaming ===\n');

  const agentRegistry = new Map<string, Agent<DemoCtx, any>>();
  agentRegistry.set('MessageAssistant', messageAgent);

  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000';
  const litellmApiKey = process.env.LITELLM_API_KEY;
  const modelProvider = makeLiteLLMProvider(litellmUrl, litellmApiKey);

  const config: RunConfig<DemoCtx> = {
    agentRegistry,
    modelProvider: modelProvider as any,
    modelOverride: process.env.LITELLM_MODEL || 'gpt-4o-mini',
  };

  // Test Case 1: Ambiguous query with streaming
  console.log('📧 Test Case 1: Ambiguous query with real-time streaming');
  console.log('User: "Show me messages from Sahil"\n');

  const state1: RunState<DemoCtx> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [{
      role: 'user' as const,
      content: 'Show me messages from Sahil'
    }],
    currentAgentName: 'MessageAssistant',
    context: { userId: 'demo-user' },
    turnCount: 0
  };

  let clarificationNeeded: ClarificationInterruption<any> | null = null;
  let interruptedState: any = null;

  console.log('🌊 Starting event stream...\n');

  // Stream events in real-time
  for await (const event of runStream(state1, config)) {
    handleEvent(event);

    // Check if this is a run_end event
    if (event.type === 'run_end') {
      const outcome = event.data.outcome;

      if (outcome.status === 'interrupted') {
        // Find clarification interruption
        const clarification = outcome.interruptions.find(
          (i: any) => i.type === 'clarification_required'
        ) as ClarificationInterruption<any> | undefined;

        if (clarification) {
          clarificationNeeded = clarification;

          // The stream is complete, we can access the final state
          // by creating a new run that will immediately detect and handle the clarification
          console.log('\n⏸️  Stream paused - clarification required');
          console.log(`Question: ${clarification.question}`);
          console.log('Options:');
          clarification.options.forEach((opt, idx) => {
            console.log(`  ${idx + 1}. ${opt.label} (ID: ${opt.id})`);
          });

          // We need to get the final state from the outcome
          // For now, we'll simulate getting it from the event data
          break;
        }
      } else if (outcome.status === 'completed') {
        console.log('\n✅ Completed without clarification needed:');
        console.log(JSON.stringify(outcome.output, null, 2));
      } else if (outcome.status === 'error') {
        console.log('\n❌ Error:', outcome.error);
      }
    }
  }

  // If clarification was needed, resume with user selection
  if (clarificationNeeded) {
    const selectedId = simulateUserSelection(clarificationNeeded.options, 0);

    console.log('🔄 Resuming stream with user selection...\n');

    // Create a new state with the clarification response
    const stateWithClarification = {
      ...state1,
      clarifications: new Map([[clarificationNeeded.clarificationId, selectedId]])
    };

    // Resume streaming with the clarification
    for await (const event of runStream(stateWithClarification, config)) {
      handleEvent(event);

      if (event.type === 'run_end') {
        const outcome = event.data.outcome;

        if (outcome.status === 'completed') {
          console.log('\n✅ Final Result after clarification:');
          console.log(JSON.stringify(outcome.output, null, 2));
        }
      }
    }
  }

  console.log('\n---\n');

  // Test Case 2: Specific query (no clarification needed)
  console.log('📧 Test Case 2: Specific query with streaming');
  console.log('User: "Show me messages from Sahil Kumar from Engineering"\n');

  const state2: RunState<DemoCtx> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [{
      role: 'user' as const,
      content: 'Show me messages from Sahil Kumar from Engineering'
    }],
    currentAgentName: 'MessageAssistant',
    context: { userId: 'demo-user' },
    turnCount: 0
  };

  console.log('🌊 Starting event stream...\n');

  for await (const event of runStream(state2, config)) {
    handleEvent(event);

    if (event.type === 'run_end') {
      const outcome = event.data.outcome;

      if (outcome.status === 'completed') {
        console.log('\n✅ Completed (no clarification needed):');
        console.log(JSON.stringify(outcome.output, null, 2));
      }
    }
  }

  console.log('\n=== Demo Complete ===');
}

// Event handler to display events in real-time
function handleEvent(event: TraceEvent | any) {
  switch (event.type) {
    case 'turn_start':
      console.log(`🔄 Turn ${event.data.turn} started (Agent: ${event.data.agentName})`);
      break;

    case 'tool_call_start':
      console.log(`🔧 Tool called: ${event.data.toolName}`);
      console.log(`   Args: ${JSON.stringify(event.data.args, null, 2)}`);

      // Highlight if it's the clarification tool
      if (event.data.toolName === 'request_user_clarification') {
        console.log('   ⚠️  CLARIFICATION TOOL INVOKED!');
      }
      break;

    case 'tool_call_end':
      if (event.data.status === 'success') {
        console.log(`✓ Tool completed: ${event.data.toolName}`);
        // Show result for search_contacts to help debug
        if (event.data.toolName === 'search_contacts') {
          try {
            const result = JSON.parse(event.data.result);
            console.log(`   Found ${result.data?.count || 0} matches`);
          } catch (e) {
            // Ignore parse errors
          }
        }
      } else {
        console.log(`✗ Tool failed: ${event.data.toolName}`);
      }
      break;

    case 'assistant_message':
      const content = typeof event.data.message.content === 'string'
        ? event.data.message.content
        : '';

      // Skip internal clarification trigger messages
      if (content && !content.includes('_clarification_trigger') && !content.includes('awaiting_clarification')) {
        const preview = content.length > 80 ? content.substring(0, 80) + '...' : content;
        console.log(`🤖 Assistant: ${preview}`);
      }

      // Show tool calls if present
      if (event.data.message.tool_calls && event.data.message.tool_calls.length > 0) {
        console.log(`   🛠️  Planning to call ${event.data.message.tool_calls.length} tool(s):`);
        event.data.message.tool_calls.forEach((tc: any) => {
          console.log(`      - ${tc.function?.name || 'unknown'}`);
        });
      }
      break;

    case 'clarification_requested':
      console.log('\n🔔 Clarification Requested!');
      console.log(`   Question: ${event.data.question}`);
      console.log('   Options:');
      event.data.options.forEach((opt: any, idx: number) => {
        console.log(`     ${idx + 1}. ${opt.label} (ID: ${opt.id})`);
      });
      break;

    case 'clarification_provided':
      console.log(`✅ Clarification provided: ${event.data.selectedId}`);
      break;

    case 'turn_end':
      console.log(`✓ Turn ${event.data.turn} ended\n`);
      break;

    case 'token_usage':
      if (event.data.total) {
        console.log(`📊 Tokens: ${event.data.total} total (${event.data.prompt} prompt + ${event.data.completion} completion)`);
      }
      break;
  }
}

// Run the demo
streamingDemo().catch(console.error);
