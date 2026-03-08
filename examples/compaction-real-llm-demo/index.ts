#!/usr/bin/env tsx

import 'dotenv/config';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import {
  createRunId,
  createTraceId,
  getTextContent,
  type Agent,
  type Message,
  type ModelProvider,
  type RunConfig,
  type RunState,
  type TraceEvent,
} from '../../src/core/types';
import { run } from '../../src/core/engine';

type DemoContext = {
  merchantId: string;
};

type DemoEnv = {
  baseURL: string;
  apiKey: string;
  mainProvider: string;
  mainModel: string;
  compactionProvider: string;
  compactionModel: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  triggerPercentage: number;
};

const colors = {
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  magenta: (text: string) => `\x1b[35m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
};

const LITELLM_REQUEST_HEADERS = {
  'x-litellm-disable-logging': 'true',
};

function loadEnv(): DemoEnv {
  const baseURL = process.env.LITELLM_URL;
  const apiKey =
    process.env.LITELLM_API_KEY;
  const mainProvider =
    process.env.LITELLM_PROVIDER;
  const mainModel =
    process.env.LITELLM_MODEL;

  if (!baseURL || !apiKey || !mainModel) {
    console.log(colors.red('Missing LiteLLM configuration for the real compaction demo.'));
    console.log(
      colors.yellow(
        'Set LITELLM_URL, LITELLM_API_KEY, and LITELLM_MODEL.'
      )
    );
    console.log(colors.dim('Copy examples/compaction-real-llm-demo/.env.example to .env and fill it in.'));
    process.exit(1);
  }

  const resolvedMainProvider = mainProvider || 'direct';
  const compactionProvider =
    process.env.LITELLM_COMPACTION_PROVIDER || mainProvider;
  const compactionModel =
    process.env.LITELLM_COMPACTION_MODEL || mainModel;

  return {
    baseURL: normalizeLiteLLMBaseURL(baseURL),
    apiKey,
    mainProvider: resolvedMainProvider,
    mainModel: resolveLiteLLMModel(mainProvider, mainModel),
    compactionProvider: compactionProvider || 'direct',
    compactionModel: resolveLiteLLMModel(compactionProvider, compactionModel),
    maxInputTokens: parsePositiveInt(
      process.env.LITELLM_MAX_INPUT_TOKENS,
      1600
    ),
    maxOutputTokens: parsePositiveInt(
      process.env.LITELLM_MAX_OUTPUT_TOKENS,
      300
    ),
    triggerPercentage: parseTriggerPercentage(process.env.COMPACTION_TRIGGER_PERCENTAGE, 0.32),
  };
}

function normalizeLiteLLMBaseURL(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/v1')) {
    return trimmed;
  }
  return `${trimmed}/v1`;
}

function resolveLiteLLMModel(provider: string | undefined, model: string): string {
  if (!provider || provider.trim().length === 0 || model.includes('/')) {
    return model;
  }
  return `${provider}/${model}`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseTriggerPercentage(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value || '');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  if (parsed > 1 && parsed <= 100) {
    return parsed / 100;
  }
  if (parsed > 1) {
    return fallback;
  }
  return parsed;
}

function createAgent(env: DemoEnv): Agent<DemoContext, string> {
  return {
    name: 'RealCompactionDemoAgent',
    instructions: () =>
      [
        'You are cleaning support tickets for semantic embeddings and clustering.',
        'Output requirements (STRICT):',
        '- Output JSON only. No code fences, no markdown, no extra text.',
        '- JSON must contain exactly these two keys: "title" and "description".',
        'Title should be concise and normalized.',
        'Description should retain the production issue, merchant, failure symptoms, and exact error wording when present.',
        'Do not mention that the ticket was summarized or compacted.',
      ].join('\n'),
    modelConfig: {
      name: env.mainModel,
      temperature: 0,
      maxTokens: env.maxOutputTokens,
    },
    compaction: {
      enabled: true,
      triggerPercentage: env.triggerPercentage,
      preserveLastAssistantMessage: true,
      minCandidateMessages: 2,
      rules: 'Preserve the core production issue, merchant name, exact payment failures, endpoint references, and important error strings. Drop repeated triage chatter.',
    },
  };
}

function createProvider(
  label: string,
  env: DemoEnv
): ModelProvider<DemoContext> {
  const client = new OpenAI({
    baseURL: env.baseURL,
    apiKey: env.apiKey,
    defaultHeaders: LITELLM_REQUEST_HEADERS,
    dangerouslyAllowBrowser: true,
  });

  let callCount = 0;

  return {
    getTokenLimits() {
      return {
        maxInputTokens: env.maxInputTokens,
        maxOutputTokens: env.maxOutputTokens,
      };
    },
    async getCompletion(state, agent, config) {
      callCount += 1;
      const model = agent.modelConfig?.name ?? config.modelOverride;
      if (!model) {
        throw new Error(`No model configured for ${label}`);
      }

      const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
        model,
        temperature: agent.modelConfig?.temperature,
        max_tokens: agent.modelConfig?.maxTokens,
        messages: [
          {
            role: 'system',
            content: agent.instructions(state),
          },
          ...state.messages.map(convertMessageToChatParam),
        ],
      };

      logProviderRequest(`${label} request #${callCount}`, state, agent, params);

      const response = await client.chat.completions.create(
        params as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
      );
      const choice = response.choices[0];
      const result = {
        ...choice,
        usage: response.usage,
        model: response.model,
        id: response.id,
      };

      logProviderResponse(`${label} response #${callCount}`, result);
      return result as any;
    },
  };
}

