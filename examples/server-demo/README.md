# FAF Development Server Demo

This example demonstrates how to use the `runServer` function to create a local development server for testing your agents via HTTP endpoints.

## 🎯 Features Demonstrated

- **Multiple Agent Types**: Math tutor, chatbot, and general assistant
- **RESTful API**: Standard HTTP endpoints for agent interaction
- **Tool Integration**: Calculator and greeting tools
- **Type Safety**: Full TypeScript support with validation
- **Real-time Tracing**: Console-based observability
- **CORS Support**: Cross-origin requests enabled
- **Graceful Shutdown**: Proper cleanup on exit
- **Memory Providers**: In-memory, Redis, and PostgreSQL conversation persistence
- **Environment Configuration**: Configurable memory providers via environment variables

## 🛠️ Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

```bash
# Copy the example environment file
cp .env.example .env

# Edit with your LiteLLM configuration
nano .env
```

Required environment variables:
- `LITELLM_URL`: Your LiteLLM proxy endpoint (e.g., `http://localhost:4000`)
- `LITELLM_API_KEY`: Your LiteLLM API key (optional, depending on your setup)

Optional environment variables:
- `LITELLM_MODEL`: Model to use (default: `gpt-3.5-turbo`)
- `PORT`: Server port (default: `3000`)
- `FAF_MEMORY_TYPE`: Memory provider type (`memory`, `redis`, `postgres`)

### 3. Start LiteLLM Proxy (if needed)

If you don't have a LiteLLM proxy running:

```bash
# Install LiteLLM
pip install litellm

# Start proxy (example with OpenAI)
litellm --model gpt-3.5-turbo --port 4000
```

## 💾 Memory Providers

The server supports three types of memory providers for conversation persistence:

### In-Memory (Default)
- **Best for**: Development, testing, single-instance deployments
- **Persistence**: Lost on server restart
- **Configuration**: No additional setup required

```bash
FAF_MEMORY_TYPE=memory
FAF_MEMORY_MAX_CONVERSATIONS=1000
FAF_MEMORY_MAX_MESSAGES=1000
```

### Redis
- **Best for**: Production, distributed deployments, caching
- **Persistence**: Persistent across server restarts
- **Requirements**: Redis server running

```bash
# Install Redis client (already included as optional dependency)
npm install redis

# Environment configuration
FAF_MEMORY_TYPE=redis
FAF_REDIS_HOST=localhost
FAF_REDIS_PORT=6379
FAF_REDIS_PASSWORD=your-password
FAF_REDIS_DB=0
FAF_REDIS_PREFIX=faf:memory:
FAF_REDIS_TTL=86400

# Or use Redis URL
FAF_REDIS_URL=redis://username:password@localhost:6379/0
```

Start Redis server:
```bash
# Using Docker
docker run -d -p 6379:6379 redis:alpine

# Or install locally (macOS)
brew install redis
brew services start redis

# Or install locally (Ubuntu)
sudo apt install redis-server
sudo systemctl start redis-server
```

### PostgreSQL
- **Best for**: Production, complex queries, full persistence
- **Persistence**: Fully persistent with advanced querying
- **Requirements**: PostgreSQL server running

```bash
# Install PostgreSQL client (already included as optional dependency)
npm install pg @types/pg

# Environment configuration
FAF_MEMORY_TYPE=postgres
FAF_POSTGRES_HOST=localhost
FAF_POSTGRES_PORT=5432
FAF_POSTGRES_DB=faf_memory
FAF_POSTGRES_USER=postgres
FAF_POSTGRES_PASSWORD=your-password
FAF_POSTGRES_SSL=false
FAF_POSTGRES_TABLE=conversations

# Or use connection string
FAF_POSTGRES_CONNECTION_STRING=postgresql://username:password@localhost:5432/faf_memory
```

Start PostgreSQL server:
```bash
# Using Docker
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password -e POSTGRES_DB=faf_memory postgres:15

# Or install locally (macOS)
brew install postgresql
brew services start postgresql
createdb faf_memory

# Or install locally (Ubuntu)
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo -u postgres createdb faf_memory
```

## 🚀 Running the Server

```bash
npm run dev
```

The server will start on `http://localhost:3000` with the following endpoints:

- `GET /health` - Health check
- `GET /agents` - List available agents
- `POST /chat` - General chat endpoint
- `POST /agents/{agentName}/chat` - Agent-specific chat endpoint
- `GET /memory/health` - Memory provider health check
- `GET /conversations/:id` - Get conversation by ID
- `DELETE /conversations/:id` - Delete conversation by ID

## 📡 API Usage Examples

### Health Check

```bash
curl http://localhost:3000/health
```

### List Available Agents

```bash
curl http://localhost:3000/agents
```

### Chat with Math Tutor

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "What is 15 * 7?"}
    ],
    "agentName": "MathTutor",
    "context": {
      "userId": "demo",
      "permissions": ["user"]
    }
  }'
```

### Chat with ChatBot (Agent-specific endpoint)

```bash
curl -X POST http://localhost:3000/agents/ChatBot/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hi, my name is Alice"}
    ],
    "context": {
      "userId": "demo", 
      "permissions": ["user"]
    }
  }'
```

### Multi-tool Assistant

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Calculate 25 + 17 and then greet me as Bob"}
    ],
    "agentName": "Assistant",
    "context": {
      "userId": "demo",
      "permissions": ["user"]
    },
    "maxTurns": 3
  }'
```

### Conversation Persistence

