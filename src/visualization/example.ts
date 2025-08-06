/**
 * JAF Visualization - Example Usage
 * 
 * Example demonstrating how to use the Graphviz visualization functionality
 */

import { Agent, Tool, RunnerConfig } from '../adk/types';
import { createRunnerConfig } from '../adk/runners';
import { createInMemorySessionProvider } from '../adk/sessions';
import { 
  generateAgentVisualization, 
  generateToolVisualization, 
  generateRunnerGraphPng 
} from '../adk/runners';

// ========== Example Agent and Tools ==========

const exampleCalculatorTool: Tool = {
  name: 'calculator',
  description: 'Performs basic arithmetic operations',
  parameters: [
    {
      name: 'expression',
      type: 'string',
      description: 'Mathematical expression to evaluate',
      required: true
    }
  ],
  execute: async (params, context) => {
    const expression = params.expression as string;
    try {
      // Use safe math evaluator instead of eval
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { evaluateMathExpression } = require('../utils/safe-math');
      const result = evaluateMathExpression(expression);
      return {
        success: true,
        data: result.toString()
      };
    } catch (error) {
      return {
        success: false,
        error: 'Invalid mathematical expression'
      };
    }
  },
  metadata: {
    source: 'function',
    version: '1.0.0',
    tags: ['math', 'utility']
  }
};

const exampleWeatherTool: Tool = {
  name: 'weather',
  description: 'Gets current weather for a location',
  parameters: [
    {
      name: 'location',
      type: 'string',
      description: 'Location to get weather for',
      required: true
    }
  ],
  execute: async (params, context) => {
    const location = params.location as string;
    // Mock weather data
    return {
      success: true,
      data: `Current weather in ${location}: 72°F, sunny`
    };
  },
  metadata: {
    source: 'openapi',
    version: '2.1.0',
    tags: ['weather', 'api']
  }
};

const exampleSearchTool: Tool = {
  name: 'search',
  description: 'Searches the web for information',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search query',
      required: true
    }
  ],
  execute: async (params, context) => {
    const query = params.query as string;
    return {
      success: true,
      data: `Search results for: ${query}`
    };
  },
  metadata: {
    source: 'langchain',
    version: '1.5.0',
    tags: ['search', 'web']
  }
};

const exampleAgent: Agent = {
  id: 'example-agent-001',
  config: {
    name: 'Example Assistant',
    model: 'gpt-4',
    instruction: 'I am a helpful assistant that can perform calculations, check weather, and search for information.',
    description: 'A multi-purpose assistant agent',
    tools: [exampleCalculatorTool, exampleWeatherTool, exampleSearchTool],
    subAgents: [
      {
        name: 'Math Specialist',
        model: 'gpt-3.5-turbo',
        instruction: 'I specialize in mathematical calculations and problem solving.',
        tools: [exampleCalculatorTool]
      },
      {
        name: 'Weather Bot',
        model: 'gpt-3.5-turbo',
        instruction: 'I provide weather information and forecasts.',
        tools: [exampleWeatherTool]
      }
    ]
  },
  metadata: {
    created: new Date(),
    version: '1.0.0',
    tags: ['assistant', 'multi-purpose']
  }
};

const exampleSpecializedAgent: Agent = {
  id: 'search-agent-001',
  config: {
    name: 'Search Specialist',
    model: 'gpt-4',
    instruction: 'I specialize in finding and retrieving information from various sources.',
    tools: [exampleSearchTool]
  },
  metadata: {
    created: new Date(),
    version: '1.0.0',
    tags: ['search', 'research']
  }
};

// ========== Example Functions ==========

export const runVisualizationExamples = async (): Promise<void> => {
  console.log('🎨 Running JAF Visualization Examples...\n');

  try {
    // 1. Generate Agent Graph
    console.log('📊 Generating agent visualization...');
    const agentResult = await generateAgentVisualization(
      [exampleAgent, exampleSpecializedAgent],
      {
        title: 'JAF Agent System',
        outputPath: './examples/agent-graph',
        outputFormat: 'png',
        showToolDetails: true,
        showSubAgents: true,
        colorScheme: 'modern'
      }
    );

    if (agentResult.success) {
      console.log(`✅ Agent graph generated: ${agentResult.outputPath}`);
    } else {
      console.log(`❌ Agent graph failed: ${agentResult.error}`);
    }

    // 2. Generate Tool Graph
    console.log('\n🔧 Generating tool visualization...');
    const allTools = [exampleCalculatorTool, exampleWeatherTool, exampleSearchTool];
    const toolResult = await generateToolVisualization(allTools, {
      title: 'JAF Tool Ecosystem',
      outputPath: './examples/tool-graph',
      outputFormat: 'png',
      layout: 'circo',
      colorScheme: 'default'
    });

    if (toolResult.success) {
      console.log(`✅ Tool graph generated: ${toolResult.outputPath}`);
    } else {
      console.log(`❌ Tool graph failed: ${toolResult.error}`);
    }

    // 3. Generate Runner Visualization
    console.log('\n🏃 Generating runner visualization...');
    const sessionProvider = createInMemorySessionProvider();
    const runnerConfig = createRunnerConfig(exampleAgent, sessionProvider);
    
    const runnerResult = await generateRunnerGraphPng(
      runnerConfig,
      './examples/runner-architecture'
    );

    if (runnerResult.success) {
      console.log(`✅ Runner graph generated: ${runnerResult.outputPath}`);
    } else {
      console.log(`❌ Runner graph failed: ${runnerResult.error}`);
    }

    // 4. Generate different color schemes
    console.log('\n🎨 Generating alternative color schemes...');
    
    for (const scheme of ['default', 'modern', 'minimal'] as const) {
      const schemeResult = await generateAgentVisualization(
        [exampleAgent],
        {
          title: `JAF Agent (${scheme} theme)`,
          outputPath: `./examples/agent-${scheme}`,
          outputFormat: 'png',
          colorScheme: scheme,
          showToolDetails: true
        }
      );

      if (schemeResult.success) {
        console.log(`✅ ${scheme} theme generated: ${schemeResult.outputPath}`);
      } else {
        console.log(`❌ ${scheme} theme failed: ${schemeResult.error}`);
      }
    }

    console.log('\n🎉 All visualization examples completed!');
    console.log('\n📁 Generated files:');
    console.log('   - ./examples/agent-graph.png');
    console.log('   - ./examples/tool-graph.png');
    console.log('   - ./examples/runner-architecture.png');
    console.log('   - ./examples/agent-default.png');
    console.log('   - ./examples/agent-modern.png');
    console.log('   - ./examples/agent-minimal.png');

  } catch (error) {
    console.error('❌ Error running visualization examples:', error);
  }
};

// ========== Quick Start Function ==========

export const quickStartVisualization = async (
  agent: Agent,
  outputPath?: string
): Promise<void> => {
  console.log(`🚀 Quick visualization for agent: ${agent.config.name}`);
  
  const result = await generateAgentVisualization([agent], {
    outputPath: outputPath || `./agent-${agent.id}`,
    outputFormat: 'png',
    colorScheme: 'modern',
    showToolDetails: true,
    showSubAgents: true
  });

  if (result.success) {
    console.log(`✅ Visualization saved to: ${result.outputPath}`);
  } else {
    console.error(`❌ Visualization failed: ${result.error}`);
  }
};

// ========== CLI Integration ==========

if (require.main === module) {
  runVisualizationExamples().catch(console.error);
}