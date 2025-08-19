/**
 * JAF Visualization Demo
 * 
 * Demonstrates the graphviz visualization capabilities of JAF
 * Generates various graph types showing agents, tools, and system architecture
 */

import {
  createAgent,
  createMultiAgent,
  createFunctionTool,
  createCalculatorTool,
  Model,
  ToolParameterType,
  createRunnerConfig,
  createInMemorySessionProvider
} from '@xynehq/jaf/adk';

import {
  generateAgentGraph,
  generateToolGraph,
  generateRunnerGraph,
  isGraphvizInstalled,
  getGraphDot,
  validateGraphOptions
} from '@xynehq/jaf/visualization';

// Import tools from examples instead of production tools
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// ========== Setup Output Directory ==========

const OUTPUT_DIR = join(__dirname, 'output');
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`📁 Created output directory: ${OUTPUT_DIR}`);
}

// ========== Create Sample Agents and Tools ==========

// Create simple mock tools for demonstration
const weatherTool = createFunctionTool({
  name: 'get_weather',
  description: 'Get current weather information',
  execute: async (params) => {
    const { location } = params as { location: string };
    return {
      location,
      temperature: 22,
      condition: 'Sunny',
      humidity: 60
    };
  },
  parameters: [
    {
      name: 'location',
      type: ToolParameterType.STRING,
      description: 'City or location name',
      required: true
    }
  ]
});

// Weather specialist agent
const weatherAgent = createAgent({
  name: 'weather_specialist',
  model: Model.GEMINI_2_0_FLASH,
  instruction: 'You are a weather specialist. Provide accurate weather information and forecasts.',
  tools: [weatherTool]
});

const newsTool = createFunctionTool({
  name: 'get_news',
  description: 'Get latest news headlines',
  execute: async (params) => {
    const { category = 'general' } = params as { category?: string };
    return {
      category,
      headlines: [
        'Breaking: Major tech announcement',
        'Markets show positive growth',
        'Scientific breakthrough reported'
      ]
    };
  },
  parameters: [
    {
      name: 'category',
      type: ToolParameterType.STRING,
      description: 'News category',
      required: false,
      enum: ['tech', 'business', 'science', 'general']
    }
  ]
});

// News analyst agent
const newsAgent = createAgent({
  name: 'news_analyst',
  model: Model.GPT_4O,
  instruction: 'You are a news analyst. Provide current news and analysis.',
  tools: [newsTool]
});

const geocodingTool = createFunctionTool({
  name: 'geocode',
  description: 'Convert addresses to coordinates or vice versa',
  execute: async (params) => {
    const { address } = params as { address: string };
    return {
      address,
      latitude: 40.7128,
      longitude: -74.0060,
      city: 'New York',
      country: 'USA'
    };
  },
  parameters: [
    {
      name: 'address',
      type: ToolParameterType.STRING,
      description: 'Address to geocode',
      required: true
    }
  ]
});

// Location specialist agent
const locationAgent = createAgent({
  name: 'location_specialist',
  model: Model.CLAUDE_3_5_SONNET_20241022,
  instruction: 'You are a location specialist. Help with geocoding and location-based queries.',
  tools: [geocodingTool]
});

// Math tutor agent
const mathAgent = createAgent({
  name: 'math_tutor',
  model: Model.GEMINI_2_0_FLASH,
  instruction: 'You are a math tutor. Help solve mathematical problems.',
  tools: [createCalculatorTool()]
});

// Create a multi-agent coordinator
const coordinatorAgent = createMultiAgent(
  'intelligent_coordinator',
  Model.GPT_4O,
  `You are an intelligent coordinator managing multiple specialist agents.
   Route queries to the appropriate specialist based on the topic.`,
  [
    weatherAgent.config,
    newsAgent.config,
    locationAgent.config,
    mathAgent.config
  ],
  'conditional'
);

// Create a hierarchical multi-agent system
const hierarchicalSystem = createMultiAgent(
  'hierarchical_system',
  Model.CLAUDE_3_5_SONNET_20241022,
  'You are a hierarchical system coordinator. Delegate tasks through multiple levels.',
  [
    coordinatorAgent.config,
    {
      name: 'research_team',
      model: Model.GEMINI_2_0_FLASH,
      instruction: 'Research team for gathering information',
      tools: [newsTool, weatherTool],
      subAgents: [
        weatherAgent.config,
        newsAgent.config
      ]
    }
  ],
  'hierarchical'
);

