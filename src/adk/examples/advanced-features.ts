/**
 * FAF ADK Layer - Advanced Features Example
 * 
 * Demonstrates schema validation, guardrails, streaming, and other advanced features
 */

import {
  createAgent,
  createFunctionTool,
  createInMemorySessionProvider,
  createRunnerConfig,
  runAgent,
  runAgentStream,
  createUserMessage,
  createObjectValidator,
  stringSchema,
  numberSchema,
  booleanSchema,
  weatherQueryValidator,
  weatherResponseValidator,
  createAgentEvent,
  createLiveRequestQueue,
  streamToQueue,
  monitorStream,
  logStream,
  metricsMonitor,
  GuardrailFunction,
  Content,
  Agent,
  RunnerConfig,
  SessionProvider,
  Model,
  ToolParameterType
} from '../index';

// ========== Schema Validation Example ==========

// Custom schema for booking requests
interface BookingRequest extends Record<string, unknown> {
  customerName: string;
  serviceType: 'consultation' | 'maintenance' | 'repair';
  preferredDate: string;
  duration: number;
  urgent: boolean;
  contactInfo: {
    email: string;
    phone: string;
  };
}

const bookingRequestValidator = createObjectValidator<BookingRequest>(
  {
    customerName: stringSchema({ description: 'Customer full name' }),
    serviceType: stringSchema({ 
      description: 'Type of service requested',
      enum: ['consultation', 'maintenance', 'repair']
    }),
    preferredDate: stringSchema({ description: 'Preferred appointment date (YYYY-MM-DD)' }),
    duration: numberSchema({ description: 'Expected duration in hours' }),
    urgent: booleanSchema({ description: 'Whether this is an urgent request' }),
    contactInfo: {
      type: 'object',
      properties: {
        email: stringSchema({ description: 'Customer email address' }),
        phone: stringSchema({ description: 'Customer phone number' })
      },
      required: ['email', 'phone']
    }
  },
  ['customerName', 'serviceType', 'preferredDate', 'duration', 'urgent', 'contactInfo']
);

// ========== Guardrails Example ==========

const contentModerationGuardrail: GuardrailFunction = async (message) => {
  const messageText = message.parts
    .filter(p => p.type === 'text')
    .map(p => p.text)
    .join(' ')
    .toLowerCase();

  // Check for inappropriate content
  const blockedWords = ['spam', 'scam', 'inappropriate'];
  const containsBlockedContent = blockedWords.some(word => messageText.includes(word));

  if (containsBlockedContent) {
    return {
      allowed: false,
      reason: 'Content contains inappropriate language',
      action: 'block'
    };
  }

  // Check for excessive length
  if (messageText.length > 1000) {
    return {
      allowed: true,
      modifiedMessage: {
        ...message,
        parts: [{
          type: 'text',
          text: messageText.substring(0, 1000) + '... [truncated]'
        }]
      },
      reason: 'Message truncated due to length',
      action: 'modify'
    };
  }

  return { allowed: true };
};

const rateLimitGuardrail: GuardrailFunction = async (_message, context) => {
  // Simple rate limiting based on session message count
  const messageCount = context.session.messages.length;
  
  if (messageCount > 10) {
    return {
      allowed: false,
      reason: 'Rate limit exceeded - too many messages in this session',
      action: 'block'
    };
  }

  return { allowed: true };
};

// ========== Advanced Agent with Schema Validation ==========

