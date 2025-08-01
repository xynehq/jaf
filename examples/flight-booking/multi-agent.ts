/**
 * Multi-Agent Flight Booking System
 * 
 * Demonstrates how multiple specialized agents work together
 * to handle complex flight booking scenarios.
 */

import 'dotenv/config';
import {
  createAgent,
  createMultiAgent,
  createFunctionTool,
  createInMemorySessionProvider,
  createRunnerConfig,
  runAgent,
  createUserMessage,
  Model,
  ToolParameterType,
  AgentConfig
} from '../../src/adk';

// Import tools from main example
import {
  searchFlightsTool,
  checkSeatAvailabilityTool,
  calculatePriceTool,
  bookFlightTool
} from './index';

// ========== Additional Specialized Tools ==========

const checkWeatherTool = createFunctionTool({
  name: 'check_weather',
  description: 'Check weather conditions at airports',
  execute: async (params) => {
    const { location, date } = params as { location: string; date: string };
    
    // Mock weather data
    const weatherConditions = {
      'NYC': { temp: 45, condition: 'cloudy', windSpeed: 15 },
      'LAX': { temp: 72, condition: 'sunny', windSpeed: 8 },
      'ORD': { temp: 28, condition: 'snow', windSpeed: 25 },
      'MIA': { temp: 85, condition: 'thunderstorms', windSpeed: 20 }
    };

    const weather = weatherConditions[location as keyof typeof weatherConditions] || 
      { temp: 65, condition: 'clear', windSpeed: 10 };

    const warnings = [];
    if (weather.condition === 'snow' || weather.condition === 'thunderstorms') {
      warnings.push(`⚠️ Potential delays due to ${weather.condition}`);
    }
    if (weather.windSpeed > 20) {
      warnings.push('⚠️ High winds may affect flight schedules');
    }

    return {
      location,
      date,
      temperature: weather.temp,
      condition: weather.condition,
      windSpeed: weather.windSpeed,
      warnings,
      recommendation: warnings.length > 0 
        ? 'Consider flexible booking options' 
        : 'Good weather conditions for travel'
    };
  },
  parameters: [
    {
      name: 'location',
      type: ToolParameterType.STRING,
      description: 'Airport code',
      required: true
    },
    {
      name: 'date',
      type: ToolParameterType.STRING,
      description: 'Date to check weather',
      required: true
    }
  ]
});

const findAlternateRoutesTool = createFunctionTool({
  name: 'find_alternate_routes',
  description: 'Find alternate routes with connections',
  execute: async (params) => {
    const { origin, destination, date } = params as { 
      origin: string; 
      destination: string; 
      date: string;
    };

    // Mock alternate routes
    const alternateRoutes = [
      {
        route: `${origin} → ORD → ${destination}`,
        totalDuration: '7h 45m',
        stops: 1,
        airlines: ['United Airlines'],
        price: 425,
        layoverTime: '1h 30m'
      },
      {
        route: `${origin} → DFW → ${destination}`,
        totalDuration: '8h 15m',
        stops: 1,
        airlines: ['American Airlines'],
        price: 395,
        layoverTime: '2h'
      }
    ];

    return {
      origin,
      destination,
      date,
      directFlightsAvailable: false,
      alternateRoutes,
      recommendation: 'Consider flights with one connection for more options'
    };
  },
  parameters: [
    {
      name: 'origin',
      type: ToolParameterType.STRING,
      description: 'Origin airport',
      required: true
    },
    {
      name: 'destination',
      type: ToolParameterType.STRING,
      description: 'Destination airport',
      required: true
    },
    {
      name: 'date',
      type: ToolParameterType.STRING,
      description: 'Travel date',
      required: true
    }
  ]
});

const manageLoyaltyPointsTool = createFunctionTool({
  name: 'manage_loyalty_points',
  description: 'Check and apply loyalty program benefits',
  execute: async (params) => {
    const { customerId, airline, action } = params as {
      customerId: string;
      airline: string;
      action: 'check' | 'apply';
    };

    // Mock loyalty data
    const loyaltyData = {
      points: 45000,
      status: 'Gold',
      benefits: [
        'Priority boarding',
        'Free seat selection',
        '2 free checked bags',
        'Lounge access'
      ],
      upgradeAvailable: true,
      pointsForUpgrade: 15000
    };

    if (action === 'check') {
      return {
        customerId,
        airline,
        ...loyaltyData,
        message: `You have ${loyaltyData.points} points with ${loyaltyData.status} status`
      };
    } else {
      return {
        customerId,
        airline,
        applied: true,
        discount: 50,
        pointsUsed: 5000,
        remainingPoints: loyaltyData.points - 5000,
        message: 'Loyalty discount applied successfully'
      };
    }
  },
  parameters: [
    {
      name: 'customerId',
      type: ToolParameterType.STRING,
      description: 'Customer ID',
      required: true
    },
    {
      name: 'airline',
      type: ToolParameterType.STRING,
      description: 'Airline name',
      required: true
    },
    {
      name: 'action',
      type: ToolParameterType.STRING,
      description: 'Action to perform (check or apply)',
      required: true
    }
  ]
});

// ========== Specialized Agents ==========

