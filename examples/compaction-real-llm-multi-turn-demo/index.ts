#!/usr/bin/env tsx

import 'dotenv/config';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { z } from 'zod';
import {
  createRunId,
  createTraceId,
  getTextContent,
  type Agent,
  type Message,
  type ModelProvider,
  type RunConfig,
  type RunResult,
  type RunState,
  type Tool,
  type TraceEvent,
} from '../../src/core/types';
import { run } from '../../src/core/engine';
import { configureSanitization, resetSanitizationConfig } from '../../src/core/tracing';

type DemoContext = {
  accountName: string;
  renewalQuarter: string;
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

type ScriptedTurn = {
  label: string;
  user: string;
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

const SCRIPTED_TURNS: readonly ScriptedTurn[] = [
  {
    label: 'Turn 1',
    user:
      'We are prepping a renewal-risk brief for Northstar Retail, a 980-store commerce customer on a June Q3 renewal worth about $2.4M ARR. The VP of Digital still wants to expand site-search usage to mobile and store kiosks, but the last steering review landed badly because our search relevance improvements have not yet shown up in category conversion. Their CFO, Priyanka Rao, asked for one crisp narrative that explains whether this is execution noise or a structural risk. Keep a running working brief as we go, because I am going to send more notes over several turns.',
  },
  {
    label: 'Turn 2',
    user:
      'New field notes from the support and product threads: during the last two weekend campaigns, search latency on the product-listing path moved from roughly 320 ms p95 to about 1.1 s p95, and merchandising disabled one synonym package because it seemed to amplify irrelevant apparel results for seasonal queries. There were 14 tickets tied to search quality and a few screenshots where zero-result pages showed up for high-volume terms. The customer says store managers are now manually curating landing pages before each promotion because they do not trust the current ranking behavior. Before you answer, call `lookupOperationalPulse` with focus `search_reliability` so the working brief carries the freshest operational metrics, owners, and milestone detail.',
  },
  {
    label: 'Turn 3',
    user:
      'Stakeholder map changed this week. Their original sponsor, Megan Cole, left for another retailer. The interim sponsor is Arun Bedi, who is more skeptical and already asked whether our roadmap commitments from last quarter were too optimistic. Procurement joined the thread early, which usually means they are preparing leverage. Northstar also told us their board wants software spend held roughly flat this year unless a vendor can show a direct margin or conversion lift. So the renewal story now needs to work for both an operator and a finance audience.',
  },
  {
    label: 'Turn 4',
    user:
      'Commercial pressure is getting sharper. A competitor is offering an 18 percent discount, migration support, and a claim that they can be production-ready before holiday planning starts. Northstar is asking us for price protection, a stronger uptime commitment, and a written explanation of how we will avoid another relevance regression. Legal also asked for a cleaner data-locality clause because the customer is expanding into two regions with tighter internal review. Before you answer, call `lookupDealDeskGuidance` with focus `pricing_and_legal` so the brief reflects actual concession guardrails instead of guesses. Keep the brief grounded in what actually matters instead of turning it into a generic account summary.',
  },
  {
    label: 'Turn 5',
    user:
      'Board-pack timing update: Northstar needs a clear path-to-green narrative by Wednesday morning. They specifically want to hear who owns relevance quality, what will improve before the holiday build window, and what they should expect in the next 30 days versus the next quarter. Internally, we do not want to promise new headcount, but we can commit a named search engineer plus a solutions architect for the next six weeks. Finance is okay with targeted credits if we tie them to milestones rather than offering an open-ended concession. Before you answer, call `lookupDeliveryPlan` with focus `holiday_readiness` so the working brief picks up the named owners, dates, and near-term milestones.',
  },
  {
    label: 'Turn 6',
    user:
      'Latest negotiation posture from our side: we can probably hold the discount line to 6 percent if we bundle a two-year term and a phased rollout plan. Product is comfortable promising weekly relevance reviews, a rollback guardrail for synonym changes, and a formal scorecard shared with Arun. We should avoid language that sounds defensive, because the account team thinks confidence matters almost as much as the technical fix. Before you answer, call `lookupDealDeskGuidance` with focus `concession_package` and call `lookupDeliveryPlan` with focus `thirty_day_plan`. Fold that into the working brief, then be ready to give me the final executive-ready version on the next turn.',
  },
  {
    label: 'Turn 7',
    user:
      'Now produce the final executive-ready renewal brief using the accumulated tool-backed notes and conversation context. Output exactly three markdown bullets titled Current state, Top risks, and Recommended next step.',
  },
];

function loadEnv(): DemoEnv {
  const baseURL = process.env.LITELLM_URL;
  const apiKey = process.env.LITELLM_API_KEY;
  const mainProvider = process.env.LITELLM_PROVIDER;
  const mainModel = process.env.LITELLM_MODEL;

  if (!baseURL || !apiKey || !mainModel) {
    console.log(colors.red('Missing LiteLLM configuration for the multi-turn compaction demo.'));
    console.log(colors.yellow('Set LITELLM_URL, LITELLM_API_KEY, and LITELLM_MODEL.'));
    console.log(
      colors.dim(
        'Copy examples/compaction-real-llm-multi-turn-demo/.env.example to .env and fill it in.'
      )
    );
    process.exit(1);
  }

  const resolvedMainProvider = mainProvider || 'direct';
  const compactionProvider = process.env.LITELLM_COMPACTION_PROVIDER || mainProvider;
  const compactionModel = process.env.LITELLM_COMPACTION_MODEL || mainModel;

  return {
    baseURL: normalizeLiteLLMBaseURL(baseURL),
    apiKey,
    mainProvider: resolvedMainProvider,
    mainModel: resolveLiteLLMModel(mainProvider, mainModel),
    compactionProvider: compactionProvider || 'direct',
    compactionModel: resolveLiteLLMModel(compactionProvider, compactionModel),
    maxInputTokens: parsePositiveInt(process.env.LITELLM_MAX_INPUT_TOKENS, 4200),
    maxOutputTokens: parsePositiveInt(process.env.LITELLM_MAX_OUTPUT_TOKENS, 420),
    triggerPercentage: parseTriggerPercentage(process.env.COMPACTION_TRIGGER_PERCENTAGE, 0.38),
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

function createRenewalTools(): readonly Tool<any, DemoContext>[] {
  const lookupOperationalPulse: Tool<any, DemoContext> = {
    schema: {
      name: 'lookupOperationalPulse',
      description:
        'Retrieve the latest operational search signals, incident trends, and named owners for the renewal.',
      parameters: z.object({
        focus: z.enum(['search_reliability', 'category_conversion', 'support_burden']),
      }),
    },
    async execute({ focus }, context) {
      return JSON.stringify(
        {
          accountName: context.accountName,
          focus,
          asOf: '2026-03-09',
          reliability: {
            searchLatencyP95: '1.08s',
            baselineLatencyP95: '320ms',
            zeroResultRate: '3.6%',
            degradedCampaignWeekends: 2,
            supportTicketsLast14Days: 14,
          },
          conversion: {
            categoryConversionDelta: '-2.9%',
            mobileSearchAdoptionStatus: 'paused until latency recovers',
            kioskPilotStatus: 'design approved, launch blocked on relevance confidence',
          },
          ownership: {
            searchEngineer: 'Rina Patel',
            solutionsArchitect: 'Gabe Kim',
            executiveSponsor: 'Lena Ortiz',
          },
          committedActions: [
            'Weekly relevance review with Arun Bedi every Thursday.',
            'Rollback guardrail for synonym changes before the next weekend campaign.',
            'Shared scorecard covering latency, zero-result rate, and category conversion.',
          ],
          watchouts: [
            'Store managers are manually curating promo landing pages because ranking confidence dropped.',
            'The disabled synonym package remains the clearest example of an avoidable regression.',
          ],
        },
        null,
        2
      );
    },
  };

  const lookupDealDeskGuidance: Tool<any, DemoContext> = {
    schema: {
      name: 'lookupDealDeskGuidance',
      description:
        'Retrieve current commercial guardrails, concession limits, and legal posture for the renewal.',
      parameters: z.object({
        focus: z.enum(['pricing_and_legal', 'concession_package', 'board_narrative']),
      }),
    },
    async execute({ focus }, context) {
      return JSON.stringify(
        {
          accountName: context.accountName,
          focus,
          asOf: '2026-03-09',
          pricing: {
            competitorDiscount: '18%',
            approvedStandaloneDiscountCeiling: '6%',
            twoYearTermPosition:
              '6% discount is acceptable with a phased rollout plan and executive scorecard.',
            creditPolicy: 'Targeted service credits only when tied to named milestones.',
          },
          legal: {
            uptimeCommitment:
              'Stronger SLA language can be offered if the rollback guardrail is documented.',
            dataLocalityClause:
              'Updated regional processing addendum is available for the two expansion regions.',
            procurementRisk:
              'Procurement entered early, so margin protection requires a board-safe narrative.',
          },
          messaging: {
            financeAngle:
              'Hold spend roughly flat while tying every concession to measurable conversion or risk reduction.',
            operatorAngle:
              'Show named owners, weekly reviews, and pre-holiday rollback safety.',
          },
          nonNegotiables: [
            'Do not offer open-ended credits.',
            'Do not imply new headcount beyond the named search engineer and solutions architect.',
            'Do not frame the competitor offer as technically equivalent without evidence.',
          ],
        },
        null,
        2
      );
    },
  };

  const lookupDeliveryPlan: Tool<any, DemoContext> = {
    schema: {
      name: 'lookupDeliveryPlan',
      description:
        'Retrieve the current delivery plan, owners, milestones, and 30-day path-to-green commitments.',
      parameters: z.object({
        focus: z.enum(['holiday_readiness', 'thirty_day_plan', 'ownership_map']),
      }),
    },
    async execute({ focus }, context) {
      return JSON.stringify(
        {
          accountName: context.accountName,
          focus,
          asOf: '2026-03-09',
          owners: {
            relevanceLead: 'Rina Patel',
            solutionsArchitect: 'Gabe Kim',
            accountExecutive: 'Maya Thompson',
          },
          next30Days: [
            'Week 1: ship synonym rollback guardrail and validate high-volume seasonal queries.',
            'Week 2: publish a shared scorecard with latency, zero-result rate, and conversion trend.',
            'Week 3: run a controlled relevance review with Arun and merchandising leads.',
            'Week 4: present path-to-green update before holiday build planning starts.',
          ],
          quarterPlan: [
            'Stabilize search latency below 450ms p95.',
            'Recover category conversion through controlled ranking experiments.',
            'Resume mobile and kiosk rollout only after the reliability scorecard stays green for two consecutive weeks.',
          ],
          dependencies: [
            'Named search engineer and solutions architect remain allocated for six weeks.',
            'Northstar must provide merchandising signoff on the revised synonym package.',
          ],
        },
        null,
        2
      );
    },
  };

  return [lookupOperationalPulse, lookupDealDeskGuidance, lookupDeliveryPlan];
}

function createAgent(env: DemoEnv): Agent<DemoContext, string> {
  return {
    name: 'RealCompactionMultiTurnDemoAgent',
    tools: createRenewalTools(),
    instructions: () =>
      [
        'You are preparing an executive renewal-risk brief for an enterprise account team.',
        'Maintain continuity across turns and update the working brief as new facts arrive.',
        'When the user asks for fresh operational, commercial, or delivery detail, call the relevant tool before answering.',
        'If the user explicitly names a tool, use that tool instead of guessing.',
        'Before the final turn, respond in 3 short bullets covering signal, risk, and what is still missing.',
        'Only when the user explicitly asks for the final executive-ready renewal brief, output exactly 3 markdown bullets titled "Current state", "Top risks", and "Recommended next step".',
        'Keep the writing concrete and commercially grounded. Preserve names, metrics, timing, discounts, commitments, milestone dates, and ownership details.',
        'Use tool outputs as source-of-truth details and fold them naturally into the brief.',
        'Do not mention compaction, summarization, token limits, or transcript management.',
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
      rules:
        'Preserve the account name, renewal timing, ARR, stakeholder names, tool-derived operational metrics, legal and pricing guardrails, committed owners, milestone-based credits, and the final requested output shape. Drop repeated phrasing and duplicate recap text.',
    },
  };
}

function createProvider(label: string, env: DemoEnv): ModelProvider<DemoContext> {
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
        tools: buildOpenAITools(agent.tools),
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

function buildOpenAITools(
  tools: readonly Tool<any, DemoContext>[] | undefined
): OpenAI.Chat.Completions.ChatCompletionCreateParams['tools'] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.schema.name,
      description: tool.schema.description,
      parameters: zodSchemaToJsonSchema(tool.schema.parameters),
    },
  }));
}

