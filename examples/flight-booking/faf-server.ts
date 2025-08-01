/**
 * Flight Booking FAF Server Integration
 * 
 * Integrates flight booking agents with FAF's built-in server
 */

import 'dotenv/config';
import { 
  runServer,
  Agent,
  Tool,
  makeLiteLLMProvider,
  ConsoleTraceCollector,
  ToolResponse,
  withErrorHandling,
  createInMemoryProvider
} from '../../src';
import { z } from 'zod';

// Import our flight booking tools (converted to FAF format)
import {
  searchFlightsTool,
  checkSeatAvailabilityTool,
  calculatePriceTool,
  bookFlightTool
} from './index';

// Context type for flight booking
type FlightBookingContext = {
  userId: string;
  sessionId: string;
  customerLevel?: 'standard' | 'premium' | 'vip';
};

// Convert ADK tools to FAF tools
const convertADKToolToFAF = <T extends Record<string, any>>(
  adkTool: any
): Tool<T, FlightBookingContext> => {
  // Build Zod schema from ADK parameters
  const schemaObj: any = {};
  adkTool.parameters.forEach((param: any) => {
    let zodType;
    switch (param.type) {
      case 'string':
        zodType = z.string();
        if (param.enum) {
          zodType = z.enum(param.enum as any);
        }
        break;
      case 'number':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array':
        zodType = z.array(z.any());
        break;
      case 'object':
        zodType = z.object({});
        break;
      default:
        zodType = z.any();
    }
    
    if (param.description) {
      zodType = zodType.describe(param.description);
    }
    
    if (!param.required) {
      zodType = zodType.optional();
    }
    
    schemaObj[param.name] = zodType;
  });

  return {
    schema: {
      name: adkTool.name,
      description: adkTool.description,
      parameters: z.object(schemaObj) as unknown as z.ZodType<T>
    },
    execute: withErrorHandling(adkTool.name, async (args: T, context: FlightBookingContext) => {
      try {
        const result = await adkTool.execute(args, { sessionId: context.sessionId });
        
        // Convert ADK ToolResult to FAF ToolResponse
        if (result.success) {
          return ToolResponse.success(
            typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2),
            result.metadata
          );
        } else {
          return ToolResponse.error(
            'EXECUTION_FAILED',
            result.error || 'Unknown error',
            result.metadata
          );
        }
      } catch (error) {
        return ToolResponse.error(
          'EXECUTION_FAILED',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    })
  };
};

// Convert tools
const fafSearchFlightsTool = convertADKToolToFAF<{
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: number;
  class: string;
}>(searchFlightsTool);

const fafCheckAvailabilityTool = convertADKToolToFAF<{
  flightNumber: string;
  passengers: number;
}>(checkSeatAvailabilityTool);

const fafCalculatePriceTool = convertADKToolToFAF<{
  basePrice: number;
  passengers: number;
  includeInsurance?: boolean;
  includeBaggage?: boolean;
}>(calculatePriceTool);

const fafBookFlightTool = convertADKToolToFAF<{
  flightNumber: string;
  passengers: any[];
  paymentMethod: string;
}>(bookFlightTool);

// Define FAF agents
const flightSearchAgent: Agent<FlightBookingContext, string> = {
  name: 'FlightSearch',
  instructions: (state) => `You are a flight search specialist. Help customers find the best flights.
    
Available routes: NYC to LAX, LAX to NYC
Customer level: ${state.context.customerLevel || 'standard'}

Use the search_flights tool to find available flights and help customers choose the best option.`,
  tools: [fafSearchFlightsTool]
};

const bookingAgent: Agent<FlightBookingContext, string> = {
  name: 'BookingAgent',
  instructions: (state) => `You are a flight booking specialist. Help customers complete their bookings.
    
Customer level: ${state.context.customerLevel || 'standard'}

Use available tools to check availability, calculate prices, and process bookings.
Always verify availability before booking.`,
  tools: [fafCheckAvailabilityTool, fafCalculatePriceTool, fafBookFlightTool]
};

const fullServiceAgent: Agent<FlightBookingContext, string> = {
  name: 'FlightAssistant',
  instructions: (state) => `You are a comprehensive flight booking assistant.
    
Customer level: ${state.context.customerLevel || 'standard'}
${state.context.customerLevel === 'vip' ? 'VIP Customer - Provide premium service and priority handling.' : ''}

You can:
1. Search for flights between cities
2. Check seat availability
3. Calculate total prices with taxes and fees
4. Complete flight bookings

Available routes: NYC to LAX, LAX to NYC

Always be helpful and guide customers through the entire booking process.`,
  tools: [fafSearchFlightsTool, fafCheckAvailabilityTool, fafCalculatePriceTool, fafBookFlightTool]
};

// Start server function
export async function startFlightBookingServer() {
  console.log('Starting Flight Booking FAF Server...\n');

  const modelProvider = makeLiteLLMProvider(
    process.env.LITELLM_URL || 'http://localhost:4000',
    process.env.LITELLM_API_KEY
  ) as any;

  const traceCollector = new ConsoleTraceCollector();
  const memoryProvider = createInMemoryProvider();

  try {
    const server = await runServer(
      [flightSearchAgent, bookingAgent, fullServiceAgent],
      {
        modelProvider,
        maxTurns: 10,
        modelOverride: process.env.LITELLM_MODEL || 'gpt-3.5-turbo',
        onEvent: traceCollector.collect.bind(traceCollector),
        memory: {
          provider: memoryProvider,
          autoStore: true,
          maxMessages: 50
        }
      },
      {
        port: parseInt(process.env.PORT || '3001'),
        host: '127.0.0.1',
        cors: true,
        defaultMemoryProvider: memoryProvider
      }
    );

    console.log('✅ Flight Booking Server started successfully!');
    console.log('\n📚 Example requests:');
    console.log('\n1. Search flights:');
    console.log('   curl -X POST http://localhost:3001/chat \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"messages":[{"role":"user","content":"Find me flights from NYC to LAX tomorrow for 2 people in economy"}],"agentName":"FlightSearch","context":{"userId":"customer123","customerLevel":"standard"}}\'');
    console.log('\n2. Complete booking flow:');
    console.log('   curl -X POST http://localhost:3001/chat \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"messages":[{"role":"user","content":"I need to book a flight from NYC to LAX for 2 passengers"}],"agentName":"FlightAssistant","conversationId":"booking-123","context":{"userId":"customer123"}}\'');
    console.log('\n3. VIP customer service:');
    console.log('   curl -X POST http://localhost:3001/chat \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"messages":[{"role":"user","content":"I need your best flight options"}],"agentName":"FlightAssistant","context":{"userId":"vip456","customerLevel":"vip"}}\'');

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      console.log(`\nReceived ${signal}, shutting down...`);
      await server.stop();
      console.log('Server stopped');
      process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  startFlightBookingServer().catch(console.error);
}