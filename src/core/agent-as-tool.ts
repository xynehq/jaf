import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { run } from './engine.js';
import {
  Agent,
  RunConfig,
  RunResult,
  RunState,
  Tool,
  createRunId,
} from './types.js';
import { ToolResponse, ToolResult } from './tool-results.js';
import { getToolRuntime } from './tool-runtime.js';

type AgentAsToolOptions<Ctx, Out> = {
  readonly toolName?: string;
  readonly toolDescription?: string;
  readonly customOutputExtractor?: (output: Out, finalState: RunState<Ctx>) => string | Promise<string>;
  readonly maxTurns?: number; // default 5
  readonly registry?: ReadonlyMap<string, Agent<Ctx, any>>; // default: only child agent
  readonly propagateEvents?: 'summary' | 'all' | 'none'; // default summary
  readonly memoryMode?: 'none' | 'inherit'; // default none
};

/**
 * Wrap an Agent as a Tool so it can be invoked by another agent.
 * The child agent runs in an isolated sub-run, receives only the input text,
 * and returns its final output as a string (or via custom extractor).
 */
export function agentAsTool<Ctx, Out = any>(
  childAgent: Agent<Ctx, Out>,
  options: AgentAsToolOptions<Ctx, Out> = {}
): Tool<{ input: string }, Ctx> {
  const {
    toolName = childAgent.name,
    toolDescription = `Run the '${childAgent.name}' agent on the supplied input and return its result`,
    customOutputExtractor,
    maxTurns = 5,
    registry,
    propagateEvents = 'summary',
    memoryMode = 'none',
  } = options;

  const paramsSchema = z.object({
    input: z.string().describe('Input text passed to the sub-agent as a user message')
  });

  return {
    schema: {
      name: toolName,
      description: toolDescription,
      parameters: paramsSchema,
    },
    execute: async (args, context): Promise<string | ToolResult> => {
      // Retrieve current runtime (state + config) from engine bridge
      const runtime = getToolRuntime(context);
      if (!runtime) {
        return ToolResponse.error(
          'EXECUTION_FAILED',
          'Agent tool cannot access runtime. Ensure engine installs tool runtime before execution.'
        );
      }

      const parentState = runtime.state as RunState<Ctx>;
      const parentConfig = runtime.config as RunConfig<Ctx>;

      // Build child run state: new runId, same traceId, single user message
      const childState: RunState<Ctx> = {
        runId: createRunId(uuidv4()),
        traceId: parentState.traceId,
        messages: [
          { role: 'user', content: args.input }
        ],
        currentAgentName: childAgent.name,
        context: parentState.context,
        turnCount: 0,
      };

      // Build child config derived from parent
      const childRegistry: ReadonlyMap<string, Agent<Ctx, any>> = registry ?? new Map([[childAgent.name, childAgent]]);

      const childConfig: RunConfig<Ctx> = {
        ...parentConfig,
        agentRegistry: childRegistry,
        maxTurns,
        // Memory isolation by default
        ...(memoryMode === 'none' ? { memory: undefined, conversationId: undefined } : {}),
        onEvent: (event) => {
          if (propagateEvents === 'all') {
            parentConfig.onEvent?.(event);
          } else if (propagateEvents === 'summary') {
            // For summary, we still forward important boundaries
            if (event.type === 'run_start' || event.type === 'run_end' || event.type === 'final_output' || event.type === 'handoff') {
              parentConfig.onEvent?.(event);
            }
          }
        }
      };

      try {
        const result = await run<Ctx, Out>(childState, childConfig);
        const childRunId = childState.runId;

        if (result.outcome.status === 'completed') {
          const output = result.outcome.output as Out;
          let text: string;
          if (customOutputExtractor) {
            text = await customOutputExtractor(output, result.finalState as RunState<Ctx>);
          } else {
            // Default conversion: strings as-is, objects to JSON
            text = typeof output === 'string' ? output : JSON.stringify(output);
          }
          return ToolResponse.success(text, {
            toolName,
            childRunId,
            childAgent: childAgent.name,
            turns: result.finalState.turnCount,
          });
        }

        // Error path
        const err = result.outcome.error;
        const message = `${err._tag}${'detail' in err ? `: ${(err as any).detail}` : ''}`;
        return ToolResponse.error('EXECUTION_FAILED', message, {
          toolName,
          childRunId,
          childAgent: childAgent.name,
        });
      } catch (e) {
        return ToolResponse.error(
          'EXECUTION_FAILED',
          e instanceof Error ? e.message : String(e),
          { toolName, childAgent: childAgent.name }
        );
      }
    }
  };
}