const createFlightSearchSpecialist = (): AgentConfig => ({
  name: 'flight_search_specialist',
  model: Model.GEMINI_2_0_FLASH,
  instruction: `You are a flight search specialist. Your role is to:
  - Find the best flight options based on customer preferences
  - Check direct and connecting flights
  - Consider weather conditions that might affect travel
  - Provide comprehensive flight options`,
  tools: [searchFlightsTool, checkWeatherTool, findAlternateRoutesTool]
});

const createPricingSpecialist = (): AgentConfig => ({
  name: 'pricing_specialist',
  model: Model.GEMINI_2_0_FLASH,
  instruction: `You are a pricing and loyalty specialist. Your role is to:
  - Calculate accurate pricing with all fees
  - Apply loyalty program benefits
  - Find the best deals and discounts
  - Explain pricing breakdowns clearly`,
  tools: [calculatePriceTool, manageLoyaltyPointsTool]
});

const createBookingSpecialist = (): AgentConfig => ({
  name: 'booking_specialist',
  model: Model.GEMINI_2_0_FLASH,
  instruction: `You are a booking specialist. Your role is to:
  - Verify seat availability before booking
  - Process bookings accurately
  - Ensure all passenger information is complete
  - Provide confirmation details`,
  tools: [checkSeatAvailabilityTool, bookFlightTool]
});

// ========== Multi-Agent Coordinator ==========

export const createFlightBookingTeam = () => {
  const searchSpecialist = createFlightSearchSpecialist();
  const pricingSpecialist = createPricingSpecialist();
  const bookingSpecialist = createBookingSpecialist();

  const coordinator = createMultiAgent(
    'flight_booking_coordinator',
    Model.GEMINI_2_0_FLASH,
    `You are the lead flight booking coordinator managing a team of specialists.
    
    Your team includes:
    - Flight Search Specialist: Finds flights and checks weather
    - Pricing Specialist: Handles pricing and loyalty programs
    - Booking Specialist: Manages availability and bookings
    
    Delegation strategy:
    1. Route flight search requests to the search specialist
    2. Send pricing and loyalty queries to the pricing specialist
    3. Direct booking and availability checks to the booking specialist
    
    For complex requests that need multiple specialists:
    - Coordinate between specialists to provide comprehensive service
    - Ensure smooth handoffs between team members
    - Summarize results from multiple specialists clearly`,
    [searchSpecialist, pricingSpecialist, bookingSpecialist],
    'conditional'
  );

  const sessionProvider = createInMemorySessionProvider();
  const runnerConfig = createRunnerConfig(coordinator, sessionProvider);

  return { coordinator, sessionProvider, runnerConfig };
};

// ========== Example Usage ==========

async function runMultiAgentBookingExample() {
  console.log('=== Multi-Agent Flight Booking System ===\n');

  const { runnerConfig } = createFlightBookingTeam();

  // Example 1: Complex search with weather consideration
  console.log('1. Complex Search Request:');
  const complexSearchMessage = createUserMessage(
    `I need to fly from NYC to LAX next Friday. I'm flexible with dates if the weather is bad. 
    Also, can you check if there are any connecting flights that might be cheaper?`
  );

  const searchResponse = await runAgent(runnerConfig, {
    userId: 'premium_customer',
    sessionId: 'multi_booking_1'
  }, complexSearchMessage);

  console.log('Customer:', complexSearchMessage.parts[0].text);
  console.log('Coordinator:', searchResponse.content.parts[0].text);

  // Example 2: Loyalty program integration
  console.log('\n2. Loyalty Program Request:');
  const loyaltyMessage = createUserMessage(
    `I have a loyalty account with American Airlines (ID: AA123456). 
    Can you check my points and see if I can get any discounts on the AA101 flight?`
  );

  const loyaltyResponse = await runAgent(runnerConfig, {
    userId: 'premium_customer',
    sessionId: 'multi_booking_1'
  }, loyaltyMessage);

  console.log('Customer:', loyaltyMessage.parts[0].text);
  console.log('Coordinator:', loyaltyResponse.content.parts[0].text);

  // Example 3: End-to-end booking with all specialists
  console.log('\n3. Complete Booking Process:');
  const fullBookingMessage = createUserMessage(
    `I'd like to book the best option you found. Please:
    1. Verify availability for 2 passengers
    2. Apply my loyalty discount
    3. Book the flight for John Doe (john@example.com, DOB: 1985-06-15) 
       and Jane Doe (jane@example.com, DOB: 1987-09-20)
    4. I'll pay with credit card`
  );

  const bookingResponse = await runAgent(runnerConfig, {
    userId: 'premium_customer',
    sessionId: 'multi_booking_1'
  }, fullBookingMessage);

  console.log('Customer:', fullBookingMessage.parts[0].text);
  console.log('Coordinator:', bookingResponse.content.parts[0].text);
}

// Run example if this file is executed directly
if (require.main === module) {
  runMultiAgentBookingExample().catch(console.error);
}

// ========== Export Components ==========

export {
  checkWeatherTool,
  findAlternateRoutesTool,
  manageLoyaltyPointsTool,
  createFlightSearchSpecialist,
  createPricingSpecialist,
  createBookingSpecialist,
  runMultiAgentBookingExample
};