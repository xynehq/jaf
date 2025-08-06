/**
 * Safe mathematical expression evaluator using mathjs
 * Replaces dangerous eval() usage throughout the codebase
 */

import { evaluate } from 'mathjs';

/**
 * Safely evaluates mathematical expressions
 * @param expression - Mathematical expression to evaluate
 * @returns The result of the calculation
 * @throws Error if expression is invalid or unsafe
 */
export const evaluateMathExpression = (expression: string): number => {
  // Validate input
  if (!expression || typeof expression !== 'string') {
    throw new Error('Invalid expression: must be a non-empty string');
  }

  // Remove whitespace
  const cleanExpression = expression.trim();

  // Check for potentially dangerous patterns
  const dangerousPatterns = [
    /import\s*\(/i,
    /require\s*\(/i,
    /eval\s*\(/i,
    /function\s*\(/i,
    /=>/,
    /new\s+/i,
    /\.\s*constructor/i,
    /__proto__/i,
    /prototype/i
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(cleanExpression)) {
      throw new Error(`Unsafe expression detected: ${pattern}`);
    }
  }

  try {
    // Use mathjs to safely evaluate the expression
    const result = evaluate(cleanExpression);
    
    // Ensure result is a number
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error(`Invalid result: ${result}`);
    }
    
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Math evaluation error: ${error.message}`);
    }
    throw new Error('Math evaluation failed');
  }
};

/**
 * Validates if a string is a safe mathematical expression
 * @param expression - Expression to validate
 * @returns True if expression appears safe
 */
export const isSafeMathExpression = (expression: string): boolean => {
  try {
    evaluateMathExpression(expression);
    return true;
  } catch {
    return false;
  }
};

/**
 * Common mathematical operations as safe functions
 */
export const safeMath = {
  add: (a: number, b: number): number => a + b,
  subtract: (a: number, b: number): number => a - b,
  multiply: (a: number, b: number): number => a * b,
  divide: (a: number, b: number): number => {
    if (b === 0) throw new Error('Division by zero');
    return a / b;
  },
  power: (a: number, b: number): number => Math.pow(a, b),
  sqrt: (a: number): number => Math.sqrt(a),
  abs: (a: number): number => Math.abs(a),
  round: (a: number, decimals: number = 0): number => {
    const factor = Math.pow(10, decimals);
    return Math.round(a * factor) / factor;
  }
};