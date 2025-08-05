/**
 * FAF ADK Layer - LLM Error Handling
 * 
 * Comprehensive error handling for LLM API failures following FAF patterns
 */

import { createAdkError, createAgentError, AdkErrorObject } from '../types.js';

// ========== Error Types ==========

export interface LLMError extends AdkErrorObject {
  provider?: string;
  model?: string;
  retryable?: boolean;
  statusCode?: number;
  responseBody?: string;
}

export interface LLMRetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  retryableErrors: string[];
}

// ========== Error Classifications ==========

export const LLM_ERROR_TYPES = {
  // Authentication errors
  INVALID_API_KEY: 'INVALID_API_KEY',
  UNAUTHORIZED: 'UNAUTHORIZED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  
  // Request errors
  INVALID_REQUEST: 'INVALID_REQUEST',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  UNSUPPORTED_MODEL: 'UNSUPPORTED_MODEL',
  INVALID_PARAMETERS: 'INVALID_PARAMETERS',
  
  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',
  CONCURRENT_LIMIT: 'CONCURRENT_LIMIT',
  
  // Service errors
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  
  // Content errors
  CONTENT_FILTERED: 'CONTENT_FILTERED',
  CONTENT_TOO_LONG: 'CONTENT_TOO_LONG',
  
  // Function calling errors
  FUNCTION_CALL_ERROR: 'FUNCTION_CALL_ERROR',
  FUNCTION_NOT_FOUND: 'FUNCTION_NOT_FOUND',
  
  // Unknown errors
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export const RETRYABLE_ERRORS = new Set([
  LLM_ERROR_TYPES.RATE_LIMITED,
  LLM_ERROR_TYPES.SERVICE_UNAVAILABLE,
  LLM_ERROR_TYPES.TIMEOUT,
  LLM_ERROR_TYPES.NETWORK_ERROR,
  LLM_ERROR_TYPES.CONCURRENT_LIMIT
]);

// ========== Error Factory Functions ==========

export const createLLMError = (
  message: string,
  code: string,
  context?: {
    provider?: string;
    model?: string;
    statusCode?: number;
    responseBody?: string;
  }
): LLMError => ({
  ...createAdkError(message, code, context),
  name: 'LLMError',
  provider: context?.provider,
  model: context?.model,
  retryable: RETRYABLE_ERRORS.has(code as any),
  statusCode: context?.statusCode,
  responseBody: context?.responseBody
});

export const createLLMTimeoutError = (provider: string, model: string, timeout: number): LLMError =>
  createLLMError(
    `LLM request timed out after ${timeout}ms`,
    LLM_ERROR_TYPES.TIMEOUT,
    { provider, model }
  );

export const createLLMRateLimitError = (provider: string, model: string, resetTime?: number): LLMError =>
  createLLMError(
    `Rate limit exceeded for ${provider}/${model}${resetTime ? `. Resets in ${resetTime}ms` : ''}`,
    LLM_ERROR_TYPES.RATE_LIMITED,
    { provider, model }
  );

export const createLLMQuotaError = (provider: string, model: string): LLMError =>
  createLLMError(
    `Quota exceeded for ${provider}/${model}`,
    LLM_ERROR_TYPES.QUOTA_EXCEEDED,
    { provider, model }
  );

export const createLLMContentFilterError = (provider: string, model: string): LLMError =>
  createLLMError(
    `Content filtered by ${provider}/${model}`,
    LLM_ERROR_TYPES.CONTENT_FILTERED,
    { provider, model }
  );

// ========== Error Classification ==========

export const classifyLLMError = (error: Error, provider: string, model: string): LLMError => {
  const message = error.message.toLowerCase();
  
  // Authentication errors
  if (message.includes('api key') || message.includes('unauthorized') || message.includes('invalid key')) {
    return createLLMError(error.message, LLM_ERROR_TYPES.INVALID_API_KEY, { provider, model });
  }
  
  if (message.includes('quota') || message.includes('billing')) {
    return createLLMError(error.message, LLM_ERROR_TYPES.QUOTA_EXCEEDED, { provider, model });
  }
  
  // Rate limiting
  if (message.includes('rate limit') || message.includes('too many requests')) {
    return createLLMError(error.message, LLM_ERROR_TYPES.RATE_LIMITED, { provider, model });
  }
  
  // Model errors
  if (message.includes('model') && (message.includes('not found') || message.includes('not available'))) {
    return createLLMError(error.message, LLM_ERROR_TYPES.MODEL_NOT_FOUND, { provider, model });
  }
  
  // Timeout errors
  if (message.includes('timeout') || message.includes('timed out')) {
    return createLLMError(error.message, LLM_ERROR_TYPES.TIMEOUT, { provider, model });
  }
  
  // Network errors
  if (message.includes('network') || message.includes('connection') || message.includes('fetch')) {
    return createLLMError(error.message, LLM_ERROR_TYPES.NETWORK_ERROR, { provider, model });
  }
  
  // Service errors
  if (message.includes('service unavailable') || message.includes('server error') || message.includes('503')) {
    return createLLMError(error.message, LLM_ERROR_TYPES.SERVICE_UNAVAILABLE, { provider, model });
  }
  
  // Content filtering
  if (message.includes('content') && (message.includes('filter') || message.includes('policy'))) {
    return createLLMError(error.message, LLM_ERROR_TYPES.CONTENT_FILTERED, { provider, model });
  }
  
  // Content too long
  if (message.includes('too long') || message.includes('token limit') || message.includes('context length')) {
    return createLLMError(error.message, LLM_ERROR_TYPES.CONTENT_TOO_LONG, { provider, model });
  }
  
  // Function calling errors
  if (message.includes('function') || message.includes('tool')) {
    return createLLMError(error.message, LLM_ERROR_TYPES.FUNCTION_CALL_ERROR, { provider, model });
  }
  
  // Default to unknown error
  return createLLMError(error.message, LLM_ERROR_TYPES.UNKNOWN_ERROR, { provider, model });
};

// ========== Retry Logic ==========

export const DEFAULT_RETRY_CONFIG: LLMRetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  retryableErrors: [
    LLM_ERROR_TYPES.RATE_LIMITED,
    LLM_ERROR_TYPES.SERVICE_UNAVAILABLE,
    LLM_ERROR_TYPES.TIMEOUT,
    LLM_ERROR_TYPES.NETWORK_ERROR,
    LLM_ERROR_TYPES.CONCURRENT_LIMIT
  ]
};

