/**
 * Example client usage of A2A protocol with JAF agents
 * Demonstrates all client capabilities in a pure functional way
 */

import {
  createA2AClient,
  getAgentCard,
  sendMessageToAgent,
  streamMessageToAgent,
  checkA2AHealth,
  getA2ACapabilities,
  connectToA2AAgent,
} from '../client.js';

// Pure function to demonstrate basic client usage
export const demonstrateBasicUsage = async (serverUrl: string = 'http://localhost:3000') => {
  console.log('🔗 Creating A2A client...');
  const client = createA2AClient(serverUrl);
  
  console.log(`📱 Client created with session ID: ${client.sessionId}`);
  
  try {
    // Test agent discovery
    console.log('\n🔍 Discovering agents...');
    const agentCard = await getAgentCard(client);
    console.log(`🤖 Found agent: ${agentCard.name}`);
    console.log(`📝 Description: ${agentCard.description}`);
    console.log(`🎯 Skills: ${agentCard.skills.map(s => s.name).join(', ')}`);
    
    // Test health check
    console.log('\n🏥 Checking server health...');
    const health = await checkA2AHealth(client);
    console.log(`✅ Status: ${health.status}`);
    console.log(`🤖 Available agents: ${health.agents.join(', ')}`);
    
    // Test capabilities
    console.log('\n⚡ Getting server capabilities...');
    const capabilities = await getA2ACapabilities(client);
    console.log(`📋 Supported methods: ${capabilities.supportedMethods.join(', ')}`);
    console.log(`🔧 Input modes: ${capabilities.inputModes.join(', ')}`);
    
    return { client, agentCard, health, capabilities };
  } catch (error) {
    console.error('❌ Error in basic usage:', error);
    throw error;
  }
};

// Pure function to demonstrate weather agent interaction
export const demonstrateWeatherAgent = async (serverUrl: string = 'http://localhost:3000') => {
  console.log('\n🌤️ Testing Weather Agent...');
  const client = createA2AClient(serverUrl);
  
  try {
    // Simple weather query
    console.log('\n📍 Getting weather for Tokyo...');
    const tokyoWeather = await sendMessageToAgent(client, 'weather', 'What\'s the weather in Tokyo?');
    console.log('🌡️ Response:', tokyoWeather);
    
    // Weather with hourly forecast
    console.log('\n📊 Getting detailed weather for London...');
    const londonWeather = await sendMessageToAgent(
      client, 
      'weather', 
      'Get weather for London with hourly forecast in Fahrenheit'
    );
    console.log('📈 Response:', londonWeather);
    
    // Travel planning
    console.log('\n✈️ Starting travel planning...');
    const travelResponse = await sendMessageToAgent(
      client, 
      'weather', 
      'I want to plan a trip to Paris next week, can you help me with weather and planning?'
    );
    console.log('🗺️ Response:', travelResponse);
    
    return { tokyoWeather, londonWeather, travelResponse };
  } catch (error) {
    console.error('❌ Error testing weather agent:', error);
    throw error;
  }
};

// Pure function to demonstrate calculator agent interaction
export const demonstrateCalculatorAgent = async (serverUrl: string = 'http://localhost:3000') => {
  console.log('\n🔢 Testing Calculator Agent...');
  const client = createA2AClient(serverUrl);
  
  try {
    // Basic calculation
    console.log('\n➕ Basic calculation...');
    const basicCalc = await sendMessageToAgent(client, 'calculator', 'Calculate 15 * 23 + 7');
    console.log('🔢 Result:', basicCalc);
    
    // Calculation with steps
    console.log('\n📋 Calculation with steps...');
    const stepsCalc = await sendMessageToAgent(
      client, 
      'calculator', 
      'Calculate (45 + 15) * 2 / 3 and show me the steps'
    );
    console.log('📊 Result:', stepsCalc);
    
    // Equation solving
    console.log('\n🎯 Equation solving...');
    const equation = await sendMessageToAgent(
      client, 
      'calculator', 
      'Solve the equation 2x + 5 = 15'
    );
    console.log('🔍 Result:', equation);
    
    return { basicCalc, stepsCalc, equation };
  } catch (error) {
    console.error('❌ Error testing calculator agent:', error);
    throw error;
  }
};

// Pure function to demonstrate streaming
export const demonstrateStreaming = async (serverUrl: string = 'http://localhost:3000') => {
  console.log('\n🌊 Testing Streaming...');
  const client = createA2AClient(serverUrl);
  
  try {
    console.log('📡 Starting streaming request to weather agent...');
    
    const events: any[] = [];
    for await (const event of streamMessageToAgent(
      client, 
      'weather', 
      'Plan a detailed trip to Barcelona with weather considerations'
    )) {
      console.log(`📺 Stream event:`, event);
      events.push(event);
      
      // Stop after reasonable number of events for demo
      if (events.length >= 5) {
        break;
      }
    }
    
    console.log(`✅ Received ${events.length} streaming events`);
    return events;
  } catch (error) {
    console.error('❌ Error testing streaming:', error);
    throw error;
  }
};

