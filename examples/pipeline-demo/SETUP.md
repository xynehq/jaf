# JAF Pipeline Setup Guide

## ✅ Current Status

Your JAF pipeline implementation is **complete** and ready to use! Here's how to get it running:

## 🚀 Quick Setup

### 1. **Build JAF Core** (Required First)

```bash
# Go to JAF root directory
cd /Users/shivral.somani/Documents/Repos/new_jaf/jaf

# Build the main JAF package
npm run build

# Verify build completed
ls dist/  # Should show compiled files
```

### 2. **Install Pipeline Dependencies**

```bash
# Go to pipeline demo directory
cd examples/pipeline-demo

# Install dependencies
npm install

# Test basic functionality
node test-basic.js
```

### 3. **Configure Your Settings**

Edit `index.ts` and update the CONFIG section with your actual credentials:

```typescript
const CONFIG = {
  liteLLMUrl: "https://grid.ai.juspay.net", // ✅ Your LiteLLM URL
  liteLLMApiKey: "", // ✅ Your API key
  liteLLMModel: "glm-45-fp8", // ✅ Your model
  jenkinsUrl: "https://jenkins.internal.svc.k8s.office.mum.juspay.net", // ✅ Your Jenkins
  jenkinsUser: "shivral.somani@juspay.in", // ✅ Your user
  jenkinsToken: "", // ✅ Your token
  slackBotToken: "", // ✅ Your Slack bot
};
```

## 🎯 How to Run

### **Option A: Command Line Migration**

```bash
# Run migration for a specific connector
npm run migrate payu

# Or use tsx directly
npx tsx index.ts easebuzz
```

### **Option B: Interactive Mode**

```bash
# Start interactive CLI
npm run interactive

# Then use commands:
jaf-pipeline> migrate payu
jaf-pipeline> art easebuzz 20250902-155846-279
jaf-pipeline> status migration-payu-1234567890
jaf-pipeline> exit
```

### **Option C: Server Mode**

```bash
# Start REST API server
npm run server

# Test with curl:
curl http://localhost:3000/health
curl http://localhost:3000/agents
```

### **Option D: API Usage**

```bash
# Start server
npm run server &

# Send migration request
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
        "user": "shivral.somani@juspay.in",
        "token": ""
      },
      "slackConfig": {
        "botToken": ""
      }
    }
  }'
```

## 🔧 Troubleshooting

### If you get import errors:

```bash
# Make sure JAF is built
cd /Users/shivral.somani/Documents/Repos/new_jaf/jaf
npm run build

# Make sure dependencies are installed
cd examples/pipeline-demo
npm install
```

### If you get TypeScript errors:

```bash
# Use tsx instead of ts-node
npx tsx index.ts payu

# Or compile first
npm run build
node dist/index.js payu
```

### Test your current Python script alongside:

```bash
# Your current way
python3 /Users/shivral.somani/Documents/Repos/mockApiTest/script.py generate_migrate easebuzz

# New JAF way
npx tsx index.ts easebuzz
```

## 📊 What You Get

✅ **Complete JAF Implementation** of your Mermaid diagram pipeline
✅ **4 Specialized Agents** with automatic handoffs  
✅ **13 Pipeline Tools** wrapping your existing Python functions
✅ **Type Safety** with full TypeScript validation
✅ **Memory Management** for state persistence  
✅ **Error Handling** with retry mechanisms
✅ **Real-time Observability** and event tracing
✅ **REST API** with multiple usage modes
✅ **Full Compatibility** with your existing Jenkins/Slack/Xyne setup

## 🎉 Ready to Go!

Your JAF pipeline is a drop-in replacement for your Python script with all the benefits of JAF's functional architecture.

**Start with:**

```bash
cd /Users/shivral.somani/Documents/Repos/new_jaf/jaf
npm run build
cd examples/pipeline-demo
npm install
node test-basic.js
npx tsx index.ts --help
```
