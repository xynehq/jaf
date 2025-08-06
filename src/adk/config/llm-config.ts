/**
 * JAF ADK Layer - LLM Configuration Bridge
 * 
 * Functional configuration system for LLM providers following JAF patterns
 */

import { Model } from '../types.js';
import type { AdkLLMServiceConfig } from '../providers/llm-service.js';

// ========== Configuration Types ==========

export interface AdkLLMConfig {
  provider: 'litellm' | 'openai' | 'anthropic' | 'google';
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: Model | string;
  timeout?: number;
  retries?: number;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
}

export interface AdkProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: AdkModelConfig[];
  rateLimits?: AdkRateLimitConfig;
  features?: AdkProviderFeatures;
}

export interface AdkModelConfig {
  name: string;
  displayName: string;
  contextWindow: number;
  maxTokens: number;
  supportsFunctionCalling: boolean;
  supportsStreaming: boolean;
  costPer1KTokens?: {
    input: number;
    output: number;
  };
}

export interface AdkRateLimitConfig {
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  concurrent?: number;
}

export interface AdkProviderFeatures {
  streaming: boolean;
  functionCalling: boolean;
  multimodal: boolean;
  vision: boolean;
  jsonMode: boolean;
}

export interface AdkEnvironmentConfig {
  litellmUrl?: string;
  litellmApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  azureApiKey?: string;
  azureEndpoint?: string;
  defaultProvider?: string;
  defaultModel?: string;
}

// ========== Default Configurations ==========

export const DEFAULT_PROVIDER_CONFIGS: Record<string, AdkProviderConfig> = {
  litellm: {
    name: 'LiteLLM',
    baseUrl: 'http://localhost:4000',
    apiKey: 'anything',
    models: [
      {
        name: 'gpt-4o',
        displayName: 'GPT-4o',
        contextWindow: 128000,
        maxTokens: 4096,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        costPer1KTokens: { input: 0.005, output: 0.015 }
      },
      {
        name: 'gpt-4-turbo',
        displayName: 'GPT-4 Turbo',
        contextWindow: 128000,
        maxTokens: 4096,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        costPer1KTokens: { input: 0.01, output: 0.03 }
      },
      {
        name: 'claude-3-sonnet',
        displayName: 'Claude 3 Sonnet',
        contextWindow: 200000,
        maxTokens: 4096,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        costPer1KTokens: { input: 0.003, output: 0.015 }
      },
      {
        name: 'gemini-1.5-pro',
        displayName: 'Gemini 1.5 Pro',
        contextWindow: 1000000,
        maxTokens: 8192,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        costPer1KTokens: { input: 0.00125, output: 0.005 }
      }
    ],
    features: {
      streaming: true,
      functionCalling: true,
      multimodal: true,
      vision: true,
      jsonMode: true
    }
  },
  
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    models: [
      {
        name: 'gpt-4o',
        displayName: 'GPT-4o',
        contextWindow: 128000,
        maxTokens: 4096,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        costPer1KTokens: { input: 0.005, output: 0.015 }
      },
      {
        name: 'gpt-4-turbo',
        displayName: 'GPT-4 Turbo',
        contextWindow: 128000,
        maxTokens: 4096,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        costPer1KTokens: { input: 0.01, output: 0.03 }
      },
      {
        name: 'gpt-3.5-turbo',
        displayName: 'GPT-3.5 Turbo',
        contextWindow: 16384,
        maxTokens: 4096,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        costPer1KTokens: { input: 0.0005, output: 0.0015 }
      }
    ],
    rateLimits: {
      requestsPerMinute: 3500,
      tokensPerMinute: 90000
    },
    features: {
      streaming: true,
      functionCalling: true,
      multimodal: true,
      vision: true,
      jsonMode: true
    }
  },
  
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    models: [
      {
        name: 'claude-3-opus',
        displayName: 'Claude 3 Opus',
        contextWindow: 200000,
        maxTokens: 4096,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        costPer1KTokens: { input: 0.015, output: 0.075 }
      },
      {
        name: 'claude-3-sonnet',
        displayName: 'Claude 3 Sonnet',
        contextWindow: 200000,
        maxTokens: 4096,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        costPer1KTokens: { input: 0.003, output: 0.015 }
      },
      {
        name: 'claude-3-haiku',
        displayName: 'Claude 3 Haiku',
        contextWindow: 200000,
        maxTokens: 4096,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        costPer1KTokens: { input: 0.00025, output: 0.00125 }
      }
    ],
    rateLimits: {
      requestsPerMinute: 1000,
      tokensPerMinute: 80000
    },
    features: {
      streaming: true,
      functionCalling: true,
      multimodal: true,
      vision: true,
      jsonMode: false
    }
  },
  
  google: {
    name: 'Google AI',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: '',
    models: [
      {
        name: 'gemini-2.0-flash',
        displayName: 'Gemini 2.0 Flash',
        contextWindow: 1000000,
        maxTokens: 8192,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        costPer1KTokens: { input: 0.000125, output: 0.0005 }
      },
      {
        name: 'gemini-1.5-pro',
        displayName: 'Gemini 1.5 Pro',
        contextWindow: 1000000,
        maxTokens: 8192,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        costPer1KTokens: { input: 0.00125, output: 0.005 }
      },
      {
        name: 'gemini-1.5-flash',
        displayName: 'Gemini 1.5 Flash',
        contextWindow: 1000000,
        maxTokens: 8192,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        costPer1KTokens: { input: 0.000075, output: 0.0003 }
      }
    ],
    rateLimits: {
      requestsPerMinute: 1500,
      tokensPerMinute: 1000000
    },
    features: {
      streaming: true,
      functionCalling: true,
      multimodal: true,
      vision: true,
      jsonMode: false
    }
  }
};

