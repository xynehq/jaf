/**
 * JAF Streaming - Retry Utility
 * 
 * Provides retry logic with exponential backoff for stream operations
 */

import {
  RetryConfig,
  StreamResult,
  StreamError,
  DEFAULT_RETRY_CONFIG,
  createStreamError,
  createStreamSuccess,
  createStreamFailure
} from './types.js';
import { safeConsole } from '../utils/logger.js';

/**
 * Sleep for a specified duration
 * Uses the standard Promise-based delay pattern used throughout JAF
 */
const sleep = (ms: number): Promise<void> => 
  new Promise<void>(resolve => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const timer = Function('return setTimeout')() as (cb: () => void, ms: number) => void;
    timer(resolve, ms);
  });

/**
 * Calculate delay for a given attempt using exponential backoff
 */
export const calculateBackoffDelay = (
  attempt: number,
  config: Required<RetryConfig>
): number => {
  if (!config.exponentialBackoff) {
    return config.retryDelayMs;
  }
  
  // Exponential backoff: delay * 2^attempt
  const delay = config.retryDelayMs * Math.pow(2, attempt);
  
  // Cap at maximum delay
  return Math.min(delay, config.maxDelayMs);
};

/**
 * Retry context passed to callbacks
 */
export type RetryContext = {
  readonly attempt: number;
  readonly maxRetries: number;
  readonly error: Error;
  readonly nextDelayMs: number;
};

/**
 * Options for the retry wrapper
 */
export type WithRetryOptions = {
  /** Retry configuration */
  readonly config?: RetryConfig;
  /** Provider name for error messages */
  readonly providerName: string;
  /** Callback before each retry */
  readonly onRetry?: (context: RetryContext) => void;
  /** Callback on final failure */
  readonly onFinalFailure?: (context: RetryContext) => void;
  /** Callback on success */
  readonly onSuccess?: (attempt: number) => void;
  /** Custom error classifier - return true if error should trigger retry */
  readonly isRetryable?: (error: Error) => boolean;
};

/**
 * Default error classifier - retries all errors by default
 */
const defaultIsRetryable = (error: Error): boolean => {
  // Don't retry validation errors
  if (error.message.includes('validation') || error.message.includes('invalid')) {
    return false;
  }
  // Don't retry authentication errors
  if (error.message.includes('auth') || error.message.includes('unauthorized')) {
    return false;
  }
  // Retry everything else (network errors, timeouts, etc.)
  return true;
};

/**
 * Execute a function with retry logic and exponential backoff
 * 
 * @example
 * ```typescript
 * const result = await withRetry(
 *   async () => {
 *     await redis.rpush(key, value);
 *   },
 *   {
 *     providerName: 'redis',
 *     config: { maxRetries: 3, retryDelayMs: 50 },
 *     onRetry: ({ attempt, error }) => console.log(`Retry ${attempt}: ${error.message}`)
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions
): Promise<StreamResult<T>> {
  const config: Required<RetryConfig> = {
    ...DEFAULT_RETRY_CONFIG,
    ...options.config
  };
  
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await fn();
      
      // Log success after retries
      if (attempt > 0) {
        safeConsole.log(
          `[JAF:STREAM] ${options.providerName}: Succeeded on retry ${attempt}`
        );
      }
      
      options.onSuccess?.(attempt);
      
      return createStreamSuccess(result);
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if we should retry
      const canRetry = attempt < config.maxRetries && isRetryable(lastError);
      
      if (canRetry) {
        const nextDelayMs = calculateBackoffDelay(attempt, config);
        
        const context: RetryContext = {
          attempt,
          maxRetries: config.maxRetries,
          error: lastError,
          nextDelayMs
        };
        
        // Log warning for retry
        safeConsole.warn(
          `[JAF:STREAM] ${options.providerName}: Attempt ${attempt + 1}/${config.maxRetries + 1} failed: ${lastError.message}. ` +
          `Retrying in ${nextDelayMs}ms...`
        );
        
        options.onRetry?.(context);
        
        // Wait before retry
        await sleep(nextDelayMs);
        
      } else {
        // Final failure
        const context: RetryContext = {
          attempt,
          maxRetries: config.maxRetries,
          error: lastError,
          nextDelayMs: 0
        };
        
        safeConsole.error(
          `[JAF:STREAM] ${options.providerName}: CRITICAL - Failed after ${attempt + 1} attempts: ${lastError.message}`
        );
        
        options.onFinalFailure?.(context);
        
        break;
      }
    }
  }
  
  // All retries exhausted
  const streamError = createStreamError(
    `Failed after ${config.maxRetries + 1} attempts: ${lastError?.message}`,
    'RETRY_EXHAUSTED',
    options.providerName,
    config.maxRetries + 1,
    lastError
  );
  
  return createStreamFailure(streamError);
}

/**
 * Create a retryable version of any async function
 * 
 * @example
 * ```typescript
 * const retryablePush = makeRetryable(
 *   async (data: string) => redis.rpush('key', data),
 *   { providerName: 'redis', config: { maxRetries: 3 } }
 * );
 * 
 * const result = await retryablePush('my-data');
 * ```
 */
