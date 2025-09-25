/**
 * Constants for model providers
 */

export const VISION_MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
export const VISION_API_TIMEOUT = 3000; // 3 seconds

export const KNOWN_VISION_MODELS = [
  'gpt-4-vision-preview',
  'gpt-4o',
  'gpt-4o-mini',
  'claude-sonnet-4',
  'claude-sonnet-4-20250514',
  'gemini-2.5-flash',
  'gemini-2.5-pro'
] as const;

export type KnownVisionModel = typeof KNOWN_VISION_MODELS[number];