// ========== Configuration Functions ==========

export const loadEnvironmentConfig = (): AdkEnvironmentConfig => {
  return {
    litellmUrl: process.env.LITELLM_URL,
    litellmApiKey: process.env.LITELLM_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    googleApiKey: process.env.GOOGLE_API_KEY,
    azureApiKey: process.env.AZURE_API_KEY,
    azureEndpoint: process.env.AZURE_ENDPOINT,
    defaultProvider: process.env.ADK_DEFAULT_PROVIDER,
    defaultModel: process.env.ADK_DEFAULT_MODEL
  };
};

export const createAdkLLMConfig = (
  provider: string,
  overrides?: Partial<AdkLLMConfig>
): AdkLLMConfig => {
  const envConfig = loadEnvironmentConfig();
  const providerConfig = DEFAULT_PROVIDER_CONFIGS[provider];
  
  if (!providerConfig) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  
  const apiKey = getApiKeyForProvider(provider, envConfig);
  const baseUrl = getBaseUrlForProvider(provider, envConfig, providerConfig);
  
  return {
    provider: provider as any,
    baseUrl,
    apiKey,
    defaultModel: envConfig.defaultModel || providerConfig.models[0].name,
    timeout: 30000,
    retries: 3,
    temperature: 0.7,
    maxTokens: 2000,
    streaming: true,
    ...overrides
  };
};

export const createAdkLLMServiceConfig = (config: AdkLLMConfig): AdkLLMServiceConfig => {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    defaultModel: config.defaultModel?.toString()
  };
};

// ========== Provider Configuration Helpers ==========

const getApiKeyForProvider = (provider: string, envConfig: AdkEnvironmentConfig): string => {
  switch (provider) {
    case 'litellm':
      return envConfig.litellmApiKey || 'anything';
    case 'openai':
      return envConfig.openaiApiKey || '';
    case 'anthropic':
      return envConfig.anthropicApiKey || '';
    case 'google':
      return envConfig.googleApiKey || '';
    default:
      return '';
  }
};

