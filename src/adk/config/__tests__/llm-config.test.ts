/**
 * Tests for LLM Configuration System
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createAdkLLMConfig,
  createDefaultAdkLLMConfig,
  createAdkLLMConfigFromEnvironment,
  createAdkLLMServiceConfig,
  validateAdkLLMConfig,
  debugAdkLLMConfig,
  loadEnvironmentConfig,
  getModelConfig,
  getModelsForProvider,
  getAllAvailableModels,
  getProviderForModel,
  mapAdkModelToProviderModel,
  DEFAULT_PROVIDER_CONFIGS
} from '../llm-config.js';
import { Model } from '../../types.js';

describe('LLM Configuration System', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createAdkLLMConfig', () => {
    it('should create config for litellm provider', () => {
      const config = createAdkLLMConfig('litellm');

      expect(config.provider).toBe('litellm');
      expect(config.baseUrl).toBe('http://localhost:4000');
      expect(config.apiKey).toBe('anything');
      expect(config.timeout).toBe(30000);
      expect(config.retries).toBe(3);
    });

    it('should create config for openai provider', () => {
      const config = createAdkLLMConfig('openai');

      expect(config.provider).toBe('openai');
      expect(config.baseUrl).toBe('https://api.openai.com/v1');
      expect(config.apiKey).toBe('');
    });

    it('should create config for anthropic provider', () => {
      const config = createAdkLLMConfig('anthropic');

      expect(config.provider).toBe('anthropic');
      expect(config.baseUrl).toBe('https://api.anthropic.com');
      expect(config.apiKey).toBe('');
    });

    it('should create config for google provider', () => {
      const config = createAdkLLMConfig('google');

      expect(config.provider).toBe('google');
      expect(config.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
      expect(config.apiKey).toBe('');
    });

    it('should throw error for unknown provider', () => {
      expect(() => createAdkLLMConfig('unknown' as any)).toThrow('Unknown provider: unknown');
    });

    it('should apply overrides', () => {
      const config = createAdkLLMConfig('litellm', {
        temperature: 0.5,
        maxTokens: 1000,
        streaming: false
      });

      expect(config.temperature).toBe(0.5);
      expect(config.maxTokens).toBe(1000);
      expect(config.streaming).toBe(false);
    });

    it('should use environment variables', () => {
      process.env.LITELLM_URL = 'http://custom:4000';
      process.env.LITELLM_API_KEY = 'custom-key';
      process.env.ADK_DEFAULT_MODEL = 'gpt-3.5-turbo';

      const config = createAdkLLMConfig('litellm');

      expect(config.baseUrl).toBe('http://custom:4000');
      expect(config.apiKey).toBe('custom-key');
      expect(config.defaultModel).toBe('gpt-3.5-turbo');
    });
  });

  describe('createDefaultAdkLLMConfig', () => {
    it('should create default litellm config', () => {
      const config = createDefaultAdkLLMConfig();

      expect(config.provider).toBe('litellm');
      expect(config.baseUrl).toBe('http://localhost:4000');
      expect(config.apiKey).toBe('anything');
    });
  });

  describe('createAdkLLMConfigFromEnvironment', () => {
    it('should default to litellm when no API keys present', () => {
      const config = createAdkLLMConfigFromEnvironment();

      expect(config.provider).toBe('litellm');
    });

    it('should prefer openai when API key is present', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const config = createAdkLLMConfigFromEnvironment();

      expect(config.provider).toBe('openai');
    });

    it('should prefer anthropic when API key is present', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      const config = createAdkLLMConfigFromEnvironment();

      expect(config.provider).toBe('anthropic');
    });

    it('should prefer google when API key is present', () => {
      process.env.GOOGLE_API_KEY = 'google-test-key';

      const config = createAdkLLMConfigFromEnvironment();

      expect(config.provider).toBe('google');
    });

    it('should use explicit provider setting', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      process.env.ADK_DEFAULT_PROVIDER = 'anthropic';

      const config = createAdkLLMConfigFromEnvironment();

      expect(config.provider).toBe('anthropic');
    });

    it('should use default model from environment', () => {
      process.env.ADK_DEFAULT_MODEL = 'claude-3-sonnet';

      const config = createAdkLLMConfigFromEnvironment();

      expect(config.defaultModel).toBe('claude-3-sonnet');
    });
  });

  describe('createAdkLLMServiceConfig', () => {
    it('should convert ADK config to service config', () => {
      const adkConfig = createAdkLLMConfig('openai', {
        defaultModel: 'gpt-4'
      });

      const serviceConfig = createAdkLLMServiceConfig(adkConfig);

      expect(serviceConfig.provider).toBe('openai');
      expect(serviceConfig.baseUrl).toBe('https://api.openai.com/v1');
      expect(serviceConfig.apiKey).toBe('');
      expect(serviceConfig.defaultModel).toBe('gpt-4');
    });
  });

  describe('validateAdkLLMConfig', () => {
    it('should validate valid config', () => {
      const config = createAdkLLMConfig('litellm');
      const errors = validateAdkLLMConfig(config);

      expect(errors).toEqual([]);
    });

    it('should detect missing provider', () => {
      const config = createAdkLLMConfig('litellm');
      delete (config as any).provider;

      const errors = validateAdkLLMConfig(config);

      expect(errors).toContain('Provider is required');
    });

    it('should detect unknown provider', () => {
      const config = createAdkLLMConfig('litellm');
      (config as any).provider = 'unknown';

      const errors = validateAdkLLMConfig(config);

      expect(errors).toContain('Unknown provider: unknown');
    });

    it('should detect missing API key for non-litellm providers', () => {
      const config = createAdkLLMConfig('openai');
      config.apiKey = '';

      const errors = validateAdkLLMConfig(config);

      expect(errors).toContain('API key is required for provider: openai');
    });

    it('should detect missing base URL', () => {
      const config = createAdkLLMConfig('litellm');
      delete config.baseUrl;

      const errors = validateAdkLLMConfig(config);

      expect(errors).toContain('Base URL is required');
    });

    it('should detect invalid timeout', () => {
      const config = createAdkLLMConfig('litellm', { timeout: -1000 });

      const errors = validateAdkLLMConfig(config);

      expect(errors).toContain('Timeout must be positive');
    });

    it('should detect invalid retries', () => {
      const config = createAdkLLMConfig('litellm', { retries: -1 });

      const errors = validateAdkLLMConfig(config);

      expect(errors).toContain('Retries must be non-negative');
    });

    it('should detect invalid temperature', () => {
      const config = createAdkLLMConfig('litellm', { temperature: 3.0 });

      const errors = validateAdkLLMConfig(config);

      expect(errors).toContain('Temperature must be between 0 and 2');
    });

    it('should detect invalid max tokens', () => {
      const config = createAdkLLMConfig('litellm', { maxTokens: -100 });

      const errors = validateAdkLLMConfig(config);

      expect(errors).toContain('Max tokens must be positive');
    });
  });

  describe('loadEnvironmentConfig', () => {
    it('should load environment variables', () => {
      process.env.LITELLM_URL = 'http://test:4000';
      process.env.LITELLM_API_KEY = 'test-key';
      process.env.OPENAI_API_KEY = 'sk-openai-key';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-key';
      process.env.GOOGLE_API_KEY = 'google-key';
      process.env.ADK_DEFAULT_PROVIDER = 'openai';
      process.env.ADK_DEFAULT_MODEL = 'gpt-4';

      const envConfig = loadEnvironmentConfig();

      expect(envConfig.litellmUrl).toBe('http://test:4000');
      expect(envConfig.litellmApiKey).toBe('test-key');
      expect(envConfig.openaiApiKey).toBe('sk-openai-key');
      expect(envConfig.anthropicApiKey).toBe('sk-ant-key');
      expect(envConfig.googleApiKey).toBe('google-key');
      expect(envConfig.defaultProvider).toBe('openai');
      expect(envConfig.defaultModel).toBe('gpt-4');
    });

    it('should handle missing environment variables', () => {
      const envConfig = loadEnvironmentConfig();

      expect(envConfig.litellmUrl).toBeUndefined();
      expect(envConfig.litellmApiKey).toBeUndefined();
      expect(envConfig.openaiApiKey).toBeUndefined();
    });
  });

  describe('Model Configuration Helpers', () => {
    it('should get model config by name', () => {
      const modelConfig = getModelConfig('gpt-4o');

      expect(modelConfig).toBeDefined();
      expect(modelConfig!.name).toBe('gpt-4o');
      expect(modelConfig!.displayName).toBe('GPT-4o');
      expect(modelConfig!.supportsFunctionCalling).toBe(true);
      expect(modelConfig!.supportsStreaming).toBe(true);
    });

    it('should return undefined for unknown model', () => {
      const modelConfig = getModelConfig('unknown-model');

      expect(modelConfig).toBeUndefined();
    });

    it('should get models for provider', () => {
      const openaiModels = getModelsForProvider('openai');

      expect(openaiModels.length).toBeGreaterThan(0);
      expect(openaiModels.every(m => m.supportsFunctionCalling)).toBe(true);
    });

    it('should return empty array for unknown provider', () => {
      const models = getModelsForProvider('unknown');

      expect(models).toEqual([]);
    });

    it('should get all available models', () => {
      const allModels = getAllAvailableModels();

      expect(allModels.length).toBeGreaterThan(0);
      expect(allModels.some(m => m.name === 'gpt-4o')).toBe(true);
      expect(allModels.some(m => m.name === 'claude-3-sonnet')).toBe(true);
      expect(allModels.some(m => m.name === 'gemini-1.5-pro')).toBe(true);
    });

    it('should get provider for model', () => {
      expect(getProviderForModel('gpt-4o')).toBe('openai');
      expect(getProviderForModel('claude-3-sonnet')).toBe('anthropic');
      expect(getProviderForModel('gemini-1.5-pro')).toBe('google');
      expect(getProviderForModel('unknown-model')).toBeUndefined();
    });
  });

  describe('Model Name Mapping', () => {
    it('should map ADK models to provider models', () => {
      expect(mapAdkModelToProviderModel(Model.GPT_4)).toBe('gpt-4');
      expect(mapAdkModelToProviderModel(Model.CLAUDE_3_SONNET)).toBe('claude-3-sonnet');
      expect(mapAdkModelToProviderModel(Model.GEMINI_1_5_PRO)).toBe('gemini-1.5-pro');
      expect(mapAdkModelToProviderModel('custom-model')).toBe('custom-model');
    });

    it('should handle CUSTOM model enum', () => {
      expect(mapAdkModelToProviderModel(Model.CUSTOM)).toBe('gpt-4o');
    });
  });

  describe('DEFAULT_PROVIDER_CONFIGS', () => {
    it('should have valid provider configurations', () => {
      expect(DEFAULT_PROVIDER_CONFIGS.litellm).toBeDefined();
      expect(DEFAULT_PROVIDER_CONFIGS.openai).toBeDefined();
      expect(DEFAULT_PROVIDER_CONFIGS.anthropic).toBeDefined();
      expect(DEFAULT_PROVIDER_CONFIGS.google).toBeDefined();

      // Check LiteLLM config
      const litellmConfig = DEFAULT_PROVIDER_CONFIGS.litellm;
      expect(litellmConfig.name).toBe('LiteLLM');
      expect(litellmConfig.baseUrl).toBe('http://localhost:4000');
      expect(litellmConfig.models.length).toBeGreaterThan(0);
      expect(litellmConfig.features?.streaming).toBe(true);
      expect(litellmConfig.features?.functionCalling).toBe(true);

      // Check OpenAI config
      const openaiConfig = DEFAULT_PROVIDER_CONFIGS.openai;
      expect(openaiConfig.name).toBe('OpenAI');
      expect(openaiConfig.baseUrl).toBe('https://api.openai.com/v1');
      expect(openaiConfig.models.some(m => m.name === 'gpt-4o')).toBe(true);
      expect(openaiConfig.rateLimits?.requestsPerMinute).toBeDefined();

      // Check Anthropic config
      const anthropicConfig = DEFAULT_PROVIDER_CONFIGS.anthropic;
      expect(anthropicConfig.name).toBe('Anthropic');
      expect(anthropicConfig.baseUrl).toBe('https://api.anthropic.com');
      expect(anthropicConfig.models.some(m => m.name === 'claude-3-sonnet')).toBe(true);

      // Check Google config
      const googleConfig = DEFAULT_PROVIDER_CONFIGS.google;
      expect(googleConfig.name).toBe('Google AI');
      expect(googleConfig.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
      expect(googleConfig.models.some(m => m.name === 'gemini-1.5-pro')).toBe(true);
    });

    it('should have consistent model configurations', () => {
      Object.values(DEFAULT_PROVIDER_CONFIGS).forEach(providerConfig => {
        providerConfig.models.forEach(model => {
          expect(model.name).toBeTruthy();
          expect(model.displayName).toBeTruthy();
          expect(typeof model.contextWindow).toBe('number');
          expect(typeof model.maxTokens).toBe('number');
          expect(typeof model.supportsFunctionCalling).toBe('boolean');
          expect(typeof model.supportsStreaming).toBe('boolean');
          
          if (model.costPer1KTokens) {
            expect(typeof model.costPer1KTokens.input).toBe('number');
            expect(typeof model.costPer1KTokens.output).toBe('number');
            expect(model.costPer1KTokens.input).toBeGreaterThan(0);
            expect(model.costPer1KTokens.output).toBeGreaterThan(0);
          }
        });
      });
    });
  });

  describe('debugAdkLLMConfig', () => {
    it('should debug config without throwing', () => {
      const config = createAdkLLMConfig('litellm');
      
      // Mock console.log to capture output
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      expect(() => debugAdkLLMConfig(config)).not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith('[ADK:CONFIG] LLM Configuration:');
      expect(consoleSpy).toHaveBeenCalledWith('[ADK:CONFIG] Configuration is valid');

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should show validation issues', () => {
      const config = createAdkLLMConfig('openai');
      config.apiKey = '';

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      debugAdkLLMConfig(config);

      expect(consoleWarnSpy).toHaveBeenCalledWith('[ADK:CONFIG] Configuration issues:');

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('should handle provider config without models', () => {
      expect(getModelsForProvider('nonexistent')).toEqual([]);
    });

    it('should handle empty environment variables', () => {
      // Clear all relevant env vars
      delete process.env.LITELLM_URL;
      delete process.env.LITELLM_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const config = createAdkLLMConfigFromEnvironment();
      
      expect(config.provider).toBe('litellm'); // Should default to litellm
    });

    it('should handle model enum edge cases', () => {
      expect(mapAdkModelToProviderModel(undefined as any)).toBe('gpt-4o');
      expect(mapAdkModelToProviderModel(null as any)).toBe('gpt-4o');
    });
  });
});