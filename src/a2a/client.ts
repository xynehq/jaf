/**
 * Pure functional A2A client
 * All client operations are pure functions
 */

import type {
  A2AClientConfig,
  A2AClientState,
  JSONRPCRequest,
  JSONRPCResponse,
  SendMessageRequest,
  SendStreamingMessageRequest,
  AgentCard,
  A2AStreamEvent
} from './types.js';
import { safeConsole } from '../utils/logger.js';

// Pure function to create A2A client
export const createA2AClient = (baseUrl: string, config?: Partial<A2AClientConfig>): A2AClientState => ({
  config: {
    baseUrl: baseUrl.replace(/\/$/, ''), // Remove trailing slash
    timeout: config?.timeout || 30000
  },
  sessionId: `client_${Date.now()}_${Math.random().toString(36).substring(2)}`
});

// Pure function to create message request
export const createMessageRequest = (
  message: string,
  sessionId: string,
  configuration?: any
): SendMessageRequest => ({
  jsonrpc: '2.0',
  id: `req_${Date.now()}_${Math.random().toString(36).substring(2)}`,
  method: 'message/send',
  params: {
    message: {
      role: 'user',
      parts: [{ kind: 'text', text: message }],
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2)}`,
      contextId: sessionId,
      kind: 'message'
    },
    configuration
  }
});

// Pure function to create streaming message request
export const createStreamingMessageRequest = (
  message: string,
  sessionId: string,
  configuration?: any
): SendStreamingMessageRequest => ({
  jsonrpc: '2.0',
  id: `req_${Date.now()}_${Math.random().toString(36).substring(2)}`,
  method: 'message/stream',
  params: {
    message: {
      role: 'user',
      parts: [{ kind: 'text', text: message }],
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2)}`,
      contextId: sessionId,
      kind: 'message'
    },
    configuration
  }
});

// Pure function to send HTTP request
const sendHttpRequest = async (
  url: string,
  body: any,
  timeout: number = 30000
): Promise<any> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json() as { status: string; agents: string[]; timestamp: string };
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    
    throw error;
  }
};

// Pure function to send A2A request
export const sendA2ARequest = async (
  client: A2AClientState,
  request: JSONRPCRequest
): Promise<JSONRPCResponse> => {
  const url = `${client.config.baseUrl}/a2a`;
  return await sendHttpRequest(url, request, client.config.timeout);
};

// Pure function to send message
export const sendMessage = async (
  client: A2AClientState,
  message: string,
  configuration?: any
): Promise<string> => {
  const request = createMessageRequest(message, client.sessionId, configuration);
  const response = await sendA2ARequest(client, request);
  
  if (response.error) {
    throw new Error(`A2A Error ${response.error.code}: ${response.error.message}`);
  }
  
  return extractTextResponse(response.result);
};

// Pure function to stream message
export const streamMessage = async function* (
  client: A2AClientState,
  message: string,
  configuration?: any
): AsyncGenerator<A2AStreamEvent, void, unknown> {
  const request = createStreamingMessageRequest(message, client.sessionId, configuration);
  const url = `${client.config.baseUrl}/a2a`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), client.config.timeout);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    if (!response.body) {
      throw new Error('No response body for streaming');
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data.trim()) {
              try {
                const event = JSON.parse(data);
                if (event.result) {
                  yield event.result;
                }
              } catch (error) {
                safeConsole.warn('Failed to parse SSE data:', data);
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Stream timeout after ${client.config.timeout}ms`);
    }
    
    throw error;
  }
};

// Pure function to get agent card
export const getAgentCard = async (
  client: A2AClientState
): Promise<AgentCard> => {
  const url = `${client.config.baseUrl}/.well-known/agent-card`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get agent card: HTTP ${response.status}`);
  }
  
  return await response.json() as AgentCard;
};

// Pure function to discover agents
export const discoverAgents = async (
  baseUrl: string
): Promise<AgentCard> => {
  const client = createA2AClient(baseUrl);
  return await getAgentCard(client);
};

