import {
  Agent,
  ModelProvider,
  RunConfig,
  RunState,
  runSequentialPipeline,
  runParallelPipeline,
  runCoordinatorPipeline,
  runParallelRedundant
} from '@xynehq/jaf';

type Ctx = {};

const agents: Agent<Ctx, string>[] = [
  { name: 'Step1', instructions: () => 'step1', modelConfig: { name: 'mock' } },
  { name: 'Step2', instructions: () => 'step2', modelConfig: { name: 'mock' } },
  { name: 'Step3', instructions: () => 'step3', modelConfig: { name: 'mock' } },
  { name: 'First', instructions: () => 'first', modelConfig: { name: 'mock' } },
  { name: 'Second', instructions: () => 'second', modelConfig: { name: 'mock' } },
  { name: 'Third', instructions: () => 'third', modelConfig: { name: 'mock' } },
  { name: 'Final', instructions: () => 'final', modelConfig: { name: 'mock' } },
  { name: 'Start', instructions: () => 'start', modelConfig: { name: 'mock' } },
  { name: 'Check', instructions: () => 'check', modelConfig: { name: 'mock' } },
  { name: 'BigAgent', instructions: () => 'big', modelConfig: { name: 'mock' } },
  { name: 'SmallAgent', instructions: () => 'small', modelConfig: { name: 'mock' } },
  { name: 'End', instructions: () => 'end', modelConfig: { name: 'mock' } },
  { name: 'Answer1', instructions: () => 'answer1', modelConfig: { name: 'mock' } },
  { name: 'Answer2', instructions: () => 'answer2', modelConfig: { name: 'mock' } },
  { name: 'Judge', instructions: () => 'judge', modelConfig: { name: 'mock' } }
];

const behaviors: Record<string, (input: string) => string> = {
  Step1: input => `${input} -> step1`,
  Step2: input => `${input} -> step2`,
  Step3: input => `${input} -> step3`,
  First: input => `${input} -> first`,
  Second: input => `${input} -> second`,
  Third: input => `${input} -> third`,
  Final: input => `${input} -> final`,
  Start: input => input,
  Check: input => (parseInt(input, 10) > 5 ? 'big' : 'small'),
  BigAgent: input => `Number ${input} is big`,
  SmallAgent: input => `Number ${input} is small`,
  End: input => `Final result: ${input}`,
  Answer1: () => '42',
  Answer2: () => '41',
  Judge: input => (input.includes('Response from Answer1') ? '42' : '41')
};

const agentRegistry = new Map(agents.map(a => [a.name, a]));

const modelProvider: ModelProvider<Ctx> = {
  async getCompletion(
    state: Readonly<RunState<Ctx>>,
    agent: Readonly<Agent<Ctx, any>>,
    _config: Readonly<RunConfig<Ctx>>
  ) {
    const last = state.messages[state.messages.length - 1]?.content ?? '';
    const fn = behaviors[agent.name];
    const content = fn ? fn(last) : '';
    return { message: { content } };
  }
};

const config: RunConfig<Ctx> = { agentRegistry, modelProvider };

async function demoSequential() {
  const result = await runSequentialPipeline(['Step1', 'Step2', 'Step3'], 'start', {}, config);
  console.log('Sequential:', result.outcome);
}

async function demoParallel() {
  const result = await runParallelPipeline('First', ['Second', 'Third'], 'Final', 'start', {}, config);
  console.log('Parallel:', result.outcome);
}

async function demoCoordinator() {
  const agents = { start: 'Start', condition: 'Check', onTrue: 'BigAgent', onFalse: 'SmallAgent', end: 'End' };
  const result = await runCoordinatorPipeline(agents, out => out === 'big', '7', {}, config);
  console.log('Coordinator:', result.outcome);
}

async function demoRedundant() {
  const result = await runParallelRedundant(
    'What is the answer to life?',
    { parallel: ['Answer1', 'Answer2'], evaluator: 'Judge' },
    {},
    config
  );
  console.log('Parallel redundant:', result.outcome);
}

async function main() {
  await demoSequential();
  await demoParallel();
  await demoCoordinator();
  await demoRedundant();
}

main().catch(err => console.error(err));
