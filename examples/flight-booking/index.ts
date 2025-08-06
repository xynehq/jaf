/**
 * Flight Booking Example using JAF ADK
 * 
 * This example demonstrates how to build a flight booking agent
 * using the JAF ADK (Agent Development Kit) layer.
 */

import 'dotenv/config';
import {
  createAgent,
  createFunctionTool,
  createInMemorySessionProvider,
  createRunnerConfig,
  runAgent,
  createUserMessage,
  Model,
  ToolParameterType,
  createObjectValidator,
  stringSchema,
  numberSchema,
  quickSetup
} from '../../src/adk';

// ========== Types ==========

interface FlightSearchParams extends Record<string, unknown> {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: number;
  class: 'economy' | 'business' | 'first';
}

interface FlightOption {
  flightNumber: string;
  airline: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  price: number;
  seatsAvailable: number;
}

// ========== Mock Data ==========

const mockFlights: Record<string, FlightOption[]> = {
  'NYC-LAX': [
    {
      flightNumber: 'AA101',
      airline: 'American Airlines',
      departureTime: '08:00',
      arrivalTime: '11:30',
      duration: '5h 30m',
      price: 350,
      seatsAvailable: 45
    },
    {
      flightNumber: 'UA202',
      airline: 'United Airlines',
      departureTime: '14:00',
      arrivalTime: '17:15',
      duration: '5h 15m',
      price: 425,
      seatsAvailable: 12
    },
    {
      flightNumber: 'DL303',
      airline: 'Delta Airlines',
      departureTime: '19:00',
      arrivalTime: '22:30',
      duration: '5h 30m',
      price: 380,
      seatsAvailable: 8
    }
  ],
  'LAX-NYC': [
    {
      flightNumber: 'AA501',
      airline: 'American Airlines',
      departureTime: '06:00',
      arrivalTime: '14:30',
      duration: '5h 30m',
      price: 375,
      seatsAvailable: 32
    },
    {
      flightNumber: 'UA602',
      airline: 'United Airlines',
      departureTime: '13:00',
      arrivalTime: '21:15',
      duration: '5h 15m',
      price: 450,
      seatsAvailable: 5
    }
  ]
};

// ========== Validators ==========

const flightSearchValidator = createObjectValidator<FlightSearchParams>(
  {
    origin: stringSchema({ description: 'Origin airport code' }),
    destination: stringSchema({ description: 'Destination airport code' }),
    departureDate: stringSchema({ description: 'Departure date (YYYY-MM-DD)' }),
    returnDate: stringSchema({ description: 'Return date (YYYY-MM-DD)' }),
    passengers: numberSchema({ description: 'Number of passengers' }),
    class: stringSchema({ 
      description: 'Travel class',
      enum: ['economy', 'business', 'first']
    })
  },
  ['origin', 'destination', 'departureDate', 'passengers', 'class']
);

// ========== Tools ==========

const searchFlightsTool = createFunctionTool({
  name: 'search_flights',
  description: 'Search for available flights',
  execute: async (params) => {
    const validation = flightSearchValidator.validate(params);
    
    if (!validation.success) {
      throw new Error(`Invalid search parameters: ${validation.errors?.join(', ')}`);
    }

    const searchParams = validation.data!;
    const routeKey = `${searchParams.origin}-${searchParams.destination}`;
    const flights = mockFlights[routeKey] || [];

    // Filter by class and available seats
    const availableFlights = flights.filter(flight => 
      flight.seatsAvailable >= searchParams.passengers
    );

    // Adjust prices based on class
    const classMultiplier = {
      economy: 1,
      business: 2.5,
      first: 4
    }[searchParams.class];

    const adjustedFlights = availableFlights.map(flight => ({
      ...flight,
      price: Math.round(flight.price * classMultiplier),
      class: searchParams.class
    }));

    return {
      origin: searchParams.origin,
      destination: searchParams.destination,
      departureDate: searchParams.departureDate,
      flights: adjustedFlights,
      message: adjustedFlights.length > 0 
        ? `Found ${adjustedFlights.length} flights` 
        : 'No flights available for this route'
    };
  },
  parameters: [
    {
      name: 'origin',
      type: ToolParameterType.STRING,
      description: 'Origin airport code (e.g., NYC, LAX)',
      required: true
    },
    {
      name: 'destination',
      type: ToolParameterType.STRING,
      description: 'Destination airport code',
      required: true
    },
    {
      name: 'departureDate',
      type: ToolParameterType.STRING,
      description: 'Departure date in YYYY-MM-DD format',
      required: true
    },
    {
      name: 'returnDate',
      type: ToolParameterType.STRING,
      description: 'Return date in YYYY-MM-DD format (for round trips)',
      required: false
    },
    {
      name: 'passengers',
      type: ToolParameterType.NUMBER,
      description: 'Number of passengers',
      required: true
    },
    {
      name: 'class',
      type: ToolParameterType.STRING,
      description: 'Travel class (economy, business, first)',
      required: true
    }
  ]
});

