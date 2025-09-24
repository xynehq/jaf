# JAF CI/CD Pipeline Demo

A JAF implementation of your CI/CD pipeline that mirrors the Mermaid diagram workflow:

```
🟢 CODEGEN PIPELINE → 🟠 BUILD & ART PIPELINE → 🟣 EVALUATION & ENHANCEMENT PIPELINE
```

## Architecture

This implementation uses JAF's multi-agent system to orchestrate your existing Python/Jenkins pipeline:

### Agents

1. **🎯 PipelineOrchestrator** - Routes requests and coordinates pipeline flow
2. **🟢 CodegenAgent** - Handles UCS/Euler code generation using Xyne
3. **🟠 BuildARTAgent** - Manages Jenkins jobs and artifact downloads  
4. **🟣 EvaluationAgent** - Analyzes ART reports and enhances prompts

### Tools

**Codegen Tools:**
- `select_connector` - Choose target connector
- `generate_migration_files` - Your existing `generate_prompt.py` integration
- `execute_xyne_command` - Run Xyne with build validation
- `validate_build` - Cargo/Nix build validation with auto-fix
- `commit_and_push` - Git operations

**Build/ART Tools:**
- `trigger_jenkins_job` - Jenkins API integration
- `monitor_build_status` - Build progress monitoring
- `download_artifacts` - Fetch ART reports
- `send_slack_notification` - Slack integration

**Evaluation Tools:**
- `parse_art_report` - ART report analysis
- `analyze_art_issues` - Issue categorization
- `generate_enhanced_prompts` - Create improved prompts
- `save_enhanced_prompts` - Persist learnings

## Usage

### 1. Installation

```bash
cd examples/pipeline-demo
npm install
```

### 2. Configuration

Set environment variables or update `CONFIG` in `index.ts`:

```bash
export LITE_LLM_URL="https://grid.ai.juspay.net"
export LITE_LLM_API_KEY="sk-af-K9l7Uvi1EN7ceeo_oiw"
export LITE_LLM_MODEL="glm-45-fp8"
```

### 3. Running the Pipeline

#### Single Migration
```bash
# Migrate a single connector
node index.ts payu
```

#### Interactive Mode
```bash
# Start interactive CLI
node index.ts --interactive

# Commands available:
jaf-pipeline> migrate payu
jaf-pipeline> art easebuzz 20250902-155846-279
jaf-pipeline> status migration-payu-1234567890
jaf-pipeline> exit
```

#### Server Mode
```bash
# Start REST API server
node index.ts --server

# Available endpoints:
# POST /chat - General pipeline requests
# POST /agents/PipelineOrchestrator/chat - Direct orchestrator access
# GET /agents - List available agents
# GET /health - Health check
```

### 4. REST API Usage

```bash
# Start migration pipeline
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Start migration pipeline for connector: payu",
    "context": {
      "connectorName": "payu",
      "pipelineType": "migration",
      "jenkinsConfig": {
        "url": "https://jenkins.internal.svc.k8s.office.mum.juspay.net",
        "path": "/job/SDK%20Pipelines/job/sdk-api-mocking/job/test-jenkins/buildWithParameters",
        "user": "your.user@juspay.in",
        "token": "your-token"
      },
      "slackConfig": {
        "botToken": "xoxb-your-slack-bot-token"
      }
    }
  }'

# Process ART results
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Process ART results for connector: easebuzz, replay ID: 20250902-155846-279",
    "context": {
      "connectorName": "easebuzz",
      "pipelineType": "art",
      "replayId": "20250902-155846-279",
      "jenkinsConfig": { ... },
      "slackConfig": { ... }
    }
  }'
```

## Pipeline Flow

### 1. Migration Pipeline

```
User Request → PipelineOrchestrator → CodegenAgent
                                         ↓
                                    Generate migration files
                                         ↓
                                    Clone & prepare repos
                                         ↓
                                    Execute Xyne (UCS)
                                         ↓
                                    Execute Xyne (Euler)
                                         ↓
                                    Validate builds
                                         ↓
                                    Commit & push
                                         ↓
                                    → BuildARTAgent
                                         ↓
                                    Trigger Jenkins
                                         ↓
                                    Monitor build
                                         ↓
                                    Download artifacts
                                         ↓
                                    → EvaluationAgent (if ART reports)
```

### 2. ART Processing Pipeline

```
ART Request → PipelineOrchestrator → EvaluationAgent
                                         ↓
                                    Parse ART reports
                                         ↓
                                    Analyze issues
                                         ↓
                                    Read previous prompts
                                         ↓
                                    Generate enhanced prompts
                                         ↓
                                    Save enhanced prompts
                                         ↓
                                    → CodegenAgent (for retry)
```

## Agent Handoffs

JAF automatically manages handoffs between agents:

- **PipelineOrchestrator** → **CodegenAgent** (for migrations)
- **CodegenAgent** → **BuildARTAgent** (after successful commits)
- **BuildARTAgent** → **EvaluationAgent** (if ART reports available)
- **EvaluationAgent** → **CodegenAgent** (for enhanced retry cycles)
- Any agent → **PipelineOrchestrator** (for completion/errors)

## Memory & State

The `ConnectorMemoryProvider` maintains:
- Pipeline status and progress
- Connector configurations
- Migration results
- ART reports and analysis
- Enhanced prompts for feedback loops

## Integration with Existing System

This JAF implementation wraps your existing tools:

- **Your Python script functions** → JAF tools
- **Your Jenkins integration** → `triggerJenkinsJobTool`
- **Your Slack notifications** → `sendSlackNotificationTool`  
- **Your Xyne commands** → `executeXyneCommandTool`
- **Your build validation** → `validateBuildTool`

## Benefits over Current System

1. **Type Safety** - Full TypeScript with runtime validation
2. **State Management** - Persistent pipeline state and memory
3. **Error Handling** - Robust retry mechanisms and error recovery
4. **Observability** - Real-time tracing and event logging
5. **Composability** - Modular tools and agent coordination
6. **Scalability** - Concurrent pipeline execution
7. **Extensibility** - Easy to add new agents and tools

## Monitoring

```bash
# Check pipeline status
curl http://localhost:3000/health

# View active pipelines
node -e "
const { ConnectorMemoryProvider } = require('./memory/connector-memory');
const provider = new ConnectorMemoryProvider();
provider.getActivePipelines().then(console.log);
"
```

## Troubleshooting

### Common Issues

1. **Build failures** - The `validateBuildTool` automatically attempts fixes
2. **Jenkins timeouts** - Adjust `timeoutMinutes` in `monitorBuildStatusTool`
3. **Missing dependencies** - Ensure Node.js modules are installed
4. **Xyne path issues** - Update the Xyne path in `executeXyneCommandTool`

### Debug Mode

```bash
# Enable verbose logging
DEBUG=* node index.ts payu

# Check agent registry
curl http://localhost:3000/agents
```

This JAF implementation provides all the functionality of your current Python script while adding the benefits of JAF's functional architecture, type safety, and multi-agent coordination.