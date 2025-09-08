import { createJAFServer } from '../src/server/server.js';
import { makeLiteLLMProvider } from '../src/providers/model.js';
import { Agent } from '../src/core/types.js';

const attachmentAgent: Agent<any, string> = {
  name: 'attachment-analyst',
  instructions: () => `You are an AI assistant that can analyze various types of attachments including images and documents.
When users send you attachments, analyze them carefully and provide helpful, detailed responses about their content.

For images: Describe what you see in detail.
For documents: Analyze and summarize the content, structure, or data as appropriate.
Supported document types: PDF, DOCX, XLSX, CSV, TXT, JSON, ZIP files.`,
  modelConfig: {
    name: 'claude-sonnet-4', 
    temperature: 0.7,
    maxTokens: 1000
  }
};

const agentRegistry = new Map([
  ['attachment-analyst', attachmentAgent]
]);

const litellmBaseUrl = process.env.LITELLM_BASE_URL;
const litellmApiKey = process.env.LITELLM_API_KEY;

if (!litellmBaseUrl || litellmBaseUrl === 'null') {
  console.warn('⚠️  LITELLM_BASE_URL not set. Server will start but model calls will fail.');
  console.warn('   Set LITELLM_BASE_URL environment variable to use a real LiteLLM endpoint.');
}

if (!litellmApiKey || litellmApiKey === 'null') {
  console.warn('⚠️  LITELLM_API_KEY not set. Server will start but model calls may fail.');
  console.warn('   Set LITELLM_API_KEY environment variable if your LiteLLM endpoint requires authentication.');
}

const modelProvider = makeLiteLLMProvider(
  litellmBaseUrl || 'https://api.openai.com/v1',
  litellmApiKey || 'your-api-key-here'
);

const serverConfig = {
  port: 3002,
  host: 'localhost',
  maxBodySize: 25 * 1024 * 1024,
  runConfig: {
    agentRegistry,
    modelProvider,
    maxTurns: 5
  },
  agentRegistry
};

const server = createJAFServer(serverConfig);