const checkSeatAvailabilityTool = createFunctionTool({
  name: 'check_seat_availability',
  description: 'Check real-time seat availability for a specific flight',
  execute: async (params) => {
    const { flightNumber, passengers } = params as { flightNumber: string; passengers: number };
    
    // Find the flight in mock data
    let flight: FlightOption | undefined;
    for (const route of Object.values(mockFlights)) {
      flight = route.find(f => f.flightNumber === flightNumber);
      if (flight) break;
    }

    if (!flight) {
      return {
        available: false,
        message: 'Flight not found'
      };
    }

    const available = flight.seatsAvailable >= passengers;
    
    return {
      flightNumber,
      available,
      seatsAvailable: flight.seatsAvailable,
      requestedSeats: passengers,
      message: available 
        ? `${flight.seatsAvailable} seats available on ${flightNumber}`
        : `Only ${flight.seatsAvailable} seats available, but ${passengers} requested`
    };
  },
  parameters: [
    {
      name: 'flightNumber',
      type: ToolParameterType.STRING,
      description: 'Flight number to check',
      required: true
    },
    {
      name: 'passengers',
      type: ToolParameterType.NUMBER,
      description: 'Number of seats needed',
      required: true
    }
  ]
});

const calculatePriceTool = createFunctionTool({
  name: 'calculate_price',
  description: 'Calculate total price including taxes and fees',
  execute: async (params) => {
    const { basePrice, passengers, includeInsurance, includeBaggage } = params as {
      basePrice: number;
      passengers: number;
      includeInsurance?: boolean;
      includeBaggage?: boolean;
    };

    const subtotal = basePrice * passengers;
    const taxes = subtotal * 0.15; // 15% taxes
    const bookingFee = 25 * passengers;
    
    let extras = 0;
    if (includeInsurance) {
      extras += 50 * passengers;
    }
    if (includeBaggage) {
      extras += 30 * passengers;
    }

    const total = subtotal + taxes + bookingFee + extras;

    return {
      breakdown: {
        subtotal,
        taxes,
        bookingFee,
        insurance: includeInsurance ? 50 * passengers : 0,
        baggage: includeBaggage ? 30 * passengers : 0,
        total
      },
      formattedTotal: `$${total.toFixed(2)}`,
      perPerson: `$${(total / passengers).toFixed(2)}`
    };
  },
  parameters: [
    {
      name: 'basePrice',
      type: ToolParameterType.NUMBER,
      description: 'Base price per ticket',
      required: true
    },
    {
      name: 'passengers',
      type: ToolParameterType.NUMBER,
      description: 'Number of passengers',
      required: true
    },
    {
      name: 'includeInsurance',
      type: ToolParameterType.BOOLEAN,
      description: 'Include travel insurance',
      required: false,
      default: false
    },
    {
      name: 'includeBaggage',
      type: ToolParameterType.BOOLEAN,
      description: 'Include checked baggage',
      required: false,
      default: false
    }
  ]
});

