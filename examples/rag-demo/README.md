# FAF Vertex AI RAG Demo

This demo showcases the integration of **Vertex AI RAG (Retrieval Augmented Generation)** with the **Functional Agent Framework (FAF)**. It demonstrates how to build AI agents that can query knowledge bases and provide grounded, source-cited responses.

## 🎯 Features Demonstrated

- **Real Vertex AI RAG Integration**: Uses Google's @google/genai SDK
- **Streaming Responses**: Real-time streaming from Vertex AI
- **Source Attribution**: Automatic grounding and citation of sources
- **Performance Metrics**: Detailed timing and performance tracking
- **Permission Control**: Role-based access to RAG functionality
- **Error Handling**: Comprehensive error management
- **FAF Integration**: Full framework orchestration

## 🛠️ Setup Requirements

### 1. Install Dependencies

```bash
# In the rag-demo directory
npm install
```

### 2. Environment Configuration

```bash
# Copy the example environment file
cp .env.example .env

# Edit the .env file with your configuration
nano .env
```

Required environment variables:
- `GOOGLE_CLOUD_PROJECT`: Your Google Cloud project ID
- `LITELLM_URL`: Your LiteLLM proxy endpoint
- `LITELLM_API_KEY`: Your LiteLLM API key (must start with 'sk-')
- `RAG_CORPUS_ID`: Your Vertex AI RAG corpus ID

Important model configuration:
- `LITELLM_MODEL`: The model name available in your LiteLLM proxy (e.g., 'gemini-2.5-flash-lite')
- `RAG_MODEL`: The Vertex AI model for RAG queries (e.g., 'gemini-2.0-flash-exp')

### 3. Google Cloud Authentication

```bash
# Install Google Cloud CLI if not already installed
# https://cloud.google.com/sdk/docs/install

# Authenticate with Google Cloud with additional scopes for Vertex AI
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/generative-language.retriever

# Alternative: Authenticate with all scopes
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform

# Set your project (replace with your actual project ID)
export GOOGLE_CLOUD_PROJECT="genius-dev-393512"
```

### 4. Install Google GenAI SDK

This is already included in package.json dependencies.

## 🚀 Running the Demo

```bash
# Make sure you have your .env file configured
cp .env.example .env
# Edit .env with your actual values

# Run the demo
npm run dev

# Or with TypeScript compilation
npm run build
npm start
```

## 📁 Project Structure

```
rag-demo/
├── index.ts          # Main demo application
├── rag-agent.ts      # RAG-enabled agent definition
├── rag-tool.ts       # Vertex AI RAG tool implementation
├── package.json      # Dependencies and scripts
├── tsconfig.json     # TypeScript configuration
├── .env.example      # Environment variables template
├── .gitignore        # Git ignore file
└── README.md         # This file
```

## 🔧 Configuration

### RAG Corpus Configuration

The demo is configured to use a specific RAG corpus:

```typescript
rag_corpus: "projects/genius-dev-393512/locations/us-central1/ragCorpora/2305843009213693952"
```

**To use your own RAG corpus:**

1. Create a RAG corpus in Vertex AI
2. Update the `rag_corpus` value in `rag-tool.ts`
3. Ensure your Google Cloud project has access to the corpus

### Model Configuration

Default model: `gemini-2.5-flash-lite-preview-06-17`

You can modify the model in `rag-tool.ts`:

```typescript
const model = "your-preferred-model";
```

## 🎮 Demo Scenarios

The demo runs 4 different queries to showcase RAG capabilities:

1. **AI Developments**: "What are the latest developments in artificial intelligence?"
2. **Machine Learning**: "Explain the concept of machine learning and its applications"
3. **Software Development**: "What are the best practices for software development?"
4. **Cloud Computing**: "How does cloud computing work and what are its benefits?"

Each query demonstrates:
- RAG corpus retrieval
- Streaming response generation
- Source attribution
- Performance metrics
- Error handling

## 📊 Sample Output

```
🔍 FAF Vertex AI RAG Demo
========================

📋 Demo Query 1: "What are the latest developments in artificial intelligence?"
==================================================

[RAG] Initializing Vertex AI client...
[RAG] Client initialized in 0.123s
[RAG] Querying RAG corpus with query: "What are the latest developments in artificial intelligence?"
[RAG] Retrieving top 20 similar documents
[RAG] Query completed in 2.456s, 15 chunks, 1247 chars

✅ RAG Query Completed Successfully!

📝 Response:
**RAG Query Results**

**Query:** What are the latest developments in artificial intelligence?
**Model:** gemini-2.5-flash-lite-preview-06-17

**Response:**
Based on the retrieved documents, the latest developments in artificial intelligence include...

**Sources:**
1. https://docs.example.com/ai-developments-2024
2. https://research.example.com/ai-trends-report
3. https://wiki.example.com/artificial-intelligence

**Performance Metrics:**
- Total execution time: 2.456s
- Time to first chunk: 0.234s
- Chunks received: 15
- Response length: 1247 characters
- Average chars/second: 507.3
```

## 🔒 Security Features

- **Permission-based Access**: Requires `rag_access` permission
- **Input Validation**: Zod schema validation for all parameters
- **Error Isolation**: Comprehensive error handling and reporting
- **Authentication Check**: Validates Google Cloud authentication

## 🐛 Troubleshooting

### LiteLLM API Key Issues

If you see "401 Authentication Error, LiteLLM Virtual Key expected":

```bash
# Make sure your .env file has a valid API key
LITELLM_API_KEY=sk-your-actual-api-key-here

# The API key must start with 'sk-'
# Get your API key from your LiteLLM provider or dashboard
```

### Model Availability Issues

If you see "Invalid model name passed in model=gpt-4o":

```bash
# Check available models in your LiteLLM proxy
curl http://localhost:4000/v1/models

# Update your .env file with the correct model name
LITELLM_MODEL=gemini-2.5-flash-lite

# Make sure the model name matches exactly what's available in your proxy
```

### Authentication Issues

```bash
# Check current authentication
gcloud auth list

# Re-authenticate if needed
gcloud auth application-default login

# Verify project access
gcloud projects describe your-project-id
```

### Permission Errors

Ensure your Google Cloud account has:
- Vertex AI User role
- Access to the specified RAG corpus
- GenerativeAI permissions

### SDK Issues

```bash
# Ensure latest SDK version
npm update @google/genai

# Check Node.js version (requires Node 18+)
node --version
```

## 🎯 Integration Points

This demo shows how FAF integrates with external services:

1. **Tool Definition**: Type-safe tool schemas with Zod
2. **Permission System**: Role-based access control
3. **Error Handling**: Structured error responses
4. **Tracing**: Real-time observability
5. **Agent Orchestration**: Multi-turn conversations
6. **Stream Processing**: Real-time response handling

## 🚀 Next Steps

- **Custom RAG Corpus**: Set up your own knowledge base
- **Multi-Agent RAG**: Combine RAG with other specialized agents
- **Advanced Retrieval**: Experiment with different similarity thresholds
- **Production Deployment**: Scale with real LLM providers
- **Custom Grounding**: Implement domain-specific source attribution

## 📚 Related Documentation

- [FAF Framework Documentation](../../README.md)
- [Google GenAI SDK](https://github.com/google/genai-js)
- [Vertex AI RAG Documentation](https://cloud.google.com/vertex-ai/docs/rag)
- [Google Cloud Authentication](https://cloud.google.com/docs/authentication)

---

**Ready to explore AI agents with real knowledge retrieval!** 🎯