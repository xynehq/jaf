/**
 * HITL (Human-in-the-Loop) Clarification Demo
 *
 * This example demonstrates the new LLM-driven clarification feature in JAF.
 * The agent can intelligently detect ambiguous requests and ask clarifying
 * questions to the user, then resume execution with the user's selection.
 *
 * Key Features:
 * - LLM decides when clarification is needed (not hardcoded in tools)
 * - Built-in `request_user_clarification` tool available to all agents
 * - Execution pauses and waits for user response
 * - Seamless resume after clarification is provided
 */

import 'dotenv/config';
import { z } from 'zod';
import {
  run,
  resumeWithClarification,
  Agent,
  Tool,
  RunState,
  RunConfig,
  generateRunId,
  generateTraceId,
  makeLiteLLMProvider
} from '@xynehq/jaf';

// Simulated database of contacts
const CONTACTS = [
  { id: '1', name: 'Sahil Kumar', email: 'sahil.kumar@example.com' },
  { id: '2', name: 'Sahil Nagarale', email: 'sahil.nagarale@example.com' },
  { id: '3', name: 'Sahil Bansal', email: 'sahil.bansal@example.com' },
  { id: '4', name: 'John Smith', email: 'john.smith@example.com' },
];

const MESSAGES = [
  { from: '1', text: 'Hey, how are you?', timestamp: '2024-01-15T10:30:00Z' },
  { from: '1', text: 'Can we meet tomorrow?', timestamp: '2024-01-15T10:31:00Z' },
  { from: '2', text: 'The project deadline is approaching', timestamp: '2024-01-14T14:20:00Z' },
  { from: '3', text: 'Thanks for your help!', timestamp: '2024-01-13T09:15:00Z' },
  { from: '4', text: 'Meeting at 3 PM today', timestamp: '2024-01-15T08:00:00Z' },
];

// Define tools that return data without explicit clarification handling
const searchContactsTool = defineTool({
  name: 'search_contacts',
  description: 'Search for contacts by name. Returns all matching contacts.',
  parameters: z.object({
    name: z.string().describe('The name to search for')
  }),
  execute: async (args) => {
    const matches = CONTACTS.filter(c =>
      c.name.toLowerCase().includes(args.name.toLowerCase())
    );

    return {
      status: 'success',
      data: {
        query: args.name,
        matches: matches,
        count: matches.length
      }
    };
  }
});

const getMessagesTool = defineTool({
  name: 'get_messages',
  description: 'Get messages from a specific contact by their ID',
  parameters: z.object({
    contactId: z.string().describe('The ID of the contact')
  }),
  execute: async (args) => {
    const contact = CONTACTS.find(c => c.id === args.contactId);
    if (!contact) {
      return {
        status: 'error',
        error: 'Contact not found'
      };
    }

    const messages = MESSAGES.filter(m => m.from === args.contactId);

    return {
      status: 'success',
      data: {
        contact: contact,
        messages: messages,
        count: messages.length
      }
    };
  }
});

// Define agent
const messageAgent = defineAgent({
  name: 'MessageAssistant',
  instructions: () => `You are a helpful assistant that helps users find and read their messages.

When searching for contacts:
- If a user's query is ambiguous and returns multiple distinct people, you should use the request_user_clarification tool to ask which contact they mean
- If the query is specific enough (e.g., includes full name), proceed without clarification
- Present options clearly with full names

After getting clarification or finding a unique contact, retrieve their messages.`,
  tools: [searchContactsTool, getMessagesTool],
  outputCodec: z.object({
    summary: z.string(),
    messages: z.array(z.object({
      text: z.string(),
      timestamp: z.string()
    })).optional()
  })
});

// Demo function
async function demo() {
  console.log('=== HITL Clarification Demo ===\n');

  const agentRegistry = new Map();
  agentRegistry.set('MessageAssistant', messageAgent);

  // Test Case 1: Ambiguous query (should trigger clarification)
  console.log('📧 Test Case 1: Ambiguous query');
  console.log('User: "Show me messages from Sahil"\n');

  const state1 = {
    runId: createRunId('demo-1'),
    traceId: createTraceId('trace-1'),
    messages: [{
      role: 'user' as const,
      content: 'Show me messages from Sahil'
    }],
    currentAgentName: 'MessageAssistant',
    context: {},
    turnCount: 0
  };

  const config = {
    agentRegistry,
    modelProvider: litellmProvider,
    modelOverride: process.env.MODEL || 'gpt-4o-mini',
    onEvent: (event: any) => {
      if (event.type === 'clarification_requested') {
        console.log('\n🔔 Clarification Requested:');
        console.log(`Question: ${event.data.question}`);
        console.log('Options:');
        event.data.options.forEach((opt: any, idx: number) => {
          console.log(`  ${idx + 1}. ${opt.label} (ID: ${opt.id})`);
        });
        console.log();
      } else if (event.type === 'clarification_provided') {
        console.log(`\n✅ User selected: ${event.data.selectedId}\n`);
      } else if (event.type === 'assistant_message') {
        const content = typeof event.data.message.content === 'string'
          ? event.data.message.content
          : '';
        if (content && !content.includes('_clarification_trigger')) {
          console.log(`🤖 Assistant: ${content.substring(0, 100)}...`);
        }
      }
    }
  };

  let result = await run(state1, config);

  // Check if clarification was requested
  if (result.outcome.status === 'interrupted') {
    const clarificationInterruption = result.outcome.interruptions.find(
      (i: any) => i.type === 'clarification_required'
    );

    if (clarificationInterruption) {
      console.log('⏸️  Execution paused for clarification\n');

      // Simulate user selecting option 1 (Sahil Kumar)
      const selectedOption = (clarificationInterruption as any).options[0];
      console.log(`👤 User selects: ${selectedOption.label}\n`);

      // Resume with clarification
      result = await resumeWithClarification(
        result.finalState,
        config,
        (clarificationInterruption as any).clarificationId,
        selectedOption.id
      );
    }
  }

  if (result.outcome.status === 'completed') {
    console.log('\n✅ Final Result:');
    console.log(JSON.stringify(result.outcome.output, null, 2));
  }

  console.log('\n---\n');

  // Test Case 2: Specific query (should NOT trigger clarification)
  console.log('📧 Test Case 2: Specific query');
  console.log('User: "Show me messages from Sahil Kumar"\n');

  const state2 = {
    runId: createRunId('demo-2'),
    traceId: createTraceId('trace-2'),
    messages: [{
      role: 'user' as const,
      content: 'Show me messages from Sahil Kumar'
    }],
    currentAgentName: 'MessageAssistant',
    context: {},
    turnCount: 0
  };

  const result2 = await run(state2, config);

  if (result2.outcome.status === 'completed') {
    console.log('\n✅ Final Result (no clarification needed):');
    console.log(JSON.stringify(result2.outcome.output, null, 2));
  }

  console.log('\n=== Demo Complete ===');
}

// Run the demo
demo().catch(console.error);
