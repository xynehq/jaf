/**
 * FAF Visualization - Graphviz Integration
 * 
 * Functional visualization system for agents and tools using Graphviz
 */

import { digraph } from 'graphviz';
import { Agent, Tool, RunnerConfig } from '../adk/types';

// ========== Core Visualization Types ==========

export interface GraphOptions {
  readonly title?: string;
  readonly layout?: 'dot' | 'neato' | 'fdp' | 'circo' | 'twopi';
  readonly rankdir?: 'TB' | 'LR' | 'BT' | 'RL';
  readonly outputFormat?: 'png' | 'svg' | 'pdf';
  readonly outputPath?: string;
  readonly showToolDetails?: boolean;
  readonly showSubAgents?: boolean;
  readonly colorScheme?: 'default' | 'modern' | 'minimal';
}

export interface GraphResult {
  readonly success: boolean;
  readonly outputPath?: string;
  readonly error?: string;
  readonly graphDot?: string;
}

export interface NodeStyle {
  readonly shape: string;
  readonly fillcolor: string;
  readonly fontcolor: string;
  readonly style: string;
  readonly fontname?: string;
  readonly penwidth?: string;
}

export interface EdgeStyle {
  readonly color: string;
  readonly style: string;
  readonly penwidth?: string;
  readonly arrowhead?: string;
}

// ========== Color Schemes ==========

const COLOR_SCHEMES = {
  default: {
    agent: { shape: 'box', fillcolor: '#E3F2FD', fontcolor: '#1976D2', style: 'filled,rounded' },
    tool: { shape: 'ellipse', fillcolor: '#F3E5F5', fontcolor: '#7B1FA2', style: 'filled' },
    subAgent: { shape: 'box', fillcolor: '#E8F5E8', fontcolor: '#388E3C', style: 'filled,dashed' },
    edge: { color: '#424242', style: 'solid', penwidth: '1.5' },
    toolEdge: { color: '#9C27B0', style: 'dashed', penwidth: '1.0' }
  },
  modern: {
    agent: { shape: 'box', fillcolor: '#667eea', fontcolor: 'white', style: 'filled,rounded', fontname: 'Arial Bold' },
    tool: { shape: 'ellipse', fillcolor: '#f093fb', fontcolor: 'white', style: 'filled', fontname: 'Arial' },
    subAgent: { shape: 'box', fillcolor: '#4facfe', fontcolor: 'white', style: 'filled,dashed', fontname: 'Arial' },
    edge: { color: '#667eea', style: 'solid', penwidth: '2.0', arrowhead: 'vee' },
    toolEdge: { color: '#f093fb', style: 'dashed', penwidth: '1.5', arrowhead: 'open' }
  },
  minimal: {
    agent: { shape: 'box', fillcolor: 'white', fontcolor: 'black', style: 'filled', penwidth: '2' },
    tool: { shape: 'ellipse', fillcolor: '#f5f5f5', fontcolor: 'black', style: 'filled' },
    subAgent: { shape: 'box', fillcolor: 'white', fontcolor: 'gray', style: 'filled,dashed' },
    edge: { color: 'black', style: 'solid', penwidth: '1.0' },
    toolEdge: { color: 'gray', style: 'dashed', penwidth: '1.0' }
  }
} as const;

// ========== Graph Generation Functions ==========