// Create custom tools for demonstration
const customSearchTool = createFunctionTool({
  name: 'search_database',
  description: 'Search internal knowledge database',
  execute: async (params) => {
    return { results: ['Result 1', 'Result 2'], query: params.query };
  },
  parameters: [
    {
      name: 'query',
      type: ToolParameterType.STRING,
      description: 'Search query',
      required: true
    }
  ]
});

const customAnalysisTool = createFunctionTool({
  name: 'analyze_data',
  description: 'Perform data analysis on provided dataset',
  execute: async (params) => {
    return { analysis: 'Analysis complete', dataPoints: params.dataPoints };
  },
  parameters: [
    {
      name: 'dataPoints',
      type: ToolParameterType.ARRAY,
      description: 'Array of data points to analyze',
      required: true
    }
  ]
});

// Research agent with custom tools
const researchAgent = createAgent({
  name: 'research_specialist',
  model: Model.GEMINI_2_0_FLASH,
  instruction: 'You are a research specialist with access to internal databases.',
  tools: [customSearchTool, customAnalysisTool]
});

// ========== Visualization Functions ==========

async function generateAllVisualizations() {
  console.log('\n🎨 JAF Visualization Demo\n');
  console.log('=' .repeat(50));
  
  // Check if graphviz is installed
  if (!isGraphvizInstalled()) {
    console.warn('⚠️  Graphviz is not installed on your system.');
    console.warn('   Install it with:');
    console.warn('   - macOS: brew install graphviz');
    console.warn('   - Ubuntu/Debian: sudo apt-get install graphviz');
    console.warn('   - Windows: https://graphviz.org/download/\n');
    console.warn('   Generating DOT files only (no images).\n');
  } else {
    console.log('✅ Graphviz is installed\n');
  }

  // 1. Single Agent Graph
  console.log('📊 Generating single agent visualization...');
  const singleAgentResult = await generateAgentGraph(
    [weatherAgent],
    {
      title: 'Weather Specialist Agent',
      outputPath: join(OUTPUT_DIR, 'weather-agent'),
      outputFormat: 'png',
      colorScheme: 'modern',
      showToolDetails: true
    }
  );
  
  if (singleAgentResult.success) {
    console.log(`   ✅ Generated: ${singleAgentResult.outputPath}`);
  } else {
    console.log(`   ⚠️  ${singleAgentResult.error}`);
    if (singleAgentResult.graphDot) {
      const dotPath = join(OUTPUT_DIR, 'weather-agent.dot');
      writeFileSync(dotPath, singleAgentResult.graphDot);
      console.log(`   📝 DOT file saved: ${dotPath}`);
    }
  }

  // 2. Multiple Agents Graph
  console.log('\n📊 Generating multiple agents visualization...');
  const multiAgentResult = await generateAgentGraph(
    [weatherAgent, newsAgent, locationAgent, mathAgent, researchAgent],
    {
      title: 'All Specialist Agents',
      outputPath: join(OUTPUT_DIR, 'all-agents'),
      outputFormat: 'svg',
      colorScheme: 'default',
      rankdir: 'LR',
      showToolDetails: true,
      showSubAgents: false
    }
  );
  
  if (multiAgentResult.success) {
    console.log(`   ✅ Generated: ${multiAgentResult.outputPath}`);
  } else {
    console.log(`   ⚠️  ${multiAgentResult.error}`);
    if (multiAgentResult.graphDot) {
      const dotPath = join(OUTPUT_DIR, 'all-agents.dot');
      writeFileSync(dotPath, multiAgentResult.graphDot);
      console.log(`   📝 DOT file saved: ${dotPath}`);
    }
  }

  // 3. Multi-Agent Coordinator Graph
  console.log('\n📊 Generating multi-agent coordinator visualization...');
  const coordinatorResult = await generateAgentGraph(
    [coordinatorAgent],
    {
      title: 'Multi-Agent Coordinator System',
      outputPath: join(OUTPUT_DIR, 'coordinator'),
      outputFormat: 'png',
      colorScheme: 'modern',
      rankdir: 'TB',
      showToolDetails: false,
      showSubAgents: true
    }
  );
  
  if (coordinatorResult.success) {
    console.log(`   ✅ Generated: ${coordinatorResult.outputPath}`);
  } else {
    console.log(`   ⚠️  ${coordinatorResult.error}`);
    if (coordinatorResult.graphDot) {
      const dotPath = join(OUTPUT_DIR, 'coordinator.dot');
      writeFileSync(dotPath, coordinatorResult.graphDot);
      console.log(`   📝 DOT file saved: ${dotPath}`);
    }
  }

  // 4. Hierarchical System Graph
  console.log('\n📊 Generating hierarchical system visualization...');
  const hierarchicalResult = await generateAgentGraph(
    [hierarchicalSystem],
    {
      title: 'Hierarchical Multi-Agent System',
      outputPath: join(OUTPUT_DIR, 'hierarchical'),
      outputFormat: 'pdf',
      colorScheme: 'minimal',
      rankdir: 'TB',
      showToolDetails: true,
      showSubAgents: true
    }
  );
  
  if (hierarchicalResult.success) {
    console.log(`   ✅ Generated: ${hierarchicalResult.outputPath}`);
  } else {
    console.log(`   ⚠️  ${hierarchicalResult.error}`);
    if (hierarchicalResult.graphDot) {
      const dotPath = join(OUTPUT_DIR, 'hierarchical.dot');
      writeFileSync(dotPath, hierarchicalResult.graphDot);
      console.log(`   📝 DOT file saved: ${dotPath}`);
    }
  }

  // 5. Tools Graph
  console.log('\n📊 Generating tools visualization...');
  const allTools = [
    weatherTool,
    newsTool,
    geocodingTool,
    createCalculatorTool(),
    customSearchTool,
    customAnalysisTool
  ];
  
  const toolsResult = await generateToolGraph(
    allTools,
    {
      title: 'Available Tools',
      outputPath: join(OUTPUT_DIR, 'tools'),
      outputFormat: 'svg',
      colorScheme: 'modern',
      layout: 'circo'
    }
  );
  
  if (toolsResult.success) {
    console.log(`   ✅ Generated: ${toolsResult.outputPath}`);
  } else {
    console.log(`   ⚠️  ${toolsResult.error}`);
    if (toolsResult.graphDot) {
      const dotPath = join(OUTPUT_DIR, 'tools.dot');
      writeFileSync(dotPath, toolsResult.graphDot);
      console.log(`   📝 DOT file saved: ${dotPath}`);
    }
  }

  // 6. Runner Architecture Graph
  console.log('\n📊 Generating runner architecture visualization...');
  const sessionProvider = createInMemorySessionProvider();
  const runnerConfig = createRunnerConfig(coordinatorAgent, sessionProvider);
  
  const runnerResult = await generateRunnerGraph(
    runnerConfig,
    {
      title: 'JAF Runner Architecture',
      outputPath: join(OUTPUT_DIR, 'runner'),
      outputFormat: 'png',
      colorScheme: 'modern',
      rankdir: 'TB',
      showToolDetails: true,
      showSubAgents: true
    }
  );
  
  if (runnerResult.success) {
    console.log(`   ✅ Generated: ${runnerResult.outputPath}`);
  } else {
    console.log(`   ⚠️  ${runnerResult.error}`);
    if (runnerResult.graphDot) {
      const dotPath = join(OUTPUT_DIR, 'runner.dot');
      writeFileSync(dotPath, runnerResult.graphDot);
      console.log(`   📝 DOT file saved: ${dotPath}`);
    }
  }

  // 7. Generate DOT files with different color schemes
  console.log('\n📊 Generating color scheme examples...');
  const colorSchemes = ['default', 'modern', 'minimal'] as const;
  
  for (const scheme of colorSchemes) {
    const dotContent = getGraphDot(
      [weatherAgent, newsAgent],
      {
        title: `Color Scheme: ${scheme}`,
        colorScheme: scheme,
        rankdir: 'LR'
      }
    );
    
    const dotPath = join(OUTPUT_DIR, `color-${scheme}.dot`);
    writeFileSync(dotPath, dotContent);
    console.log(`   📝 DOT file saved: ${dotPath}`);
  }

  // 8. Test graph options validation
  console.log('\n🔍 Testing graph options validation...');
  const invalidOptions = {
    layout: 'invalid_layout' as any,
    rankdir: 'INVALID' as any,
    outputFormat: 'invalid' as any,
    colorScheme: 'nonexistent' as any
  };
  
  const errors = validateGraphOptions(invalidOptions);
  if (errors.length > 0) {
    console.log('   ✅ Validation working correctly. Found errors:');
    errors.forEach(error => console.log(`      - ${error}`));
  }

  console.log('\n' + '=' .repeat(50));
  console.log('✅ Visualization demo complete!');
  console.log(`📁 All outputs saved to: ${OUTPUT_DIR}`);
  
  if (!isGraphvizInstalled()) {
    console.log('\n💡 To convert DOT files to images, install graphviz and run:');
    console.log('   dot -Tpng input.dot -o output.png');
  }
}

