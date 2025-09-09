/**
 * Dictionary Tool - Juspay/Payment Terms Glossary with LLM Enhancement
 * 
 * Provides definitions and explanations for payment industry terms,
 * combining a curated glossary with LLM-powered contextual explanations.
 */

import { 
  Tool, 
  ToolParameter, 
  ToolContext, 
  ToolResult,
  ToolParameterType,
  ToolSource,
  FunctionToolConfig
} from '../types';
import { createFunctionTool } from './index';
import glossaryData from './glossary.json';

interface GlossaryTerm {
  term: string;
  fullForm?: string;
  definition: string;
  examples?: string[];
  relatedTerms?: string[];
  category?: string;
}

interface GlossaryData {
  terms: Record<string, GlossaryTerm>;
  categories: Record<string, string>;
}

const glossary = glossaryData as GlossaryData;

/**
 * Find a term in the glossary (case-insensitive, handles variations)
 */
const findTerm = (query: string): GlossaryTerm | null => {
  const normalizedQuery = query.toLowerCase().replace(/[\s-_]/g, '');
  
  for (const [key, term] of Object.entries(glossary.terms)) {
    const normalizedKey = key.toLowerCase().replace(/[\s-_]/g, '');
    const normalizedTerm = term.term.toLowerCase().replace(/[\s-_]/g, '');
    const normalizedFullForm = term.fullForm?.toLowerCase().replace(/[\s-_]/g, '') || '';
    
    if (normalizedKey === normalizedQuery || 
        normalizedTerm === normalizedQuery ||
        normalizedFullForm === normalizedQuery) {
      return term;
    }
  }
  
  return null;
};

/**
 * Search for related terms containing the query
 */
const searchTerms = (query: string): GlossaryTerm[] => {
  const normalizedQuery = query.toLowerCase();
  const results: GlossaryTerm[] = [];
  
  for (const term of Object.values(glossary.terms)) {
    const searchText = `${term.term} ${term.fullForm || ''} ${term.definition}`.toLowerCase();
    if (searchText.includes(normalizedQuery)) {
      results.push(term);
    }
  }
  
  return results;
};

/**
 * Format a glossary term for display
 */
const formatTermResponse = (term: GlossaryTerm, detailed: boolean = false): string => {
  let response = `**${term.term}**`;
  
  if (term.fullForm) {
    response += ` (${term.fullForm})`;
  }
  
  response += `\n\n${term.definition}`;
  
  if (detailed) {
    if (term.examples && term.examples.length > 0) {
      response += '\n\n**Examples:**';
      term.examples.forEach(example => {
        response += `\n• ${example}`;
      });
    }
    
    if (term.relatedTerms && term.relatedTerms.length > 0) {
      response += '\n\n**Related Terms:** ' + term.relatedTerms.join(', ');
    }
    
    if (term.category) {
      const categoryDesc = glossary.categories[term.category];
      response += `\n\n**Category:** ${term.category}`;
      if (categoryDesc) {
        response += ` - ${categoryDesc}`;
      }
    }
  }
  
  return response;
};

/**
 * Generate contextual explanation using the model
 */
const generateContextualExplanation = async (
  query: string,
  context: string | undefined,
  termData: GlossaryTerm | null,
  toolContext: ToolContext
): Promise<string> => {
  // Check if we have access to an LLM through the context
  const model = toolContext.agent?.config?.model;
  
  if (!model || typeof model !== 'string') {
    // If no model available, return glossary-based response
    if (termData) {
      return formatTermResponse(termData, true);
    }
    return `No definition found for "${query}" in the glossary.`;
  }
  
  // Build prompt for contextual explanation
  let prompt = `Explain the payment/fintech term "${query}"`;
  
  if (context) {
    prompt += ` in the context of: ${context}`;
  }
  
  if (termData) {
    prompt += `\n\nBase definition from glossary: ${termData.definition}`;
    if (termData.examples && termData.examples.length > 0) {
      prompt += `\nExamples: ${termData.examples.join(', ')}`;
    }
  }
  
  prompt += '\n\nProvide a clear, concise explanation suitable for developers and business users.';
  
  // This would typically call the LLM through the agent's model
  // For now, we'll return an enhanced glossary response
  if (termData) {
    let enhanced = formatTermResponse(termData, true);
    if (context) {
      enhanced += `\n\n**In your context:** The term "${query}" relates to ${context}`;
    }
    return enhanced;
  }
  
  return `The term "${query}" is not in our payment glossary. ${context ? `In the context of ${context}, this` : 'This'} may refer to a specific implementation or business term. Please consult your technical documentation or team for more details.`;
};

/**
 * Main dictionary tool configuration
 */