function zodSchemaToJsonSchema(zodSchema: any): any {
  if (zodSchema._def?.typeName === 'ZodObject') {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(zodSchema._def.shape())) {
      properties[key] = zodSchemaToJsonSchema(value);
      if (!(value as any).isOptional?.()) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };
  }

  if (zodSchema._def?.typeName === 'ZodString') {
    return { type: 'string' };
  }

  if (zodSchema._def?.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: zodSchema._def.values,
    };
  }

  if (zodSchema._def?.typeName === 'ZodOptional') {
    return zodSchemaToJsonSchema(zodSchema._def.innerType);
  }

  return { type: 'string', description: 'Unsupported schema type' };
}

function convertMessageToChatParam(
  message: Message
): OpenAI.Chat.Completions.ChatCompletionMessageParam {
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
          'Kickoff note: keep a running renewal-risk brief for Northstar Retail, preserve names and metrics, and keep separate what is operational noise versus structural risk.',
      },
      {
        role: 'assistant',
        content:
          'Understood. I will carry a concise working brief across turns, preserve concrete account details, and tighten the narrative as new facts arrive.',
      },
    ],
    currentAgentName: agent.name,
    context: {
      accountName: 'Northstar Retail',
      renewalQuarter: 'Q3',
    },
    turnCount: 0,
  };
}

