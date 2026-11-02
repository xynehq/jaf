import { z } from 'zod';
import { jsonSchemaToZod as fromRoot, zodSchemaToJsonSchema as toRoot } from '../index';
import { jsonSchemaToZod, zodSchemaToJsonSchema } from '../providers';

describe('jsonSchemaToZod / zodSchemaToJsonSchema round trip', () => {
  const original = z.object({
    a: z.string().describe('x'),
    b: z.number().optional(),
    c: z.enum(['p', 'q']),
    d: z.array(z.object({ e: z.boolean() })),
  });

  const json = zodSchemaToJsonSchema(original);
  const roundTripped = jsonSchemaToZod(json);

  const valid = [
    { a: 'hi', c: 'p', d: [] },
    { a: 'hi', b: 3, c: 'q', d: [{ e: true }, { e: false }] },
  ];

  const invalid = [
    { b: 1, c: 'p', d: [] },                 // missing a
    { a: 'hi', c: 'r', d: [] },              // wrong c
    { a: 'hi', c: 'p', d: [{ e: 'yes' }] },  // wrong nested type
    { a: 'hi', b: 'one', c: 'p', d: [] },    // wrong optional type
  ];

  it.each(valid)('accepts valid input %#', (input) => {
    expect(original.safeParse(input).success).toBe(true);
    expect(roundTripped.safeParse(input).success).toBe(true);
  });

  it.each(invalid)('rejects invalid input %#', (input) => {
    expect(original.safeParse(input).success).toBe(false);
    expect(roundTripped.safeParse(input).success).toBe(false);
  });

  it('keeps descriptions', () => {
    expect(json.properties.a.description).toBe('x');
    const shape = (roundTripped as z.ZodObject<any>).shape;
    expect(shape.a.description).toBe('x');
  });

  it('is exported from the root and the providers entrypoint', () => {
    expect(fromRoot).toBe(jsonSchemaToZod);
    expect(toRoot).toBe(zodSchemaToJsonSchema);
  });
});

