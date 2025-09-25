/**
 * Type definitions for AI SDK provider
 */

import { LanguageModel, JSONValue } from 'ai';

export interface AiSdkFunctionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallFunction {
  name: string;
  arguments: string | Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
}

export type AiSdkChatMessageParam =
  | { role: 'system'; content: string }
  | {
      role: 'user' | 'assistant' | 'tool';
      content: string | null;
      tool_calls?: ToolCall[];
      tool_call_id?: string;
    };

export interface AiSdkChatRequest {
  model: string;
  messages: AiSdkChatMessageParam[];
  temperature?: number;
  max_tokens?: number;
  maxTokens?: number;
  tools?: AiSdkFunctionTool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'json_object' };
  [key: string]: unknown;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface AiSdkChatResponse {
  message?: {
    content?: string | null;
    tool_calls?: ToolCall[];
  };
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
  text?: string | null;
  id?: string;
  model?: string;
  created?: number;
  usage?: Usage;
  [key: string]: unknown;
}

export interface AiSdkClient {
  chat: (request: AiSdkChatRequest) => Promise<AiSdkChatResponse>;
}

export interface GenerateObjectResult {
  object: unknown;
}

export interface GenerateObjectOptions {
  model: LanguageModel;
  schema: unknown;
  system?: string;
  messages: unknown[];
  temperature?: number;
  maxOutputTokens?: number;
}

export type SafeJsonParseResult = JSONValue;