import 'dotenv/config';
import { randomUUID } from 'crypto';
import {
  run,
  createRunId,
  createTraceId,
  makeLiteLLMProvider,
  getTextContent,
  type Agent,
  type RunConfig,
  type RunState,
  type Message
} from '@xynehq/jaf';

type ReviewContext = {
  reviewNotes: string[];
  conversationSummary?: string;
};

const requireLiteLLMConfig = () => {
  const url = process.env.LITELLM_URL;
  const apiKey = process.env.LITELLM_API_KEY;

  if (!url || !apiKey) {
    throw new Error(
      'Missing LiteLLM configuration. Set LITELLM_URL and LITELLM_API_KEY in your .env before running the turn-end review example.'
    );
  }

  return { url, apiKey };
};

const agent: Agent<ReviewContext, string> = {
  name: 'BusinessAnalyst',
  instructions: (state) => {
    const reviewFeedback = state.context.reviewNotes.length > 0
      ? `\n\nPrevious feedback from quality reviews:\n${state.context.reviewNotes.map((note, i) => `• Review ${i + 1}: ${note}`).join('\n')}\n\nPlease incorporate this feedback to improve your response quality.`
      : '\n\nThis is your first response. Deliver professional, insightful analysis.';

    const conversationContext = state.context.conversationSummary 
      ? `\n\nConversation context: ${state.context.conversationSummary}`
      : '';

    return `You are a senior business analyst with expertise in market research, strategy development, and business planning. 
You provide thoughtful, well-structured analysis and recommendations.

Your responses should be:
- Professional and insightful
- Well-organized with clear sections
- Backed by logical reasoning
- Actionable where appropriate

${conversationContext}${reviewFeedback}`;
  },
  modelConfig: { name: process.env.LITELLM_MODEL || 'gpt-4o-mini' }
};

const summarizeAssistantMessage = (message?: Message): string => {
  if (!message) return '(no assistant output)';
  const content = getTextContent(message.content);
  return content ? content.slice(0, 120).replace(/\s+/g, ' ') : '(non-text content)';
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { url, apiKey } = requireLiteLLMConfig();
  const modelProvider = makeLiteLLMProvider(url, apiKey);

  const config: RunConfig<ReviewContext> = {
    agentRegistry: new Map([[agent.name, agent]]),
    modelProvider,
    maxTurns: 4,
    allowClarificationRequests: false,
    onTurnEnd: async ({ turn, lastAssistantMessage, state }) => {
      if (!lastAssistantMessage) {
        console.log(' No assistant message to review');
        return;
      }

      const assistantContent = getTextContent(lastAssistantMessage.content);
      console.log(`\n📝 Assistant Response (Turn ${turn}):\n${assistantContent}\n`);
      
      console.log(`Reviewing turn ${turn} with AI reviewer...`);

      try {
        
        const reviewPrompt = `Please review this business analyst response and provide constructive feedback:

"${assistantContent}"

Evaluate: professional tone, analytical depth, structure clarity, actionable insights, and overall business value. Provide a concise 1-2 sentence review focusing on what could be improved.`;

        console.log('Calling AI reviewer...');
        
        // Create a temporary reviewer agent for this review
        const reviewerAgent: Agent<any, string> = {
          name: 'QualityReviewer',
          instructions: () => 'You are a senior business consultant who reviews analyst reports for quality. Focus on professional standards, analytical rigor, and practical value. Provide specific, actionable feedback.',
          modelConfig: { name: process.env.LITELLM_MODEL || 'gpt-4o-mini' }
        };

        // Create a temporary state for the review
        const reviewState: RunState<any> = {
          runId: createRunId(randomUUID()),
          traceId: createTraceId(randomUUID()),
          messages: [
            {
              role: 'user',
              content: reviewPrompt
            }
          ],
          currentAgentName: 'QualityReviewer',
          context: {},
          turnCount: 0
        };

        // Use the same model provider to get the review
        const reviewResponse = await modelProvider.getCompletion(reviewState, reviewerAgent, config);
        const reviewText = reviewResponse.message?.content || 'Review failed';
        console.log(`🔍 Quality Review: ${reviewText}`);
        
        // Store the review in context
        state.context.reviewNotes.push(reviewText);
        console.log(`Review ${turn} stored. Total reviews:`, state.context.reviewNotes.length);
        
      } catch (error) {
        console.error('Review failed:', error);
        // Store a fallback review
        const summary = summarizeAssistantMessage(lastAssistantMessage);
        state.context.reviewNotes.push(`Turn ${turn} completed: ${summary}`);
      }
    }
  };

  const initialState: RunState<ReviewContext> = {
    runId: createRunId(randomUUID()),
    traceId: createTraceId(randomUUID()),
    messages: [
      {
        role: 'user',
        content: 'I\'m launching a new SaaS product for small businesses. It\'s a customer relationship management tool. Can you analyze the market opportunity and provide strategic recommendations for market entry?'
      }
    ],
    currentAgentName: agent.name,
    context: { reviewNotes: [] },
    turnCount: 0
  };

  console.log('🚀 Starting Business Analysis Review Demo\n');
  const result = await run<ReviewContext, string>(initialState, config);

  console.log('\n--- Turn 1 Complete ---');
  
  if (result.finalState.context.reviewNotes.length > 0) {
    console.log('\n💬 Follow-up question to test review integration...');
    
    // Run a second turn to see how the review is incorporated
    const secondState: RunState<ReviewContext> = {
      ...result.finalState,
      messages: [
        ...result.finalState.messages,
        {
          role: 'user',
          content: 'Great analysis! Now I\'m considering two pricing strategies: a freemium model vs. a premium-only model. What are the pros and cons of each approach for a CRM targeting small businesses?'
        }
      ],
    };

    const secondResult = await run<ReviewContext, string>(secondState, config);
    
    console.log('\n🎯 Demo Complete!');
    console.log(`📊 Final Status: ${secondResult.outcome.status}`);
    console.log(`📝 Total Quality Reviews: ${secondResult.finalState.context.reviewNotes.length}`);
    
    if (secondResult.finalState.context.reviewNotes.length > 0) {
      console.log('\n📋 All Quality Reviews:');
      secondResult.finalState.context.reviewNotes.forEach((review, i) => {
        console.log(`\n${i + 1}. ${review}`);
      });
    }
  } else {
    console.log('Run finished with status:', result.outcome.status);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
