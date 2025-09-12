import {
  Agent,
  RunConfig,
  RunState,
  ValidationResult,
  jsonParseLLMOutput,
  createRunId,
  createTraceId,
  getTextContent,
  AdvancedGuardrailsConfig,
  Guardrail
} from './types.js';

/**
 * LLM-based guardrail evaluator that uses a model to validate content against rules
 */
async function createLLMGuardrail<Ctx>(
  config: RunConfig<Ctx>,
  stage: "input" | "output",
  rulePrompt: string,
  fastModel?: string,
  failSafe: 'allow' | 'block' = 'allow'
): Promise<(content: string) => Promise<ValidationResult>> {
  return async (content: string) => {
    const modelToUse = fastModel || config.defaultFastModel;
    if (!modelToUse) {
      const message = `[JAF:GUARDRAILS] No fast model available for LLM guardrail evaluation, using failSafe: ${failSafe}`;
      console.warn(message);
      return failSafe === 'allow'
        ? { isValid: true as const }
        : { isValid: false as const, errorMessage: 'No model available for guardrail evaluation' };
    }

    // Compose a strict JSON-only evaluation prompt
    const evalPrompt = `You are a guardrail validator for ${stage}.
Rules:
${rulePrompt}

Decide if the ${stage === "input" ? "user message" : "assistant output"} complies with the rules.
Return a JSON object with keys: {"allowed": boolean, "reason": string}. Do not include extra text.
${stage === "input" ? "User message" : "Assistant output"}:
"""
${content}
"""`;

    try {
      // Create a minimal state for the LLM call
      const tempState: RunState<Ctx> = {
        runId: createRunId('guardrail-eval'),
        traceId: createTraceId('guardrail-eval'),
        messages: [{ role: 'user', content: evalPrompt }],
        currentAgentName: 'guardrail-evaluator',
        context: {} as Readonly<Ctx>,
        turnCount: 0
      };

      // Create a minimal agent for evaluation
      const evalAgent: Agent<Ctx, any> = {
        name: 'guardrail-evaluator',
        instructions: () => 'You are a guardrail validator. Return only valid JSON.',
        modelConfig: { name: modelToUse }
      };

      // Create a clean config for guardrail evaluation (no guardrails to avoid recursion)
      const guardrailConfig: RunConfig<Ctx> = {
        modelProvider: config.modelProvider,
        agentRegistry: config.agentRegistry,
        maxTurns: 1,
        defaultFastModel: config.defaultFastModel,
        modelOverride: modelToUse,
        // Explicitly exclude all guardrails to prevent recursion
        initialInputGuardrails: undefined,
        finalOutputGuardrails: undefined,
        onEvent: undefined // Avoid recursive events
      };

      const response = await config.modelProvider.getCompletion(tempState, evalAgent, guardrailConfig);

      if (!response.message?.content) {
        return { isValid: true as const };
      }

      const parsed = jsonParseLLMOutput(response.message.content);
      const allowed = Boolean(parsed?.allowed);
      const reason = typeof parsed?.reason === "string" ? parsed.reason : "Guardrail violation";
      
      return allowed
        ? { isValid: true as const }
        : ({ isValid: false as const, errorMessage: reason } as const);
    } catch (e) {
      // On evaluation failure, use configured failSafe behavior
      const message = `[JAF:GUARDRAILS] Guardrail evaluation failed, using failSafe: ${failSafe}`;
      console.warn(message, e);
      return failSafe === 'allow'
        ? { isValid: true as const }
        : { isValid: false as const, errorMessage: `Guardrail evaluation failed: ${e instanceof Error ? e.message : 'Unknown error'}` };
    }
  };
}

/**
 * Builds effective guardrails lists from agent configuration and global config
 */
