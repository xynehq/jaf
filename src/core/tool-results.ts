import { z } from 'zod';
import { safeConsole } from '../utils/logger.js';

/**
 * Standardized tool result types for consistent error handling
 */

export type ToolResultStatus = 'success' | 'error' | 'validation_error' | 'permission_denied' | 'not_found';

export interface ToolResult<T = any> {
  readonly status: ToolResultStatus;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: any;
  };
  readonly metadata?: {
    readonly executionTimeMs?: number;
    readonly toolName?: string;
    readonly [key: string]: any;
  };
}

// Common error codes
export const ToolErrorCodes = {
  // Validation errors
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  
  // Permission errors  
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  
  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  RESOURCE_UNAVAILABLE: 'RESOURCE_UNAVAILABLE',
  
  // Execution errors
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  TIMEOUT: 'TIMEOUT',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  
  // Generic
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export type ToolErrorCode = typeof ToolErrorCodes[keyof typeof ToolErrorCodes];

/**
 * Helper functions for creating standardized tool results
 */
export class ToolResponse {
  static success<T>(data: T, metadata?: ToolResult['metadata']): ToolResult<T> {
    return {
      status: 'success',
      data,
      metadata
    };
  }

  static error(
    code: ToolErrorCode,
    message: string,
    details?: any,
    metadata?: ToolResult['metadata']
  ): ToolResult {
    return {
      status: 'error',
      error: {
        code,
        message,
        details
      },
      metadata
    };
  }

  static validationError(
    message: string,
    details?: any,
    metadata?: ToolResult['metadata']
  ): ToolResult {
    return {
      status: 'validation_error',
      error: {
        code: ToolErrorCodes.INVALID_INPUT,
        message,
        details
      },
      metadata
    };
  }

  static permissionDenied(
    message: string,
    requiredPermissions?: string[],
    metadata?: ToolResult['metadata']
  ): ToolResult {
    return {
      status: 'permission_denied',
      error: {
        code: ToolErrorCodes.PERMISSION_DENIED,
        message,
        details: { requiredPermissions }
      },
      metadata
    };
  }

  static notFound(
    resource: string,
    identifier?: string,
    metadata?: ToolResult['metadata']
  ): ToolResult {
    return {
      status: 'not_found',
      error: {
        code: ToolErrorCodes.NOT_FOUND,
        message: `${resource} not found${identifier ? `: ${identifier}` : ''}`,
        details: { resource, identifier }
      },
      metadata
    };
  }
}

/**
 * Tool execution wrapper that provides standardized error handling
 */
export function withErrorHandling<TArgs, TResult, TContext>(
  toolName: string,
  executor: (args: TArgs, context: TContext) => Promise<TResult> | TResult
) {
  return async (args: TArgs, context: TContext): Promise<ToolResult<TResult>> => {
    const startTime = Date.now();
    
    try {
      safeConsole.log(`[TOOL:${toolName}] Starting execution with args:`, args);

      const result = await executor(args, context);

      const executionTime = Date.now() - startTime;
      safeConsole.log(`[TOOL:${toolName}] Completed successfully in ${executionTime}ms`);
      
      return ToolResponse.success(result, {
        executionTimeMs: executionTime,
        toolName
      });
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      safeConsole.error(`[TOOL:${toolName}] Failed after ${executionTime}ms:`, error);
      
      if (error instanceof Error) {
        return ToolResponse.error(
          ToolErrorCodes.EXECUTION_FAILED,
          error.message,
          { stack: error.stack },
          { executionTimeMs: executionTime, toolName }
        );
      }
      
      return ToolResponse.error(
        ToolErrorCodes.UNKNOWN_ERROR,
        'Unknown error occurred',
        error,
        { executionTimeMs: executionTime, toolName }
      );
    }
  };
}

/**
 * Permission checking helper
 */
export function requirePermissions<TContext extends { permissions?: string[] }>(
  requiredPermissions: string[]
) {
  return (context: TContext): ToolResult | null => {
    const userPermissions = context.permissions || [];
    const missingPermissions = requiredPermissions.filter(
      perm => !userPermissions.includes(perm)
    );
    
    if (missingPermissions.length > 0) {
      return ToolResponse.permissionDenied(
        `Missing required permissions: ${missingPermissions.join(', ')}`,
        requiredPermissions
      );
    }
    
    return null; // No error
  };
}

/**
 * Convert ToolResult to string for backward compatibility with existing tools
 */
export function toolResultToString(result: ToolResult): string {
  if (result.status === 'success') {
    return typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
  }
  
  // For errors, return a structured error message
  const error = result.error!;
  const errorObj = {
    error: result.status,
    code: error.code,
    message: error.message,
    ...(error.details && { details: error.details }),
    ...(result.metadata && { metadata: result.metadata })
  };
  
  return JSON.stringify(errorObj, null, 2);
}