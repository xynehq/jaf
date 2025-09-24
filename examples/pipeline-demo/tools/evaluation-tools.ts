/**
 * Evaluation & Enhancement Pipeline Tools
 * 
 * These tools handle ART report analysis and prompt enhancement
 */

import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import type { Tool } from '../../../src/core/types';
import type { PipelineContext, ARTReport, ARTSession, ARTError } from '../types';

export const parseARTReportTool: Tool<{
  reportPath: string;
  connectorName: string;
  replayId: string;
}, PipelineContext> = {
  schema: {
    name: 'parse_art_report',
    description: 'Parse and analyze ART report for issues',
    parameters: z.object({
      reportPath: z.string().describe('Path to the ART report file'),
      connectorName: z.string().describe('Connector name'),
      replayId: z.string().describe('Replay ID')
    })
  },
  execute: async (args, context) => {
    const { reportPath, connectorName, replayId } = args;
    
    try {
      if (!existsSync(reportPath)) {
        console.log(`⚠️ ART report file not found: ${reportPath}`);
        return {
          report: null,
          summary: 'No ART report found',
          issues: []
        };
      }
      
      console.log(`📄 Reading ART report file: ${reportPath}`);
      const reportContent = await readFile(reportPath, 'utf-8');
      const artData = JSON.parse(reportContent);
      
      // Parse ART report structure
      const sessions: ARTSession[] = Array.isArray(artData) ? artData : [artData];
      
      let totalSessions = sessions.length;
      let failedSessions = 0;
      const allIssues: ARTError[] = [];
      
      // Analyze each session
      for (const session of sessions) {
        if (session.status === 'failed' || (session.errors && session.errors.length > 0)) {
          failedSessions++;
          if (session.errors) {
            allIssues.push(...session.errors);
          }
        }
      }
      
      const successRate = totalSessions > 0 ? ((totalSessions - failedSessions) / totalSessions) * 100 : 0;
      
      const report: ARTReport = {
        connectorName,
        replayId,
        sessions,
        summary: {
          totalSessions,
          failedSessions,
          successRate
        }
      };
      
      console.log(`✅ ART report parsed for ${connectorName}`);
      console.log(`📊 Summary: ${totalSessions} sessions, ${failedSessions} failed, ${successRate.toFixed(1)}% success rate`);
      
      return {
        report,
        summary: `Analyzed ${totalSessions} sessions with ${successRate.toFixed(1)}% success rate`,
        issues: allIssues
      };
      
    } catch (error: any) {
      throw new Error(`Failed to parse ART report: ${error.message}`);
    }
  }
};

export const analyzeARTIssuesTool: Tool<{
  artReport: ARTReport;
  previousEulerPrompt?: string;
  previousUCSPrompt?: string;
}, PipelineContext> = {
  schema: {
    name: 'analyze_art_issues',
    description: 'Analyze ART issues and categorize them',
    parameters: z.object({
      artReport: z.any().describe('Parsed ART report object'),
      previousEulerPrompt: z.string().optional().describe('Previous Euler prompt'),
      previousUCSPrompt: z.string().optional().describe('Previous UCS prompt')
    })
  },
  execute: async (args, context) => {
    const { artReport, previousEulerPrompt, previousUCSPrompt } = args;
    
    if (!artReport || !artReport.sessions) {
      return {
        analysis: 'No ART data to analyze',
        recommendations: [],
        categories: {}
      };
    }
    
    // Categorize issues
    const categories = {
      request_mismatch: [] as ARTError[],
      response_mismatch: [] as ARTError[],
      timeout: [] as ARTError[],
      missing_endpoints: [] as ARTError[],
      unknown: [] as ARTError[]
    };
    
    const recommendations: string[] = [];
    
    // Collect and categorize all errors
    for (const session of artReport.sessions) {
      if (session.errors) {
        for (const error of session.errors) {
          const category = error.type || 'unknown';
          if (categories[category as keyof typeof categories]) {
            categories[category as keyof typeof categories].push(error);
          } else {
            categories.unknown.push(error);
          }
        }
      }
    }
    
    // Generate recommendations based on issue patterns
    if (categories.request_mismatch.length > 0) {
      recommendations.push(
        `Fix ${categories.request_mismatch.length} request format mismatches. ` +
        `Check payload structure and field mappings.`
      );
    }
    
    if (categories.response_mismatch.length > 0) {
      recommendations.push(
        `Address ${categories.response_mismatch.length} response format issues. ` +
        `Verify response parsing and field transformations.`
      );
    }
    
    if (categories.timeout.length > 0) {
      recommendations.push(
        `Resolve ${categories.timeout.length} timeout issues. ` +
        `Check API response times and implement proper error handling.`
      );
    }
    
    if (categories.missing_endpoints.length > 0) {
      recommendations.push(
        `Implement ${categories.missing_endpoints.length} missing API endpoints. ` +
        `Add proper routing and handler functions.`
      );
    }
    
    // API endpoint analysis
    const apiEndpoints = new Set<string>();
    const failedEndpoints = new Set<string>();
    
    for (const session of artReport.sessions) {
      if (session.apiCalls) {
        for (const apiCall of session.apiCalls) {
          apiEndpoints.add(`${apiCall.method} ${apiCall.url}`);
          if (apiCall.status === 'mismatched' || apiCall.status === 'missing') {
            failedEndpoints.add(`${apiCall.method} ${apiCall.url}`);
          }
        }
      }
    }
    
    const analysis = `
ART Analysis Summary:
- Total API endpoints tested: ${apiEndpoints.size}
- Failed endpoints: ${failedEndpoints.size}
- Success rate: ${artReport.summary.successRate.toFixed(1)}%

Issue Breakdown:
- Request mismatches: ${categories.request_mismatch.length}
- Response mismatches: ${categories.response_mismatch.length} 
- Timeouts: ${categories.timeout.length}
- Missing endpoints: ${categories.missing_endpoints.length}
- Unknown issues: ${categories.unknown.length}

Key Failed Endpoints:
${Array.from(failedEndpoints).slice(0, 5).map(ep => `- ${ep}`).join('\n')}
${failedEndpoints.size > 5 ? `... and ${failedEndpoints.size - 5} more` : ''}
`;
    
    console.log('📊 ART Issues Analysis:');
    console.log(analysis);
    
    return {
      analysis,
      recommendations,
      categories,
      endpoints: {
        total: apiEndpoints.size,
        failed: failedEndpoints.size,
        failedList: Array.from(failedEndpoints)
      }
    };
  }
};

