import { z } from 'zod';
import { Tool } from '../core/types';
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

// Dictionary tool schema
const dictionarySchema = z.object({
  term: z.string().describe('The payment/fintech term to look up (e.g., "UPI", "3DS", "tokenization")'),
  context: z.string().optional().describe('Optional context for more specific explanation'),
  detailed: z.boolean().default(true).describe('Whether to include examples and related terms')
});

type DictionaryArgs = z.infer<typeof dictionarySchema>;
type DictionaryContext = Record<string, any>;

/**
 * Main dictionary tool for looking up payment terms
 */
export const dictionaryTool: Tool<DictionaryArgs, DictionaryContext> = {
  schema: {
    name: 'dictionary',
    description: 'Look up definitions and explanations for Juspay/payment industry terms',
    parameters: dictionarySchema
  },
  needsApproval: false,
  execute: async ({ term, context, detailed = true }) => {
    // First, try to find exact match in glossary
    const termData = findTerm(term);
    
    if (termData) {
      let response = formatTermResponse(termData, detailed);
      
      if (context) {
        response += `\n\n**In your context:** This relates to ${context}`;
      }
      
      return response;
    }
    
    // Search for similar terms
    const similar = searchTerms(term);
    
    if (similar.length > 0) {
      let response = `Term "${term}" not found exactly, but found similar terms:\n\n`;
      similar.slice(0, 3).forEach(t => {
        response += `• **${t.term}**: ${t.definition.substring(0, 100)}...\n`;
      });
      return response;
    }
    
    return `No definition found for "${term}" in the payment glossary. This might be a specific implementation term or business-specific terminology.`;
  }
};

// Batch dictionary lookup schema
const batchDictionarySchema = z.object({
  terms: z.array(z.string()).describe('Array of terms to look up')
});

type BatchDictionaryArgs = z.infer<typeof batchDictionarySchema>;

/**
 * Batch lookup tool for multiple terms
 */
export const batchDictionaryTool: Tool<BatchDictionaryArgs, DictionaryContext> = {
  schema: {
    name: 'batchDictionary',
    description: 'Look up multiple payment/fintech terms at once',
    parameters: batchDictionarySchema
  },
  needsApproval: false,
  execute: async ({ terms }) => {
    const results: string[] = [];
    
    for (const term of terms) {
      const termData = findTerm(term);
      if (termData) {
        results.push(`**${term}**${termData.fullForm ? ` (${termData.fullForm})` : ''}: ${termData.definition}`);
      } else {
        results.push(`**${term}**: Not found in glossary`);
      }
    }
    
    return results.join('\n\n');
  }
};

// Search glossary schema
const searchGlossarySchema = z.object({
  keyword: z.string().describe('Keyword to search for in terms and definitions'),
  category: z.string().optional().describe('Optional category filter')
});

type SearchGlossaryArgs = z.infer<typeof searchGlossarySchema>;

/**
 * Search tool for finding terms by keyword
 */
export const searchGlossaryTool: Tool<SearchGlossaryArgs, DictionaryContext> = {
  schema: {
    name: 'searchGlossary',
    description: 'Search the payment glossary for terms containing a keyword',
    parameters: searchGlossarySchema
  },
  needsApproval: false,
  execute: async ({ keyword, category }) => {
    let results = searchTerms(keyword);
    
    if (category) {
      results = results.filter(term => term.category === category);
    }
    
    if (results.length === 0) {
      return `No terms found matching "${keyword}"${category ? ` in category "${category}"` : ''}`;
    }
    
    let response = `Found ${results.length} terms matching "${keyword}"${category ? ` in category "${category}"` : ''}:\n\n`;
    
    results.slice(0, 10).forEach(term => {
      response += `• **${term.term}**: ${term.definition.substring(0, 100)}...\n`;
    });
    
    if (results.length > 10) {
      response += `\n...and ${results.length - 10} more terms`;
    }
    
    return response;
  }
};

// List categories schema (no parameters)
const listCategoriesSchema = z.object({});

type ListCategoriesArgs = z.infer<typeof listCategoriesSchema>;

/**
 * Tool for listing all available categories
 */
export const listCategoriesTool: Tool<ListCategoriesArgs, DictionaryContext> = {
  schema: {
    name: 'listCategories',
    description: 'List all available categories in the payment glossary',
    parameters: listCategoriesSchema
  },
  needsApproval: false,
  execute: async () => {
    let response = 'Available payment term categories:\n\n';
    
    for (const [key, description] of Object.entries(glossary.categories)) {
      const termsInCategory = Object.values(glossary.terms)
        .filter(term => term.category === key)
        .map(term => term.term);
      
      response += `**${key}** (${termsInCategory.length} terms)\n`;
      response += `  ${description}\n`;
      response += `  Examples: ${termsInCategory.slice(0, 3).join(', ')}\n\n`;
    }
    
    return response;
  }
};

// Export all dictionary tools
export const dictionaryTools = [
  dictionaryTool,
  batchDictionaryTool,
  searchGlossaryTool,
  listCategoriesTool
];

export default dictionaryTool;