function convertMessageToChatParam(message: Message): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  switch (message.role) {
    case 'user':
      return {
        role: 'user',
        content: getTextContent(message.content),
      };
    case 'assistant':
      return {
        role: 'assistant',
        content: getTextContent(message.content),
        tool_calls: message.tool_calls as any,
      };
    case 'tool':
      return {
        role: 'tool',
        content: getTextContent(message.content),
        tool_call_id: message.tool_call_id!,
      };
    default:
      throw new Error(`Unsupported role: ${(message as any).role}`);
  }
}

function buildInitialState(agent: Agent<DemoContext, string>): RunState<DemoContext> {
  return {
    runId: createRunId(randomUUID()),
    traceId: createTraceId(randomUUID()),
    messages: [
      {
        role: 'user',
        content:
          'Earlier note dump: merchant nammiyatri flagged a production UPI issue where collect transactions intermittently remain in STARTED, support saw /txns return GATEWAY_NOT_FOUND, and the merchant asked for a crisp ticket summary instead of a long incident narrative.',
      },
      {
        role: 'assistant',
        content:
          'Triage thread summary: multiple analysts repeated that the problem looks gateway-selection related, the merchant is blocked on production traffic, and the ticket should preserve the exact error text "No functional gateways after validating split" because that is what downstream clustering depends on.',
      },
      {
        role: 'user',
        content:
          'Raw ticket notes from the incident room: 3 UPI collect txns stayed in STARTED, retry polling did not resolve them, the /txns lookup returned GATEWAY_NOT_FOUND, and several internal comments repeated that the account is merchant nammiyatri on production with user impact visible to customers.',
      },
      {
        role: 'assistant',
        content:
          'Additional context from noisy handoff notes: some messages blamed routing, some blamed split validation, and several people duplicated the same merchant-impact explanation. Keep the signal: production issue, 3 stuck UPI collect transactions, /txns returning GATEWAY_NOT_FOUND, and the exact validation error. Remove the repetitive chatter.',
      },
      {
        role: 'user',
        content:
          '{"title":"UPI failure","description":"3 UPI collect txns stuck in STARTED; /txns returns GATEWAY_NOT_FOUND. Error: No functional gateways after validating split. Merchant nammiyatri on production.","description_images":[]}',
      },
    ],
    currentAgentName: agent.name,
    context: {
      merchantId: 'nammiyatri',
    },
    turnCount: 0,
  };
}

