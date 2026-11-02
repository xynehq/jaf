import { z } from 'zod';
import { jsonSchemaToZod, zodSchemaToJsonSchema } from '../providers/schema';

// Shapes modelled on the VIC tool catalog findings (vic:JAF/src/tools/), copied rather than imported.
enum Store {
  Empik = 'empik',
  Korio = 'korio',
}

const fixture = z.object({
  items: z
    .array(z.object({ productId: z.string(), quantity: z.number().int().min(1) }))
    .refine(a => a.length > 0, 'at least one item'),
  quantity: z.number().int().min(1).default(1),
  coercedQuantity: z.coerce.number().int().min(1).default(1),
  limit: z.number().default(10),
  note: z.string().nullable(),
  store: z.nativeEnum(Store).optional(),
  mode: z.union([z.literal('a'), z.literal('b')]).optional(),
  extra: z.any(),
  count: z.string().pipe(z.coerce.number()).optional(),
  query: z.string().transform(s => s.trim()).optional(),
});

describe('VIC catalog fixture', () => {
  const json = zodSchemaToJsonSchema(fixture);
  const stub = jsonSchemaToZod(json);
  const base = { items: [{ productId: 'p', quantity: 2 }], note: null };

  it('converts without unsupported placeholders', () => {
    expect(JSON.stringify(json)).not.toContain('Unsupported schema type');
  });

  it('keeps items required and the defaulted and nullable fields as declared', () => {
    expect(json.required).toEqual(['items', 'note']);
    expect(json.properties.quantity).toEqual({ type: 'integer', minimum: 1, default: 1 });
    expect(json.properties.note).toEqual({ type: ['string', 'null'] });
  });

  it.each([
    ['items', {}],
    ['quantity', { quantity: 3 }],
    ['limit', { limit: 5 }],
    ['coerced quantity', { coercedQuantity: '2' }],
    ['nullable', { note: null }],
    ['native enum', { store: 'empik' }],
    ['literal union', { mode: 'b' }],
    ['any', { extra: { anything: [1, 'x'] } }],
    ['pipeline', { count: '42' }],
    ['transform', { query: ' shoes ' }],
  ])('accepts the %s field', (_name, patch) => {
    const input = { ...base, ...patch };
    expect(fixture.safeParse(input).success).toBe(true);
    expect(stub.safeParse(input).success).toBe(true);
  });

  it('rejects items that are not an array', () => {
    const input = { ...base, items: 'x' };
    expect(fixture.safeParse(input).success).toBe(false);
    expect(stub.safeParse(input).success).toBe(false);
  });
});