// Pure function to send message to specific agent
export const sendMessageToAgent = async (
  client: A2AClientState,
  agentName: string,
  message: string,
  configuration?: any
): Promise<string> => {
  const request = createMessageRequest(message, client.sessionId, configuration);
  const url = `${client.config.baseUrl}/a2a/agents/${agentName}`;
  
  const response = await sendHttpRequest(url, request, client.config.timeout);
  
  if (response.error) {
    throw new Error(`A2A Error ${response.error.code}: ${response.error.message}`);
  }
  
  return extractTextResponse(response.result);
};

// Pure function to stream message to specific agent
export const streamMessageToAgent = async function* (
  client: A2AClientState,
  agentName: string,
  message: string,
  configuration?: any
): AsyncGenerator<A2AStreamEvent, void, unknown> {
  const request = createStreamingMessageRequest(message, client.sessionId, configuration);
  const url = `${client.config.baseUrl}/a2a/agents/${agentName}`;
  
  // Use same streaming logic as general streamMessage
  yield* streamToUrl(url, request, client.config.timeout);
};

// Pure helper function for streaming to URL
const streamToUrl = async function* (
  url: string,
  request: JSONRPCRequest,
  timeout: number = 30000
): AsyncGenerator<A2AStreamEvent, void, unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    if (!response.body) {
      throw new Error('No response body for streaming');
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data.trim()) {
              try {
                const event = JSON.parse(data);
                if (event.result) {
                  yield event.result;
                }
              } catch (error) {
                safeConsole.warn('Failed to parse SSE data:', data);
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Stream timeout after ${timeout}ms`);
    }
    
    throw error;
  }
};

// Pure function to extract text response
export const extractTextResponse = (result: any): string => {
  // Handle direct string response
  if (typeof result === 'string') {
    return result;
  }
  
  // Handle task response
  if (result?.kind === 'task') {
    // Extract from artifacts
    if (result.artifacts?.length > 0) {
      const textArtifact = result.artifacts.find((artifact: any) => 
        artifact.parts?.some((part: any) => part.kind === 'text')
      );
      
      if (textArtifact) {
        const textPart = textArtifact.parts.find((part: any) => part.kind === 'text');
        return textPart?.text || 'No text content';
      }
    }
    
    // Extract from history
    if (result.history?.length > 0) {
      const lastMessage = result.history[result.history.length - 1];
      if (lastMessage?.parts) {
        const textParts = lastMessage.parts
          .filter((part: any) => part.kind === 'text')
          .map((part: any) => part.text);
        
        if (textParts.length > 0) {
          return textParts.join('\n');
        }
      }
    }
    
    return 'Task completed but no text response available';
  }
  
  // Handle message response
  if (result?.kind === 'message') {
    if (result.parts) {
      const textParts = result.parts
        .filter((part: any) => part.kind === 'text')
        .map((part: any) => part.text);
      
      if (textParts.length > 0) {
        return textParts.join('\n');
      }
    }
  }
  
  // Handle object responses
  if (typeof result === 'object' && result !== null) {
    return JSON.stringify(result, null, 2);
  }
  
  return 'No response content available';
};

// Pure function to check A2A server health
export const checkA2AHealth = async (
  client: A2AClientState
): Promise<{ status: string; agents: string[]; timestamp: string }> => {
  const url = `${client.config.baseUrl}/a2a/health`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Health check failed: HTTP ${response.status}`);
  }
  
  return await response.json() as { status: string; agents: string[]; timestamp: string };
};

// Pure function to get A2A capabilities
export const getA2ACapabilities = async (
  client: A2AClientState
): Promise<any> => {
  const url = `${client.config.baseUrl}/a2a/capabilities`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Capabilities request failed: HTTP ${response.status}`);
  }
  
  return await response.json() as any;
};

// Pure function to connect to A2A agent (convenience function)
export const connectToA2AAgent = async (baseUrl: string) => {
  const client = createA2AClient(baseUrl);
  const agentCard = await getAgentCard(client);
  
  return {
    client,
    agentCard,
    ask: (message: string, config?: any) => sendMessage(client, message, config),
    stream: (message: string, config?: any) => streamMessage(client, message, config),
    health: () => checkA2AHealth(client),
    capabilities: () => getA2ACapabilities(client)
  };
};