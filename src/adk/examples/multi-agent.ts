/**
 * FAF ADK Layer - Multi-Agent Example
 * 
 * Demonstrates multi-agent coordination and delegation
 */

import {
  createAgent,
  createMultiAgent,
  createFunctionTool,
  createInMemorySessionProvider,
  createRunnerConfig,
  runAgent,
  createUserMessage,
  AgentConfig
} from '../index';

// ========== Specialized Agents ==========

export const createWeatherSpecialistAgent = (): AgentConfig => {
  const weatherTool = createFunctionTool(
    'get_weather',
    'Get current weather information',
    (params, context) => {
      const { location } = params as { location: string };
      // Mock weather data
      const weatherData = {
        'new york': { temp: 15, condition: 'cloudy', humidity: 78 },
        'london': { temp: 8, condition: 'rainy', humidity: 85 },
        'tokyo': { temp: 22, condition: 'sunny', humidity: 60 },
        'sydney': { temp: 25, condition: 'partly cloudy', humidity: 65 }
      };
      
      const location_key = location.toLowerCase();
      const weather = weatherData[location_key as keyof typeof weatherData] || 
        { temp: 20, condition: 'unknown', humidity: 50 };
      
      return {
        location,
        temperature: weather.temp,
        condition: weather.condition,
        humidity: weather.humidity,
        forecast: 'Clear skies expected for the next few days'
      };
    },
    [
      {
        name: 'location',
        type: 'string',
        description: 'City or location name',
        required: true
      }
    ]
  );

  return {
    name: 'weather_specialist',
    model: 'gemini-2.0-flash',
    instruction: `You are a weather specialist. Use the get_weather tool to provide accurate, 
    detailed weather information. Include temperature, conditions, and helpful advice based on the weather.`,
    tools: [weatherTool]
  };
};

export const createNewsSpecialistAgent = (): AgentConfig => {
  const newsTool = createFunctionTool(
    'get_news',
    'Get latest news headlines',
    ({ category, limit }: { category?: string; limit?: number }) => {
      // Mock news data
      const newsCategories = {
        tech: [
          'AI breakthrough announced by major tech company',
          'New smartphone features revolutionary battery technology',
          'Cybersecurity update addresses critical vulnerabilities'
        ],
        business: [
          'Stock markets show positive growth this quarter',
          'New startup secures major funding round',
          'Economic indicators suggest stable growth'
        ],
        science: [
          'Scientists discover new exoplanet in habitable zone',
          'Medical research shows promising cancer treatment results',
          'Climate study reveals important environmental insights'
        ]
      };
      
      const selectedCategory = category || 'tech';
      const headlines = newsCategories[selectedCategory as keyof typeof newsCategories] || 
        newsCategories.tech;
      
      const limitedHeadlines = headlines.slice(0, limit || 3);
      
      return {
        category: selectedCategory,
        headlines: limitedHeadlines,
        timestamp: new Date().toISOString()
      };
    },
    [
      {
        name: 'category',
        type: 'string',
        description: 'News category (tech, business, science)',
        required: false,
        enum: ['tech', 'business', 'science']
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Number of headlines to return',
        required: false,
        default: 3
      }
    ]
  );

  return {
    name: 'news_specialist',
    model: 'gemini-2.0-flash',
    instruction: `You are a news specialist. Use the get_news tool to provide current news headlines. 
    Summarize the news clearly and provide context when helpful.`,
    tools: [newsTool]
  };
};

