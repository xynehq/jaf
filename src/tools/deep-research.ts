/**
 * Deep Research Tool for JAF
 * 
 * A comprehensive research tool inspired by LangChain's Open Deep Research
 * that performs structured multi-step research with citations.
 */

import { z } from 'zod';
import { Tool } from '../core/types';
import { ToolResult, ToolResponse, ToolErrorCodes } from '../core/tool-results';
import { ChatOpenAI } from '@langchain/openai';
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Document } from '@langchain/core/documents';
import { RunnableSequence } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { PromptTemplate } from '@langchain/core/prompts';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';

// ========== Configuration Types ==========

export interface DeepResearchContext {
  apiKey?: string;
  modelName?: string;
  maxSearchResults?: number;
  maxDepth?: number;
  vectorDB?: {
    search: (query: string, limit: number) => Promise<Document[]>;
  };
  searchAPI?: 'tavily' | 'web' | 'none';
  tavilyApiKey?: string;
}

// ========== Schema Definition ==========

const deepResearchSchema = z.object({
  query: z.string().describe('The main research query to investigate'),
  maxDepth: z.number().default(2).describe('Maximum depth of research iterations'),
  maxSearchResults: z.number().default(3).describe('Maximum search results per sub-query'),
  includeVectorDB: z.boolean().default(false).describe('Include vector database results if available'),
  allowClarification: z.boolean().default(true).describe('Allow clarifying questions before research'),
});

export type DeepResearchParams = z.infer<typeof deepResearchSchema>;

// ========== Data Structures ==========

interface ResearchResult {
  query: string;
  source: string;
  content: string;
  relevanceScore: number;
  timestamp: string;
  url?: string;
}

interface ResearchReport {
  mainQuery: string;
  subQueries: string[];
  findings: ResearchResult[];
  synthesis: string;
  citations: string[];
  timestamp: string;
}

interface SubQuery {
  question: string;
  priority: number;
  category: 'technical' | 'policy' | 'impact' | 'case_study' | 'general';
}

// ========== Prompts ==========

const CLARIFY_USER_PROMPT = `
You are a research assistant. Review the user's research query and determine if clarification is needed.

Query: {query}

Assess whether you need to ask a clarifying question, or if the query provides enough information to start research.

Guidelines:
- If acronyms, abbreviations, or unknown terms need clarification, ask about them
- If the scope is too broad or vague, ask for specific focus areas
- If you have enough information, proceed with research

Return a JSON response with:
{{
  "needsClarification": boolean,
  "question": "clarifying question if needed",
  "researchBrief": "refined research question if ready to proceed"
}}
`;

const GENERATE_SUBQUERIES_PROMPT = `
You are a research strategist. Given a main research query, generate 3-5 specific sub-queries that would help comprehensively answer the main question.

Main Query: {query}

Generate sub-queries that cover different aspects:
- Technical implementation details
- Current state and recent developments  
- Policy and regulatory aspects
- Impact and implications
- Case studies or real-world examples

Output format (JSON):
{{
  "subQueries": [
    {{"question": "...", "priority": 1-5, "category": "technical|policy|impact|case_study|general"}},
    ...
  ]
}}
`;

const SYNTHESIZE_FINDINGS_PROMPT = `
You are a research analyst. Synthesize the following research findings into a comprehensive report.

Main Query: {mainQuery}

Sub-queries investigated:
{subQueries}

Key Findings:
{findings}

Create a structured report with:
1. Executive Summary
2. Key Findings (organized by theme)
3. Analysis and Implications
4. Recommendations
5. Areas for Further Research

Include [citation markers] where appropriate referencing the source URLs.
Format the report in clear markdown with proper structure.
`;

const SCORE_RELEVANCE_PROMPT = `
Rate the relevance of the following content to the query on a scale of 0-100.

Query: {query}
Content: {content}

Consider:
- Direct relevance to the query topic
- Quality and credibility of information
- Recency and timeliness
- Depth of detail provided

Output only a number between 0-100:
`;

// ========== Research Workflow Implementation ==========

class DeepResearchWorkflow {
  private llm: ChatOpenAI;
  private splitter: RecursiveCharacterTextSplitter;
  private tavilyApiKey?: string;
  
