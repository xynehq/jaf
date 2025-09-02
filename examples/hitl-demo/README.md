# JAF Human-in-the-Loop (HITL) Demo

This directory contains two demos showcasing JAF's Human-in-the-Loop capability:

## 1. Interactive Terminal Demo (`index.ts`)

- ✅ Interactive chat session in your terminal
- ✅ Tools requiring approval interrupt execution  
- ✅ Manual approval/rejection via keyboard input
- ✅ LLM remains completely unaware of the approval process
- ✅ Real-time tool execution after approval

## 2. API-Based Demo (`api-demo.ts`) 🆕

- ✅ Same interactive chat session PLUS HTTP API
- ✅ Approval via terminal OR curl commands
- ✅ RESTful endpoints for remote approval
- ✅ Real-time coordination between interfaces
- ✅ External system integration support

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

### Run the Demos

#### 🎯 Terminal Demo (Original)
```bash
pnpm run demo
```

This runs the interactive terminal demo where you can:
- Chat with the AI assistant in real-time
- See tool approval requests as they happen
- Manually approve or reject each tool call via keyboard
- Experience the complete HITL flow

#### 🌐 API Demo (New with curl support)
```bash
pnpm run demo:api
```

This runs both the terminal interface AND HTTP API server where you can:
- Chat normally in the terminal
- Approve/reject via terminal OR curl commands
- See real-time coordination between both interfaces
- Integrate with external systems

#### 📚 Alternative: Direct Execution
```bash
npx tsx examples/hitl-demo/index.ts        # Terminal only
npx tsx examples/hitl-demo/api-demo.ts     # Terminal + API
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

2. **Chat with the AI:**
   ```
   You: redirect me to the dashboard
   ```

3. **Check pending approvals via curl:**
   ```bash
   curl http://localhost:3001/pending
   ```

4. **Approve via curl:**
   ```bash
   curl -X POST http://localhost:3001/approve/api-demo/call_abc123
   ```

5. **Or reject with reason:**
   ```bash
   curl -X POST http://localhost:3001/reject/api-demo/call_abc123 \
        -H "Content-Type: application/json" \
        -d '{"reason": "Not authorized"}'
   ```

6. **Approve with additional context:**
   ```bash
   curl -X POST http://localhost:3001/approve/api-demo/call_abc123 \
        -H "Content-Type: application/json" \
        -d '{"additionalContext": {"priority": "high"}}'
   ```

### Configuration

Additional API demo configuration in `.env`:
```bash
API_PORT=3001  # Port for HTTP API server
```

## 🎯 What You'll See

### Interactive Demo Experience:
```
🚀 JAF Human-in-the-Loop Interactive Demo
============================================

This demo shows the HITL (Human-in-the-Loop) system where:
• Tools can require approval before execution
• You manually approve or reject tool calls
• LLM remains unaware of the approval process
• Frontend can provide additional context
• Everything happens through the same chat endpoint

Try these commands:
• "redirect me to the dashboard"
• "send my data to the team"
• "navigate to settings"
• Or ask anything else!

Commands: type "exit" to quit, "clear" to clear screen

You: redirect me to the dashboard
⏳ Processing...

🛑 APPROVAL REQUIRED

Tool: redirectUser
Arguments:
  url: /dashboard
  reason: User requested navigation to dashboard
Session ID: run-abc123

Do you approve this action? (y/n): y

✅ Approved! Providing additional context...

🔄 Executing redirect to: /dashboard
   Reason: User requested navigation to dashboard
   Previous screen: /home
   New screen context: { widgets: ['analytics', 'reports', 'settings'], userPermissions: ['read', 'write'] }

**What the demo demonstrates**:
1. ✅ **Tool Approval Mechanism**: System interrupts when `needsApproval: true`
2. ✅ **LLM Transparency**: LLM never sees approval process
3. ✅ **Additional Context**: Approval metadata flows to tool execution
4. ✅ **Production Ready**: Real LiteLLM integration with environment config
5. ✅ **Same Endpoint**: Single chat endpoint handles everything

### Interactive Demo Flow:
1. **Tool Execution Request**: LLM calls a tool that requires approval
2. **Interruption**: System pauses and asks for your approval
3. **User Input**: You choose to approve/reject
4. **Additional Context**: System simulates frontend providing extra data
5. **Completion**: Tool executes with enriched context, LLM sees final result

## 🔧 Key Features Demonstrated

### 1. Tool Approval Independence
The LLM simply calls tools normally. If a tool requires approval, the system interrupts execution and waits for user input, then resumes seamlessly.

### 2. Additional Context Support
When approving a tool call, the frontend can provide additional context that gets merged into the tool's execution context. For example:
- Redirect tools can receive updated screen data
- Data sending tools can receive encryption preferences
- Any tool can get user-specific context

### 3. Same Endpoint Flow
No separate approval endpoints - everything goes through the main chat endpoint:

```typescript
// Initial request
POST /chat
{
  "messages": [...],
  "agentName": "MyAgent"
}

// Response with interruption
{
  "outcome": {
    "status": "interrupted",
    "interruptions": [{ "type": "tool_approval", ... }]
  }
}

// Approval via same endpoint
POST /chat  
{
  "approval": {
    "sessionId": "run-123",
    "toolCallId": "call-456", 
    "approved": true,
    "additionalContext": { ... }
  }
}
```

## 🛠️ Demo Tools

### redirectUser
Simulates redirecting a user to a different screen. Requires approval and can receive updated screen context.

### sendSensitiveData  
Simulates sending sensitive data. Requires approval and can receive encryption preferences.

### performAction (in auto demo)
Simple action that requires approval and receives additional context.

## 📋 Implementation Details

The demo shows how the HITL system works at multiple levels:

1. **Tool Level**: Tools marked with `needsApproval: true`
2. **Engine Level**: Execution pauses and creates interruptions
3. **Server Level**: API returns interrupted status with session info
4. **Frontend Level**: User approves/rejects with optional context
5. **Resume Level**: Execution continues with enriched context

This approach ensures the LLM remains focused on the conversation flow while the system handles human oversight transparently.

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LITELLM_URL` | LiteLLM server URL | `http://localhost:4000` |
| `LITELLM_API_KEY` | LiteLLM API key | `sk-demo` |
| `LITELLM_MODEL` | Model to use | `gpt-3.5-turbo` |

### LiteLLM Setup

To use with a real LiteLLM server:

1. Start your LiteLLM server:
```bash
litellm --config config.yaml --port 4000
```

2. Configure the demo:
```bash
export LITELLM_URL=http://localhost:4000
export LITELLM_API_KEY=your-api-key
export LITELLM_MODEL=gpt-3.5-turbo
```

3. Run the demo:
```bash
pnpm run demo
```

## 🐛 Troubleshooting

### Connection Errors
If you see "Connection error" with LiteLLM:
- Ensure your LiteLLM server is running
- Check the URL and API key are correct
- Verify your .env file is properly configured

### TypeScript Errors
If you get compilation errors:
```bash
# Install dependencies
pnpm install

# Run from JAF root directory
cd /path/to/jaf
pnpm run demo
```