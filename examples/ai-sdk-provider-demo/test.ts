/**
 * Real example test for the AI SDK provider using Azure OpenAI via direct REST calls.
 *
 * Prerequisites:
 * - Set these Azure environment variables (e.g., in examples/ai-sdk-provider-demo/.env):
 *   AZURE_OPENAI_API_KEY=...                         // required
 *   AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com   // required
 *   AZURE_OPENAI_DEPLOYMENT=<deployment-name>              // required (e.g., your deployed model name)
 *   AZURE_OPENAI_API_VERSION=2025-01-01-preview      // required (or another supported version)
 *
 * From repo root:
 *   1) pnpm -w install
 *   2) pnpm --filter jaf-ai-sdk-provider-demo run test
 *
 * Notes:
 * - This performs a real network call. If required env vars are not set, the test is skipped.
 * - Uses the Core-level AI SDK provider [makeAiSdkProvider()](src/providers/ai-sdk.ts:99) but with a client that calls Azure REST directly.
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import { run, createRunId, createTraceId, type RunConfig } from '@xynehq/jaf';
import { makeAiSdkProvider } from '@xynehq/jaf/providers';

const AZURE_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT; // e.g., https://my-resource.openai.azure.com
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT; // your deployment name
const AZURE_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';

if (!AZURE_API_KEY || !AZURE_ENDPOINT || !AZURE_DEPLOYMENT) {
  console.log('[ai-sdk-provider-demo] Skipping real test: missing Azure env vars. Required: AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT');
  process.exit(0);
}

// In Azure, the "model" is represented by your deployment name
const MODEL = process.env.MODEL_NAME || AZURE_DEPLOYMENT;

// Minimal AiSdk-compatible client wrapper using Azure REST Chat Completions
const aiClient = {
  async chat(request: any) {
    // Build Azure messages array from the request. Keep system + user/assistant; this demo does not use tools.
    const systemContent = request.messages.find((m: any) => m.role === 'system')?.content || '';
    const azureMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

    if (systemContent) {
      azureMessages.push({ role: 'system', content: systemContent });
    }

    for (const m of request.messages) {
      if (m.role === 'user' || m.role === 'assistant') {
        azureMessages.push({ role: m.role, content: m.content ?? '' });
      }
      // Note: tool/tool_calls omitted in this minimal example
    }

    // Azure Chat Completions endpoint for a specific deployment (streaming enabled)
    const url = `${AZURE_ENDPOINT}/openai/deployments/${MODEL}/chat/completions?api-version=${encodeURIComponent(AZURE_API_VERSION)}`;

    const payload = {
      messages: azureMessages,
      temperature: request.temperature,
      max_completion_tokens: request.max_tokens ?? request.maxTokens,
      stream: true
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': AZURE_API_KEY!,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Azure OpenAI call failed: ${resp.status} ${resp.statusText} - ${text}`);
    }

    // Parse SSE stream and aggregate incremental content
    let aggregated = '';
    console.log('[ai-sdk-provider-demo] Streaming tokens:');
    const reader = (resp.body as any)?.getReader?.();
    const decoder = new TextDecoder();
    let buffer = '';

    if (reader) {
      let doneReading = false;
      while (!doneReading) {
        const { value, done } = await reader.read();
        if (done) {
          doneReading = true;
          break;
        }
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

        let idx: number;
        // SSE events are separated by blank lines
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);

          if (!rawEvent) continue;
          const lines = rawEvent.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') {
              // End of stream marker
              buffer = '';
              break;
            }
            try {
              const json = JSON.parse(dataStr);
              // OpenAI/Azure streaming deltas
              const delta = json?.choices?.[0]?.delta;
              const token = delta?.content ?? '';
              if (token) {
                aggregated += token;
                try { process.stdout.write(token); } catch { /* ignore */ }
              }
            } catch {
              // ignore malformed chunk
            }
          }
        }
      }
    } else {
      // Fallback to non-streaming parse if body doesn't support getReader()
      const data: any = await resp.json().catch(() => ({}));
      const choiceMsg = data?.choices?.[0]?.message;
      aggregated = choiceMsg?.content ?? '';
    }

    // ensure newline after streaming
    process.stdout.write('\n');

    return {
      message: {
        content: aggregated || null,
        // tool_calls omitted in this streaming demo
      }
      // usage typically not present in SSE deltas; omit
    };
  },
};

async function main() {
  const modelProvider = makeAiSdkProvider(aiClient as any);

  // Define a simple agent
  const agent = {
    name: 'AzureAISDKDemo',
    instructions: () => 'You are a helpful assistant. Respond concisely.',
    modelConfig: {
      name: MODEL,
      maxTokens: 50000,
    },
    // Tools can be added here; the provider will convert Zod schemas to JSON Schema
    tools: [],
  };

  // Create RunConfig
  const config: RunConfig<any> = {
    agentRegistry: new Map([[agent.name, agent as any]]),
    modelProvider,
    maxTurns: 2,
  };

  // Initial state with a deterministic-style prompt
  const initialState = {
    runId: createRunId(randomUUID()),
    traceId: createTraceId(randomUUID()),
    messages: [
      {
        role: 'user' as const,
        content: 'List all Prime Ministers of India with their detailed descriptions, including tenure years, key policies, and notable contributions along with the full descriptions.',
      },
    ],
    currentAgentName: agent.name,
    context: {},
    turnCount: 0,
  };

  console.log(`[ai-sdk-provider-demo] Running with Azure deployment=${MODEL} endpoint=${AZURE_ENDPOINT} apiVersion=${AZURE_API_VERSION}`);

  const result = await run<any, string>(initialState as any, config);

  if (result.outcome.status === 'completed') {
    const output = result.outcome.output;
    console.log('[ai-sdk-provider-demo] Output:', output);

    // Basic assertion: ensure we received non-empty output
    if (typeof output === 'string' && output.trim().length > 0) {
      console.log('[ai-sdk-provider-demo] SUCCESS');
      process.exit(0);
    } else {
      console.error('[ai-sdk-provider-demo] FAIL: Empty output');
      process.exit(1);
    }
  } else {
    console.error('[ai-sdk-provider-demo] FAIL:', result.outcome.error);
    process.exit(1);
  }
}

// no top-level await in CJS; tsx supports top-level await, but wrap to be safe
main().catch((err) => {
  console.error('[ai-sdk-provider-demo] ERROR:', err);
  process.exit(1);
});