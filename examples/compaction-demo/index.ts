#!/usr/bin/env tsx

import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  getTextContent,
  type Agent,
  createRunId,
  createTraceId,
  type Message,
  type ModelProvider,
  type RunConfig,
  type RunState,
  type TraceEvent,
} from '../../src/core/types';
import { run } from '../../src/core/engine';

type DemoContext = {
  customerId: string;
};

const colors = {
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  magenta: (text: string) => `\x1b[35m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
};

const escalationNotesTool = {
  schema: {
    name: 'retrieveEscalationNotes',
    description: 'Fetch the latest escalation notes for an enterprise customer.',
    parameters: z.object({
      customerId: z.string(),
    }),
  },
  async execute({ customerId }: { customerId: string }) {
    return JSON.stringify({
      customerId,
      owner: 'Priya',
      etaHours: 24,
      notes: [
        'Finance confirmed duplicate invoice 4821 has been reversed.',
        'Support must send a concise RCA update instead of another long recap.',
        'Customer success wants one named owner and one follow-up within 24 hours.',
      ],
    });
  },
};

const agent: Agent<DemoContext, string> = {
  name: 'CompactionDemoAgent',
  instructions: (state) =>
    `You are an escalation response agent. This is turn ${state.turnCount + 1}. ` +
    'Keep the response concise, preserve concrete commitments, and mention the single owner for next steps.',
  tools: [escalationNotesTool],
  modelConfig: { name: 'demo-main-model' },
  compaction: {
    enabled: true,
    triggerPercentage: 0.39,
    preserveLastAssistantMessage: true,
    minCandidateMessages: 2,
    rules: 'Keep the original issue, any promised commitments, the named owner, and the next action. Drop repetitive narrative.',
  },
};

function createMainModelProvider(): ModelProvider<DemoContext> {
  let callCount = 0;

  return {
    getTokenLimits() {
      return {
        maxInputTokens: 700,
        maxOutputTokens: 200,
      };
    },
    async getCompletion(state, requestAgent) {
      callCount += 1;
      logProviderRequest(`Main model request #${callCount}`, state, requestAgent);

      const lastMessage = state.messages[state.messages.length - 1];
      let response: any;

      if (lastMessage?.role === 'tool') {
        response = {
          message: {
            content:
              'I checked the escalation notes. Finance already reversed invoice 4821, Priya owns the customer follow-up, and we should send a short RCA update with a 24-hour next-step commitment.',
          },
          usage: {
            completion_tokens: 24,
          },
        } as any;
      } else {
        response = {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'notes_call_1',
                type: 'function' as const,
                function: {
                  name: 'retrieveEscalationNotes',
                  arguments: JSON.stringify({ customerId: state.context.customerId }),
                },
              },
            ],
          },
          usage: {
            completion_tokens: 16,
          },
        } as any;
      }

      logProviderResponse(`Main model response #${callCount}`, response);
      return response;
    },
  };
}

function createCompactionProvider(): ModelProvider<DemoContext> {
  let callCount = 0;

  return {
    async getCompletion(state, requestAgent) {
      callCount += 1;
      logProviderRequest(`Compaction model request #${callCount}`, state, requestAgent);

      const response = {
        message: {
          content:
            'Customer escalated duplicate billing and a missed callback. The team promised an audit update and a single owner before the final reply.',
        },
        usage: {
          completion_tokens: 18,
        },
      } as any;

      logProviderResponse(`Compaction model response #${callCount}`, response);
      return response;
    },
  };
}

function buildInitialState(): RunState<DemoContext> {
  return {
    runId: createRunId(randomUUID()),
    traceId: createTraceId(randomUUID()),
    messages: [
      {
        role: 'user',
        content:
          'Account recap: the customer reported duplicate invoices twice this week, asked for a written RCA, and escalated after the promised callback slipped.',
      },
      {
        role: 'assistant',
        content:
          'We confirmed billing is reviewing invoice 4821, apologized for the missed callback, and told the account team to provide one owner and one next update.',
      },
      {
        role: 'user',
        content: 'Before replying, pull the latest escalation notes and then draft the response.',
      },
    ],
    currentAgentName: agent.name,
    context: {
      customerId: 'acme-enterprise',
    },
    turnCount: 0,
  };
}

