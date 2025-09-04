import { RunConfig, RunState } from './types.js';

// Lightweight runtime bridge to make the current run's state/config
// available to tool implementations that need to run sub-agents.

export type ToolRuntime<Ctx> = {
  readonly state: RunState<Ctx>;
  readonly config: RunConfig<Ctx>;
};

const runtimeMap = new WeakMap<object, ToolRuntime<any>>();

export function setToolRuntime<Ctx>(context: Readonly<Ctx>, runtime: ToolRuntime<Ctx>): void {
  // Use the context object as a stable key for this run invocation
  runtimeMap.set(context as unknown as object, runtime);
}

export function getToolRuntime<Ctx>(context: Readonly<Ctx>): ToolRuntime<Ctx> | undefined {
  return runtimeMap.get(context as unknown as object);
}

