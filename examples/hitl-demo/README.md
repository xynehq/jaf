# JAF Human-in-the-Loop (HITL) Demo

This directory contains a comprehensive demo showcasing JAF's Human-in-the-Loop capability with file system operations:

## File System HITL Demo (`index.ts`)

- **Safe Operations**: `listFiles`, `readFile` (no approval needed)
- **Dangerous Operations**: `deleteFile`, `editFile` (require approval)
- **Memory Provider Integration**: Uses environment-configured memory providers (Redis/PostgreSQL/in-memory)
- **Persistent Approval Storage**: Approval decisions stored in memory provider (survives restarts)
- **Conversation Continuity**: Resume interrupted conversations from exact point with approval context
- **Complete Status Tracking**: Full tool execution lifecycle (`halted` → `approved_and_executed`/`approval_denied`)
- **LLM Isolation**: Approval workflow invisible to LLM - no hallucinations
- **Audit Trail**: Complete approval history with timestamps and context
- **Recursive Pattern**: No while loops, follows JAF conversation patterns
- **Sandboxed Environment**: Secure file operations within demo directory

## 🚀 Quick Start

### Prerequisites

1. **JAF Root Directory**: Make sure you're in the JAF root directory:
```bash
cd /path/to/jaf
```

2. **LiteLLM Configuration** (Recommended): 
```bash
# Copy and configure environment
cp examples/hitl-demo/.env.example examples/hitl-demo/.env
# Edit .env with your LiteLLM settings
```

Example `.env`:
```bash
LITELLM_URL=http://localhost:4000
LITELLM_API_KEY=YOUR_API_KEY  
LITELLM_MODEL=gpt-3.5-turbo
```

3. **Configuration Required**:
   - **LiteLLM Setup**: Set up your LiteLLM server and configure the environment variables

### Run the Demo

#### 🗂️ File System HITL Demo
```bash
pnpm run demo
```

This runs the interactive file system demo where you can:
- Chat with the AI assistant about file operations
- Perform safe operations (list, read) immediately
- Get approval prompts for dangerous operations (delete, edit)
- See approval context flow to tool execution
- Experience persistent approval storage across sessions

#### 📚 Alternative: Direct Execution
```bash
npx tsx examples/hitl-demo/index.ts
```

## 🌐 API Demo Usage

When running `pnpm run demo:api`, you get both terminal interaction AND HTTP endpoints:

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/pending` | List all pending tool approvals |
| `POST` | `/approve/:sessionId/:toolCallId` | Approve a specific tool call |
| `POST` | `/reject/:sessionId/:toolCallId` | Reject a specific tool call |
| `GET` | `/health` | Health check and pending count |

### Example Workflow

1. **Start the API demo:**
   ```bash
   pnpm run demo:api
   ```
2. **Check pending approvals via curl:**
   ```bash
   curl http://localhost:3001/pending
   ```

3. **Approve via curl (simple):**
   ```bash
   curl -X POST http://localhost:3001/approve/SESSION_ID/TOOL_CALL_ID
   ```

4. **Approve with additional context:**
   ```bash
   curl -X POST http://localhost:3001/approve/SESSION_ID/TOOL_CALL_ID \
        -H "Content-Type: application/json" \
        -d '{
          "additionalContext": {
            "message": "your-additional-context"
          }
        }'
   ```

5. **Reject via curl (simple):**
   ```bash
   curl -X POST http://localhost:3001/reject/SESSION_ID/TOOL_CALL_ID
   ```

6. **Reject with additional context:**
   ```bash
   curl -X POST http://localhost:3001/reject/SESSION_ID/TOOL_CALL_ID \
        -H "Content-Type: application/json" \
        -d '{
          "additionalContext": {
            "message": "your-additional-context"
          }
        }'
   ```

### Configuration

Additional API demo configuration in `.env`:
```bash
API_PORT=3001  # Port for HTTP API server
```