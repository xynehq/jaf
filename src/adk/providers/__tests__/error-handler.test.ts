/**
 * Tests for LLM Error Handling System
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  createLLMError,
  createLLMTimeoutError,
  createLLMRateLimitError,
  createLLMQuotaError,
  createLLMContentFilterError,
  classifyLLMError,
  shouldRetryError,
  calculateRetryDelay,
  withLLMRetry,
  withLLMTimeout,
  createCircuitBreaker,
  createFallbackStrategy,
  createLLMErrorMonitor,
  createLLMErrorLogger,
  defaultLLMErrorHandler,
  LLM_ERROR_TYPES,
  RETRYABLE_ERRORS,
  DEFAULT_RETRY_CONFIG
} from '../error-handler.js';

describe('LLM Error Handling System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Error Factory Functions', () => {
    it('should create basic LLM error', () => {
      const error = createLLMError(
        'Test error message',
        LLM_ERROR_TYPES.TIMEOUT,
        {
          provider: 'openai',
          model: 'gpt-4',
          statusCode: 408
        }
      );

      expect(error.name).toBe('LLMError');
      expect(error.message).toBe('Test error message');
      expect(error.code).toBe(LLM_ERROR_TYPES.TIMEOUT);
      expect(error.provider).toBe('openai');
      expect(error.model).toBe('gpt-4');
      expect(error.statusCode).toBe(408);
      expect(error.retryable).toBe(true);
    });

    it('should create timeout error', () => {
      const error = createLLMTimeoutError('anthropic', 'claude-3-sonnet', 30000);

      expect(error.code).toBe(LLM_ERROR_TYPES.TIMEOUT);
      expect(error.message).toContain('30000ms');
      expect(error.provider).toBe('anthropic');
      expect(error.model).toBe('claude-3-sonnet');
      expect(error.retryable).toBe(true);
    });

    it('should create rate limit error', () => {
      const error = createLLMRateLimitError('openai', 'gpt-4', 60000);

      expect(error.code).toBe(LLM_ERROR_TYPES.RATE_LIMITED);
      expect(error.message).toContain('Rate limit exceeded');
      expect(error.message).toContain('60000ms');
      expect(error.provider).toBe('openai');
      expect(error.model).toBe('gpt-4');
      expect(error.retryable).toBe(true);
    });

    it('should create quota error', () => {
      const error = createLLMQuotaError('google', 'gemini-pro');

      expect(error.code).toBe(LLM_ERROR_TYPES.QUOTA_EXCEEDED);
      expect(error.message).toContain('Quota exceeded');
      expect(error.provider).toBe('google');
      expect(error.model).toBe('gemini-pro');
      expect(error.retryable).toBe(false);
    });

    it('should create content filter error', () => {
      const error = createLLMContentFilterError('anthropic', 'claude-3-haiku');

      expect(error.code).toBe(LLM_ERROR_TYPES.CONTENT_FILTERED);
      expect(error.message).toContain('Content filtered');
      expect(error.provider).toBe('anthropic');
      expect(error.model).toBe('claude-3-haiku');
      expect(error.retryable).toBe(false);
    });
  });

  describe('Error Classification', () => {
    it('should classify API key errors', () => {
      const error = new Error('Invalid API key provided');
      const llmError = classifyLLMError(error, 'openai', 'gpt-4');

      expect(llmError.code).toBe(LLM_ERROR_TYPES.INVALID_API_KEY);
      expect(llmError.provider).toBe('openai');
      expect(llmError.model).toBe('gpt-4');
      expect(llmError.retryable).toBe(false);
    });

    it('should classify rate limit errors', () => {
      const error = new Error('Rate limit exceeded. Too many requests.');
      const llmError = classifyLLMError(error, 'openai', 'gpt-4');

      expect(llmError.code).toBe(LLM_ERROR_TYPES.RATE_LIMITED);
      expect(llmError.retryable).toBe(true);
    });

    it('should classify model not found errors', () => {
      const error = new Error('Model gpt-5 not found');
      const llmError = classifyLLMError(error, 'openai', 'gpt-5');

      expect(llmError.code).toBe(LLM_ERROR_TYPES.MODEL_NOT_FOUND);
      expect(llmError.retryable).toBe(false);
    });

    it('should classify timeout errors', () => {
      const error = new Error('Request timed out after 30 seconds');
      const llmError = classifyLLMError(error, 'anthropic', 'claude-3-sonnet');

      expect(llmError.code).toBe(LLM_ERROR_TYPES.TIMEOUT);
      expect(llmError.retryable).toBe(true);
    });

    it('should classify network errors', () => {
      const error = new Error('Network connection failed');
      const llmError = classifyLLMError(error, 'google', 'gemini-pro');

      expect(llmError.code).toBe(LLM_ERROR_TYPES.NETWORK_ERROR);
      expect(llmError.retryable).toBe(true);
    });

    it('should classify service unavailable errors', () => {
      const error = new Error('Service unavailable - 503 error');
      const llmError = classifyLLMError(error, 'openai', 'gpt-4');

      expect(llmError.code).toBe(LLM_ERROR_TYPES.SERVICE_UNAVAILABLE);
      expect(llmError.retryable).toBe(true);
    });

    it('should classify content filtering errors', () => {
      const error = new Error('Content violates policy filter');
      const llmError = classifyLLMError(error, 'anthropic', 'claude-3-sonnet');

      expect(llmError.code).toBe(LLM_ERROR_TYPES.CONTENT_FILTERED);
      expect(llmError.retryable).toBe(false);
    });

    it('should classify quota errors', () => {
      const error = new Error('Quota exceeded for this billing period');
      const llmError = classifyLLMError(error, 'openai', 'gpt-4');

      expect(llmError.code).toBe(LLM_ERROR_TYPES.QUOTA_EXCEEDED);
      expect(llmError.retryable).toBe(false);
    });

    it('should classify unknown errors', () => {
      const error = new Error('Something completely unexpected happened');
      const llmError = classifyLLMError(error, 'unknown', 'unknown');

      expect(llmError.code).toBe(LLM_ERROR_TYPES.UNKNOWN_ERROR);
      expect(llmError.retryable).toBe(false);
    });
  });

  describe('Retry Logic', () => {
    it('should determine retryable errors correctly', () => {
      const retryableError = createLLMError('Test', LLM_ERROR_TYPES.RATE_LIMITED);
      const nonRetryableError = createLLMError('Test', LLM_ERROR_TYPES.INVALID_API_KEY);

      expect(shouldRetryError(retryableError)).toBe(true);
      expect(shouldRetryError(nonRetryableError)).toBe(false);
    });

    it('should calculate retry delay with exponential backoff', () => {
      const delay1 = calculateRetryDelay(0, DEFAULT_RETRY_CONFIG, false);
      const delay2 = calculateRetryDelay(1, DEFAULT_RETRY_CONFIG, false);
      const delay3 = calculateRetryDelay(2, DEFAULT_RETRY_CONFIG, false);

      expect(delay1).toBe(1000); // Base delay
      expect(delay2).toBe(2000); // 2^1 * base
      expect(delay3).toBe(4000); // 2^2 * base
    });

    it('should cap retry delay at max', () => {
      const config = { ...DEFAULT_RETRY_CONFIG, maxDelay: 5000 };
      const delay = calculateRetryDelay(10, config, false);

      expect(delay).toBe(5000);
    });

    it('should add jitter when requested', () => {
      const delay1 = calculateRetryDelay(1, DEFAULT_RETRY_CONFIG, true);
      const delay2 = calculateRetryDelay(1, DEFAULT_RETRY_CONFIG, true);

      // With jitter, delays should be different (probability of being same is very low)
      expect(delay1).not.toBe(delay2);
      expect(delay1).toBeGreaterThan(1000); // Should be at least 50% of base
      expect(delay1).toBeLessThanOrEqual(2000); // Should be at most 100% of base
    });
  });

  describe('withLLMRetry', () => {
    it('should succeed on first attempt', async () => {
      const mockFn = jest.fn<() => Promise<string>>().mockResolvedValue('success');
      const retryFn = withLLMRetry(mockFn as any, { maxRetries: 3 }, 'test', 'model');

      const result = await retryFn('arg1', 'arg2');

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should retry on retryable errors', async () => {
      const retryableError = new Error('Rate limit exceeded');
      const mockFn = jest.fn<() => Promise<string>>()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('success');

      const retryFn = withLLMRetry(mockFn as any, { maxRetries: 3 }, 'test', 'model');

      const result = await retryFn();

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const nonRetryableError = new Error('Invalid API key');
      const mockFn = jest.fn<() => Promise<string>>().mockRejectedValue(nonRetryableError);

      const retryFn = withLLMRetry(mockFn as any, { maxRetries: 3 }, 'test', 'model');

      await expect(retryFn()).rejects.toThrow('Invalid API key');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should stop retrying after max attempts', async () => {
      const retryableError = new Error('Rate limit exceeded');
      const mockFn = jest.fn<() => Promise<string>>().mockRejectedValue(retryableError);

      const retryFn = withLLMRetry(mockFn as any, { maxRetries: 2 }, 'test', 'model');

      await expect(retryFn()).rejects.toThrow('Rate limit exceeded');
      expect(mockFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe('withLLMTimeout', () => {
    it('should resolve before timeout', async () => {
      const mockFn = jest.fn<() => Promise<string>>().mockResolvedValue('success');
      const timeoutFn = withLLMTimeout(mockFn as any, 1000, 'test', 'model');

      const result = await timeoutFn();

      expect(result).toBe('success');
    });

    it('should timeout if function takes too long', async () => {
      const mockFn = jest.fn<() => Promise<string>>().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('success'), 2000))
      );
      const timeoutFn = withLLMTimeout(mockFn as any, 500, 'test', 'model');

      await expect(timeoutFn()).rejects.toThrow('LLM request timed out after 500ms');
    });
  });

  describe('Circuit Breaker', () => {
    it('should allow requests when circuit is closed', async () => {
      const mockFn = jest.fn<() => Promise<string>>().mockResolvedValue('success');
      const circuitFn = createCircuitBreaker(mockFn as any, {
        failureThreshold: 3,
        resetTimeout: 1000,
        monitoringPeriod: 5000
      }, 'test', 'model');

      const result = await circuitFn();

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should open circuit after failure threshold', async () => {
      const mockFn = jest.fn<() => Promise<string>>().mockRejectedValue(new Error('Service error'));
      const circuitFn = createCircuitBreaker(mockFn as any, {
        failureThreshold: 2,
        resetTimeout: 1000,
        monitoringPeriod: 5000
      }, 'test', 'model');

      // First two failures should still call the function
      await expect(circuitFn()).rejects.toThrow('Service error');
      await expect(circuitFn()).rejects.toThrow('Service error');

      // Third call should be rejected by circuit breaker
      await expect(circuitFn()).rejects.toThrow('Circuit breaker open');
      
      // Function should only have been called twice
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should reset circuit after timeout', async () => {
      jest.useFakeTimers();

      const mockFn = jest.fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error('Service error'))
        .mockRejectedValueOnce(new Error('Service error'))
        .mockResolvedValue('success');

      const circuitFn = createCircuitBreaker(mockFn as any, {
        failureThreshold: 2,
        resetTimeout: 1000,
        monitoringPeriod: 5000
      }, 'test', 'model');

      // Trigger circuit breaker
      await expect(circuitFn()).rejects.toThrow('Service error');
      await expect(circuitFn()).rejects.toThrow('Service error');
      await expect(circuitFn()).rejects.toThrow('Circuit breaker open');

      // Fast forward time to reset circuit
      jest.advanceTimersByTime(1500);

      // Should now allow requests again
      const result = await circuitFn();
      expect(result).toBe('success');

      jest.useRealTimers();
    });
  });

  describe('Fallback Strategy', () => {
    it('should use primary function when it succeeds', async () => {
      const primaryFn = jest.fn<() => Promise<string>>().mockResolvedValue('primary result');
      const fallbackFn = jest.fn<() => Promise<string>>().mockResolvedValue('fallback result');
      const strategyFn = createFallbackStrategy(primaryFn as any, fallbackFn as any);

      const result = await strategyFn();

      expect(result).toBe('primary result');
      expect(primaryFn).toHaveBeenCalledTimes(1);
      expect(fallbackFn).not.toHaveBeenCalled();
    });

    it('should use fallback when primary fails', async () => {
      const primaryFn = jest.fn<() => Promise<string>>().mockRejectedValue(new Error('Primary failed'));
      const fallbackFn = jest.fn<() => Promise<string>>().mockResolvedValue('fallback result');
      const strategyFn = createFallbackStrategy(primaryFn as any, fallbackFn as any);

      const result = await strategyFn();

      expect(result).toBe('fallback result');
      expect(primaryFn).toHaveBeenCalledTimes(1);
      expect(fallbackFn).toHaveBeenCalledTimes(1);
    });

    it('should respect fallback condition', async () => {
      const primaryFn = jest.fn<() => Promise<string>>().mockRejectedValue(new Error('Auth error'));
      const fallbackFn = jest.fn<() => Promise<string>>().mockResolvedValue('fallback result');
      const shouldFallback = jest.fn<(error: any) => boolean>().mockReturnValue(false);
      const strategyFn = createFallbackStrategy(primaryFn as any, fallbackFn as any, shouldFallback as any);

      await expect(strategyFn()).rejects.toThrow('Auth error');
      expect(fallbackFn).not.toHaveBeenCalled();
    });
  });

  describe('Error Monitor', () => {
    it('should record and track errors', () => {
      const monitor = createLLMErrorMonitor();
      const error1 = createLLMError('Error 1', LLM_ERROR_TYPES.TIMEOUT, { provider: 'openai', model: 'gpt-4' });
      const error2 = createLLMError('Error 2', LLM_ERROR_TYPES.RATE_LIMITED, { provider: 'anthropic', model: 'claude' });

      monitor.recordError(error1);
      monitor.recordError(error2);

      const metrics = monitor.getMetrics();

      expect(metrics.totalErrors).toBe(2);
      expect(metrics.errorsByType[LLM_ERROR_TYPES.TIMEOUT]).toBe(1);
      expect(metrics.errorsByType[LLM_ERROR_TYPES.RATE_LIMITED]).toBe(1);
      expect(metrics.errorsByProvider.openai).toBe(1);
      expect(metrics.errorsByProvider.anthropic).toBe(1);
      expect(metrics.errorsByModel['gpt-4']).toBe(1);
      expect(metrics.errorsByModel.claude).toBe(1);
      expect(metrics.lastError).toBe(error2);
    });

    it('should reset metrics', () => {
      const monitor = createLLMErrorMonitor();
      const error = createLLMError('Error', LLM_ERROR_TYPES.TIMEOUT);

      monitor.recordError(error);
      expect(monitor.getMetrics().totalErrors).toBe(1);

      monitor.resetMetrics();
      const metrics = monitor.getMetrics();

      expect(metrics.totalErrors).toBe(0);
      expect(Object.keys(metrics.errorsByType)).toHaveLength(0);
      expect(metrics.lastError).toBeUndefined();
    });
  });

  describe('Error Logger', () => {
    it('should log errors', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const logger = createLLMErrorLogger();
      const error = createLLMError('Test error', LLM_ERROR_TYPES.TIMEOUT, { provider: 'openai', model: 'gpt-4' });

      logger.logError(error, { extra: 'context' });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[ADK:LLM:ERROR] TIMEOUT: Test error',
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4',
          retryable: true,
          context: { extra: 'context' }
        })
      );

      consoleSpy.mockRestore();
    });

    it('should log retries', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const logger = createLLMErrorLogger();
      const error = createLLMError('Rate limit', LLM_ERROR_TYPES.RATE_LIMITED, { provider: 'openai' });

      logger.logRetry(error, 2, 2000);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[ADK:LLM:RETRY] Attempt 2 failed: Rate limit. Retrying in 2000ms',
        expect.objectContaining({
          provider: 'openai',
          code: LLM_ERROR_TYPES.RATE_LIMITED
        })
      );

      consoleSpy.mockRestore();
    });

    it('should log recovery', () => {
      const consoleSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
      const logger = createLLMErrorLogger();
      const error = createLLMError('Service error', LLM_ERROR_TYPES.SERVICE_UNAVAILABLE, { provider: 'anthropic' });

      logger.logRecovery(error, 'fallback');

      expect(consoleSpy).toHaveBeenCalledWith(
        '[ADK:LLM:RECOVERY] Recovered from error using fallback: Service error',
        expect.objectContaining({
          provider: 'anthropic',
          code: LLM_ERROR_TYPES.SERVICE_UNAVAILABLE
        })
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Default Error Handler', () => {
    it('should provide all error handling utilities', () => {
      expect(typeof defaultLLMErrorHandler.classify).toBe('function');
      expect(typeof defaultLLMErrorHandler.retry).toBe('function');
      expect(typeof defaultLLMErrorHandler.timeout).toBe('function');
      expect(typeof defaultLLMErrorHandler.fallback).toBe('function');
      expect(typeof defaultLLMErrorHandler.circuitBreaker).toBe('function');
      expect(typeof defaultLLMErrorHandler.monitor.recordError).toBe('function');
      expect(typeof defaultLLMErrorHandler.logger.logError).toBe('function');
    });
  });

  describe('Constants', () => {
    it('should have correct error types', () => {
      expect(LLM_ERROR_TYPES.INVALID_API_KEY).toBe('INVALID_API_KEY');
      expect(LLM_ERROR_TYPES.RATE_LIMITED).toBe('RATE_LIMITED');
      expect(LLM_ERROR_TYPES.TIMEOUT).toBe('TIMEOUT');
      expect(LLM_ERROR_TYPES.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR');
    });

    it('should have correct retryable errors', () => {
      expect(RETRYABLE_ERRORS.has(LLM_ERROR_TYPES.RATE_LIMITED)).toBe(true);
      expect(RETRYABLE_ERRORS.has(LLM_ERROR_TYPES.TIMEOUT)).toBe(true);
      expect(RETRYABLE_ERRORS.has(LLM_ERROR_TYPES.SERVICE_UNAVAILABLE)).toBe(true);
      expect(RETRYABLE_ERRORS.has(LLM_ERROR_TYPES.NETWORK_ERROR)).toBe(true);
      expect(RETRYABLE_ERRORS.has(LLM_ERROR_TYPES.INVALID_API_KEY as any)).toBe(false);
      expect(RETRYABLE_ERRORS.has(LLM_ERROR_TYPES.QUOTA_EXCEEDED as any)).toBe(false);
    });

    it('should have valid default retry config', () => {
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBeGreaterThan(0);
      expect(DEFAULT_RETRY_CONFIG.baseDelay).toBeGreaterThan(0);
      expect(DEFAULT_RETRY_CONFIG.maxDelay).toBeGreaterThan(DEFAULT_RETRY_CONFIG.baseDelay);
      expect(Array.isArray(DEFAULT_RETRY_CONFIG.retryableErrors)).toBe(true);
      expect(DEFAULT_RETRY_CONFIG.retryableErrors.length).toBeGreaterThan(0);
    });
  });
});