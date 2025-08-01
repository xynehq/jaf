/**
 * Pure functional Agent Card generation
 * Transforms FAF agents into A2A Agent Cards
 */

import type { AgentCard, AgentSkill, A2AAgent, A2AServerConfig } from './types.js';

// Pure function to generate Agent Card from A2A agents
export const generateAgentCard = (
  config: A2AServerConfig['agentCard'],
  agents: ReadonlyMap<string, A2AAgent>,
  baseUrl: string = 'http://localhost:3000'
): AgentCard => ({
  protocolVersion: '0.3.0',
  name: config.name,
  description: config.description,
  url: `${baseUrl}/a2a`,
  preferredTransport: 'JSONRPC',
  version: config.version,
  provider: config.provider,
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true
  },
  defaultInputModes: ['text/plain', 'application/json'],
  defaultOutputModes: ['text/plain', 'application/json'],
  skills: generateSkillsFromAgents(agents),
  securitySchemes: generateSecuritySchemes(),
  security: generateSecurityRequirements()
});

// Pure function to generate skills from A2A agents
export const generateSkillsFromAgents = (
  agents: ReadonlyMap<string, A2AAgent>
): readonly AgentSkill[] => {
  const skills: AgentSkill[] = [];
  
  agents.forEach((agent, agentName) => {
    // Create a main skill for the agent
    const mainSkill: AgentSkill = {
      id: `${agentName}-main`,
      name: agent.name,
      description: agent.description,
      tags: ['general', ...agent.tools.map(tool => tool.name)],
      examples: generateExamplesForAgent(agent),
      inputModes: agent.supportedContentTypes,
      outputModes: agent.supportedContentTypes
    };
    
    skills.push(mainSkill);
    
    // Create individual skills for each tool
    agent.tools.forEach(tool => {
      const toolSkill: AgentSkill = {
        id: `${agentName}-${tool.name}`,
        name: tool.name,
        description: tool.description,
        tags: [tool.name, 'tool', agentName],
        examples: generateExamplesForTool(tool),
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['text/plain', 'application/json']
      };
      
      skills.push(toolSkill);
    });
  });
  
  return skills;
};

// Pure function to generate examples for an agent
export const generateExamplesForAgent = (agent: A2AAgent): readonly string[] => {
  const baseExamples = [
    `Ask ${agent.name} for help`,
    `What can ${agent.name} do?`
  ];
  
  // Add tool-specific examples
  const toolExamples = agent.tools.slice(0, 2).map(tool => 
    `Use ${tool.name} to ${tool.description.toLowerCase()}`
  );
  
  return [...baseExamples, ...toolExamples];
};

// Pure function to generate examples for a tool
export const generateExamplesForTool = (tool: any): readonly string[] => [
  `Use ${tool.name}`,
  tool.description,
  `Help me with ${tool.name.replace(/_/g, ' ')}`
];

// Pure function to generate security schemes
export const generateSecuritySchemes = (): Readonly<Record<string, any>> => ({
  bearerAuth: {
    type: 'http',
    scheme: 'bearer',
    description: 'Bearer token authentication'
  },
  apiKey: {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    description: 'API key authentication'
  }
});

// Pure function to generate security requirements
export const generateSecurityRequirements = (): readonly Record<string, readonly string[]>[] => [
  // No authentication required by default
  {},
  // Optional bearer auth
  { bearerAuth: [] },
  // Optional API key
  { apiKey: [] }
];

// Pure function to generate Agent Card for a specific agent
export const generateAgentCardForAgent = (
  agentName: string,
  agent: A2AAgent,
  config: Partial<A2AServerConfig['agentCard']> = {},
  baseUrl: string = 'http://localhost:3000'
): AgentCard => {
  const agentMap = new Map([[agentName, agent]]);
  
  const cardConfig = {
    name: config.name || agent.name,
    description: config.description || agent.description,
    version: config.version || '1.0.0',
    provider: config.provider || {
      organization: 'FAF Agent',
      url: 'https://functional-agent-framework.com'
    }
  };
  
  return generateAgentCard(cardConfig, agentMap, baseUrl);
};