export const createBookingAgent = () => {
  const processBookingTool = createFunctionTool({
    name: 'process_booking',
    description: 'Process a service booking request with validation',
    execute: (params: unknown) => {
      // Validate input using schema
      const validation = bookingRequestValidator.validate(params);
      
      if (!validation.success) {
        throw new Error(`Invalid booking request: ${validation.errors?.join(', ')}`);
      }

      const booking = validation.data!;
      
      // Process the booking
      const bookingId = `BK${Date.now()}`;
      const estimatedCost = {
        consultation: 100,
        maintenance: 150,
        repair: 200
      }[booking.serviceType] * booking.duration;

      return {
        bookingId,
        status: 'confirmed',
        customer: booking.customerName,
        service: booking.serviceType,
        scheduledDate: booking.preferredDate,
        duration: booking.duration,
        estimatedCost,
        priority: booking.urgent ? 'high' : 'normal',
        contactMethod: 'email'
      };
    },
    parameters: [
      {
        name: 'customerName',
        type: ToolParameterType.STRING,
        description: 'Customer full name',
        required: true
      },
      {
        name: 'serviceType',
        type: ToolParameterType.STRING,
        description: 'Type of service (consultation, maintenance, repair)',
        required: true
      },
      {
        name: 'preferredDate',
        type: ToolParameterType.STRING,
        description: 'Preferred date in YYYY-MM-DD format',
        required: true
      },
      {
        name: 'duration',
        type: ToolParameterType.NUMBER,
        description: 'Duration in hours',
        required: true
      },
      {
        name: 'urgent',
        type: ToolParameterType.BOOLEAN,
        description: 'Whether this is urgent',
        required: true
      },
      {
        name: 'contactInfo',
        type: ToolParameterType.OBJECT,
        description: 'Customer contact information',
        required: true
      }
    ]
  });

  const agent = createAgent({
    name: 'booking_agent',
    model: Model.GEMINI_2_0_FLASH,
    instruction: `You are a professional booking assistant. Help customers schedule services.
    
    When processing bookings:
    1. Collect all required information
    2. Validate the booking details
    3. Use the process_booking tool to create the booking
    4. Confirm details with the customer
    
    Required information:
    - Customer name
    - Service type (consultation, maintenance, or repair)
    - Preferred date
    - Duration in hours
    - Urgency level
    - Contact information (email and phone)`,
    tools: [processBookingTool],
    inputSchema: weatherQueryValidator, // Example of input validation
    outputSchema: weatherResponseValidator, // Example of output validation
    guardrails: [contentModerationGuardrail, rateLimitGuardrail]
  });

  const sessionProvider = createInMemorySessionProvider();
  const runnerConfig = createRunnerConfig(agent, sessionProvider, {
    guardrails: [contentModerationGuardrail, rateLimitGuardrail],
    maxLLMCalls: 5,
    timeout: 30000
  });

  return { agent, sessionProvider, runnerConfig };
};

// ========== Streaming with Monitoring Example ==========

export const createStreamingAgent = () => {
  const storyTool = createFunctionTool({
    name: 'generate_story_part',
    description: 'Generate part of a story',
    execute: (params) => {
      const { theme, character, setting } = params as { theme: string; character: string; setting: string };
      const storyParts = [
        `In the ${setting}, ${character} discovered something extraordinary about ${theme}.`,
        `The ${theme} seemed to pulse with an otherworldly energy as ${character} approached.`,
        `${character} realized that ${theme} held the key to understanding the mysteries of ${setting}.`,
        `As the sun set over ${setting}, ${character} made a decision that would change everything about ${theme}.`,
        `The adventure continued as ${character} ventured deeper into the secrets of ${theme} within ${setting}.`
      ];
      
      return {
        part: storyParts[Math.floor(Math.random() * storyParts.length)],
        theme,
        character,
        setting,
        timestamp: new Date().toISOString()
      };
    },
    parameters: [
      {
        name: 'theme',
        type: ToolParameterType.STRING,
        description: 'Story theme or topic',
        required: true
      },
      {
        name: 'character',
        type: ToolParameterType.STRING,
        description: 'Main character name',
        required: true
      },
      {
        name: 'setting',
        type: ToolParameterType.STRING,
        description: 'Story setting or location',
        required: true
      }
    ]
  });

  const agent = createAgent({
    name: 'streaming_storyteller',
    model: Model.GEMINI_2_0_FLASH,
    instruction: `You are an interactive storyteller. Create engaging stories using the generate_story_part tool.
    Build stories progressively, creating suspense and engaging narratives.`,
    tools: [storyTool]
  });

  const sessionProvider = createInMemorySessionProvider();
  const runnerConfig = createRunnerConfig(agent, sessionProvider);

  return { agent, sessionProvider, runnerConfig };
};

// ========== Example Usage Functions ==========

