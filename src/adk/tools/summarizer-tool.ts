import { z } from 'zod';
import { Tool, ToolContext, ToolResult, ToolSource } from '../types';
import { createFunctionTool } from './index';
import { generateText } from 'ai';
import { createAiSdkProvider } from '../../providers/ai-sdk';

const summarizerSchema = z.object({
  text: z.string().describe('The text content to summarize'),
  maxLength: z.number().optional().describe('Maximum length of summary in tokens').default(150),
  style: z.enum(['bullet', 'paragraph', 'key-points']).optional().describe('Summary style').default('paragraph'),
  model: z.string().optional().describe('OpenAI model to use').default('gpt-4o-mini'),
});

type SummarizerParams = z.infer<typeof summarizerSchema>;

const formatSummaryPrompt = (text: string, style: string, maxLength: number): string => {
  const styleInstructions = {
    bullet: 'Format the summary as bullet points. Each point should be concise and start with a bullet (•).',
    paragraph: 'Format the summary as a coherent paragraph.',
    'key-points': 'Format the summary as numbered key points, highlighting the most important information.',
  };

  return `Summarize the following text in approximately ${maxLength} tokens using a ${style} format.

${styleInstructions[style as keyof typeof styleInstructions]}

Text to summarize:
${text}

Provide only the summary without any additional commentary or introduction.`;
};

export const summarizerTool: Tool = createFunctionTool({
  name: 'summarize_text',
  description: 'Summarize long text content into a concise summary using an LLM',
  parameters: [
    {
      name: 'text',
      type: 'string',
      description: 'The text content to summarize',
      required: true,
    },
    {
      name: 'maxLength',
      type: 'number',
      description: 'Maximum length of summary in tokens (default: 150)',
      required: false,
    },
    {
      name: 'style',
      type: 'string',
      description: 'Summary style: bullet, paragraph, or key-points (default: paragraph)',
      required: false,
    },
    {
      name: 'model',
      type: 'string',
      description: 'OpenAI model to use (default: gpt-4o-mini)',
      required: false,
    },
  ],
  execute: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
    try {
      const validatedParams = summarizerSchema.parse(params);
      const { text, maxLength, style, model } = validatedParams;

      if (!text || text.trim().length === 0) {
        return {
          success: false,
          error: 'Text content is required for summarization',
        };
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return {
          success: false,
          error: 'OPENAI_API_KEY environment variable is not set',
        };
      }

      const prompt = formatSummaryPrompt(text, style, maxLength);

      // Use the AI SDK provider pattern from the codebase
      const { createOpenAI } = await import('@ai-sdk/openai');
      const openai = createOpenAI({ apiKey });
      const modelInstance = openai(model);
      
      const response = await generateText({
        model: modelInstance,
        prompt,
        temperature: 0.3,
      });

      const summary = response.text;

      const wordCount = summary.split(/\s+/).length;
      const characterCount = summary.length;

      return {
        success: true,
        data: {
          summary,
          metadata: {
            originalLength: text.length,
            summaryLength: summary.length,
            wordCount,
            characterCount,
            style,
            model,
            compressionRatio: ((1 - summary.length / text.length) * 100).toFixed(1) + '%',
          },
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        success: false,
        error: `Failed to summarize text: ${errorMessage}`,
      };
    }
  },
  metadata: {
    source: ToolSource.FUNCTION,
    version: '1.0.0',
    tags: ['summarization', 'llm', 'openai'],
  },
});

export const createSummarizerTool = (defaultModel: string = 'gpt-4o-mini'): Tool => {
  return createFunctionTool({
    ...summarizerTool.metadata,
    name: 'summarize_text',
    description: 'Summarize long text content into a concise summary using an LLM',
    parameters: summarizerTool.parameters,
    execute: async (params: Record<string, unknown>, context: ToolContext) => {
      return summarizerTool.execute({ ...params, model: params.model || defaultModel }, context);
    },
  });
};