```bash
# Start a conversation (get conversationId from response)
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is 15 * 7?"}],
    "conversationId": "my-conversation-1",
    "agentName": "MathTutor",
    "context": {"userId": "demo", "permissions": ["user"]}
  }'

# Continue the conversation
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What was my previous calculation?"}],
    "conversationId": "my-conversation-1", 
    "agentName": "MathTutor",
    "context": {"userId": "demo", "permissions": ["user"]}
  }'
```

### Memory Management

```bash
# Check memory provider health
curl http://localhost:3000/memory/health

# Get conversation history
curl http://localhost:3000/conversations/my-conversation-1

# Delete conversation
curl -X DELETE http://localhost:3000/conversations/my-conversation-1
```

## 🏗️ Code Structure

```
server-demo/
├── index.ts          # Main server setup and agent definitions
├── package.json      # Dependencies and scripts
├── tsconfig.json     # TypeScript configuration
├── .env.example      # Environment variables template
└── README.md         # This file
```

## 🤖 Available Agents

### MathTutor
- **Purpose**: Math calculations and tutoring
- **Tools**: Calculator tool
- **Example**: "What is 15 * 7?"

### ChatBot
- **Purpose**: Friendly conversation and greetings
- **Tools**: Greeting tool
- **Example**: "Hi, my name is Alice"

### Assistant
- **Purpose**: General-purpose assistance
- **Tools**: Calculator + Greeting tools
- **Example**: "Calculate 25 + 17 and greet me as Bob"

## 📊 Response Format

All endpoints return JSON responses in this format:

```typescript
{
  "success": boolean,
  "data": {
    "runId": string,
    "traceId": string,
    "conversationId": string,  // For conversation persistence
    "messages": Array<{role: string, content: string}>,
    "outcome": {
      "status": "completed" | "error" | "max_turns",
      "output": string
    },
    "turnCount": number,
    "executionTimeMs": number
  },
  "error": string?
}
```

## 🎨 Visualization

The server demo includes agent and tool visualization capabilities to help understand the architecture.

### Generate Architecture Graph

The project includes scripts to generate visual representations of the agent architecture:

```bash
# Generate graph definition
npx tsx generate-graph.ts

# This creates:
# - graph.dot (Graphviz definition file)
# - README-visualization.md (instructions)
```

### Install Graphviz for PNG Generation

To generate PNG/SVG/PDF from the graph definition:

```bash
# macOS
brew install graphviz

# Ubuntu/Debian
sudo apt-get install graphviz

# Windows
# Download from: https://graphviz.org/download/
```

### Generate Visual Formats

```bash
# Generate PNG image
dot -Tpng graph.dot -o graph.png

# Generate SVG (scalable)
dot -Tsvg graph.dot -o graph.svg

# Generate PDF
dot -Tpdf graph.dot -o graph.pdf
```

### What the Visualization Shows

The generated graph displays:
- **3 Agents**: MathTutor, ChatBot, Assistant (blue boxes)
- **2 Tools**: calculate, greet (pink ellipses)
- **Relationships**: Dashed lines showing which agents use which tools
- **Organization**: Clustered layout with modern color scheme

This visual representation helps understand:
- Agent specializations and capabilities
- Tool sharing between agents
- Overall system architecture
- Multi-agent relationships

## 🔧 Customization

### Adding New Tools

```typescript
const myTool: Tool<{ input: string }, MyContext> = {
  schema: {
    name: "my_tool",
    description: "Description of what this tool does",
    parameters: z.object({
      input: z.string().describe("Input parameter")
    }),
  },
  execute: async (args, context) => {
    // Tool implementation
    return "Tool result";
  },
};
```

### Adding New Agents

```typescript
const myAgent: Agent<MyContext, string> = {
  name: 'MyAgent',
  instructions: 'You are a specialized agent that...',
  tools: [myTool],
};

// Add to the agents array when calling runServer
const server = await runServer([mathAgent, chatAgent, myAgent], runConfig, serverOptions);
```

### Custom Server Configuration

```typescript
const server = await runServer(
  agents,
  runConfig,
  {
    port: 8080,
    host: '127.0.0.1',
    cors: false  // Disable CORS if needed
  }
);
```

## 🐛 Troubleshooting

### LiteLLM Connection Issues

If you see connection errors:

1. Ensure LiteLLM proxy is running on the specified URL
2. Check that the API key is correct (if required)
3. Verify the model name is available in your LiteLLM setup

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill the process if needed
kill -9 <PID>

# Or use a different port
PORT=3001 npm run dev
```

### Agent Not Found Errors

Ensure the `agentName` in your request exactly matches the agent name defined in the code.

## 🔗 Integration with Frontend

This server can be easily integrated with any frontend framework:

### JavaScript/Fetch

```javascript
const response = await fetch('http://localhost:3000/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Hello!' }],
    agentName: 'ChatBot',
    context: { userId: 'web-user', permissions: ['user'] }
  })
});

const result = await response.json();
console.log(result.data.outcome.output);
```

### React Hook

```tsx
const useFAFAgent = (agentName: string) => {
  const [loading, setLoading] = useState(false);
  
  const chat = async (message: string) => {
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:3000/agents/${agentName}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: message }],
          context: { userId: 'react-user', permissions: ['user'] }
        })
      });
      
      const result = await response.json();
      return result.data?.outcome?.output;
    } finally {
      setLoading(false);
    }
  };
  
  return { chat, loading };
};
```

---

**Ready to build and test your agents locally!** 🚀