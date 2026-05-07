#!/usr/bin/env tsx

import { randomUUID } from 'crypto';
import { config as loadDotenv } from 'dotenv';
import OpenAI from 'openai';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { agentAsTool } from '../../src/core/agent-as-tool';
import { run } from '../../src/core/engine';
import { configureSanitization, resetSanitizationConfig } from '../../src/core/tracing';
import { getToolRuntime } from '../../src/core/tool-runtime';
import { ToolResponse, type ToolResult } from '../../src/core/tool-results';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

loadDotenv({ path: resolve(__dirname, '.env'), quiet: true });
loadDotenv({ path: resolve(__dirname, '../../.env'), quiet: true });

type FindingCategory = 'operational' | 'commercial' | 'delivery' | 'synthesis';
type TaskStatus = 'pending' | 'in_progress' | 'completed';

type PlanTask = {
  id: string;
  description: string;
  owner: 'parent' | 'operational' | 'commercial' | 'delivery';
  status: TaskStatus;
  result?: string;
};

type FindingRecord = {
  owner: string;
  category: FindingCategory;
  summary: string;
  turn: number;
};

type DelegationRecord = {
  specialist: string;
  query: string;
  turn: number;
};

type DemoContext = {
  userId: string;
  permissions: string[];
  accountName: string;
  renewalQuarter: string;
  planGoal: string;
  plan: PlanTask[];
  currentTaskId?: string;
  workingBrief: string;
  findings: FindingRecord[];
  delegationHistory: DelegationRecord[];
  finalSynthesisRequested: boolean;
  becameAgentic: boolean;
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
  minCandidateMessages: number;
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
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
};

const LITELLM_REQUEST_HEADERS = {
  'x-litellm-disable-logging': 'true',
};

const MIN_DEMO_INPUT_TOKENS = 9000;
const MIN_DEMO_OUTPUT_TOKENS = 900;
const DEFAULT_COMPACTION_TRIGGER_PERCENTAGE = 0.72;
const DEFAULT_COMPACTION_MIN_CANDIDATE_MESSAGES = 8;

const SCRIPTED_TURNS: readonly ScriptedTurn[] = [
  {
    label: 'Turn 1',
    user:
      'We need a board-safe renewal brief for Northstar Retail, a search customer on a June Q3 renewal worth roughly $2.4M ARR. Do not answer fully yet. Create a plan first, keep a running working brief, and treat this like a message-agents orchestration run rather than a one-shot answer.',
  },
  {
    label: 'Turn 2',
    user:
      'New signal from support and product: search latency spiked during the last two campaign weekends, merchandising disabled a synonym package, and store managers are manually curating landing pages because they do not trust ranking behavior. Investigate the operational story through the operational specialist, then update the plan.',
  },
  {
    label: 'Turn 3',
    user:
      'Stakeholder posture changed. Their original sponsor left, the interim sponsor Arun Bedi is skeptical, and procurement joined early because Northstar wants software spend roughly flat unless we can prove margin or conversion lift. Pull the commercial story through the commercial specialist instead of guessing.',
  },
  {
    label: 'Turn 4',
    user:
      'One more complication: a competitor is offering an 18 percent discount and migration support before holiday planning. We need a realistic 30-day path-to-green with named owners and no fake headcount promises. Use the delivery specialist and then rewrite the plan based on everything you know so far.',
  },
  {
    label: 'Turn 5',
    user:
      'Board-pack timing moved up to Wednesday morning. Tighten the working brief so it is explicit about current state, top risks, and what changes in the next 30 days versus the next quarter. Keep this as a progress update, not the final answer.',
  },
  {
    label: 'Turn 6',
    user:
      'Our internal negotiation line is that we can probably hold the discount to 6 percent if we get a two-year term, milestone-linked credits, and weekly relevance reviews. Refresh the commercial and delivery implications in the plan, then tell me if you are ready for final synthesis.',
  },
  {
    label: 'Turn 7',
    user:
      'Produce the final board-ready renewal brief now. Use the synthesis step and output exactly three markdown bullets titled Current state, Top risks, and Recommended next step.',
  },
];