const getBaseUrlForProvider = (
  provider: string,
  envConfig: AdkEnvironmentConfig,
  providerConfig: AdkProviderConfig
): string => {
  switch (provider) {
    case 'litellm':
      return envConfig.litellmUrl || providerConfig.baseUrl;
    default:
      return providerConfig.baseUrl;
  }
};

// ========== Model Configuration Helpers ==========

export const getModelConfig = (modelName: string): AdkModelConfig | undefined => {
  for (const providerConfig of Object.values(DEFAULT_PROVIDER_CONFIGS)) {
    const model = providerConfig.models.find(m => m.name === modelName);
    if (model) {
      return model;
    }
  }
  return undefined;
};

export const getModelsForProvider = (provider: string): AdkModelConfig[] => {
  const providerConfig = DEFAULT_PROVIDER_CONFIGS[provider];
  return providerConfig?.models || [];
};

export const getAllAvailableModels = (): AdkModelConfig[] => {
  const allModels: AdkModelConfig[] = [];
  for (const providerConfig of Object.values(DEFAULT_PROVIDER_CONFIGS)) {
    allModels.push(...providerConfig.models);
  }
  return allModels;
};

export const getProviderForModel = (modelName: string): string | undefined => {
  // First check specific providers (excluding litellm which is a proxy)
  const specificProviders = Object.entries(DEFAULT_PROVIDER_CONFIGS).filter(([name]) => name !== 'litellm');
  
  for (const [providerName, providerConfig] of specificProviders) {
    if (providerConfig.models.some(m => m.name === modelName)) {
      return providerName;
    }
  }
  
  // Fall back to litellm if no specific provider found
  const litellmConfig = DEFAULT_PROVIDER_CONFIGS.litellm;
  if (litellmConfig && litellmConfig.models.some(m => m.name === modelName)) {
    return 'litellm';
  }
  
  return undefined;
};

// ========== Model Name Mapping ==========

export const mapAdkModelToProviderModel = (adkModel: Model | string): string => {
  // Handle the CUSTOM enum specifically
  if (adkModel === Model.CUSTOM || adkModel === 'custom') {
    return 'gpt-4o';
  }
  
  if (typeof adkModel === 'string') {
    return adkModel;
  }
  
  switch (adkModel) {
    case Model.GEMINI_2_0_FLASH:
      return 'gemini-2.0-flash';
    case Model.GEMINI_1_5_PRO:
      return 'gemini-1.5-pro';
    case Model.GEMINI_1_5_FLASH:
      return 'gemini-1.5-flash';
    case Model.GPT_4_TURBO:
      return 'gpt-4-turbo';
    case Model.GPT_4:
      return 'gpt-4o';
    case Model.GPT_3_5_TURBO:
      return 'gpt-3.5-turbo';
    case Model.CLAUDE_3_OPUS_20240229:
      return 'claude-3-opus-20240229';
    case Model.CLAUDE_3_5_SONNET_LATEST:
      return 'claude-3-5-sonnet-latest';
    case Model.CLAUDE_3_HAIKU_20240307:
      return 'claude-3-haiku-20240307';
    default:
      return 'gpt-4o';
  }
};

// ========== Configuration Validation ==========

export const validateAdkLLMConfig = (config: AdkLLMConfig): string[] => {
  const errors: string[] = [];
  
  if (!config.provider) {
    errors.push('Provider is required');
  }
  
  if (!DEFAULT_PROVIDER_CONFIGS[config.provider]) {
    errors.push(`Unknown provider: ${config.provider}`);
  }
  
  if (!config.apiKey && config.provider !== 'litellm') {
    errors.push(`API key is required for provider: ${config.provider}`);
  }
  
  if (!config.baseUrl) {
    errors.push('Base URL is required');
  }
  
  if (config.timeout && config.timeout <= 0) {
    errors.push('Timeout must be positive');
  }
  
  if (config.retries && config.retries < 0) {
    errors.push('Retries must be non-negative');
  }
  
  if (config.temperature && (config.temperature < 0 || config.temperature > 2)) {
    errors.push('Temperature must be between 0 and 2');
  }
  
  if (config.maxTokens && config.maxTokens <= 0) {
    errors.push('Max tokens must be positive');
  }
  
  return errors;
};

