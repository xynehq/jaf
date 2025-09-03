import { createJAFServer } from '../src/server/server.js';
import { makeLiteLLMProvider } from '../src/providers/model.js';
import { Agent } from '../src/core/types.js';

const visionAgent: Agent<any, string> = {
  name: 'vision-analyst',
  instructions: () => `You are a vision AI assistant that can analyze images and provide detailed descriptions. 
When users send you images, analyze them carefully and provide helpful, detailed responses about what you see.`,
  modelConfig: {
    name: 'claude-sonnet-4', 
    temperature: 0.7,
    maxTokens: 1000
  }
};

const agentRegistry = new Map([
  ['vision-analyst', visionAgent]
]);

const modelProvider = makeLiteLLMProvider(
  process.env.LITELLM_BASE_URL || 'null', process.env.LITELLM_API_KEY || 'null'
);

const serverConfig = {
  port: 3001,
  host: 'localhost',
  runConfig: {
    agentRegistry,
    modelProvider,
    maxTurns: 5
  },
  agentRegistry
};

const server = createJAFServer(serverConfig);

server.start().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  await server.stop();
  process.exit(0);
});

// // Print example curl commands after server starts
// setTimeout(() => {
//   console.log('\nExample curl commands:');
//   console.log('\n1. Simple text message:');
//   console.log(`curl -X POST http://localhost:3001/chat \\
//   -H "Content-Type: application/json" \\
//   -d '{
//     "agentName": "vision-analyst",
//     "messages": [
//       {
//         "role": "user", 
//         "content": "Hello! Can you help me analyze images?"
//       }
//     ]
//   }'`);
  
//   console.log('\n2. Vision message with image URL:');
//   console.log(`curl -X POST http://localhost:3001/chat \\
//   -H "Content-Type: application/json" \\
//   -d '{
//     "agentName": "vision-analyst",
//     "messages": [
//       {
//         "role": "user",
//         "content": [
//           {
//             "type": "text",
//             "text": "What do you see in this image?"
//           },
//           {
//             "type": "image_url",
//             "image_url": {
//               "url": "https://picsum.photos/400/300",
//               "detail": "high"
//             }
//           }
//         ]
//       }
//     ]
//   }'`);

//   console.log('\n3. Vision message with local image (base64):');
//   console.log(`curl -X POST http://localhost:3001/chat \\
//   -H "Content-Type: application/json" \\
//   -d '{
//     "agentName": "vision-analyst", 
//     "messages": [
//       {
//         "role": "user",
//         "content": [
//           {
//             "type": "text",
//             "text": "Describe this image in detail"
//           },
//           {
//             "type": "image_url",
//             "image_url": {
//               "url": "data:image/jpeg;base64,/9j/4AAQSkZJRgABA...",
//               "detail": "high"
//             }
//           }
//         ]
//       }
//     ]
//   }'`);

//
// }, 2000);