export const generateEnhancedPromptsTool: Tool<{
  artAnalysis: any;
  basePrompt: string;
  connectorName: string;
  isEulerPrompt: boolean;
}, PipelineContext> = {
  schema: {
    name: 'generate_enhanced_prompts',
    description: 'Generate enhanced prompts based on ART analysis',
    parameters: z.object({
      artAnalysis: z.any().describe('ART analysis results'),
      basePrompt: z.string().describe('Base prompt to enhance'),
      connectorName: z.string().describe('Connector name'),
      isEulerPrompt: z.boolean().describe('Whether this is for Euler (true) or UCS (false)')
    })
  },
  execute: async (args, context) => {
    const { artAnalysis, basePrompt, connectorName, isEulerPrompt } = args;
    
    const systemType = isEulerPrompt ? 'Euler' : 'UCS';
    const artExplanation = `
ART (Automation Regression Tool) Report Analysis:

ART creates a mock server that returns recorded responses for specific apiTag and URL combinations from test sessions. 
If a record is not found by the mock server, it can generally be ignored as it may be expected behavior.

CRITICAL ISSUES TO ADDRESS:
${artAnalysis.recommendations.map((rec: string) => `- ${rec}`).join('\n')}

DETAILED ANALYSIS:
${artAnalysis.analysis}

IMPLEMENTATION FOCUS FOR ${systemType}:
${isEulerPrompt ? `
- Fix Haskell type mismatches and compilation errors
- Ensure proper ConnectorService module implementation
- Verify cabal.project dependencies are correct
- Add new connector module to euler-x.cabal exposed-modules
- Implement proper request/response transformations
` : `
- Fix Rust compilation errors and type issues
- Ensure proper Cargo.toml dependencies
- Implement correct request/response serialization
- Add proper error handling for API failures
- Verify connector configuration is properly loaded
`}`;
    
    const enhancedPrompt = `${basePrompt}

## ART REGRESSION FIXES REQUIRED

${artExplanation}

### SPECIFIC FIXES NEEDED:
${artAnalysis.recommendations.map((rec: string, index: number) => `${index + 1}. ${rec}`).join('\n')}

### FAILED API ENDPOINTS TO VERIFY:
${artAnalysis.endpoints?.failedList?.slice(0, 10).map((endpoint: string) => `- ${endpoint}`).join('\n') || 'None identified'}

## IMPLEMENTATION INSTRUCTIONS

Based on the ART analysis, focus on:

1. **Request/Response Format Fixes**: Ensure all API requests match the expected format exactly
2. **Error Handling**: Add proper error handling for failed API calls
3. **Timeout Management**: Implement appropriate timeout handling for slow responses
4. **Missing Endpoints**: Add any missing API endpoint implementations
5. **Type Safety**: Ensure all data transformations are type-safe and validated

## VALIDATION CHECKLIST

Before considering the implementation complete:
- [ ] All ART test failures have been addressed
- [ ] Code compiles successfully (${isEulerPrompt ? 'nix develop -c cabal build all' : 'cargo build'})
- [ ] Request/response formats match ART expectations
- [ ] Error scenarios are properly handled
- [ ] No regression in existing functionality

## CONTEXT

Previous implementation context is available in 'temp_instruction.txt'. Review this file to understand what was previously implemented and build upon those changes while fixing the identified ART issues.

Focus on incremental fixes rather than complete rewrites unless absolutely necessary.`;
    
    console.log(`✅ Enhanced ${systemType} prompt generated with ART analysis`);
    console.log(`📝 Added ${artAnalysis.recommendations.length} specific recommendations`);
    
    return {
      enhancedPrompt,
      systemType,
      issuesAddressed: artAnalysis.recommendations.length,
      endpointsToFix: artAnalysis.endpoints?.failed || 0
    };
  }
};

