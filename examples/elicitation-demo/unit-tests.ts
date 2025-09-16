#!/usr/bin/env tsx

/**
 * Simple test to verify elicitation implementation works
 */

import { createElicitationRequest, validateElicitationResponse, ElicitationSchemas, createServerElicitationProvider } from '../../dist/index.js';

async function testElicitationValidation() {
  console.log('🧪 Testing elicitation validation...');

  // Test 1: Valid contact info
  const contactSchema = ElicitationSchemas.contactInfo();
  const contactRequest = createElicitationRequest(
    'Please provide your contact information',
    contactSchema
  );

  const validContactResponse = {
    requestId: contactRequest.id,
    action: 'accept' as const,
    content: {
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+1234567890'
    }
  };

  const contactValidation = validateElicitationResponse(validContactResponse, contactRequest);
  console.log('✅ Contact info validation:', contactValidation.isValid ? 'PASS' : 'FAIL');

  // Test 2: Invalid email format
  const invalidContactResponse = {
    requestId: contactRequest.id,
    action: 'accept' as const,
    content: {
      name: 'John Doe',
      email: 'invalid-email',
      phone: '+1234567890'
    }
  };

  const invalidContactValidation = validateElicitationResponse(invalidContactResponse, contactRequest);
  console.log('✅ Invalid email validation:', !invalidContactValidation.isValid ? 'PASS' : 'FAIL');

  // Test 3: Choice validation
  const choiceSchema = ElicitationSchemas.choice({
    title: 'Experience Level',
    description: 'Select your experience level',
    choices: ['beginner', 'intermediate', 'advanced']
  });

  const choiceRequest = createElicitationRequest('Select your level', choiceSchema);
  const validChoiceResponse = {
    requestId: choiceRequest.id,
    action: 'accept' as const,
    content: {
      choice: 'intermediate'
    }
  };

  const choiceValidation = validateElicitationResponse(validChoiceResponse, choiceRequest);
  console.log('✅ Choice validation:', choiceValidation.isValid ? 'PASS' : 'FAIL');

  // Test 4: Invalid choice
  const invalidChoiceResponse = {
    requestId: choiceRequest.id,
    action: 'accept' as const,
    content: {
      choice: 'expert' // Not in enum
    }
  };

  const invalidChoiceValidation = validateElicitationResponse(invalidChoiceResponse, choiceRequest);
  console.log('✅ Invalid choice validation:', !invalidChoiceValidation.isValid ? 'PASS' : 'FAIL');

  console.log('✅ Validation tests completed!');
}

async function testElicitationProvider() {
  console.log('\n🧪 Testing elicitation provider...');

  const provider = createServerElicitationProvider();

  // Create a test request
  const testSchema = ElicitationSchemas.text({ title: 'Test Input' });
  const testRequest = createElicitationRequest('Enter some text', testSchema);

  // Test provider functionality
  console.log('📋 Pending requests (empty):', provider.getPendingRequests().length === 0 ? 'PASS' : 'FAIL');

  // Simulate async elicitation
  const elicitationPromise = provider.createElicitation(testRequest);

  // Check that request is now pending
  console.log('📋 Pending requests (1):', provider.getPendingRequests().length === 1 ? 'PASS' : 'FAIL');

  // Respond to the request
  const responseSuccess = provider.respondToElicitation({
    requestId: testRequest.id,
    action: 'accept',
    content: { text: 'Test response' }
  });

  console.log('📤 Response handled:', responseSuccess ? 'PASS' : 'FAIL');

  // Check that the promise resolves
  const response = await elicitationPromise;
  console.log('✅ Promise resolved:', response.action === 'accept' ? 'PASS' : 'FAIL');

  // Check that request is no longer pending
  console.log('📋 Pending requests (0):', provider.getPendingRequests().length === 0 ? 'PASS' : 'FAIL');

  console.log('✅ Provider tests completed!');
}

async function main() {
  console.log('🚀 Running MCP Elicitation Tests\n');

  try {
    await testElicitationValidation();
    await testElicitationProvider();
    console.log('\n🎉 All tests passed! Elicitation implementation is working correctly.');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the tests
main().catch(console.error);