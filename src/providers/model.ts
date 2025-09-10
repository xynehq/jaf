import OpenAI from "openai";
import { ModelProvider, Message, MessageContentPart, getTextContent } from '../core/types.js';
import { extractDocumentContent, isDocumentSupported, getDocumentDescription } from '../utils/document-processor.js';

interface ProxyConfig {
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

function createProxyAgent(url?: any,proxyConfig?: ProxyConfig) {
  const httpProxy = proxyConfig?.httpProxy || process.env.HTTP_PROXY;
  const httpsProxy = proxyConfig?.httpsProxy || process.env.HTTPS_PROXY;
  const noProxy = proxyConfig?.noProxy || process.env.NO_PROXY;
  
  if (noProxy?.includes(url)  || (!httpProxy && !httpsProxy)) {
    return undefined;
  }

  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const { HttpProxyAgent } = require('http-proxy-agent');
    
    console.log(`[JAF:PROXY] Configuring proxy agents:`);
    if (httpProxy) console.log(`HTTP_PROXY: ${httpProxy}`);
    if (httpsProxy) console.log(`HTTPS_PROXY: ${httpsProxy}`);
    if (noProxy) console.log(`NO_PROXY: ${noProxy}`);

    return {
      httpAgent: httpProxy ? new HttpProxyAgent(httpProxy) : undefined,
      httpsAgent: httpsProxy ? new HttpsProxyAgent(httpsProxy) : undefined
    };
  } catch (error) {
    console.warn(`[JAF:PROXY] Failed to create proxy agents. Install 'https-proxy-agent' and 'http-proxy-agent' packages for proxy support:`, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

export const makeLiteLLMProvider = <Ctx>(
  baseURL: string,
  apiKey = "anything",
  proxyConfig?: ProxyConfig
): ModelProvider<Ctx> => {
  const clientConfig: any = { 
    baseURL, 
    apiKey, 
    dangerouslyAllowBrowser: true
  };

  const hostname = new URL(baseURL).hostname;
  const proxyAgents = createProxyAgent(hostname,proxyConfig);
  if (proxyAgents) {
    if (proxyAgents.httpAgent) {
      clientConfig.httpAgent = proxyAgents.httpAgent;
    }
    if (proxyAgents.httpsAgent) {
      clientConfig.httpsAgent = proxyAgents.httpsAgent;
    }
    console.log(`[JAF:PROXY] LiteLLM provider configured with proxy support`);
  } else {
    console.log(`[JAF:PROXY] LiteLLM provider configured without proxy (direct connection)`);
  }

  const client = new OpenAI(clientConfig);

  return {
    async getCompletion(state, agent, config) {
      const model = config.modelOverride ?? agent.modelConfig?.name;

      if (!model) {
        throw new Error(`Model not specified for agent ${agent.name}`);
      }

      // Check if any message contains image content or image attachments
      const hasImageContent = state.messages.some(msg => 
        (Array.isArray(msg.content) && 
         msg.content.some(part => part.type === 'image_url')) ||
        (msg.attachments && 
         msg.attachments.some(att => att.kind === 'image'))
      );

      if (hasImageContent) {
        const supportsVision = await isVisionModel(model, baseURL);
        if (!supportsVision) {
          throw new Error(`Model ${model} does not support vision capabilities. Please use a vision-capable model like gpt-4o, claude-3-5-sonnet, or gemini-1.5-pro.`);
        }
      }

      const systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: "system",
        content: agent.instructions(state)
      };

      const convertedMessages = await Promise.all(state.messages.map(convertMessage));
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        systemMessage,
        ...convertedMessages
      ];

      const tools = agent.tools?.map(t => ({
        type: "function" as const,
        function: {
          name: t.schema.name,
          description: t.schema.description,
          parameters: zodSchemaToJsonSchema(t.schema.parameters),
        },
      }));

      const lastMessage = state.messages[state.messages.length - 1];
      const isAfterToolCall = lastMessage?.role === 'tool';

      const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
        model,
        messages,
        temperature: agent.modelConfig?.temperature,
        max_tokens: agent.modelConfig?.maxTokens,
        tools: tools && tools.length > 0 ? tools : undefined,
        tool_choice: (tools && tools.length > 0) ? (isAfterToolCall ? "auto" : undefined) : undefined,
        response_format: agent.outputCodec ? { type: "json_object" } : undefined,
      };

      console.log(`📞 Calling model: ${model} with params: ${JSON.stringify(requestParams, null, 2)}`);
      const resp = await client.chat.completions.create(requestParams);

      // Return the choice with usage data attached for tracing
      return {
        ...resp.choices[0],
        usage: resp.usage,
        model: resp.model,
        id: resp.id,
        created: resp.created
      };
    },
  };
};

const VISION_MODEL_CACHE_TTL = 5 * 60 * 1000;
const VISION_API_TIMEOUT = 3000;
const visionModelCache = new Map<string, { supports: boolean; timestamp: number }>();

