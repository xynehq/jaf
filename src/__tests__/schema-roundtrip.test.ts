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
