"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handoffTool = void 0;
const zod_1 = require("zod");
const handoffArgsSchema = zod_1.z.object({
    agentName: zod_1.z.string().describe("The name of the agent to handoff to."),
    reason: zod_1.z.string().describe("The reason for the handoff."),
});
exports.handoffTool = {
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
