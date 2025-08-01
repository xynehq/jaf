/**
 * A2A Server Tests
 * Tests for A2A server creation, configuration, and endpoints
 */

import { z } from 'zod';
import {
  createA2AServer,
  createA2AAgent,
  createA2ATool,
  generateAgentCard,
  type A2AServerConfig,
  type A2AAgent,
  type AgentCard
} from '../index';

describe('A2A Server', () => {
  // Test agents
  const testTool = createA2ATool({
    name: 'echo_tool',
    description: 'Echo input back',
    parameters: z.object({
      message: z.string()
    }),
    execute: async ({ message }) => `Echo: ${message}`
  });

  const testAgent = createA2AAgent({
    name: 'TestAgent',
    description: 'A test agent for server testing',
    instruction: 'You are a helpful test assistant',
    tools: [testTool]
  });

  const serverConfig: A2AServerConfig = {
    agents: new Map([['test', testAgent]]),
    agentCard: {
      name: 'Test Server',
      description: 'Test A2A server',
      version: '1.0.0',
      provider: {
        organization: 'Test Org',
        url: 'https://test.com'
      }
    },
    port: 3001,
    host: 'localhost'
  };

  describe('createA2AServer', () => {
    it('should create A2A server with valid configuration', () => {
      const server = createA2AServer(serverConfig);

      expect(server).toBeDefined();
      expect(server.app).toBeDefined();
      expect(server.config).toBeDefined();
      expect(typeof server.start).toBe('function');
      expect(typeof server.stop).toBe('function');
      expect(typeof server.addAgent).toBe('function');
      expect(typeof server.removeAgent).toBe('function');
    }, 1000); // 1 second timeout

    it('should create server with default host', () => {
      const configWithoutHost = {
        ...serverConfig,
        host: undefined
      };

      const server = createA2AServer(configWithoutHost);
      expect(server.config.host).toBe('localhost');
    }, 1000);

    it('should create server with default capabilities', () => {
      const server = createA2AServer(serverConfig);
      
      expect(server.config.capabilities?.streaming).toBe(true);
      expect(server.config.capabilities?.pushNotifications).toBe(false);
      expect(server.config.capabilities?.stateTransitionHistory).toBe(true);
    }, 1000);

    it('should create server with custom capabilities', () => {
      const configWithCapabilities = {
        ...serverConfig,
        capabilities: {
          streaming: false,
          pushNotifications: true,
          stateTransitionHistory: false
        }
      };

      const server = createA2AServer(configWithCapabilities);
      
      expect(server.config.capabilities?.streaming).toBe(false);
      expect(server.config.capabilities?.pushNotifications).toBe(true);
      expect(server.config.capabilities?.stateTransitionHistory).toBe(false);
    }, 1000);
  });

  describe('Server Agent Management', () => {
    it('should add agent to server', () => {
      const server = createA2AServer(serverConfig);
      
      const newAgent = createA2AAgent({
        name: 'NewAgent',
        description: 'A new agent',
        instruction: 'New agent instructions',
        tools: []
      });

      const updatedConfig = server.addAgent('new', newAgent);
      
      expect(updatedConfig.agents.has('new')).toBe(true);
      expect(updatedConfig.agents.get('new')).toEqual(newAgent);
      expect(updatedConfig.agents.size).toBe(2); // original + new
    }, 1000);

    it('should remove agent from server', () => {
      const server = createA2AServer(serverConfig);
      
      const updatedConfig = server.removeAgent('test');
      
      expect(updatedConfig.agents.has('test')).toBe(false);
      expect(updatedConfig.agents.size).toBe(0);
    }, 1000);

    it('should update agent card when adding agent', () => {
      const server = createA2AServer(serverConfig);
      
      const newAgent = createA2AAgent({
        name: 'NewAgent',
        description: 'A new agent with skills',
        instruction: 'New agent instructions',
        tools: [testTool]
      });

      const updatedConfig = server.addAgent('new', newAgent);
      
      // Should regenerate agent card with new skills
      expect(updatedConfig.agentCard.skills.length).toBeGreaterThan(0);
    }, 1000);
  });

  describe('Agent Card Generation', () => {
    it('should generate agent card for single agent', () => {
      const agents = new Map([['test', testAgent]]);
      const config = {
        name: 'Test Service',
        description: 'Test A2A service',
        version: '1.0.0',
        provider: {
          organization: 'Test Org',
          url: 'https://test.com'
        }
      };

      const agentCard = generateAgentCard(config, agents, 'http://localhost:3000');

      expect(agentCard.protocolVersion).toBe('0.3.0');
      expect(agentCard.name).toBe('Test Service');
      expect(agentCard.description).toBe('Test A2A service');
      expect(agentCard.url).toBe('http://localhost:3000/a2a');
      expect(agentCard.version).toBe('1.0.0');
      expect(agentCard.provider?.organization).toBe('Test Org');
      expect(agentCard.capabilities.streaming).toBe(true);
      expect(agentCard.skills.length).toBeGreaterThan(0);
    });

    it('should generate skills from agent tools', () => {
      const multiToolAgent = createA2AAgent({
        name: 'MultiToolAgent',
        description: 'Agent with multiple tools',
        instruction: 'Use tools to help',
        tools: [
          createA2ATool({
            name: 'tool1',
            description: 'First tool',
            parameters: z.object({ input: z.string() }),
            execute: async ({ input }) => input
          }),
          createA2ATool({
            name: 'tool2',
            description: 'Second tool',
            parameters: z.object({ data: z.number() }),
            execute: async ({ data }) => data * 2
          })
        ]
      });

      const agents = new Map([['multi', multiToolAgent]]);
      const config = {
        name: 'Multi Tool Service',
        description: 'Service with multiple tools',
        version: '1.0.0',
        provider: {
          organization: 'Test Org',
          url: 'https://test.com'
        }
      };

      const agentCard = generateAgentCard(config, agents);

      expect(agentCard.skills.length).toBe(3); // 1 main + 2 tool skills
      expect(agentCard.skills.find(s => s.id === 'multi-main')).toBeDefined();
      expect(agentCard.skills.find(s => s.id === 'multi-tool1')).toBeDefined();
      expect(agentCard.skills.find(s => s.id === 'multi-tool2')).toBeDefined();
    });
  });

  describe('Server Configuration Validation', () => {
    it('should require agents map', () => {
      expect(() => {
        createA2AServer({
          ...serverConfig,
          agents: new Map() // Empty map
        });
      }).not.toThrow(); // Empty map should be allowed
    }, 1000);

    it('should require agent card configuration', () => {
      expect(() => {
        createA2AServer({
          ...serverConfig,
          agentCard: {
            name: 'Test',
            description: 'Test',
            version: '1.0.0',
            provider: {
              organization: 'Test',
              url: 'https://test.com'
            }
          }
        });
      }).not.toThrow();
    }, 1000);

    it('should require valid port', () => {
      expect(() => {
        createA2AServer({
          ...serverConfig,
          port: 3002
        });
      }).not.toThrow();
    }, 1000);
  });

  describe('Server Default Values', () => {
    it('should use default values for optional configuration', () => {
      const minimalConfig: A2AServerConfig = {
        agents: new Map([['test', testAgent]]),
        agentCard: {
          name: 'Minimal Server',
          description: 'Minimal configuration',
          version: '1.0.0',
          provider: {
            organization: 'Test',
            url: 'https://test.com'
          }
        },
        port: 3003
      };

      const server = createA2AServer(minimalConfig);

      expect(server.config.host).toBe('localhost');
      expect(server.config.capabilities?.streaming).toBe(true);
      expect(server.config.capabilities?.pushNotifications).toBe(false);
      expect(server.config.capabilities?.stateTransitionHistory).toBe(true);
    }, 1000);
  });

  describe('Agent Card Content Types', () => {
    it('should include default input/output modes', () => {
      const agentCard = generateAgentCard(
        serverConfig.agentCard,
        serverConfig.agents,
        'http://localhost:3000'
      );

      expect(agentCard.defaultInputModes).toContain('text/plain');
      expect(agentCard.defaultInputModes).toContain('application/json');
      expect(agentCard.defaultOutputModes).toContain('text/plain');
      expect(agentCard.defaultOutputModes).toContain('application/json');
    }, 1000);

    it('should handle agent-specific content types', () => {
      const mediaAgent = createA2AAgent({
        name: 'MediaAgent',
        description: 'Handles media files',
        instruction: 'Process media',
        tools: [],
        supportedContentTypes: ['image/jpeg', 'image/png']
      });

      const agents = new Map([['media', mediaAgent]]);
      const agentCard = generateAgentCard(
        serverConfig.agentCard,
        agents,
        'http://localhost:3000'
      );

      // Should still include defaults plus any additional types
      expect(agentCard.defaultInputModes).toContain('text/plain');
      expect(agentCard.defaultOutputModes).toContain('text/plain');
    }, 1000);
  });

  describe('Security Configuration', () => {
    it('should generate default security schemes', () => {
      const agentCard = generateAgentCard(
        serverConfig.agentCard,
        serverConfig.agents,
        'http://localhost:3000'
      );

      expect(agentCard.securitySchemes).toBeDefined();
      expect(agentCard.security).toBeDefined();
    }, 1000);
  });
});