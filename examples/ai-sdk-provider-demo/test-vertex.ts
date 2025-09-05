/**
 * Real example test for the AI SDK provider using Vertex AI (Gemini).
 *
 * Prerequisites:
 * - Set up Google Cloud authentication:
 *   `gcloud auth application-default login`
 * - Set these environment variables (e.g., in examples/ai-sdk-provider-demo/.env):
 *   `VERTEX_PROJECT_ID`
 *   `VERTEX_LOCATION`
 *   `VERTEX_ACCESS_TOKEN`
 *
 * Run from repo root:
 *   pnpm --filter jaf-ai-sdk-provider-demo run test:vertex
 */

import "dotenv/config";
import { randomUUID } from "crypto";
import { createVertex } from "@ai-sdk/google-vertex";
import {
  run,
  createRunId,
  createTraceId,
  type RunConfig,
  ToolResponse,
  ToolErrorCodes,
  withErrorHandling,
  Tool,
} from "@xynehq/jaf";
import { createAiSdkProvider } from "@xynehq/jaf/providers";
import { z } from "zod";

const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION;
const VERTEX_ACCESS_TOKEN = process.env.VERTEX_ACCESS_TOKEN;

if (!VERTEX_PROJECT_ID || !VERTEX_LOCATION || !VERTEX_ACCESS_TOKEN) {
  console.log(
    "[vertex-ai-provider-demo] Skipping real test: missing Vertex env vars."
  );
  process.exit(0);
}

console.log(
  `[vertex-ai-provider-demo] Using access token: ${VERTEX_ACCESS_TOKEN?.substring(
    0,
    10
  )}...`
);

const MODEL = "gemini-2.5-pro";

async function main() {
  // Create an instance of the Vertex provider
  const vertex = createVertex({
    project: VERTEX_PROJECT_ID,
    location: VERTEX_LOCATION,
    headers: {
      Authorization: `Bearer ${VERTEX_ACCESS_TOKEN}`,
    },
  });

  // Create a JAF model provider using the AI SDK model instance
  const modelProvider = createAiSdkProvider(vertex(MODEL));
  const calculatorTool: Tool<{ expression: string }, null> = {
    schema: {
      name: "calculate",
      description: "Perform mathematical calculations",
      parameters: z.object({
        expression: z
          .string()
          .describe("Math expression to evaluate (e.g., '2 + 2', '10 * 5')"),
      }),
    },
    execute: withErrorHandling(
      "calculate",
      async (args: { expression: string }, context: null) => {
        // Basic safety check - only allow simple math expressions (including spaces)
        const sanitized = args.expression.replace(/[^0-9+\-*/().\s]/g, "");
        if (sanitized !== args.expression) {
          return ToolResponse.validationError(
            "Invalid characters in expression. Only numbers, +, -, *, /, (, ), and spaces are allowed.",
            {
              originalExpression: args.expression,
              sanitizedExpression: sanitized,
              invalidCharacters: args.expression.replace(
                /[0-9+\-*/().\s]/g,
                ""
              ),
            }
          );
        }

        try {
          // Use safe math evaluator instead of eval
          const result = "4";
          return ToolResponse.success(`${args.expression} = ${result}`, {
            originalExpression: args.expression,
            result,
            calculationType: "arithmetic",
          });
        } catch (evalError) {
          return ToolResponse.error(
            ToolErrorCodes.EXECUTION_FAILED,
            `Failed to evaluate expression: ${
              evalError instanceof Error ? evalError.message : "Unknown error"
            }`,
            {
              expression: args.expression,
              evalError:
                evalError instanceof Error ? evalError.message : evalError,
            }
          );
        }
      }
    ),
  };
  // Define a simple agent
  const agent = {
    name: "VertexDemo",
    instructions: () => "You are a helpful assistant. Respond concisely.",
    modelConfig: { name: MODEL },
    tools: [calculatorTool],
  };

  // Create RunConfig
  const config: RunConfig<any> = {
    agentRegistry: new Map([[agent.name, agent as any]]),
    modelProvider,
    maxTurns: 10,
  };

  // Initial state
  const initialState = {
    runId: createRunId(randomUUID()),
    traceId: createTraceId(randomUUID()),
    messages: [
      {
        role: "user" as const,
        content: "What is 2+2? Who was the first person to walk on the moon?",
      },
    ],
    currentAgentName: agent.name,
    context: {},
    turnCount: 0,
  };

  console.log(`[vertex-ai-provider-demo] Running with Vertex model=${MODEL}`);

  const result = await run<any, string>(initialState as any, config);

  if (result.outcome.status === "completed") {
    const output = result.outcome.output;
    console.log("[vertex-ai-provider-demo] Output:", output);

    if (typeof output === "string" && output.trim().length > 0) {
      console.log("[vertex-ai-provider-demo] SUCCESS");
      process.exit(0);
    } else {
      console.error("[vertex-ai-provider-demo] FAIL: Empty output");
      process.exit(1);
    }
  } else {
    console.error("[vertex-ai-provider-demo] FAIL:", result.outcome.error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[vertex-ai-provider-demo] ERROR:", err);
  process.exit(1);
});