// Pure function to demonstrate multi-agent conversation
export const demonstrateMultiAgentConversation = async (serverUrl: string = 'http://localhost:3000') => {
  console.log('\n🔄 Testing Multi-Agent Conversation...');
  const client = createA2AClient(serverUrl);
  
  try {
    // Start with greeting agent
    console.log('\n👋 Getting introduction...');
    const introduction = await sendMessageToAgent(
      client, 
      'greeting', 
      'Hello! My name is Alex and I need help planning a trip.'
    );
    console.log('🗣️ Greeting:', introduction);
    
    // Switch to weather agent for weather info
    console.log('\n🌤️ Checking weather...');
    const weatherInfo = await sendMessageToAgent(
      client, 
      'weather', 
      'What\'s the weather like in Amsterdam this week?'
    );
    console.log('🌡️ Weather:', weatherInfo);
    
    // Use calculator for budget calculations
    console.log('\n💰 Calculating budget...');
    const budgetCalc = await sendMessageToAgent(
      client, 
      'calculator', 
      'If I have 1500 euros and daily expenses are 120 euros, how many days can I stay?'
    );
    console.log('💵 Budget:', budgetCalc);
    
    // Back to weather agent for travel planning
    console.log('\n📅 Final travel planning...');
    const travelPlan = await sendMessageToAgent(
      client, 
      'weather', 
      'Based on Amsterdam weather, help me plan a 7-day trip with budget considerations'
    );
    console.log('🗓️ Travel Plan:', travelPlan);
    
    return { introduction, weatherInfo, budgetCalc, travelPlan };
  } catch (error) {
    console.error('❌ Error in multi-agent conversation:', error);
    throw error;
  }
};

// Pure function to demonstrate the convenience API
export const demonstrateConvenienceAPI = async (serverUrl: string = 'http://localhost:3000') => {
  console.log('\n🚀 Testing Convenience API...');
  
  try {
    // Connect to agent with convenience wrapper
    const weatherAgent = await connectToA2AAgent(`${serverUrl}/a2a/agents/weather`);
    
    console.log('🤖 Connected to weather agent');
    console.log(`📝 Agent: ${weatherAgent.agentCard.name}`);
    
    // Use simplified API
    console.log('\n❓ Asking simple question...');
    const response = await weatherAgent.ask('What\'s the weather in Madrid?');
    console.log('💬 Response:', response);
    
    // Check agent health
    console.log('\n🏥 Checking agent health...');
    const health = await weatherAgent.health();
    console.log('✅ Health:', health);
    
    // Get capabilities
    console.log('\n⚡ Getting capabilities...');
    const capabilities = await weatherAgent.capabilities();
    console.log('🔧 Capabilities:', capabilities);
    
    return { weatherAgent, response, health, capabilities };
  } catch (error) {
    console.error('❌ Error testing convenience API:', error);
    throw error;
  }
};

// Pure function to run all demonstrations
export const runAllDemonstrations = async (serverUrl: string = 'http://localhost:3000') => {
  console.log('🎬 Starting A2A Client Demonstrations');
  console.log('=====================================\n');
  
  try {
    // Test server availability first
    const basic = await demonstrateBasicUsage(serverUrl);
    
    // Run all demonstrations
    const weather = await demonstrateWeatherAgent(serverUrl);
    const calculator = await demonstrateCalculatorAgent(serverUrl);
    const streaming = await demonstrateStreaming(serverUrl);
    const multiAgent = await demonstrateMultiAgentConversation(serverUrl);
    const convenience = await demonstrateConvenienceAPI(serverUrl);
    
    console.log('\n🎉 All demonstrations completed successfully!');
    
    return {
      basic,
      weather,
      calculator,
      streaming,
      multiAgent,
      convenience
    };
  } catch (error) {
    console.error('\n💥 Demonstration failed:', error);
    console.log('\n💡 Make sure the A2A server is running on', serverUrl);
    console.log('   You can start it with: npm run a2a:example');
    throw error;
  }
};

// Pure function for interactive demonstration
export const runInteractiveDemo = async (serverUrl: string = 'http://localhost:3000') => {
  const client = createA2AClient(serverUrl);
  
  console.log('🎮 Interactive A2A Demo');
  console.log('Type your messages and see A2A protocol in action!');
  console.log('Commands: /weather <msg>, /calc <msg>, /greeting <msg>, /quit\n');
  
  // This would typically use readline in a real implementation
  // For demo purposes, we'll simulate some interactions
  const sampleInteractions = [
    { agent: 'greeting', message: 'Hello! I\'m new here.' },
    { agent: 'weather', message: 'What\'s the weather in San Francisco?' },
    { agent: 'calculator', message: 'Calculate 42 * 1.5 + 18' },
    { agent: 'weather', message: 'Plan a trip to Tokyo' }
  ];
  
  for (const interaction of sampleInteractions) {
    console.log(`\n👤 User to ${interaction.agent}: ${interaction.message}`);
    
    try {
      const response = await sendMessageToAgent(client, interaction.agent, interaction.message);
      console.log(`🤖 ${interaction.agent} agent: ${response.substring(0, 200)}${response.length > 200 ? '...' : ''}`);
    } catch (error) {
      console.log(`❌ Error: ${error}`);
    }
    
    // Simulate thinking time
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n✅ Interactive demo completed!');
};

// Run demonstrations if this file is executed directly
if (typeof require !== 'undefined' && require.main === module) {
  const serverUrl = process.argv[2] || 'http://localhost:3000';
  
  runAllDemonstrations(serverUrl)
    .then(() => {
      console.log('\n🏁 All demonstrations completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Demonstrations failed:', error);
      process.exit(1);
    });
}