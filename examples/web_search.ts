import { createWebSearchTool, WebSearchService } from '../src/adk/tools/webSearchTool';
import * as dotenv from 'dotenv';

dotenv.config();

async function demonstrateWebSearch() {
  console.log('🔍 Web Search Tool Demo\n');
  console.log('=' .repeat(50));

  try {
    const webSearchTool = createWebSearchTool();

    console.log('\n📋 Example 1: Searching for RBI UPI Guidelines');
    console.log('-' .repeat(50));

    const upiQuery = 'latest RBI UPI guidelines';
    console.log(`Query: "${upiQuery}"\n`);

    const directSearchResult = await webSearchTool.execute(
      { query: upiQuery, maxResults: 3 },
      { userId: 'demo-user', sessionId: 'demo-session' }
    );

    if (directSearchResult.success && directSearchResult.data) {
      const data = directSearchResult.data as any;
      console.log(`Found ${data.resultsCount} results:\n`);
      
      data.results.forEach((result: any, index: number) => {
        console.log(`${index + 1}. ${result.title}`);
        console.log(`   URL: ${result.url}`);
        console.log(`   Snippet: ${result.snippet.substring(0, 150)}...`);
        if (result.relevanceScore) {
          console.log(`   Relevance: ${(result.relevanceScore * 100).toFixed(1)}%`);
        }
        console.log();
      });
    }

    console.log('\n📋 Example 2: Regional Search');
    console.log('-' .repeat(50));

    const regionalQuery = 'cryptocurrency regulations India 2024';
    console.log(`Query: "${regionalQuery}" (Region: en-IN)\n`);

    const regionalResult = await webSearchTool.execute(
      { 
        query: regionalQuery, 
        maxResults: 3,
        region: 'en-IN',
        safeSearch: true
      },
      { userId: 'demo-user', sessionId: 'demo-session' }
    );

    if (regionalResult.success && regionalResult.data) {
      const data = regionalResult.data as any;
      console.log(`Found ${data.resultsCount} India-specific results:\n`);
      
      data.results.forEach((result: any, index: number) => {
        console.log(`${index + 1}. ${result.title}`);
        console.log(`   URL: ${result.url}`);
        console.log();
      });
    }

    console.log('\n📋 Example 3: Multiple Providers');
    console.log('-' .repeat(50));

    if (process.env.BING_API_KEY) {
      const bingService = new WebSearchService('bing', process.env.BING_API_KEY);
      const bingSearchTool = createWebSearchTool(bingService);

      const bingResult = await bingSearchTool.execute(
        { query: 'latest technology news', maxResults: 2 },
        { userId: 'demo-user', sessionId: 'demo-session' }
      );

      if (bingResult.success && bingResult.data) {
        const data = bingResult.data as any;
        console.log('Results from Bing:');
        data.results.forEach((result: any, index: number) => {
          console.log(`${index + 1}. ${result.title}`);
        });
      }
    } else {
      console.log('Bing API key not configured. Using default provider.');
    }

  } catch (error) {
    console.error('Error in web search demo:', error);
    if (error instanceof Error && error.message.includes('API key')) {
      console.log('\n⚠️  Please set the SEARCH_API_KEY environment variable.');
      console.log('   For Tavily: Get your API key from https://tavily.com');
      console.log('   For Bing: Get your API key from Azure Cognitive Services');
      console.log('\n   Set in .env file:');
      console.log('   SEARCH_API_KEY=your_api_key_here');
      console.log('   SEARCH_PROVIDER=tavily  # or "bing"');
    }
  }
}

if (require.main === module) {
  console.log('Starting Web Search Tool Demo...\n');
  demonstrateWebSearch()
    .then(() => {
      console.log('\n✅ Demo completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Demo failed:', error);
      process.exit(1);
    });
}