/**
 * JAF Visualization - Graphviz Integration
 * 
 * Functional visualization system for agents and tools using Graphviz
 */

import { Agent, Tool, RunnerConfig } from '../adk/types.js';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';

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
      title = 'JAF Agent Graph',
      layout = 'dot',
      rankdir = 'TB',
      outputFormat = 'png',
      outputPath = './agent-graph',
      showToolDetails = true,
      showSubAgents = true,
      colorScheme = 'default'
    } = options;

    // Generate DOT content
    const dotContent = generateAgentsDOT(agents, {
      title,
      layout,
      rankdir,
      showToolDetails,
      showSubAgents,
      colorScheme
    });

    // Write DOT file
    const dotPath = `${outputPath}.dot`;
    writeFileSync(dotPath, dotContent);

    // Try to use system graphviz
    const finalOutputPath = `${outputPath}.${outputFormat}`;
    
    try {
      execSync(`dot -T${outputFormat} "${dotPath}" -o "${finalOutputPath}"`, { 
        stdio: 'pipe' 
      });
      
      return {
        success: true,
        outputPath: finalOutputPath,
        graphDot: dotContent
      };
    } catch (execError) {
      return {
        success: false,
        error: `Graphviz not installed or failed to execute. Install with: brew install graphviz (macOS) or sudo apt-get install graphviz (Linux)`,
        graphDot: dotContent
      };
    }
    
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
      title = 'JAF Tool Graph',
      layout = 'circo',
      outputFormat = 'png',
      outputPath = './tool-graph',
      colorScheme = 'default'
    } = options;

    // Generate DOT content
    const dotContent = generateToolsDOT(tools, {
      title,
      layout,
      colorScheme
    });

    // Write DOT file
    const dotPath = `${outputPath}.dot`;
    writeFileSync(dotPath, dotContent);

    // Try to use system graphviz with circo layout
    const finalOutputPath = `${outputPath}.${outputFormat}`;
    
    try {
      const layoutEngine = layout === 'circo' ? 'circo' : 'dot';
      execSync(`${layoutEngine} -T${outputFormat} "${dotPath}" -o "${finalOutputPath}"`, { 
        stdio: 'pipe' 
      });
      
      return {
        success: true,
        outputPath: finalOutputPath,
        graphDot: dotContent
      };
    } catch (execError) {
      return {
        success: false,
        error: `Graphviz not installed or failed to execute. Install with: brew install graphviz (macOS) or sudo apt-get install graphviz (Linux)`,
        graphDot: dotContent
      };
    }
    
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
      title = 'JAF Runner Architecture',
      layout = 'dot',
      rankdir = 'TB',
      outputFormat = 'png',
      outputPath = './runner-graph',
      showToolDetails = true,
      showSubAgents = true,
      colorScheme = 'modern'
    } = options;

    // Generate DOT content
    const dotContent = generateRunnerDOT(config, {
      title,
      rankdir,
      showToolDetails,
      showSubAgents,
      colorScheme
    });

    // Write DOT file
    const dotPath = `${outputPath}.dot`;
    writeFileSync(dotPath, dotContent);

    // Try to use system graphviz
    const finalOutputPath = `${outputPath}.${outputFormat}`;
    
    try {
      const layoutEngine = layout === 'circo' ? 'circo' : layout === 'neato' ? 'neato' : 'dot';
      execSync(`${layoutEngine} -T${outputFormat} "${dotPath}" -o "${finalOutputPath}"`, { 
        stdio: 'pipe' 
      });
      
      return {
        success: true,
        outputPath: finalOutputPath,
        graphDot: dotContent
      };
    } catch (execError) {
      return {
        success: false,
        error: `Graphviz not installed or failed to execute. Install with: brew install graphviz (macOS) or sudo apt-get install graphviz (Linux)`,
        graphDot: dotContent
      };
    }
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

