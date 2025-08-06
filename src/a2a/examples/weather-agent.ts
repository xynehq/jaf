/**
 * Example Weather Agent using pure functional A2A integration
 * Demonstrates how to create A2A-compatible agents with JAF
 */

import { z } from 'zod';
import { createA2AAgent, createA2ATool } from '../agent.js';
import type { ToolContext, A2AToolResult } from '../types.js';

// Pure function to create weather lookup tool
const createWeatherTool = () => createA2ATool({
  name: 'get_weather',
  description: 'Get current weather information for any location',
  parameters: z.object({
    location: z.string().describe('City name, coordinates, or address'),
    units: z.enum(['celsius', 'fahrenheit']).default('celsius').describe('Temperature units'),
    includeHourly: z.boolean().default(false).describe('Include hourly forecast')
  }),
  execute: async ({ location, units, includeHourly }) => {
    // Simulate weather API call
    const weatherData = {
      location,
      current: {
        temperature: units === 'celsius' ? 22 : 72,
        condition: 'sunny',
        humidity: 45,
        windSpeed: units === 'celsius' ? '15 km/h' : '9 mph'
      },
      forecast: includeHourly ? [
        { time: '12:00', temp: units === 'celsius' ? 24 : 75, condition: 'sunny' },
        { time: '13:00', temp: units === 'celsius' ? 26 : 79, condition: 'partly cloudy' },
        { time: '14:00', temp: units === 'celsius' ? 25 : 77, condition: 'cloudy' }
      ] : undefined
    };
    
    let response = `Weather in ${location}:\n`;
    response += `🌡️ Temperature: ${weatherData.current.temperature}°${units === 'celsius' ? 'C' : 'F'}\n`;
    response += `☀️ Condition: ${weatherData.current.condition}\n`;
    response += `💧 Humidity: ${weatherData.current.humidity}%\n`;
    response += `💨 Wind: ${weatherData.current.windSpeed}`;
    
    if (includeHourly && weatherData.forecast) {
      response += '\n\nHourly Forecast:\n';
      weatherData.forecast.forEach(hour => {
        response += `${hour.time}: ${hour.temp}°${units === 'celsius' ? 'C' : 'F'} - ${hour.condition}\n`;
      });
    }
    
    return response;
  }
});

// Pure function to create travel planning form tool
const createTravelFormTool = () => createA2ATool({
  name: 'create_travel_form',
  description: 'Create a travel planning form based on weather information',
  parameters: z.object({
    destination: z.string().optional().describe('Travel destination'),
    dates: z.string().optional().describe('Travel dates'),
    budget: z.string().optional().describe('Budget amount'),
    weatherContext: z.string().optional().describe('Current weather context')
  }),
  execute: async ({ destination, dates, budget, weatherContext }) => {
    const formId = `travel_${Date.now()}`;
    
    return {
      form_id: formId,
      destination: destination || '<destination>',
      dates: dates || '<travel dates>',
      budget: budget || '<budget amount>',
      weather_context: weatherContext || 'No weather context provided'
    };
  }
});

// Pure function to create form return tool
const createReturnFormTool = () => createA2ATool({
  name: 'return_form',
  description: 'Return a structured form for user input',
  parameters: z.object({
    formData: z.record(z.any()).describe('Form data structure'),
    instructions: z.string().optional().describe('Instructions for the user')
  }),
  execute: async ({ formData, instructions }, context?: ToolContext): Promise<A2AToolResult> => {
    const newContext: ToolContext = {
      actions: {
        requiresInput: true,
        skipSummarization: true,
        escalate: false
      },
      metadata: context?.metadata || {}
    };
    
    const formSchema = {
      type: 'form',
      form: {
        type: 'object',
        properties: {
          destination: {
            type: 'string',
            description: 'Travel destination',
            title: 'Destination'
          },
          dates: {
            type: 'string',
            description: 'Travel dates (e.g., "2024-03-15 to 2024-03-22")',
            title: 'Travel Dates'
          },
          budget: {
            type: 'number',
            description: 'Budget in USD',
            title: 'Budget ($)'
          },
          weather_context: {
            type: 'string',
            description: 'Weather information context',
            title: 'Weather Context',
            readOnly: true
          }
        },
        required: ['destination', 'dates', 'budget']
      },
      form_data: formData,
      instructions: instructions || 'Please fill out the travel planning form below.'
    };
    
    return {
      result: JSON.stringify(formSchema),
      context: newContext
    };
  }
});