export const generateAgentGraph = async (
  agents: readonly Agent[],
  options: GraphOptions = {}
): Promise<GraphResult> => {
  try {
    const {
      title = 'FAF Agent Graph',
      layout = 'dot',
      rankdir = 'TB',
      outputFormat = 'png',
      outputPath = './agent-graph',
      showToolDetails = true,
      showSubAgents = true,
      colorScheme = 'default'
    } = options;

    // Create digraph
    const graph = digraph('AgentGraph');
    
    // Set graph attributes
    graph.set('rankdir', rankdir);
    graph.set('label', title);
    graph.set('labelloc', 't');
    graph.set('fontsize', '16');
    graph.set('fontname', 'Arial Bold');
    graph.set('bgcolor', 'white');
    graph.set('pad', '0.5');
    
    const styles = COLOR_SCHEMES[colorScheme];
    
    // Add nodes for each agent
    for (const agent of agents) {
      addAgentNode(graph, agent, styles, showToolDetails, showSubAgents);
    }
    
    // Add edges between agents (handoffs, sub-agents)
    for (const agent of agents) {
      addAgentEdges(graph, agent, agents, styles, showSubAgents);
    }
    
    // Generate output
    const finalOutputPath = `${outputPath}.${outputFormat}`;
    
    return new Promise((resolve) => {
      graph.output(outputFormat as any, finalOutputPath, (code: number) => {
        if (code === 0) {
          resolve({
            success: true,
            outputPath: finalOutputPath,
            graphDot: graph.to_dot()
          });
        } else {
          resolve({
            success: false,
            error: `Graphviz process exited with code ${code}`
          });
        }
      });
    });
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

export const generateToolGraph = async (
  tools: readonly Tool[],
  options: GraphOptions = {}
): Promise<GraphResult> => {
  try {
    const {
      title = 'FAF Tool Graph',
      layout = 'circo',
      outputFormat = 'png',
      outputPath = './tool-graph',
      colorScheme = 'default'
    } = options;

    const graph = digraph('ToolGraph');
    
    graph.set('layout', layout);
    graph.set('label', title);
    graph.set('labelloc', 't');
    graph.set('fontsize', '16');
    graph.set('fontname', 'Arial Bold');
    graph.set('bgcolor', 'white');
    
    const styles = COLOR_SCHEMES[colorScheme];
    
    // Add tool nodes
    for (const tool of tools) {
      addToolNode(graph, tool, styles);
    }
    
    // Generate output
    const finalOutputPath = `${outputPath}.${outputFormat}`;
    
    return new Promise((resolve) => {
      graph.output(outputFormat as any, finalOutputPath, (code: number) => {
        if (code === 0) {
          resolve({
            success: true,
            outputPath: finalOutputPath,
            graphDot: graph.to_dot()
          });
        } else {
          resolve({
            success: false,
            error: `Graphviz process exited with code ${code}`
          });
        }
      });
    });
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

export const generateRunnerGraph = async (
  config: RunnerConfig,
  options: GraphOptions = {}
): Promise<GraphResult> => {
  try {
    const {
      title = 'FAF Runner Architecture',
      layout = 'dot',
      rankdir = 'TB',
      outputFormat = 'png',
      outputPath = './runner-graph',
      showToolDetails = true,
      showSubAgents = true,
      colorScheme = 'modern'
    } = options;

    const graph = digraph('RunnerGraph');
    
    graph.set('rankdir', rankdir);
    graph.set('label', title);
    graph.set('labelloc', 't');
    graph.set('fontsize', '16');
    graph.set('fontname', 'Arial Bold');
    graph.set('bgcolor', 'white');
    graph.set('compound', 'true');
    
    const styles = COLOR_SCHEMES[colorScheme];
    
    // Create clusters for different components
    const agentCluster = graph.addCluster('cluster_agents');
    agentCluster.set('label', 'Agents');
    agentCluster.set('style', 'filled');
    agentCluster.set('fillcolor', '#f8f9fa');
    
    const sessionCluster = graph.addCluster('cluster_session');
    sessionCluster.set('label', 'Session Layer');
    sessionCluster.set('style', 'filled');
    sessionCluster.set('fillcolor', '#fff3cd');
    
    // Add agent and tools
    addAgentNode(agentCluster, config.agent, styles, showToolDetails, showSubAgents);
    
    // Add session provider
    const sessionNode = sessionCluster.addNode('session_provider');
    sessionNode.set('label', 'Session\\nProvider');
    sessionNode.set('shape', 'box');
    sessionNode.set('fillcolor', '#ffc107');
    sessionNode.set('fontcolor', 'black');
    sessionNode.set('style', 'filled,rounded');
    
    // Add runner node
    const runnerNode = graph.addNode('runner');
    runnerNode.set('label', 'Runner');
    runnerNode.set('shape', 'diamond');
    runnerNode.set('fillcolor', '#28a745');
    runnerNode.set('fontcolor', 'white');
    runnerNode.set('style', 'filled');
    runnerNode.set('fontsize', '14');
    runnerNode.set('fontname', 'Arial Bold');
    
    // Add edges
    const runnerToAgent = graph.addEdge(runnerNode, config.agent.id);
    runnerToAgent.set('color', styles.edge.color);
    runnerToAgent.set('style', styles.edge.style);
    runnerToAgent.set('label', 'executes');
    
    const runnerToSession = graph.addEdge(runnerNode, sessionNode);
    runnerToSession.set('color', '#ffc107');
    runnerToSession.set('style', 'dashed');
    runnerToSession.set('label', 'manages');
    
    // Generate output
    const finalOutputPath = `${outputPath}.${outputFormat}`;
    
    return new Promise((resolve) => {
      graph.output(outputFormat as any, finalOutputPath, (code: number) => {
        if (code === 0) {
          resolve({
            success: true,
            outputPath: finalOutputPath,
            graphDot: graph.to_dot()
          });
        } else {
          resolve({
            success: false,
            error: `Graphviz process exited with code ${code}`
          });
        }
      });
    });
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

// ========== Helper Functions ==========

const addAgentNode = (
  graph: any,
  agent: Agent,
  styles: any,
  showToolDetails: boolean,
  showSubAgents: boolean
): void => {
  // Main agent node
  const agentNode = graph.addNode(agent.id);
  const agentStyle = styles.agent;
  
  agentNode.set('label', createAgentLabel(agent, showToolDetails));
  agentNode.set('shape', agentStyle.shape);
  agentNode.set('fillcolor', agentStyle.fillcolor);
  agentNode.set('fontcolor', agentStyle.fontcolor);
  agentNode.set('style', agentStyle.style);
  
  if (agentStyle.fontname) {
    agentNode.set('fontname', agentStyle.fontname);
  }
  
  // Add tool nodes
  if (showToolDetails && agent.config.tools.length > 0) {
    for (const tool of agent.config.tools) {
      addToolNode(graph, tool, styles);
      
      // Connect agent to tool
      const edge = graph.addEdge(agent.id, tool.name);
      edge.set('color', styles.toolEdge.color);
      edge.set('style', styles.toolEdge.style);
      edge.set('penwidth', styles.toolEdge.penwidth);
      
      if (styles.toolEdge.arrowhead) {
        edge.set('arrowhead', styles.toolEdge.arrowhead);
      }
    }
  }
  
  // Add sub-agent nodes
  if (showSubAgents && agent.config.subAgents) {
    for (const subAgentConfig of agent.config.subAgents) {
      const subAgentId = `${agent.id}_sub_${subAgentConfig.name}`;
      const subAgentNode = graph.addNode(subAgentId);
      const subAgentStyle = styles.subAgent;
      
      subAgentNode.set('label', subAgentConfig.name);
      subAgentNode.set('shape', subAgentStyle.shape);
      subAgentNode.set('fillcolor', subAgentStyle.fillcolor);
      subAgentNode.set('fontcolor', subAgentStyle.fontcolor);
      subAgentNode.set('style', subAgentStyle.style);
      
      // Connect main agent to sub-agent
      const edge = graph.addEdge(agent.id, subAgentId);
      edge.set('color', styles.edge.color);
      edge.set('style', 'dashed');
      edge.set('label', 'delegates');
    }
  }
};

const addToolNode = (graph: any, tool: Tool, styles: any): void => {
  const toolNode = graph.addNode(tool.name);
  const toolStyle = styles.tool;
  
  toolNode.set('label', createToolLabel(tool));
  toolNode.set('shape', toolStyle.shape);
  toolNode.set('fillcolor', toolStyle.fillcolor);
  toolNode.set('fontcolor', toolStyle.fontcolor);
  toolNode.set('style', toolStyle.style);
  
  if (toolStyle.fontname) {
    toolNode.set('fontname', toolStyle.fontname);
  }
};

const addAgentEdges = (
  graph: any,
  agent: Agent,
  allAgents: readonly Agent[],
  styles: any,
  showSubAgents: boolean
): void => {
  // Add handoff edges (if handoffs are defined in the agent config)
  // This would need to be implemented based on how handoffs are configured
  // For now, we'll skip this as it's not clear from the current types
};

const createAgentLabel = (agent: Agent, showToolDetails: boolean): string => {
  let label = `${agent.config.name}\\n(${agent.config.model})`;
  
  if (showToolDetails && agent.config.tools.length > 0) {
    label += `\\n${agent.config.tools.length} tools`;
  }
  
  if (agent.config.subAgents && agent.config.subAgents.length > 0) {
    label += `\\n${agent.config.subAgents.length} sub-agents`;
  }
  
  return label;
};

const createToolLabel = (tool: Tool): string => {
  return `${tool.name}\\n${tool.description.substring(0, 30)}${tool.description.length > 30 ? '...' : ''}`;
};

// ========== Validation Functions ==========

export const validateGraphOptions = (options: GraphOptions): string[] => {
  const errors: string[] = [];
  
  if (options.layout && !['dot', 'neato', 'fdp', 'circo', 'twopi'].includes(options.layout)) {
    errors.push('Invalid layout option');
  }
  
  if (options.rankdir && !['TB', 'LR', 'BT', 'RL'].includes(options.rankdir)) {
    errors.push('Invalid rankdir option');
  }
  
  if (options.outputFormat && !['png', 'svg', 'pdf'].includes(options.outputFormat)) {
    errors.push('Invalid output format');
  }
  
  if (options.colorScheme && !['default', 'modern', 'minimal'].includes(options.colorScheme)) {
    errors.push('Invalid color scheme');
  }
  
  return errors;
};

// ========== Utility Functions ==========

export const getGraphDot = (agents: readonly Agent[], options: GraphOptions = {}): string => {
  const {
    title = 'FAF Agent Graph',
    rankdir = 'TB',
    colorScheme = 'default'
  } = options;

  const graph = digraph('AgentGraph');
  graph.set('rankdir', rankdir);
  graph.set('label', title);
  
  const styles = COLOR_SCHEMES[colorScheme];
  
  for (const agent of agents) {
    addAgentNode(graph, agent, styles, true, true);
  }
  
  return graph.to_dot();
};