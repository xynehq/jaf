# JAF New Features Documentation

This document covers all the recent enhancements and new features added to the Juspay Agent Framework (JAF).

## Table of Contents

1. [Multi-Agent Coordination](#multi-agent-coordination)
2. [Enhanced Schema Validation](#enhanced-schema-validation)
3. [Visualization System Updates](#visualization-system-updates)
4. [Model Enum System](#model-enum-system)

## Multi-Agent Coordination

### Intelligent Agent Selection

The framework now includes automatic intelligent agent selection when using the `conditional` delegation strategy. This feature eliminates the need for explicit routing logic in many cases.

#### How It Works

1. **Keyword Extraction**: The system extracts meaningful keywords from the user's message, filtering out common words
2. **Agent Scoring**: Each sub-agent is scored based on keyword matches:
   - Agent name matches: +3 points
   - Instruction text matches: +2 points
   - Tool name matches: +2 points
   - Tool description matches: +1 point
3. **Selection**: The highest-scoring agent is automatically selected

#### Implementation Example

```typescript
import { createMultiAgent } from 'jaf/adk';

const smartCoordinator = createMultiAgent(
  'coordinator',
  'gpt-4',
  'Route requests to the most appropriate specialist',
  [
    {
      name: 'weather_specialist',
      instruction: 'Provide weather forecasts and climate information',
      tools: [weatherTool]
    },
    {
      name: 'news_analyst',
      instruction: 'Analyze and summarize news articles',
      tools: [newsTool]
    },
    {
      name: 'calculator',
      instruction: 'Perform mathematical calculations',
      tools: [calculatorTool]
    }
  ],
  'conditional' // Enables intelligent selection
);

// User says: "What's the weather forecast for tomorrow?"
// System automatically selects 'weather_specialist' (high keyword match)
```

### Parallel Response Merging

The parallel execution strategy now intelligently merges responses from multiple agents, preserving each agent's contribution while creating a cohesive output.

#### Merging Features

- **Agent Identification**: Each response part is prefixed with the agent's name
- **Artifact Namespacing**: Artifacts are prefixed with agent names to avoid conflicts
- **Complete Context**: All tool calls and responses from all agents are preserved

#### Example Output

```typescript
// User: "Research AI trends and market analysis"
// Parallel execution with 3 agents

// Merged response:
{
  content: {
    parts: [
      { text: "[research_agent]: Latest AI trends include..." },
      { text: "[market_analyst]: Market cap has grown by..." },
      { text: "[data_collector]: Key statistics show..." }
    ]
  },
  artifacts: {
    "research_agent_trends": { /* trend data */ },
    "market_analyst_report": { /* market data */ },
    "data_collector_stats": { /* statistics */ }
  }
}
```

### Coordination Rules

Define custom rules for sophisticated multi-agent orchestration:

```typescript
const advancedCoordinator = {
  name: 'orchestrator',
  subAgents: [urgentAgent, analysisAgent, reportAgent],
  delegationStrategy: 'conditional',
  coordinationRules: [
    {
      // Urgent requests trigger parallel execution
      condition: (message, context) => 
        message.parts.some(p => p.text?.toLowerCase().includes('urgent')),
      action: 'parallel',
      targetAgents: ['urgentAgent', 'analysisAgent']
    },
    {
      // Analysis requests go to specialist
      condition: (message, context) => 
        message.parts.some(p => p.text?.match(/analyz|assess|evaluat/i)),
      action: 'delegate',
      targetAgents: ['analysisAgent']
    },
    {
      // Reports follow sequential pipeline
      condition: (message, context) => 
        message.parts.some(p => p.text?.includes('report')),
      action: 'sequential',
      targetAgents: ['analysisAgent', 'reportAgent']
    }
  ]
};
```

## Enhanced Schema Validation

The schema validation system now supports comprehensive JSON Schema Draft 7 features.

### String Format Validation

Support for standard format validation:

```typescript
// Email validation
const emailSchema = stringSchema({ 
  format: 'email',
  minLength: 5,
  maxLength: 255 
});

// URL validation  
const urlSchema = stringSchema({ 
  format: 'uri',
  pattern: '^https://' // HTTPS only
});

// Date/Time validation
const dateSchema = stringSchema({ format: 'date' });      // YYYY-MM-DD
const dateTimeSchema = stringSchema({ format: 'date-time' }); // ISO 8601

// UUID validation
const uuidSchema = stringSchema({ format: 'uuid' });

// IP Address validation
const ipv4Schema = stringSchema({ format: 'ipv4' });
const ipv6Schema = stringSchema({ format: 'ipv6' });
```

### Number Validation Features

Advanced number constraints:

```typescript
// Integer validation
const ageSchema = numberSchema({
  minimum: 0,
  maximum: 150,
  integer: true // Must be whole number
});

// Currency validation
const priceSchema = numberSchema({
  minimum: 0,
  exclusiveMinimum: true,  // > 0, not >= 0
  multipleOf: 0.01         // Two decimal places
});

// Percentage validation
const percentSchema = numberSchema({
  minimum: 0,
  maximum: 100,
  multipleOf: 0.1
});
```

### Array Validation

Comprehensive array constraints:

```typescript
// Unique items with deep equality
const tagsSchema = arraySchema(stringSchema(), {
  minItems: 1,
  maxItems: 10,
  uniqueItems: true // Deep equality check for objects
});

// Nested arrays
const matrixSchema = arraySchema(
  arraySchema(numberSchema()),
  {
    minItems: 2,
    maxItems: 10
  }
);
```

### Object Validation

Enhanced object property validation:

```typescript
const userSchema = objectSchema(
  {
    id: stringSchema({ format: 'uuid' }),
    email: stringSchema({ format: 'email' }),
    age: numberSchema({ minimum: 0, integer: true }),
    tags: arraySchema(stringSchema(), { uniqueItems: true })
  },
  ['id', 'email'], // Required fields
  {
    minProperties: 2,
    maxProperties: 20,
    additionalProperties: false // Strict mode
  }
);
```

### Boolean Validation

Exact value matching:

```typescript
const acceptedSchema = booleanSchema({ const: true });
const featureFlagSchema = booleanSchema();
```

## Visualization System Updates

### DOT Generation Approach

The visualization system now generates DOT content directly, providing better reliability:

```typescript
import { generateAgentGraph } from 'jaf/visualization';

const result = await generateAgentGraph(agents, {
  title: 'System Architecture',
  outputFormat: 'png',
  colorScheme: 'modern'
});

// Always has DOT content
if (result.graphDot) {
  if (result.success) {
    console.log(`Generated: ${result.outputPath}`);
  } else {
    // Fallback: save DOT for manual processing
    writeFileSync('graph.dot', result.graphDot);
    // Process: dot -Tpng graph.dot -o graph.png
  }
}
```

### Color Schemes

Three built-in professional color schemes:

#### Default Scheme
- **Agents**: Light blue (#E3F2FD) with blue text (#1976D2)
- **Tools**: Light purple (#F3E5F5) with purple text (#7B1FA2)
- **Sub-agents**: Light green (#E8F5E8) with green text (#388E3C)

#### Modern Scheme
- **Agents**: Blue gradient (#667eea) with white text
- **Tools**: Pink gradient (#f093fb) with white text
- **Sub-agents**: Light blue (#4facfe) with white text

#### Minimal Scheme
- **All elements**: Black and white with clean borders
- **Tools**: Light gray background (#f5f5f5)
- **Focus on structure over color**

### Visualization Examples

The new visualization demo (`/examples/visualization-demo/`) showcases:
- Agent hierarchy visualization
- Tool network graphs
- Runner architecture diagrams
- All three color schemes
- Interactive generation options

## Model Enum System

### Comprehensive Model Support

The framework now includes an enum with 300+ model identifiers:

```typescript
import { Model } from 'jaf/adk';

// OpenAI Models
Model.GPT_4 = 'gpt-4';
Model.GPT_4O = 'gpt-4o';
Model.GPT_4_TURBO = 'gpt-4-turbo';

// Anthropic Models
Model.CLAUDE_3_OPUS_20240229 = 'claude-3-opus-20240229';
Model.CLAUDE_3_5_SONNET_20241022 = 'claude-3.5-sonnet-20241022';

// Google Models
Model.GEMINI_2_0_FLASH_EXP = 'gemini-2.0-flash-exp';
Model.GEMINI_PRO = 'gemini-pro';

// And 300+ more models...
```

### Model Validation

Helper functions for model validation:

```typescript
import { isValidModel, getModelProvider } from 'jaf/adk';

// Validate model
if (isValidModel('gpt-4')) {
  // Valid model
}

// Get provider
const provider = getModelProvider(Model.CLAUDE_3_OPUS);
// Returns: 'anthropic'
```

### Model Categories

Models are organized by provider:
- **OpenAI**: GPT-4, GPT-3.5, embeddings
- **Anthropic**: Claude 3 family
- **Google**: Gemini, PaLM
- **Meta**: Llama models
- **Mistral**: Mistral and Mixtral
- **Cohere**: Command and embedding models
- **Others**: 50+ additional providers

## Migration Guide

### Upgrading Multi-Agent Systems

```typescript
// Old approach (manual routing)
const oldCoordinator = {
  name: 'coordinator',
  instruction: 'Manually check keywords and route',
  tools: [routingTool] // Custom routing logic
};

// New approach (automatic routing)
const newCoordinator = createMultiAgent(
  'coordinator',
  'gpt-4',
  'Automatically route to best specialist',
  [weatherAgent, newsAgent],
  'conditional' // Automatic intelligent selection
);
```

### Upgrading Schema Validation

```typescript
// Old validation (basic)
const oldSchema = {
  type: 'string',
  minLength: 1
};

// New validation (comprehensive)
const newSchema = stringSchema({
  minLength: 1,
  maxLength: 100,
  pattern: '^[A-Z]',
  format: 'email'
});
```

### Upgrading Visualization

```typescript
// Old approach (npm graphviz package)
const graph = new Graphviz.Graph();
// ... complex setup

// New approach (DOT generation)
const result = await generateAgentGraph(agents, {
  colorScheme: 'modern'
});
```

## Best Practices

### Multi-Agent Design

1. **Use Conditional for Smart Routing**: Let the framework handle agent selection
2. **Use Parallel for Independent Tasks**: Merge results automatically
3. **Use Sequential for Pipelines**: Chain agent outputs naturally
4. **Define Rules for Complex Logic**: Override automatic behavior when needed

### Schema Validation

1. **Always Validate Inputs**: Use schema validation for all agent inputs
2. **Use Format Validators**: Leverage built-in format validators for common types
3. **Set Reasonable Limits**: Use min/max constraints to prevent abuse
4. **Enable Strict Mode**: Use `additionalProperties: false` for strict validation

### Visualization

1. **Generate Documentation**: Create visual documentation for your agent systems
2. **Use Modern Scheme for Presentations**: Best for slides and demos
3. **Use Minimal Scheme for Documentation**: Best for technical docs
4. **Save DOT Files**: Keep DOT files for version control and manual tweaking

## Performance Considerations

### Multi-Agent Optimization

- **Intelligent Selection**: ~10ms overhead for keyword extraction and scoring
- **Parallel Execution**: Limited by slowest agent in the group
- **Response Merging**: Minimal overhead (<5ms for typical responses)

### Schema Validation Performance

- **String Format**: Email/URL validation adds ~1ms
- **Array Uniqueness**: O(n²) for deep equality checking
- **Object Validation**: Linear with property count

### Visualization Performance

- **DOT Generation**: <100ms for typical agent systems
- **PNG Rendering**: 200-500ms depending on graph complexity
- **Large Graphs**: Consider disabling tool details for 50+ tools

## Troubleshooting

### Multi-Agent Issues

**Problem**: Wrong agent selected
**Solution**: Add more specific keywords to agent names/instructions

**Problem**: Parallel responses not merging correctly
**Solution**: Check that all agents return compatible response formats

### Schema Validation Issues

**Problem**: Format validation too strict
**Solution**: Use pattern instead of format for custom validation

**Problem**: Deep equality too slow
**Solution**: Consider using simple equality for primitive arrays

### Visualization Issues

**Problem**: Graphviz not installed
**Solution**: Install system Graphviz or use DOT output directly

**Problem**: Large graphs timeout
**Solution**: Reduce details with `showToolDetails: false`

## Future Enhancements

### Planned Features

1. **Adaptive Agent Selection**: Learn from usage patterns
2. **Schema Composition**: Support for $ref and definitions
3. **Visualization Themes**: Additional color schemes and layouts
4. **Model Cost Optimization**: Automatic model selection based on task complexity

### Under Consideration

1. **Agent Metrics Dashboard**: Real-time agent performance monitoring
2. **Schema Migration Tools**: Automated schema version migration
3. **Interactive Visualizations**: Web-based graph exploration
4. **Model Fine-tuning Integration**: Custom model management

---

For more information, see:
- [API Reference](./api-reference.md)
- [ADK Layer Documentation](./adk-layer.md)
- [Examples Guide](./examples.md)
- [Visualization Guide](./visualization.md)