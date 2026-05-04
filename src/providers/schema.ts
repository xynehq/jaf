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
