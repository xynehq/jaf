import { z } from 'zod';
import { Tool } from '../core/types';
import { withErrorHandling } from '../core/tool-results';
import { evaluateMathExpression, safeMath } from '../utils/safe-math';

// NOTE: Use an OBJECT schema (no unions) so providers like Gemini accept it.
const MathArgsSchema = z.object({
    operation: z.enum([
      'evaluate',
      'add',
      'subtract',
      'multiply',
      'divide',
      'power',
      'sqrt',
      'abs',
      'round',
    ]),
    a: z.number().optional(),
    b: z.number().optional(),
    expression: z.string().optional(),
    decimals: z.number().optional(),
  });

export type MathArgs = z.infer<typeof MathArgsSchema>;

export const mathTool: Tool<MathArgs, any> = {
  schema: {
    name: 'math',
    description: 'Performs safe mathematical operations and expression evaluation',
    parameters: MathArgsSchema,
  },
  execute: withErrorHandling<MathArgs, { result: number }, any>('math', async args => {
    switch (args.operation) {
      case 'evaluate':
        return { result: evaluateMathExpression(args.expression!) };
      case 'add':
        return { result: safeMath.add(args.a!, args.b!) };
      case 'subtract':
        return { result: safeMath.subtract(args.a!, args.b!) };
      case 'multiply':
        return { result: safeMath.multiply(args.a!, args.b!) };
      case 'divide':
        return { result: safeMath.divide(args.a!, args.b!) };
      case 'power':
        return { result: safeMath.power(args.a!, args.b!) };
      case 'sqrt':
        return { result: safeMath.sqrt(args.a!) };
      case 'abs':
        // Accept either direct number `a` or an `expression`
        if (typeof args.a === 'number') {
          return { result: safeMath.abs(args.a) };
        }
        if (typeof args.expression === 'string') {
          return { result: safeMath.abs(evaluateMathExpression(args.expression)) };
        }
        throw new Error('abs requires either `a` or `expression`');
      case 'round':
        // Accept either direct number `a` or an `expression` (e.g., "pi")
        if (typeof args.a === 'number') {
          return { result: safeMath.round(args.a, args.decimals) };
        }
        if (typeof args.expression === 'string') {
          const value = evaluateMathExpression(args.expression);
          return { result: safeMath.round(value, args.decimals) };
        }
        throw new Error('round requires either `a` or `expression`');
      default:
        throw new Error(`Unsupported operation: ${(args as any).operation}`);
    }
  }),
};

export default mathTool;
