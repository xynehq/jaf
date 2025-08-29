import 'dotenv/config';
import { z } from 'zod';
import { 
  Agent, 
  run, 
  generateRunId, 
  generateTraceId, 
  createCompositeTraceCollector, 
  ConsoleTraceCollector,
  makeLiteLLMProvider 
} from '../../src/index.js';

// Set the LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY to enable Langfuse tracing
// Get these from your Langfuse project settings -> API Keys
// For local Langfuse instance, visit http://localhost:3000 and get your API keys
process.env.LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY || "pk-lf-your-public-key-here";
process.env.LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY || "sk-lf-your-secret-key-here";
process.env.LANGFUSE_HOST = "http://localhost:3000"; // For local Langfuse v2 server

const WeatherSchema = z.object({
  location: z.string().describe("The location to get the weather for."),
  unit: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("The unit to use for the temperature.")
});

async function getWeather(args: z.infer<typeof WeatherSchema>, _context: any): Promise<string> {
  if (args.location.toLowerCase().includes("new york")) {
    return `The weather in New York is 75°${args.unit}.`;
  }
  return `The weather in ${args.location} is 25°${args.unit}.`;
}

async function main() {
  console.log("--- Langfuse Tracing Demo ---");
  console.log("Langfuse is configured. Traces will be sent to Langfuse.");
  console.log("------------------------------------");

  // Create a composite collector that includes the console and the auto-configured Langfuse collector
  const traceCollector = createCompositeTraceCollector(new ConsoleTraceCollector());

  const weatherAgent: Agent<{ userId?: string; sessionId?: string }, string> = {
    name: 'weather_agent',
    instructions: () => 
      "You are a function-calling AI model. You will be given a user's question and a set of tools. " +
      "Your task is to follow these rules exactly: " +
      "1. Examine the user's request. " +
      "2. If you have a tool that can answer the request, call that tool. " +
      "3. After the tool has been called and you have the result, your *final* action is to output the result to the user. " +
      "Under no circumstances should you ever call the same tool more than once. " +
      "Your response should be only the answer from the tool.",
    tools: [{
      schema: {
        name: "get_weather",
        description: "Get the weather for a location.",
        parameters: WeatherSchema
      },
      execute: getWeather
    }],
    modelConfig: { name: "gemini-2.5-pro" }
  };

  // Get API key and URL from environment
  const litellmApiKey = process.env.LITELLM_API_KEY;
  const litellmUrl = process.env.LITELLM_URL || "";
  if (!litellmApiKey) {
    console.log("\n---");
    console.log("Warning: LITELLM_API_KEY environment variable not set.");
    console.log("The current LiteLLM provider might require a valid API key.");
    console.log("---\n");
  }

  // Create initial state
  const initialState = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [{ role: 'user' as const, content: "what is the weather in new york?" }],
    currentAgentName: "weather_agent",
    context: { userId: "user-123", sessionId: "session-456" },
    turnCount: 0
  };

  const config = {
    agentRegistry: new Map([["weather_agent", weatherAgent]]),
    modelProvider: makeLiteLLMProvider(litellmUrl, litellmApiKey || ""),
    onEvent: traceCollector.collect.bind(traceCollector)
  };

  // Run the agent
  const result = await run(initialState, config);

  console.log("\n--- Agent Run Complete ---");
  if (result.outcome.status === "completed") {
    console.log(`Final result: ${result.outcome.output}`);
  } else {
    console.log(`Run failed with error: ${result.outcome.error._tag}: ${JSON.stringify(result.outcome.error)}`);
  }
  console.log("--------------------------");
}

if (require.main === module) {
  main().catch(console.error);
}