async function isVisionModel(model: string, baseURL: string): Promise<boolean> {
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
      const data: any = await response.json();
      const modelInfo = data.data?.find((m: any) => 
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

  const knownVisionModels = [
    'gpt-4-vision-preview',
    'gpt-4o',
    'gpt-4o-mini', 
    'claude-sonnet-4',
    'claude-sonnet-4-20250514', 
    'gemini-2.5-flash',
    'gemini-2.5-pro'
  ];
  
  const isKnownVisionModel = knownVisionModels.some(visionModel => 
    model.toLowerCase().includes(visionModel.toLowerCase())
  );
  
  visionModelCache.set(cacheKey, { supports: isKnownVisionModel, timestamp: Date.now() });
  
  return isKnownVisionModel;
}

async function convertMessage(msg: Message): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
  switch (msg.role) {
    case 'user':
      if (Array.isArray(msg.content)) {
        return {
          role: 'user',
          content: msg.content.map(convertContentPart)
        };
      } else {
        return await buildChatMessageWithAttachments('user', msg);
      }
    case 'assistant':
      return {
        role: 'assistant',
        content: getTextContent(msg.content),
        tool_calls: msg.tool_calls as any
      };
    case 'tool':
      return {
        role: 'tool',
        content: getTextContent(msg.content),
        tool_call_id: msg.tool_call_id!
      };
    default:
      throw new Error(`Unknown message role: ${(msg as any).role}`);
  }
}

function convertContentPart(part: MessageContentPart): OpenAI.Chat.Completions.ChatCompletionContentPart {
  switch (part.type) {
    case 'text':
      return {
        type: 'text',
        text: part.text
      };
    case 'image_url':
      return {
        type: 'image_url',
        image_url: {
          url: part.image_url.url,
          detail: part.image_url.detail
        }
      };
    case 'file':
      return {
        type: 'file',
        file: {
          file_id: part.file.file_id,
          format: part.file.format
        }
      } as any;
    default:
      throw new Error(`Unknown content part type: ${(part as any).type}`);
  }
}

/**
 * If attachments exist, build multi-part content for Chat Completions.
 * Supports images via `image_url` and documents via content extraction.
 */
async function buildChatMessageWithAttachments(
  role: 'user' | 'assistant',
  msg: Message
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
  const hasAttachments = Array.isArray(msg.attachments) && msg.attachments.length > 0;
  if (!hasAttachments) {
    if (role === 'assistant') {
      return { role: 'assistant', content: getTextContent(msg.content), tool_calls: msg.tool_calls as any };
    }
    return { role: 'user', content: getTextContent(msg.content) };
  }

  const parts: any[] = [];
  const textContent = getTextContent(msg.content);
  if (textContent && textContent.trim().length > 0) {
    parts.push({ type: 'text', text: textContent });
  }

  for (const att of msg.attachments || []) {
    if (att.kind === 'image') {
      // Prefer explicit URL; otherwise construct a data URL from base64
      const url = att.url
        ? att.url
        : (att.data && att.mimeType)
          ? `data:${att.mimeType};base64,${att.data}`
          : undefined;
      if (url) {
        parts.push({ type: 'image_url', image_url: { url } });
      }
    } else if (att.kind === 'document' || att.kind === 'file') {
      // Check if attachment has useLiteLLMFormat flag or is a large document
      const useLiteLLMFormat = att.useLiteLLMFormat === true;
      
      if (useLiteLLMFormat && (att.url || att.data)) {
        // Use LiteLLM native file format for better handling of large documents
        const file_id = att.url || (att.data && att.mimeType ? `data:${att.mimeType};base64,${att.data}` : '');
        if (file_id) {
          parts.push({
            type: 'file',
            file: {
              file_id,
              format: att.mimeType || att.format
            }
          });
        }
      } else {
        // Extract document content if supported and we have data or URL
        if (isDocumentSupported(att.mimeType) && (att.data || att.url)) {
          try {
            const processed = await extractDocumentContent(att);
            const fileName = att.name || 'document';
            const description = getDocumentDescription(att.mimeType);
            
            parts.push({
              type: 'text',
              text: `DOCUMENT: ${fileName} (${description}):\n\n${processed.content}`
            });
          } catch (error) {
            // Fallback to filename if extraction fails
            const label = att.name || att.format || att.mimeType || 'attachment';
            parts.push({
              type: 'text',
              text: `ERROR: Failed to process ${att.kind}: ${label} (${error instanceof Error ? error.message : 'Unknown error'})`
            });
          }
        } else {
          // Unsupported document type - show placeholder
          const label = att.name || att.format || att.mimeType || 'attachment';
          parts.push({
            type: 'text',
            text: `ATTACHMENT: ${att.kind}: ${label}${att.url ? ` (${att.url})` : ''}`
          });
        }
      }
    }
  }

  const base: any = { role, content: parts };
  if (role === 'assistant' && msg.tool_calls) {
    base.tool_calls = msg.tool_calls as any;
  }
  return base as OpenAI.Chat.Completions.ChatCompletionMessageParam;
}

function zodSchemaToJsonSchema(zodSchema: any): any {
  if (zodSchema._def?.typeName === 'ZodObject') {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    
    for (const [key, value] of Object.entries(zodSchema._def.shape())) {
      properties[key] = zodSchemaToJsonSchema(value);
      if (!(value as any).isOptional()) {
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
    const schema: any = { type: 'string' };
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
      items: zodSchemaToJsonSchema(zodSchema._def.type)
    };
  }
  
  if (zodSchema._def?.typeName === 'ZodOptional') {
    return zodSchemaToJsonSchema(zodSchema._def.innerType);
  }
  
  if (zodSchema._def?.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: zodSchema._def.values
    };
  }
  
  return { type: 'string', description: 'Unsupported schema type' };
}
