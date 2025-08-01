# Flight Booking Example

This example demonstrates how to use the FAF ADK (Agent Development Kit) to create a flight booking system with multiple agents and tools, integrated with FAF's built-in server.

## Overview

The example includes:
- Basic flight booking tools (search, availability, pricing, booking)
- Single agent implementation with all tools (`index.ts`)
- Multi-agent implementation with specialized agents (`multi-agent.ts`)
- FAF server integration with HTTP endpoints (`faf-server.ts`)

## Running the Example

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment**:
   ```bash
   # Copy the example environment file
   cp .env.example .env
   
   # Edit .env with your configuration
   # At minimum, ensure LITELLM_URL points to your LiteLLM server
   ```

3. **Run the FAF server**:
   ```bash
   npm run server
   ```

   The server will start on port 3001 with the following endpoints:
   - Health check: `http://localhost:3001/health`
   - List agents: `http://localhost:3001/agents`
   - Chat endpoint: `http://localhost:3001/chat`

## Testing the Server

### 1. Search for flights:
```bash
curl -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Find me flights from NYC to LAX tomorrow for 2 people in economy"}],
    "agentName": "FlightSearch",
    "context": {"userId": "customer123", "customerLevel": "standard"}
  }'
```

### 2. Complete booking flow:
```bash
curl -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "I need to book a flight from NYC to LAX for 2 passengers"}],
    "agentName": "FlightAssistant",
    "conversationId": "booking-123",
    "context": {"userId": "customer123"}
  }'
```

### 3. VIP customer service:
```bash
curl -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "I need your best flight options"}],
    "agentName": "FlightAssistant",
    "context": {"userId": "vip456", "customerLevel": "vip"}
  }'
```

## Architecture

The example shows how to:
- Create tools using the ADK's `createFunctionTool` with object-based configuration
- Convert ADK tools to FAF format using Zod schemas
- Build agents that use multiple tools
- Coordinate between specialized agents
- Integrate with FAF's server infrastructure
- Handle different customer levels (standard, premium, VIP)

## Available Agents

1. **FlightSearch**: Specialized in searching flights
2. **BookingAgent**: Handles availability checks, pricing, and bookings
3. **FlightAssistant**: Full-service agent with all capabilities

## Files

- `index.ts`: Core flight booking tools and single agent implementation
- `multi-agent.ts`: Multi-agent coordination example with specialized agents
- `faf-server.ts`: FAF server integration with HTTP endpoints

## Features

- **Flight Search**: Search for available flights between cities
- **Seat Availability**: Real-time seat availability checking
- **Price Calculation**: Calculate total price including taxes, fees, and extras
- **Flight Booking**: Complete booking with passenger information
- **Validation**: Input validation using FAF's schema validators
- **Type Safety**: Full TypeScript support with enums and structured types

## Example Flight Data

The system includes mock data for flights between:
- NYC ↔ LAX
- Only economy and business class available
- Multiple daily flights (AA101, UA202, DL303)

## Extending the Example

You can extend this example by:

1. **Adding More Routes**: Expand the mock flight data
2. **Implementing Real APIs**: Replace mock data with actual airline APIs
3. **Adding More Tools**: Seat selection, meal preferences, etc.
4. **Enhanced Validation**: Add more complex validation rules
5. **Multi-leg Flights**: Support connecting flights
6. **Cancellation/Modification**: Add booking management tools

## Notes

- This is a demonstration with mock data
- In production, integrate with real airline APIs
- Add proper error handling and retry logic
- Implement authentication and authorization
- Consider rate limiting and caching