function onEvent(event: TraceEvent) {
  switch (event.type) {
    case 'llm_call_start':
      console.log(colors.blue(`JAF turn call starting for ${event.data.agentName} with ${event.data.messages?.length ?? 0} transcript messages`));
      break;
    case 'compaction_start':
      console.log(
        colors.magenta(
          `Compaction started: input=${event.data.currentInputTokens}, threshold=${event.data.thresholdTokens}, compactable=${event.data.compactableMessageCount}, preserved=${event.data.preservedMessageCount}`
        )
      );
      break;
    case 'compaction_end':
      console.log(
        colors.magenta(
          `Compaction ${event.data.status}: before=${event.data.beforeInputTokens}, after=${event.data.afterInputTokens ?? '-'}, model=${event.data.model}`
        )
      );
      break;
    case 'token_usage':
      console.log(
        colors.dim(
          `Token usage: prompt=${event.data.prompt ?? '-'} completion=${event.data.completion ?? '-'} total=${event.data.total ?? '-'}`
        )
      );
      break;
    case 'final_output':
      console.log(colors.green(`Final output emitted: ${String(event.data.output)}`));
      break;
  }
}

function logProviderRequest(
  title: string,
  state: Readonly<RunState<DemoContext>>,
  agent: Readonly<Agent<DemoContext, any>>,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParams
) {
  console.log('');
  console.log(colors.bold(colors.yellow(title)));
  console.log(colors.bold(colors.blue('Agent instructions')));
  console.log(agent.instructions(state));
  console.log(colors.bold(colors.blue('JAF message array')));
  console.dir(state.messages.map(toPrintableMessage), { depth: 8, maxArrayLength: null });
  console.log(colors.bold(colors.blue('LiteLLM headers')));
  console.dir(LITELLM_REQUEST_HEADERS, { depth: 4 });
  console.log(colors.bold(colors.blue('LiteLLM request payload')));
  console.dir(params, { depth: 8, maxArrayLength: null });
}

function logProviderResponse(title: string, response: unknown) {
  console.log(colors.bold(colors.green(title)));
  console.dir(response, { depth: 8, maxArrayLength: null });
}

function toPrintableMessage(message: Message) {
  return {
    role: message.role,
    content: message.content,
    tool_calls: message.tool_calls,
    tool_call_id: message.tool_call_id,
  };
}

function renderMessage(message: Message, index: number): string {
  if (message.tool_calls && message.tool_calls.length > 0) {
    return `${index + 1}. assistant tool call -> ${message.tool_calls.map((toolCall) => toolCall.function.name).join(', ')}`;
  }
  if (message.role === 'tool') {
    return `${index + 1}. tool -> ${truncate(getTextContent(message.content), 180)}`;
  }
  return `${index + 1}. ${message.role} -> ${truncate(getTextContent(message.content), 180)}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

async function main() {
  const env = loadEnv();
  const agent = createAgent(env);

  console.log(colors.bold(colors.blue('JAF Real LiteLLM Compaction Demo')));
  console.log(colors.dim(`LiteLLM URL: ${env.baseURL}`));
  console.log(colors.dim(`Main provider/model: ${env.mainModel}`));
  console.log(colors.dim(`Compaction provider/model: ${env.compactionModel}`));
  console.log(colors.dim(`Configured max input tokens: ${env.maxInputTokens}`));
  console.log(colors.dim(`Compaction trigger percentage: ${env.triggerPercentage}\n`));

  const mainProvider = createProvider('Main turn model', env);
  const compactionProvider = createProvider('Compaction model', env);

  const config: RunConfig<DemoContext> = {
    agentRegistry: new Map([[agent.name, agent]]),
    modelProvider: mainProvider,
    compaction: {
      modelProvider: compactionProvider,
      modelOverride: env.compactionModel,
    },
    maxTurns: 4,
    onEvent,
  };

  const result = await run<DemoContext, string>(buildInitialState(agent), config);

  console.log('');
  console.log(colors.bold(colors.yellow('Final transcript after the run')));
  result.finalState.messages.forEach((message, index) => {
    console.log(renderMessage(message, index));
  });

  console.log('');
  if (result.outcome.status === 'completed') {
    console.log(colors.bold(colors.green('Run completed successfully')));
    console.log(result.outcome.output);
  } else {
    console.log(colors.bold(colors.yellow(`Run ended with status: ${result.outcome.status}`)));
    console.dir(result.outcome, { depth: 8 });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