// Generate DOT content for multiple agents
const generateAgentsDOT = (
  agents: readonly Agent[],
  options: {
    title: string;
    layout: string;
    rankdir: string;
    showToolDetails: boolean;
    showSubAgents: boolean;
    colorScheme: string;
  }
): string => {
  const { title, layout, rankdir, showToolDetails, showSubAgents, colorScheme } = options;
  const styles = COLOR_SCHEMES[colorScheme as keyof typeof COLOR_SCHEMES];
  
  let dot = `digraph "AgentGraph" {
    rankdir=${rankdir};
    layout=${layout};
    label="${title}";
    labelloc=t;
    fontsize=16;
    fontname="Arial Bold";
    bgcolor=white;
    pad=0.5;
    compound=true;
`;

  // Add nodes for each agent
  for (const agent of agents) {
    dot += generateAgentNodeDOT(agent, styles, showToolDetails);
    
    // Add sub-agents if requested
    if (showSubAgents && agent.config.subAgents) {
      for (const subAgent of agent.config.subAgents) {
        const subAgentId = `${agent.id}_sub_${subAgent.name}`;
        dot += `
    // Sub-agent: ${subAgent.name}
    "${subAgentId}" [
        label="${subAgent.name}",
        shape=${styles.subAgent.shape},
        fillcolor="${styles.subAgent.fillcolor}",
        fontcolor="${styles.subAgent.fontcolor}",
        style="${styles.subAgent.style}"
    ];

    "${agent.id}" -> "${subAgentId}" [
        color="${styles.edge.color}",
        style=dashed,
        label="delegates"
    ];
`;
      }
    }
  }

  dot += '\n}';
  return dot;
};

// Generate DOT content for tools
const generateToolsDOT = (
  tools: readonly Tool[],
  options: {
    title: string;
    layout: string;
    colorScheme: string;
  }
): string => {
  const { title, layout, colorScheme } = options;
  const styles = COLOR_SCHEMES[colorScheme as keyof typeof COLOR_SCHEMES];
  
  let dot = `digraph "ToolGraph" {
    layout=${layout};
    label="${title}";
    labelloc=t;
    fontsize=16;
    fontname="Arial Bold";
    bgcolor=white;
    pad=0.5;
`;

  // Add tool nodes
  for (const tool of tools) {
    const toolLabel = `${tool.name}\\n${tool.description.substring(0, 30)}${tool.description.length > 30 ? '...' : ''}`;
    dot += `
    // Tool: ${tool.name}
    "${tool.name}" [
        label="${toolLabel}",
        shape=${styles.tool.shape},
        fillcolor="${styles.tool.fillcolor}",
        fontcolor="${styles.tool.fontcolor}",
        style="${styles.tool.style}"
    ];
`;
  }

  dot += '\n}';
  return dot;
};

// Generate DOT for a single agent node
const generateAgentNodeDOT = (
  agent: Agent,
  styles: any,
  showToolDetails: boolean
): string => {
  let label = `${agent.config.name}\\n(${agent.config.model})`;
  
  if (showToolDetails && agent.config.tools.length > 0) {
    label += `\\n${agent.config.tools.length} tools`;
  }
  
  if (agent.config.subAgents && agent.config.subAgents.length > 0) {
    label += `\\n${agent.config.subAgents.length} sub-agents`;
  }

  let dot = `
    // Agent: ${agent.config.name}
    "${agent.id}" [
        label="${label}",
        shape=${styles.agent.shape},
        fillcolor="${styles.agent.fillcolor}",
        fontcolor="${styles.agent.fontcolor}",
        style="${styles.agent.style}"
    ];
`;

  // Add tool nodes and edges if requested
  if (showToolDetails) {
    for (const tool of agent.config.tools) {
      const toolLabel = `${tool.name}\\n${tool.description.substring(0, 30)}${tool.description.length > 30 ? '...' : ''}`;
      dot += `
    // Tool: ${tool.name}
    "${tool.name}" [
        label="${toolLabel}",
        shape=${styles.tool.shape},
        fillcolor="${styles.tool.fillcolor}",
        fontcolor="${styles.tool.fontcolor}",
        style="${styles.tool.style}"
    ];

    "${agent.id}" -> "${tool.name}" [
        color="${styles.toolEdge.color}",
        style="${styles.toolEdge.style}",
        penwidth="${styles.toolEdge.penwidth || '1.0'}"
    ];
`;
    }
  }

  return dot;
};

