import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from 'zod';
import { Tool, ValidationResult } from '../core/types.js';

export interface MCPClient {
  listTools(): Promise<Array<{ 
    name: string; 
    description?: string; 
    inputSchema?: any 
  }>>;
  callTool(name: string, args: unknown): Promise<string>;
  close(): Promise<void>;
}

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

export function mcpToolToJAFTool<Ctx>(
  mcpClient: MCPClient,
  mcpToolDef: { name: string; description?: string; inputSchema?: any }
): Tool<any, Ctx> {
  const zodSchema = jsonSchemaToZod(mcpToolDef.inputSchema || {});

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