  constructor(
    apiKey: string, 
    modelName: string = 'gpt-4-turbo-preview',
    tavilyApiKey?: string
  ) {
    this.llm = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName,
      temperature: 0.1,
    });
    
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 2000,
      chunkOverlap: 200,
    });
    
    this.tavilyApiKey = tavilyApiKey;
  }

  async checkClarification(query: string): Promise<{
    needsClarification: boolean;
    question?: string;
    researchBrief?: string;
  }> {
    const prompt = PromptTemplate.fromTemplate(CLARIFY_USER_PROMPT);
    
    const chain = RunnableSequence.from([
      prompt,
      this.llm,
      new StringOutputParser(),
    ]);

    const result = await chain.invoke({ query });
    
    try {
      return JSON.parse(result);
    } catch {
      return {
        needsClarification: false,
        researchBrief: query
      };
    }
  }

  async generateSubQueries(mainQuery: string): Promise<SubQuery[]> {
    const prompt = PromptTemplate.fromTemplate(GENERATE_SUBQUERIES_PROMPT);

    const chain = RunnableSequence.from([
      prompt,
      this.llm,
      new StringOutputParser(),
    ]);

    const result = await chain.invoke({ query: mainQuery });
    
    try {
      const parsed = JSON.parse(result);
      return parsed.subQueries || [];
    } catch {
      // Fallback to simple sub-queries if parsing fails
      return [
        { question: `What is the current state of ${mainQuery}?`, priority: 1, category: 'general' },
        { question: `What are the key developments in ${mainQuery}?`, priority: 2, category: 'technical' },
        { question: `What are the implications of ${mainQuery}?`, priority: 3, category: 'impact' },
      ];
    }
  }

  async searchWeb(query: string, maxResults: number = 3): Promise<Document[]> {
    // If Tavily API key is available, use Tavily search
    if (this.tavilyApiKey) {
      return this.searchWithTavily(query, maxResults);
    }
    
    // Otherwise, generate synthetic search URLs and fetch content
    const searchUrls = await this.generateSearchUrls(query, maxResults);
    const documents: Document[] = [];
    
    for (const url of searchUrls) {
      try {
        const loader = new CheerioWebBaseLoader(url);
        const docs = await loader.load();
        
        if (docs.length > 0) {
          const splitDocs = await this.splitter.splitDocuments(docs);
          documents.push(...splitDocs.slice(0, 2));
        }
      } catch (error) {
        console.warn(`Failed to load ${url}:`, error);
      }
    }
    
    return documents;
  }

  private async searchWithTavily(query: string, maxResults: number): Promise<Document[]> {
    // Note: This is a placeholder for Tavily integration
    // In production, you would use the actual Tavily API
    console.log(`Would search Tavily for: ${query} (max ${maxResults} results)`);
    return [];
  }

  private async generateSearchUrls(query: string, maxResults: number): Promise<string[]> {
    const prompt = PromptTemplate.fromTemplate(`
      Generate {maxResults} relevant URLs that would contain information about: {query}
      
      Focus on:
      - Official documentation and whitepapers
      - Recent news articles from reputable sources
      - Academic papers and research
      - Government and regulatory websites
      - Industry reports
      
      Output format (one URL per line):
      https://...
      https://...
    `);

    const chain = RunnableSequence.from([
      prompt,
      this.llm,
      new StringOutputParser(),
    ]);

    const result = await chain.invoke({ query, maxResults });
    
    return result
      .split('\n')
      .filter(line => line.startsWith('http'))
      .slice(0, maxResults);
  }

  async scoreRelevance(query: string, content: string): Promise<number> {
    const prompt = PromptTemplate.fromTemplate(SCORE_RELEVANCE_PROMPT);

    const chain = RunnableSequence.from([
      prompt,
      this.llm,
      new StringOutputParser(),
    ]);

    const result = await chain.invoke({ query, content });
    return Math.min(100, Math.max(0, parseInt(result) || 50));
  }

  async rankAndDeduplicate(results: ResearchResult[]): Promise<ResearchResult[]> {
    const uniqueResults = new Map<string, ResearchResult>();
    
    // Deduplicate by source and content similarity
    for (const result of results) {
      const key = `${result.source}-${result.content.substring(0, 100)}`;
      if (!uniqueResults.has(key) || uniqueResults.get(key)!.relevanceScore < result.relevanceScore) {
        uniqueResults.set(key, result);
      }
    }
    
    // Sort by relevance score and return top results
    return Array.from(uniqueResults.values())
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 10);
  }

  async synthesizeReport(
    mainQuery: string,
    subQueries: string[],
    findings: ResearchResult[]
  ): Promise<string> {
    const prompt = PromptTemplate.fromTemplate(SYNTHESIZE_FINDINGS_PROMPT);

    const chain = RunnableSequence.from([
      prompt,
      this.llm,
      new StringOutputParser(),
    ]);

    const findingsText = findings
      .map(f => `Source: ${f.source}\nURL: ${f.url || 'N/A'}\nContent: ${f.content}\nRelevance: ${f.relevanceScore}`)
      .join('\n\n---\n\n');

    return await chain.invoke({
      mainQuery,
      subQueries: subQueries.join('\n- '),
      findings: findingsText,
    });
  }
}