// Manual DOT generation for runner
const generateRunnerDOT = (
  config: RunnerConfig,
  options: {
    title: string;
    rankdir: string;
    showToolDetails: boolean;
    showSubAgents: boolean;
    colorScheme: string;
  }
): string => {
  const { title, rankdir, showToolDetails, showSubAgents, colorScheme } = options;
  const styles = COLOR_SCHEMES[colorScheme as keyof typeof COLOR_SCHEMES];
  
  let dot = `digraph "RunnerGraph" {
    rankdir=${rankdir};
    label="${title}";
    labelloc=t;
    fontsize=16;
    fontname="Arial Bold";
    bgcolor=white;
    pad=0.5;
    compound=true;

    // Runner node
    "runner" [
        label="Runner",
        shape=diamond,
        fillcolor="#28a745",
        fontcolor=white,
        style=filled,
        fontsize=14,
        fontname="Arial Bold"
    ];

    // Session provider node  
    "session_provider" [
        label="Session\\nProvider",
        shape=box,
        fillcolor="#ffc107",
        fontcolor=black,
        style="filled,rounded"
    ];

    // Agent node
    "${config.agent.id}" [
        label="${config.agent.config.name}\\n(${config.agent.config.model})\\n${config.agent.config.tools.length} tools",
        shape=box,
        fillcolor="${styles.agent.fillcolor}",
        fontcolor="${styles.agent.fontcolor}",
        style="${styles.agent.style}"
    ];

    // Runner connections
    "runner" -> "${config.agent.id}" [
        color="${styles.edge.color}",
        style="${styles.edge.style}",
        label="executes"
    ];

    "runner" -> "session_provider" [
        color="#ffc107",
        style=dashed,
        label="manages"
    ];
`;

  // Add tool nodes and connections if requested
  if (showToolDetails) {
    for (const tool of config.agent.config.tools) {
      dot += `
    // Tool: ${tool.name}
    "${tool.name}" [
        label="${tool.name}\\n${tool.description.substring(0, 30)}${tool.description.length > 30 ? '...' : ''}",
        shape=ellipse,
        fillcolor="${styles.tool.fillcolor}",
        fontcolor="${styles.tool.fontcolor}",
        style="${styles.tool.style}"
    ];

    "${config.agent.id}" -> "${tool.name}" [
        color="${styles.toolEdge.color}",
        style="${styles.toolEdge.style}",
        penwidth="${styles.toolEdge.penwidth}"
    ];
`;
    }
  }

  // Add sub-agents if requested
  if (showSubAgents && config.agent.config.subAgents) {
    for (const subAgent of config.agent.config.subAgents) {
      const subAgentId = `${config.agent.id}_sub_${subAgent.name}`;
      dot += `
    // Sub-agent: ${subAgent.name}
    "${subAgentId}" [
        label="${subAgent.name}",
        shape=box,
        fillcolor="${styles.subAgent.fillcolor}",
        fontcolor="${styles.subAgent.fontcolor}",
        style="${styles.subAgent.style}"
    ];

    "${config.agent.id}" -> "${subAgentId}" [
        color="${styles.edge.color}",
        style=dashed,
        label="delegates"
    ];
`;
    }
  }

  dot += `
    // Clusters for organization
    subgraph cluster_agents {
        label="Agents";
        style=filled;
        fillcolor="#f8f9fa";
        "${config.agent.id}";
    }

    subgraph cluster_session {
        label="Session Layer";
        style=filled;
        fillcolor="#fff3cd";
        "session_provider";
    }
}`;

  return dot;
};

// ========== Helper Functions ==========

// These functions are currently unused but kept for potential future use
// when we re-implement the graphviz npm package integration

// const createAgentLabel = (agent: Agent, showToolDetails: boolean): string => {
//   let label = `${agent.config.name}\\n(${agent.config.model})`;
//   
//   if (showToolDetails && agent.config.tools.length > 0) {
//     label += `\\n${agent.config.tools.length} tools`;
//   }
//   
//   if (agent.config.subAgents && agent.config.subAgents.length > 0) {
//     label += `\\n${agent.config.subAgents.length} sub-agents`;
//   }
//   
//   return label;
// };

// const createToolLabel = (tool: Tool): string => {
//   return `${tool.name}\\n${tool.description.substring(0, 30)}${tool.description.length > 30 ? '...' : ''}`;
// };

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
    title = 'JAF Agent Graph',
    rankdir = 'TB',
    layout = 'dot',
    colorScheme = 'default'
  } = options;

  return generateAgentsDOT(agents, {
    title,
    layout,
    rankdir,
    showToolDetails: true,
    showSubAgents: true,
    colorScheme
  });
};

// Check if graphviz is installed
export const isGraphvizInstalled = (): boolean => {
  try {
    execSync('dot -V', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};