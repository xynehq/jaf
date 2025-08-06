/**
 * Test Runner Visualization - Proper PNG Generation
 * 
 * This demonstrates the ACTUAL runner function generating a PNG file
 */

import { Agent, Tool, RunnerConfig } from '../../src/adk/types';
import { createRunnerConfig, generateRunnerGraphPng } from '../../src/adk/runners';
import { createInMemorySessionProvider } from '../../src/adk/sessions';
import { existsSync } from 'fs';

// Create real agent and tools for the server demo
const calculatorTool: Tool = {
  name: 'calculate',
  description: 'Perform mathematical calculations',
  parameters: [
    {
      name: 'expression',
      type: 'string',
      description: 'Math expression to evaluate',
      required: true
    }
  ],
  execute: async (params, context) => {
    const expression = params.expression as string;
    try {
      // Use safe math evaluator instead of eval
      const { evaluateMathExpression } = require('../../src/utils/safe-math');
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
    tags: ['math', 'calculator']
  }
};

const greetingTool: Tool = {
  name: 'greet',
  description: 'Generate a personalized greeting',
  parameters: [
    {
      name: 'name',
      type: 'string',
      description: 'Name of the person to greet',
      required: true
    }
  ],
  execute: async (params, context) => {
    const name = params.name as string;
    return {
      success: true,
      data: `Hello, ${name}! Nice to meet you.`
    };
  },
  metadata: {
    source: 'function',
    version: '1.0.0',
    tags: ['greeting', 'social']
  }
};

const assistantAgent: Agent = {
  id: 'server-demo-assistant',
  config: {
    name: 'Server Demo Assistant',
    model: 'gemini-2.5-flash-lite',
    instruction: 'You are a helpful assistant that can perform calculations and provide greetings.',
    description: 'Multi-purpose assistant for the server demo',
    tools: [calculatorTool, greetingTool],
    subAgents: [
      {
        name: 'Math Specialist',
        model: 'gemini-2.5-flash-lite',
        instruction: 'I specialize in mathematical calculations.',
        tools: [calculatorTool]
      }
    ]
  },
  metadata: {
    created: new Date(),
    version: '1.0.0',
    tags: ['assistant', 'server-demo']
  }
};

async function testRunnerVisualization(): Promise<void> {
  console.log('🧪 Testing ACTUAL Runner PNG Generation...\n');

  try {
    // Step 1: Create a proper runner configuration
    console.log('1️⃣ Creating runner configuration...');
    const sessionProvider = createInMemorySessionProvider();
    const runnerConfig: RunnerConfig = createRunnerConfig(assistantAgent, sessionProvider, {
      maxLLMCalls: 5,
      timeout: 30000
    });
    console.log('✅ Runner config created');

    // Step 2: Use the ACTUAL runner function to generate PNG
    console.log('\n2️⃣ Calling generateRunnerGraphPng() function...');
    const result = await generateRunnerGraphPng(runnerConfig, './server-demo-graph');

    // Step 3: Verify the result
    console.log('\n3️⃣ Checking results...');
    if (result.success) {
      console.log('✅ PNG generation succeeded!');
      console.log(`📁 Output file: ${result.outputPath}`);
      
      // Check if file actually exists
      if (result.outputPath && existsSync(result.outputPath)) {
        console.log('✅ PNG file confirmed to exist on disk');
        console.log(`📏 File path: ${result.outputPath}`);
      } else {
        console.log('⚠️  PNG file not found on disk (but generation reported success)');
      }

      if (result.graphDot) {
        console.log('✅ DOT content generated');
        console.log(`📊 DOT content length: ${result.graphDot.length} characters`);
      }

    } else {
      console.log('❌ PNG generation failed');
      console.log(`💬 Error: ${result.error}`);
      
      if (result.graphDot) {
        console.log('📄 DOT content was generated despite PNG failure:');
        console.log(`📊 DOT content length: ${result.graphDot.length} characters`);
      }
    }

    // Step 4: Show what the visualization contains
    console.log('\n4️⃣ Visualization content:');
    console.log(`   🤖 Agent: ${runnerConfig.agent.config.name}`);
    console.log(`   🔧 Tools: ${runnerConfig.agent.config.tools.map(t => t.name).join(', ')}`);
    console.log(`   🏗️  Sub-agents: ${runnerConfig.agent.config.subAgents?.length || 0}`);
    console.log(`   💾 Session provider: ${runnerConfig.sessionProvider ? 'Yes' : 'No'}`);

    // Step 5: Instructions for viewing
    if (result.success && result.outputPath) {
      console.log('\n5️⃣ Next steps:');
      console.log(`   📱 Open the file: open "${result.outputPath}"`);
      console.log(`   🌐 Or view in browser: file://${process.cwd()}/${result.outputPath}`);
    } else if (result.graphDot && !result.success) {
      console.log('\n5️⃣ Manual generation needed:');
      console.log('   📥 Install Graphviz: brew install graphviz');
      console.log('   🔧 Then the runner function will automatically generate PNG');
    }

    console.log('\n🎉 Runner visualization test completed!');

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testRunnerVisualization().catch(console.error);
}

export { testRunnerVisualization };