export async function runSchemaValidationExample() {
  console.log('=== FAF ADK Layer - Schema Validation Example ===\n');

  const { runnerConfig } = createBookingAgent();

  // Test valid booking request
  console.log('1. Valid Booking Request:');
  const validBookingMessage = createUserMessage(`
    I need to book a repair service for next week. 
    My name is John Smith, I need a 3-hour repair on 2024-02-15.
    It's urgent. My email is john@example.com and phone is 555-0123.
  `);

  try {
    const response = await runAgent(runnerConfig, {
      userId: 'user_123',
      sessionId: 'booking_session_1'
    }, validBookingMessage);

    console.log('User:', validBookingMessage.parts[0].text);
    console.log('Agent:', response.content.parts[0].text);
  } catch (error) {
    console.log('Error:', (error as Error).message);
  }

  // Test invalid booking request (blocked by guardrail)
  console.log('\n2. Blocked Request (Guardrail):');
  const blockedMessage = createUserMessage('This is spam content that should be blocked');

  try {
    const response = await runAgent(runnerConfig, {
      userId: 'user_123',
      sessionId: 'booking_session_2'
    }, blockedMessage);

    console.log('User:', blockedMessage.parts[0].text);
    console.log('Agent:', response.content.parts[0].text);
  } catch (error) {
    console.log('Blocked by guardrail:', (error as Error).message);
  }
}

export async function runStreamingWithMonitoringExample() {
  console.log('\n=== FAF ADK Layer - Streaming with Monitoring Example ===\n');

  const { runnerConfig } = createStreamingAgent();

  const message = createUserMessage('Tell me a story about a brave knight named Arthur in a mystical forest');

  console.log('User:', message.parts[0].text);
  console.log('Agent (streaming with monitoring):');

  // Create monitoring
  const metrics = metricsMonitor();
  
  const events = runAgentStream(runnerConfig, {
    userId: 'user_123',
    sessionId: 'streaming_session'
  }, message);

  // Add monitoring to the stream
  const monitoredStream = monitorStream(events, (event) => {
    metrics.monitor(event);
    
    // Log important events
    if (event.type === 'function_call_start') {
      console.log(`\n[FUNCTION CALL] ${event.functionCall?.name}`);
    } else if (event.type === 'function_call_complete') {
      console.log(`[FUNCTION COMPLETE] ${event.functionResponse?.name}`);
    }
  });

  let messageContent = '';
  
  for await (const event of monitoredStream) {
    if (event.type === 'message_delta' && event.content) {
      const text = event.content.parts[0].text || '';
      messageContent += text;
      process.stdout.write(text);
    } else if (event.type === 'message_complete') {
      console.log('\n[Stream complete]');
      break;
    } else if (event.type === 'error') {
      console.log('\n[Error]:', event.error);
      break;
    }
  }

  // Show metrics
  console.log('\nStream Metrics:', metrics.getMetrics());
}

export async function runAdvancedStreamingExample() {
  console.log('\n=== FAF ADK Layer - Advanced Streaming Features ===\n');

  // Create a live request queue
  const queue = createLiveRequestQueue();

  // Simulate incoming messages
  setTimeout(async () => {
    await queue.enqueue(createUserMessage('Start the story'));
    await queue.enqueue(createUserMessage('Continue with action'));
    await queue.enqueue(createUserMessage('Add a plot twist'));
    queue.close();
  }, 100);

  console.log('Processing queued messages:');

  // Process messages from queue
  let isQueueActive = true;
  while (isQueueActive) {
    const message = await queue.dequeue();
    
    if (!message) {
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }

    console.log('Processing:', message.parts[0].text);
    
    if (queue.isEmpty()) {
      isQueueActive = false;
      break;
    }
  }

  console.log('Queue processing complete');
}

export async function runLiveStreamingExample() {
  console.log('\n=== FAF ADK Layer - Live Streaming Simulation ===\n');

  // Simulate a live streaming scenario
  async function* mockAgentStream() {
    const responses = [
      'Hello! I\'m ready to help you.',
      'What would you like to know?',
      'I can assist with various tasks.',
      'Feel free to ask me anything!'
    ];

    for (const response of responses) {
      // Simulate typing delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      yield createAgentEvent('message_delta', {
        content: createUserMessage(response)
      });
    }

    yield createAgentEvent('message_complete');
  }

  console.log('Live streaming simulation:');

  const stream = mockAgentStream();
  
  for await (const event of stream) {
    if (event.type === 'message_delta' && event.content) {
      console.log('→', event.content.parts[0].text);
    } else if (event.type === 'message_complete') {
      console.log('[Stream ended]');
    }
  }
}

// ========== Main Example Runner ==========

export async function runAllAdvancedExamples() {
  try {
    await runSchemaValidationExample();
    await runStreamingWithMonitoringExample();
    await runAdvancedStreamingExample();
    await runLiveStreamingExample();
    
    console.log('\n=== All advanced examples completed successfully! ===');
  } catch (error) {
    console.error('Advanced example failed:', error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runAllAdvancedExamples();
}