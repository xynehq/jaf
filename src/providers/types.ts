/**
 * Type definitions for model providers
 */

export interface ProxyConfig {
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

export interface ProxyAgentResult {
  httpAgent?: any; // TunnelAgent type is not properly exported
}

export interface ClientConfig {
  baseURL: string;
  apiKey: string;
  dangerouslyAllowBrowser: boolean;
  httpAgent?: any; // TunnelAgent type is not properly exported
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
  items?: JsonSchema;
  enum?: string[];
  [key: string]: unknown;
}

export interface VisionModelInfo {
  model_group: string;
  supports_vision?: boolean;
}

export interface VisionApiResponse {
  data?: VisionModelInfo[];
}

export interface VisionModelCacheEntry {
  supports: boolean;
  timestamp: number;
}