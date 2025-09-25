/**
 * Type definitions for MCP (Model Context Protocol) provider
 */

import { z } from 'zod';

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  enum?: string[];
  items?: JsonSchema;
  [key: string]: unknown;
}

export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

export interface MCPContentItem {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface MCPToolResponse {
  content?: MCPContentItem[];
  [key: string]: unknown;
}

export interface MCPClient {
  listTools(): Promise<MCPToolDefinition[]>;
  callTool(name: string, args: unknown): Promise<string>;
  close(): Promise<void>;
}

export interface MCPClientOptions {
  headers?: Record<string, string>;
  sessionId?: string;
  fetch?: typeof fetch;
  requestInit?: RequestInit;
}

export interface EventSourceModule {
  default?: unknown;
  [key: string]: unknown;
}

export type ZodSchemaType = z.ZodType<unknown>;

export interface MCPToolConversionResult<Ctx> {
  schema: {
    name: string;
    description: string;
    parameters: z.ZodObject<Record<string, ZodSchemaType>>;
  };
  execute: (args: unknown, ctx: Ctx) => Promise<string>;
}