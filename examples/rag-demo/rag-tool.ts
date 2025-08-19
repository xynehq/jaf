import { z } from 'zod';
import { Tool } from '@xynehq/jaf/core';
import { GoogleGenAI } from '@google/genai';

interface RAGMetrics {
  client_init_time: number;
  time_to_first_chunk: number | null;
  total_generation_time: number;
  total_execution_time: number;
  chunk_count: number;
  response_length: number;
  avg_chunks_per_second: number;
  avg_chars_per_second: number;
}

interface RAGResponse {
  response: string;
  query: string;
  model: string;
  sources: string[];
  metrics?: RAGMetrics;
}

const ragQuerySchema = z.object({
  query: z.string().describe("The question to ask the RAG system"),
  similarity_top_k: z.number().describe("Number of similar documents to retrieve").default(parseInt(process.env.RAG_SIMILARITY_TOP_K || '20'))
});

type RAGContext = {
  userId: string;
  permissions: string[];
};

// Real Vertex AI RAG implementation using @google/genai
async function vertexAIRAG(query: string, similarity_top_k: number): Promise<RAGResponse> {
  const total_start_time = Date.now();
  
  console.log(`[RAG] Initializing Vertex AI client...`);
  const client_start_time = Date.now();
  
  try {
    // Initialize the Google Generative AI client for Vertex AI
    const project = process.env.GOOGLE_CLOUD_PROJECT || "genius-dev-393512";
    const location = process.env.GOOGLE_CLOUD_LOCATION || "global";
    
    const client = new GoogleGenAI({
      vertexai: true,
      project,
      location
    });
    
    const client_init_time = (Date.now() - client_start_time) / 1000;
    console.log(`[RAG] Client initialized in ${client_init_time.toFixed(3)}s`);
    console.log(`[RAG] Project: ${project}, Location: ${location}`);
    console.log(`[RAG] Querying RAG corpus with query: "${query}"`);
    console.log(`[RAG] Retrieving top ${similarity_top_k} similar documents`);
    
    const model = process.env.RAG_MODEL || "gemini-2.0-flash-exp";
    
    // Prepare RAG request
    const request = {
      model,
      contents: [
        {
          role: "user" as const,
          parts: [{ text: query }]
        }
      ],
      tools: [
        {
          retrieval: {
            vertexRagStore: {
              ragResources: [
                {
                  ragCorpus: process.env.RAG_CORPUS_ID || "projects/genius-dev-393512/locations/us-central1/ragCorpora/2305843009213693952"
                }
              ],
              similarityTopK: similarity_top_k
            }
          }
        }
      ]
    };
    
    const generation_start_time = Date.now();
    let first_chunk_time: number | null = null;
    let chunk_count = 0;
    let response_text = "";
    let grounding_metadata: any = null;
    
    // Generate content with RAG
    console.log(`[RAG] Generating content with model: ${model}`);
    const result = await client.models.generateContent(request);
    
    first_chunk_time = (Date.now() - generation_start_time) / 1000;
    chunk_count = 1;
    
    // Extract response
    if (result.candidates?.[0]?.content?.parts) {
      for (const part of result.candidates[0].content.parts) {
        if (part.text) {
          response_text += part.text;
        }
      }
    }
    
    // Capture grounding metadata if present
    if (result.candidates?.[0]?.groundingMetadata) {
      grounding_metadata = result.candidates[0].groundingMetadata;
    }
    
    const total_generation_time = (Date.now() - generation_start_time) / 1000;
    const total_execution_time = (Date.now() - total_start_time) / 1000;
    
    // Extract source URLs from grounding metadata
    const source_urls: string[] = [];
    if (grounding_metadata?.groundingChunks) {
      for (const chunk of grounding_metadata.groundingChunks) {
        if (chunk.retrievedContext?.uri) {
          const uri = chunk.retrievedContext.uri;
          if (uri && !source_urls.includes(uri)) {
            source_urls.push(uri);
          }
        }
      }
    }
    
    const metrics: RAGMetrics = {
      client_init_time,
      time_to_first_chunk: first_chunk_time,
      total_generation_time,
      total_execution_time,
      chunk_count,
      response_length: response_text.length,
      avg_chunks_per_second: chunk_count / total_generation_time || 0,
      avg_chars_per_second: response_text.length / total_generation_time || 0
    };
    
    console.log(`[RAG] Query completed in ${total_execution_time.toFixed(3)}s, ${chunk_count} chunks, ${response_text.length} chars`);
    
    return {
      response: response_text,
      query,
      model,
      sources: source_urls,
      metrics
    };
    
  } catch (error) {
    console.error('[RAG] Error during RAG query:', error);
    throw error;
  }
}



export const vertexAIRAGTool: Tool<any, RAGContext> = {
  schema: {
    name: "vertex_ai_rag_query",
    description: "Query the Vertex AI RAG (Retrieval Augmented Generation) system to get information from the knowledge base",
    parameters: ragQuerySchema,
  },
  execute: async (args, context) => {
    try {
      console.log(`[RAG] User ${context.userId} requesting RAG query: "${args.query}"`);
      
      // In production, you would check permissions here
      if (!context.permissions.includes('rag_access')) {
        return JSON.stringify({
          error: "permission_denied",
          message: "RAG access requires 'rag_access' permission",
          query: args.query
        });
      }
      
      const result = await vertexAIRAG(args.query, args.similarity_top_k);
      
      // Format the response for the agent
      const formattedResponse = `
**RAG Query Results**

**Query:** ${result.query}
**Model:** ${result.model}

**Response:**
${result.response}

**Sources:**
${result.sources.map((source, index) => `${index + 1}. ${source}`).join('\n')}

**Performance Metrics:**
- Total execution time: ${result.metrics?.total_execution_time.toFixed(3)}s
- Time to first chunk: ${result.metrics?.time_to_first_chunk?.toFixed(3)}s
- Chunks received: ${result.metrics?.chunk_count}
- Response length: ${result.metrics?.response_length} characters
- Average chars/second: ${result.metrics?.avg_chars_per_second.toFixed(1)}
      `.trim();
      
      return formattedResponse;
      
    } catch (error) {
      console.error('[RAG] Error during RAG query:', error);
      return JSON.stringify({
        error: "rag_query_failed",
        message: error instanceof Error ? error.message : "Unknown error during RAG query",
        query: args.query
      });
    }
  }
};