const bookFlightTool = createFunctionTool({
  name: 'book_flight',
  description: 'Book a flight (mock booking)',
  execute: async (params) => {
    const bookingData = params as {
      flightNumber: string;
      passengers: Array<{
        firstName: string;
        lastName: string;
        email: string;
        dateOfBirth: string;
      }>;
      paymentMethod: string;
    };

    // Generate booking confirmation
    const confirmationNumber = `BK${Date.now().toString().slice(-8)}`;
    const bookingTime = new Date().toISOString();

    return {
      success: true,
      confirmationNumber,
      bookingTime,
      flightNumber: bookingData.flightNumber,
      passengers: bookingData.passengers.map(p => ({
        name: `${p.firstName} ${p.lastName}`,
        email: p.email
      })),
      status: 'confirmed',
      message: `Booking confirmed! Your confirmation number is ${confirmationNumber}`,
      emailSent: true
    };
  },
  parameters: [
    {
      name: 'flightNumber',
      type: ToolParameterType.STRING,
      description: 'Flight number to book',
      required: true
    },
    {
      name: 'passengers',
      type: ToolParameterType.ARRAY,
      description: 'Passenger information',
      required: true
    },
    {
      name: 'paymentMethod',
      type: ToolParameterType.STRING,
      description: 'Payment method',
      required: true
    }
  ]
});

// ========== Create Flight Booking Agent ==========

export const createFlightBookingAgent = () => {
  const agent = createAgent({
    name: 'flight_booking_agent',
    model: Model.GEMINI_2_0_FLASH,
    instruction: `You are a professional flight booking assistant. Help customers find and book flights.

Your capabilities:
1. Search for flights between cities
2. Check seat availability
3. Calculate total prices including taxes and fees
4. Book flights for passengers

When helping customers:
- Always confirm the travel dates and number of passengers
- Provide multiple flight options when available
- Explain pricing clearly including all fees
- Confirm passenger details before booking
- Be helpful and professional

Available routes in the system:
- NYC to LAX
- LAX to NYC

Use the tools to help customers with their flight booking needs.`,
    tools: [
      searchFlightsTool,
      checkSeatAvailabilityTool,
      calculatePriceTool,
      bookFlightTool
    ]
  });

  const sessionProvider = createInMemorySessionProvider();
  const runnerConfig = createRunnerConfig(agent, sessionProvider);

  return { agent, sessionProvider, runnerConfig };
};

// ========== Quick Setup Helper ==========

export const createQuickFlightAgent = () => {
  return quickSetup(
    'flight_assistant',
    Model.GEMINI_2_0_FLASH,
    'You are a flight booking assistant. Help users search and book flights between NYC and LAX.',
    [searchFlightsTool, checkSeatAvailabilityTool, calculatePriceTool, bookFlightTool]
  );
};

// ========== Example Usage ==========

async function runFlightBookingExample() {
  console.log('=== Flight Booking Agent Example ===\n');

  const { runnerConfig } = createFlightBookingAgent();

  // Example 1: Search for flights
  console.log('1. Searching for flights:');
  const searchMessage = createUserMessage(
    'I need to fly from NYC to LAX on 2024-03-15. I need 2 economy seats.'
  );

  const searchResponse = await runAgent(runnerConfig, {
    userId: 'customer_123',
    sessionId: 'booking_session_1'
  }, searchMessage);

  console.log('Customer:', searchMessage.parts[0].text);
  console.log('Agent:', searchResponse.content.parts[0].text);

  // Example 2: Check availability and price
  console.log('\n2. Checking availability and price:');
  const priceMessage = createUserMessage(
    'I\'m interested in flight AA101. Can you check if it\'s available and give me the total price with insurance?'
  );

  const priceResponse = await runAgent(runnerConfig, {
    userId: 'customer_123',
    sessionId: 'booking_session_1'
  }, priceMessage);

  console.log('Customer:', priceMessage.parts[0].text);
  console.log('Agent:', priceResponse.content.parts[0].text);

  // Example 3: Book a flight
  console.log('\n3. Booking a flight:');
  const bookingMessage = createUserMessage(
    `I'd like to book flight AA101 for 2 passengers:
    1. John Doe, john@example.com, born 1985-06-15
    2. Jane Doe, jane@example.com, born 1987-09-20
    
    I'll pay with credit card.`
  );

  const bookingResponse = await runAgent(runnerConfig, {
    userId: 'customer_123',
    sessionId: 'booking_session_1'
  }, bookingMessage);

  console.log('Customer:', bookingMessage.parts[0].text);
  console.log('Agent:', bookingResponse.content.parts[0].text);
}

// Run example if this file is executed directly
if (require.main === module) {
  runFlightBookingExample().catch(console.error);
}

// ========== Export for Integration ==========

export {
  searchFlightsTool,
  checkSeatAvailabilityTool,
  calculatePriceTool,
  bookFlightTool,
  runFlightBookingExample
};