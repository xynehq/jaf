import { Tool, ToolParameterType } from '../adk/types';
import { createFunctionTool } from '../adk/tools';

export interface RegexExtractorParams {
  text: string;
  pattern: string;
  flags?: string;
  extractAll?: boolean;
  groupNames?: string[];
}

export interface RegexExtractorResult {
  matches: Array<{
    match: string;
    index: number;
    groups?: Record<string, string>;
  }>;
  count: number;
  pattern: string;
}

export interface PredefinedPattern {
  name: string;
  pattern: string;
  description: string;
  flags?: string;
}

export const PREDEFINED_PATTERNS: Record<string, PredefinedPattern> = {
  email: {
    name: 'email',
    pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
    description: 'Extract email addresses',
    flags: 'gi'
  },
  phone: {
    name: 'phone',
    pattern: '\\+?[1-9]\\d{0,3}[\\s.-]?\\(?\\d{1,4}\\)?[\\s.-]?\\d{1,4}[\\s.-]?\\d{1,4}',
    description: 'Extract phone numbers (various formats)',
    flags: 'g'
  },
  url: {
    name: 'url',
    pattern: 'https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&\\/\\/=]*)',
    description: 'Extract URLs',
    flags: 'gi'
  },
  ipv4: {
    name: 'ipv4',
    pattern: '\\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\b',
    description: 'Extract IPv4 addresses',
    flags: 'g'
  },
  date: {
    name: 'date',
    pattern: '\\b\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4}\\b|\\b\\d{4}[\\/\\-]\\d{1,2}[\\/\\-]\\d{1,2}\\b',
    description: 'Extract dates (MM/DD/YYYY, DD/MM/YYYY, YYYY/MM/DD)',
    flags: 'g'
  },
  time: {
    name: 'time',
    pattern: '\\b(?:[01]?[0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?(?:\\s?[AP]M)?\\b',
    description: 'Extract time (12/24 hour format)',
    flags: 'gi'
  },
  creditCard: {
    name: 'creditCard',
    pattern: '\\b(?:\\d[ -]*?){13,16}\\b',
    description: 'Extract credit card numbers',
    flags: 'g'
  },
  ssn: {
    name: 'ssn',
    pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b',
    description: 'Extract SSN (XXX-XX-XXXX format)',
    flags: 'g'
  },
  zipCode: {
    name: 'zipCode',
    pattern: '\\b\\d{5}(?:-\\d{4})?\\b',
    description: 'Extract US ZIP codes',
    flags: 'g'
  },
  hashtag: {
    name: 'hashtag',
    pattern: '#[a-zA-Z0-9_]+',
    description: 'Extract hashtags',
    flags: 'g'
  },
  mention: {
    name: 'mention',
    pattern: '@[a-zA-Z0-9_]+',
    description: 'Extract mentions/usernames',
    flags: 'g'
  },
  uuid: {
    name: 'uuid',
    pattern: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    description: 'Extract UUIDs',
    flags: 'gi'
  },
  invoiceNumber: {
    name: 'invoiceNumber',
    pattern: '(?:INV|Invoice|inv)[-\\s]?(?:#\\s?)?([A-Z0-9]{2,}-?[0-9]{3,})',
    description: 'Extract invoice numbers',
    flags: 'gi'
  },
  orderId: {
    name: 'orderId',
    pattern: '(?:Order|ORD|order)[-\\s]?(?:#\\s?)?([A-Z0-9]{2,}-?[0-9]{3,})',
    description: 'Extract order IDs',
    flags: 'gi'
  },
  trackingNumber: {
    name: 'trackingNumber',
    pattern: '\\b(?:1Z[0-9A-Z]{16}|[0-9]{20,22})\\b',
    description: 'Extract tracking numbers (UPS, FedEx)',
    flags: 'g'
  },
  price: {
    name: 'price',
    pattern: '\\$\\s?\\d+(?:,\\d{3})*(?:\\.\\d{2})?',
    description: 'Extract prices in USD format',
    flags: 'g'
  },
  percentage: {
    name: 'percentage',
    pattern: '\\b\\d+(?:\\.\\d+)?\\s?%',
    description: 'Extract percentages',
    flags: 'g'
  }
};

