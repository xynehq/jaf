import { z } from 'zod';

export const UNSUPPORTED_SCHEMA_DESCRIPTION = 'Unsupported schema type';
const UNSUPPORTED_SCHEMA = { type: 'string', description: UNSUPPORTED_SCHEMA_DESCRIPTION } as const;

// Vendor keyword marking a z.coerce.* primitive, so the reverse conversion accepts what the original coerces.
const COERCE_KEYWORD = 'x-jaf-coerce';

// Recursive z.lazy schemas currently being expanded; a re-entry converts to `{}` instead of recursing forever.
const expandingLazies = new WeakSet<object>();

function withDescription(zodSchema: any, jsonSchema: any): any {
  const description = zodSchema._def?.description;
  return description ? { ...jsonSchema, description } : jsonSchema;
}

function withCoerce(def: any, jsonSchema: any): any {
  return def.coerce === true ? { ...jsonSchema, [COERCE_KEYWORD]: true } : jsonSchema;
}

function numberToJsonSchema(def: any): any {
  const schema: any = { type: 'number' };
  for (const check of def.checks ?? []) {
    if (check.kind === 'int') {
      schema.type = 'integer';
    } else if (check.kind === 'min') {
      schema[check.inclusive === false ? 'exclusiveMinimum' : 'minimum'] = check.value;
    } else if (check.kind === 'max') {
      schema[check.inclusive === false ? 'exclusiveMaximum' : 'maximum'] = check.value;
    }
  }
  return schema;
}

function nullableJsonSchema(inner: any): any {
  if (typeof inner.type === 'string') {
    const schema: any = { ...inner, type: [inner.type, 'null'] };
    // An `enum` restricts the value set regardless of `type`, so null must be listed too.
    if (Array.isArray(inner.enum)) {
      schema.enum = [...inner.enum, null];
    }
    return schema;
  }
  return { anyOf: [inner, { type: 'null' }] };
}

function nativeEnumJsonSchema(values: Record<string, unknown>): any {
  const all = Object.values(values);
  // TypeScript numeric enums also map member names back from the numbers; keep only the numbers.
  const numbers = all.filter((v): v is number => typeof v === 'number');
  return numbers.length > 0 ? { type: 'number', enum: numbers } : { type: 'string', enum: all };
}

function convertZodSchema(zodSchema: any): any {
  const def = zodSchema._def;

  switch (def?.typeName) {
    case 'ZodObject': {
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(def.shape())) {
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

    case 'ZodString':
      return withCoerce(def, { type: 'string' });

    case 'ZodNumber':
      return withCoerce(def, numberToJsonSchema(def));

    case 'ZodBoolean':
      return withCoerce(def, { type: 'boolean' });

    case 'ZodNull':
      return { type: 'null' };

    case 'ZodArray':
      return {
        type: 'array',
        items: zodSchemaToJsonSchema(def.type),
      };

    case 'ZodOptional':
      return zodSchemaToJsonSchema(def.innerType);

    case 'ZodEnum':
      return {
        type: 'string',
        enum: def.values,
      };

    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: zodSchemaToJsonSchema(def.valueType),
      };

    case 'ZodDefault':
      return { ...zodSchemaToJsonSchema(def.innerType), default: def.defaultValue() };

    case 'ZodEffects':
      return zodSchemaToJsonSchema(def.schema);

    case 'ZodPipeline':
      return zodSchemaToJsonSchema(def.in);

    case 'ZodBranded':
      return zodSchemaToJsonSchema(def.type);

    case 'ZodReadonly':
    case 'ZodCatch':
      return zodSchemaToJsonSchema(def.innerType);

    case 'ZodLazy': {
      if (expandingLazies.has(zodSchema)) {
        return {};
      }
      expandingLazies.add(zodSchema);
      try {
        return zodSchemaToJsonSchema(def.getter());
      } finally {
        expandingLazies.delete(zodSchema);
      }
    }

    case 'ZodNullable':
      return nullableJsonSchema(zodSchemaToJsonSchema(def.innerType));

    case 'ZodNativeEnum':
      return nativeEnumJsonSchema(def.values);

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options: unknown[] = def.options instanceof Map ? [...def.options.values()] : def.options;
      return { anyOf: options.map(zodSchemaToJsonSchema) };
    }

    case 'ZodLiteral':
      return def.value === null
        ? { enum: [null] }
        : { type: typeof def.value, enum: [def.value] };

    case 'ZodAny':
    case 'ZodUnknown':
      return {};

    case 'ZodTuple': {
      const items: unknown[] = def.items;
      return {
        type: 'array',
        items: { anyOf: items.map(zodSchemaToJsonSchema) },
        minItems: items.length,
        maxItems: items.length,
      };
    }

    default:
      return undefined;
  }
}