export const shouldRetryError = (error: LLMError, config: LLMRetryConfig = DEFAULT_RETRY_CONFIG): boolean => {
  return error.retryable === true && config.retryableErrors.includes(error.code);
};

export const calculateRetryDelay = (
  attempt: number,
  config: LLMRetryConfig = DEFAULT_RETRY_CONFIG,
  jitter: boolean = true
): number => {
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelay);
  
  if (jitter) {
    // Add random jitter to prevent thundering herd
    return cappedDelay * (0.5 + Math.random() * 0.5);
  }
  
  return cappedDelay;
};

// ========== Retry Wrapper ==========

export const withLLMRetry = <T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  config: Partial<LLMRetryConfig> = {},
  provider: string = 'unknown',
  model: string = 'unknown'
) => {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  
  return async (...args: T): Promise<R> => {
    let lastError: LLMError;
    
    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error instanceof Error 
          ? classifyLLMError(error, provider, model)
          : createLLMError(String(error), LLM_ERROR_TYPES.UNKNOWN_ERROR, { provider, model });
        
        if (attempt === retryConfig.maxRetries || !shouldRetryError(lastError, retryConfig)) {
          throw lastError;
        }
        
        const delay = calculateRetryDelay(attempt, retryConfig);
        console.warn(`[ADK:LLM] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, lastError.message);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  };
};

// ========== Timeout Wrapper ==========

export const withLLMTimeout = <T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  timeoutMs: number,
  provider: string = 'unknown',
  model: string = 'unknown'
) => {
  return async (...args: T): Promise<R> => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(createLLMTimeoutError(provider, model, timeoutMs));
      }, timeoutMs);
    });
    
    return Promise.race([
      fn(...args),
      timeoutPromise
    ]);
  };
};

// ========== Circuit Breaker ==========

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
}

export interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

export const createCircuitBreaker = <T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  config: CircuitBreakerConfig,
  provider: string = 'unknown',
  model: string = 'unknown'
) => {
  const state: CircuitBreakerState = {
    failures: 0,
    lastFailureTime: 0,
    state: 'closed'
  };
  
  return async (...args: T): Promise<R> => {
    const now = Date.now();
    
    // Check if we should reset from open to half-open
    if (state.state === 'open' && now - state.lastFailureTime >= config.resetTimeout) {
      state.state = 'half-open';
      console.log(`[ADK:LLM] Circuit breaker ${provider}/${model} moving to half-open`);
    }
    
    // Reject immediately if circuit is open
    if (state.state === 'open') {
      throw createLLMError(
        `Circuit breaker open for ${provider}/${model}`,
        LLM_ERROR_TYPES.SERVICE_UNAVAILABLE,
        { provider, model }
      );
    }
    
    try {
      const result = await fn(...args);
      
      // Success - reset circuit breaker
      if (state.state === 'half-open') {
        state.state = 'closed';
        state.failures = 0;
        console.log(`[ADK:LLM] Circuit breaker ${provider}/${model} reset to closed`);
      }
      
      return result;
    } catch (error) {
      state.failures++;
      state.lastFailureTime = now;
      
      // Open circuit if threshold exceeded
      if (state.failures >= config.failureThreshold) {
        state.state = 'open';
        console.warn(`[ADK:LLM] Circuit breaker ${provider}/${model} opened after ${state.failures} failures`);
      }
      
      throw error;
    }
  };
};

// ========== Error Recovery Strategies ==========

export const createFallbackStrategy = <T extends unknown[], R>(
  primaryFn: (...args: T) => Promise<R>,
  fallbackFn: (...args: T) => Promise<R>,
  shouldFallback: (error: LLMError) => boolean = () => true
) => {
  return async (...args: T): Promise<R> => {
    try {
      return await primaryFn(...args);
    } catch (error) {
      const llmError = error instanceof Error 
        ? classifyLLMError(error, 'unknown', 'unknown')
        : createLLMError(String(error), LLM_ERROR_TYPES.UNKNOWN_ERROR);
      
      if (shouldFallback(llmError)) {
        console.warn(`[ADK:LLM] Primary function failed, using fallback:`, llmError.message);
        return await fallbackFn(...args);
      }
      
      throw llmError;
    }
  };
};

// ========== Error Monitoring ==========

export interface LLMErrorMetrics {
  totalErrors: number;
  errorsByType: Record<string, number>;
  errorsByProvider: Record<string, number>;
  errorsByModel: Record<string, number>;
  lastError?: LLMError;
  lastErrorTime?: number;
}

export const createLLMErrorMonitor = () => {
  const metrics: LLMErrorMetrics = {
    totalErrors: 0,
    errorsByType: {},
    errorsByProvider: {},
    errorsByModel: {}
  };
  
  const recordError = (error: LLMError) => {
    metrics.totalErrors++;
    metrics.errorsByType[error.code] = (metrics.errorsByType[error.code] || 0) + 1;
    
    if (error.provider) {
      metrics.errorsByProvider[error.provider] = (metrics.errorsByProvider[error.provider] || 0) + 1;
    }
    
    if (error.model) {
      metrics.errorsByModel[error.model] = (metrics.errorsByModel[error.model] || 0) + 1;
    }
    
    metrics.lastError = error;
    metrics.lastErrorTime = Date.now();
  };
  
  const getMetrics = (): LLMErrorMetrics => ({ ...metrics });
  
  const resetMetrics = () => {
    metrics.totalErrors = 0;
    metrics.errorsByType = {};
    metrics.errorsByProvider = {};
    metrics.errorsByModel = {};
    delete metrics.lastError;
    delete metrics.lastErrorTime;
  };
  
  return {
    recordError,
    getMetrics,
    resetMetrics
  };
};

// ========== Error Logging ==========

export interface LLMErrorLogger {
  logError: (error: LLMError, context?: Record<string, unknown>) => void;
  logRetry: (error: LLMError, attempt: number, delay: number) => void;
  logRecovery: (error: LLMError, recoveryMethod: string) => void;
}

export const createLLMErrorLogger = (): LLMErrorLogger => ({
  logError: (error: LLMError, context?: Record<string, unknown>) => {
    console.error(`[ADK:LLM:ERROR] ${error.code}: ${error.message}`, {
      provider: error.provider,
      model: error.model,
      retryable: error.retryable,
      statusCode: error.statusCode,
      context
    });
  },
  
  logRetry: (error: LLMError, attempt: number, delay: number) => {
    console.warn(`[ADK:LLM:RETRY] Attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms`, {
      provider: error.provider,
      model: error.model,
      code: error.code
    });
  },
  
  logRecovery: (error: LLMError, recoveryMethod: string) => {
    console.info(`[ADK:LLM:RECOVERY] Recovered from error using ${recoveryMethod}: ${error.message}`, {
      provider: error.provider,
      model: error.model,
      code: error.code
    });
  }
});

// ========== Default Export ==========

export const defaultLLMErrorHandler = {
  classify: classifyLLMError,
  retry: withLLMRetry,
  timeout: withLLMTimeout,
  fallback: createFallbackStrategy,
  circuitBreaker: createCircuitBreaker,
  monitor: createLLMErrorMonitor(),
  logger: createLLMErrorLogger()
};