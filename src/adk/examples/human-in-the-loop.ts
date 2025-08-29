import { z } from 'zod';
import readline from 'node:readline/promises';
import { approve, reject } from '../../core/state';
import {
  Agent,
  RunState,
  RunResult,
  Tool,
  ModelProvider,
  RunConfig,
  createRunId,
  createTraceId,
} from '../../core/types';
import { run } from '../../core/engine';

const sensitiveTool: Tool<{ orderId: number }, any> = {
  schema: {
    name: 'cancelOrder',
    description: 'Cancel an order',
    parameters: z.object({
      orderId: z.number(),
    }),
  },
  needsApproval: true,
  execute: async ({ orderId }) => {
    // In a real application, this would cancel the order
    return `Order ${orderId} has been successfully cancelled.`;
  },
};

const agent: Agent<any, any> = {
  name: 'Test Agent',
  instructions: () => 'You are a test agent that can cancel orders.',
  tools: [sensitiveTool],
  modelConfig: {
    name: 'mock-model',
  },
};

async function main() {
  let state: RunState<any> = {
    runId: createRunId('1'),
    traceId: createTraceId('1'),
    messages: [{ role: 'user', content: 'Cancel order 123' }],
    currentAgentName: 'Test Agent',
    context: {},
    turnCount: 0,
    approvals: new Map(),
  };

  const modelProvider: ModelProvider<any> = {
    async getCompletion(currentState: RunState<any>) {
      const lastMessage = currentState.messages[currentState.messages.length - 1];

      // If the last message is a tool response, the model should generate a final text response.
      if (lastMessage?.role === 'tool') {
        let toolContent;
        try {
          toolContent = JSON.parse(lastMessage.content);
        } catch (e) {
          // Not JSON, so it's a successful result.
          return { message: { content: `Action completed. Result: ${lastMessage.content}` } };
        }

        // It is JSON, check for error type.
        if (toolContent.error === 'approval_denied') {
          return { message: { content: 'Okay, the action was cancelled as requested.' } };
        }
      }

      // This is the initial turn, or a turn after a successful tool call that requires more steps.
      // The model decides to call a tool.
      return {
        message: {
          tool_calls: [
            {
              id: 'tool-call-1',
              type: 'function',
              function: {
                name: 'cancelOrder',
                arguments: JSON.stringify({ orderId: 123 }),
              },
            },
          ],
        },
      };
    },
  };

  const runConfig: RunConfig<any> = {
    agentRegistry: new Map([['Test Agent', agent]]),
    modelProvider,
  };

  let isRunning = true;
  while (isRunning) {
    console.log('\n--- Starting new run ---');
    const result = await run(state, runConfig);

    switch (result.outcome.status) {
      case 'interrupted': {
        console.log('Interruption received, awaiting user input...');
        const interruption = result.outcome.interruptions[0]; // Assuming one interruption for simplicity

        if (interruption.type === 'tool_approval') {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const answer = await rl.question(
            `Do you approve the tool call to "${interruption.toolCall.function.name}" with arguments ${interruption.toolCall.function.arguments}? (y/n) `,
          );
          rl.close();

          if (answer.toLowerCase() === 'y') {
            console.log('You approved. Resuming run...');
            state = approve(result.finalState, interruption);
          } else {
            console.log('You rejected. Resuming run...');
            state = reject(result.finalState, interruption);
          }
        }
        break;
      }
      case 'completed':
        console.log('--- Run Completed ---');
        console.log('Final output:', result.outcome.output);
        isRunning = false;
        break;
      case 'error':
        console.error('--- Run Failed ---');
        console.error('Run failed:', result.outcome.error);
        isRunning = false;
        break;
    }
  }
}

main();
