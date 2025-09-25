/**
 * Reasoning streaming demo with OpenAI via AI SDK.
 *
 * Prerequisites:
 * - Set OPENAI_API_KEY in environment or .env.
 *
 * Run:
 *   pnpm --filter jaf-ai-sdk-provider-demo run test:reasoning
 */
import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';
import { callWithReasoning } from '@xynehq/jaf/adk';

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.log('[reasoning-openai] Skipping: missing OPENAI_API_KEY');
    process.exit(0);
  }

  const openai = createOpenAI();
  const model = openai.chat(process.env.OPENAI_REASONING_MODEL || 'o3-mini');

  const res = await callWithReasoning({
    provider: 'openai',
    model,
    prompt: 'In 1-2 sentences: Why do eclipses happen?',
    reasoning: { enabled: true, effort: 'medium', summary: 'auto' },
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
    console.log('[reasoning-openai] No reasoning stream available');
  }
}

main().catch((err) => {
  console.error('[reasoning-openai] ERROR:', err);
  process.exit(1);
});