export const createCalculatorSpecialistAgent = (): AgentConfig => {
  const advancedCalcTool = createFunctionTool(
    'advanced_calculate',
    'Perform complex mathematical calculations',
    (params, context) => {
      const { expression, type } = params as { expression: string; type?: string };
      try {
        let result;
        
        switch (type) {
          case 'percentage': {
            // Handle percentage calculations
            const percentMatch = expression.match(/(\d+)\s*%\s*of\s*(\d+)/i);
            if (percentMatch) {
              const [, percent, of] = percentMatch;
              result = (parseFloat(percent) / 100) * parseFloat(of);
            } else {
              result = eval(expression);
            }
            break;
          }
            
          case 'area': {
            // Handle area calculations
            const areaMatch = expression.match(/circle\s*r=(\d+)/i);
            if (areaMatch) {
              const radius = parseFloat(areaMatch[1]);
              result = Math.PI * radius * radius;
            } else {
              result = eval(expression);
            }
            break;
          }
            
          default:
            result = eval(expression);
        }
        
        return {
          expression,
          result,
          type: type || 'basic',
          formatted: typeof result === 'number' ? result.toLocaleString() : result
        };
      } catch (error) {
        throw new Error(`Invalid expression: ${expression}`);
      }
    },
    [
      {
        name: 'expression',
        type: 'string',
        description: 'Mathematical expression to evaluate',
        required: true
      },
      {
        name: 'type',
        type: 'string',
        description: 'Type of calculation (basic, percentage, area)',
        required: false,
        enum: ['basic', 'percentage', 'area']
      }
    ]
  );

  return {
    name: 'calculator_specialist',
    model: 'gemini-2.0-flash',
    instruction: `You are a mathematics specialist. Use the advanced_calculate tool for all 
    mathematical operations. Explain your calculations clearly and provide step-by-step solutions when helpful.`,
    tools: [advancedCalcTool]
  };
};

// ========== Multi-Agent Coordinator ==========

export const createMultiAgentCoordinator = () => {
  const weatherAgent = createWeatherSpecialistAgent();
  const newsAgent = createNewsSpecialistAgent();
  const calcAgent = createCalculatorSpecialistAgent();

  const coordinator = createMultiAgent(
    'smart_coordinator',
    'gemini-2.0-flash',
    `You are an intelligent coordinator that manages multiple specialist agents.
    
    Based on the user's request, delegate to the appropriate specialist:
    - Weather questions → weather_specialist
    - News/current events → news_specialist  
    - Math/calculations → calculator_specialist
    
    If the request involves multiple areas, coordinate between specialists.
    Always provide a comprehensive response combining their expertise.`,
    [weatherAgent, newsAgent, calcAgent],
    'conditional'
  );

  const sessionProvider = createInMemorySessionProvider();
  const runnerConfig = createRunnerConfig(coordinator, sessionProvider);

  return { coordinator, sessionProvider, runnerConfig };
};

// ========== Sequential Multi-Agent Example ==========

export const createSequentialAgentPipeline = () => {
  // Agent 1: Data Collector
  const dataCollectorAgent: AgentConfig = {
    name: 'data_collector',
    model: 'gemini-2.0-flash',
    instruction: 'You collect and organize raw data. Extract key information and prepare it for analysis.',
    tools: []
  };

  // Agent 2: Data Analyzer
  const dataAnalyzerAgent: AgentConfig = {
    name: 'data_analyzer',
    model: 'gemini-2.0-flash',
    instruction: 'You analyze data provided by the data collector. Look for patterns, insights, and trends.',
    tools: []
  };

  // Agent 3: Report Generator
  const reportGeneratorAgent: AgentConfig = {
    name: 'report_generator',
    model: 'gemini-2.0-flash',
    instruction: 'You create comprehensive reports based on analysis. Present findings clearly and actionably.',
    tools: []
  };

  const sequentialCoordinator = createMultiAgent(
    'sequential_pipeline',
    'gemini-2.0-flash',
    'You coordinate a sequential data processing pipeline: collection → analysis → reporting.',
    [dataCollectorAgent, dataAnalyzerAgent, reportGeneratorAgent],
    'sequential'
  );

  const sessionProvider = createInMemorySessionProvider();
  const runnerConfig = createRunnerConfig(sequentialCoordinator, sessionProvider);

  return { sequentialCoordinator, sessionProvider, runnerConfig };
};

// ========== Example Usage Functions ==========

