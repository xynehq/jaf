/**
 * JAF ADK Layer - Content System
 * 
 * Functional content and message handling utilities
 */

import { Content, Part, FunctionCall, FunctionResponse } from '../types.js';

// ========== Content Creation ==========

export const createContent = (
  role: 'user' | 'model' | 'system',
  text: string,
  metadata?: Record<string, unknown>
): Content => ({
  role,
  parts: [createTextPart(text)],
  metadata
});

export const createUserMessage = (text: string, metadata?: Record<string, unknown>): Content =>
  createContent('user', text, metadata);

export const createModelMessage = (text: string, metadata?: Record<string, unknown>): Content =>
  createContent('model', text, metadata);

export const createSystemMessage = (text: string, metadata?: Record<string, unknown>): Content =>
  createContent('system', text, metadata);

// ========== Part Creation ==========

export const createTextPart = (text: string, metadata?: Record<string, unknown>): Part => ({
  type: 'text',
  text,
  metadata
});

export const createImagePart = (data: ArrayBuffer | string, metadata?: Record<string, unknown>): Part => ({
  type: 'image',
  data,
  metadata
});

export const createAudioPart = (data: ArrayBuffer | string, metadata?: Record<string, unknown>): Part => ({
  type: 'audio',
  data,
  metadata
});

export const createFunctionCallPart = (functionCall: FunctionCall, metadata?: Record<string, unknown>): Part => ({
  type: 'function_call',
  functionCall,
  metadata
});

export const createFunctionResponsePart = (functionResponse: FunctionResponse, metadata?: Record<string, unknown>): Part => ({
  type: 'function_response',
  functionResponse,
  metadata
});

// ========== Function Call/Response Creation ==========

export const createFunctionCall = (
  id: string,
  name: string,
  args: Record<string, unknown>
): FunctionCall => ({
  id,
  name,
  args
});

export const createFunctionResponse = (
  id: string,
  name: string,
  response: unknown,
  success: boolean = true,
  error?: string
): FunctionResponse => ({
  id,
  name,
  response,
  success,
  error
});

// ========== Content Manipulation ==========

export const addPart = (content: Content, part: Part): Content => ({
  ...content,
  parts: [...content.parts, part]
});

export const addTextPart = (content: Content, text: string): Content =>
  addPart(content, createTextPart(text));

export const addFunctionCall = (content: Content, functionCall: FunctionCall): Content =>
  addPart(content, createFunctionCallPart(functionCall));

export const addFunctionResponse = (content: Content, functionResponse: FunctionResponse): Content =>
  addPart(content, createFunctionResponsePart(functionResponse));

// ========== Content Query Functions ==========

export const getTextContent = (content: Content): string => {
  return content.parts
    .filter(part => part.type === 'text' && part.text)
    .map(part => part.text)
    .join('');
};

export const getFunctionCalls = (content: Content): FunctionCall[] => {
  return content.parts
    .filter(part => part.type === 'function_call' && part.functionCall)
    .map(part => part.functionCall!)
    .filter(Boolean);
};

export const getFunctionResponses = (content: Content): FunctionResponse[] => {
  return content.parts
    .filter(part => part.type === 'function_response' && part.functionResponse)
    .map(part => part.functionResponse!)
    .filter(Boolean);
};

export const hasTextContent = (content: Content): boolean => {
  return content.parts.some(part => part.type === 'text' && part.text);
};

export const hasFunctionCalls = (content: Content): boolean => {
  return content.parts.some(part => part.type === 'function_call');
};

export const hasFunctionResponses = (content: Content): boolean => {
  return content.parts.some(part => part.type === 'function_response');
};

// ========== Content Conversion ==========

export const contentToString = (content: Content): string => {
  const textContent = getTextContent(content);
  const functionCalls = getFunctionCalls(content);
  const functionResponses = getFunctionResponses(content);
  
  let result = textContent;
  
  if (functionCalls.length > 0) {
    const callsStr = functionCalls
      .map(call => `[FUNCTION_CALL: ${call.name}(${JSON.stringify(call.args)})]`)
      .join(' ');
    result += (result ? ' ' : '') + callsStr;
  }
  
  if (functionResponses.length > 0) {
    const responsesStr = functionResponses
      .map(response => `[FUNCTION_RESPONSE: ${response.name} -> ${JSON.stringify(response.response)}]`)
      .join(' ');
    result += (result ? ' ' : '') + responsesStr;
  }
  
  return result;
};