// ========== Deep Research Supervisor ==========

class ResearchSupervisor {
  private workflow: DeepResearchWorkflow;
  private maxConcurrentResearchers: number;
  
  constructor(workflow: DeepResearchWorkflow, maxConcurrent: number = 3) {
    this.workflow = workflow;
    this.maxConcurrentResearchers = maxConcurrent;
  }

  async conductResearch(
    mainQuery: string,
    subQueries: SubQuery[],
    maxDepth: number,
    maxSearchResults: number,
    vectorDB?: DeepResearchContext['vectorDB']
  ): Promise<ResearchResult[]> {
    const allFindings: ResearchResult[] = [];
    
    // Process sub-queries in batches to respect concurrency limits
    const prioritizedQueries = subQueries.sort((a, b) => a.priority - b.priority);
    
    for (let depth = 0; depth < maxDepth; depth++) {
      const batchSize = this.maxConcurrentResearchers;
      
      for (let i = 0; i < prioritizedQueries.length; i += batchSize) {
        const batch = prioritizedQueries.slice(i, i + batchSize);
        
        // Execute batch of research tasks in parallel
        const batchResults = await Promise.all(
          batch.map(sq => this.researchSubQuery(sq, maxSearchResults, vectorDB))
        );
        
        // Flatten and add results
        allFindings.push(...batchResults.flat());
      }
      
      // After each depth iteration, refine queries based on findings
      if (depth < maxDepth - 1) {
        const topFindings = await this.workflow.rankAndDeduplicate(allFindings);
        
        // Generate follow-up queries based on gaps
        const gaps = await this.identifyGaps(mainQuery, topFindings);
        if (gaps.length > 0) {
          prioritizedQueries.push(...gaps);
        }
      }
    }
    
    return allFindings;
  }

  private async researchSubQuery(
    subQuery: SubQuery,
    maxSearchResults: number,
    vectorDB?: DeepResearchContext['vectorDB']
  ): Promise<ResearchResult[]> {
    const results: ResearchResult[] = [];
    
    // Search web sources
    const webDocs = await this.workflow.searchWeb(subQuery.question, maxSearchResults);
    
    for (const doc of webDocs) {
      const relevanceScore = await this.workflow.scoreRelevance(
        subQuery.question,
        doc.pageContent.substring(0, 500)
      );
      
      results.push({
        query: subQuery.question,
        source: doc.metadata.source || 'web',
        content: doc.pageContent,
        relevanceScore,
        timestamp: new Date().toISOString(),
        url: doc.metadata.source,
      });
    }
    
    // Search vector database if available
    if (vectorDB) {
      const vectorResults = await vectorDB.search(subQuery.question, 3);
      
      for (const doc of vectorResults) {
        const relevanceScore = await this.workflow.scoreRelevance(
          subQuery.question,
          doc.pageContent.substring(0, 500)
        );
        
        results.push({
          query: subQuery.question,
          source: doc.metadata.source || 'vectorDB',
          content: doc.pageContent,
          relevanceScore,
          timestamp: new Date().toISOString(),
        });
      }
    }
    
    return results;
  }

