/**
 * FAF ADK Layer - Agent System
 * 
 * Functional agent creation and management utilities
 */

import { 
  Agent, 
  AgentConfig, 
  AgentMetadata, 
  MultiAgentConfig, 
  DelegationStrategy,
  CoordinationRule,
  Tool,
  SchemaValidator,
  GuardrailFunction,
  Example,
  ValidationResult,
  AgentError,
  throwAgentError,
  createAgentError
} from '../types';

// ========== ID Generation ==========

export const generateAgentId = (): string => {
  // Use crypto-based ID generation for pure functional approach
  return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// ========== Agent Creation ==========

export const createAgent = (config: AgentConfig): Agent => {
  validateAgentConfig(config);
  
  const metadata: AgentMetadata = {
    created: new Date(),
    version: '1.0.0',
    tags: []
  };
  
  return {
    id: generateAgentId(),
    config: { ...config },
    metadata
  };
};

export const createSimpleAgent = (
  name: string,
  model: string,
  instruction: string,
  tools: Tool[] = []
): Agent => {
  return createAgent({
    name,
    model,
    instruction,
    tools
  });
};

export const createMultiAgent = (
  name: string,
  model: string,
  instruction: string,
  subAgents: AgentConfig[],
  delegationStrategy: DelegationStrategy = 'conditional'
): Agent => {
  const config: MultiAgentConfig = {
    name,
    model,
    instruction,
    tools: [],
    subAgents,
    delegationStrategy
  };
  
  return createAgent(config);
};

// ========== Agent Validation ==========

export const validateAgentConfig = (config: AgentConfig): ValidationResult<AgentConfig> => {
  const errors: string[] = [];
  
  if (!config.name || config.name.trim().length === 0) {
    errors.push('Agent name is required');
  }
  
  if (!config.model || config.model.trim().length === 0) {
    errors.push('Agent model is required');
  }
  
  if (!config.instruction || config.instruction.trim().length === 0) {
    errors.push('Agent instruction is required');
  }
  
  if (!Array.isArray(config.tools)) {
    errors.push('Agent tools must be an array');
  }
  
  // Validate tools
  for (const tool of config.tools) {
    const toolValidation = validateTool(tool);
    if (!toolValidation.success) {
      errors.push(`Tool '${tool.name}': ${toolValidation.errors?.join(', ')}`);
    }
  }
  
  // Validate sub-agents if present
  if (config.subAgents) {
    for (const subAgent of config.subAgents) {
      const subAgentValidation = validateAgentConfig(subAgent);
      if (!subAgentValidation.success) {
        errors.push(`Sub-agent '${subAgent.name}': ${subAgentValidation.errors?.join(', ')}`);
      }
    }
  }
  
  if (errors.length > 0) {
    return { success: false, errors };
  }
  
  return { success: true, data: config };
};

const validateTool = (tool: Tool): ValidationResult<Tool> => {
  const errors: string[] = [];
  
  if (!tool.name || tool.name.trim().length === 0) {
    errors.push('Tool name is required');
  }
  
  if (!tool.description || tool.description.trim().length === 0) {
    errors.push('Tool description is required');
  }
  
  if (!Array.isArray(tool.parameters)) {
    errors.push('Tool parameters must be an array');
  }
  
  if (typeof tool.execute !== 'function') {
    errors.push('Tool execute must be a function');
  }
  
  if (errors.length > 0) {
    return { success: false, errors };
  }
  
  return { success: true, data: tool };
};

export const validateAgent = (agent: Agent): ValidationResult<Agent> => {
  if (!agent.id) {
    return { success: false, errors: ['Agent ID is required'] };
  }
  
  if (!agent.config) {
    return { success: false, errors: ['Agent config is required'] };
  }
  
  if (!agent.metadata) {
    return { success: false, errors: ['Agent metadata is required'] };
  }
  
  const configValidation = validateAgentConfig(agent.config);
  if (!configValidation.success) {
    return { success: false, errors: configValidation.errors };
  }
  
  return { success: true, data: agent };
};

// ========== Agent Manipulation ==========

export const cloneAgent = (agent: Agent, overrides: Partial<AgentConfig> = {}): Agent => {
  const newConfig: AgentConfig = {
    ...agent.config,
    ...overrides,
    tools: [...(overrides.tools || agent.config.tools)],
    subAgents: overrides.subAgents ? 
      [...overrides.subAgents] : 
      agent.config.subAgents ? [...agent.config.subAgents] : undefined
  };
  
  const newAgent = createAgent(newConfig);
  
  // Preserve some metadata
  newAgent.metadata.tags = agent.metadata.tags ? [...agent.metadata.tags] : [];
  
  return newAgent;
};

export const updateAgent = (agent: Agent, updates: Partial<AgentConfig>): Agent => {
  const updatedConfig = { ...agent.config, ...updates };
  
  return {
    ...agent,
    config: updatedConfig,
    metadata: {
      ...agent.metadata,
      lastModified: new Date()
    }
  };
};

export const addToolToAgent = (agent: Agent, tool: Tool): Agent => {
  const newTools = [...agent.config.tools, tool];
  return updateAgent(agent, { tools: newTools });
};

export const removeToolFromAgent = (agent: Agent, toolName: string): Agent => {
  const newTools = agent.config.tools.filter(tool => tool.name !== toolName);
  return updateAgent(agent, { tools: newTools });
};

export const addSubAgent = (agent: Agent, subAgent: AgentConfig): Agent => {
  const subAgents = agent.config.subAgents || [];
  const newSubAgents = [...subAgents, subAgent];
  return updateAgent(agent, { subAgents: newSubAgents });
};

export const removeSubAgent = (agent: Agent, subAgentName: string): Agent => {
  if (!agent.config.subAgents) {
    return agent;
  }
  
  const newSubAgents = agent.config.subAgents.filter(sub => sub.name !== subAgentName);
  return updateAgent(agent, { subAgents: newSubAgents });
};

// ========== Agent Query Functions ==========

export const getAgentTool = (agent: Agent, toolName: string): Tool | null => {
  return agent.config.tools.find(tool => tool.name === toolName) || null;
};

export const hasAgentTool = (agent: Agent, toolName: string): boolean => {
  return getAgentTool(agent, toolName) !== null;
};

export const getAgentSubAgent = (agent: Agent, subAgentName: string): AgentConfig | null => {
  if (!agent.config.subAgents) {
    return null;
  }
  
  return agent.config.subAgents.find(sub => sub.name === subAgentName) || null;
};

export const hasSubAgent = (agent: Agent, subAgentName: string): boolean => {
  return getAgentSubAgent(agent, subAgentName) !== null;
};

export const isMultiAgent = (agent: Agent): boolean => {
  return agent.config.subAgents !== undefined && agent.config.subAgents.length > 0;
};

export const getAgentToolNames = (agent: Agent): string[] => {
  return agent.config.tools.map(tool => tool.name);
};

export const getSubAgentNames = (agent: Agent): string[] => {
  if (!agent.config.subAgents) {
    return [];
  }
  
  return agent.config.subAgents.map(sub => sub.name);
};

// ========== Agent Statistics ==========

export const getAgentStats = (agent: Agent) => {
  const toolCount = agent.config.tools.length;
  const subAgentCount = agent.config.subAgents?.length || 0;
  const hasGuardrails = (agent.config.guardrails?.length || 0) > 0;
  const hasInputSchema = agent.config.inputSchema !== undefined;
  const hasOutputSchema = agent.config.outputSchema !== undefined;
  const hasExamples = (agent.config.examples?.length || 0) > 0;
  
  return {
    id: agent.id,
    name: agent.config.name,
    model: agent.config.model,
    toolCount,
    subAgentCount,
    hasGuardrails,
    hasInputSchema,
    hasOutputSchema,
    hasExamples,
    isMultiAgent: isMultiAgent(agent),
    created: agent.metadata.created,
    lastModified: agent.metadata.lastModified
  };
};

// ========== Agent Templates ==========

export const createWeatherAgent = (): Agent => {
  return createSimpleAgent(
    'weather_agent',
    'gemini-2.0-flash',
    'You are a helpful weather assistant. Use the available tools to provide accurate weather information.',
    []
  );
};

export const createChatAgent = (): Agent => {
  return createSimpleAgent(
    'chat_agent',
    'gemini-2.0-flash',
    'You are a friendly and helpful conversational assistant. Engage naturally with users and be helpful.',
    []
  );
};

export const createCodeAgent = (): Agent => {
  return createSimpleAgent(
    'code_agent',
    'gemini-2.0-flash',
    'You are a programming assistant. Help users with code, debugging, and software development questions.',
    []
  );
};

// ========== Agent Utilities ==========

export const agentToJSON = (agent: Agent): string => {
  const replacer = (key: string, value: any) => {
    // Skip function values during serialization
    if (typeof value === 'function') {
      return undefined;
    }
    return value;
  };
  
  return JSON.stringify(agent, replacer, 2);
};

export const agentFromJSON = (json: string): Agent => {
  try {
    const parsed = JSON.parse(json);
    const validation = validateAgent(parsed);
    
    if (!validation.success) {
      throwAgentError(
        `Invalid agent JSON: ${validation.errors?.join(', ')}`,
        parsed.id
      );
    }
    
    return parsed;
  } catch (error) {
    if (error instanceof AgentError) {
      throw error;
    }
    
    throwAgentError('Failed to parse agent JSON', undefined, { error: error instanceof Error ? error.message : String(error) });
  }
};

export const compareAgents = (agent1: Agent, agent2: Agent): boolean => {
  return (
    agent1.config.name === agent2.config.name &&
    agent1.config.model === agent2.config.model &&
    agent1.config.instruction === agent2.config.instruction &&
    agent1.config.tools.length === agent2.config.tools.length &&
    agent1.config.tools.every((tool, index) => 
      tool.name === agent2.config.tools[index]?.name
    )
  );
};

// ========== Agent Error Handling ==========

// Note: createAgentError is now imported from types.ts as a factory function

export const withAgentErrorHandling = <T extends unknown[], R>(
  fn: (...args: T) => R,
  agentId?: string
) => {
  return (...args: T): R => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof AgentError) {
        throw error;
      }
      
      throwAgentError(
        `Agent operation failed: ${error instanceof Error ? error.message : String(error)}`,
        agentId,
        { originalError: error }
      );
    }
  };
};