export async function buildEffectiveGuardrails<Ctx>(
  currentAgent: Agent<Ctx, any>,
  config: RunConfig<Ctx>
): Promise<{
  inputGuardrails: Guardrail<string>[];
  outputGuardrails: Guardrail<any>[];
}> {
  let effectiveInputGuardrails: Guardrail<string>[] = [];
  let effectiveOutputGuardrails: Guardrail<any>[] = [];
  
  try {
    const guardrailsCfg: AdvancedGuardrailsConfig = currentAgent.advancedConfig?.guardrails || {};

    // Validate fastModel is available
    const fastModel = guardrailsCfg.fastModel || config.defaultFastModel;
    if (!fastModel && (guardrailsCfg.inputPrompt || guardrailsCfg.outputPrompt)) {
      console.warn('[JAF:GUARDRAILS] No fast model available for LLM guardrails - skipping LLM-based validation');
    }

    // Helper: model-backed guardrail evaluator
    const llmGuardrail = async (
      stage: "input" | "output",
      rulePrompt: string,
      content: string,
    ) => {
      const failSafe = guardrailsCfg.failSafe || 'allow';
      
      if (!fastModel) {
        console.warn(`[JAF:GUARDRAILS] No model available for ${stage} guardrail - using failSafe: ${failSafe}`);
        return failSafe === 'allow'
          ? { isValid: true as const }
          : { isValid: false as const, errorMessage: 'No model available for guardrail evaluation' };
      }
      
      console.log(`[JAF:GUARDRAILS] Evaluating ${stage} guardrail`);
      config.onEvent?.({
        type: 'guardrail_check',
        data: { guardrailName: `${stage}-guardrail`, content, isValid: undefined }
      });
      
      const evaluator = await createLLMGuardrail(config, stage, rulePrompt, fastModel, failSafe);
      const result = await evaluator(content);
      
      console.log(`[JAF:GUARDRAILS] ${stage} guardrail result:`, result);
      config.onEvent?.({
        type: 'guardrail_check',
        data: { guardrailName: `${stage}-guardrail`, content, isValid: result.isValid, errorMessage: result.isValid ? undefined : result.errorMessage }
      });
      
      return result;
    };

    // Build input guardrails list
    effectiveInputGuardrails = [...(config.initialInputGuardrails || [])];
    
    if (guardrailsCfg?.inputPrompt && typeof guardrailsCfg.inputPrompt === "string" && guardrailsCfg.inputPrompt.trim().length > 0) {
      const inputPrompt: string = guardrailsCfg.inputPrompt;
      effectiveInputGuardrails.push(async (userText: string) => {
        const content = typeof userText === "string" ? userText : String(userText);
        return llmGuardrail("input", inputPrompt, content);
      });
    }

    // Build output guardrails list
    effectiveOutputGuardrails = [...(config.finalOutputGuardrails || [])];

    // Citation guardrail
    if (guardrailsCfg?.requireCitations) {
      effectiveOutputGuardrails.push((output: any) => {
        const findText = (val: any): string => {
          if (typeof val === "string") return val;
          if (Array.isArray(val)) return val.map(findText).join(" ");
          if (val && typeof val === "object") return Object.values(val).map(findText).join(" ");
          return "";
        };
        const str = typeof output === "string" ? output : findText(output);
        const ok = /\[(\d+)\]/.test(str);
        return ok
          ? ({ isValid: true as const } as const)
          : ({ isValid: false as const, errorMessage: "Missing required [n] citation in output" } as const);
      });
    }

    // Output prompt-based guardrail
    if (guardrailsCfg?.outputPrompt && typeof guardrailsCfg.outputPrompt === "string" && guardrailsCfg.outputPrompt.trim().length > 0) {
      const outputPrompt: string = guardrailsCfg.outputPrompt;
      effectiveOutputGuardrails.push(async (output: any) => {
        const toString = (val: any): string => {
          try {
            if (typeof val === "string") return val;
            return JSON.stringify(val);
          } catch {
            return String(val);
          }
        };
        const content = toString(output);
        return llmGuardrail("output", outputPrompt, content);
      });
    }
  } catch (e) {
    console.error('[JAF:GUARDRAILS] Failed to configure advanced guardrails:', e);
    // Use original guardrails on error
    effectiveInputGuardrails = [...(config.initialInputGuardrails || [])];
    effectiveOutputGuardrails = [...(config.finalOutputGuardrails || [])];
  }

  return {
    inputGuardrails: effectiveInputGuardrails,
    outputGuardrails: effectiveOutputGuardrails
  };
}

/**
 * Executes input guardrails in parallel with LLM call for performance optimization
 */
export async function executeInputGuardrailsParallel<Ctx>(
  inputGuardrails: Guardrail<string>[],
  firstUserMessage: any,
  config: RunConfig<Ctx>
): Promise<{ isValid: true } | { isValid: false; errorMessage: string }> {
  if (inputGuardrails.length === 0) {
    return { isValid: true };
  }

  console.log(`[JAF:GUARDRAILS] Starting ${inputGuardrails.length} input guardrails`);
  
  const inputGuardrailPromises = inputGuardrails.map(async (guardrail, index) => {
    try {
      console.log(`[JAF:GUARDRAILS] Starting input guardrail ${index + 1}`);
      const result = await guardrail(getTextContent(firstUserMessage.content));
      console.log(`[JAF:GUARDRAILS] Input guardrail ${index + 1} completed:`, result);
      return result;
    } catch (error) {
      console.error(`[JAF:GUARDRAILS] Input guardrail ${index + 1} failed:`, error);
      return { isValid: true }; // Default to pass on error
    }
  });
  
  const guardrailResults = await Promise.all(inputGuardrailPromises);
  
  console.log(`[JAF:GUARDRAILS] Input guardrails completed. Checking results...`);
  
  // Check if any input guardrail failed
  for (let i = 0; i < guardrailResults.length; i++) {
    const result = guardrailResults[i];
    if (!result.isValid) {
      const errorMessage = 'errorMessage' in result ? result.errorMessage : 'Guardrail violation';
      console.log(`🚨 Input guardrail ${i + 1} violation: ${errorMessage}`);
      config.onEvent?.({
        type: 'guardrail_violation',
        data: { stage: 'input', reason: errorMessage }
      });
      return { isValid: false, errorMessage };
    }
  }
  
  console.log(`✅ All input guardrails passed.`);
  return { isValid: true };
}

/**
 * Executes output guardrails on the final output
 */
export async function executeOutputGuardrails<Ctx>(
  outputGuardrails: Guardrail<any>[],
  output: any,
  config: RunConfig<Ctx>
): Promise<{ isValid: true } | { isValid: false; errorMessage: string }> {
  if (outputGuardrails.length === 0) {
    return { isValid: true };
  }

  console.log(`[JAF:GUARDRAILS] Checking ${outputGuardrails.length} output guardrails`);
  
  for (const guardrail of outputGuardrails) {
    const result = await guardrail(output);
    if (!result.isValid) {
      const errorMessage = 'errorMessage' in result ? result.errorMessage : 'Guardrail violation';
      console.log(`🚨 Output guardrail violation: ${errorMessage}`);
      config.onEvent?.({ 
        type: 'guardrail_violation', 
        data: { stage: 'output', reason: errorMessage } 
      });
      return { isValid: false, errorMessage };
    }
  }
  
  return { isValid: true };
}