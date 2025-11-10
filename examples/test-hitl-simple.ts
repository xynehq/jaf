/**
 * Simple HITL Test - Minimal version to test clarification workflow
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

type DemoCtx = { userId: string };

// Simulated database
const CONTACTS = [
  { id: '1', name: 'Sahil Kumar', email: 'sahil.kumar@example.com', department: 'Engineering' },
  { id: '2', name: 'Sahil Nagarale', email: 'sahil.nagarale@example.com', department: 'Product' },
  { id: '3', name: 'Sahil Bansal', email: 'sahil.bansal@example.com', department: 'Sales' },
];

const MESSAGES = [
  { from: '1', text: 'Hey, can you review my PR?', timestamp: '2024-01-15T10:30:00Z' },
  { from: '2', text: 'Product roadmap meeting at 2 PM', timestamp: '2024-01-14T14:20:00Z' },
  { from: '3', text: 'Client demo went great!', timestamp: '2024-01-13T09:15:00Z' },
];

// Tools
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
      return JSON.stringify({ status: 'error', error: 'Contact not found' });
    }

    const messages = MESSAGES.filter(m => m.from === args.contactId);

    return JSON.stringify({
      status: 'success',
      data: {
        contact: { name: contact.name, email: contact.email, department: contact.department },
        messages: messages.map(m => ({ text: m.text, timestamp: m.timestamp })),
        count: messages.length
      }
    });
  }
};

// Agent WITHOUT outputCodec to avoid JSON mode conflicts
const messageAgent: Agent<DemoCtx, any> = {
  name: 'MessageAssistant',
  instructions: () => `You are a helpful assistant that helps users find and read their messages.

IMPORTANT WORKFLOW:
1. First, use search_contacts tool to find matching contacts
2. If you find MULTIPLE DISTINCT people → YOU MUST use request_user_clarification tool
3. When using request_user_clarification:
   - Ask "Which Sahil do you mean?"
   - Provide options with name AND department: "Sahil Kumar (Engineering)"
   - Use the contact ID as the option ID
   - You MUST call this tool - DO NOT try to guess or pick one
4. After clarification, use get_messages with the selected contact ID

REMEMBER: Multiple people = MUST use request_user_clarification!`,
  tools: [searchContactsTool, getMessagesTool]
  // NOTE: Removed outputCodec to avoid JSON mode conflicts
};

async function testClarification() {
  console.log('=== Simple HITL Clarification Test ===\\n');

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

  console.log('📧 Test: Ambiguous query "Show me messages from Sahil"\\n');

  const state: RunState<DemoCtx> = {
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

  let clarificationNeeded: any = null;

  console.log('🌊 Starting stream...\\n');

  // Stream events
  for await (const event of runStream(state, config)) {
    handleEvent(event);

    if (event.type === 'run_end') {
      const outcome = event.data.outcome;

      if (outcome.status === 'interrupted') {
        const clarification = outcome.interruptions.find(
          (i: any) => i.type === 'clarification_required'
        );

        if (clarification) {
          clarificationNeeded = clarification;
          console.log('\\n⏸️  PAUSED - Clarification required!');
          console.log(`Question: ${clarification.question}`);
          console.log('Options:');
          clarification.options.forEach((opt: any, idx: number) => {
            console.log(`  ${idx + 1}. ${opt.label} (ID: ${opt.id})`);
          });
          break;
        }
      } else if (outcome.status === 'completed') {
        console.log('\\n✅ Completed without clarification');
        console.log('Result:', JSON.stringify(outcome.output, null, 2));
      } else if (outcome.status === 'error') {
        console.log('\\n❌ Error:', outcome.error);
      }
    }
  }

  // Resume with user selection
  if (clarificationNeeded) {
    const selectedId = clarificationNeeded.options[0].id;
    console.log(`\\n👤 User selects: ${clarificationNeeded.options[0].label}\\n`);
    console.log('🔄 Resuming...\\n');

    const stateWithClarification = {
      ...state,
      clarifications: new Map([[clarificationNeeded.clarificationId, selectedId]])
    };

    for await (const event of runStream(stateWithClarification, config)) {
      handleEvent(event);

      if (event.type === 'run_end') {
        const outcome = event.data.outcome;
        if (outcome.status === 'completed') {
          console.log('\\n✅ Completed after clarification!');
          console.log('Result:', JSON.stringify(outcome.output, null, 2));
        }
      }
    }
  }

  console.log('\\n=== Test Complete ===');
}

function handleEvent(event: TraceEvent | any) {
  switch (event.type) {
    case 'turn_start':
      console.log(`🔄 Turn ${event.data.turn} started`);
      break;

    case 'tool_call_start':
      console.log(`🔧 Tool: ${event.data.toolName}`);
      if (event.data.toolName === 'request_user_clarification') {
        console.log('   ⚠️  CLARIFICATION TOOL CALLED!');
      }
      console.log(`   Args: ${JSON.stringify(event.data.args)}`);
      break;

    case 'tool_call_end':
      if (event.data.status === 'success') {
        console.log(`✓ Tool completed: ${event.data.toolName}`);
        if (event.data.toolName === 'search_contacts') {
          try {
            const result = JSON.parse(event.data.result);
            console.log(`   Found ${result.data?.count || 0} matches`);
          } catch (e) { }
        }
      } else {
        console.log(`✗ Tool failed: ${event.data.toolName}`);
      }
      break;

    case 'clarification_requested':
      console.log('\\n🔔 Clarification Event!');
      console.log(`   Question: ${event.data.question}`);
      break;

    case 'turn_end':
      console.log(`✓ Turn ${event.data.turn} ended\\n`);
      break;
  }
}

testClarification().catch(console.error);
