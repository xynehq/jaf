
# JAF Server Demo Visualization

## Generated Files
- graph.dot: Graphviz DOT file defining the agent architecture

## To Generate PNG (requires Graphviz installation):

### Install Graphviz:
- macOS: `brew install graphviz`
- Ubuntu: `sudo apt-get install graphviz`
- Windows: Download from https://graphviz.org/download/

### Generate PNG:
```bash
dot -Tpng graph.dot -o graph.png
```

### Alternative formats:
```bash
dot -Tsvg graph.dot -o graph.svg    # SVG format
dot -Tpdf graph.dot -o graph.pdf    # PDF format
```

## Graph Structure
The visualization shows:
- **3 Agents**: MathTutor, ChatBot, Assistant
- **2 Tools**: calculate, greet
- **Tool Relationships**: 
  - MathTutor → calculate
  - ChatBot → greet  
  - Assistant → calculate, greet
- **Modern Color Scheme**: Blue agents, pink tools
- **Clear Hierarchy**: Clustered layout for better organization

## Agent Details
- **MathTutor**: Specialized math tutor with calculator tool
- **ChatBot**: Social conversational agent with greeting tool
- **Assistant**: Multi-purpose agent with both tools
