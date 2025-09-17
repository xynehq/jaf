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

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_API_KEY = 'your-api-key-here';
const DEFAULT_PORT = 3002;
const DEFAULT_HOST = 'localhost';
const DEFAULT_MAX_BODY_SIZE = 25 * 1024 * 1024;
const DEFAULT_MAX_TURNS = 5;

function getRequiredEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (!value || value === 'null') {
    if (defaultValue) {
      console.warn(`${name} not set. Using default value.`);
      return defaultValue;
    }
    console.warn(`${name} not set. Server will start but may not function correctly.`);
    return '';
  }
  return value;
}

const litellmBaseUrl = getRequiredEnvVar('LITELLM_BASE_URL', DEFAULT_BASE_URL);
const litellmApiKey = getRequiredEnvVar('LITELLM_API_KEY', DEFAULT_API_KEY);

const modelProvider = makeLiteLLMProvider(litellmBaseUrl, litellmApiKey);

const serverConfig = {
  port: DEFAULT_PORT,
  host: DEFAULT_HOST,
  maxBodySize: DEFAULT_MAX_BODY_SIZE,
  runConfig: {
    agentRegistry,
    modelProvider,
    maxTurns: DEFAULT_MAX_TURNS
  },
  agentRegistry
} as const;

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

  console.log('5.5. PDF document:');
  console.log(`curl -X POST http://localhost:3002/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentName": "attachment-analyst",
    "messages": [
      {
        "role": "user",
        "content": "Please analyze this PDF document",
        "attachments": [
          {
            "kind": "document",
            "mimeType": "application/pdf",
            "name": "sample-document.pdf",
            "url": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
          }
        ]
      }
    ]
  }'\n`);

  console.log('5.6. PDF with base64 data:');
  console.log(`curl -X POST http://localhost:3002/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentName": "attachment-analyst",
    "messages": [
      {
        "role": "user",
        "content": "Extract text from this PDF document",
        "attachments": [
          {
            "kind": "document",
            "mimeType": "application/pdf",
            "name": "test-document.pdf",
            "data": "JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgMyAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKMyAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDIgMCBSCi9NZWRpYUJveCBbIDAgMCA2MTIgNzkyIF0KL1Jlc291cmNlcyA8PAovRm9udCA8PAovRjEgNCAwIFIKPj4KPj4KL0NvbnRlbnRzIDUgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQo+PgplbmRvYmoKNSAwIG9iago8PAovTGVuZ3RoIDQ0Cj4+CnN0cmVhbQpCVApxCjcyIDcwMCBUZAovRjEgMTIgVGYKKEhlbGxvLCBQREYgV29ybGQhKSBUagpFVApRCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNzkgMDAwMDAgbiAKMDAwMDAwMDE3MyAwMDAwMCBuIAowMDAwMDAwMzAxIDAwMDAwIG4gCjAwMDAwMDAzODAgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA2Ci9Sb290IDEgMCBSCj4+CnN0YXJ0eHJlZgo0NzQKJSVFT0Y="
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




  console.log('8. LiteLLM format - Large document via URL (efficient):');
  console.log(`curl -X POST http://localhost:3002/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentName": "attachment-analyst",
    "messages": [
      {
        "role": "user",
        "content": "Analyze this large document using LiteLLM format",
        "attachments": [
          {
            "kind": "document",
            "mimeType": "application/json",
            "name": "large-config.json",
            "data": "ewogICJuYW1lIjogIkxhcmdlIENvbmZpZ3VyYXRpb24iLAogICJ2ZXJzaW9uIjogIjIuMC4wIiwKICAiZGVzY3JpcHRpb24iOiAiQSBjb21wbGV4IGNvbmZpZ3VyYXRpb24gZmlsZSB3aXRoIG1hbnkgc2V0dGluZ3MiLAogICJzZXJ2aWNlcyI6IHsKICAgICJkYXRhYmFzZSI6IHsKICAgICAgImhvc3QiOiAibG9jYWxob3N0IiwKICAgICAgInBvcnQiOiA1NDMyLAogICAgICAibmFtZSI6ICJhcHBfZGIiCiAgICB9LAogICAgInJlZGlzIjogewogICAgICAiaG9zdCI6ICJsb2NhbGhvc3QiLAogICAgICAicG9ydCI6IDYzNzkKICAgIH0KICB9Cn0=",
            "useLiteLLMFormat": true
          }
        ]
      }
    ]
  }'\n`);

  console.log('9. LiteLLM format - Base64 document (native processing):');
  console.log(`curl -X POST http://localhost:3002/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentName": "attachment-analyst",
    "messages": [
      {
        "role": "user",
        "content": "Process this document using native model capabilities",
        "attachments": [
          {
            "kind": "document",
            "mimeType": "application/json",
            "name": "config.json",
            "data": "ewogICJuYW1lIjogIlNhbXBsZSBBcHAiLAogICJ2ZXJzaW9uIjogIjEuMC4wIiwKICAiZGVzY3JpcHRpb24iOiAiQSBzYW1wbGUgYXBwbGljYXRpb24gZm9yIGRlbW9uc3RyYXRpb24gcHVycG9zZXMiLAogICJhdXRob3IiOiAiSm9obiBEb2UiLAogICJsaWNlbnNlIjogIk1JVCIsCiAgImRlcGVuZGVuY2llcyI6IHsKICAgICJleHByZXNzIjogIl40LjE4LjIiLAogICAgImxvZGFzaCI6ICJeNC4xNy4yMSIsCiAgICAiYXhpb3MiOiAiXjEuNi4yIgogIH0sCiAgInNjcmlwdHMiOiB7CiAgICAic3RhcnQiOiAibm9kZSBpbmRleC5qcyIsCiAgICAidGVzdCI6ICJucG0gcnVuIGplc3QiCiAgfQp9",
            "useLiteLLMFormat": true
          }
        ]
      }
    ]
  }'\n`);

  console.log('10. Hybrid approach - Regular processing for small files:');
  console.log(`curl -X POST http://localhost:3002/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentName": "attachment-analyst",
    "messages": [
      {
        "role": "user",
        "content": "Compare: same document with different processing",
        "attachments": [
          {
            "kind": "document",
            "mimeType": "text/plain",
            "name": "small-file.txt",
            "data": "VGhpcyBpcyBhIHNtYWxsIGZpbGUgZm9yIHRleHQgZXh0cmFjdGlvbiB0ZXN0aW5nLg==",
            "useLiteLLMFormat": false
          },
          {
            "kind": "document", 
            "mimeType": "text/plain",
            "name": "same-file-litellm.txt",
            "data": "VGhpcyBpcyBhIHNtYWxsIGZpbGUgZm9yIHRleHQgZXh0cmFjdGlvbiB0ZXN0aW5nLg==",
            "useLiteLLMFormat": true
          }
        ]
      }
    ]
  }'\n`);

  console.log('11. Testing security - dangerous filename (should fail):');
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

  console.log('Configuration:');
  console.log('- Use Ctrl+C to stop the server');
  console.log('- Image attachments: Full visual analysis');
  console.log('- Document attachments: Text extraction and analysis for PDF, DOCX, XLSX, CSV, TXT, JSON, ZIP');
  console.log('- LiteLLM format: Use "useLiteLLMFormat": true for efficient large file processing');
  console.log('  * Large documents: No context window waste, native model processing');
  console.log('  * Better layout understanding, tables, images preserved');
  console.log('  * Automatic provider optimization (Bedrock, Gemini, OpenAI)');
  console.log('- URL support: Both remote URLs and base64 data supported');
  console.log('- Base64 strings in examples contain real document content');
  console.log('- Security validations will reject malicious inputs');
  console.log('- Max attachment size: 10MB per attachment (25MB with LiteLLM format)');
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