  private async identifyGaps(mainQuery: string, currentFindings: ResearchResult[]): Promise<SubQuery[]> {
    // Analyze current findings to identify information gaps
    const coveredTopics = new Set(currentFindings.map(f => f.query));
    
    // This is a simplified gap analysis
    // In production, you would use the LLM to analyze gaps more intelligently
    const potentialGaps: SubQuery[] = [];
    
    if (currentFindings.length < 3) {
      potentialGaps.push({
        question: `What are alternative perspectives on ${mainQuery}?`,
        priority: 4,
        category: 'general'
      });
    }
    
    return potentialGaps;
  }
}

// ========== Main Tool Implementation ==========

export const createDeepResearchTool = <Ctx extends DeepResearchContext>(
  defaultContext?: Partial<DeepResearchContext>
): Tool<DeepResearchParams, Ctx> => {
  return {
    schema: {
      name: 'deepResearch',
      description: 'Performs deep multi-step research with sub-query decomposition, parallel research execution, and comprehensive report synthesis with citations',
      parameters: deepResearchSchema as z.ZodType<DeepResearchParams>,
    },
    
    execute: async (params, context) => {
      // Step 1: Validate API key
      const apiKey = context.apiKey || defaultContext?.apiKey || process.env.OPENAI_API_KEY;
      
      if (!apiKey) {
        return ToolResponse.error(
          ToolErrorCodes.INVALID_INPUT,
          'OpenAI API key is required for deep research'
        );
      }

      // Step 2: Initialize workflow components
      const workflow = new DeepResearchWorkflow(
        apiKey,
        context.modelName || defaultContext?.modelName || 'gpt-4-turbo-preview',
        context.tavilyApiKey || defaultContext?.tavilyApiKey
      );
      
      const supervisor = new ResearchSupervisor(
        workflow,
        context.maxSearchResults || defaultContext?.maxSearchResults || 3
      );

      try {
        // Step 3: Check if clarification is needed
        if (params.allowClarification) {
          const clarification = await workflow.checkClarification(params.query);
          
          if (clarification.needsClarification) {
            return ToolResponse.success({
              type: 'clarification_needed',
              question: clarification.question,
              originalQuery: params.query,
            });
          }
        }

        // Step 4: Generate sub-queries for research
        const subQueries = await workflow.generateSubQueries(params.query);
        
        // Step 5: Conduct parallel research through supervisor
        const allFindings = await supervisor.conductResearch(
          params.query,
          subQueries,
          params.maxDepth,
          params.maxSearchResults,
          params.includeVectorDB ? context.vectorDB : undefined
        );
        
        // Step 6: Rank and deduplicate findings
        const rankedFindings = await workflow.rankAndDeduplicate(allFindings);
        
        // Step 7: Synthesize comprehensive report
        const synthesis = await workflow.synthesizeReport(
          params.query,
          subQueries.map(sq => sq.question),
          rankedFindings
        );
        
        // Step 8: Extract unique citations
        const citations = [...new Set(rankedFindings.map(f => f.url || f.source))];
        
        // Step 9: Create final research report
        const report: ResearchReport = {
          mainQuery: params.query,
          subQueries: subQueries.map(sq => sq.question),
          findings: rankedFindings,
          synthesis,
          citations,
          timestamp: new Date().toISOString(),
        };
        
        return ToolResponse.success(report);
        
      } catch (error) {
        return ToolResponse.error(
          ToolErrorCodes.EXECUTION_FAILED,
          error instanceof Error ? error.message : 'Unknown error during research',
          { error }
        );
      }
    },
  };
};

// ========== Simplified Research Tool ==========

export const createSimpleResearchTool = <Ctx extends DeepResearchContext>(
  defaultContext?: Partial<DeepResearchContext>
): Tool<{ query: string }, Ctx> => {
  const simpleSchema = z.object({
    query: z.string().describe('The research query to investigate'),
  });

  return {
    schema: {
      name: 'simpleResearch',
      description: 'Performs quick research on a topic with automatic configuration',
      parameters: simpleSchema as z.ZodType<{ query: string }>,
    },
    
    execute: async (params, context) => {
      // Use the deep research tool with default settings
      const deepResearchTool = createDeepResearchTool(defaultContext);
      
      return deepResearchTool.execute(
        {
          query: params.query,
          maxDepth: 1,
          maxSearchResults: 3,
          includeVectorDB: false,
          allowClarification: false,
        },
        context
      );
    },
  };
};

// Export default instance
export const deepResearchTool = createDeepResearchTool();
export const simpleResearchTool = createSimpleResearchTool();