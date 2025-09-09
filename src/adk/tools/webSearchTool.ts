import { Tool, ToolParameter, ToolContext, ToolResult, ToolParameterType } from '../types';
import { createFunctionTool } from './index';

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

export const createWebSearchTool = (service?: WebSearchService): Tool => {
  const searchService = service || new WebSearchService();

  return createFunctionTool({
    name: 'webSearch',
    description: 'Search the web for real-time information using configured provider (Tavily/Bing)',
    execute: async (params, context) => {
      const { query, maxResults, region, language, safeSearch } = params as {
        query: string;
        maxResults?: number;
        region?: string;
        language?: string;
        safeSearch?: boolean;
      };

      try {
        const results = await searchService.search(query, {
          maxResults,
          region,
          language,
          safeSearch,
        });

        return {
          query,
          resultsCount: results.length,
          results,
        };
      } catch (error) {
        throw new Error(`Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },
    parameters: [
      {
        name: 'query',
        type: ToolParameterType.STRING,
        description: 'Search query string',
        required: true,
      },
      {
        name: 'maxResults',
        type: ToolParameterType.NUMBER,
        description: 'Maximum number of results to return (default: 5)',
        required: false,
        default: 5,
      },
      {
        name: 'region',
        type: ToolParameterType.STRING,
        description: 'Region/market code for localized results (e.g., "en-US", "en-IN")',
        required: false,
      },
      {
        name: 'language',
        type: ToolParameterType.STRING,
        description: 'Language code for results (e.g., "en", "hi")',
        required: false,
      },
      {
        name: 'safeSearch',
        type: ToolParameterType.BOOLEAN,
        description: 'Enable safe search filtering',
        required: false,
        default: false,
      },
    ],
    metadata: {
      source: 'web-search',
      version: '1.0.0',
      tags: ['search', 'web', 'real-time'],
    },
  });
};

export default createWebSearchTool;