// Pure function to validate Agent Card
export const validateAgentCard = (card: AgentCard): {
  isValid: boolean;
  errors: readonly string[];
} => {
  const errors: string[] = [];
  
  // Required fields validation
  if (!card.name?.trim()) {
    errors.push('Agent card name is required');
  }
  
  if (!card.description?.trim()) {
    errors.push('Agent card description is required');
  }
  
  if (!card.url?.trim()) {
    errors.push('Agent card URL is required');
  }
  
  if (!card.version?.trim()) {
    errors.push('Agent card version is required');
  }
  
  if (!card.protocolVersion?.trim()) {
    errors.push('Protocol version is required');
  }
  
  // Skills validation
  if (!card.skills || card.skills.length === 0) {
    errors.push('At least one skill is required');
  } else {
    card.skills.forEach((skill, index) => {
      if (!skill.id?.trim()) {
        errors.push(`Skill ${index}: ID is required`);
      }
      if (!skill.name?.trim()) {
        errors.push(`Skill ${index}: Name is required`);
      }
      if (!skill.description?.trim()) {
        errors.push(`Skill ${index}: Description is required`);
      }
      if (!skill.tags || skill.tags.length === 0) {
        errors.push(`Skill ${index}: At least one tag is required`);
      }
    });
  }
  
  // Input/Output modes validation
  if (!card.defaultInputModes || card.defaultInputModes.length === 0) {
    errors.push('At least one default input mode is required');
  }
  
  if (!card.defaultOutputModes || card.defaultOutputModes.length === 0) {
    errors.push('At least one default output mode is required');
  }
  
  // URL validation
  if (card.url && !isValidUrl(card.url)) {
    errors.push('Invalid URL format');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Pure helper function to validate URL
const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Pure function to create minimal Agent Card
export const createMinimalAgentCard = (
  name: string,
  description: string,
  url: string = 'http://localhost:3000/a2a'
): AgentCard => ({
  protocolVersion: '0.3.0',
  name,
  description,
  url,
  preferredTransport: 'JSONRPC',
  version: '1.0.0',
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: false
  },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{
    id: 'general',
    name: 'General Assistant',
    description: 'General purpose assistance',
    tags: ['general', 'assistant'],
    examples: ['How can I help you?']
  }]
});

// Pure function to merge multiple Agent Cards
export const mergeAgentCards = (
  baseCard: AgentCard,
  ...additionalCards: AgentCard[]
): AgentCard => {
  const mergedSkills = [
    ...baseCard.skills,
    ...additionalCards.flatMap(card => card.skills)
  ];
  
  // Remove duplicate skills by ID
  const uniqueSkills = mergedSkills.filter((skill, index, arr) => 
    arr.findIndex(s => s.id === skill.id) === index
  );
  
  const mergedInputModes = Array.from(new Set([
    ...baseCard.defaultInputModes,
    ...additionalCards.flatMap(card => card.defaultInputModes)
  ]));
  
  const mergedOutputModes = Array.from(new Set([
    ...baseCard.defaultOutputModes,
    ...additionalCards.flatMap(card => card.defaultOutputModes)
  ]));
  
  return {
    ...baseCard,
    skills: uniqueSkills,
    defaultInputModes: mergedInputModes,
    defaultOutputModes: mergedOutputModes,
    capabilities: {
      streaming: baseCard.capabilities.streaming || additionalCards.some(card => card.capabilities.streaming),
      pushNotifications: baseCard.capabilities.pushNotifications || additionalCards.some(card => card.capabilities.pushNotifications),
      stateTransitionHistory: baseCard.capabilities.stateTransitionHistory || additionalCards.some(card => card.capabilities.stateTransitionHistory)
    }
  };
};

// Pure function to create Agent Card from configuration
export const createAgentCardFromConfig = (config: {
  readonly name: string;
  readonly description: string;
  readonly agents: ReadonlyMap<string, A2AAgent>;
  readonly baseUrl?: string;
  readonly version?: string;
  readonly provider?: AgentCard['provider'];
  readonly capabilities?: Partial<AgentCard['capabilities']>;
}): AgentCard => {
  const baseUrl = config.baseUrl || 'http://localhost:3000';
  
  return {
    protocolVersion: '0.3.0',
    name: config.name,
    description: config.description,
    url: `${baseUrl}/a2a`,
    preferredTransport: 'JSONRPC',
    version: config.version || '1.0.0',
    provider: config.provider || {
      organization: 'FAF Framework',
      url: 'https://functional-agent-framework.com'
    },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
      ...config.capabilities
    },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: generateSkillsFromAgents(config.agents)
  };
};