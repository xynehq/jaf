/**
 * JAF ADK Layer - Content System Tests
 */

import {
  createContent,
  createUserMessage,
  createModelMessage,
  createSystemMessage,
  createTextPart,
  createImagePart,
  createAudioPart,
  createFunctionCallPart,
  createFunctionResponsePart,
  createFunctionCall,
  createFunctionResponse,
  addPart,
  addTextPart,
  addFunctionCall,
  addFunctionResponse,
  getTextContent,
  getFunctionCalls,
  getFunctionResponses,
  hasTextContent,
  hasFunctionCalls,
  hasFunctionResponses,
  contentToString,
  parseContent,
  isValidContent,
  isValidPart,
  mergeContent,
  cloneContent,
  filterContentByRole,
  getLastUserMessage,
  getLastModelMessage,
  getContentStats,
  getConversationStats
} from '../content/index.js';

describe('Content System', () => {
  describe('Content Creation', () => {
    test('createContent should create valid content', () => {
      const content = createContent('user', 'Hello world');
      
      expect(content.role).toBe('user');
      expect(content.parts).toHaveLength(1);
      expect(content.parts[0].type).toBe('text');
      expect(content.parts[0].text).toBe('Hello world');
    });

    test('createUserMessage should create user content', () => {
      const content = createUserMessage('User message');
      
      expect(content.role).toBe('user');
      expect(getTextContent(content)).toBe('User message');
    });

    test('createModelMessage should create model content', () => {
      const content = createModelMessage('Model response');
      
      expect(content.role).toBe('model');
      expect(getTextContent(content)).toBe('Model response');
    });

    test('createSystemMessage should create system content', () => {
      const content = createSystemMessage('System instruction');
      
      expect(content.role).toBe('system');
      expect(getTextContent(content)).toBe('System instruction');
    });

    test('createContent with metadata should preserve metadata', () => {
      const metadata = { timestamp: Date.now(), custom: 'value' };
      const content = createContent('user', 'Test', metadata);
      
      expect(content.metadata).toEqual(metadata);
    });
  });

  describe('Part Creation', () => {
    test('createTextPart should create text part', () => {
      const part = createTextPart('Hello');
      
      expect(part.type).toBe('text');
      expect(part.text).toBe('Hello');
    });

    test('createImagePart should create image part', () => {
      const imageData = new ArrayBuffer(10);
      const part = createImagePart(imageData);
      
      expect(part.type).toBe('image');
      expect(part.data).toBe(imageData);
    });

    test('createAudioPart should create audio part', () => {
      const audioData = 'base64audiodata';
      const part = createAudioPart(audioData);
      
      expect(part.type).toBe('audio');
      expect(part.data).toBe(audioData);
    });

    test('createFunctionCallPart should create function call part', () => {
      const functionCall = createFunctionCall('call_1', 'test_function', { arg: 'value' });
      const part = createFunctionCallPart(functionCall);
      
      expect(part.type).toBe('function_call');
      expect(part.functionCall).toEqual(functionCall);
    });

    test('createFunctionResponsePart should create function response part', () => {
      const functionResponse = createFunctionResponse('call_1', 'test_function', 'result');
      const part = createFunctionResponsePart(functionResponse);
      
      expect(part.type).toBe('function_response');
      expect(part.functionResponse).toEqual(functionResponse);
    });
  });

  describe('Function Call/Response', () => {
    test('createFunctionCall should create valid function call', () => {
      const call = createFunctionCall('call_123', 'get_weather', { location: 'Tokyo' });
      
      expect(call.id).toBe('call_123');
      expect(call.name).toBe('get_weather');
      expect(call.args).toEqual({ location: 'Tokyo' });
    });

    test('createFunctionResponse should create successful response', () => {
      const response = createFunctionResponse('call_123', 'get_weather', { temp: 25 }, true);
      
      expect(response.id).toBe('call_123');
      expect(response.name).toBe('get_weather');
      expect(response.response).toEqual({ temp: 25 });
      expect(response.success).toBe(true);
      expect(response.error).toBeUndefined();
    });

    test('createFunctionResponse should create error response', () => {
      const response = createFunctionResponse('call_123', 'get_weather', null, false, 'API error');
      
      expect(response.id).toBe('call_123');
      expect(response.success).toBe(false);
      expect(response.error).toBe('API error');
    });
  });

  describe('Content Manipulation', () => {
    test('addPart should add part to content', () => {
      const content = createUserMessage('Hello');
      const newPart = createTextPart(' world');
      const updated = addPart(content, newPart);
      
      expect(updated.parts).toHaveLength(2);
      expect(updated.parts[1]).toEqual(newPart);
      expect(updated).not.toBe(content); // Should be immutable
    });

    test('addTextPart should add text part', () => {
      const content = createUserMessage('Hello');
      const updated = addTextPart(content, ' world');
      
      expect(updated.parts).toHaveLength(2);
      expect(updated.parts[1].type).toBe('text');
      expect(updated.parts[1].text).toBe(' world');
    });

    test('addFunctionCall should add function call', () => {
      const content = createUserMessage('Call function');
      const functionCall = createFunctionCall('call_1', 'test', {});
      const updated = addFunctionCall(content, functionCall);
      
      expect(updated.parts).toHaveLength(2);
      expect(updated.parts[1].type).toBe('function_call');
      expect(updated.parts[1].functionCall).toEqual(functionCall);
    });

    test('addFunctionResponse should add function response', () => {
      const content = createModelMessage('Response');
      const functionResponse = createFunctionResponse('call_1', 'test', 'result');
      const updated = addFunctionResponse(content, functionResponse);
      
      expect(updated.parts).toHaveLength(2);
      expect(updated.parts[1].type).toBe('function_response');
      expect(updated.parts[1].functionResponse).toEqual(functionResponse);
    });
  });

  describe('Content Query Functions', () => {
    test('getTextContent should extract text from all text parts', () => {
      const content = createContent('user', 'Hello');
      const withMore = addTextPart(content, ' world');
      
      expect(getTextContent(withMore)).toBe('Hello world');
    });

    test('getFunctionCalls should extract all function calls', () => {
      const content = createUserMessage('Test');
      const call1 = createFunctionCall('call_1', 'func1', {});
      const call2 = createFunctionCall('call_2', 'func2', {});
      
      let updated = addFunctionCall(content, call1);
      updated = addFunctionCall(updated, call2);
      
      const calls = getFunctionCalls(updated);
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual(call1);
      expect(calls[1]).toEqual(call2);
    });

    test('getFunctionResponses should extract all function responses', () => {
      const content = createModelMessage('Test');
      const response1 = createFunctionResponse('call_1', 'func1', 'result1');
      const response2 = createFunctionResponse('call_2', 'func2', 'result2');
      
      let updated = addFunctionResponse(content, response1);
      updated = addFunctionResponse(updated, response2);
      
      const responses = getFunctionResponses(updated);
      expect(responses).toHaveLength(2);
      expect(responses[0]).toEqual(response1);
      expect(responses[1]).toEqual(response2);
    });

    test('hasTextContent should detect text presence', () => {
      const withText = createUserMessage('Hello');
      const withoutText = createContent('user', '');
      withoutText.parts = []; // Remove text part
      
      expect(hasTextContent(withText)).toBe(true);
      expect(hasTextContent(withoutText)).toBe(false);
    });

    test('hasFunctionCalls should detect function calls', () => {
      const content = createUserMessage('Test');
      const withCall = addFunctionCall(content, createFunctionCall('1', 'test', {}));
      
      expect(hasFunctionCalls(content)).toBe(false);
      expect(hasFunctionCalls(withCall)).toBe(true);
    });

    test('hasFunctionResponses should detect function responses', () => {
      const content = createModelMessage('Test');
      const withResponse = addFunctionResponse(content, createFunctionResponse('1', 'test', 'result'));
      
      expect(hasFunctionResponses(content)).toBe(false);
      expect(hasFunctionResponses(withResponse)).toBe(true);
    });
  });

  describe('Content Conversion', () => {
    test('contentToString should create string representation', () => {
      const content = createUserMessage('Hello');
      const functionCall = createFunctionCall('call_1', 'test_func', { arg: 'value' });
      const functionResponse = createFunctionResponse('call_1', 'test_func', 'result');
      
      let updated = addFunctionCall(content, functionCall);
      updated = addFunctionResponse(updated, functionResponse);
      
      const str = contentToString(updated);
      
      expect(str).toContain('Hello');
      expect(str).toContain('[FUNCTION_CALL: test_func');
      expect(str).toContain('[FUNCTION_RESPONSE: test_func');
    });

    test('parseContent should parse string to content', () => {
      const content = parseContent('Hello world');
      
      expect(content.role).toBe('user');
      expect(getTextContent(content)).toBe('Hello world');
    });

    test('parseContent should parse object to content', () => {
      const obj = { text: 'Hello', role: 'model' };
      const content = parseContent(obj);
      
      expect(content.role).toBe('model');
      expect(getTextContent(content)).toBe('Hello');
    });

    test('parseContent should handle existing content objects', () => {
      const original = createUserMessage('Test');
      const parsed = parseContent(original);
      
      expect(parsed).toEqual(original);
    });

    test('parseContent should throw for invalid input', () => {
      expect(() => parseContent(123)).toThrow();
      expect(() => parseContent(null)).toThrow();
    });
  });

  describe('Content Validation', () => {
    test('isValidContent should validate correct content', () => {
      const content = createUserMessage('Test');
      expect(isValidContent(content)).toBe(true);
    });

    test('isValidContent should reject invalid content', () => {
      expect(isValidContent(null)).toBe(false);
      expect(isValidContent({})).toBe(false);
      expect(isValidContent({ role: 'invalid' })).toBe(false);
      expect(isValidContent({ role: 'user', parts: 'not-array' })).toBe(false);
    });

    test('isValidPart should validate correct parts', () => {
      const textPart = createTextPart('Test');
      const imagePart = createImagePart('data');
      
      expect(isValidPart(textPart)).toBe(true);
      expect(isValidPart(imagePart)).toBe(true);
    });

    test('isValidPart should reject invalid parts', () => {
      expect(isValidPart(null)).toBe(false);
      expect(isValidPart({})).toBe(false);
      expect(isValidPart({ type: 'invalid' })).toBe(false);
    });
  });

  describe('Content Utilities', () => {
    test('mergeContent should combine multiple contents', () => {
      const content1 = createUserMessage('Hello');
      const content2 = createUserMessage(' world');
      const content3 = createUserMessage('!');
      
      const merged = mergeContent(content1, content2, content3);
      
      expect(merged.parts).toHaveLength(3);
      expect(merged.role).toBe('user');
    });

    test('mergeContent should handle empty array', () => {
      const merged = mergeContent();
      expect(getTextContent(merged)).toBe('');
    });

    test('mergeContent should handle single content', () => {
      const content = createUserMessage('Single');
      const merged = mergeContent(content);
      
      expect(merged).toEqual(content);
    });

    test('cloneContent should create deep copy', () => {
      const original = createUserMessage('Test');
      const cloned = cloneContent(original);
      
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.parts).not.toBe(original.parts);
    });

    test('filterContentByRole should filter by role', () => {
      const contents = [
        createUserMessage('User 1'),
        createModelMessage('Model 1'),
        createUserMessage('User 2'),
        createSystemMessage('System 1')
      ];
      
      const userContents = filterContentByRole(contents, 'user');
      const modelContents = filterContentByRole(contents, 'model');
      
      expect(userContents).toHaveLength(2);
      expect(modelContents).toHaveLength(1);
      expect(userContents.every(c => c.role === 'user')).toBe(true);
    });

    test('getLastUserMessage should get last user message', () => {
      const contents = [
        createUserMessage('User 1'),
        createModelMessage('Model 1'),
        createUserMessage('User 2')
      ];
      
      const lastUser = getLastUserMessage(contents);
      expect(lastUser).not.toBeNull();
      expect(getTextContent(lastUser!)).toBe('User 2');
    });

    test('getLastModelMessage should get last model message', () => {
      const contents = [
        createModelMessage('Model 1'),
        createUserMessage('User 1'),
        createModelMessage('Model 2')
      ];
      
      const lastModel = getLastModelMessage(contents);
      expect(lastModel).not.toBeNull();
      expect(getTextContent(lastModel!)).toBe('Model 2');
    });

    test('should return null when no messages of specified role exist', () => {
      const contents = [createSystemMessage('System only')];
      
      expect(getLastUserMessage(contents)).toBeNull();
      expect(getLastModelMessage(contents)).toBeNull();
    });
  });

  describe('Content Statistics', () => {
    test('getContentStats should calculate content statistics', () => {
      const content = createUserMessage('Hello world');
      const withCall = addFunctionCall(content, createFunctionCall('1', 'test', {}));
      const withImage = addPart(withCall, createImagePart('image_data'));
      
      const stats = getContentStats(withImage);
      
      expect(stats.totalParts).toBe(3);
      expect(stats.textParts).toBe(1);
      expect(stats.imageParts).toBe(1);
      expect(stats.functionCallParts).toBe(1);
      expect(stats.textLength).toBe(11);
      expect(stats.hasMedia).toBe(true);
      expect(stats.hasFunctions).toBe(true);
    });

    test('getConversationStats should calculate conversation statistics', () => {
      const contents = [
        createUserMessage('User message'),
        createModelMessage('Model response'),
        createSystemMessage('System instruction'),
        addFunctionCall(createUserMessage('With call'), createFunctionCall('1', 'test', {}))
      ];
      
      const stats = getConversationStats(contents);
      
      expect(stats.totalMessages).toBe(4);
      expect(stats.userMessages).toBe(2);
      expect(stats.modelMessages).toBe(1);
      expect(stats.systemMessages).toBe(1);
      expect(stats.totalFunctionCalls).toBe(1);
      expect(stats.averageMessageLength).toBeGreaterThan(0);
    });

    test('getConversationStats should handle empty conversation', () => {
      const stats = getConversationStats([]);
      
      expect(stats.totalMessages).toBe(0);
      expect(stats.averageMessageLength).toBe(0);
    });
  });
});