export function makeRetryable<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: WithRetryOptions
): (...args: TArgs) => Promise<StreamResult<TResult>> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}

/**
 * Execute multiple operations with retry, stopping on first success
 * Useful for failover scenarios
 * 
 * @example
 * ```typescript
 * const result = await withFallback([
 *   () => primaryRedis.rpush(key, value),
 *   () => backupRedis.rpush(key, value),
 *   () => httpWebhook.post(value)
 * ], { providerName: 'multi-provider' });
 * ```
 */
export async function withFallback<T>(
  operations: ReadonlyArray<() => Promise<T>>,
  options: Omit<WithRetryOptions, 'config'> & { config?: Omit<RetryConfig, 'maxRetries'> }
): Promise<StreamResult<T>> {
  const errors: Error[] = [];
  
  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    
    try {
      const result = await operation();
      
      if (i > 0) {
        safeConsole.log(
          `[JAF:STREAM] ${options.providerName}: Succeeded with fallback provider ${i + 1}`
        );
      }
      
      return createStreamSuccess(result);
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      errors.push(err);
      
      safeConsole.warn(
        `[JAF:STREAM] ${options.providerName}: Provider ${i + 1} failed: ${err.message}` +
        (i < operations.length - 1 ? '. Trying next provider...' : '')
      );
    }
  }
  
  // All fallbacks exhausted
  const combinedMessage = errors.map((e, i) => `Provider ${i + 1}: ${e.message}`).join('; ');
  
  const streamError = createStreamError(
    `All ${operations.length} providers failed: ${combinedMessage}`,
    'RETRY_EXHAUSTED',
    options.providerName,
    operations.length,
    errors[errors.length - 1]
  );
  
  return createStreamFailure(streamError);
}

/**
 * Circuit breaker state for a provider
 */
type CircuitState = {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
};

const circuitBreakers = new Map<string, CircuitState>();

/**
 * Circuit breaker options
 */
export type CircuitBreakerOptions = {
  /** Number of failures before opening circuit (default: 5) */
  readonly failureThreshold?: number;
  /** Time in ms before attempting to close circuit (default: 30000) */
  readonly resetTimeoutMs?: number;
};

const DEFAULT_CIRCUIT_BREAKER_OPTIONS: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  resetTimeoutMs: 30000
};

/**
 * Execute with circuit breaker pattern
 * Prevents hammering a failed service
 * 
 * @example
 * ```typescript
 * const result = await withCircuitBreaker(
 *   'redis-provider',
 *   async () => redis.rpush(key, value),
 *   { failureThreshold: 5, resetTimeoutMs: 30000 }
 * );
 * ```
 */
export async function withCircuitBreaker<T>(
  providerName: string,
  fn: () => Promise<T>,
  options?: CircuitBreakerOptions
): Promise<StreamResult<T>> {
  const config = { ...DEFAULT_CIRCUIT_BREAKER_OPTIONS, ...options };
  
  // Get or create circuit state
  let state = circuitBreakers.get(providerName);
  if (!state) {
    state = { failures: 0, lastFailure: 0, isOpen: false };
    circuitBreakers.set(providerName, state);
  }
  
  // Check if circuit is open
  if (state.isOpen) {
    const timeSinceFailure = Date.now() - state.lastFailure;
    
    if (timeSinceFailure < config.resetTimeoutMs) {
      // Circuit is still open
      const streamError = createStreamError(
        `Circuit breaker is open for ${providerName}. ` +
        `Will retry in ${Math.ceil((config.resetTimeoutMs - timeSinceFailure) / 1000)}s`,
        'PROVIDER_ERROR',
        providerName
      );
      return createStreamFailure(streamError);
    }
    
    // Try to close circuit (half-open state)
    safeConsole.log(`[JAF:STREAM] ${providerName}: Attempting to close circuit breaker...`);
  }
  
  try {
    const result = await fn();
    
    // Reset on success
    state.failures = 0;
    state.isOpen = false;
    
    return createStreamSuccess(result);
    
  } catch (error) {
    state.failures++;
    state.lastFailure = Date.now();
    
    if (state.failures >= config.failureThreshold) {
      state.isOpen = true;
      safeConsole.error(
        `[JAF:STREAM] ${providerName}: Circuit breaker OPENED after ${state.failures} failures`
      );
    }
    
    const err = error instanceof Error ? error : new Error(String(error));
    const streamError = createStreamError(
      err.message,
      'PUSH_FAILED',
      providerName,
      state.failures,
      err
    );
    
    return createStreamFailure(streamError);
  }
}

/**
 * Reset circuit breaker for a provider
 */
export function resetCircuitBreaker(providerName: string): void {
  circuitBreakers.delete(providerName);
  safeConsole.log(`[JAF:STREAM] ${providerName}: Circuit breaker reset`);
}

/**
 * Get circuit breaker status
 */
export function getCircuitBreakerStatus(providerName: string): CircuitState | undefined {
  return circuitBreakers.get(providerName);
}
