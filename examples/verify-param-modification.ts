/**
 * Verification Example for Parameter Modification
 *
 * This example verifies that the streamEventHandler parameter works correctly
 * without requiring actual LLM API calls.
 */

import { z } from 'zod';
import { runStream } from '../src/core/engine.js';
import { Agent, Tool, ModelProvider, TraceEvent, createRunId, createTraceId } from '../src/core/types.js';

type TestContext = {
  userId: string;
  tenantId: string;
  region: string;
};

const testTool: Tool<{ query: string; limit?: number; region?: string; userId?: string }, TestContext> = {
  schema: {
    name: 'test_search',
    description: 'Test search tool',
    parameters: z.object({
      query: z.string(),
      limit: z.number().optional(),
      region: z.string().optional(),
      userId: z.string().optional()
    })
  },
  execute: async (args, context) => {
    console.log('\n✅ Tool executed with args:', JSON.stringify(args, null, 2));
    return JSON.stringify({ success: true, args });
  }
};

const agent: Agent<TestContext, string> = {
  name: 'test_agent',
  instructions: () => 'Test agent',
  tools: [testTool],
  modelConfig: {
    name: 'mock-model'
  }
};

// Mock model provider that returns a single tool call
const mockProvider: ModelProvider<TestContext> = {
  getCompletion: async (state, agent, config) => {
    console.log('[MOCK] getCompletion called');

    const response = {
      message: {
        content: 'I will search for you',
        tool_calls: [
          {
            id: 'test-call-1',
            type: 'function' as const,
            function: {
              name: 'test_search',
              // LLM provides ONLY the query, no defaults
              arguments: JSON.stringify({ query: 'TypeScript' })
            }
          }
        ]
      }
    };

    console.log('[MOCK] Returning response:', JSON.stringify(response, null, 2));
    return response;
  }
};

async function verifyParameterModification() {
  console.log('🔍 Verifying Parameter Modification Feature\n');
  console.log('='.repeat(80));

  const context: TestContext = {
    userId: 'user-123',
    tenantId: 'tenant-456',
    region: 'us-west-2'
  };

  const runState = {
    runId: createRunId('verify-1'),
    traceId: createTraceId('trace-1'),
    messages: [{ role: 'user' as const, content: 'Search for TypeScript' }],
    currentAgentName: 'test_agent',
    context,
    turnCount: 0
  };

  const runConfig = {
    agentRegistry: new Map([['test_agent', agent]]),
    modelProvider: mockProvider,
    maxTurns: 1
  };

  let beforeToolArgs: any = null;
  let toolCallStartArgs: any = null;
  let toolCallEndResult: any = null;

  console.log('\n📋 Test Scenario:');
  console.log('   • LLM provides: { query: "TypeScript" }');
  console.log('   • streamEventHandler should add: limit=20, region="us-west-2", userId="user-123"');
  console.log('   • Tool should receive all modified parameters\n');

  for await (const evt of runStream<TestContext, string>(
    runState,
    runConfig,
    // THIS IS WHAT WE'RE TESTING - the streamEventHandler parameter
    async (event: TraceEvent) => {
      console.log(`[DEBUG] Event received: ${event.type}`);

      if (event.type === 'before_tool_execution') {
        beforeToolArgs = event.data.args;

        console.log('\n🔧 [before_tool_execution] Original args from LLM:');
        console.log('   ', JSON.stringify(beforeToolArgs, null, 2));

        // Modify the args
        const modified = {
          ...event.data.args,
          limit: 20,
          region: event.data.context.region,
          userId: event.data.context.userId
        };

        console.log('\n🔧 [before_tool_execution] Returning modified args:');
        console.log('   ', JSON.stringify(modified, null, 2));

        return modified;
      }
    }
  )) {
    console.log(`[DEBUG] Stream event: ${evt.type}`);

    switch (evt.type) {
      case 'tool_call_start':
        toolCallStartArgs = evt.data.args;
        console.log('\n📍 [tool_call_start] Args received by engine:');
        console.log('   ', JSON.stringify(toolCallStartArgs, null, 2));
        break;

      case 'tool_call_end':
        toolCallEndResult = evt.data.result;
        console.log('\n✅ [tool_call_end] Result:', toolCallEndResult);
        break;

      case 'run_end':
        console.log('\n[DEBUG] Run end outcome:', JSON.stringify(evt.data.outcome, null, 2));
        break;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 Verification Results\n');

  // Verify the modification worked
  const passed: string[] = [];
  const failed: string[] = [];

  if (beforeToolArgs && !beforeToolArgs.limit && !beforeToolArgs.region && !beforeToolArgs.userId) {
    passed.push('✅ LLM provided only query (no defaults)');
  } else {
    failed.push('❌ LLM should not have provided limit/region/userId');
  }

  if (toolCallStartArgs?.limit === 20) {
    passed.push('✅ tool_call_start received modified limit=20');
  } else {
    failed.push('❌ tool_call_start should have limit=20');
  }

  if (toolCallStartArgs?.region === 'us-west-2') {
    passed.push('✅ tool_call_start received modified region=us-west-2');
  } else {
    failed.push('❌ tool_call_start should have region=us-west-2');
  }

  if (toolCallStartArgs?.userId === 'user-123') {
    passed.push('✅ tool_call_start received modified userId=user-123');
  } else {
    failed.push('❌ tool_call_start should have userId=user-123');
  }

  if (toolCallEndResult) {
    const resultObj = JSON.parse(toolCallEndResult);
    if (resultObj.args.limit === 20 && resultObj.args.region === 'us-west-2' && resultObj.args.userId === 'user-123') {
      passed.push('✅ Tool executed with all modified parameters');
    } else {
      failed.push('❌ Tool did not receive all modified parameters');
    }
  } else {
    failed.push('❌ No tool result received');
  }

  console.log('Passed Tests:');
  passed.forEach(p => console.log('  ', p));

  if (failed.length > 0) {
    console.log('\nFailed Tests:');
    failed.forEach(f => console.log('  ', f));
  }

  console.log('\n' + '='.repeat(80));

  if (failed.length === 0) {
    console.log('✅ ALL TESTS PASSED - Parameter modification works correctly!');
    console.log('\n💡 The streamEventHandler parameter successfully:');
    console.log('   1. Intercepted before_tool_execution event');
    console.log('   2. Modified the tool arguments');
    console.log('   3. Passed modified args to tool execution');
    console.log('   4. Reflected modified args in tool_call_start event');
  } else {
    console.log('❌ SOME TESTS FAILED - Please review the implementation');
    process.exit(1);
  }
}

verifyParameterModification().catch(console.error);
