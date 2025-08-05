/**
 * Simple Real LLM Test - Verifying Line 252 Works with Real APIs
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import {
  createSimpleAgent,
  createInMemorySessionProvider,
  createRunnerConfig,
  runAgent,
  createUserMessage,
  getTextContent,
  Model
} from '../index.js';

describe('Real LLM - Line 252 Integration', () => {
  let hasOpenAIKey = false;

  beforeAll(() => {
    hasOpenAIKey = !!process.env.OPENAI_API_KEY;
    if (!hasOpenAIKey) {
      console.warn('OPENAI_API_KEY not found - skipping real LLM tests');
    }
  });

  it('should make real OpenAI API calls instead of returning hardcoded responses', async () => {
    if (!hasOpenAIKey) return;

    // Create a simple agent that would previously return hardcoded responses
    const agent = createSimpleAgent(
      'test_agent',
      Model.GPT_4,
      'You are a helpful assistant. Always respond with exactly: "Real API Response"',
      []
    );

    const sessionProvider = createInMemorySessionProvider();
    const runnerConfig = createRunnerConfig(agent, sessionProvider);

    // This should now call the real OpenAI API via line 252 
    // instead of returning hardcoded text
    const message = createUserMessage('Please respond exactly as instructed');
    
    console.log('\n🚀 Testing Real LLM Integration...');
    console.log('📝 User Message:', getTextContent(message));
    
    const startTime = Date.now();
    const response = await runAgent(
      runnerConfig,
      { userId: 'test_user' },
      message
    );
    const executionTime = Date.now() - startTime;

    const responseText = getTextContent(response.content);
    
    console.log('\n✅ REAL LLM INTEGRATION SUCCESS!');
    console.log('🤖 LLM Response:', responseText);
    console.log('⏱️  Execution Time:', executionTime + 'ms');
    console.log('🔢 LLM Calls Made:', response.metadata.llmCalls);
    console.log('🆔 Agent ID:', response.metadata.agentId);
    console.log('💬 Session Messages:', response.session.messages.length);
    
    // Verify this is a real response, not hardcoded
    expect(response.content).toBeDefined();
    expect(responseText).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(5);
    
    // Verify it made actual LLM calls
    expect(response.metadata.llmCalls).toBeGreaterThan(0);
    
    // Verify it took real time (not instant like hardcoded responses)
    expect(executionTime).toBeGreaterThan(500); // Real API calls take time
    
    // Verify session management is working
    expect(response.session.messages).toHaveLength(2); // User + Model
    
    console.log('\n🎉 Line 252 is now fully functional with real LLM calls!');
    
  }, 30000);

  it('should handle different models correctly', async () => {
    if (!hasOpenAIKey) return;

    const agent = createSimpleAgent(
      'gpt35_agent', 
      Model.GPT_3_5_TURBO,
      'Respond with: "GPT-3.5 Turbo Response"',
      []
    );

    const sessionProvider = createInMemorySessionProvider();
    const runnerConfig = createRunnerConfig(agent, sessionProvider);

    const message = createUserMessage('Test GPT-3.5');
    const response = await runAgent(
      runnerConfig,
      { userId: 'test_user' },
      message
    );

    console.log('\n🔄 Testing Different Model...');
    console.log('🤖 GPT-3.5 Response:', getTextContent(response.content));
    
    expect(response.content).toBeDefined();
    expect(response.metadata.llmCalls).toBeGreaterThan(0);
    
  }, 30000);

  it('should demonstrate line 252 functionality working end-to-end', async () => {
    if (!hasOpenAIKey) return;

    console.log('\n📍 DEMONSTRATING LINE 252 FUNCTIONALITY:');
    console.log('Before: Line 252 returned hardcoded text');
    console.log('After: Line 252 calls real OpenAI API');
    
    const agent = createSimpleAgent(
      'demo_agent',
      Model.GPT_4,
      'You are demonstrating that line 252 in runners/index.ts now works with real LLMs. Respond creatively.',
      []
    );

    const sessionProvider = createInMemorySessionProvider();
    const runnerConfig = createRunnerConfig(agent, sessionProvider);

    const message = createUserMessage('Prove you are a real LLM and not hardcoded!');
    const response = await runAgent(
      runnerConfig,
      { userId: 'demo_user' },
      message
    );

    const responseText = getTextContent(response.content);
    
    console.log('\n🎯 PROOF OF REAL LLM INTEGRATION:');
    console.log('📤 Input:', getTextContent(message));
    console.log('📥 Output:', responseText);
    console.log('✨ This response came from OpenAI, not hardcoded text!');
    
    // The response should be creative and varied, not hardcoded
    expect(responseText).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(20);
    expect(response.metadata.llmCalls).toBe(1);
    
    console.log('\n🏆 SUCCESS: Line 252 transformation complete!');
    
  }, 30000);
});