// Pure function to create trip planning tool
const createTripPlanningTool = () => createA2ATool({
  name: 'plan_trip',
  description: 'Create a trip plan based on form data and weather',
  parameters: z.object({
    formId: z.string().describe('Form ID reference'),
    destination: z.string().describe('Travel destination'),
    dates: z.string().describe('Travel dates'),
    budget: z.number().describe('Budget amount'),
    weatherContext: z.string().optional().describe('Weather context')
  }),
  execute: async ({ formId, destination, dates, budget, weatherContext }) => {
    // Simulate trip planning logic
    const plan = {
      form_id: formId,
      status: 'approved',
      trip_plan: {
        destination,
        dates,
        budget,
        recommendations: [
          '🏨 Hotel recommendations based on weather',
          '🎯 Activities suitable for current conditions',
          '🧳 Packing suggestions for the weather',
          '🚗 Transportation options',
          '🍽️ Restaurant recommendations'
        ],
        weather_advice: weatherContext || 'Check weather before departure',
        estimated_cost: Math.min(budget * 0.9, budget - 100),
        created_at: new Date().toISOString()
      }
    };
    
    return `✅ Trip Plan Created!\n\n` +
           `📍 Destination: ${destination}\n` +
           `📅 Dates: ${dates}\n` +
           `💰 Budget: $${budget}\n\n` +
           `🌤️ Weather Advice: ${plan.trip_plan.weather_advice}\n\n` +
           `📋 Recommendations:\n` +
           plan.trip_plan.recommendations.map(rec => `  ${rec}`).join('\n') + '\n\n' +
           `💵 Estimated Cost: $${plan.trip_plan.estimated_cost}\n` +
           `📋 Plan ID: ${formId}`;
  }
});

// Pure function to create weather assistance tool
const createWeatherAssistanceTool = () => createA2ATool({
  name: 'provide_weather_assistance',
  description: 'Provide general weather assistance and guidance',
  parameters: z.object({
    query: z.string().describe('User\'s weather-related question'),
    context: z.string().optional().describe('Additional context')
  }),
  execute: async ({ query, context }) => {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('travel') || lowerQuery.includes('trip') || lowerQuery.includes('vacation')) {
      return 'I can help you plan weather-appropriate travel! I can check current weather conditions and help you create a travel plan. Would you like me to check the weather for your destination and create a travel planning form?';
    }
    
    if (lowerQuery.includes('what') && (lowerQuery.includes('weather') || lowerQuery.includes('temperature'))) {
      return 'I can look up current weather conditions for any location. Just tell me the city name, address, or coordinates and I\'ll get the latest weather information including temperature, conditions, humidity, and wind speed.';
    }
    
    if (lowerQuery.includes('forecast') || lowerQuery.includes('hourly')) {
      return 'I can provide hourly weather forecasts to help you plan your day. Just specify the location and I\'ll include hourly predictions in the weather report.';
    }
    
    return 'I\'m your weather assistant! I can:\n\n' +
           '🌤️ Get current weather for any location\n' +
           '📊 Provide hourly forecasts\n' +
           '✈️ Help plan weather-appropriate travel\n' +
           '📋 Create travel planning forms\n\n' +
           'Just ask me about weather conditions for any city, or let me know if you\'re planning a trip!';
  }
});

// Pure function to create the complete weather agent
export const createWeatherAgent = () => createA2AAgent({
  name: 'weather_assistant',
  description: 'Weather information and travel planning assistant',
  supportedContentTypes: ['text/plain', 'application/json'],
  
  instruction: `You are a helpful weather assistant with travel planning capabilities.

When users ask about weather:
1. Use get_weather() to fetch current conditions for any location
2. Include hourly forecasts if they ask for detailed information
3. Provide helpful context about what the weather means for activities

When users mention travel or trip planning:
1. Get weather information for their destination first
2. Use create_travel_form() to gather their travel details
3. Use return_form() to present the form for user input
4. Once they complete the form, use plan_trip() to create recommendations

For general questions, use provide_weather_assistance() to offer guidance.

Always be helpful, accurate, and consider how weather impacts daily activities and travel plans.`,

  tools: [
    createWeatherTool(),
    createTravelFormTool(),
    createReturnFormTool(),
    createTripPlanningTool(),
    createWeatherAssistanceTool()
  ]
});

// Pure function to get processing message for weather agent
export const getWeatherAgentProcessingMessage = () => 
  'Looking up weather information and processing your request...';

// Example usage data for testing
export const weatherAgentExamples = [
  'What\'s the weather like in Tokyo?',
  'I\'m planning a trip to Paris next week, what should I expect?',
  'Get weather for New York with hourly forecast',
  'Help me plan a vacation to Barcelona',
  'What\'s the temperature in London in Fahrenheit?',
  'I need weather information for my business trip to San Francisco'
] as const;