import 'dotenv/config';
import { randomUUID } from 'crypto';
import {
  run,
  createRunId,
  createTraceId,
  type RunConfig,
  type Agent,
  makeLiteLLMProvider,
} from '@xynehq/jaf';
import { mathTool } from '@xynehq/jaf/tools';

type Ctx = Record<string, never>;

async function runOnce(prompt: string) {
  const agent: Agent<Ctx, string> = {
    name: 'MathAgent',
    instructions: () => 'You can call the math tool to compute results, then summarize them for the user.',
    tools: [mathTool],
    modelConfig: { name: process.env.LITELLM_MODEL || 'gemini-2.5-pro' },
  };

  const config: RunConfig<Ctx> = {
    agentRegistry: new Map([[agent.name, agent]]),
    modelProvider: makeLiteLLMProvider(process.env.LITELLM_URL || "http://localhost:4000", process.env.LITELLM_API_KEY),
    maxTurns: 6,
  };

  const state = {
    runId: createRunId(randomUUID()),
    traceId: createTraceId(randomUUID()),
    messages: [{ role: 'user' as const, content: prompt }],
    currentAgentName: agent.name,
    context: {} as Ctx,
    turnCount: 0,
  };

  const result = await run<Ctx, string>(state, config);
  console.log(`\n--- Engine run for: ${prompt}`);
  console.log(result);
}

async function main() {
  await runOnce('Please compute 12 / 4.');
  await runOnce('Round pi to 2 decimals.');
}

main()