server.start().then(() => {
  console.log('JAF Attachment Demo Server started on http://localhost:3002');
  console.log('\nTesting Attachment Support - Use these curl commands:\n');
  
  console.log('1. Simple text message:');
  console.log(`curl -X POST http://localhost:3002/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentName": "attachment-analyst",
    "messages": [
      {
        "role": "user", 
        "content": "Hello! Can you help me analyze attachments?"
      }
    ]
  }'\n`);
  
  console.log('2. Image with URL attachment:');
  console.log(`curl -X POST http://localhost:3002/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentName": "attachment-analyst",
    "messages": [
      {
        "role": "user",
        "content": "What do you see in this image?",
        "attachments": [
          {
            "kind": "image",
            "mimeType": "image/jpeg",
            "name": "random-image.jpg",
            "url": "https://picsum.photos/400/300"
          }
        ]
      }
    ]
  }'\n`);

  console.log('3. Image attachment with base64 data:');
  console.log(`curl -X POST http://localhost:3002/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentName": "attachment-analyst", 
    "messages": [
      {
        "role": "user",
        "content": "Analyze this small test image",
        "attachments": [
          {
            "kind": "image",
            "mimeType": "image/png",
            "name": "test-pixel.png",
            "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
          }
        ]
      }
    ]
  }'\n`);




  console.log('4. PDF document:');
  console.log(`curl -X POST http://localhost:3002/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentName": "attachment-analyst",
    "messages": [
      {
        "role": "user",
        "content": "What can you tell me about this PDF document?",
        "attachments": [
          {
            "kind": "document",
            "mimeType": "application/pdf",
            "name": "sample.pdf",
            "data": "your_pdf_base64_data_here"
          }
        ]
      }
    ]
  }'\n`);

  console.log('5. Text file:');
  console.log(`curl -X POST http://localhost:3002/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentName": "attachment-analyst",
    "messages": [
      {
        "role": "user",
        "content": "Please analyze this text file",
        "attachments": [
          {
            "kind": "file",
            "mimeType": "text/plain",
            "name": "sample.txt",
            "data": "VGhpcyBpcyBhIHNhbXBsZSB0ZXh0IGZpbGUgZm9yIHRlc3RpbmcgYXR0YWNobWVudCBmdW5jdGlvbmFsaXR5LgoKSXQgY29udGFpbnMgbXVsdGlwbGUgbGluZXMgb2YgdGV4dCB0byBkZW1vbnN0cmF0ZSBob3cgdGV4dCBmaWxlcyBhcmUgcHJvY2Vzc2VkLgoKS2V5IHBvaW50czoKLSBUZXh0IGZpbGUgcHJvY2Vzc2luZyB3b3JrcwotIE11bHRpcGxlIGxpbmVzIGFyZSBzdXBwb3J0ZWQKLSBTcGVjaWFsIGNoYXJhY3RlcnMgYW5kIGZvcm1hdHRpbmcgYXJlIHByZXNlcnZlZA=="
          }
        ]
      }
    ]
  }'\n`);

  console.log('6. CSV data:');
  console.log(`curl -X POST http://localhost:3002/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentName": "attachment-analyst",
    "messages": [
      {
        "role": "user",
        "content": "Analyze this CSV data",
        "attachments": [
          {
            "kind": "file",
            "mimeType": "text/csv",
            "name": "sales_data.csv",
            "data": "TmFtZSxBZ2UsRGVwYXJ0bWVudCxTYWxhcnkKSm9obiBEb2UsMzUsRW5naW5lZXJpbmcsNzUwMDAKSmFuZSBTbWl0aCwyOCxNYXJrZXRpbmcsNjUwMDAKTWlrZSBKb2huc29uLDQyLFNhbGVzLDcwMDAwCkFubmEgTGVlLDI2LEhSLDU1MDAwClJvYmVydCBXaWxzb24sMzksRmluYW5jZSw4MDAwMA=="
          }
        ]
      }
    ]
  }'\n`);

  console.log('7. JSON file:');
  console.log(`curl -X POST http://localhost:3002/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentName": "attachment-analyst",
    "messages": [
      {
        "role": "user",
        "content": "What is in this JSON file?",
        "attachments": [
          {
            "kind": "file",
            "mimeType": "application/json",
            "name": "config.json",
            "data": "ewogICJuYW1lIjogIlNhbXBsZSBBcHAiLAogICJ2ZXJzaW9uIjogIjEuMC4wIiwKICAiZGVzY3JpcHRpb24iOiAiQSBzYW1wbGUgYXBwbGljYXRpb24gZm9yIGRlbW9uc3RyYXRpb24gcHVycG9zZXMiLAogICJhdXRob3IiOiAiSm9obiBEb2UiLAogICJsaWNlbnNlIjogIk1JVCIsCiAgImRlcGVuZGVuY2llcyI6IHsKICAgICJleHByZXNzIjogIl40LjE4LjIiLAogICAgImxvZGFzaCI6ICJeNC4xNy4yMSIsCiAgICAiYXhpb3MiOiAiXjEuNi4yIgogIH0sCiAgInNjcmlwdHMiOiB7CiAgICAic3RhcnQiOiAibm9kZSBpbmRleC5qcyIsCiAgICAidGVzdCI6ICJucG0gcnVuIGplc3QiCiAgfQp9"
          }
        ]
      }
    ]
  }'\n`);




  console.log('8. Testing security - dangerous filename (should fail):');
  console.log(`curl -X POST http://localhost:3002/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentName": "attachment-analyst",
    "messages": [
      {
        "role": "user",
        "content": "This should fail due to dangerous filename",
        "attachments": [
          {
            "kind": "file",
            "mimeType": "text/plain",
            "name": "../../../etc/passwd",
            "data": "dGVzdA=="
          }
        ]
      }
    ]
  }'\n`);

  console.log('Notes:');
  console.log('- Use Ctrl+C to stop the server');
  console.log('- Image attachments: Full visual analysis');
  console.log('- Document attachments: Text extraction and analysis for PDF, DOCX, XLSX, CSV, TXT, JSON, ZIP');
  console.log('- Base64 strings in examples contain real document content');
  console.log('- Security validations will reject malicious inputs');
  console.log('- Max attachment size: 10MB per attachment');
  console.log('- Max body size: 25MB total per request\n');

}).catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\nShutting down attachment demo server...');
  await server.stop();
  process.exit(0);
});