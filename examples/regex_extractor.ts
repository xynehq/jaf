#!/usr/bin/env npx tsx
/**
 * Regex Extractor Tool Example
 * 
 * Demonstrates extracting various patterns from different types of text:
 * - Emails from support transcripts
 * - Order IDs and invoice numbers from business documents
 * - IP addresses, UUIDs, and timestamps from server logs
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { 
  regexExtractorTool, 
  predefinedPatternExtractorTool,
  createCustomExtractor,
  PREDEFINED_PATTERNS 
} from '../src/tools/regexExtractorTool';
import { ToolContext } from '../src/adk/types';

const DATA_DIR = path.join(process.cwd(), 'data');

async function readDataFile(filename: string): Promise<string> {
  const filepath = path.join(DATA_DIR, filename);
  return await fs.readFile(filepath, 'utf-8');
}

async function demonstrateEmailExtraction() {
  console.log('\n📧 EMAIL EXTRACTION FROM SUPPORT TRANSCRIPT');
  console.log('=' .repeat(50));
  
  const transcript = await readDataFile('support_transcript.txt');
  
  const context: ToolContext = {
    userId: 'demo-user',
    sessionId: 'demo-session',
    timestamp: new Date()
  };
  
  const result = await predefinedPatternExtractorTool.execute(
    { text: transcript, patternName: 'email' },
    context
  );
  
  if (result.success && result.data) {
    const data = result.data as any;
    console.log(`\nFound ${data.count} email addresses:`);
    data.matches.forEach((match: any) => {
      console.log(`  • ${match.match}`);
    });
  }
}

async function demonstrateOrderIdExtraction() {
  console.log('\n🆔 ORDER ID EXTRACTION');
  console.log('=' .repeat(50));
  
  const transcript = await readDataFile('support_transcript.txt');
  const invoice = await readDataFile('invoice_sample.txt');
  
  const context: ToolContext = {
    userId: 'demo-user',
    sessionId: 'demo-session',
    timestamp: new Date()
  };
  
  console.log('\nFrom Support Transcript:');
  let result = await regexExtractorTool.execute(
    { 
      text: transcript, 
      pattern: '(?:ORD|Order|RET|SUP|INV)[-\\s]?(?:#\\s?)?([A-Z0-9-]+)',
      flags: 'gi'
    },
    context
  );
  
  if (result.success && result.data) {
    const data = result.data as any;
    console.log(`Found ${data.count} reference numbers:`);
    data.matches.forEach((match: any) => {
      console.log(`  • ${match.match}`);
    });
  }
  
  console.log('\nFrom Invoice:');
  result = await predefinedPatternExtractorTool.execute(
    { text: invoice, patternName: 'invoiceNumber' },
    context
  );
  
  if (result.success && result.data) {
    const data = result.data as any;
    console.log(`Found ${data.count} invoice numbers:`);
    data.matches.forEach((match: any) => {
      console.log(`  • ${match.match}`);
    });
  }
}

async function demonstrateLogParsing() {
  console.log('\n🖥️  SERVER LOG PARSING');
  console.log('=' .repeat(50));
  
  const logs = await readDataFile('server_logs.txt');
  
  const context: ToolContext = {
    userId: 'demo-user',
    sessionId: 'demo-session',
    timestamp: new Date()
  };
  
  console.log('\nIP Addresses:');
  let result = await predefinedPatternExtractorTool.execute(
    { text: logs, patternName: 'ipv4' },
    context
  );
  
  if (result.success && result.data) {
    const data = result.data as any;
    const uniqueIPs = [...new Set(data.matches.map((m: any) => m.match))];
    console.log(`Found ${uniqueIPs.length} unique IP addresses:`);
    uniqueIPs.forEach(ip => {
      console.log(`  • ${ip}`);
    });
  }
  
  console.log('\nUUIDs:');
  result = await predefinedPatternExtractorTool.execute(
    { text: logs, patternName: 'uuid' },
    context
  );
  
  if (result.success && result.data) {
    const data = result.data as any;
    console.log(`Found ${data.count} UUIDs:`);
    data.matches.forEach((match: any) => {
      console.log(`  • ${match.match}`);
    });
  }
  
  console.log('\nTimestamps:');
  result = await regexExtractorTool.execute(
    { 
      text: logs, 
      pattern: '\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?',
      flags: 'g'
    },
    context
  );
  
  if (result.success && result.data) {
    const data = result.data as any;
    console.log(`Found ${data.count} timestamps`);
    console.log('Sample timestamps:');
    data.matches.slice(0, 5).forEach((match: any) => {
      console.log(`  • ${match.match}`);
    });
  }
}

async function demonstrateCustomExtractor() {
  console.log('\n🔧 CUSTOM PATTERN EXTRACTION');
  console.log('=' .repeat(50));
  
  const logs = await readDataFile('server_logs.txt');
  
  const logLevelExtractor = createCustomExtractor(
    'extractLogLevels',
    '\\[(INFO|WARNING|ERROR)\\]',
    'Extract log levels from server logs',
    'g'
  );
  
  const context: ToolContext = {
    userId: 'demo-user',
    sessionId: 'demo-session',
    timestamp: new Date()
  };
  
  const result = await logLevelExtractor.execute(
    { text: logs },
    context
  );
  
  if (result.success && result.data) {
    const data = result.data as any;
    const levelCounts: Record<string, number> = {};
    
    data.matches.forEach((match: any) => {
      const level = match.match.replace(/[\[\]]/g, '');
      levelCounts[level] = (levelCounts[level] || 0) + 1;
    });
    
    console.log('\nLog Level Distribution:');
    Object.entries(levelCounts).forEach(([level, count]) => {
      console.log(`  ${level}: ${count} occurrences`);
    });
  }
}

async function demonstrateGroupExtraction() {
  console.log('\n👥 GROUP EXTRACTION');
  console.log('=' .repeat(50));
  
  const invoice = await readDataFile('invoice_sample.txt');
  
  const context: ToolContext = {
    userId: 'demo-user',
    sessionId: 'demo-session',
    timestamp: new Date()
  };
  
  console.log('\nExtracting prices with currency:');
  const result = await regexExtractorTool.execute(
    {
      text: invoice,
      pattern: '(\\$)\\s?(\\d+(?:,\\d{3})*(?:\\.\\d{2})?)',
      flags: 'g',
      extractAll: true,
      groupNames: ['currency', 'amount']
    },
    context
  );
  
  if (result.success && result.data) {
    const data = result.data as any;
    console.log(`Found ${data.count} prices:`);
    data.matches.forEach((match: any) => {
      if (match.groups) {
        console.log(`  • ${match.groups.currency}${match.groups.amount}`);
      }
    });
    
    const total = data.matches
      .filter((m: any) => m.groups?.amount)
      .reduce((sum: number, m: any) => {
        const amount = parseFloat(m.groups.amount.replace(/,/g, ''));
        return sum + amount;
      }, 0);
    
    console.log(`\nSum of all prices found: $${total.toFixed(2)}`);
  }
}

async function listAvailablePatterns() {
  console.log('\n📋 AVAILABLE PREDEFINED PATTERNS');
  console.log('=' .repeat(50));
  
  Object.entries(PREDEFINED_PATTERNS).forEach(([key, pattern]) => {
    console.log(`\n${key}:`);
    console.log(`  Description: ${pattern.description}`);
    console.log(`  Pattern: ${pattern.pattern.substring(0, 50)}${pattern.pattern.length > 50 ? '...' : ''}`);
  });
}

async function main() {
  console.log('🔍 REGEX EXTRACTOR TOOL DEMONSTRATION');
  console.log('=====================================');
  
  try {
    await listAvailablePatterns();
    await demonstrateEmailExtraction();
    await demonstrateOrderIdExtraction();
    await demonstrateLogParsing();
    await demonstrateCustomExtractor();
    await demonstrateGroupExtraction();
    
    console.log('\n✅ All demonstrations completed successfully!');
  } catch (error) {
    console.error('❌ Error during demonstration:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}