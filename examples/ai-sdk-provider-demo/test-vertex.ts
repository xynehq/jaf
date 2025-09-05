/**
 * Real example test for the AI SDK provider using Vertex AI (Gemini 2.5 Pro) with streaming (SSE).
 *
 * This uses the Vertex AI REST API (aiplatform.googleapis.com) and requires an OAuth access token.
 * Obtain a token with:
 *   gcloud auth application-default login
 *   export VERTEX_ACCESS_TOKEN="$(gcloud auth print-access-token)"
 *
 * Required environment variables (set in examples/ai-sdk-provider-demo/.env or your shell):
 *   VERTEX_PROJECT_ID=your-gcp-project-id
 *   VERTEX_LOCATION=us-central1                      # or your region (e.g., asia-south1)
 *   VERTEX_MODEL=gemini-2.5-pro                      # model/deployment name on Vertex AI
 *   VERTEX_ACCESS_TOKEN=ya29...
 *
 * Run from repo root:
 *   pnpm --filter jaf-ai-sdk-provider-demo run test:vertex
 *
 * Notes:
 * - The test streams tokens and prints them as they arrive, then returns the full aggregated content
 *   via JAF Core's provider contract using makeAiSdkProvider().
 * - If any required env is missing, the test will skip.
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import { run, createRunId, createTraceId, type RunConfig } from '@xynehq/jaf';
import { makeAiSdkProvider } from '@xynehq/jaf/providers';

const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const VERTEX_MODEL = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
const VERTEX_ACCESS_TOKEN = process.env.VERTEX_ACCESS_TOKEN;

if (!VERTEX_PROJECT_ID || !VERTEX_LOCATION || !VERTEX_MODEL || !VERTEX_ACCESS_TOKEN) {
  console.log('[vertex-ai-provider-demo] Skipping real test: missing env. Required: VERTEX_PROJECT_ID, VERTEX_LOCATION, VERTEX_MODEL, VERTEX_ACCESS_TOKEN');
  process.exit(0);
}

// Minimal AiSdk-compatible client wrapper using Vertex AI REST (streaming)
const aiClient = {
  async chat(request: any) {
    // Build Vertex "contents" from request messages
    const system = request.messages.find((m: any) => m.role === 'system')?.content || '';
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    for (const m of request.messages) {
      if (m.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: m.content ?? '' }] });
      } else if (m.role === 'assistant') {
        // Map assistant history to model role in Vertex conversation
        contents.push({ role: 'model', parts: [{ text: m.content ?? '' }] });
      }
      // Intentionally omit 'tool' messages in this demo
    }

    // Vertex AI streaming endpoint for the selected model
    // Build candidate streaming endpoints (prefer v1, fallback to v1beta) and enforce SSE via alt=sse
    const baseUrl = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com`;
    const urlV1 = `${baseUrl}/v1/projects/${encodeURIComponent(
      VERTEX_PROJECT_ID
    )}/locations/${encodeURIComponent(
      VERTEX_LOCATION
    )}/publishers/google/models/${encodeURIComponent(VERTEX_MODEL)}:streamGenerateContent?alt=sse`;
    const urlV1beta = `${baseUrl}/v1beta/projects/${encodeURIComponent(
      VERTEX_PROJECT_ID
    )}/locations/${encodeURIComponent(
      VERTEX_LOCATION
    )}/publishers/google/models/${encodeURIComponent(VERTEX_MODEL)}:streamGenerateContent?alt=sse`;

    // Vertex generationConfig for temperature and max tokens
    const generationConfig: Record<string, any> = {};
    if (typeof request.temperature === 'number') generationConfig.temperature = request.temperature;
    const maxTokens = request.max_tokens ?? request.maxTokens;
    if (typeof maxTokens === 'number') generationConfig.maxOutputTokens = maxTokens;

    const body: any = {
      contents,
    };
    if (system) {
      body.systemInstruction = {
        role: 'system',
        parts: [{ text: system }],
      };
    }
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    // Try v1 first, then v1beta if needed (404/Not Found scenarios)
    let resp: any;
    let lastErr: string | undefined;

    for (const tryUrl of [urlV1, urlV1beta]) {
      const r = await fetch(tryUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VERTEX_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        resp = r;
        break;
      }
      const t = await r.text().catch(() => '');
      lastErr = `${r.status} ${r.statusText} - ${t}`;
      // Continue to next candidate URL
    }

    if (!resp) {
      throw new Error(`Vertex AI call failed: ${lastErr ?? 'unknown error'}`);
    }

    // Parse SSE stream and aggregate incremental content
    let aggregated = '';
    console.log('[vertex-ai-provider-demo] Streaming tokens:');
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
        // Normalize CRLF to LF and process complete SSE events
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

        // Split on double-newline event boundaries; keep the last partial in buffer
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        let ended = false;
        for (const rawEvent of events) {
          const trimmedEvent = rawEvent.trim();
          if (!trimmedEvent) continue;

          const lines = trimmedEvent.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;

            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') {
              ended = true;
              buffer = '';
              break;
            }

            try {
              const json = JSON.parse(dataStr);
              // Vertex streaming chunks can present either candidates[0].content.parts[].text
              // or a delta-like structure depending on version.
              let token = '';
              const cand = json?.candidates?.[0];

              if (cand?.content?.parts && Array.isArray(cand.content.parts)) {
                token = cand.content.parts.map((p: any) => p?.text ?? '').join('');
              } else if (cand?.delta?.text) {
                token = cand.delta.text;
              }

              if (token) {
                aggregated += token;
                try {
                  process.stdout.write(token);
                } catch {
                  /* ignore */
                }
              }
            } catch {
              // ignore malformed chunk
            }
          }

          if (ended) break;
        }

        if (ended) {
          doneReading = true;
          break;
        }
      }
      // newline flush after streaming
      process.stdout.write('\n');
    } else {
      // Fallback: if body reader is not available, attempt non-streaming parse
      const data: any = await resp.json().catch(() => ({}));
      const cand = data?.candidates?.[0];
      if (cand?.content?.parts && Array.isArray(cand.content.parts)) {
        aggregated = cand.content.parts.map((p: any) => p?.text ?? '').join('');
      } else if (typeof cand?.outputText === 'string') {
        aggregated = cand.outputText;
      }
    }

    return {
      message: {
        content: aggregated || null,
      },
    };
  },
};

