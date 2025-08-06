# JAF Graphviz Visualization

The JAF (Juspay Agent Framework) visualization module provides powerful graph generation capabilities for visualizing agents, tools, and runner architectures. The system now uses direct DOT generation instead of the graphviz npm package, providing better reliability and performance.

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [API Reference](#api-reference)
4. [Visualization Types](#visualization-types)
5. [Color Schemes](#color-schemes)
6. [Usage Examples](#usage-examples)
7. [Troubleshooting](#troubleshooting)

## Overview

### Purpose and Capabilities

The JAF Graphviz visualization system provides:

- **Agent Architecture Visualization**: Generate comprehensive diagrams showing agent relationships, tool connections, and sub-agent hierarchies
- **Tool Network Graphs**: Create visual representations of tool ecosystems and dependencies
- **Runner Architecture Diagrams**: Visualize complete runner configurations including session providers and execution flows
- **Multiple Output Formats**: Support for PNG, SVG, and PDF output formats
- **Customizable Styling**: Three built-in color schemes (default, modern, minimal) with full customization options
- **Functional Design**: Pure functional implementation following JAF's architectural principles

### What Can Be Visualized

- **Agents**: Main agents with their configurations, models, and metadata
- **Sub-agents**: Hierarchical agent relationships and delegation flows
- **Tools**: Tool definitions, parameters, and connections to agents
- **Runner Configurations**: Complete system architecture including session management
- **Execution Flows**: Visual representation of how components interact

## Installation

### System Requirements

- Node.js 16+ with TypeScript support
- Graphviz system installation (for PNG/SVG/PDF generation)
- JAF framework installed and configured

### Graphviz Installation Steps

**macOS (using Homebrew):**
```bash
brew install graphviz
```

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install graphviz
```

**Windows:**
```bash
# Using Chocolatey
choco install graphviz

# Or download from: https://graphviz.org/download/
```

**Verify Installation:**
```bash
dot -V
# Should output: dot - graphviz version X.X.X
```

### npm Package Setup

The visualization module is included with JAF and uses the `graphviz` npm package:

```json
{
  "dependencies": {
    "graphviz": "^0.0.9"
  },
  "devDependencies": {
    "@types/graphviz": "^0.0.39"
  }
}
```

## API Reference

### Core Functions

#### `generateAgentGraph(agents, options?)`

Generates a graph visualization of one or more agents and their relationships.

**Parameters:**
- `agents: readonly Agent[]` - Array of agents to visualize
- `options?: GraphOptions` - Optional configuration options

**Returns:** `Promise<GraphResult>`

**Example:**
```typescript
import { generateAgentGraph } from 'jaf/visualization';

const result = await generateAgentGraph([agent1, agent2], {
  title: 'My Agent System',
  outputFormat: 'png',
  colorScheme: 'modern'
});
```

#### `generateToolGraph(tools, options?)`

Creates a visualization of tools and their relationships.

**Parameters:**
- `tools: readonly Tool[]` - Array of tools to visualize
- `options?: GraphOptions` - Optional configuration options

**Returns:** `Promise<GraphResult>`

#### `generateRunnerGraph(config, options?)`

Generates a comprehensive runner architecture diagram.

**Parameters:**
- `config: RunnerConfig` - Runner configuration to visualize
- `options?: GraphOptions` - Optional configuration options

**Returns:** `Promise<GraphResult>`

#### `generateRunnerGraphPng(config, outputPath?)`

Convenience function for generating PNG runner visualizations.

**Parameters:**
- `config: RunnerConfig` - Runner configuration
- `outputPath?: string` - Output file path (without extension)

**Returns:** `Promise<GraphResult>`

### Configuration Options

#### `GraphOptions` Interface

```typescript
interface GraphOptions {
  readonly title?: string;           // Graph title
  readonly layout?: 'dot' | 'neato' | 'fdp' | 'circo' | 'twopi';
  readonly rankdir?: 'TB' | 'LR' | 'BT' | 'RL';  // Direction
  readonly outputFormat?: 'png' | 'svg' | 'pdf'; // Output format
  readonly outputPath?: string;      // Output file path
  readonly showToolDetails?: boolean; // Include tool information
  readonly showSubAgents?: boolean;   // Include sub-agents
  readonly colorScheme?: 'default' | 'modern' | 'minimal';
}
```

**Layout Options:**
- `dot`: Hierarchical layouts (default for agents/runners)
- `neato`: Spring model layouts
- `fdp`: Force-directed placement
- `circo`: Circular layout (default for tools)
- `twopi`: Radial layouts

**Direction Options:**
- `TB`: Top to Bottom (default)
- `LR`: Left to Right
- `BT`: Bottom to Top
- `RL`: Right to Left

### Result Structure

#### `GraphResult` Interface

```typescript
interface GraphResult {
  readonly success: boolean;    // Whether generation succeeded
  readonly outputPath?: string; // Path to generated file
  readonly error?: string;      // Error message if failed
  readonly graphDot?: string;   // Generated DOT content
}
```

## Visualization Types

### Agent Graphs

Agent graphs show the relationships between agents, their tools, and sub-agents:

```typescript
import { generateAgentVisualization } from 'jaf/adk/runners';

const agents = [mainAgent, helperAgent];
const result = await generateAgentVisualization(agents, {
  title: 'Agent Network',
  showToolDetails: true,
  showSubAgents: true,
  colorScheme: 'modern'
});
```

**Features:**
- Agent nodes with model information and tool counts
- Tool connections showing available capabilities
- Sub-agent relationships with delegation flows
- Hierarchical layout showing system structure

### Tool Graphs

Tool graphs visualize tool ecosystems and their relationships:

```typescript
import { generateToolVisualization } from 'jaf/adk/runners';

const tools = [calculatorTool, weatherTool, searchTool];
const result = await generateToolVisualization(tools, {
  title: 'Tool Ecosystem',
  layout: 'circo',
  colorScheme: 'default'
});
```

**Features:**
- Tool nodes with descriptions and metadata
- Circular layout for clear tool overview
- Color-coded by tool source (function, API, etc.)
- Parameter information display

### Runner Architecture

Runner visualizations show complete system architecture:

```typescript
import { generateRunnerGraphPng } from 'jaf/adk/runners';

const runnerConfig = createRunnerConfig(agent, sessionProvider);
const result = await generateRunnerGraphPng(runnerConfig, './architecture');
```

**Features:**
- Runner execution flow
- Session provider integration
- Agent and tool relationships
- Sub-agent delegation paths
- System boundaries and clusters

## Color Schemes

### Default Scheme

Professional blue-purple color palette suitable for technical documentation:

- **Agents**: Light blue background (`#E3F2FD`) with blue text (`#1976D2`)
- **Tools**: Light purple background (`#F3E5F5`) with purple text (`#7B1FA2`)
- **Sub-agents**: Light green background (`#E8F5E8`) with green text (`#388E3C`)
- **Edges**: Dark gray (`#424242`) with solid lines

### Modern Scheme

Contemporary gradient-style colors for presentations:

- **Agents**: Blue gradient (`#667eea`) with white text and bold fonts
- **Tools**: Pink gradient (`#f093fb`) with white text
- **Sub-agents**: Light blue (`#4facfe`) with white text
- **Edges**: Blue (`#667eea`) with enhanced arrow styles

### Minimal Scheme

Clean, minimalist black-and-white design:

- **Agents**: White background with black text and bold borders
- **Tools**: Light gray background (`#f5f5f5`) with black text
- **Sub-agents**: White background with gray text
- **Edges**: Black with simple styling

### Customization Options

You can extend color schemes by modifying the `COLOR_SCHEMES` configuration:

```typescript
// Custom color scheme example
const customScheme = {
  agent: { 
    shape: 'box', 
    fillcolor: '#your-color', 
    fontcolor: 'white', 
    style: 'filled,rounded' 
  },
  tool: { 
    shape: 'ellipse', 
    fillcolor: '#tool-color', 
    fontcolor: 'black', 
    style: 'filled' 
  },
  // ... other style definitions
};
```

## Usage Examples

### Quick Start

Generate a basic agent visualization:

```typescript
import { quickStartVisualization } from 'jaf/visualization';

const agent = createAgent({
  name: 'My Assistant',
  model: 'gpt-4',
  tools: [calculatorTool, weatherTool]
});

await quickStartVisualization(agent, './my-agent-graph');
```

### Advanced Configuration

Create a comprehensive system visualization:

```typescript
import { 
  generateAgentVisualization, 
  generateRunnerGraphPng 
} from 'jaf/adk/runners';

// Multi-agent system
const agents = [
  primaryAgent,
  mathSpecialist,
  researchAgent
];

const agentResult = await generateAgentVisualization(agents, {
  title: 'Multi-Agent System Architecture',
  outputPath: './system-overview',
  outputFormat: 'svg',
  layout: 'dot',
  rankdir: 'LR',
  showToolDetails: true,
  showSubAgents: true,
  colorScheme: 'modern'
});

// Runner architecture
const runnerConfig = createRunnerConfig(primaryAgent, sessionProvider);
const runnerResult = await generateRunnerGraphPng(
  runnerConfig, 
  './runner-architecture'
);
```

### Integration with Runners

Use visualization within runner lifecycle:

```typescript
import { createRunner, generateRunnerGraphPng } from 'jaf/adk/runners';

const runner = createRunner(agent, sessionProvider);

// Generate architecture diagram
const vizResult = await generateRunnerGraphPng(
  runner.config,
  `./docs/architecture-${Date.now()}`
);

if (vizResult.success) {
  console.log(`Architecture diagram: ${vizResult.outputPath}`);
}
```

### Batch Generation

Generate multiple visualizations:

```typescript
import { runVisualizationExamples } from 'jaf/visualization';

// Generates complete example set:
// - Agent graphs with different color schemes
// - Tool ecosystem visualization
// - Runner architecture diagram
await runVisualizationExamples();
```

### Error Handling

Robust error handling with fallbacks:

```typescript
const result = await generateAgentVisualization(agents, options);

if (result.success) {
  console.log(`✅ Generated: ${result.outputPath}`);
} else {
  console.error(`❌ Failed: ${result.error}`);
  
  // DOT content is still available for manual processing
  if (result.graphDot) {
    console.log('DOT content available for manual generation');
    // Save DOT file for manual processing
    writeFileSync('./graph.dot', result.graphDot);
  }
}
```

## Troubleshooting

### Common Issues

#### "Graphviz not installed" Error

**Problem:** System Graphviz is not installed or not in PATH.

**Solution:**
```bash
# Install Graphviz
brew install graphviz  # macOS
sudo apt-get install graphviz  # Ubuntu/Debian
choco install graphviz  # Windows

# Verify installation
dot -V
```

#### "Process exited with code 1" Error

**Problem:** Graphviz process failed during generation.

**Solutions:**
1. Check file permissions for output directory
2. Verify output path is valid and writable
3. Ensure no special characters in file paths
4. Try different output format (PNG vs SVG)

#### Empty or Corrupted Output Files

**Problem:** Files are generated but appear empty or corrupted.

**Solutions:**
1. Check available disk space
2. Verify Graphviz version compatibility
3. Try simpler graph configurations
4. Use fallback DOT generation

#### Performance Issues with Large Graphs

**Problem:** Slow generation with many agents/tools.

**Solutions:**
1. Disable tool details: `showToolDetails: false`
2. Disable sub-agents: `showSubAgents: false`
3. Use simpler layouts: `layout: 'neato'`
4. Generate smaller subsets of the system

### Fallback Mechanisms

The visualization system includes automatic fallbacks:

1. **npm graphviz Package Issues**: Falls back to system Graphviz command
2. **System Graphviz Missing**: Provides DOT content for manual processing
3. **File Generation Errors**: Returns error details with DOT content preserved

### Debug Information

Enable verbose output for troubleshooting:

```typescript
const result = await generateRunnerGraph(config, {
  title: 'Debug Visualization'
});

if (!result.success) {
  console.log('Error:', result.error);
  console.log('DOT Content Length:', result.graphDot?.length);
  
  // Save DOT for manual inspection
  if (result.graphDot) {
    writeFileSync('./debug.dot', result.graphDot);
    console.log('DOT file saved for manual processing');
  }
}
```

### Manual DOT Processing

If automated generation fails, process DOT files manually:

```bash
# Generate PNG from DOT
dot -Tpng input.dot -o output.png

# Generate SVG from DOT
dot -Tsvg input.dot -o output.svg

# Generate PDF from DOT
dot -Tpdf input.dot -o output.pdf
```

### System Requirements Check

Verify your environment meets requirements:

```typescript
import { execSync } from 'child_process';

try {
  const version = execSync('dot -V', { encoding: 'utf8' });
  console.log('Graphviz available:', version);
} catch (error) {
  console.log('Graphviz not found - install required');
}
```

### Getting Help

For additional support:

1. Check the [JAF GitHub repository](https://github.com/your-repo/jaf) for issues
2. Review the examples in `/examples/server-demo/test-runner-visualization.ts`
3. Use the built-in validation: `validateGraphOptions(options)`
4. Enable debug output in your runner configuration

---

## Related Documentation

- [Getting Started Guide](./getting-started.md)
- [ADK Analysis](./adk-analysis.md)
- [Runner Configuration](./api-reference.md)
- [Tool Development](./tools.md)
- [Examples](./examples.md)