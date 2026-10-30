import { z } from 'zod';

export function zodSchemaToJsonSchema(zodSchema: any): any {
  if (zodSchema._def?.typeName === 'ZodObject') {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(zodSchema._def.shape())) {
      properties[key] = zodSchemaToJsonSchema(value);
      if (!(value as any).isOptional()) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };
  }

  if (zodSchema._def?.typeName === 'ZodString') {
    const schema: any = { type: 'string' };
    if (zodSchema._def.description) {
      schema.description = zodSchema._def.description;
    }
    return schema;
  }

  if (zodSchema._def?.typeName === 'ZodNumber') {
    return { type: 'number' };
  }

  if (zodSchema._def?.typeName === 'ZodBoolean') {
    return { type: 'boolean' };
  }

  if (zodSchema._def?.typeName === 'ZodArray') {
    return {
      type: 'array',
      items: zodSchemaToJsonSchema(zodSchema._def.type),
    };
  }

  if (zodSchema._def?.typeName === 'ZodOptional') {
    return zodSchemaToJsonSchema(zodSchema._def.innerType);
  }

  if (zodSchema._def?.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: zodSchema._def.values,
    };
  }

  if (zodSchema._def?.typeName === 'ZodRecord') {
    const valueSchema = zodSchemaToJsonSchema(zodSchema._def.valueType);
    return {
      type: 'object',
      additionalProperties: valueSchema,
    };
  }

  return { type: 'string', description: 'Unsupported schema type' };
}

export function jsonSchemaToZod(schema: any): z.ZodType<any> {
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
