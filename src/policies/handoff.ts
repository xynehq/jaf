import { z } from 'zod';
import { Tool } from '../core/types.js';

const handoffArgsSchema = z.object({
  agentName: z.string().describe("The name of the agent to handoff to."),
  reason: z.string().describe("The reason for the handoff."),
});

type HandoffArgs = z.infer<typeof handoffArgsSchema>;

export const handoffTool: Tool<HandoffArgs, any> = {
  schema: {
    name: "handoff_to_agent",
    description: "Delegate the task to a different, more specialized agent.",
    parameters: handoffArgsSchema,
  },
  execute: async (args, _) => {
    return JSON.stringify({ 
      handoff_to: args.agentName,
      reason: args.reason,
      timestamp: new Date().toISOString()
    });
  },
};