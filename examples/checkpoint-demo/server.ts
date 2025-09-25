import 'dotenv/config';
import IORedis from 'ioredis';

import { runServer } from '../../src/server/index';
import { makeLiteLLMProvider } from '../../src/providers/model';
import { createMemoryProviderFromEnv } from '../../src/memory/factory';
import { Agent } from '../../src/core/types';

async function startCheckpointDemo() {
  // Configure LiteLLM provider
  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000';
  const litellmKey = process.env.LITELLM_API_KEY || 'anything';

  const modelProvider = makeLiteLLMProvider(litellmUrl, litellmKey);

  // Configure Redis client for memory provider
  const redisHost = process.env.JAF_REDIS_HOST || '127.0.0.1';
  const redisPort = parseInt(process.env.JAF_REDIS_PORT || '6379', 10);
  const redisPassword = process.env.JAF_REDIS_PASSWORD || undefined;
  const redisDb = parseInt(process.env.JAF_REDIS_DB || '0', 10);

  const redis = new IORedis({ host: redisHost, port: redisPort, password: redisPassword, db: redisDb });
  const memory = await createMemoryProviderFromEnv({ redis });

  // Simple demo agent
  const agent: Agent<any, any> = {
    name: 'DemoAgent',
    instructions: () => 'You are a helpful assistant. Keep responses short.',
    tools: [],
    modelConfig: { name: process.env.DEMO_MODEL || 'gemini-2.5-pro', temperature: 0.2, maxTokens: 300 }
  };

  // Start server
  const server = await runServer([agent], { modelProvider }, { port: parseInt(process.env.DEMO_PORT || '3000', 10), defaultMemoryProvider: memory });
  const port = parseInt(process.env.DEMO_PORT || '3000', 10);
  const base = `http://localhost:${port}`;

  const conversationId = process.env.DEMO_CONV_ID || 'conv-checkpoint-demo-1';

  // Helpful curl snippets
  console.log('\n✅ Checkpoint Demo Server Ready');
  console.log(`   Base URL: ${base}`);
  console.log(`   LiteLLM: ${litellmUrl}`);
  console.log(`   Redis: ${redisHost}:${redisPort}/${redisDb}`);

  console.log('\nTry these commands:');
  console.log('\n1) Create conversation and store messages');
  console.log(
    `curl -X POST ${base}/chat \
  -H 'Content-Type: application/json' \
  -d '${JSON.stringify({
        messages: [
          { id: 'msg_u1', role: 'user', content: 'Plan a 2-day trip to Kyoto.' }
        ],
        agentName: agent.name,
        conversationId,
        memory: { autoStore: true, storeOnCompletion: true }
      })}'`
  );

  console.log('\n2) Inspect stored conversation');
  console.log(`curl ${base}/conversations/${conversationId}`);

  console.log('\n3) Continue conversation');
  console.log(
    `curl -X POST ${base}/chat \
  -H 'Content-Type: application/json' \
  -d '${JSON.stringify({
        messages: [
          { id: 'msg_u2', role: 'user', content: 'Add a tea ceremony on day 1.' }
        ],
        agentName: agent.name,
        conversationId,
        memory: { autoStore: true, storeOnCompletion: true }
      })}'`
  );

  console.log('\n4) Checkpoint to the first user message by ID (remove that and everything after)');
  console.log(
    `curl -X POST ${base}/conversations/${conversationId}/checkpoint \
  -H 'Content-Type: application/json' \
  -d '${JSON.stringify({ byMessageId: 'msg_u1' })}'`
  );

  console.log('\n5) Verify conversation after checkpoint');
  console.log(`curl ${base}/conversations/${conversationId}`);

  console.log('\n6) Continue again after checkpoint');
  console.log(
    `curl -X POST ${base}/chat \
  -H 'Content-Type: application/json' \
  -d '${JSON.stringify({
        messages: [
          { id: 'msg_u3', role: 'user', content: 'Actually, plan a 1-day Kyoto itinerary instead.' }
        ],
        agentName: agent.name,
        conversationId,
        memory: { autoStore: true, storeOnCompletion: true }
      })}'`
  );

  console.log('\nTip: Use jq to pretty-print responses: add | jq');
}

startCheckpointDemo().catch((err) => {
  console.error('❌ Failed to start demo:', err);
  process.exit(1);
});

