import { z } from 'zod';
import { Tool } from '../core/types';
import { ToolResponse } from '../core/tool-results';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  relevanceScore?: number;
}

export interface WebSearchProvider {
  search(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]>;
}

export interface WebSearchOptions {
  maxResults?: number;
  region?: string;
  language?: string;
  safeSearch?: boolean;
}

class TavilyProvider implements WebSearchProvider {
  private apiKey: string;
  private baseUrl = 'https://api.tavily.com/search';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: options.maxResults || 5,
        search_depth: 'advanced',
        include_raw_content: false,
        include_images: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    return data.results.map((result: any) => ({
      title: result.title,
      url: result.url,
      snippet: result.content,
      relevanceScore: result.score,
    }));
  }
}

class BingProvider implements WebSearchProvider {
  private apiKey: string;
  private baseUrl = 'https://api.bing.microsoft.com/v7.0/search';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      count: String(options.maxResults || 5),
      ...(options.region && { mkt: options.region }),
      ...(options.safeSearch && { safeSearch: 'Strict' }),
    });

    const response = await fetch(`${this.baseUrl}?${params}`, {
      headers: {
        'Ocp-Apim-Subscription-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Bing API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    return data.webPages?.value?.map((result: any) => ({
      title: result.name,
      url: result.url,
      snippet: result.snippet,
    })) || [];
  }
}

export class WebSearchService {
  private provider: WebSearchProvider;

  constructor(providerName?: string, apiKey?: string) {
    const selectedProvider = providerName || process.env.SEARCH_PROVIDER || 'tavily';
    const searchApiKey = apiKey || process.env.SEARCH_API_KEY;

    if (!searchApiKey) {
      throw new Error('Search API key is required. Set SEARCH_API_KEY environment variable.');
    }

    switch (selectedProvider.toLowerCase()) {
      case 'tavily':
        this.provider = new TavilyProvider(searchApiKey);
        break;
      case 'bing':
        this.provider = new BingProvider(searchApiKey);
        break;
      default:
        throw new Error(`Unsupported search provider: ${selectedProvider}`);
    }
  }

  async search(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]> {
    return this.provider.search(query, options);
  }
}

const webSearchSchema = z.object({
  query: z.string().describe('Search query string'),
  maxResults: z.number().optional().default(5).describe('Maximum number of results to return'),
  region: z.string().optional().describe('Region/market code for localized results (e.g., "en-US", "en-IN")'),
  language: z.string().optional().describe('Language code for results (e.g., "en", "hi")'),
  safeSearch: z.boolean().optional().default(false).describe('Enable safe search filtering'),
});

type WebSearchParams = z.infer<typeof webSearchSchema>;

export const webSearchTool: Tool<WebSearchParams, any> = {
  schema: {
    name: 'webSearch',
    description: 'Search the web for real-time information using configured provider (Tavily/Bing)',
    parameters: webSearchSchema,
  },
  needsApproval: false,
  execute: async (params, context) => {
    try {
      const service = new WebSearchService();
      const results = await service.search(params.query, {
        maxResults: params.maxResults,
        region: params.region,
        language: params.language,
        safeSearch: params.safeSearch,
      });

      const response = {
        query: params.query,
        resultsCount: results.length,
        results,
      };

      return ToolResponse.success(response);
    } catch (error) {
      return ToolResponse.error(`Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
};

export function createWebSearchTool<Ctx>(service?: WebSearchService): Tool<WebSearchParams, Ctx> {
  const searchService = service || new WebSearchService();

  return {
    schema: {
      name: 'webSearch',
      description: 'Search the web for real-time information using configured provider (Tavily/Bing)',
      parameters: webSearchSchema,
    },
    needsApproval: false,
    execute: async (params, context) => {
      try {
        const results = await searchService.search(params.query, {
          maxResults: params.maxResults,
          region: params.region,
          language: params.language,
          safeSearch: params.safeSearch,
        });

        const response = {
          query: params.query,
          resultsCount: results.length,
          results,
        };

        return ToolResponse.success(response);
      } catch (error) {
        return ToolResponse.error(`Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },
  };
}