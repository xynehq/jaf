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

// Set the TRACE_COLLECTOR_URL to enable OpenTelemetry tracing
// Replace with your actual OTLP collector endpoint if needed
process.env.TRACE_COLLECTOR_URL = "http://localhost:4318/v1/traces";

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
  console.log("--- OpenTelemetry Tracing Demo ---");
  console.log(`OTLP Exporter configured for: ${process.env.TRACE_COLLECTOR_URL}`);
  console.log("Run an OTLP collector (like Jaeger) to view traces.");
  console.log("------------------------------------");

  // Create a composite collector that includes the console and the auto-configured OTEL collector
  const traceCollector = createCompositeTraceCollector(new ConsoleTraceCollector());

  const weatherAgent: Agent<{}, string> = {
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
    context: {},
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