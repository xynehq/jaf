import {
  buildEffectiveGuardrails,
  executeInputGuardrailsParallel,
  executeInputGuardrailsSequential,
  executeOutputGuardrails,
  guardrailCacheManager
} from '../guardrails.js';
import {
  Agent,
  RunConfig,
  ValidationResult,
  validateGuardrailsConfig,
  defaultGuardrailsConfig,
  createRunId,
  createTraceId,
  getTextContent
} from '../types.js';

// Mock model provider for testing
const mockModelProvider = {
  getCompletion: jest.fn()
};

// Mock config for testing
const createMockConfig = (overrides: any = {}): RunConfig<any> => ({
  modelProvider: mockModelProvider,
  agentRegistry: new Map(),
  maxTurns: 10,
  defaultFastModel: 'test-model',
  onEvent: jest.fn(),
  ...overrides
});

// Mock message for testing
const createMockMessage = (content: string) => ({
  role: 'user' as const,
  content
});

describe('Guardrails Configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    guardrailCacheManager.clear();
  });

  describe('validateGuardrailsConfig', () => {
    it('should use default values for empty config', () => {
      const result = validateGuardrailsConfig({});
      expect(result).toEqual(defaultGuardrailsConfig);
    });

    it('should trim and validate string inputs', () => {
      const result = validateGuardrailsConfig({
        inputPrompt: '  check safety  ',
        outputPrompt: '  validate output  ',
        fastModel: '  claude-3  '
      });
      
      expect(result.inputPrompt).toBe('check safety');
      expect(result.outputPrompt).toBe('validate output');
      expect(result.fastModel).toBe('claude-3');
    });

    it('should enforce minimum timeout', () => {
      const result = validateGuardrailsConfig({
        timeoutMs: 500 // Below minimum
      });
      
      expect(result.timeoutMs).toBe(1000); // Should be clamped to minimum
    });

    it('should handle partial configs correctly', () => {
      const result = validateGuardrailsConfig({
        requireCitations: true,
        executionMode: 'sequential'
      });
      
      expect(result.requireCitations).toBe(true);
      expect(result.executionMode).toBe('sequential');
      expect(result.failSafe).toBe('allow'); // Should use default
    });
  });

  describe('buildEffectiveGuardrails', () => {
    it('should build empty guardrails for agent without config', async () => {
      const agent: Agent<any, any> = {
        name: 'test-agent',
        instructions: () => 'test'
      };

      const config = createMockConfig();
      const result = await buildEffectiveGuardrails(agent, config);

      expect(result.inputGuardrails).toHaveLength(0);
      expect(result.outputGuardrails).toHaveLength(0);
    });

    it('should include global guardrails when present', async () => {
      const agent: Agent<any, any> = {
        name: 'test-agent',
        instructions: () => 'test'
      };

      const globalGuardrail = jest.fn().mockResolvedValue({ isValid: true });
      const config = createMockConfig({
        initialInputGuardrails: [globalGuardrail],
        finalOutputGuardrails: [globalGuardrail]
      });

      const result = await buildEffectiveGuardrails(agent, config);

      expect(result.inputGuardrails).toHaveLength(1);
      expect(result.outputGuardrails).toHaveLength(1);
    });

    it('should add citation guardrail when required', async () => {
      const agent: Agent<any, any> = {
        name: 'test-agent',
        instructions: () => 'test',
        advancedConfig: {
          guardrails: {
            requireCitations: true
          }
        }
      };

      const config = createMockConfig();
      const result = await buildEffectiveGuardrails(agent, config);

      expect(result.outputGuardrails).toHaveLength(1);
      
      // Test citation guardrail functionality
      const citationGuardrail = result.outputGuardrails[0];
      
      // Should pass with citations
      const resultWithCitation = await citationGuardrail('This has a citation [1]');
      expect(resultWithCitation.isValid).toBe(true);
      
      // Should fail without citations
      const resultWithoutCitation = await citationGuardrail('This has no citation');
      expect(resultWithoutCitation.isValid).toBe(false);
    });

    it('should handle configuration errors gracefully', async () => {
      const agent: Agent<any, any> = {
        name: 'test-agent',
        instructions: () => 'test',
        advancedConfig: {
          guardrails: {
            inputPrompt: 'test prompt',
            fastModel: undefined // This might cause issues
          }
        }
      };

      const config = createMockConfig({ defaultFastModel: undefined });
      
      // Should not throw
      const result = await buildEffectiveGuardrails(agent, config);
      expect(result).toBeDefined();
    });
  });

  describe('executeInputGuardrailsSequential', () => {
    it('should return valid for empty guardrails', async () => {
      const message = createMockMessage('test content');
      const config = createMockConfig();
      
      const result = await executeInputGuardrailsSequential([], message, config);
      expect(result.isValid).toBe(true);
    });

    it('should execute guardrails sequentially', async () => {
      const guardrail1 = jest.fn().mockResolvedValue({ isValid: true });
      const guardrail2 = jest.fn().mockResolvedValue({ isValid: true });
      
      const message = createMockMessage('test content');
      const config = createMockConfig();
      
      const result = await executeInputGuardrailsSequential([guardrail1, guardrail2], message, config);
      
      expect(result.isValid).toBe(true);
      expect(guardrail1).toHaveBeenCalledWith('test content');
      expect(guardrail2).toHaveBeenCalledWith('test content');
    });

    it('should stop on first failure in sequential mode', async () => {
      const guardrail1 = jest.fn().mockResolvedValue({ 
        isValid: false, 
        errorMessage: 'First guardrail failed' 
      });
      const guardrail2 = jest.fn().mockResolvedValue({ isValid: true });
      
      const message = createMockMessage('test content');
      const config = createMockConfig();
      
      const result = await executeInputGuardrailsSequential([guardrail1, guardrail2], message, config);
      
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorMessage).toBe('First guardrail failed');
      }
      expect(guardrail1).toHaveBeenCalled();
      expect(guardrail2).not.toHaveBeenCalled(); // Should not reach second guardrail
    });
  });

  describe('executeInputGuardrailsParallel', () => {
    it('should return valid for empty guardrails', async () => {
      const message = createMockMessage('test content');
      const config = createMockConfig();
      
      const result = await executeInputGuardrailsParallel([], message, config);
      expect(result.isValid).toBe(true);
    });

    it('should execute guardrails in parallel', async () => {
      const guardrail1 = jest.fn().mockResolvedValue({ isValid: true });
      const guardrail2 = jest.fn().mockResolvedValue({ isValid: true });
      
      const message = createMockMessage('test content');
      const config = createMockConfig();
      
      const startTime = Date.now();
      const result = await executeInputGuardrailsParallel([guardrail1, guardrail2], message, config);
      const endTime = Date.now();
      
      expect(result.isValid).toBe(true);
      expect(guardrail1).toHaveBeenCalled();
      expect(guardrail2).toHaveBeenCalled();
      
      // Both should have been called with same content
      expect(guardrail1).toHaveBeenCalledWith('test content');
      expect(guardrail2).toHaveBeenCalledWith('test content');
    });

    it('should handle guardrail failures gracefully', async () => {
      const successfulGuardrail = jest.fn().mockResolvedValue({ isValid: true });
      const failingGuardrail = jest.fn().mockRejectedValue(new Error('Guardrail failed'));
      
      const message = createMockMessage('test content');
      const config = createMockConfig();
      
      const result = await executeInputGuardrailsParallel([successfulGuardrail, failingGuardrail], message, config);
      
      // Should still pass due to graceful error handling
      expect(result.isValid).toBe(true);
    });

    it('should fail when a guardrail returns invalid', async () => {
      const successfulGuardrail = jest.fn().mockResolvedValue({ isValid: true });
      const blockingGuardrail = jest.fn().mockResolvedValue({ 
        isValid: false, 
        errorMessage: 'Content blocked' 
      });
      
      const message = createMockMessage('harmful content');
      const config = createMockConfig();
      
      const result = await executeInputGuardrailsParallel([successfulGuardrail, blockingGuardrail], message, config);
      
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorMessage).toBe('Content blocked');
      }
    });

    it('should handle timeouts gracefully', async () => {
      const slowGuardrail = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ isValid: true }), 15000))
      );
      
      const message = createMockMessage('test content');
      const config = createMockConfig();
      
      const result = await executeInputGuardrailsParallel([slowGuardrail], message, config);
      
      // Should pass due to timeout handling with graceful degradation
      expect(result.isValid).toBe(true);
    }, 15000);
  });

  describe('executeOutputGuardrails', () => {
    it('should return valid for empty guardrails', async () => {
      const config = createMockConfig();
      
      const result = await executeOutputGuardrails([], 'test output', config);
      expect(result.isValid).toBe(true);
    });

    it('should execute guardrails sequentially', async () => {
      const guardrail1 = jest.fn().mockResolvedValue({ isValid: true });
      const guardrail2 = jest.fn().mockResolvedValue({ isValid: true });
      
      const config = createMockConfig();
      
      const result = await executeOutputGuardrails([guardrail1, guardrail2], 'test output', config);
      
      expect(result.isValid).toBe(true);
      expect(guardrail1).toHaveBeenCalledWith('test output');
      expect(guardrail2).toHaveBeenCalledWith('test output');
    });

    it('should stop on first failure', async () => {
      const guardrail1 = jest.fn().mockResolvedValue({ 
        isValid: false, 
        errorMessage: 'Output invalid' 
      });
      const guardrail2 = jest.fn().mockResolvedValue({ isValid: true });
      
      const config = createMockConfig();
      
      const result = await executeOutputGuardrails([guardrail1, guardrail2], 'test output', config);
      
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorMessage).toBe('Output invalid');
      }
      expect(guardrail1).toHaveBeenCalled();
      expect(guardrail2).not.toHaveBeenCalled(); // Should not reach second guardrail
    });

    it('should handle system errors gracefully', async () => {
      const erroringGuardrail = jest.fn().mockRejectedValue(new Error('Timeout: execution timed out'));
      
      const config = createMockConfig();
      
      const result = await executeOutputGuardrails([erroringGuardrail], 'test output', config);
      
      // System errors should allow output to pass
      expect(result.isValid).toBe(true);
    });

    it('should block on actual guardrail violations', async () => {
      const violatingGuardrail = jest.fn().mockRejectedValue(new Error('Content violation'));
      
      const config = createMockConfig();
      
      const result = await executeOutputGuardrails([violatingGuardrail], 'test output', config);
      
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorMessage).toBe('Content violation');
      }
    });
  });

  describe('Cache Management', () => {
    it('should provide cache statistics', () => {
      const stats = guardrailCacheManager.getStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('maxSize');
    });

    it('should provide cache metrics', () => {
      const metrics = guardrailCacheManager.getMetrics();
      expect(metrics).toHaveProperty('size');
      expect(metrics).toHaveProperty('maxSize');
      expect(metrics).toHaveProperty('utilizationPercent');
      expect(typeof metrics.utilizationPercent).toBe('number');
    });

    it('should clear cache successfully', () => {
      guardrailCacheManager.clear();
      const stats = guardrailCacheManager.getStats();
      expect(stats.size).toBe(0);
    });

    it('should log stats without throwing', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      guardrailCacheManager.logStats();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[JAF:GUARDRAILS] Cache stats:'),
        expect.any(Object)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('Error Boundaries and Circuit Breaker', () => {
    it('should handle multiple consecutive failures', async () => {
      // Mock LLM that always fails
      const failingModelProvider = {
        getCompletion: jest.fn().mockRejectedValue(new Error('Model failure'))
      };

      const agent: Agent<any, any> = {
        name: 'test-agent',
        instructions: () => 'test',
        advancedConfig: {
          guardrails: {
            inputPrompt: 'Check safety',
            fastModel: 'failing-model'
          }
        }
      };

      const config = createMockConfig({ 
        modelProvider: failingModelProvider,
        defaultFastModel: 'failing-model'
      });

      const result = await buildEffectiveGuardrails(agent, config);
      expect(result.inputGuardrails).toHaveLength(1);

      const message = createMockMessage('test content');
      
      // Multiple failures should be handled gracefully
      for (let i = 0; i < 10; i++) {
        const guardrailResult = await executeInputGuardrailsParallel(
          result.inputGuardrails, 
          message, 
          config
        );
        // Should default to allow due to failSafe
        expect(guardrailResult.isValid).toBe(true);
      }
    });
  });

  describe('Content Validation', () => {
    it('should handle various content types in getTextContent', () => {
      
      // String content
      expect(getTextContent('simple string')).toBe('simple string');
      
      // Array content
      expect(getTextContent([
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' }
      ])).toBe('first second');
      
      // Object content
      expect(getTextContent({ text: 'object text' })).toBe('object text');
      expect(getTextContent({ content: 'object content' })).toBe('object content');
      
      // Null/undefined
      expect(getTextContent(null)).toBe('');
      expect(getTextContent(undefined)).toBe('');
      
      // Numbers and other types
      expect(getTextContent(123)).toBe('123');
    });
  });
});

describe('Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    guardrailCacheManager.clear();
  });

  it('should work end-to-end with real-like scenario', async () => {
    // Mock a successful LLM response
    mockModelProvider.getCompletion.mockResolvedValue({
      message: {
        content: JSON.stringify({ allowed: true, reason: 'Content is safe' })
      }
    });

    const agent: Agent<any, any> = {
      name: 'safe-assistant',
      instructions: () => 'You are a helpful assistant',
      advancedConfig: {
        guardrails: {
          inputPrompt: 'Check if content is safe and appropriate',
          outputPrompt: 'Ensure response is helpful and safe',
          requireCitations: true,
          fastModel: 'claude-3-haiku',
          failSafe: 'allow',
          executionMode: 'parallel',
          timeoutMs: 5000
        }
      }
    };

    const config = createMockConfig({
      defaultFastModel: 'claude-3-haiku'
    });

    // Build guardrails
    const { inputGuardrails, outputGuardrails } = await buildEffectiveGuardrails(agent, config);
    
    expect(inputGuardrails.length).toBeGreaterThan(0);
    expect(outputGuardrails.length).toBeGreaterThan(0);

    // Test input validation
    const message = createMockMessage('Tell me about renewable energy');
    const inputResult = await executeInputGuardrailsParallel(inputGuardrails, message, config);
    expect(inputResult.isValid).toBe(true);

    // Test output validation with citations
    const outputWithCitation = 'Renewable energy sources include solar and wind [1]';
    const outputResult = await executeOutputGuardrails(outputGuardrails, outputWithCitation, config);
    expect(outputResult.isValid).toBe(true);

    // Test output validation without citations (should fail)
    const outputWithoutCitation = 'Renewable energy sources include solar and wind';
    const outputResultFail = await executeOutputGuardrails(outputGuardrails, outputWithoutCitation, config);
    expect(outputResultFail.isValid).toBe(false);
  });
});