function extractWithRegex(params: RegexExtractorParams): RegexExtractorResult {
  const { text, pattern, flags = 'g', extractAll = true, groupNames } = params;
  
  try {
    const regex = new RegExp(pattern, flags);
    const matches: RegexExtractorResult['matches'] = [];
    
    if (extractAll && flags.includes('g')) {
      let match;
      while ((match = regex.exec(text)) !== null) {
        const matchResult: any = {
          match: match[0],
          index: match.index
        };
        
        if (match.groups || (groupNames && match.length > 1)) {
          matchResult.groups = {};
          
          if (match.groups) {
            matchResult.groups = { ...match.groups };
          }
          
          if (groupNames) {
            for (let i = 1; i < match.length && i <= groupNames.length; i++) {
              matchResult.groups[groupNames[i - 1]] = match[i];
            }
          }
        }
        
        matches.push(matchResult);
      }
    } else {
      const match = text.match(regex);
      if (match) {
        const matchResult: any = {
          match: match[0],
          index: match.index || 0
        };
        
        if (match.groups || (groupNames && match.length > 1)) {
          matchResult.groups = {};
          
          if (match.groups) {
            matchResult.groups = { ...match.groups };
          }
          
          if (groupNames) {
            for (let i = 1; i < match.length && i <= groupNames.length; i++) {
              matchResult.groups[groupNames[i - 1]] = match[i];
            }
          }
        }
        
        matches.push(matchResult);
      }
    }
    
    return {
      matches,
      count: matches.length,
      pattern
    };
  } catch (error) {
    throw new Error(`Invalid regex pattern: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export const regexExtractorTool: Tool = createFunctionTool({
  name: 'regexExtractor',
  description: 'Extract patterns from text using regular expressions or predefined patterns',
  execute: async (params) => {
    const typedParams = params as RegexExtractorParams;
    return extractWithRegex(typedParams);
  },
  parameters: [
    {
      name: 'text',
      type: ToolParameterType.STRING,
      description: 'The text to extract patterns from',
      required: true
    },
    {
      name: 'pattern',
      type: ToolParameterType.STRING,
      description: 'Regular expression pattern or predefined pattern name (email, phone, url, etc.)',
      required: true
    },
    {
      name: 'flags',
      type: ToolParameterType.STRING,
      description: 'Regex flags (g, i, m, s, etc.). Default: "g"',
      required: false,
      default: 'g'
    },
    {
      name: 'extractAll',
      type: ToolParameterType.BOOLEAN,
      description: 'Extract all matches or just the first one. Default: true',
      required: false,
      default: true
    },
    {
      name: 'groupNames',
      type: ToolParameterType.ARRAY,
      description: 'Names for capturing groups in order',
      required: false
    }
  ]
});

export const predefinedPatternExtractorTool: Tool = createFunctionTool({
  name: 'extractWithPattern',
  description: 'Extract common patterns (emails, phones, URLs, etc.) from text',
  execute: async (params) => {
    const { text, patternName } = params as { text: string; patternName: string };
    
    const predefinedPattern = PREDEFINED_PATTERNS[patternName];
    if (!predefinedPattern) {
      const availablePatterns = Object.keys(PREDEFINED_PATTERNS).join(', ');
      throw new Error(`Unknown pattern: ${patternName}. Available patterns: ${availablePatterns}`);
    }
    
    return extractWithRegex({
      text,
      pattern: predefinedPattern.pattern,
      flags: predefinedPattern.flags || 'g',
      extractAll: true
    });
  },
  parameters: [
    {
      name: 'text',
      type: ToolParameterType.STRING,
      description: 'The text to extract patterns from',
      required: true
    },
    {
      name: 'patternName',
      type: ToolParameterType.STRING,
      description: `Predefined pattern name. Options: ${Object.keys(PREDEFINED_PATTERNS).join(', ')}`,
      required: true
    }
  ]
});

export function createCustomExtractor(
  name: string,
  pattern: string,
  description: string,
  flags: string = 'g'
): Tool {
  return createFunctionTool({
    name,
    description,
    execute: async (params) => {
      const { text } = params as { text: string };
      return extractWithRegex({
        text,
        pattern,
        flags,
        extractAll: true
      });
    },
    parameters: [
      {
        name: 'text',
        type: ToolParameterType.STRING,
        description: 'The text to extract patterns from',
        required: true
      }
    ]
  });
}

export { extractWithRegex };