function loadEnv(): DemoEnv {
  const baseURL = process.env.LITELLM_URL;
  const apiKey = process.env.LITELLM_API_KEY;
  const mainProvider = process.env.LITELLM_PROVIDER;
  const mainModel = process.env.LITELLM_MODEL;

  if (!baseURL || !apiKey || !mainModel) {
    console.log(colors.red('Missing LiteLLM configuration for the message-agents demo.'));
    console.log(colors.yellow('Set LITELLM_URL, LITELLM_API_KEY, and LITELLM_MODEL.'));
    console.log(
      colors.dim(
        'Copy examples/message-agents-real-llm-demo/.env.example to .env and fill it in.'
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
    maxInputTokens: parsePositiveInt(
      process.env.LITELLM_MAX_INPUT_TOKENS,
      MIN_DEMO_INPUT_TOKENS,
      MIN_DEMO_INPUT_TOKENS
    ),
    maxOutputTokens: parsePositiveInt(
      process.env.LITELLM_MAX_OUTPUT_TOKENS,
      MIN_DEMO_OUTPUT_TOKENS,
      MIN_DEMO_OUTPUT_TOKENS
    ),
    triggerPercentage: parseTriggerPercentage(
      process.env.COMPACTION_TRIGGER_PERCENTAGE,
      DEFAULT_COMPACTION_TRIGGER_PERCENTAGE
    ),
    minCandidateMessages: parsePositiveInt(
      process.env.COMPACTION_MIN_CANDIDATE_MESSAGES,
      DEFAULT_COMPACTION_MIN_CANDIDATE_MESSAGES,
      2
    ),
  };
}

function normalizeLiteLLMBaseURL(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function resolveLiteLLMModel(provider: string | undefined, model: string): string {
  if (!provider || provider.trim().length === 0 || model.includes('/')) {
    return model;
  }
  return `${provider}/${model}`;
}

function parsePositiveInt(value: string | undefined, fallback: number, minimum = 1): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(parsed, minimum);
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

function mutableContext(context: Readonly<DemoContext>): DemoContext {
  return context as DemoContext;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isNoisyFindingText(text: string): boolean {
  const normalized = normalizeWhitespace(text).toLowerCase();
  const noisyFragments = [
    'the user wants me to',
    'return only visible assistant output',
    'tool calls:',
    'ongoing thinking',
    '</thinking>',
    'wait, let me',
    'let me analyze',
    'i need to synthesize',
    'actually, looking',
    'this implies i should',
    '[jaf compaction summary]',
    'sequence: [ongoing thinking]',
  ];
  return noisyFragments.some((fragment) => normalized.includes(fragment));
}

function sanitizeFindingSummary(text: string): string | null {
  const compact = normalizeWhitespace(text);
  if (!compact) {
    return null;
  }
  if (isNoisyFindingText(compact)) {
    return null;
  }
  return compact;
}

function buildWorkingBrief(context: DemoContext): string {
  const recentFindings = context.findings.slice(-6);
  const planSummary =
    context.plan.length === 0
      ? 'Plan not created yet.'
      : context.plan
          .map((task) => `${task.id}:${task.status}:${task.description}${task.result ? ` => ${task.result}` : ''}`)
          .join(' | ');
  const findingsSummary =
    recentFindings.length === 0
      ? 'No validated findings yet.'
      : recentFindings
          .map((finding, index) => `${index + 1}. [${finding.category}] ${finding.summary}`)
          .join('\n');

  return [`Account: ${context.accountName} (${context.renewalQuarter} renewal).`, `Plan: ${planSummary}`, `Recent findings:\n${findingsSummary}`].join('\n');
}

function recordFinding(context: DemoContext, finding: FindingRecord) {
  context.findings.push(finding);
  context.workingBrief = buildWorkingBrief(context);
}

function upsertPlan(context: DemoContext, goal: string, subTasks: PlanTask[]) {
  context.planGoal = goal;
  context.plan = subTasks;
  context.currentTaskId =
    subTasks.find((task) => task.status === 'in_progress')?.id ||
    subTasks.find((task) => task.status === 'pending')?.id;
  context.becameAgentic = true;
  context.workingBrief = buildWorkingBrief(context);
}

function lookupOperationalSnapshot(focus: 'latency_regression' | 'support_burden' | 'usage_confidence') {
  if (focus === 'latency_regression') {
    return {
      asOf: '2026-03-09',
      latencyP95: '1.08s',
      previousBaseline: '320ms',
      zeroResultRate: '3.6%',
      degradedCampaignWeekends: 2,
      categoryConversionDelta: '-2.9%',
      owner: 'Rina Patel',
      watchout: 'Holiday category campaigns are now exposed to ranking regressions.',
    };
  }

  if (focus === 'support_burden') {
    return {
      asOf: '2026-03-09',
      supportTicketsLast14Days: 14,
      storeManagerBehavior: 'manually curating promo landing pages',
      merchandisingBehavior: 'synonym package disabled after irrelevant apparel matches',
      owner: 'Gabe Kim',
      watchout: 'Support burden is converting a search issue into an operator trust issue.',
    };
  }

  return {
    asOf: '2026-03-09',
    mobileSearchStatus: 'paused pending reliability recovery',
    kioskPilotStatus: 'design approved but launch blocked on relevance confidence',
    executiveConcern: 'Northstar cannot tell whether this is temporary execution noise or structural product risk',
    owner: 'Lena Ortiz',
  };
}

function lookupCommercialPosition(focus: 'procurement_pressure' | 'concession_guardrails' | 'stakeholder_posture') {
  if (focus === 'procurement_pressure') {
    return {
      asOf: '2026-03-09',
      competitorOffer: '18% discount plus migration support',
      procurementPosture: 'entered early and wants spend held roughly flat',
      boardConstraint: 'vendors must show direct margin or conversion lift',
      watchout: 'Margin protection depends on a confidence-building recovery narrative.',
    };
  }

  if (focus === 'concession_guardrails') {
    return {
      asOf: '2026-03-09',
      approvedDiscountCeiling: '6%',
      acceptablePackaging: 'two-year term, phased rollout, milestone-linked credits',
      disallowedMoves: ['open-ended credits', 'unbounded custom headcount promises'],
      legalClause: 'updated data-locality addendum available for two new regions',
    };
  }

  return {
    asOf: '2026-03-09',
    outgoingSponsor: 'Megan Cole',
    interimSponsor: 'Arun Bedi',
    financeContact: 'Priyanka Rao',
    commercialRead: 'Operator story must work for a skeptical sponsor and a finance audience at the same time.',
  };
}

function lookupDeliveryCommitments(focus: 'owner_map' | 'thirty_day_plan' | 'holiday_readiness') {
  if (focus === 'owner_map') {
    return {
      asOf: '2026-03-09',
      relevanceLead: 'Rina Patel',
      solutionsArchitect: 'Gabe Kim',
      accountExecutive: 'Maya Thompson',
      staffingConstraint: 'named engineer plus named solutions architect for six weeks; no new headcount',
    };
  }

  if (focus === 'thirty_day_plan') {
    return {
      asOf: '2026-03-09',
      milestones: [
        'Week 1: ship synonym rollback guardrail and validate high-volume seasonal queries.',
        'Week 2: publish shared scorecard for latency, zero-result rate, and conversion trend.',
        'Week 3: hold weekly relevance review with Arun and merchandising leads.',
        'Week 4: deliver path-to-green update before holiday build planning.',
      ],
      dependency: 'Northstar must sign off on revised synonym package before full rollout.',
    };
  }

  return {
    asOf: '2026-03-09',
    preHolidayConditions: [
      'Latency below 450ms p95.',
      'Two consecutive green scorecard reviews.',
      'Rollback guardrail active for synonym changes.',
    ],
    nextQuarterTarget: 'resume mobile and kiosk rollout only after reliability stays green.',
  };
}

function createLookupTools(): {
  operationalSnapshot: Tool<{ focus: 'latency_regression' | 'support_burden' | 'usage_confidence' }, DemoContext>;
  commercialPosition: Tool<{ focus: 'procurement_pressure' | 'concession_guardrails' | 'stakeholder_posture' }, DemoContext>;
  deliveryCommitments: Tool<{ focus: 'owner_map' | 'thirty_day_plan' | 'holiday_readiness' }, DemoContext>;
} {
  return {
    operationalSnapshot: {
      schema: {
        name: 'lookup_support_signal',
        description: 'Retrieve current operational reliability, support, and usage-confidence signals.',
        parameters: z.object({
          focus: z.enum(['latency_regression', 'support_burden', 'usage_confidence']),
        }),
      },
      async execute(args) {
        return ToolResponse.success(lookupOperationalSnapshot(args.focus));
      },
    },
    commercialPosition: {
      schema: {
        name: 'lookup_renewal_constraints',
        description: 'Retrieve current stakeholder, procurement, discount, and legal renewal constraints.',
        parameters: z.object({
          focus: z.enum(['procurement_pressure', 'concession_guardrails', 'stakeholder_posture']),
        }),
      },
      async execute(args) {
        return ToolResponse.success(lookupCommercialPosition(args.focus));
      },
    },
    deliveryCommitments: {
      schema: {
        name: 'lookup_account_timeline',
        description: 'Retrieve current delivery owners, 30-day milestones, and holiday readiness commitments.',
        parameters: z.object({
          focus: z.enum(['owner_map', 'thirty_day_plan', 'holiday_readiness']),
        }),
      },
      async execute(args) {
        return ToolResponse.success(lookupDeliveryCommitments(args.focus));
      },
    },
  };
}

function createFinalSynthesisTool(env: DemoEnv): Tool<{ emphasis?: string }, DemoContext> {
  return {
    schema: {
      name: 'synthesize_final_brief',
      description:
        'Generate the final board-ready brief from the running plan, delegated findings, and accumulated conversation context.',
      parameters: z.object({
        emphasis: z.string().optional(),
      }),
    },
    async execute(args, context): Promise<string | ToolResult> {
      const mutable = mutableContext(context);
      if (!mutable.becameAgentic) {
        return ToolResponse.validationError('Final synthesis is only valid after the run becomes agentic.');
      }

      const runtime = getToolRuntime(context);
      if (!runtime) {
        return ToolResponse.error('EXECUTION_FAILED', 'Runtime unavailable for final synthesis.');
      }

      mutable.finalSynthesisRequested = true;

      const finalAgent: Agent<DemoContext, string> = {
        name: 'FinalBriefSynthesizer',
        instructions: () =>
          [
            'You are the final synthesis stage for a message-agents style orchestration flow.',
            'Use the supplied working brief, plan state, delegated findings, and recent transcript to write the final answer.',
            'Output exactly three markdown bullets:',
            '- **Current state** ...',
            '- **Top risks** ...',
            '- **Recommended next step** ...',
            'Keep it executive-ready, concrete, and commercially grounded.',
            'Do not mention compaction, orchestration, delegation, or hidden process.',
          ].join('\n'),
        modelConfig: {
          name: env.mainModel,
          temperature: 0,
          maxTokens: env.maxOutputTokens,
        },
      };

      const transcriptTail = runtime.state.messages
        .filter((message) => {
          const content = getTextContent(message.content);
          if (message.role !== 'user' && isNoisyFindingText(content)) {
            return false;
          }
          return content.trim().length > 0;
        })
        .slice(-8)
        .map((message) => `${message.role.toUpperCase()}: ${truncate(getTextContent(message.content), 220)}`)
        .join('\n');
      const findingsBlock = mutable.findings
        .map((finding, index) => `${index + 1}. [${finding.category}] ${finding.summary}`)
        .join('\n');
      const planBlock = mutable.plan
        .map((task) => `${task.id} | ${task.status} | ${task.description}${task.result ? ` | ${task.result}` : ''}`)
        .join('\n');

      const synthesisState: RunState<DemoContext> = {
        runId: createRunId(randomUUID()),
        traceId: runtime.state.traceId,
        currentAgentName: finalAgent.name,
        context: runtime.state.context,
        turnCount: runtime.state.turnCount,
        messages: [
          {
            role: 'user',
            content: [
              `Account: ${mutable.accountName}`,
              `Renewal quarter: ${mutable.renewalQuarter}`,
              `Working brief:\n${mutable.workingBrief}`,
              `Plan state:\n${planBlock}`,
              `Delegated findings:\n${findingsBlock}`,
              `Recent transcript:\n${transcriptTail}`,
              args.emphasis ? `Emphasis:\n${args.emphasis}` : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
      };

      const response = await runtime.config.modelProvider.getCompletion(
        synthesisState,
        finalAgent,
        runtime.config
      );
      const text = response.message?.content?.trim();
      if (!text) {
        return ToolResponse.error('EXECUTION_FAILED', 'Final synthesis provider returned no visible text.');
      }

      return ToolResponse.success(text, { phase: 'final_synthesis' });
    },
  };
}

function createPlanTool(): Tool<{ goal: string; subTasks: PlanTask[] }, DemoContext> {
  return {
    schema: {
      name: 'update_plan',
      description: 'Create or revise the sequential execution plan for the orchestrator.',
      parameters: z.object({
        goal: z.string(),
        subTasks: z.array(
          z.object({
            id: z.string(),
            description: z.string(),
            owner: z.enum(['parent', 'operational', 'commercial', 'delivery']),
            status: z.enum(['pending', 'in_progress', 'completed']),
            result: z.string().optional(),
          })
        ),
      }),
    },
    async execute(args, context) {
      const mutable = mutableContext(context);
      upsertPlan(mutable, args.goal, args.subTasks);
      return ToolResponse.success({
        goal: args.goal,
        currentTaskId: mutable.currentTaskId,
        plan: mutable.plan,
      });
    },
  };
}

function createSpecialistAgents(
  env: DemoEnv,
  lookupTools: ReturnType<typeof createLookupTools>
): {
  operationalAnalyst: Agent<DemoContext, string>;
  commercialAnalyst: Agent<DemoContext, string>;
  deliveryStrategist: Agent<DemoContext, string>;
} {
  return {
    operationalAnalyst: {
      name: 'OperationalAnalyst',
      instructions: () =>
        [
          'You are the operational specialist in a message-agents flow.',
          'Always call lookup_support_signal before answering.',
          'Return exactly three short markdown bullets:',
          '- **Signal** ...',
          '- **Risk** ...',
          '- **What to tell leadership** ...',
          'Preserve concrete metrics, owners, and operational consequences.',
        ].join('\n'),
      tools: [lookupTools.operationalSnapshot],
      modelConfig: {
        name: env.mainModel,
        temperature: 0,
        maxTokens: 220,
      },
    },
    commercialAnalyst: {
      name: 'CommercialAnalyst',
      instructions: () =>
        [
          'You are the commercial specialist in a message-agents flow.',
          'Always call lookup_renewal_constraints before answering.',
          'Return exactly three short markdown bullets:',
          '- **Stakeholder posture** ...',
          '- **Commercial risk** ...',
          '- **Negotiation implication** ...',
          'Preserve discounts, constraints, and stakeholder names.',
        ].join('\n'),
      tools: [lookupTools.commercialPosition],
      modelConfig: {
        name: env.mainModel,
        temperature: 0,
        maxTokens: 220,
      },
    },
    deliveryStrategist: {
      name: 'DeliveryStrategist',
      instructions: () =>
        [
          'You are the delivery specialist in a message-agents flow.',
          'Always call lookup_account_timeline before answering.',
          'Return exactly three short markdown bullets:',
          '- **Owners** ...',
          '- **30-day path** ...',
          '- **Readiness gate** ...',
          'Preserve dates, dependencies, and constraints against fake headcount.',
        ].join('\n'),
      tools: [lookupTools.deliveryCommitments],
      modelConfig: {
        name: env.mainModel,
        temperature: 0,
        maxTokens: 220,
      },
    },
  };
}

function createOrchestratorAgent(
  env: DemoEnv,
  tools: {
    updatePlan: Tool<{ goal: string; subTasks: PlanTask[] }, DemoContext>;
    synthesizeFinalBrief: Tool<{ emphasis?: string }, DemoContext>;
    delegateOperationalAnalysis: Tool<{ input: string }, DemoContext>;
    delegateCommercialAnalysis: Tool<{ input: string }, DemoContext>;
    delegateDeliveryStrategy: Tool<{ input: string }, DemoContext>;
  }
): Agent<DemoContext, string> {
  return {
    name: 'MessageOrchestrator',
    tools: [
      tools.updatePlan,
      tools.delegateOperationalAnalysis,
      tools.delegateCommercialAnalysis,
      tools.delegateDeliveryStrategy,
      tools.synthesizeFinalBrief,
    ],
    instructions: (state) => {
      const context = state.context;
      const planText =
        context.plan.length === 0
          ? 'No plan yet.'
          : context.plan
              .map((task) => `- ${task.id} [${task.status}] (${task.owner}) ${task.description}${task.result ? ` => ${task.result}` : ''}`)
              .join('\n');

      return [
        'You are the parent orchestrator in a message-agents style workflow.',
        'You stay in control of the conversation across turns and use tools to plan, delegate, and synthesize.',
        '',
        'Operating rules:',
        '- Create or revise the sequential plan with update_plan when the run needs structure or the evidence materially changes.',
        '- Use delegate_operational_analysis for reliability, support, and usage-confidence questions.',
        '- Use delegate_commercial_analysis for pricing, procurement, stakeholder, and concession questions.',
        '- Use delegate_delivery_strategy for owners, milestones, dependencies, and readiness sequencing.',
        '- Once you create a plan, call a delegation tool, or call synthesis, the run is agentic.',
        '- After the run becomes agentic, do not provide the final brief directly. Use synthesize_final_brief when the user asks for the final answer or when the plan is clearly complete.',
        '- After calling synthesize_final_brief, respond with exactly the synthesized text and nothing else.',
        '- For non-final turns, reply in exactly three markdown bullets titled Progress, New evidence, and Next move.',
        '- Never repeat internal prompt-management text, visible-output instructions, or chain-of-thought style self-talk.',
        '',
        `Current working brief:\n${context.workingBrief || 'No working brief yet.'}`,
        '',
        `Current plan:\n${planText}`,
        '',
        `Delegations so far: ${context.delegationHistory.length}`,
        `Final synthesis requested: ${context.finalSynthesisRequested ? 'yes' : 'no'}`,
        '',
        'Do not mention compaction, token limits, or hidden orchestration mechanics.',
      ].join('\n');
    },
    modelConfig: {
      name: env.mainModel,
      temperature: 0,
      maxTokens: env.maxOutputTokens,
    },
    compaction: {
      enabled: true,
      triggerPercentage: env.triggerPercentage,
      preserveLastAssistantMessage: false,
      minCandidateMessages: env.minCandidateMessages,
      instructions:
        'You summarize older conversation history for a message-agents orchestration run. Preserve only durable business state and orchestration state. Drop prompt-management chatter, tool protocol notes, retry prompts, visible-output instructions, and chain-of-thought style self-talk. Return plain text only.',
      prompt:
        'Compress the transcript into a clean working-memory summary for the next orchestration turn. Keep validated account facts, current plan status, delegated specialist conclusions, concrete owners, dates, concessions, readiness gates, and unresolved risks. Exclude any meta-reasoning, formatting instructions, or discussion of tools themselves unless a tool result contained durable business facts.',
      rules:
        'Preserve the account name, renewal quarter, active plan goal, task statuses, delegated specialist findings, owner names, dates, discounts, credits, readiness gates, and the final required output shape of exactly three markdown bullets titled Current state, Top risks, and Recommended next step. Never preserve text about visible assistant output, thinking tags, retry instructions, or whether a tool should be called.',
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
        max_tokens: agent.modelConfig?.maxTokens ?? env.maxOutputTokens,
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
      let result = buildProviderResult(response);
      logProviderResponse(`${label} response #${callCount}`, result);

      if (shouldRetryForVisibleOutput(result)) {
        const retryParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
          ...params,
          messages: [
            ...params.messages,
            {
              role: 'user',
              content:
                'Return only visible assistant output for the current task. If you already called the final synthesis tool, respond with exactly the synthesized final brief and nothing else.',
            },
          ],
          tool_choice: params.tools ? 'auto' : undefined,
        };

        logProviderRequest(`${label} retry request #${callCount}`, state, agent, retryParams);
        const retryResponse = await client.chat.completions.create(
          retryParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
        );
        result = buildProviderResult(retryResponse);
        logProviderResponse(`${label} retry response #${callCount}`, result);
      }

      return result as any;
    },
  };
}

function buildProviderResult(response: OpenAI.Chat.Completions.ChatCompletion) {
  const choice = response.choices[0];
  return {
    ...choice,
    usage: response.usage,
    model: response.model,
    id: response.id,
  };
}

function hasVisibleAssistantOutput(result: any): boolean {
  const message = result?.message;
  if (!message) {
    return false;
  }
  if (typeof message.content === 'string' && message.content.trim().length > 0) {
    return true;
  }
  return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

function shouldRetryForVisibleOutput(result: any): boolean {
  if (!hasVisibleAssistantOutput(result)) {
    return true;
  }
  return result?.finish_reason === 'length';
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

  if (zodSchema._def?.typeName === 'ZodArray') {
    return {
      type: 'array',
      items: zodSchemaToJsonSchema(zodSchema._def.type),
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
      return { role: 'user', content: getTextContent(message.content) };
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
          'Kickoff note: this conversation should feel like a message-agents orchestration run with planning, specialist delegation, and a final synthesis step.',
      },
      {
        role: 'assistant',
        content:
          'Understood. I will maintain a sequential plan, gather specialist-backed evidence, keep a working brief, and hold the final board-ready answer for the synthesis step.',
      },
    ],
    currentAgentName: agent.name,
    context: {
      userId: 'demo-user',
      permissions: ['user'],
      accountName: 'Northstar Retail',
      renewalQuarter: 'Q3',
      planGoal: '',
      plan: [],
      workingBrief: 'No validated evidence yet.',
      findings: [],
      delegationHistory: [],
      finalSynthesisRequested: false,
      becameAgentic: false,
    },
    turnCount: 0,
  };
}

function appendUserMessage(state: RunState<DemoContext>, content: string): RunState<DemoContext> {
  return {
    ...state,
    messages: [...state.messages, { role: 'user', content }],
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

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function renderMessage(message: Message, index: number): string {
  if (message.tool_calls && message.tool_calls.length > 0) {
    return `${index + 1}. assistant tool call -> ${message.tool_calls
      .map((toolCall) => toolCall.function.name)
      .join(', ')}`;
  }
  if (message.role === 'tool') {
    return `${index + 1}. tool -> ${truncate(getTextContent(message.content), 220)}`;
  }
  return `${index + 1}. ${message.role} -> ${truncate(getTextContent(message.content), 220)}`;
}

function summarizeToolResult(result: string | ToolResult): string {
  if (typeof result === 'string') {
    return truncate(result, 220);
  }
  if (result.status === 'success') {
    const data = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
    return truncate(data, 220);
  }
  return truncate(result.error?.message || 'Tool failed', 220);
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
    const lookupTools = createLookupTools();
    const specialistAgents = createSpecialistAgents(env, lookupTools);
    const updatePlan = createPlanTool();
    const synthesizeFinalBrief = createFinalSynthesisTool(env);

    const delegateOperationalAnalysis = agentAsTool<DemoContext, string>(
      specialistAgents.operationalAnalyst,
      {
        toolName: 'delegate_operational_analysis',
        toolDescription: 'Delegate a focused operational investigation to the operational specialist.',
        maxTurns: 5,
        propagateEvents: 'all',
      }
    );
    const delegateCommercialAnalysis = agentAsTool<DemoContext, string>(
      specialistAgents.commercialAnalyst,
      {
        toolName: 'delegate_commercial_analysis',
        toolDescription: 'Delegate a focused commercial investigation to the commercial specialist.',
        maxTurns: 5,
        propagateEvents: 'all',
      }
    );
    const delegateDeliveryStrategy = agentAsTool<DemoContext, string>(
      specialistAgents.deliveryStrategist,
      {
        toolName: 'delegate_delivery_strategy',
        toolDescription: 'Delegate a focused delivery and readiness investigation to the delivery specialist.',
        maxTurns: 5,
        propagateEvents: 'all',
      }
    );

    const orchestrator = createOrchestratorAgent(env, {
      updatePlan,
      synthesizeFinalBrief,
      delegateOperationalAnalysis,
      delegateCommercialAnalysis,
      delegateDeliveryStrategy,
    });

    console.log(colors.bold(colors.blue('JAF Real LiteLLM Message-Agents Demo')));
    console.log(colors.dim(`LiteLLM URL: ${env.baseURL}`));
    console.log(colors.dim(`Main provider/model: ${env.mainModel}`));
    console.log(colors.dim(`Compaction provider/model: ${env.compactionModel}`));
    console.log(colors.dim(`Configured max input tokens: ${env.maxInputTokens}`));
    console.log(colors.dim(`Configured max output tokens: ${env.maxOutputTokens}`));
    console.log(colors.dim(`Compaction trigger percentage: ${env.triggerPercentage}`));
    console.log(colors.dim(`Compaction min candidate messages: ${env.minCandidateMessages}`));
    console.log(
      colors.dim(
        'Target flow: plan -> operational delegation -> commercial delegation -> delivery delegation -> final synthesis, with compaction expected once the transcript grows.\n'
      )
    );

    let activeScriptedTurn = 0;
    let compactionCount = 0;

    const mainProvider = createProvider('Main turn model', env);
    const compactionProvider = createProvider('Compaction model', env);

    const config: RunConfig<DemoContext> = {
      agentRegistry: new Map([[orchestrator.name, orchestrator]]),
      modelProvider: mainProvider,
      compaction: {
        modelProvider: compactionProvider,
        modelOverride: env.compactionModel,
      },
      maxTurns: SCRIPTED_TURNS.length * 5,
      onEvent(event: TraceEvent) {
        switch (event.type) {
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
          case 'final_output':
            console.log(colors.green(`Final output emitted: ${String(event.data.output)}`));
            break;
        }
      },
      async onAfterToolExecution(toolName, result, toolContext) {
        const context = mutableContext(toolContext.state.context);
        const currentTurn = toolContext.state.turnCount + 1;

        if (toolName === 'update_plan') {
          recordFinding(context, {
            owner: 'MessageOrchestrator',
            category: 'delivery',
            summary: `Plan updated: ${context.currentTaskId || 'no active task'} is now active.`,
            turn: currentTurn,
          });
          return result;
        }

        if (toolName === 'delegate_operational_analysis') {
          context.becameAgentic = true;
          context.delegationHistory.push({
            specialist: 'OperationalAnalyst',
            query: String(toolContext.args?.input || ''),
            turn: currentTurn,
          });
          const summary = sanitizeFindingSummary(summarizeToolResult(result));
          if (summary) {
            recordFinding(context, {
              owner: 'OperationalAnalyst',
              category: 'operational',
              summary,
              turn: currentTurn,
            });
          }
          return result;
        }

        if (toolName === 'delegate_commercial_analysis') {
          context.becameAgentic = true;
          context.delegationHistory.push({
            specialist: 'CommercialAnalyst',
            query: String(toolContext.args?.input || ''),
            turn: currentTurn,
          });
          const summary = sanitizeFindingSummary(summarizeToolResult(result));
          if (summary) {
            recordFinding(context, {
              owner: 'CommercialAnalyst',
              category: 'commercial',
              summary,
              turn: currentTurn,
            });
          }
          return result;
        }

        if (toolName === 'delegate_delivery_strategy') {
          context.becameAgentic = true;
          context.delegationHistory.push({
            specialist: 'DeliveryStrategist',
            query: String(toolContext.args?.input || ''),
            turn: currentTurn,
          });
          const summary = sanitizeFindingSummary(summarizeToolResult(result));
          if (summary) {
            recordFinding(context, {
              owner: 'DeliveryStrategist',
              category: 'delivery',
              summary,
              turn: currentTurn,
            });
          }
          return result;
        }

        if (toolName === 'synthesize_final_brief') {
          context.finalSynthesisRequested = true;
          return result;
        }

        return result;
      },
    };

    let state = buildInitialState(orchestrator);

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
      console.log(colors.dim(`Working brief after ${turn.label}:`));
      console.log(result.finalState.context.workingBrief);

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
          'Compaction did not trigger in this run. Lower COMPACTION_TRIGGER_PERCENTAGE or LITELLM_MAX_INPUT_TOKENS if your model still used materially fewer prompt tokens than expected.'
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
