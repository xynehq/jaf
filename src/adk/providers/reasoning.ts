/**
 * Cross-provider reasoning wrapper on top of Vercel AI SDK.
 *
 * Minimal, additive utility that does not change existing behavior.
 * It provides a single `callWithReasoning` with normalized outputs
 * and maps provider-agnostic ReasoningOptions to provider-specific knobs.
 */

import type { LanguageModel } from 'ai';
import { generateText, streamText, type CoreMessage } from 'ai';

// ========== Types ==========

export type ReasoningOptions =
  | { enabled: false }
  | {
      enabled: true;
      effort?: 'minimal' | 'low' | 'medium' | 'high'; // OpenAI
      budgetTokens?: number; // Anthropic/Bedrock
      tokenBudget?: number; // Cohere
      includeThoughts?: boolean; // Vertex
      summary?: 'auto' | 'detailed'; // OpenAI summaries
    };

export type CallParams = {
  provider: 'openai' | 'anthropic' | 'cohere' | 'deepseek' | 'vertex' | 'bedrock';
  model: LanguageModel; // AI SDK model instance, created by the caller
  messages?: Array<CoreMessage>;
  prompt?: string;
  reasoning?: ReasoningOptions;
  stream?: boolean;
  store?: boolean; // Optional pass-through to provider to disable storage
  providerOptions?: Record<string, any>; // passthrough escape hatch
  suppressReasoning?: boolean; // feature-flag: hide reasoning from UI/storage
};

export type NormalizedResult = {
  text: string;
  reasoningText?: string;
  reasoningParts?: Array<{ text: string; providerMetadata?: any }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  };
  providerMetadata?: Record<string, any>;
  // Streams (present when stream=true)
  textStream?: AsyncIterable<string>;
  reasoningStream?: AsyncIterable<string>;
  fullStream?: AsyncIterable<any>;
};

// ========== Provider mapping ==========

export function withProviderReasoning(
  provider: CallParams['provider'],
  ro?: ReasoningOptions,
) {
  if (!ro?.enabled) return {} as Record<string, any>;

  switch (provider) {
    case 'anthropic':
      return {
        anthropic: {
          thinking: { type: 'enabled', budgetTokens: ro.budgetTokens ?? 12000 },
          sendReasoning: true,
        },
      };
    case 'openai':
      return {
        openai: {
          reasoningSummary: ro.summary ?? 'auto',
          reasoningEffort: ro.effort ?? 'medium',
        },
      };
    case 'cohere':
      return {
        cohere: { thinking: { type: 'enabled', tokenBudget: ro.tokenBudget ?? 200 } },
      };
    case 'deepseek':
      // DeepSeek reasoning only comes via stream. No request knob required.
      return {} as Record<string, any>;
    case 'vertex':
      // Vertex provider uses google options under the hood
      return {
        google: { thinkingConfig: { includeThoughts: ro.includeThoughts ?? true } },
      };
    case 'bedrock': {
      const raw = ro.budgetTokens ?? 2048;
      const budgetTokens = Math.max(1024, Math.min(raw, 64000));
      return {
        bedrock: { reasoningConfig: { type: 'enabled', budgetTokens } },
      };
    }
  }
}

//undefined is not correct
function mergeProviderOptions(
  base: Record<string, any> | undefined,
  extra: Record<string, any> | undefined,
): Record<string, any> | undefined {
  if (!base && !extra) return undefined;
  return { ...(base ?? {}), ...(extra ?? {}) };
}

function shouldSuppressReasoning(params: CallParams): boolean {
  if (typeof params.suppressReasoning === 'boolean') return params.suppressReasoning;
  const envFlag = process.env.JAF_SUPPRESS_REASONING;
  return envFlag === '1' || envFlag === 'true';
}

// Extract only reasoning deltas from fullStream
export async function* reasoningOnly(fullStream: AsyncIterable<any>): AsyncGenerator<string> {
  for await (const evt of fullStream) {
    if (evt && evt.type === 'reasoning') {
      // Try common delta shapes
      const val =
        typeof evt.delta === 'string'
          ? evt.delta
          : typeof evt.textDelta === 'string'
          ? evt.textDelta
          : typeof evt.text === 'string'
          ? evt.text
          : typeof evt.content === 'string'
          ? evt.content
          : '';
      if (val) yield val;
    }
  }
}

// ========== Main entry ==========

export async function callWithReasoning(params: CallParams): Promise<NormalizedResult> {
  const { provider, model, messages, prompt, reasoning, stream, store } = params;

  // Provider-specific reasoning knobs
  const mapped = withProviderReasoning(provider, reasoning);

  // OpenAI: when store:false, ensure include ['reasoning.encrypted_content']
  let providerOptions = mergeProviderOptions(params.providerOptions, mapped);
  if (provider === 'openai' && store === false) {
    providerOptions = providerOptions ?? {};
    providerOptions.openai = providerOptions.openai ?? {};
    const include = new Set<string>(
      Array.isArray(providerOptions.openai.include)
        ? providerOptions.openai.include
        : [],
    );
    include.add('reasoning.encrypted_content');
    providerOptions.openai.include = Array.from(include);
  }

  const hideReasoning = shouldSuppressReasoning(params);

  // Common call options
  const baseOptions: any = {
    model,
    providerOptions,
    // Respect storage preference to be conservative when suppressing
    ...(typeof store === 'boolean' ? { store } : {}),
    ...(hideReasoning ? { store: false } : {}),
  };

  // Support messages or prompt
  const hasMessages = Array.isArray(messages) && messages.length > 0;

  if (stream) {
    const st = await streamText({
      ...baseOptions,
      ...(hasMessages ? { messages } : { prompt }),
    } as any);

    const normalized: NormalizedResult = {
      text: '',
      usage: (st as any).usage,
      providerMetadata: (st as any).response?.providerMetadata ?? undefined,
      textStream: st.textStream,
      fullStream: st.fullStream,
    };

    if (!hideReasoning && st.fullStream) {
      normalized.reasoningStream = reasoningOnly(st.fullStream);
    }
    return normalized;
  }

  const gt = await generateText({
    ...baseOptions,
    ...(hasMessages ? { messages } : { prompt }),
  } as any);

  // Normalize non-streaming
  const reasoningParts: Array<{ text: string; providerMetadata?: any }> = [];
  let reasoningText = '';
  const maybeParts = (gt as any).reasoning ?? (gt as any).reasoningParts ?? [];
  if (Array.isArray(maybeParts)) {
    for (const p of maybeParts) {
      const text = typeof p === 'string' ? p : p?.text ?? '';
      if (text) {
        reasoningParts.push({ text, providerMetadata: p?.providerMetadata });
        reasoningText += text;
      }
    }
  } else if (typeof (gt as any).reasoningText === 'string') {
    reasoningText = (gt as any).reasoningText;
    reasoningParts.push({ text: reasoningText });
  }

  const normalized: NormalizedResult = {
    text: (gt as any).text ?? '',
    usage: (gt as any).usage ?? undefined,
    providerMetadata: (gt as any).response?.providerMetadata ?? undefined,
    ...(hideReasoning
      ? {}
      : {
          reasoningText: reasoningText || undefined,
          reasoningParts: reasoningParts.length > 0 ? reasoningParts : undefined,
        }),
  };

  // Include reasoningTokens if exposed
  const rt = (gt as any).usage?.reasoningTokens ?? (gt as any).reasoningTokens;
  if (typeof rt === 'number') {
    normalized.usage = normalized.usage ?? {};
    normalized.usage.reasoningTokens = rt;
  }

  return normalized;
}

