/**
 * Utility functions for model providers
 */

import tunnel from 'tunnel';
import { ProxyAgentResult, ProxyConfig, VisionModelCacheEntry, JsonSchema } from './types.js';
import { VISION_MODEL_CACHE_TTL, VISION_API_TIMEOUT, KNOWN_VISION_MODELS } from './constants.js';

export function createProxyAgent(hostname?: string, proxyConfig?: ProxyConfig): ProxyAgentResult | undefined {
  const httpProxy = proxyConfig?.httpProxy || process.env.HTTP_PROXY;
  const noProxy = proxyConfig?.noProxy || process.env.NO_PROXY;

  if ((hostname && noProxy?.includes(hostname)) || !httpProxy) {
    return undefined;
  }

  try {
    console.log(`[JAF:PROXY] Configuring proxy agents:`);
    if (httpProxy) console.log(`HTTP_PROXY: ${httpProxy}`);
    if (noProxy) console.log(`NO_PROXY: ${noProxy}`);

    return {
      httpAgent: httpProxy ? createTunnelAgent(httpProxy) : undefined,
    };
  } catch (error) {
    console.warn(`[JAF:PROXY] Failed to create proxy agents. Install 'https-proxy-agent' and 'http-proxy-agent' packages for proxy support:`, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

export const createTunnelAgent = (proxyUrl: string) => {
  const url = new URL(proxyUrl);

  // Create tunnel agent for HTTPS through HTTP proxy
  return tunnel.httpsOverHttp({
    proxy: {
      host: url.hostname,
      port: parseInt(url.port)
    },
    rejectUnauthorized: false
  });
};

const visionModelCache = new Map<string, VisionModelCacheEntry>();

export async function isVisionModel(model: string, baseURL: string): Promise<boolean> {
  const cacheKey = `${baseURL}:${model}`;
  const cached = visionModelCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < VISION_MODEL_CACHE_TTL) {
    return cached.supports;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VISION_API_TIMEOUT);

    const response = await fetch(`${baseURL}/model_group/info`, {
      headers: {
        'accept': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json() as { data?: Array<{ model_group: string; supports_vision?: boolean }> };
      const modelInfo = data.data?.find((m) =>
        m.model_group === model || model.includes(m.model_group)
      );

      if (modelInfo?.supports_vision !== undefined) {
        const result = modelInfo.supports_vision;
        visionModelCache.set(cacheKey, { supports: result, timestamp: Date.now() });
        return result;
      }
    } else {
      console.warn(`Vision API returned status ${response.status} for model ${model}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        console.warn(`Vision API timeout for model ${model}`);
      } else {
        console.warn(`Vision API error for model ${model}: ${error.message}`);
      }
    } else {
      console.warn(`Unknown error checking vision support for model ${model}`);
    }
  }

  const isKnownVisionModel = KNOWN_VISION_MODELS.some(visionModel =>
    model.toLowerCase().includes(visionModel.toLowerCase())
  );

  visionModelCache.set(cacheKey, { supports: isKnownVisionModel, timestamp: Date.now() });

  return isKnownVisionModel;
}

export function zodSchemaToJsonSchema(zodSchema: any): JsonSchema {
  if (zodSchema._def?.typeName === 'ZodObject') {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(zodSchema._def.shape())) {
      properties[key] = zodSchemaToJsonSchema(value);
      if (typeof value === 'object' && value && 'isOptional' in value && typeof (value as any).isOptional === 'function' && !(value as any).isOptional()) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false
    };
  }

  if (zodSchema._def?.typeName === 'ZodString') {
    const schema: JsonSchema = { type: 'string' };
    if (zodSchema._def.description) {
      schema.description = zodSchema._def.description;
    }
    return schema;
  }

  if (zodSchema._def?.typeName === 'ZodNumber') {
    return { type: 'number' };
  }

  if (zodSchema._def?.typeName === 'ZodBoolean') {
    return { type: 'boolean' };
  }

  if (zodSchema._def?.typeName === 'ZodArray') {
    return {
      type: 'array',
      items: zodSchemaToJsonSchema(zodSchema._def.type as any)
    };
  }

  if (zodSchema._def?.typeName === 'ZodOptional') {
    return zodSchemaToJsonSchema(zodSchema._def.innerType as any);
  }

  if (zodSchema._def?.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: zodSchema._def.values
    };
  }

  return { type: 'string', description: 'Unsupported schema type' };
}