function onEvent(event: TraceEvent) {
  switch (event.type) {
    case 'llm_call_start':
      console.log(
        colors.blue(
          `LLM call starting for ${event.data.agentName} with ${event.data.messages.length} transcript messages`
        )
      );
      break;
    case 'tool_requests':
      console.log(
        colors.cyan(`Tool requested: ${event.data.toolCalls.map((toolCall) => toolCall.name).join(', ')}`)
      );
      break;
    case 'tool_call_end':
      console.log(colors.cyan(`Tool completed: ${event.data.toolName}`));
      break;
    case 'token_usage':
      console.log(
        colors.dim(
          `Token usage: prompt=${event.data.prompt ?? '-'} completion=${event.data.completion ?? '-'} total=${event.data.total ?? '-'}`
        )
      );
      break;
    case 'compaction_start':
      console.log(
        colors.magenta(
          `Compaction started: input=${event.data.currentInputTokens}, threshold=${event.data.thresholdTokens}, compactable=${event.data.compactableMessageCount}, preserved=${event.data.preservedMessageCount}, overrideProvider=${event.data.usingOverrideProvider}`
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
}

function logProviderRequest(
  title: string,
  state: Readonly<RunState<DemoContext>>,
  requestAgent: Readonly<Agent<DemoContext, any>>
) {
  console.log('');
  console.log(colors.bold(colors.yellow(title)));
  console.log(colors.bold(colors.blue('Agent instructions')));
  console.log(requestAgent.instructions(state));
  console.log(colors.bold(colors.blue('Message array')));
  console.dir(
    state.messages.map((message) => toPrintableMessage(message)),
    { depth: 8, maxArrayLength: null }
  );
}

function logProviderResponse(title: string, response: unknown) {
  console.log(colors.bold(colors.green(title)));
  console.dir(response, { depth: 8, maxArrayLength: null });
}

function renderMessage(message: Message, index: number): string {
  if (message.tool_calls && message.tool_calls.length > 0) {
    const callNames = message.tool_calls.map((toolCall) => toolCall.function.name).join(', ');
    return `${index + 1}. assistant tool call -> ${callNames}`;
  }

  if (message.role === 'tool') {
    return `${index + 1}. tool -> ${truncate(getTextContent(message.content), 140)}`;
  }

  return `${index + 1}. ${message.role} -> ${truncate(getTextContent(message.content), 140)}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function toPrintableMessage(message: Message) {
  return {
    role: message.role,
    content: message.content,
    tool_calls: message.tool_calls,
    tool_call_id: message.tool_call_id,
    attachments: message.attachments,
  };
}

async function main() {
  console.log(colors.bold(colors.blue('JAF Core Compaction Demo')));
  console.log(colors.dim('This example uses deterministic providers. No API keys are required.\n'));

  const config: RunConfig<DemoContext> = {
    agentRegistry: new Map([[agent.name, agent]]),
    modelProvider: createMainModelProvider(),
    compaction: {
      modelProvider: createCompactionProvider(),
      modelOverride: 'demo-compactor',
    },
    maxTurns: 4,
    onEvent,
  };

  const result = await run<DemoContext, string>(buildInitialState(), config);

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
    console.dir(result.outcome, { depth: 6 });
  }

  const compactionSummary = result.finalState.messages.find(
    (message) =>
      message.role === 'assistant' &&
      getTextContent(message.content).startsWith('[JAF COMPACTION SUMMARY]')
  );

  if (compactionSummary) {
    console.log('');
    console.log(colors.bold(colors.yellow('Compaction summary inserted into the transcript')));
    console.log(getTextContent(compactionSummary.content));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