// ========== Interactive Demo ==========

async function interactiveDemo() {
  console.log('\n🎯 Interactive Visualization Demo\n');
  
  // Use dynamic import for readline to avoid ESLint issues
  const { createInterface } = await import('readline');
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer: string) => {
        resolve(answer);
      });
    });
  };
  
  console.log('Choose visualization type:');
  console.log('1. Single Agent');
  console.log('2. Multiple Agents');
  console.log('3. Multi-Agent Coordinator');
  console.log('4. Hierarchical System');
  console.log('5. Tools');
  console.log('6. Runner Architecture');
  console.log('7. All Visualizations');
  console.log('0. Exit');
  
  const choice = await question('\nEnter your choice (0-7): ');
  
  switch (choice) {
    case '1':
      await generateAgentGraph([weatherAgent], {
        title: 'Interactive: Weather Agent',
        outputPath: join(OUTPUT_DIR, 'interactive-weather'),
        colorScheme: 'modern'
      });
      break;
      
    case '2':
      await generateAgentGraph(
        [weatherAgent, newsAgent, locationAgent, mathAgent],
        {
          title: 'Interactive: All Agents',
          outputPath: join(OUTPUT_DIR, 'interactive-all'),
          rankdir: 'LR'
        }
      );
      break;
      
    case '3':
      await generateAgentGraph([coordinatorAgent], {
        title: 'Interactive: Coordinator',
        outputPath: join(OUTPUT_DIR, 'interactive-coordinator'),
        showSubAgents: true
      });
      break;
      
    case '4':
      await generateAgentGraph([hierarchicalSystem], {
        title: 'Interactive: Hierarchical',
        outputPath: join(OUTPUT_DIR, 'interactive-hierarchical'),
        showSubAgents: true,
        showToolDetails: true
      });
      break;
      
    case '5':
      await generateToolGraph(
        [weatherTool, newsTool, createCalculatorTool()],
        {
          title: 'Interactive: Tools',
          outputPath: join(OUTPUT_DIR, 'interactive-tools'),
          layout: 'circo'
        }
      );
      break;
      
    case '6': {
      const provider = createInMemorySessionProvider();
      const config = createRunnerConfig(coordinatorAgent, provider);
      await generateRunnerGraph(config, {
        title: 'Interactive: Runner',
        outputPath: join(OUTPUT_DIR, 'interactive-runner')
      });
      break;
    }
      
    case '7':
      await generateAllVisualizations();
      break;
      
    case '0':
      console.log('Goodbye!');
      break;
      
    default:
      console.log('Invalid choice');
  }
  
  rl.close();
}

// ========== Main Execution ==========

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--interactive') || args.includes('-i')) {
    await interactiveDemo();
  } else {
    await generateAllVisualizations();
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export {
  generateAllVisualizations,
  interactiveDemo,
  weatherAgent,
  newsAgent,
  locationAgent,
  mathAgent,
  coordinatorAgent,
  hierarchicalSystem,
  researchAgent
};