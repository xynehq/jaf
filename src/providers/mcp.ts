import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from 'zod';
import { Tool } from '../core/types.js';

export interface MCPClient {
  listTools(): Promise<Array<{ 
    name: string; 
    description?: string; 
    inputSchema?: any 
  }>>;
  callTool(name: string, args: unknown): Promise<string>;
  close(): Promise<void>;
}

/**
 * Create an MCP client using the STDIO transport.
 * Suitable for local MCP servers started as subprocesses (e.g., npx/uvx/python/node).
 */
export async function makeMCPClient(command: string, args: string[] = []): Promise<MCPClient> {
  const transport = new StdioClientTransport({
    command,
    args,
  });

  const client = new Client({
    name: "jaf-client",
    version: "2.0.0",
  });

  await client.connect(transport);

  return {
    async listTools() {
      try {
        const response = await client.listTools();
        return response.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }));
      } catch (error) {
        console.error('Failed to list MCP tools:', error);
        return [];
      }
    },

    async callTool(name: string, args: unknown) {
      try {
        const response = await client.callTool({
          name,
          arguments: args as Record<string, unknown>
        });

        if (response.content && Array.isArray(response.content) && response.content.length > 0) {
          return response.content.map((c: any) => {
            if (c.type === 'text') {
              return c.text;
            }
            return JSON.stringify(c);
          }).join('\n');
        }

        return JSON.stringify(response);
      } catch (error) {
        return JSON.stringify({
          error: 'mcp_tool_error',
          message: error instanceof Error ? error.message : String(error),
          tool_name: name
        });
      }
    },

    async close() {
      await client.close();
    }
  };
}

/**
 * Create an MCP client using the Streamable HTTP transport (SSE).
 *
 * This connects to a remote MCP server that exposes the single MCP endpoint
 * supporting POST and GET with Server-Sent Events per the 2025-06-18 spec.
 *
 * Example:
 *   const mcp = await makeMCPClientSSE('https://example.com/mcp', {
 *     headers: { Authorization: `Bearer ${token}` }
 *   })
 */
export async function makeMCPClientSSE(url: string, opts?: { headers?: Record<string, string> }): Promise<MCPClient> {
  const endpoint = new URL(url);

  // Ensure EventSource is available in Node environments.
  // The MCP SDK's SSE transport expects a global EventSource (available in browsers).
  // In Node.js, install the 'eventsource' package and set it on globalThis.
  if (typeof (globalThis as any).EventSource === 'undefined') {
    try {
      const mod = await import('eventsource');
      const ES = (mod as any).default ?? (mod as any);
      (globalThis as any).EventSource = ES;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`EventSource is not defined. Install the 'eventsource' package or run in a browser. Cause: ${msg}`);
    }
  }

  // NOTE: Current SDK type signature expects only the URL; some versions may
  // accept an options bag. To keep compatibility with this repository, we pass
  // only the endpoint here. If your server requires custom headers, consider
  // configuring it to accept token/query params, or upgrade the SDK accordingly.
  const transport = new SSEClientTransport(endpoint);

  const client = new Client({
    name: "jaf-client",
    version: "2.0.0",
  });

  await client.connect(transport);

  return {
    async listTools() {
      try {
        const response = await client.listTools();
        return response.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }));
      } catch (error) {
        console.error('Failed to list MCP tools (SSE):', error);
        return [];
      }
    },

    async callTool(name: string, args: unknown) {
      try {
        const response = await client.callTool({
          name,
          arguments: args as Record<string, unknown>
        });

        if (response.content && Array.isArray(response.content) && response.content.length > 0) {
          return response.content.map((c: any) => {
            if (c.type === 'text') {
              return c.text;
            }
            return JSON.stringify(c);
          }).join('\n');
        }

        return JSON.stringify(response);
      } catch (error) {
        return JSON.stringify({
          error: 'mcp_tool_error',
          message: error instanceof Error ? error.message : String(error),
          tool_name: name
        });
      }
    },

    async close() {
      await client.close();
    }
  };
}

/**
 * Create an MCP client using the Streamable HTTP transport.
 *
 * This connects to a remote MCP server that implements the Streamable HTTP transport
 * specification using HTTP POST for sending messages and HTTP GET with Server-Sent Events
 * for receiving messages.
 *
 * Example:
 *   const mcp = await makeMCPClientHTTP('https://example.com/mcp', {
 *     headers: { Authorization: `Bearer ${token}` },
 *     sessionId: 'my-session-123'
 *   })
 */
