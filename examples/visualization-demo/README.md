# JAF Visualization Demo

This example demonstrates the powerful visualization capabilities of the Juspay Agent Framework (JAF) using Graphviz integration.

## 🎯 Features Demonstrated

1. **Single Agent Visualization** - Visualize individual agents with their tools
2. **Multiple Agents Graph** - Show relationships between multiple agents
3. **Multi-Agent Coordinator** - Visualize delegation strategies and sub-agents
4. **Hierarchical Systems** - Display complex multi-level agent architectures
5. **Tool Graphs** - Visualize available tools and their relationships
6. **Runner Architecture** - Show the complete execution environment
7. **Color Schemes** - Three different visual styles (default, modern, minimal)
8. **Multiple Output Formats** - PNG, SVG, PDF, and DOT files

## 📋 Prerequisites

### Required
- Node.js 18+ and npm
- JAF framework installed

### Optional (but recommended)
- Graphviz installed on your system for image generation

#### Installing Graphviz

**macOS:**
```bash
brew install graphviz
```

**Ubuntu/Debian:**
```bash
sudo apt-get install graphviz
```

**Windows:**
Download from [https://graphviz.org/download/](https://graphviz.org/download/)

## 🚀 Getting Started

### Installation

```bash
# From the visualization-demo directory
npm install
```

### Running the Demo

#### Full Demo (generates all visualizations)
```bash
npm start
```

#### Interactive Mode
```bash
npm run interactive
```

## 📊 Visualization Types

### 1. Agent Graphs

Shows agents with their:
- Name and model
- Tools (optional)
- Sub-agents (for multi-agent systems)
- Delegation relationships

**Example Output:**
- `weather-agent.png` - Single weather specialist agent
- `all-agents.svg` - All specialist agents side by side
- `coordinator.png` - Multi-agent coordinator with sub-agents

### 2. Tool Graphs

Displays available tools in a circular layout showing:
- Tool name
- Description (truncated)
- Visual grouping

**Example Output:**
- `tools.svg` - All available tools in circular layout

### 3. Runner Architecture

Shows the complete execution environment:
- Runner (diamond shape)
- Session Provider
- Agent hierarchy
- Tool connections

**Example Output:**
- `runner.png` - Complete runner architecture

### 4. Hierarchical Systems

Complex multi-level agent systems with:
- Parent coordinators
- Sub-agent teams
- Tool distribution
- Delegation paths

**Example Output:**
- `hierarchical.pdf` - Multi-level agent hierarchy

## 🎨 Color Schemes

The demo includes three color schemes:

### Default
- **Agents**: Light blue with dark blue text
- **Tools**: Light purple with purple text
- **Sub-agents**: Light green with green text
- Classic, professional appearance

### Modern
- **Agents**: Gradient purple with white text
- **Tools**: Gradient pink with white text
- **Sub-agents**: Gradient blue with white text
- Contemporary, vibrant appearance

### Minimal
- **Agents**: White with black text
- **Tools**: Light gray with black text
- **Sub-agents**: White with gray text, dashed border
- Clean, minimalist appearance

## 📁 Output Structure

After running the demo, the `output/` directory will contain:

```
output/
├── weather-agent.png         # Single agent visualization
├── weather-agent.dot         # DOT source file
├── all-agents.svg           # Multiple agents graph
├── all-agents.dot           # DOT source file
├── coordinator.png          # Multi-agent coordinator
├── coordinator.dot          # DOT source file
├── hierarchical.pdf         # Hierarchical system
├── hierarchical.dot         # DOT source file
├── tools.svg                # Tools visualization
├── tools.dot                # DOT source file
├── runner.png               # Runner architecture
├── runner.dot               # DOT source file
├── color-default.dot        # Default color scheme example
├── color-modern.dot         # Modern color scheme example
└── color-minimal.dot        # Minimal color scheme example
```

## 🛠️ Customization

### Graph Options

```typescript
const options = {
  title: 'My Custom Graph',        // Graph title
  outputPath: './custom-output',   // Output file path (without extension)
  outputFormat: 'png',              // 'png' | 'svg' | 'pdf'
  colorScheme: 'modern',            // 'default' | 'modern' | 'minimal'
  rankdir: 'TB',                    // 'TB' | 'LR' | 'BT' | 'RL'
  layout: 'dot',                    // 'dot' | 'circo' | 'neato' | 'fdp' | 'twopi'
  showToolDetails: true,            // Show tool nodes
  showSubAgents: true              // Show sub-agent hierarchy
};
```

### Layout Directions
- `TB` - Top to Bottom (default)
- `LR` - Left to Right
- `BT` - Bottom to Top
- `RL` - Right to Left

### Layout Engines
- `dot` - Hierarchical layout (default)
- `circo` - Circular layout
- `neato` - Spring model layout
- `fdp` - Force-directed layout
- `twopi` - Radial layout

## 🔧 Troubleshooting

### Graphviz Not Installed
If you see the warning about Graphviz not being installed:
1. The demo will still generate DOT files
2. Install Graphviz following the instructions above
3. Convert DOT files manually: `dot -Tpng input.dot -o output.png`

### Permission Errors
If you get permission errors when creating the output directory:
```bash
mkdir -p output
chmod 755 output
```

### Missing Dependencies
```bash
npm install
npm run build  # To check TypeScript compilation
```

## 📚 API Reference

### Main Functions

#### `generateAgentGraph(agents, options)`
Generates a visualization of one or more agents.

#### `generateToolGraph(tools, options)`
Generates a visualization of tools.

#### `generateRunnerGraph(config, options)`
Generates a visualization of the runner architecture.

#### `getGraphDot(agents, options)`
Returns the DOT source without generating an image.

#### `isGraphvizInstalled()`
Checks if Graphviz is installed on the system.

#### `validateGraphOptions(options)`
Validates graph generation options.

## 🎯 Use Cases

1. **Documentation** - Generate visual documentation of your agent architecture
2. **Debugging** - Visualize agent relationships and tool connections
3. **Presentations** - Create professional diagrams for presentations
4. **Architecture Planning** - Design and visualize complex agent systems
5. **Team Communication** - Share system design with team members

## 📄 License

MIT

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

---

**Note:** This demo is part of the Juspay Agent Framework (JAF). For more information about JAF, visit the [main repository](https://github.com/xynehq/jaf).