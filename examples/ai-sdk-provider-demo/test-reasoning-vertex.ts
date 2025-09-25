/**
 * Reasoning streaming demo with Vertex (Gemini) via AI SDK.
 *
 * Prerequisites:
 * - gcloud auth application-default login
 * - env: VERTEX_PROJECT_ID, VERTEX_LOCATION, VERTEX_ACCESS_TOKEN
 *
 * Run:
 *   pnpm --filter jaf-ai-sdk-provider-demo run test:reasoning:vertex
 */
import 'dotenv/config';
import { createVertex } from '@ai-sdk/google-vertex';
import { callWithReasoning } from '@xynehq/jaf/adk';

const REQ_VARS = ['VERTEX_PROJECT_ID', 'VERTEX_LOCATION', 'VERTEX_ACCESS_TOKEN'] as const;

async function main() {
  for (const k of REQ_VARS) {
    if (!process.env[k]) {
      console.log(`[reasoning-vertex] Skipping: missing ${k}`);
      process.exit(0);
    }
  }

  const vertex = createVertex({
    project: process.env.VERTEX_PROJECT_ID!,
    location: process.env.VERTEX_LOCATION!,
    headers: { Authorization: `Bearer ${process.env.VERTEX_ACCESS_TOKEN}` },
  });

  const model = vertex(process.env.VERTEX_REASONING_MODEL || 'gemini-2.5-pro');

  const res = await callWithReasoning({
    provider: 'vertex',
    model,
    prompt: 'In one short paragraph, explain parallax.',
    reasoning: { enabled: true, includeThoughts: true },
    stream: true,
    store: false,
  });

  process.stdout.write('Answer: ');
  if (res.textStream) {
    for await (const d of res.textStream) process.stdout.write(d);
  }
  process.stdout.write('\n');

  if (res.reasoningStream) {
    process.stdout.write('\n--- Reasoning (collapsible in UI) ---\n');
    for await (const r of res.reasoningStream) process.stdout.write(r);
    process.stdout.write('\n');
  } else {
    console.log('[reasoning-vertex] No reasoning stream available');
  }
}

main().catch((err) => {
  console.error('[reasoning-vertex] ERROR:', err);
  process.exit(1);
});

