import { z } from 'zod';
import { Tool } from '../types.js';
import { withErrorHandling } from '../tool-results.js';
import { mask_PII } from './pii-masking.js';

/**
 * Zod schema for validating individual search results
 * This ensures the result data is properly typed and validated
 */
export const SearchResultSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  title: z.string().min(1, "Title cannot be empty"),
  content: z.string().default(""),
  engine: z.string().default("unknown"),
  score: z.number().default(0),
  publishedDate: z.string().nullable().default(null)
});

/**
 * Infer the TypeScript type from the Zod schema
 * This is the contract exposed to downstream callers / LLM / UI
 */
export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * Zod schema for the full search results response
 */
export const SearchResultsSchema = z.object({
  results: z.array(SearchResultSchema).default([])
});

/**
 * Raw search result from the hosted web browser service (SearxNG-compatible)
 
 * Used for parsing the initial API response before validation
 */
interface SearchResultsRaw {
  results?: SearchResultRaw[];
}

interface SearchResultRaw {
  url?: string;
  title?: string;
  content?: string;
  engine?: string;
  score?: number;
  publishedDate?: string | null;
}

/**
 * Safe mapper function that transforms raw search results into clean DTO
 * Uses Zod validation to ensure data integrity
 */
export function mapSearchResults(response: SearchResultsRaw): SearchResult[] {
  if (!Array.isArray(response.results)) {
    return [];
  }

  // Filter results with required fields and map to clean DTO
  const mappedResults = response.results
    .filter(r => r.url && r.title)
    .map(r => ({
      url: r.url!,
      title: r.title!,
      content: r.content ?? '',
      engine: r.engine ?? 'unknown',
      score: typeof r.score === 'number' ? r.score : 0,
      publishedDate: r.publishedDate ?? null
    }));

  // Validate with Zod and filter out any invalid results
  const validatedResults: SearchResult[] = [];
  for (const result of mappedResults) {
    const parseResult = SearchResultSchema.safeParse(result);
    if (parseResult.success) {
      validatedResults.push(parseResult.data);
    }
    // Silently skip invalid results to prevent poisoning
  }

  return validatedResults;
}

/**
 * WebSearch Tool Parameters
 */
const webSearchSchema = z.object({
  hostedWebServerUrl: z.string()
    .url("Must be a valid URL")
    .describe("The hosted web server URL for the search service"),
  apiKey: z.string()
    .min(1, "API key cannot be empty")
    .describe("The API key for authentication"),
  query: z.string()
    .min(1, "Search query cannot be empty")
    .describe("The search query to execute")
});

export type WebSearchArgs = z.infer<typeof webSearchSchema>;

/**
 * WebSearch Tool
 * 
 * Makes a GET call to a hosted web browser for web search functionality.
 * Compatible with SearxNG, an open-source meta search engine.
 * 
 * Credits: This tool uses the SearxNG API format
 * https://github.com/searxng/searxng
 * 
 * Returns a clean, type-safe array of search results.
 * 
 * Example usage:
 * ```typescript
 * const result = await webSearchTool.execute(
 *   { 
 *     hostedWebServerUrl: 'https://search.example.com',
 *     apiKey: 'your-api-key-here',
 *     query: 'juspay'
 *   },
 *   {}
 * );
 * 
 * // Returns: { results: SearchResult[] }
 * ```
 * 
 * The tool makes a request in the format:
 * `GET {hostedWebServerUrl}/search?q={query}&format=json`
 * with header: `X-API-Key: {apiKey}`
 */
export const webSearchTool: Tool<WebSearchArgs, any> = {
  schema: {
    name: 'websearch',
    description: `Perform a web search using a hosted web browser service.
                 Returns search results with url, title, content, engine, score, and publishedDate.
                 Use this tool when you need to search the internet for current information.`,
    parameters: webSearchSchema
  },
  
  execute: withErrorHandling<WebSearchArgs, { results: SearchResult[] }, any>('websearch', async args => {
    const { hostedWebServerUrl, apiKey, query } = args;
    
    console.log(`[Websearch] Raw Query is: ${query}`);

    // Mask PII in the query before logging or processing
    const maskedQuery = mask_PII(query);
    console.log(`[Websearch] Masked Query is: ${maskedQuery}`);

    // Construct the search URL
    const baseUrl = hostedWebServerUrl.replace(/\/$/, ''); // Remove trailing slash if present
    const searchUrl = new URL(`${baseUrl}/search`);
    searchUrl.searchParams.append('q', maskedQuery);
    searchUrl.searchParams.append('format', 'json');
    
    console.log(`[WebSearch] Making request to: ${searchUrl.toString()}`);
    
    // Make the GET request
    const response = await fetch(searchUrl.toString(), {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json',
        'User-Agent': 'JAF-WebSearch-Tool/1.0'
      }
    });
    
    // Handle HTTP errors
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response');
      
      // Handle specific HTTP status codes
      if (response.status === 401) {
        throw new Error(`Authentication failed: Invalid API key`);
      }
      
      if (response.status === 403) {
        throw new Error(`Access forbidden: Insufficient permissions`);
      }
      
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        throw new Error(`Rate limited. Retry after ${retryAfter || '60'} seconds`);
      }
      
      if (response.status === 404) {
        throw new Error(`Search endpoint not found at ${baseUrl}`);
      }
      
      if (response.status >= 500) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
      
      throw new Error(`HTTP error ${response.status}: ${response.statusText}. Details: ${errorText}`);
    }
    
    // Parse JSON response
    const rawData = await response.json() as SearchResultsRaw;
    
    // Map raw results to clean DTO with Zod validation
    let results = mapSearchResults(rawData);
    
    // Cap at 30 results
    results = results.slice(0, 30);
    
    // Validate the final results array with Zod
    const validationResult = SearchResultsSchema.safeParse({ results });
    
    if (!validationResult.success) {
      console.error('[WebSearch] Validation error:', validationResult.error);
      // Return partial results rather than failing completely
      return { results };
    }
    
    // Return the validated results
    return validationResult.data;
  })
};