describe('lossless conversion of wrapped and composite constructs', () => {
  enum Color { Red = 'red', Green = 'green' }
  enum Level { Low = 1, High = 2 }

  const stubOf = (s: z.ZodTypeAny) => jsonSchemaToZod(zodSchemaToJsonSchema(s));

  const cases: Array<{ name: string; schema: z.ZodTypeAny; valid: unknown[]; invalid?: unknown[] }> = [
    { name: 'ZodDefault', schema: z.number().default(10), valid: [5, 10] },
    { name: 'ZodEffects (refine)', schema: z.array(z.string()).refine(a => a.length > 0), valid: [['a'], ['a', 'b']] },
    { name: 'ZodEffects (transform)', schema: z.string().transform(s => s.trim()), valid: [' a ', 'b'] },
    { name: 'ZodEffects (preprocess)', schema: z.preprocess(v => v, z.string()), valid: ['a'] },
    { name: 'ZodPipeline', schema: z.string().pipe(z.coerce.number()), valid: ['42'] },
    { name: 'ZodBranded', schema: z.string().brand<'Id'>(), valid: ['x'] },
    { name: 'ZodReadonly', schema: z.array(z.number()).readonly(), valid: [[1, 2]] },
    { name: 'ZodCatch', schema: z.number().catch(0), valid: [3] },
    { name: 'ZodLazy', schema: z.lazy(() => z.object({ a: z.string() })), valid: [{ a: 'x' }] },
    {
      name: 'ZodNullable',
      schema: z.string().nullable(),
      valid: ['a', null],
      invalid: [1, undefined],
    },
    {
      name: 'ZodNullable over an object',
      schema: z.object({ a: z.number() }).nullable(),
      valid: [{ a: 1 }, null],
      invalid: [{ a: 'x' }, 'a'],
    },
    {
      name: 'ZodNullable over an enum',
      schema: z.enum(['a', 'b']).nullable(),
      valid: ['a', null],
      invalid: ['c'],
    },
    { name: 'ZodNativeEnum (strings)', schema: z.nativeEnum(Color), valid: ['red', 'green'], invalid: ['Red', 'blue'] },
    { name: 'ZodNativeEnum (numbers)', schema: z.nativeEnum(Level), valid: [1, 2], invalid: ['Low', 3] },
    {
      name: 'ZodUnion',
      schema: z.union([z.string(), z.number()]),
      valid: ['a', 1],
      invalid: [true, null],
    },
    {
      name: 'ZodUnion of literals',
      schema: z.union([z.literal('a'), z.literal('b')]),
      valid: ['a', 'b'],
      invalid: ['c'],
    },
    {
      name: 'ZodDiscriminatedUnion',
      schema: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), x: z.string() }),
        z.object({ kind: z.literal('b'), y: z.number() }),
      ]),
      valid: [{ kind: 'a', x: 's' }, { kind: 'b', y: 1 }],
      invalid: [{ kind: 'c' }, { kind: 'a' }],
    },
    { name: 'ZodLiteral (string)', schema: z.literal('on'), valid: ['on'], invalid: ['off'] },
    { name: 'ZodLiteral (number)', schema: z.literal(3), valid: [3], invalid: [4, '3'] },
    { name: 'ZodLiteral (boolean)', schema: z.literal(true), valid: [true], invalid: [false] },
    { name: 'ZodLiteral (null)', schema: z.literal(null), valid: [null], invalid: ['null'] },
    { name: 'ZodAny', schema: z.any(), valid: [1, 'a', null, { a: 1 }] },
    { name: 'ZodUnknown', schema: z.unknown(), valid: [1, 'a', null, [1]] },
    { name: 'ZodNumber int with bounds', schema: z.number().int().min(1).max(5), valid: [1, 5] },
    { name: 'ZodNumber coerced', schema: z.coerce.number().int().min(1).default(1), valid: ['3', 3], invalid: ['abc', 0] },
    { name: 'ZodBoolean coerced', schema: z.coerce.boolean(), valid: ['true', true, 0] },
    { name: 'ZodNull in a union', schema: z.union([z.string(), z.null()]), valid: ['a', null], invalid: [1] },
    { name: 'ZodTuple', schema: z.tuple([z.string(), z.number()]), valid: [['a', 1]] },
    { name: 'ZodRecord', schema: z.record(z.number()), valid: [{ a: 1, b: 2 }, {}] },
    {
      name: 'object required',
      schema: z.object({ a: z.string(), b: z.number().optional() }),
      valid: [{ a: 'x' }, { a: 'x', b: 1 }],
      invalid: [{ b: 1 }, {}],
    },
  ];

  it.each(cases)('$name: the stub accepts what the original accepts', ({ schema, valid }) => {
    const stub = stubOf(schema);
    for (const input of valid) {
      expect(schema.safeParse(input).success).toBe(true);
      expect(stub.safeParse(input).success).toBe(true);
    }
  });

  it.each(cases.filter(c => c.invalid))('$name: both reject the invalid inputs', ({ schema, invalid }) => {
    const stub = stubOf(schema);
    for (const input of invalid!) {
      expect(schema.safeParse(input).success).toBe(false);
      expect(stub.safeParse(input).success).toBe(false);
    }
  });

  it('emits no unsupported placeholder for any listed construct', () => {
    for (const { schema } of cases) {
      expect(JSON.stringify(zodSchemaToJsonSchema(schema))).not.toContain('Unsupported schema type');
    }
  });

  it('keeps already supported shapes byte for byte', () => {
    const schema = z.object({ a: z.string().describe('x'), b: z.number().optional() });
    expect(JSON.stringify(zodSchemaToJsonSchema(schema))).toBe(
      '{"type":"object","properties":{"a":{"type":"string","description":"x"},"b":{"type":"number"}},"required":["a"],"additionalProperties":false}'
    );
  });

  it('copies descriptions from every construct and keeps defaults', () => {
    expect(zodSchemaToJsonSchema(z.number().int().min(1).default(1).describe('qty'))).toEqual({
      type: 'integer',
      minimum: 1,
      default: 1,
      description: 'qty',
    });
    expect(zodSchemaToJsonSchema(z.array(z.string()).describe('list')).description).toBe('list');
  });

  it('emits anyOf for unions, tuples and nullable non-single-type schemas', () => {
    expect(zodSchemaToJsonSchema(z.union([z.string(), z.number()]))).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    });
    expect(zodSchemaToJsonSchema(z.string().nullable())).toEqual({ type: ['string', 'null'] });
    expect(zodSchemaToJsonSchema(z.union([z.string(), z.number()]).nullable())).toEqual({
      anyOf: [{ anyOf: [{ type: 'string' }, { type: 'number' }] }, { type: 'null' }],
    });
  });

  it('converts recursive lazy schemas without looping', () => {
    type Node = { name: string; children?: Node[] };
    const node: z.ZodType<Node> = z.lazy(() => z.object({ name: z.string(), children: z.array(node).optional() }));
    const stub = stubOf(node);
    expect(stub.safeParse({ name: 'a', children: [{ name: 'b' }] }).success).toBe(true);
  });

  it('still emits the placeholder for unknown constructs', () => {
    expect(zodSchemaToJsonSchema(z.date())).toEqual({ type: 'string', description: 'Unsupported schema type' });
  });
});
