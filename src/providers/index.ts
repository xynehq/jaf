// Public provider entrypoint: re-export provider modules
// This backs the `@xynehq/jaf/providers` subpath export declared in package.json

export * from './model';
export * from './mcp';
export {
  createAiSdkProvider,
  type AiSdkFunctionTool,
  type AiSdkChatMessageParam,
  type AiSdkChatRequest,
  type AiSdkChatResponse,
  type AiSdkClient,
} from './ai-sdk';

// Export type definitions for external use
export type {
  ProxyConfig,
  ProxyAgentResult,
  ClientConfig,
  JsonSchema,
  VisionModelInfo,
  VisionApiResponse,
  VisionModelCacheEntry
} from './types';

export type {
  MCPClient,
  MCPToolDefinition,
  MCPClientOptions
} from './mcp-types';

export type {
  ToolCall,
  ToolCallFunction,
  Usage,
  GenerateObjectResult,
  GenerateObjectOptions,
  SafeJsonParseResult
} from './ai-sdk-types';

