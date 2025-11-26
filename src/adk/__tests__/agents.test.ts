/**
 * JAF ADK Layer - Agent System Tests
 */

import {
  createAgent,
  createSimpleAgent,
  createMultiAgent,
  validateAgent,
  validateAgentConfig,
  cloneAgent,
  updateAgent,
  addToolToAgent,
  removeToolFromAgent,
  addSubAgent,
  removeSubAgent,
  getAgentTool,
  hasAgentTool,
  getAgentSubAgent,
  hasSubAgent,
  isMultiAgent,
  getAgentToolNames,
  getSubAgentNames,
  getAgentStats,
  createWeatherAgent,
  createChatAgent,
  createCodeAgent,
  agentToJSON,
  agentFromJSON,
  compareAgents,
  createAgentError,
  withAgentErrorHandling
} from '../agents/index.js';

import { createFunctionTool } from '../tools/index.js';
import { AgentConfig, Tool, Model } from '../types.js';

describe('Agent System', () => {
  const mockTool: Tool = createFunctionTool({
    name: 'test_tool',
    description: 'A test tool',
    execute: () => 'test result',
    parameters: []
  });

  const mockConfig: AgentConfig = {
    name: 'test_agent',
    model: Model.GEMINI_2_0_FLASH,
    instruction: 'You are a test agent',
    tools: [mockTool]
  };

  describe('Agent Creation', () => {
    test('createAgent should create valid agent', () => {
      const agent = createAgent(mockConfig);
      
      expect(agent.id).toBeDefined();
      expect(agent.config).toEqual(mockConfig);
      expect(agent.metadata.created).toBeInstanceOf(Date);
      expect(agent.metadata.version).toBe('1.0.0');
    });

    test('createAgent should generate unique IDs', () => {
      const agent1 = createAgent(mockConfig);
      const agent2 = createAgent(mockConfig);
      
      expect(agent1.id).not.toBe(agent2.id);
    });

    test('createSimpleAgent should create agent with basic config', () => {
      const agent = createSimpleAgent('simple', 'model', 'instruction', [mockTool]);
      
      expect(agent.config.name).toBe('simple');
      expect(agent.config.model).toBe('model');
      expect(agent.config.instruction).toBe('instruction');
      expect(agent.config.tools).toEqual([mockTool]);
    });

    test('createMultiAgent should create agent with sub-agents', () => {
      const subAgent1: AgentConfig = {
        name: 'sub1',
        model: 'model',
        instruction: 'Sub agent 1',
        tools: []
      };
      
      const subAgent2: AgentConfig = {
        name: 'sub2',
        model: 'model',
        instruction: 'Sub agent 2',
        tools: []
      };
      
      const multiAgent = createMultiAgent(
        'coordinator',
        'model',
        'Coordinate sub-agents',
        [subAgent1, subAgent2],
        'sequential'
      );
      
      expect(multiAgent.config.name).toBe('coordinator');
      expect(multiAgent.config.subAgents).toHaveLength(2);
      expect(multiAgent.config.subAgents![0]).toEqual(subAgent1);
      expect(multiAgent.config.subAgents![1]).toEqual(subAgent2);
      expect((multiAgent.config as any).delegationStrategy).toBe('sequential');
    });
  });

  describe('Agent Validation', () => {
    test('validateAgentConfig should accept valid config', () => {
      const result = validateAgentConfig(mockConfig);
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockConfig);
    });

    test('validateAgentConfig should reject config with missing name', () => {
      const invalidConfig = { ...mockConfig, name: '' };
      const result = validateAgentConfig(invalidConfig);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Agent name is required');
    });

    test('validateAgentConfig should reject config with missing model', () => {
      const invalidConfig = { ...mockConfig, model: '' };
      const result = validateAgentConfig(invalidConfig);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Agent model is required');
    });

    test('validateAgentConfig should reject config with missing instruction', () => {
      const invalidConfig = { ...mockConfig, instruction: '' };
      const result = validateAgentConfig(invalidConfig);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Agent instruction is required');
    });

    test('validateAgentConfig should reject config with invalid tools', () => {
      const invalidConfig = { ...mockConfig, tools: 'not-array' as any };
      const result = validateAgentConfig(invalidConfig);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Agent tools must be an array');
    });

    test('validateAgent should validate complete agent', () => {
      const agent = createAgent(mockConfig);
      const result = validateAgent(agent);
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual(agent);
    });

    test('validateAgent should reject agent without ID', () => {
      const agent = createAgent(mockConfig);
      agent.id = '';
      const result = validateAgent(agent);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Agent ID is required');
    });
  });

  describe('Agent Manipulation', () => {
    test('cloneAgent should create copy with same config', () => {
      const original = createAgent(mockConfig);
      const cloned = cloneAgent(original);
      
      expect(cloned.id).not.toBe(original.id);
      expect(cloned.config).toEqual(original.config);
      expect(cloned.config.tools).not.toBe(original.config.tools); // Deep copy
    });

    test('cloneAgent should apply overrides', () => {
      const original = createAgent(mockConfig);
      const cloned = cloneAgent(original, { name: 'new_name' });
      
      expect(cloned.config.name).toBe('new_name');
      expect(cloned.config.model).toBe(original.config.model);
    });

    test('updateAgent should update config and metadata', () => {
      const agent = createAgent(mockConfig);
      const updated = updateAgent(agent, { name: 'updated_name' });
      
      expect(updated.config.name).toBe('updated_name');
      expect(updated.metadata.lastModified).toBeInstanceOf(Date);
      expect(updated.id).toBe(agent.id); // ID should remain same
    });

    test('addToolToAgent should add tool', () => {
      const agent = createAgent({ ...mockConfig, tools: [] });
      const newTool = createFunctionTool({
        name: 'new_tool',
        description: 'New tool',
        execute: () => 'result',
        parameters: []
      });
      const updated = addToolToAgent(agent, newTool);
      
      expect(updated.config.tools).toHaveLength(1);
      expect(updated.config.tools[0]).toEqual(newTool);
    });

    test('removeToolFromAgent should remove tool by name', () => {
      const agent = createAgent(mockConfig);
      const updated = removeToolFromAgent(agent, 'test_tool');
      
      expect(updated.config.tools).toHaveLength(0);
    });

    test('addSubAgent should add sub-agent', () => {
      const agent = createAgent(mockConfig);
      const subAgentConfig: AgentConfig = {
        name: 'sub',
        model: 'model',
        instruction: 'Sub agent',
        tools: []
      };
      
      const updated = addSubAgent(agent, subAgentConfig);
      
      expect(updated.config.subAgents).toHaveLength(1);
      expect(updated.config.subAgents![0]).toEqual(subAgentConfig);
    });

    test('removeSubAgent should remove sub-agent by name', () => {
      const subAgentConfig: AgentConfig = {
        name: 'sub',
        model: 'model',
        instruction: 'Sub agent',
        tools: []
      };
      
      const agent = createAgent({
        ...mockConfig,
        subAgents: [subAgentConfig]
      });
      
      const updated = removeSubAgent(agent, 'sub');
      
      expect(updated.config.subAgents).toHaveLength(0);
    });

    test('removeSubAgent should handle missing sub-agents', () => {
      const agent = createAgent(mockConfig);
      const updated = removeSubAgent(agent, 'nonexistent');
      
      expect(updated).toBe(agent); // Should return same agent
    });
  });

  describe('Agent Query Functions', () => {
    test('getAgentTool should find tool by name', () => {
      const agent = createAgent(mockConfig);
      const tool = getAgentTool(agent, 'test_tool');
      
      expect(tool).toEqual(mockTool);
    });

    test('getAgentTool should return null for nonexistent tool', () => {
      const agent = createAgent(mockConfig);
      const tool = getAgentTool(agent, 'nonexistent');
      
      expect(tool).toBeNull();
    });

    test('hasAgentTool should detect tool presence', () => {
      const agent = createAgent(mockConfig);
      
      expect(hasAgentTool(agent, 'test_tool')).toBe(true);
      expect(hasAgentTool(agent, 'nonexistent')).toBe(false);
    });

    test('getAgentSubAgent should find sub-agent by name', () => {
      const subAgentConfig: AgentConfig = {
        name: 'sub',
        model: 'model',
        instruction: 'Sub agent',
        tools: []
      };
      
      const agent = createAgent({
        ...mockConfig,
        subAgents: [subAgentConfig]
      });
      
      const subAgent = getAgentSubAgent(agent, 'sub');
      expect(subAgent).toEqual(subAgentConfig);
    });

    test('getAgentSubAgent should return null for nonexistent sub-agent', () => {
      const agent = createAgent(mockConfig);
      const subAgent = getAgentSubAgent(agent, 'nonexistent');
      
      expect(subAgent).toBeNull();
    });

    test('hasSubAgent should detect sub-agent presence', () => {
      const subAgentConfig: AgentConfig = {
        name: 'sub',
        model: 'model',
        instruction: 'Sub agent',
        tools: []
      };
      
      const agent = createAgent({
        ...mockConfig,
        subAgents: [subAgentConfig]
      });
      
      expect(hasSubAgent(agent, 'sub')).toBe(true);
      expect(hasSubAgent(agent, 'nonexistent')).toBe(false);
    });

    test('isMultiAgent should detect multi-agent configuration', () => {
      const singleAgent = createAgent(mockConfig);
      const multiAgent = createAgent({
        ...mockConfig,
        subAgents: [mockConfig]
      });
      
      expect(isMultiAgent(singleAgent)).toBe(false);
      expect(isMultiAgent(multiAgent)).toBe(true);
    });

    test('getAgentToolNames should return tool names', () => {
      const agent = createAgent(mockConfig);
      const toolNames = getAgentToolNames(agent);
      
      expect(toolNames).toEqual(['test_tool']);
    });

    test('getSubAgentNames should return sub-agent names', () => {
      const subAgentConfig: AgentConfig = {
        name: 'sub',
        model: 'model',
        instruction: 'Sub agent',
        tools: []
      };
      
      const agent = createAgent({
        ...mockConfig,
        subAgents: [subAgentConfig]
      });
      
      const subAgentNames = getSubAgentNames(agent);
      expect(subAgentNames).toEqual(['sub']);
    });

    test('getSubAgentNames should return empty array for single agent', () => {
      const agent = createAgent(mockConfig);
      const subAgentNames = getSubAgentNames(agent);
      
      expect(subAgentNames).toEqual([]);
    });
  });

  describe('Agent Statistics', () => {
    test('getAgentStats should calculate agent statistics', () => {
      const agent = createAgent({
        ...mockConfig,
        subAgents: [mockConfig],
        guardrails: [async () => ({ allowed: true })],
        examples: [{ input: { role: 'user', parts: [] }, output: [] }]
      });
      
      const stats = getAgentStats(agent);
      
      expect(stats.id).toBe(agent.id);
      expect(stats.name).toBe('test_agent');
      expect(stats.model).toBe('gemini-2.0-flash');
      expect(stats.toolCount).toBe(1);
      expect(stats.subAgentCount).toBe(1);
      expect(stats.hasGuardrails).toBe(true);
      expect(stats.hasExamples).toBe(true);
      expect(stats.isMultiAgent).toBe(true);
      expect(stats.created).toBeInstanceOf(Date);
    });
  });

  describe('Agent Templates', () => {
    test('createWeatherAgent should create weather agent', () => {
      const agent = createWeatherAgent();
      
      expect(agent.config.name).toBe('weather_agent');
      expect(agent.config.model).toBe('gemini-2.0-flash');
      expect(agent.config.instruction).toContain('weather');
    });

    test('createChatAgent should create chat agent', () => {
      const agent = createChatAgent();
      
      expect(agent.config.name).toBe('chat_agent');
      expect(agent.config.instruction).toContain('conversational');
    });

    test('createCodeAgent should create code agent', () => {
      const agent = createCodeAgent();
      
      expect(agent.config.name).toBe('code_agent');
      expect(agent.config.instruction).toContain('programming');
    });
  });

  describe('Agent Serialization', () => {
    test('agentToJSON should serialize agent', () => {
      const agent = createAgent(mockConfig);
      const json = agentToJSON(agent);
      
      expect(() => JSON.parse(json)).not.toThrow();
      
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe(agent.id);
      expect(parsed.config.name).toBe(agent.config.name);
      expect(parsed.config.model).toBe(agent.config.model);
      expect(parsed.config.instruction).toBe(agent.config.instruction);
      // Note: tools lose their execute functions during JSON serialization
      expect(parsed.config.tools[0].name).toBe(agent.config.tools[0].name);
      expect(parsed.config.tools[0].description).toBe(agent.config.tools[0].description);
      expect(parsed.config.tools[0].execute).toBeUndefined(); // Functions are not serialized
    });

    test('agentFromJSON should deserialize agent', () => {
      // Create a simple agent without tools to test deserialization
      const simpleConfig = {
        name: 'serialization_test',
        model: 'gemini-2.0-flash',
        instruction: 'Test agent for serialization',
        tools: []
      };
      
      const agent = createAgent(simpleConfig);
      const json = agentToJSON(agent);
      const deserialized = agentFromJSON(json);
      
      expect(deserialized.id).toBe(agent.id);
      expect(deserialized.config.name).toBe(agent.config.name);
      expect(deserialized.config.model).toBe(agent.config.model);
      expect(deserialized.config.instruction).toBe(agent.config.instruction);
      expect(deserialized.config.tools).toEqual([]);
    });

    test('agentFromJSON should throw for invalid JSON', () => {
      expect(() => agentFromJSON('invalid json')).toThrow();
    });

    test('agentFromJSON should throw for invalid agent structure', () => {
      const invalidAgent = JSON.stringify({ id: 'test' }); // Missing required fields
      expect(() => agentFromJSON(invalidAgent)).toThrow();
    });
  });

  describe('Agent Comparison', () => {
    test('compareAgents should return true for equivalent agents', () => {
      const agent1 = createAgent(mockConfig);
      const agent2 = createAgent(mockConfig);
      
      expect(compareAgents(agent1, agent2)).toBe(true);
    });

    test('compareAgents should return false for different agents', () => {
      const agent1 = createAgent(mockConfig);
      const agent2 = createAgent({ ...mockConfig, name: 'different' });
      
      expect(compareAgents(agent1, agent2)).toBe(false);
    });

    test('compareAgents should consider tool differences', () => {
      const config1 = { ...mockConfig, tools: [mockTool] };
      const config2 = { ...mockConfig, tools: [] };
      
      const agent1 = createAgent(config1);
      const agent2 = createAgent(config2);
      
      expect(compareAgents(agent1, agent2)).toBe(false);
    });
  });

  describe('Error Handling', () => {
    test('createAgentError should create AgentError', () => {
      const error = createAgentError('Test error', 'agent_123', { context: 'test' });
      
      expect(error.message).toBe('Test error');
      expect(error.agentId).toBe('agent_123');
      expect(error.context).toEqual({ context: 'test' });
      expect(error.code).toBe('AGENT_ERROR');
    });

    test('withAgentErrorHandling should catch and wrap errors', () => {
      const throwingFunction = () => {
        throw new Error('Original error');
      };
      
      const wrappedFunction = withAgentErrorHandling(throwingFunction, 'agent_123');
      
      expect(() => wrappedFunction()).toThrow('Agent operation failed: Original error');
    });

    test('withAgentErrorHandling should pass through AgentErrors', () => {
      const agentError = createAgentError('Agent error', 'agent_123');
      const throwingFunction = () => {
        throw agentError;
      };
      
      const wrappedFunction = withAgentErrorHandling(throwingFunction, 'agent_123');
      
      expect(() => wrappedFunction()).toThrow(agentError);
    });
  });
});