function appendUserMessage(
  state: RunState<DemoContext>,
  content: string
): RunState<DemoContext> {
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        role: 'user',
        content,
      },
    ],
  };
}

function readAssistantOutput(result: RunResult<string>): string {
  if (result.outcome.status === 'completed') {
    return String(result.outcome.output);
  }
  if (result.outcome.status === 'error') {
    throw new Error(JSON.stringify(result.outcome.error));
  }
  throw new Error(`Unexpected interrupted outcome: ${JSON.stringify(result.outcome)}`);
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
    return `${index + 1}. assistant tool call -> ${message.tool_calls
      .map((toolCall) => toolCall.function.name)
      .join(', ')}`;
  }
  if (message.role === 'tool') {
    return `${index + 1}. tool -> ${truncate(getTextContent(message.content), 240)}`;
  }
  return `${index + 1}. ${message.role} -> ${truncate(getTextContent(message.content), 240)}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

async function main() {
  configureSanitization({
    customSanitizer: (key, value) => {
      if (!key.toLowerCase().includes('token')) {
        return undefined;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
      }
      return undefined;
    },
  });

  try {
    const env = loadEnv();
    const agent = createAgent(env);

    console.log(colors.bold(colors.blue('JAF Real LiteLLM Multi-Turn Compaction Demo')));
    console.log(colors.dim(`LiteLLM URL: ${env.baseURL}`));
    console.log(colors.dim(`Main provider/model: ${env.mainModel}`));
    console.log(colors.dim(`Compaction provider/model: ${env.compactionModel}`));
    console.log(colors.dim(`Configured max input tokens: ${env.maxInputTokens}`));
    console.log(colors.dim(`Configured max output tokens: ${env.maxOutputTokens}`));
    console.log(colors.dim(`Compaction trigger percentage: ${env.triggerPercentage}`));
    console.log(
      colors.dim(
        'Target flow: 7 turns with explicit operational, commercial, and delivery tool calls; compaction should trigger at least once before the run finishes.\n'
      )
    );

    let activeScriptedTurn = 0;
    let compactionCount = 0;

    function onEvent(event: TraceEvent) {
      switch (event.type) {
        case 'llm_call_start':
          console.log(
            colors.blue(
              `JAF turn call starting for ${event.data.agentName} with ${event.data.messages?.length ?? 0} transcript messages`
            )
          );
          break;
        case 'tool_requests':
          console.log(
            colors.cyan(
              `Tool requested: ${event.data.toolCalls
                .map((toolCall) => `${toolCall.name}(${JSON.stringify(toolCall.args)})`)
                .join(', ')}`
            )
          );
          break;
        case 'tool_call_end':
          console.log(colors.cyan(`Tool completed: ${event.data.toolName}`));
          break;
        case 'compaction_start':
          compactionCount += 1;
          console.log(
            colors.magenta(
              `Compaction started before scripted turn ${activeScriptedTurn + 1}: input=${event.data.currentInputTokens}, threshold=${event.data.thresholdTokens}, compactable=${event.data.compactableMessageCount}, preserved=${event.data.preservedMessageCount}`
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

    const mainProvider = createProvider('Main turn model', env);
    const compactionProvider = createProvider('Compaction model', env);

    const config: RunConfig<DemoContext> = {
      agentRegistry: new Map([[agent.name, agent]]),
      modelProvider: mainProvider,
      compaction: {
        modelProvider: compactionProvider,
        modelOverride: env.compactionModel,
      },
      maxTurns: SCRIPTED_TURNS.length * 4,
      onEvent,
    };

    let state = buildInitialState(agent);

    for (const [index, turn] of SCRIPTED_TURNS.entries()) {
      activeScriptedTurn = index;

      console.log('');
      console.log(colors.bold(colors.cyan(`${turn.label} user input`)));
      console.log(turn.user);

      const result = await run<DemoContext, string>(appendUserMessage(state, turn.user), config);
      const assistantText = readAssistantOutput(result);

      console.log('');
      console.log(colors.bold(colors.yellow(`${turn.label} assistant output`)));
      console.log(assistantText);

      state = result.finalState;
    }

    console.log('');
    console.log(colors.bold(colors.yellow('Final transcript after the scripted conversation')));
    state.messages.forEach((message, index) => {
      console.log(renderMessage(message, index));
    });

    console.log('');
    if (compactionCount === 0) {
      console.log(
        colors.red(
          'Compaction did not trigger in this run. This demo is tuned to compact once with the default settings, so lower COMPACTION_TRIGGER_PERCENTAGE or LITELLM_MAX_INPUT_TOKENS only if your model still used materially fewer prompt tokens than expected.'
        )
      );
    } else {
      console.log(colors.bold(colors.green(`Demo completed with ${compactionCount} compaction event(s).`)));
    }
  } finally {
    resetSanitizationConfig();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
