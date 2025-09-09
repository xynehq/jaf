/**
 * Real example test for the AI SDK provider using the OpenAI provider.
 *
 * Prerequisites:
 * - Set OPENAI_API_KEY in your environment (e.g., in examples/ai-sdk-provider-demo/.env)
 *
 * From repo root:
 *   1) pnpm -w install
 *   2) pnpm --filter jaf-ai-sdk-provider-demo run test
 */

import "dotenv/config";
import { randomUUID } from "crypto";
import { createOpenAI } from "@ai-sdk/openai";
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

if (!process.env.OPENAI_API_KEY) {
  console.log(
    "[ai-sdk-provider-demo] Skipping real test: missing OPENAI_API_KEY env var."
  );
  process.exit(0);
} else {
  console.log("Env OPENAI_API_KEY is set, proceeding with the test...");
}

const MODEL = "gpt-4o";

async function main() {
  // Create an instance of the OpenAI provider
  const openai = createOpenAI();

  // Create a JAF model provider using the AI SDK model instance
  const modelProvider = createAiSdkProvider(openai.chat(MODEL));
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
          const result = eval(sanitized); // In production, replace with a proper math parser/evaluator
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
    name: "OpenAIDemo",
    instructions: () => "You are a helpful assistant. Respond concisely.",
    modelConfig: {
      name: MODEL,
      maxTokens: 1024,
    },
    tools: [calculatorTool],
    outputCodec: z.object({
      response: z.string().describe("Response from model"),
      responseInt: z.number().describe("Response as an integer"),
    }),
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
        content: "What is 2+2?",
      },
    ],
    currentAgentName: agent.name,
    context: {},
    turnCount: 0,
  };

  console.log(`[ai-sdk-provider-demo] Running with OpenAI model=${MODEL}`);

  const result = await run<any, string>(initialState as any, config);

  if (result.outcome.status === "completed") {
    const output = result.outcome.output;
    console.log(
      "[ai-sdk-provider-demo] Raw result:",
      JSON.stringify(result, null, 2)
    );
    console.log("[ai-sdk-provider-demo] Output:", output);
  } else {
    console.error("[ai-sdk-provider-demo] FAIL:", result.outcome.status);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[ai-sdk-provider-demo] ERROR:", err);
  process.exit(1);
});
