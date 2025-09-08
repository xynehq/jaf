import { v4 as uuidv4 } from 'uuid';
import { run } from './engine';
import {
  RunConfig,
  RunResult,
  RunState,
  createRunId,
  createTraceId
} from './types';

// Helper to create initial run state for an agent
function createState<Ctx>(
  agentName: string,
  input: string,
  context: Ctx
): RunState<Ctx> {
  return {
    runId: createRunId(uuidv4()),
    traceId: createTraceId(uuidv4()),
    messages: [{ role: 'user', content: input }],
    currentAgentName: agentName,
    context,
    turnCount: 0
  };
}

function outputToString(output: any): string {
  return typeof output === 'string' ? output : JSON.stringify(output);
}

/**
 * Sequential pipeline: A1 -> A2 -> A3
 */
export async function runSequentialPipeline<Ctx>(
  agentNames: readonly string[],
  input: string,
  context: Ctx,
  config: RunConfig<Ctx>
): Promise<RunResult<any>> {
  let currentInput = input;
  let lastResult: RunResult<any> | undefined;

  for (const name of agentNames) {
    const state = createState(name, currentInput, context);
    const result = await run<Ctx, any>(state, config);
    lastResult = result;
    if (result.outcome.status === 'error') {
      return result;
    }
    currentInput = outputToString(result.outcome.output);
  }

  return lastResult!;
}

/**
 * Parallel pipeline: A1 -> (A2, A3) -> A4
 */
export async function runParallelPipeline<Ctx>(
  first: string,
  parallel: readonly [string, string],
  final: string,
  input: string,
  context: Ctx,
  config: RunConfig<Ctx>
): Promise<RunResult<any>> {
  const firstState = createState(first, input, context);
  const firstResult = await run<Ctx, any>(firstState, config);
  if (firstResult.outcome.status === 'error') {
    return firstResult;
  }
  const intermediate = outputToString(firstResult.outcome.output);

  const [name2, name3] = parallel;
  const state2 = createState(name2, intermediate, context);
  const state3 = createState(name3, intermediate, context);
  const [res2, res3] = await Promise.all([
    run<Ctx, any>(state2, config),
    run<Ctx, any>(state3, config)
  ]);
  if (res2.outcome.status === 'error') {
    return res2;
  }
  if (res3.outcome.status === 'error') {
    return res3;
  }
  const combined = `${outputToString(res2.outcome.output)}\n${outputToString(res3.outcome.output)}`;

  const finalState = createState(final, combined, context);
  return await run<Ctx, any>(finalState, config);
}

/**
 * Coordinator pattern: A1 -> A2 (if condition) -> A3 else A4 -> A5
 */
export async function runCoordinatorPipeline<Ctx>(
  agents: { start: string; condition: string; onTrue: string; onFalse: string; end: string },
  condition: (outputFromA2: string) => boolean,
  input: string,
  context: Ctx,
  config: RunConfig<Ctx>
): Promise<RunResult<any>> {
  const startResult = await run<Ctx, any>(createState(agents.start, input, context), config);
  if (startResult.outcome.status === 'error') return startResult;
  const condInput = outputToString(startResult.outcome.output);

  const condResult = await run<Ctx, any>(createState(agents.condition, condInput, context), config);
  if (condResult.outcome.status === 'error') return condResult;
  const branchInput = outputToString(condResult.outcome.output);

  const nextAgent = condition(branchInput) ? agents.onTrue : agents.onFalse;
  const branchResult = await run<Ctx, any>(createState(nextAgent, branchInput, context), config);
  if (branchResult.outcome.status === 'error') return branchResult;
  const finalInput = outputToString(branchResult.outcome.output);

  return await run<Ctx, any>(createState(agents.end, finalInput, context), config);
}

/**
 * Parallel redundant pattern: Query -> A1, A2 -> A3
 */
export async function runParallelRedundant<Ctx>(
  query: string,
  agents: { parallel: [string, string]; evaluator: string },
  context: Ctx,
  config: RunConfig<Ctx>
): Promise<RunResult<any>> {
  const [a1, a2] = agents.parallel;
  const state1 = createState(a1, query, context);
  const state2 = createState(a2, query, context);

  const [res1, res2] = await Promise.all([
    run<Ctx, any>(state1, config),
    run<Ctx, any>(state2, config)
  ]);
  if (res1.outcome.status === 'error') return res1;
  if (res2.outcome.status === 'error') return res2;

  const evaluationInput = `Agent ${a1}: ${outputToString(res1.outcome.output)}\nAgent ${a2}: ${outputToString(res2.outcome.output)}`;
  const evalState = createState(agents.evaluator, evaluationInput, context);
  return await run<Ctx, any>(evalState, config);
}

