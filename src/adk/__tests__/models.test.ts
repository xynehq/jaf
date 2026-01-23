/**
 * Tests for Model enum and utilities
 */

import { 
  Model, 
  ModelCategory, 
  isValidModel, 
  getModelProvider, 
  getModelCategory,
  CLAUDE_3_OPUS,
  CLAUDE_3_SONNET,
  CLAUDE_3_HAIKU
} from '../models.js';

describe('Model Enum', () => {
  it('should have all major model categories', () => {
    // OpenAI Models
    expect(Model.GPT_4).toBe('gpt-4');
    expect(Model.GPT_4O).toBe('gpt-4o');
    expect(Model.GPT_3_5_TURBO).toBe('gpt-3.5-turbo');
    
    // Anthropic Models
    expect(Model.CLAUDE_3_OPUS_20240229).toBe('claude-3-opus-20240229');
    expect(Model.CLAUDE_3_5_SONNET_LATEST).toBe('claude-3-5-sonnet-latest');
    expect(Model.CLAUDE_3_HAIKU_20240307).toBe('claude-3-haiku-20240307');
    
    // Google Models
    expect(Model.GEMINI_2_0_FLASH).toBe('gemini-2.0-flash');
    expect(Model.GEMINI_1_5_PRO).toBe('gemini-1.5-pro');
    
    // Mistral Models
    expect(Model.MISTRAL_LARGE_LATEST).toBe('mistral/mistral-large-latest');
    
    // DeepSeek Models
    expect(Model.DEEPSEEK_CHAT).toBe('deepseek/deepseek-chat');
    
    // XAI Models
    expect(Model.GROK_3).toBe('xai/grok-3');
  });
  
  it('should have backward compatibility aliases', () => {
    expect(CLAUDE_3_OPUS).toBe('claude-3-opus-20240229');
    expect(CLAUDE_3_SONNET).toBe('claude-3-5-sonnet-latest');
    expect(CLAUDE_3_HAIKU).toBe('claude-3-haiku-20240307');
  });
  
  it('should validate model strings', () => {
    expect(isValidModel('gpt-4')).toBe(true);
    expect(isValidModel('claude-3-opus-20240229')).toBe(true);
    expect(isValidModel('gemini-2.0-flash')).toBe(true);
    expect(isValidModel('invalid-model')).toBe(false);
  });
  
  it('should identify model providers correctly', () => {
    expect(getModelProvider(Model.GPT_4)).toBe('openai');
    expect(getModelProvider(Model.GPT_4O)).toBe('openai');
    expect(getModelProvider(Model.CLAUDE_3_OPUS_20240229)).toBe('anthropic');
    expect(getModelProvider(Model.GEMINI_2_0_FLASH)).toBe('google');
    expect(getModelProvider(Model.MISTRAL_LARGE_LATEST)).toBe('mistral');
    expect(getModelProvider(Model.DEEPSEEK_CHAT)).toBe('deepseek');
    expect(getModelProvider(Model.GROK_3)).toBe('xai');
    expect(getModelProvider('unknown-model')).toBe('unknown');
  });
  
  it('should categorize models correctly', () => {
    // Chat models
    expect(getModelCategory(Model.GPT_4)).toBe(ModelCategory.CHAT);
    expect(getModelCategory(Model.CLAUDE_3_5_SONNET_LATEST)).toBe(ModelCategory.CHAT);
    
    // Embedding models
    expect(getModelCategory(Model.TEXT_EMBEDDING_3_LARGE)).toBe(ModelCategory.EMBEDDING);
    expect(getModelCategory(Model.TEXT_EMBEDDING_ADA_002)).toBe(ModelCategory.EMBEDDING);
    
    // Moderation models
    expect(getModelCategory(Model.TEXT_MODERATION_LATEST)).toBe(ModelCategory.MODERATION);
    
    // Audio models
    expect(getModelCategory(Model.WHISPER_1)).toBe(ModelCategory.AUDIO_TRANSCRIPTION);
    expect(getModelCategory(Model.TTS_1)).toBe(ModelCategory.AUDIO_SPEECH);
    
    // Image models
    expect(getModelCategory(Model.DALL_E_3)).toBe(ModelCategory.IMAGE_GENERATION);
    
    // Reasoning models
    expect(getModelCategory(Model.O1)).toBe(ModelCategory.REASONING);
    expect(getModelCategory(Model.O3)).toBe(ModelCategory.REASONING);
    expect(getModelCategory(Model.DEEPSEEK_R1)).toBe(ModelCategory.REASONING);
    expect(getModelCategory(Model.GEMINI_2_0_FLASH_THINKING_EXP)).toBe(ModelCategory.REASONING);
    
    // Coding models
    expect(getModelCategory(Model.CODESTRAL_LATEST)).toBe(ModelCategory.CODING);
    expect(getModelCategory(Model.CODE_BISON)).toBe(ModelCategory.CODING);
    
    // Vision models
    expect(getModelCategory(Model.GPT_4_VISION_PREVIEW)).toBe(ModelCategory.VISION);
    expect(getModelCategory(Model.GEMINI_PRO_VISION)).toBe(ModelCategory.VISION);
  });
  
  it('should include all O-series models', () => {
    // O1 series
    expect(Model.O1).toBeDefined();
    expect(Model.O1_MINI).toBeDefined();
    expect(Model.O1_PRO).toBeDefined();
    
    // O3 series
    expect(Model.O3).toBeDefined();
    expect(Model.O3_MINI).toBeDefined();
    expect(Model.O3_PRO).toBeDefined();
    expect(Model.O3_DEEP_RESEARCH).toBeDefined();
    
    // O4 series
    expect(Model.O4_MINI).toBeDefined();
    expect(Model.O4_MINI_DEEP_RESEARCH).toBeDefined();
  });
  
  it('should include all GPT-4.x models', () => {
    expect(Model.GPT_4_1).toBeDefined();
    expect(Model.GPT_4_1_MINI).toBeDefined();
    expect(Model.GPT_4_1_NANO).toBeDefined();
    expect(Model.GPT_4_5_PREVIEW).toBeDefined();
  });
  
  it('should include all Gemini 2.x models', () => {
    expect(Model.GEMINI_2_0_FLASH).toBeDefined();
    expect(Model.GEMINI_2_0_FLASH_THINKING_EXP).toBeDefined();
    expect(Model.GEMINI_2_5_PRO).toBeDefined();
    expect(Model.GEMINI_2_5_FLASH).toBeDefined();
  });
});