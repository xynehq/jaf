import { z } from 'zod';
import { ValidationResult, Tool, Guardrail } from '../core/types.js';

export const composeValidations =
  <A, Ctx>(...fns: Array<(a: A, c: Ctx) => ValidationResult>) =>
  (a: A, c: Ctx): ValidationResult =>
    fns.reduce<ValidationResult>(
      (acc, f) => (acc.isValid ? f(a, c) : acc),
      { isValid: true }
    );

export function withValidation<A, Ctx>(
  tool: Tool<A, Ctx>,
  validate: (a: A, ctx: Ctx) => ValidationResult
): Tool<A, Ctx> {
  return {
    ...tool,
    async execute(args, ctx) {
      const result = validate(args, ctx);
      if (!result.isValid) {
        return JSON.stringify({
          error: "validation_error",
          message: result.errorMessage,
          tool_name: tool.schema.name,
        });
      }
      return tool.execute(args, ctx);
    },
  };
}

export function createPathValidator<Ctx>(
  allowedPaths: string[],
  contextAccessor?: (ctx: Ctx) => { permissions?: string[] }
) {
  return (args: { path: string }, ctx: Ctx): ValidationResult => {
    const context = contextAccessor?.(ctx);
    
    for (const allowedPath of allowedPaths) {
      if (args.path.startsWith(allowedPath)) {
        if (allowedPath.includes('/admin') && context?.permissions) {
          if (!context.permissions.includes('admin')) {
            return {
              isValid: false,
              errorMessage: 'Admin access required for this path'
            };
          }
        }
        return { isValid: true };
      }
    }
    
    return {
      isValid: false,
      errorMessage: `Path ${args.path} is not allowed`
    };
  };
}

export function createContentFilter(): Guardrail<string> {
  const blockedPatterns = [
    /password/i,
    /secret/i,
    /api[_-]?key/i,
    /token/i,
    /private[_-]?key/i
  ];

  return (input: string): ValidationResult => {
    for (const pattern of blockedPatterns) {
      if (pattern.test(input)) {
        return {
          isValid: false,
          errorMessage: 'Content contains potentially sensitive information'
        };
      }
    }
    return { isValid: true };
  };
}

export function createRateLimiter<T>(
  maxCalls: number,
  windowMs: number,
  keyExtractor: (input: T) => string
): Guardrail<T> {
  const callCounts = new Map<string, { count: number; resetTime: number }>();

  return (input: T): ValidationResult => {
    const key = keyExtractor(input);
    const now = Date.now();
    
    const entry = callCounts.get(key);
    
    if (!entry || now > entry.resetTime) {
      callCounts.set(key, { count: 1, resetTime: now + windowMs });
      return { isValid: true };
    }
    
    if (entry.count >= maxCalls) {
      return {
        isValid: false,
        errorMessage: `Rate limit exceeded. Max ${maxCalls} calls per ${windowMs}ms`
      };
    }
    
    entry.count++;
    return { isValid: true };
  };
}

export function createPermissionValidator<Ctx>(
  requiredPermission: string,
  contextAccessor: (ctx: Ctx) => { permissions?: string[] }
) {
  return (args: any, ctx: Ctx): ValidationResult => {
    const context = contextAccessor(ctx);
    
    if (!context.permissions?.includes(requiredPermission)) {
      return {
        isValid: false,
        errorMessage: `Required permission: ${requiredPermission}`
      };
    }
    
    return { isValid: true };
  };
}