// ========== Default Configuration Factory ==========

export const createDefaultAdkLLMConfig = (): AdkLLMConfig => {
  const envConfig = loadEnvironmentConfig();
  const defaultProvider = envConfig.defaultProvider || 'litellm';
  
  return createAdkLLMConfig(defaultProvider);
};

export const createAdkLLMConfigFromEnvironment = (): AdkLLMConfig => {
  const envConfig = loadEnvironmentConfig();
  
  console.log('🔍 [CONFIG-DEBUG] Environment Config:', {
    openaiApiKey: envConfig.openaiApiKey ? `${envConfig.openaiApiKey.substring(0, 10)}...` : 'NOT SET',
    anthropicApiKey: envConfig.anthropicApiKey ? `${envConfig.anthropicApiKey.substring(0, 10)}...` : 'NOT SET',
    googleApiKey: envConfig.googleApiKey ? `${envConfig.googleApiKey.substring(0, 10)}...` : 'NOT SET',
    defaultProvider: envConfig.defaultProvider || 'NOT SET'
  });
  
  // Determine provider based on available API keys
  let provider = 'litellm';
  console.log('🔍 [CONFIG-DEBUG] Starting with default provider:', provider);
  
  if (envConfig.openaiApiKey) {
    console.log('🔍 [CONFIG-DEBUG] OpenAI API key found, switching to openai provider');
    provider = 'openai';
  } else if (envConfig.anthropicApiKey) {
    console.log('🔍 [CONFIG-DEBUG] Anthropic API key found, switching to anthropic provider');
    provider = 'anthropic';
  } else if (envConfig.googleApiKey) {
    console.log('🔍 [CONFIG-DEBUG] Google API key found, switching to google provider');
    provider = 'google';
  } else if (envConfig.azureApiKey && envConfig.azureEndpoint) {
    console.log('🔍 [CONFIG-DEBUG] Azure credentials found, switching to azure provider');
    provider = 'azure';
  }
  
  // Override with explicit setting
  if (envConfig.defaultProvider) {
    console.log('🔍 [CONFIG-DEBUG] Explicit provider override:', envConfig.defaultProvider);
    provider = envConfig.defaultProvider;
  }
  
  console.log('🔍 [CONFIG-DEBUG] Final provider selected:', provider);
  
  return createAdkLLMConfig(provider, {
    defaultModel: envConfig.defaultModel
  });
};

// ========== Configuration Debugging ==========

export const debugAdkLLMConfig = (config: AdkLLMConfig): void => {
  console.log('[ADK:CONFIG] LLM Configuration:');
  console.log(`  Provider: ${config.provider}`);
  console.log(`  Base URL: ${config.baseUrl}`);
  console.log(`  API Key: ${config.apiKey ? '[REDACTED]' : '[NOT SET]'}`);
  console.log(`  Default Model: ${config.defaultModel}`);
  console.log(`  Temperature: ${config.temperature}`);
  console.log(`  Max Tokens: ${config.maxTokens}`);
  console.log(`  Streaming: ${config.streaming}`);
  console.log(`  Timeout: ${config.timeout}ms`);
  console.log(`  Retries: ${config.retries}`);
  
  const validation = validateAdkLLMConfig(config);
  if (validation.length > 0) {
    console.warn('[ADK:CONFIG] Configuration issues:');
    validation.forEach(error => console.warn(`  - ${error}`));
  } else {
    console.log('[ADK:CONFIG] Configuration is valid');
  }
};