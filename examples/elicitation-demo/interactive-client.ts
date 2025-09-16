#!/usr/bin/env tsx

import 'dotenv/config';
import * as readline from 'readline';

/**
 * Interactive client that demonstrates manual handling of elicitation requests
 * This shows how a client application would interact with the JAF server
 * when elicitation interruptions occur, with real user input.
 */

interface ElicitationRequest {
  id: string;
  message: string;
  requestedSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  metadata?: Record<string, any>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  success: boolean;
  data?: {
    runId: string;
    traceId: string;
    conversationId: string;
    messages: ChatMessage[];
    outcome: {
      status: 'completed' | 'error' | 'interrupted';
      output?: string;
      error?: any;
      interruptions?: Array<{
        type: 'elicitation';
        request: ElicitationRequest;
        sessionId: string;
      }>;
    };
    turnCount: number;
    executionTimeMs: number;
  };
  error?: string;
}

class ElicitationClient {
  private baseUrl: string;
  private conversationId: string;
  private rl: readline.Interface;

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    this.conversationId = `demo-${Date.now()}`;

    // Create readline interface for user input
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  private async question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, resolve);
    });
  }

  async sendMessage(content: string, elicitationResponses: any[] = []): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content }],
        agentName: 'Elicitation Demo Agent',
        conversationId: this.conversationId,
        elicitationResponses,
      }),
    });

    return response.json();
  }

  async respondToElicitation(requestId: string, action: 'accept' | 'decline' | 'cancel', content?: any) {
    const response = await fetch(`${this.baseUrl}/elicitation/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestId,
        action,
        content,
      }),
    });

    return response.json();
  }

  async getPendingElicitations() {
    const response = await fetch(`${this.baseUrl}/elicitation/pending`);
    return response.json();
  }

  private displaySchema(schema: ElicitationRequest['requestedSchema']): void {
    console.log('\n📋 Form Fields:');
    console.log('================');

    for (const [key, property] of Object.entries(schema.properties)) {
      const isRequired = schema.required?.includes(key);
      const requiredText = isRequired ? ' (REQUIRED)' : ' (optional)';

      console.log(`\n🔸 ${property.title || key}${requiredText}`);
      if (property.description) {
        console.log(`   Description: ${property.description}`);
      }

      if (property.type === 'string') {
        if (property.enum) {
          console.log(`   Type: Choice`);
          console.log(`   Options:`);
          property.enum.forEach((option: string, index: number) => {
            const label = property.enumNames?.[index] || option;
            console.log(`     ${index + 1}. ${option} - ${label}`);
          });
        } else if (property.format === 'email') {
          console.log(`   Type: Email address`);
        } else {
          console.log(`   Type: Text`);
          if (property.minLength) console.log(`   Min length: ${property.minLength}`);
          if (property.maxLength) console.log(`   Max length: ${property.maxLength}`);
        }
      } else if (property.type === 'number' || property.type === 'integer') {
        console.log(`   Type: ${property.type}`);
        if (property.minimum !== undefined) console.log(`   Min: ${property.minimum}`);
        if (property.maximum !== undefined) console.log(`   Max: ${property.maximum}`);
      } else if (property.type === 'boolean') {
        console.log(`   Type: Yes/No confirmation`);
      }

      if (property.default !== undefined) {
        console.log(`   Default: ${property.default}`);
      }
    }
    console.log('\n================');
  }

  private async collectUserInput(schema: ElicitationRequest['requestedSchema']): Promise<Record<string, any> | null> {
    const result: Record<string, any> = {};

    console.log('\nPlease provide the following information:');

    for (const [key, property] of Object.entries(schema.properties)) {
      const isRequired = schema.required?.includes(key);
      const fieldName = property.title || key;

      while (true) {
        if (property.type === 'string' && property.enum) {
          // Choice field
          console.log(`\n${fieldName}:`);
          property.enum.forEach((option: string, index: number) => {
            const label = property.enumNames?.[index] || option;
            console.log(`  ${index + 1}. ${label}`);
          });

          const choiceInput = await this.question(`Enter choice (1-${property.enum.length})${!isRequired ? ' or press Enter to skip' : ''}: `);

          if (!choiceInput.trim() && !isRequired) {
            break; // Skip optional field
          }

          const choiceIndex = parseInt(choiceInput) - 1;
          if (choiceIndex >= 0 && choiceIndex < property.enum.length) {
            result[key] = property.enum[choiceIndex];
            break;
          } else {
            console.log('❌ Invalid choice. Please try again.');
          }
        } else if (property.type === 'boolean') {
          // Boolean field
          const boolInput = await this.question(`${fieldName} (y/n)${!isRequired ? ' or press Enter to skip' : ''}: `);

          if (!boolInput.trim() && !isRequired) {
            break; // Skip optional field
          }

          const normalizedInput = boolInput.toLowerCase().trim();
          if (normalizedInput === 'y' || normalizedInput === 'yes' || normalizedInput === 'true') {
            result[key] = true;
            break;
          } else if (normalizedInput === 'n' || normalizedInput === 'no' || normalizedInput === 'false') {
            result[key] = false;
            break;
          } else {
            console.log('❌ Please enter y/n, yes/no, or true/false.');
          }
        } else if (property.type === 'number' || property.type === 'integer') {
          // Number field
          const numberInput = await this.question(`${fieldName}${!isRequired ? ' (or press Enter to skip)' : ''}: `);

          if (!numberInput.trim() && !isRequired) {
            break; // Skip optional field
          }

          const parsedNumber = property.type === 'integer' ? parseInt(numberInput) : parseFloat(numberInput);

          if (!isNaN(parsedNumber)) {
            if (property.minimum !== undefined && parsedNumber < property.minimum) {
              console.log(`❌ Value must be at least ${property.minimum}`);
              continue;
            }
            if (property.maximum !== undefined && parsedNumber > property.maximum) {
              console.log(`❌ Value must be at most ${property.maximum}`);
              continue;
            }
            result[key] = parsedNumber;
            break;
          } else {
            console.log('❌ Please enter a valid number.');
          }
        } else {
          // String field
          const stringInput = await this.question(`${fieldName}${!isRequired ? ' (or press Enter to skip)' : ''}: `);

          if (!stringInput.trim() && !isRequired) {
            break; // Skip optional field
          }

          if (stringInput.trim() || !isRequired) {
            if (property.format === 'email') {
              // Basic email validation
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              if (!emailRegex.test(stringInput)) {
                console.log('❌ Please enter a valid email address.');
                continue;
              }
            }

            if (property.minLength && stringInput.length < property.minLength) {
              console.log(`❌ Must be at least ${property.minLength} characters long.`);
              continue;
            }

            if (property.maxLength && stringInput.length > property.maxLength) {
              console.log(`❌ Must be at most ${property.maxLength} characters long.`);
              continue;
            }

            result[key] = stringInput;
            break;
          } else if (isRequired) {
            console.log('❌ This field is required.');
          }
        }
      }
    }

    return result;
  }

  async handleElicitationInterruption(interruption: any): Promise<any> {
    const { request } = interruption;

    console.log('\n🚨 ELICITATION REQUEST');
    console.log('======================');
    console.log(`📝 ${request.message}`);

    this.displaySchema(request.requestedSchema);

    console.log('\nWhat would you like to do?');
    console.log('1. Fill out the form');
    console.log('2. Decline this request');
    console.log('3. Cancel the operation');

    while (true) {
      const action = await this.question('\nEnter your choice (1-3): ');

      if (action === '1') {
        console.log('\n📝 Please fill out the form:');
        const userInput = await this.collectUserInput(request.requestedSchema);

        if (userInput) {
          console.log('\n✅ Form submitted!');
          const response = await this.respondToElicitation(request.id, 'accept', userInput);
          console.log('📤 Response status:', response.success ? 'SUCCESS' : 'FAILED');

          return {
            type: 'elicitation_response',
            requestId: request.id,
            action: 'accept',
            content: userInput,
          };
        }
      } else if (action === '2') {
        console.log('\n❌ Request declined');
        const response = await this.respondToElicitation(request.id, 'decline');
        console.log('📤 Response status:', response.success ? 'SUCCESS' : 'FAILED');

        return {
          type: 'elicitation_response',
          requestId: request.id,
          action: 'decline',
        };
      } else if (action === '3') {
        console.log('\n🚫 Operation cancelled');
        const response = await this.respondToElicitation(request.id, 'cancel');
        console.log('📤 Response status:', response.success ? 'SUCCESS' : 'FAILED');

        return {
          type: 'elicitation_response',
          requestId: request.id,
          action: 'cancel',
        };
      } else {
        console.log('❌ Invalid choice. Please enter 1, 2, or 3.');
      }
    }
  }

  async runInteractiveDemo(): Promise<void> {
    console.log('🎯 Interactive Elicitation Demo');
    console.log('===============================');
    console.log(`📡 Connected to: ${this.baseUrl}`);
    console.log(`💬 Conversation ID: ${this.conversationId}`);
    console.log('');
    console.log('This demo lets you manually interact with elicitation requests.');
    console.log('You can test different tools and respond to forms yourself.');
    console.log('');
    console.log('Available commands to try:');
    console.log('- "Collect my contact information"');
    console.log('- "Get my programming preferences"');
    console.log('- "Ask for feedback on the interface"');
    console.log('- "Confirm account deletion"');
    console.log('- "Ask how many items I need"');
    console.log('- "quit" to exit');
    console.log('');

    // Start the recursive conversation loop
    await this.conversationLoop([]);
  }

  /**
   * Recursive conversation loop following JAF patterns
   */
  private async conversationLoop(conversationHistory: ChatMessage[]): Promise<void> {
    try {
      const userMessage = await this.question('💭 Your message: ');

      if (userMessage.toLowerCase().trim() === 'quit') {
        console.log('\n👋 Goodbye!');
        return;
      }

      if (!userMessage.trim()) {
        console.log('❌ Please enter a message or "quit" to exit.');
        return this.conversationLoop(conversationHistory);
      }

      console.log('\n⏳ Processing...');

      // Process the conversation turn
      const result = await this.processConversationTurn(userMessage, conversationHistory);

      if (result.shouldContinue) {
        console.log('\n' + '='.repeat(50));
        // Recursive call to continue the conversation
        return this.conversationLoop(result.newHistory);
      }

    } catch (error) {
      console.error('\n❌ Demo error:', error);
      console.log('Please make sure the server is running and try again.');
      // Continue the conversation even after errors
      return this.conversationLoop(conversationHistory);
    }
  }

  /**
   * Process a single conversation turn with proper interruption handling
   */
  private async processConversationTurn(
    userInput: string,
    conversationHistory: ChatMessage[]
  ): Promise<{ newHistory: ChatMessage[]; shouldContinue: boolean }> {

    // Add user message to conversation
    const newHistory: ChatMessage[] = [...conversationHistory, { role: 'user' as const, content: userInput }];

    // Initial request to the server
    let response = await this.sendMessage(userInput);

    // Handle interruptions (following JAF pattern)
    for (;;) {
      if (response.data?.outcome.status === 'interrupted') {
        const interruptions = response.data.outcome.interruptions || [];
        const elicitationResponses: any[] = [];

        for (const interruption of interruptions) {
          if (interruption.type === 'elicitation') {
            const elicitationResponse = await this.handleElicitationInterruption(interruption);
            elicitationResponses.push(elicitationResponse);
          }
        }

        if (elicitationResponses.length > 0) {
          console.log('\n🔄 Continuing conversation with your responses...');
          response = await this.sendMessage('', elicitationResponses);
          // Continue the loop to handle any further interruptions
          continue;
        }
      } else if (response.data?.outcome.status === 'completed') {
        // Extract final assistant response
        if (response.data?.messages) {
          const lastMessage = response.data.messages.slice(-1)[0];
          if (lastMessage?.role === 'assistant') {
            console.log('\n🤖 Assistant Response:');
            console.log('======================');
            console.log(lastMessage.content);

            // Add assistant response to conversation history
            const finalHistory = [...newHistory, { role: 'assistant' as const, content: lastMessage.content }];
            return { newHistory: finalHistory, shouldContinue: true };
          }
        }
        return { newHistory, shouldContinue: true };
      } else if (response.data?.outcome.status === 'error') {
        console.log('\n❌ Error:', response.data.outcome.error);
        return { newHistory, shouldContinue: true };
      }

      // If we get here, something unexpected happened - break to avoid infinite loop
      break;
    }

    return { newHistory, shouldContinue: true };
  }

  close(): void {
    this.rl.close();
  }
}

async function main() {
  const client = new ElicitationClient();

  try {
    await client.runInteractiveDemo();
  } finally {
    client.close();
  }
}

// Run the demo
main().catch(console.error);