export const parseContent = (raw: unknown): Content => {
  if (typeof raw === 'string') {
    return createUserMessage(raw);
  }
  
  if (typeof raw === 'object' && raw !== null) {
    // Try to parse as existing Content object
    if ('role' in raw && 'parts' in raw) {
      return raw as Content;
    }
    
    // Try to parse as simple message object
    if ('text' in raw || 'message' in raw) {
      const text = (raw as any).text || (raw as any).message;
      const role = (raw as any).role || 'user';
      return createContent(role, text);
    }
  }
  
  throw new Error(`Cannot parse content from: ${JSON.stringify(raw)}`);
};

// ========== Content Validation ==========

export const isValidContent = (content: unknown): content is Content => {
  if (typeof content !== 'object' || content === null) {
    return false;
  }
  
  const c = content as any;
  
  return (
    typeof c.role === 'string' &&
    ['user', 'model', 'system'].includes(c.role) &&
    Array.isArray(c.parts) &&
    c.parts.every(isValidPart)
  );
};

export const isValidPart = (part: unknown): part is Part => {
  if (typeof part !== 'object' || part === null) {
    return false;
  }
  
  const p = part as any;
  
  return (
    typeof p.type === 'string' &&
    ['text', 'image', 'audio', 'function_call', 'function_response'].includes(p.type)
  );
};

// ========== Content Utilities ==========

export const mergeContent = (...contents: Content[]): Content => {
  if (contents.length === 0) {
    return createUserMessage('');
  }
  
  if (contents.length === 1) {
    return contents[0];
  }
  
  const [first, ...rest] = contents;
  const allParts = [first, ...rest].flatMap(c => c.parts);
  
  return {
    ...first,
    parts: allParts
  };
};

export const cloneContent = (content: Content): Content => ({
  ...content,
  parts: content.parts.map(part => ({ ...part })),
  metadata: content.metadata ? { ...content.metadata } : undefined
});

export const filterContentByRole = (contents: Content[], role: Content['role']): Content[] => {
  return contents.filter(content => content.role === role);
};

export const getLastUserMessage = (contents: Content[]): Content | null => {
  const userMessages = filterContentByRole(contents, 'user');
  return userMessages.length > 0 ? userMessages[userMessages.length - 1] : null;
};

export const getLastModelMessage = (contents: Content[]): Content | null => {
  const modelMessages = filterContentByRole(contents, 'model');
  return modelMessages.length > 0 ? modelMessages[modelMessages.length - 1] : null;
};

// ========== Content Statistics ==========

export const getContentStats = (content: Content) => {
  const textParts = content.parts.filter(p => p.type === 'text').length;
  const imageParts = content.parts.filter(p => p.type === 'image').length;
  const audioParts = content.parts.filter(p => p.type === 'audio').length;
  const functionCallParts = content.parts.filter(p => p.type === 'function_call').length;
  const functionResponseParts = content.parts.filter(p => p.type === 'function_response').length;
  
  const textLength = getTextContent(content).length;
  
  return {
    totalParts: content.parts.length,
    textParts,
    imageParts,
    audioParts,
    functionCallParts,
    functionResponseParts,
    textLength,
    hasMedia: imageParts > 0 || audioParts > 0,
    hasFunctions: functionCallParts > 0 || functionResponseParts > 0
  };
};

export const getConversationStats = (contents: Content[]) => {
  const userMessages = filterContentByRole(contents, 'user').length;
  const modelMessages = filterContentByRole(contents, 'model').length;
  const systemMessages = filterContentByRole(contents, 'system').length;
  
  const totalTextLength = contents
    .map(getTextContent)
    .reduce((sum, text) => sum + text.length, 0);
    
  const totalFunctionCalls = contents
    .flatMap(getFunctionCalls).length;
    
  const totalFunctionResponses = contents
    .flatMap(getFunctionResponses).length;
  
  return {
    totalMessages: contents.length,
    userMessages,
    modelMessages,
    systemMessages,
    totalTextLength,
    totalFunctionCalls,
    totalFunctionResponses,
    averageMessageLength: contents.length > 0 ? totalTextLength / contents.length : 0
  };
};