export function zodSchemaToJsonSchema(zodSchema: any): any {
  const converted = convertZodSchema(zodSchema);
  if (converted === undefined) {
    return { ...UNSUPPORTED_SCHEMA };
  }
  return withDescription(zodSchema, converted);
}

function unionOf(members: z.ZodType<any>[]): z.ZodType<any> {
  if (members.length === 0) {
    return z.never();
  }
  return members.length === 1 ? members[0] : z.union(members as [z.ZodType<any>, z.ZodType<any>, ...z.ZodType<any>[]]);
}

function numberFromJsonSchema(schema: any): z.ZodType<any> {
  let numberSchema = schema[COERCE_KEYWORD] === true ? z.coerce.number() : z.number();
  if (schema.type === 'integer') numberSchema = numberSchema.int();
  if (typeof schema.minimum === 'number') numberSchema = numberSchema.min(schema.minimum);
  if (typeof schema.maximum === 'number') numberSchema = numberSchema.max(schema.maximum);
  if (typeof schema.exclusiveMinimum === 'number') numberSchema = numberSchema.gt(schema.exclusiveMinimum);
  if (typeof schema.exclusiveMaximum === 'number') numberSchema = numberSchema.lt(schema.exclusiveMaximum);
  return numberSchema;
}

export function jsonSchemaToZod(schema: any): z.ZodType<any> {
  if (!schema || typeof schema !== 'object') {
    return z.any();
  }

  if (Array.isArray(schema.type)) {
    const types: unknown[] = schema.type;
    const members = types.filter(t => t !== 'null').map(type => jsonSchemaToZod({ ...schema, type }));
    if (members.length === 0) {
      return z.null();
    }
    const union = unionOf(members);
    return types.includes('null') ? union.nullable() : union;
  }

  const variants = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : undefined;
  if (variants) {
    const isNull = (v: any) => !!v && typeof v === 'object' && v.type === 'null';
    const members = variants.filter((v: any) => !isNull(v)).map(jsonSchemaToZod);
    if (members.length === 0) {
      return z.null();
    }
    const union = unionOf(members);
    return variants.some(isNull) ? union.nullable() : union;
  }

  if ('const' in schema) {
    return z.literal(schema.const);
  }

  if (
    Array.isArray(schema.enum) &&
    schema.enum.length > 0 &&
    (schema.type !== 'string' || schema.enum.some((v: unknown) => typeof v !== 'string'))
  ) {
    return unionOf(schema.enum.map((v: any) => z.literal(v)));
  }

  if (schema.type === 'object') {
    if (!schema.properties && schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      return z.record(jsonSchemaToZod(schema.additionalProperties));
    }

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
    let stringSchema = schema[COERCE_KEYWORD] === true ? z.coerce.string() : z.string();
    if (schema.description) {
      stringSchema = stringSchema.describe(schema.description);
    }
    if (schema.enum) {
      return z.enum(schema.enum);
    }
    return stringSchema;
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return numberFromJsonSchema(schema);
  }

  if (schema.type === 'boolean') {
    return schema[COERCE_KEYWORD] === true ? z.coerce.boolean() : z.boolean();
  }

  if (schema.type === 'array') {
    return z.array(jsonSchemaToZod(schema.items));
  }

  if (schema.type === 'null') {
    return z.null();
  }

  return z.any();
}