export async function runMultiAgentExample() {
  console.log('=== FAF ADK Layer - Multi-Agent Coordinator Example ===\n');

  const { runnerConfig } = createMultiAgentCoordinator();

  // Test weather delegation
  console.log('1. Weather Query:');
  const weatherMessage = createUserMessage('What\'s the weather like in Tokyo?');
  
  const weatherResponse = await runAgent(runnerConfig, {
    userId: 'user_123',
    sessionId: 'session_multi_1'
  }, weatherMessage);

  console.log('User:', weatherMessage.parts[0].text);
  console.log('Coordinator:', weatherResponse.content.parts[0].text);

  // Test news delegation
  console.log('\n2. News Query:');
  const newsMessage = createUserMessage('What are the latest tech news headlines?');
  
  const newsResponse = await runAgent(runnerConfig, {
    userId: 'user_123',
    sessionId: 'session_multi_2'
  }, newsMessage);

  console.log('User:', newsMessage.parts[0].text);
  console.log('Coordinator:', newsResponse.content.parts[0].text);

  // Test calculation delegation
  console.log('\n3. Math Query:');
  const mathMessage = createUserMessage('What is 25% of 240?');
  
  const mathResponse = await runAgent(runnerConfig, {
    userId: 'user_123',
    sessionId: 'session_multi_3'
  }, mathMessage);

  console.log('User:', mathMessage.parts[0].text);
  console.log('Coordinator:', mathResponse.content.parts[0].text);

  // Test complex query requiring multiple specialists
  console.log('\n4. Complex Multi-Domain Query:');
  const complexMessage = createUserMessage(
    'I need the weather in London, latest business news, and help calculating a 15% tip on a $85 bill'
  );
  
  const complexResponse = await runAgent(runnerConfig, {
    userId: 'user_123',
    sessionId: 'session_multi_4'
  }, complexMessage);

  console.log('User:', complexMessage.parts[0].text);
  console.log('Coordinator:', complexResponse.content.parts[0].text);
}

export async function runSequentialAgentExample() {
  console.log('\n=== FAF ADK Layer - Sequential Agent Pipeline Example ===\n');

  const { runnerConfig } = createSequentialAgentPipeline();

  const dataMessage = createUserMessage(
    'Please analyze this sales data: Q1: $100k, Q2: $120k, Q3: $95k, Q4: $140k. Create a comprehensive report.'
  );

  const response = await runAgent(runnerConfig, {
    userId: 'user_123',
    sessionId: 'session_sequential'
  }, dataMessage);

  console.log('User:', dataMessage.parts[0].text);
  console.log('Sequential Pipeline Result:', response.content.parts[0].text);
}

export async function runAgentSpecializationExample() {
  console.log('\n=== FAF ADK Layer - Agent Specialization Example ===\n');

  // Test individual specialists
  const weatherConfig = createRunnerConfig(
    createAgent(createWeatherSpecialistAgent()),
    createInMemorySessionProvider()
  );

  const newsConfig = createRunnerConfig(
    createAgent(createNewsSpecialistAgent()),
    createInMemorySessionProvider()
  );

  const calcConfig = createRunnerConfig(
    createAgent(createCalculatorSpecialistAgent()),
    createInMemorySessionProvider()
  );

  // Test weather specialist
  console.log('Weather Specialist:');
  const weatherResp = await runAgent(weatherConfig, { userId: 'user_123' }, 
    createUserMessage('Weather in Sydney please'));
  console.log('Response:', weatherResp.content.parts[0].text);

  // Test news specialist
  console.log('\nNews Specialist:');
  const newsResp = await runAgent(newsConfig, { userId: 'user_123' }, 
    createUserMessage('Show me science news'));
  console.log('Response:', newsResp.content.parts[0].text);

  // Test calculator specialist
  console.log('\nCalculator Specialist:');
  const calcResp = await runAgent(calcConfig, { userId: 'user_123' }, 
    createUserMessage('Calculate the area of a circle with radius 5'));
  console.log('Response:', calcResp.content.parts[0].text);
}

// ========== Main Example Runner ==========

export async function runAllMultiAgentExamples() {
  try {
    await runMultiAgentExample();
    await runSequentialAgentExample();
    await runAgentSpecializationExample();
    
    console.log('\n=== All multi-agent examples completed successfully! ===');
  } catch (error) {
    console.error('Multi-agent example failed:', error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runAllMultiAgentExamples();
}