async function main() {
  const modelProvider = makeAiSdkProvider(aiClient as any);

  // Define a simple agent
  const agent = {
    name: 'VertexAISDKDemo',
    instructions: () => 'You are a helpful assistant. Respond concisely.',
    modelConfig: {
      name: VERTEX_MODEL,
      maxTokens: 4000,
    },
    tools: [],
  };

  // Create RunConfig
  const config: RunConfig<any> = {
    agentRegistry: new Map([[agent.name, agent as any]]),
    modelProvider,
    maxTurns: 2,
  };

  // Initial state with the requested query
  const initialState = {
    runId: createRunId(randomUUID()),
    traceId: createTraceId(randomUUID()),
    messages: [
      {
        role: 'user' as const,
        content:
          'List all Prime Ministers of India with their detailed descriptions, including tenure years, key policies, and notable contributions.',
      },
    ],
    currentAgentName: agent.name,
    context: {},
    turnCount: 0,
  };

  console.log(
    `[vertex-ai-provider-demo] Running with model=${VERTEX_MODEL} project=${VERTEX_PROJECT_ID} location=${VERTEX_LOCATION}`
  );

  const result = await run<any, string>(initialState as any, config);

  if (result.outcome.status === 'completed') {
    const output = result.outcome.output;
    console.log('[vertex-ai-provider-demo] Output:', output);

    if (typeof output === 'string' && output.trim().length > 0) {
      console.log('[vertex-ai-provider-demo] SUCCESS');
      process.exit(0);
    } else {
      console.error('[vertex-ai-provider-demo] FAIL: Empty output');
      process.exit(1);
    }
  } else {
    console.error('[vertex-ai-provider-demo] FAIL:', result.outcome.error);
    process.exit(1);
  }
}

// no top-level await in CJS; tsx supports top-level await, but wrap to be safe
main().catch((err) => {
  console.error('[vertex-ai-provider-demo] ERROR:', err);
  process.exit(1);
});