export const readPreviousPromptsTool: Tool<{
  connectorName: string;
  outputDir: string;
}, PipelineContext> = {
  schema: {
    name: 'read_previous_prompts',
    description: 'Read previous migration prompts for context',
    parameters: z.object({
      connectorName: z.string().describe('Connector name'),
      outputDir: z.string().describe('Directory containing migration files')
    })
  },
  execute: async (args, context) => {
    const { connectorName, outputDir } = args;
    
    const eulerFile = path.join(outputDir, `${connectorName}_euler.md`);
    const ucsFile = path.join(outputDir, `${connectorName}_ucs.md`);
    
    let previousEulerPrompt = '';
    let previousUCSPrompt = '';
    
    try {
      if (existsSync(eulerFile)) {
        previousEulerPrompt = await readFile(eulerFile, 'utf-8');
        console.log(`✅ Read previous Euler prompt from ${eulerFile}`);
      } else {
        console.log(`⚠️ Previous Euler prompt file not found: ${eulerFile}`);
      }
      
      if (existsSync(ucsFile)) {
        previousUCSPrompt = await readFile(ucsFile, 'utf-8');
        console.log(`✅ Read previous UCS prompt from ${ucsFile}`);
      } else {
        console.log(`⚠️ Previous UCS prompt file not found: ${ucsFile}`);
      }
      
      return {
        previousEulerPrompt,
        previousUCSPrompt,
        eulerFound: previousEulerPrompt.length > 0,
        ucsFound: previousUCSPrompt.length > 0
      };
      
    } catch (error: any) {
      console.log(`❌ Error reading previous prompts: ${error.message}`);
      return {
        previousEulerPrompt: '',
        previousUCSPrompt: '',
        eulerFound: false,
        ucsFound: false,
        error: error.message
      };
    }
  }
};

export const saveEnhancedPromptsTool: Tool<{
  connectorName: string;
  enhancedEulerPrompt: string;
  enhancedUCSPrompt: string;
  outputDir: string;
}, PipelineContext> = {
  schema: {
    name: 'save_enhanced_prompts',
    description: 'Save enhanced prompts for future use',
    parameters: z.object({
      connectorName: z.string().describe('Connector name'),
      enhancedEulerPrompt: z.string().describe('Enhanced Euler prompt'),
      enhancedUCSPrompt: z.string().describe('Enhanced UCS prompt'),
      outputDir: z.string().describe('Output directory')
    })
  },
  execute: async (args, context) => {
    const { connectorName, enhancedEulerPrompt, enhancedUCSPrompt, outputDir } = args;
    
    try {
      // Ensure output directory exists
      const fs = await import('fs');
      if (!fs.existsSync(outputDir)) {
        await fs.promises.mkdir(outputDir, { recursive: true });
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Save enhanced prompts with timestamp
      const enhancedEulerFile = path.join(outputDir, `${connectorName}_euler_enhanced_${timestamp}.md`);
      const enhancedUCSFile = path.join(outputDir, `${connectorName}_ucs_enhanced_${timestamp}.md`);
      
      await writeFile(enhancedEulerFile, enhancedEulerPrompt, 'utf-8');
      console.log(`✅ Enhanced Euler prompt saved to ${enhancedEulerFile}`);
      
      await writeFile(enhancedUCSFile, enhancedUCSPrompt, 'utf-8');
      console.log(`✅ Enhanced UCS prompt saved to ${enhancedUCSFile}`);
      
      // Also update the main files for next iteration
      const mainEulerFile = path.join(outputDir, `${connectorName}_euler.md`);
      const mainUCSFile = path.join(outputDir, `${connectorName}_ucs.md`);
      
      await writeFile(mainEulerFile, enhancedEulerPrompt, 'utf-8');
      await writeFile(mainUCSFile, enhancedUCSPrompt, 'utf-8');
      
      console.log(`✅ Main prompt files updated for future iterations`);
      
      return {
        success: true,
        files: {
          enhancedEulerFile,
          enhancedUCSFile,
          mainEulerFile,
          mainUCSFile
        },
        message: 'Enhanced prompts saved successfully'
      };
      
    } catch (error: any) {
      throw new Error(`Failed to save enhanced prompts: ${error.message}`);
    }
  }
};