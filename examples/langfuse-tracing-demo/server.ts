import 'dotenv/config';
import { z } from 'zod';
import { 
  runServer,
  createCompositeTraceCollector, 
  ConsoleTraceCollector,
  makeLiteLLMProvider 
} from '../../src/index.js';

// Set Langfuse configuration
process.env.LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY || "pk-lf-your-public-key-here";
process.env.LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY || "sk-lf-your-secret-key-here";
process.env.LANGFUSE_HOST = "http://localhost:3000";

const WeatherSchema = z.object({
  location: z.string().describe("The location to get the weather for."),
  unit: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("The unit to use for the temperature.")
});

async function getWeather(args: z.infer<typeof WeatherSchema>, _context: any): Promise<string> {
  if (args.location.toLowerCase().includes("new york")) {
    return `The weather in New York is 75°${args.unit}.`;
  }
  if (args.location.toLowerCase().includes("paris")) {
    return `The weather in Paris is 18°${args.unit}.`;
  }
  if (args.location.toLowerCase().includes("tokyo")) {
    return `The weather in Tokyo is 22°${args.unit}.`;
  }
  return `The weather in ${args.location} is 25°${args.unit}.`;
}

async function main() {
  console.log("🌐 Starting JAF HTTP Server with Langfuse Tracing");
  console.log("Langfuse tracing is enabled and will send traces to your local instance.");
  console.log("📍 Server will be available at: http://localhost:8080");
  console.log("------------------------------------");

  // Create trace collector that includes console and auto-configured Langfuse
  const traceCollector = createCompositeTraceCollector(new ConsoleTraceCollector());

  // Define the weather agent
  const weatherAgent = {
    name: 'weather_agent',
    instructions: () => 
      "You are a helpful weather assistant. Use the get_weather tool to fetch weather information for any location the user asks about. " +
      "Always call the tool first, then provide a friendly response based on the weather data you receive.",
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

  // Get API credentials
  const litellmApiKey = process.env.LITELLM_API_KEY;
  const litellmUrl = process.env.LITELLM_URL || "";
  
  if (!litellmApiKey) {
    console.log("⚠️  Warning: LITELLM_API_KEY environment variable not set.");
  }

  // Start the server
  const server = await runServer(
    [weatherAgent],
    {
      modelProvider: makeLiteLLMProvider(litellmUrl, litellmApiKey || ""),
      onEvent: traceCollector.collect.bind(traceCollector)
    },
    {
      port: 8080,
      host: '0.0.0.0',
      cors: true
    }
  );

  console.log("✅ Server started successfully!");
  console.log("\n📋 Test with curl:");
  console.log("curl -X POST http://localhost:8080/chat \\");
  console.log('  -H "Content-Type: application/json" \\');
  console.log('  -d \'{"message": "What is the weather in New York?", "agent": "weather_agent"}\'');
  
  console.log("\n🔍 Other available endpoints:");
  console.log("GET  http://localhost:8080/health");
  console.log("GET  http://localhost:8080/agents");
  console.log("POST http://localhost:8080/chat");
  
  console.log("\n🎯 Langfuse Dashboard: http://localhost:3000");
  console.log("------------------------------------");
}

if (require.main === module) {
  main().catch(console.error);
}