export async function makeMCPClientHTTP(url: string, opts?: {
  headers?: Record<string, string>;
  sessionId?: string;
  fetch?: typeof fetch;
  requestInit?: RequestInit;
}): Promise<MCPClient> {
  const endpoint = new URL(url);

  // Ensure EventSource is available in Node environments for the underlying SSE functionality
  if (typeof (globalThis as any).EventSource === 'undefined') {
    try {
      const mod = await import('eventsource');
      const ES = (mod as any).default ?? (mod as any);
      (globalThis as any).EventSource = ES;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`EventSource is not defined. Install the 'eventsource' package or run in a browser. Cause: ${msg}`);
    }
  }

  const transportOpts = {
    requestInit: {
      ...opts?.requestInit,
      headers: {
        ...opts?.requestInit?.headers,
        ...opts?.headers
      }
    },
    fetch: opts?.fetch,
    // Only set sessionId if explicitly provided and not empty
    // Otherwise let the server generate a new session ID
    ...(opts?.sessionId && opts.sessionId.trim() ? { sessionId: opts.sessionId } : {})
  };

  const transport = new StreamableHTTPClientTransport(endpoint, transportOpts);

  const client = new Client({
    name: "jaf-client",
    version: "2.0.0",
  });

  await client.connect(transport);

  return {
    async listTools() {
      try {
        const response = await client.listTools();
        return response.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }));
      } catch (error) {
        console.error('Failed to list MCP tools (HTTP):', error);
        return [];
      }
    },

    async callTool(name: string, args: unknown) {
      try {
        const response = await client.callTool({
          name,
          arguments: args as Record<string, unknown>
        });

        if (response.content && Array.isArray(response.content) && response.content.length > 0) {
          return response.content.map((c: any) => {
            if (c.type === 'text') {
              return c.text;
            }
            return JSON.stringify(c);
          }).join('\n');
        }

        return JSON.stringify(response);
      } catch (error) {
        return JSON.stringify({
          error: 'mcp_tool_error',
          message: error instanceof Error ? error.message : String(error),
          tool_name: name
        });
      }
    },

    async close() {
      await client.close();
    }
  };
}

export function mcpToolToJAFTool<Ctx>(
  mcpClient: MCPClient,
  mcpToolDef: { name: string; description?: string; inputSchema?: any }
): Tool<any, Ctx> {
  let zodSchema = jsonSchemaToZod(mcpToolDef.inputSchema || {});
  // Ensure top-level OBJECT parameters for function-calling providers
  if (!(zodSchema instanceof z.ZodObject)) {
    zodSchema = z.object({ value: zodSchema }).describe('Wrapped non-object parameters');
  }

  const baseTool: Tool<any, Ctx> = {
    schema: {
      name: mcpToolDef.name,
      description: mcpToolDef.description ?? mcpToolDef.name,
      parameters: zodSchema,
    },
    execute: (args, _) => mcpClient.callTool(mcpToolDef.name, args),
  };

  return baseTool;
}

function jsonSchemaToZod(schema: any): z.ZodType<any> {
  if (!schema || typeof schema !== 'object') {
    return z.any();
  }

  if (schema.type === 'object') {
    const shape: Record<string, z.ZodType<any>> = {};
    
    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        let fieldSchema = jsonSchemaToZod(prop);
        
        if (!schema.required || !schema.required.includes(key)) {
          fieldSchema = fieldSchema.optional();
        }
        
        if ((prop as any).description) {
          fieldSchema = fieldSchema.describe((prop as any).description);
        }
        
        shape[key] = fieldSchema;
      }
    }
    
    return z.object(shape);
  }

  if (schema.type === 'string') {
    let stringSchema = z.string();
    if (schema.description) {
      stringSchema = stringSchema.describe(schema.description);
    }
    if (schema.enum) {
      return z.enum(schema.enum);
    }
    return stringSchema;
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return z.number();
  }

  if (schema.type === 'boolean') {
    return z.boolean();
  }

  if (schema.type === 'array') {
    return z.array(jsonSchemaToZod(schema.items));
  }

  return z.any();
}
