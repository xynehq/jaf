#!/usr/bin/env tsx

import 'dotenv/config';
import { z } from 'zod';

import { runServer, Agent, Tool, makeLiteLLMProvider, createMemoryProviderFromEnv } from '@xynehq/jaf';

// Tools that require approval
const redirectTool: Tool<{ url: string; reason?: string }, any> = {
  schema: {
    name: 'redirectUser',
    description: 'Redirect user to a different screen/page',
    parameters: z.object({
      url: z.string().describe('The URL to redirect to'),
      reason: z.string().optional().describe('Reason for redirect'),
    }) as z.ZodType<{ url: string; reason?: string }>,
  },
  needsApproval: true,
  execute: async ({ url, reason }, context) => {
    // Simulate using context provided through approval
    const prev = context.currentScreen ? ` from ${context.currentScreen}` : '';
    return `Redirected user${prev} to ${url}. Reason: ${reason ?? 'n/a'}`;
  },
};

const sendDataTool: Tool<{ data: string; recipient: string }, any> = {
  schema: {
    name: 'sendSensitiveData',
    description: 'Send sensitive data to a recipient',
    parameters: z.object({
      data: z.string().describe('The sensitive data to send'),
      recipient: z.string().describe('Who to send the data to'),
    }) as z.ZodType<{ data: string; recipient: string }>,
  },
  needsApproval: true,
  execute: async ({ data, recipient }, context) => {
    const level = context.encryptionLevel || 'none';
    return `Sent data to ${recipient} with encryption=${level}.`; 
  },
};

const hitlAgent: Agent<any, string> = {
  name: 'HITL Demo Agent',
  instructions: () => `You are a helpful assistant. Use tools when appropriate.
Tools:
- redirectUser (requires approval)
- sendSensitiveData (requires approval)
`,
  tools: [redirectTool, sendDataTool],
  modelConfig: { name: process.env.LITELLM_MODEL || 'gpt-3.5-turbo', temperature: 0.1 },
};

async function main() {
  const host = process.env.HOST || '127.0.0.1';
  const port = parseInt(process.env.PORT || '3000', 10);

  // Model provider
  const baseURL = process.env.LITELLM_URL || 'http://localhost:4000';
  const apiKey = process.env.LITELLM_API_KEY || 'sk-demo';
  const modelProvider = makeLiteLLMProvider(baseURL, apiKey);

  // Memory provider from env (memory/redis/postgres)
  const memoryProvider = await createMemoryProviderFromEnv({});

  // Start server
  await runServer(
    [hitlAgent],
    {
      modelProvider,
      maxTurns: 6,
      memory: {
        provider: memoryProvider,
        autoStore: true,
        maxMessages: 200,
      },
    },
    {
      host,
      port,
      defaultMemoryProvider: memoryProvider,
    }
  );

  // Usage hints
  console.log('\n✅ HITL Server Running');
  console.log(`Base URL: http://${host}:${port}`);
  console.log('');

  console.log('Endpoints:');
  console.log(`• Health:               GET  /health`);
  console.log(`• Agents:               GET  /agents`);
  console.log(`• Chat:                 POST /chat`);
  console.log(`• Pending Approvals:    GET  /approvals/pending?conversationId=...`);
  console.log(`• Approvals SSE Stream: GET  /approvals/stream?conversationId=...`);
  console.log('');

  console.log('Example: Start a conversation that requires approval');
  console.log(`curl -s -X POST http://${host}:${port}/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [{"role":"user","content":"Please redirect me to /dashboard"}],
    "agentName": "HITL Demo Agent",
    "conversationId": "hitl-conv-1",
    "context": {"userId":"demo","currentScreen":"/home"},
    "stream": false
  }' | jq`);
  console.log('');

  console.log('Subscribe to approval-required events via SSE');
  console.log(`curl -N http://${host}:${port}/approvals/stream?conversationId=hitl-conv-1`);
  console.log('');

  console.log('List pending approvals (snapshot)');
  console.log(`curl http://${host}:${port}/approvals/pending?conversationId=hitl-conv-1 | jq`);
  console.log('');

  console.log('Approve using the new approvals array (replace with real sessionId/toolCallId):');
  console.log(`curl -s -X POST http://${host}:${port}/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [],
    "agentName": "HITL Demo Agent",
    "conversationId": "hitl-conv-1",
    "approvals": [{
      "type": "approval",
      "sessionId": "<sessionId-from-interruption>",
      "toolCallId": "<toolCallId-from-interruption>",
      "approved": true,
      "additionalContext": {"currentScreen":"/dashboard"}
    }]
  }' | jq`);
  console.log('');

  console.log('Reject example:');
  console.log(`curl -s -X POST http://${host}:${port}/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [],
    "agentName": "HITL Demo Agent",
    "conversationId": "hitl-conv-1",
    "approvals": [{
      "type": "approval",
      "sessionId": "<sessionId>",
      "toolCallId": "<toolCallId>",
      "approved": false,
      "additionalContext": {"rejectionReason":"not authorized"}
    }]
  }' | jq`);
  console.log('');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