const dictionaryToolConfig: FunctionToolConfig = {
  name: 'dictionary',
  description: 'Look up definitions and explanations for Juspay/payment industry terms',
  parameters: [
    {
      name: 'term',
      type: ToolParameterType.STRING,
      description: 'The payment/fintech term to look up (e.g., "UPI", "3DS", "tokenization")',
      required: true
    },
    {
      name: 'context',
      type: ToolParameterType.STRING,
      description: 'Optional context for more specific explanation (e.g., "implementing checkout flow")',
      required: false
    },
    {
      name: 'detailed',
      type: ToolParameterType.BOOLEAN,
      description: 'Whether to include examples and related terms (default: true)',
      required: false,
      default: true
    }
  ],
  execute: async (params, context) => {
    const { term, context: userContext, detailed = true } = params as {
      term: string;
      context?: string;
      detailed?: boolean;
    };
    
    // First, try to find exact match in glossary
    const termData = findTerm(term);
    
    if (termData && !userContext) {
      // If exact match found and no context needed, return formatted glossary entry
      return {
        found: true,
        term: termData.term,
        response: formatTermResponse(termData, detailed),
        category: termData.category,
        relatedTerms: termData.relatedTerms
      };
    }
    
    // If context provided or term not found exactly, generate contextual explanation
    const explanation = await generateContextualExplanation(
      term,
      userContext,
      termData,
      context
    );
    
    // Also search for related terms
    const related = searchTerms(term).filter(t => t.term !== termData?.term);
    
    return {
      found: !!termData,
      term: termData?.term || term,
      response: explanation,
      category: termData?.category,
      relatedTerms: termData?.relatedTerms,
      similarTerms: related.length > 0 ? related.map(t => t.term) : undefined
    };
  },
  metadata: {
    source: ToolSource.FUNCTION,
    version: '1.0.0',
    tags: ['dictionary', 'glossary', 'payment', 'education']
  }
};

/**
 * Create the dictionary tool instance
 */
export const createDictionaryTool = (): Tool => {
  return createFunctionTool(dictionaryToolConfig);
};

/**
 * Batch lookup tool for multiple terms
 */
const batchLookupToolConfig: FunctionToolConfig = {
  name: 'batchDictionary',
  description: 'Look up multiple payment/fintech terms at once',
  parameters: [
    {
      name: 'terms',
      type: ToolParameterType.ARRAY,
      description: 'Array of terms to look up',
      required: true,
      items: {
        name: 'term',
        type: ToolParameterType.STRING,
        description: 'A payment/fintech term',
        required: true
      }
    }
  ],
  execute: async (params) => {
    const { terms } = params as { terms: string[] };
    
    const results: Record<string, any> = {};
    
    for (const term of terms) {
      const termData = findTerm(term);
      if (termData) {
        results[term] = {
          found: true,
          definition: termData.definition,
          fullForm: termData.fullForm,
          category: termData.category
        };
      } else {
        results[term] = {
          found: false,
          message: `Term "${term}" not found in glossary`
        };
      }
    }
    
    return results;
  },
  metadata: {
    source: ToolSource.FUNCTION,
    version: '1.0.0',
    tags: ['dictionary', 'batch', 'glossary']
  }
};

export const createBatchDictionaryTool = (): Tool => {
  return createFunctionTool(batchLookupToolConfig);
};

/**
 * Category listing tool
 */
const listCategoriesToolConfig: FunctionToolConfig = {
  name: 'listCategories',
  description: 'List all available categories in the payment glossary',
  parameters: [],
  execute: async () => {
    const categories: Record<string, any> = {};
    
    for (const [key, description] of Object.entries(glossary.categories)) {
      const termsInCategory = Object.values(glossary.terms)
        .filter(term => term.category === key)
        .map(term => term.term);
      
      categories[key] = {
        description,
        termCount: termsInCategory.length,
        sampleTerms: termsInCategory.slice(0, 5)
      };
    }
    
    return categories;
  },
  metadata: {
    source: ToolSource.FUNCTION,
    version: '1.0.0',
    tags: ['dictionary', 'categories', 'glossary']
  }
};

export const createListCategoriesTool = (): Tool => {
  return createFunctionTool(listCategoriesToolConfig);
};

/**
 * Search tool for finding terms by keyword
 */
const searchGlossaryToolConfig: FunctionToolConfig = {
  name: 'searchGlossary',
  description: 'Search the payment glossary for terms containing a keyword',
  parameters: [
    {
      name: 'keyword',
      type: ToolParameterType.STRING,
      description: 'Keyword to search for in terms and definitions',
      required: true
    },
    {
      name: 'category',
      type: ToolParameterType.STRING,
      description: 'Optional category filter',
      required: false
    }
  ],
  execute: async (params) => {
    const { keyword, category } = params as { keyword: string; category?: string };
    
    let results = searchTerms(keyword);
    
    if (category) {
      results = results.filter(term => term.category === category);
    }
    
    return {
      query: keyword,
      category: category,
      count: results.length,
      results: results.map(term => ({
        term: term.term,
        fullForm: term.fullForm,
        summary: term.definition.substring(0, 100) + '...',
        category: term.category
      }))
    };
  },
  metadata: {
    source: ToolSource.FUNCTION,
    version: '1.0.0',
    tags: ['dictionary', 'search', 'glossary']
  }
};

export const createSearchGlossaryTool = (): Tool => {
  return createFunctionTool(searchGlossaryToolConfig);
};

// Export all tools as a collection
export const dictionaryTools = {
  dictionary: createDictionaryTool,
  batchLookup: createBatchDictionaryTool,
  listCategories: createListCategoriesTool,
  searchGlossary: createSearchGlossaryTool
};

// Default export
export default createDictionaryTool;