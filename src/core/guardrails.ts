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
  Guardrail,
  validateGuardrailsConfig
} from './types.js';

/**
 * Circuit breaker for guardrail evaluation to prevent cascading failures
 */
class GuardrailCircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private readonly maxFailures = 5;
  private readonly resetTimeMs = 60000; // 1 minute

  isOpen(): boolean {
    if (this.failures < this.maxFailures) return false;
    
    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    if (timeSinceLastFailure > this.resetTimeMs) {
      this.failures = 0;
      return false;
    }
    
    return true;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
  }

  recordSuccess(): void {
    this.failures = 0;
  }
}

/**
 * Global circuit breaker instances for different stages
 */
const circuitBreakers = new Map<string, GuardrailCircuitBreaker>();

/**
 * Cache entry for guardrail evaluations
 */
interface CacheEntry {
  result: ValidationResult;
  timestamp: number;
  hitCount: number;
}

/**
 * LRU Cache for guardrail evaluations to improve performance
 */
class GuardrailCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize = 1000, ttlMs = 300000) { // 5 minutes TTL
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  private createKey(stage: string, rulePrompt: string, content: string, modelName: string): string {
    // Create hash of content to avoid extremely long keys
    const contentHash = this.hashString(content.substring(0, 1000)); // Use first 1000 chars for hashing
    const ruleHash = this.hashString(rulePrompt);
    return `guardrail_${stage}_${modelName}_${ruleHash}_${contentHash}_${content.length}`;
  }
  
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36); // Base 36 for shorter keys
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.ttlMs;
  }

  private evictLRU(): void {
    if (this.cache.size < this.maxSize) return;
    
    // Find least recently used (considering both access frequency and recency)
    let lruKey: string | null = null;
    let lruScore = Infinity;
    const now = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      // Normalize timestamp to hours to prevent overflow, higher score = more valuable
      const ageHours = (now - entry.timestamp) / (1000 * 60 * 60);
      const score = entry.hitCount / (1 + ageHours); // Frequency divided by age penalty
      if (score < lruScore) {
        lruScore = score;
        lruKey = key;
      }
    }
    
    if (lruKey) {
      this.cache.delete(lruKey);
    }
  }

  get(stage: string, rulePrompt: string, content: string, modelName: string): ValidationResult | null {
    const key = this.createKey(stage, rulePrompt, content, modelName);
    const entry = this.cache.get(key);
    
    if (!entry || this.isExpired(entry)) {
      if (entry) this.cache.delete(key);
      return null;
    }
    
    // Update hit count and timestamp for LRU
    entry.hitCount++;
    entry.timestamp = Date.now();
    
    return entry.result;
  }

  set(stage: string, rulePrompt: string, content: string, modelName: string, result: ValidationResult): void {
    const key = this.createKey(stage, rulePrompt, content, modelName);
    
    this.evictLRU();
    
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      hitCount: 1
    });
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { size: number; maxSize: number; hitRatio?: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }
}

/**
 * Global cache instance for guardrail evaluations
 */
const guardrailCache = new GuardrailCache();

function getCircuitBreaker(stage: string, modelName: string): GuardrailCircuitBreaker {
  const key = `${stage}-${modelName}`;
  if (!circuitBreakers.has(key)) {
    circuitBreakers.set(key, new GuardrailCircuitBreaker());
  }
  return circuitBreakers.get(key)!;
}

/**
 * Enhanced timeout wrapper with resource cleanup
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout: ${errorMessage}`));
    }, timeoutMs);
    
    // Ensure cleanup even if promise resolves
    promise.finally(() => clearTimeout(timeoutId));
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * LLM-based guardrail evaluator that uses a model to validate content against rules
 * Enhanced with comprehensive error boundaries, timeouts, and circuit breakers
 */
async function createLLMGuardrail<Ctx>(
  config: RunConfig<Ctx>,
  stage: "input" | "output",
  rulePrompt: string,
  fastModel?: string,
  failSafe: 'allow' | 'block' = 'allow',
  timeoutMs: number = 30000
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

    // Check cache first
    const cachedResult = guardrailCache.get(stage, rulePrompt, content, modelToUse);
    if (cachedResult) {
      console.log(`[JAF:GUARDRAILS] Cache hit for ${stage} guardrail`);
      // Note: Cache hit event - could be added to TraceEvent types if needed
      console.log(`[JAF:GUARDRAILS] Cache performance - hit for ${stage} on model ${modelToUse}`);
      return cachedResult;
    }

    // Check circuit breaker
    const circuitBreaker = getCircuitBreaker(stage, modelToUse);
    if (circuitBreaker.isOpen()) {
      const message = `[JAF:GUARDRAILS] Circuit breaker open for ${stage} guardrail on model ${modelToUse}, using failSafe: ${failSafe}`;
      console.warn(message);
      return failSafe === 'allow'
        ? { isValid: true as const }
        : { isValid: false as const, errorMessage: 'Circuit breaker open - too many recent failures' };
    }

    // Input validation
    if (!content || typeof content !== 'string') {
      console.warn(`[JAF:GUARDRAILS] Invalid content provided to ${stage} guardrail`);
      return failSafe === 'allow'
        ? { isValid: true as const }
        : { isValid: false as const, errorMessage: 'Invalid content provided to guardrail' };
    }

    // Content size check (prevent excessive token usage)
    const maxContentLength = timeoutMs < 10000 ? 10000 : 50000; // Smaller limit for shorter timeouts
    if (content.length > maxContentLength) {
      console.warn(`[JAF:GUARDRAILS] Content too large for ${stage} guardrail (${content.length} chars, max: ${maxContentLength})`);
      return failSafe === 'allow'
        ? { isValid: true as const }
        : { isValid: false as const, errorMessage: `Content too large for guardrail evaluation (${content.length} > ${maxContentLength} chars)` };
    }

    // Sanitize content to prevent prompt injection
    const sanitizedContent = content
      .replace(/"""/g, '[TRIPLE_QUOTE]')
      .replace(/\n/g, ' ')
      .substring(0, Math.min(content.length, 2000)); // Limit content in prompt
    
    // Compose a strict JSON-only evaluation prompt with sanitized content
    const evalPrompt = `You are a guardrail validator for ${stage}.
Rules:
${rulePrompt}

Decide if the ${stage === "input" ? "user message" : "assistant output"} complies with the rules.
Return a JSON object with keys: {"allowed": boolean, "reason": string}. Do not include extra text.
${stage === "input" ? "User message" : "Assistant output"}:
"""
${sanitizedContent}
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

      // Execute with timeout and error boundaries
      const completionPromise = config.modelProvider.getCompletion(tempState, evalAgent, guardrailConfig);
      const response = await withTimeout(
        completionPromise,
        timeoutMs,
        `${stage} guardrail evaluation timed out after ${timeoutMs}ms`
      );

      if (!response.message?.content) {
        return { isValid: true as const };
      }

      const parsed = jsonParseLLMOutput(response.message.content);
      const allowed = Boolean(parsed?.allowed);
      const reason = typeof parsed?.reason === "string" ? parsed.reason : "Guardrail violation";
      
      // Record success
      circuitBreaker.recordSuccess();
      
      const result = allowed
        ? { isValid: true as const }
        : ({ isValid: false as const, errorMessage: reason } as const);
      
      // Cache the result
      guardrailCache.set(stage, rulePrompt, content, modelToUse, result);
      
      return result;
    } catch (e) {
      // Record failure for circuit breaker
      circuitBreaker.recordFailure();
      
      // Enhanced error handling with specific error types
      let errorMessage = 'Unknown error';
      let isTimeout = false;
      
      if (e instanceof Error) {
        errorMessage = e.message;
        isTimeout = e.message.includes('Timeout');
      }
      
      // Log detailed error information
      const logMessage = `[JAF:GUARDRAILS] ${stage} guardrail evaluation failed`;
      if (isTimeout) {
        console.warn(`${logMessage} due to timeout (${timeoutMs}ms), using failSafe: ${failSafe}`, {
          stage,
          modelToUse,
          contentLength: content.length,
          timeoutMs
        });
      } else {
        console.warn(`${logMessage}, using failSafe: ${failSafe}`, {
          stage,
          modelToUse,
          error: errorMessage,
          contentLength: content.length
        });
      }
      
      return failSafe === 'allow'
        ? { isValid: true as const }
        : { isValid: false as const, errorMessage: `Guardrail evaluation failed: ${errorMessage}` };
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
    const rawGuardrailsCfg: AdvancedGuardrailsConfig = currentAgent.advancedConfig?.guardrails || {};
    const guardrailsCfg = validateGuardrailsConfig(rawGuardrailsCfg);

    // Determine effective fast model
    const fastModel = guardrailsCfg.fastModel || config.defaultFastModel;
    if (!fastModel && (guardrailsCfg.inputPrompt || guardrailsCfg.outputPrompt)) {
      console.warn('[JAF:GUARDRAILS] No fast model available for LLM guardrails - skipping LLM-based validation');
    }
    
    // Log configuration for debugging
    console.log('[JAF:GUARDRAILS] Configuration:', {
      hasInputPrompt: !!guardrailsCfg.inputPrompt,
      hasOutputPrompt: !!guardrailsCfg.outputPrompt,
      requireCitations: guardrailsCfg.requireCitations,
      executionMode: guardrailsCfg.executionMode,
      failSafe: guardrailsCfg.failSafe,
      timeoutMs: guardrailsCfg.timeoutMs,
      fastModel: fastModel || 'none'
    });

    // Helper: model-backed guardrail evaluator with enhanced error handling
    const llmGuardrail = async (
      stage: "input" | "output",
      rulePrompt: string,
      content: string,
    ) => {
      const failSafe = guardrailsCfg.failSafe || 'allow';
      const timeoutMs = guardrailsCfg.timeoutMs || 30000;
      
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
      
      try {
        const evaluator = await createLLMGuardrail(config, stage, rulePrompt, fastModel, failSafe, timeoutMs);
        const result = await evaluator(content);
        
        console.log(`[JAF:GUARDRAILS] ${stage} guardrail result:`, result);
        config.onEvent?.({
          type: 'guardrail_check',
          data: { guardrailName: `${stage}-guardrail`, content, isValid: result.isValid, errorMessage: result.isValid ? undefined : result.errorMessage }
        });
        
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error in guardrail evaluation';
        console.error(`[JAF:GUARDRAILS] Failed to create or execute ${stage} guardrail:`, error);
        
        config.onEvent?.({
          type: 'guardrail_check',
          data: { guardrailName: `${stage}-guardrail`, content, isValid: false, errorMessage }
        });
        
        return failSafe === 'allow'
          ? { isValid: true as const }
          : { isValid: false as const, errorMessage };
      }
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
 * Executes input guardrails sequentially (original behavior) with error handling
 */
export async function executeInputGuardrailsSequential<Ctx>(
  inputGuardrails: Guardrail<string>[],
  firstUserMessage: any,
  config: RunConfig<Ctx>
): Promise<{ isValid: true } | { isValid: false; errorMessage: string }> {
  if (inputGuardrails.length === 0) {
    return { isValid: true };
  }

  console.log(`[JAF:GUARDRAILS] Starting ${inputGuardrails.length} input guardrails (sequential)`);
  
  const messageContent = firstUserMessage?.content;
  const content = getTextContent(messageContent);
  
  for (let i = 0; i < inputGuardrails.length; i++) {
    const guardrail = inputGuardrails[i];
    const guardrailName = `input-guardrail-${i + 1}`;
    
    try {
      console.log(`[JAF:GUARDRAILS] Starting ${guardrailName}`);
      
      // Execute guardrail with timeout
      const timeoutMs = 10000; // 10 second timeout
      const guardrailResult = guardrail(content);
      const result = await withTimeout(
        Promise.resolve(guardrailResult),
        timeoutMs,
        `${guardrailName} execution timed out after ${timeoutMs}ms`
      );
      
      console.log(`[JAF:GUARDRAILS] ${guardrailName} completed:`, result);
      
      if (!result.isValid) {
        const errorMessage = 'errorMessage' in result ? result.errorMessage : 'Guardrail violation';
        console.log(`🚨 ${guardrailName} violation: ${errorMessage}`);
        config.onEvent?.({
          type: 'guardrail_violation',
          data: { stage: 'input', reason: errorMessage }
        });
        return { isValid: false, errorMessage };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[JAF:GUARDRAILS] ${guardrailName} failed:`, errorMessage);
      
      // In sequential mode, guardrail failures are more critical
      // But still allow system errors to pass through for resilience
      const isSystemError = errorMessage.includes('Timeout') || errorMessage.includes('Circuit breaker');
      
      if (isSystemError) {
        console.warn(`[JAF:GUARDRAILS] ${guardrailName} system error, continuing: ${errorMessage}`);
        continue; // Continue to next guardrail
      } else {
        config.onEvent?.({
          type: 'guardrail_violation',
          data: { stage: 'input', reason: errorMessage }
        });
        return { isValid: false, errorMessage };
      }
    }
  }
  
  console.log(`✅ All input guardrails passed (sequential).`);
  return { isValid: true };
}

/**
 * Executes input guardrails in parallel with comprehensive error boundaries and resource management
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
  
  // Enhanced promise execution with individual timeouts and error boundaries
  const inputGuardrailPromises = inputGuardrails.map(async (guardrail, index) => {
    const guardrailName = `input-guardrail-${index + 1}`;
    
    try {
      console.log(`[JAF:GUARDRAILS] Starting ${guardrailName}`);
      
      // Individual timeout for each guardrail (use config or default 10s)
      const timeoutMs = config.defaultFastModel ? 10000 : 5000; // Shorter timeout if no model configured
      const messageContent = firstUserMessage?.content;
      const content = getTextContent(messageContent);
      
      const guardrailResult = guardrail(content);
      const result = await withTimeout(
        Promise.resolve(guardrailResult),
        timeoutMs,
        `${guardrailName} execution timed out after ${timeoutMs}ms`
      );
      
      console.log(`[JAF:GUARDRAILS] ${guardrailName} completed:`, result);
      return { ...result, guardrailIndex: index };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[JAF:GUARDRAILS] ${guardrailName} failed:`, {
        error: errorMessage,
        index,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Return success by default to prevent single guardrail failure from blocking
      // This provides graceful degradation
      return { 
        isValid: true as const, 
        guardrailIndex: index,
        warning: `Guardrail ${index + 1} failed but was skipped: ${errorMessage}`
      };
    }
  });
  
  try {
    // Use Promise.allSettled for better error isolation
    const settledResults = await Promise.allSettled(inputGuardrailPromises);
    
    console.log(`[JAF:GUARDRAILS] Input guardrails completed. Checking results...`);
    
    const results: any[] = [];
    const warnings: string[] = [];
    
    // Process settled results
    for (let i = 0; i < settledResults.length; i++) {
      const settled = settledResults[i];
      
      if (settled.status === 'fulfilled') {
        const result = settled.value;
        results.push(result);
        
        if ('warning' in result && result.warning) {
          warnings.push(result.warning);
        }
      } else {
        // Promise was rejected - treat as warning and continue
        const errorMessage = settled.reason instanceof Error ? settled.reason.message : 'Unknown error';
        console.warn(`[JAF:GUARDRAILS] Input guardrail ${i + 1} promise rejected:`, errorMessage);
        warnings.push(`Guardrail ${i + 1} failed: ${errorMessage}`);
        results.push({ isValid: true, guardrailIndex: i, warning: `Promise rejected: ${errorMessage}` });
      }
    }
    
    // Log warnings if any
    if (warnings.length > 0) {
      console.warn(`[JAF:GUARDRAILS] ${warnings.length} guardrail warnings:`, warnings);
    }
    
    // Check if any input guardrail failed
    for (const result of results) {
      if (!result.isValid) {
        const errorMessage = 'errorMessage' in result ? result.errorMessage : 'Guardrail violation';
        console.log(`🚨 Input guardrail ${result.guardrailIndex + 1} violation: ${errorMessage}`);
        config.onEvent?.({
          type: 'guardrail_violation',
          data: { stage: 'input', reason: errorMessage }
        });
        return { isValid: false, errorMessage };
      }
    }
    
    console.log(`✅ All input guardrails passed.`);
    return { isValid: true };
  } catch (error) {
    // Catastrophic failure - this should rarely happen with Promise.allSettled
    console.error(`[JAF:GUARDRAILS] Catastrophic failure in input guardrail execution:`, error);
    
    // Default to allow to prevent complete system failure
    return { isValid: true };
  }
}

/**
 * Executes output guardrails with enhanced error handling and timeouts
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
  
  for (let i = 0; i < outputGuardrails.length; i++) {
    const guardrail = outputGuardrails[i];
    const guardrailName = `output-guardrail-${i + 1}`;
    
    try {
      // Individual timeout for each output guardrail (default 15s)
      const timeoutMs = 15000;
      
      const guardrailResult = guardrail(output);
      const result = await withTimeout(
        Promise.resolve(guardrailResult),
        timeoutMs,
        `${guardrailName} execution timed out after ${timeoutMs}ms`
      );
      
      if (!result.isValid) {
        const errorMessage = 'errorMessage' in result ? result.errorMessage : 'Guardrail violation';
        console.log(`🚨 ${guardrailName} violation: ${errorMessage}`);
        config.onEvent?.({ 
          type: 'guardrail_violation', 
          data: { stage: 'output', reason: errorMessage } 
        });
        return { isValid: false, errorMessage };
      }
      
      console.log(`✅ ${guardrailName} passed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[JAF:GUARDRAILS] ${guardrailName} failed:`, {
        error: errorMessage,
        index: i,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // For output guardrails, we're more strict - if they fail, we block
      // unless it's a timeout or system error, in which case we allow
      const isSystemError = errorMessage.includes('Timeout') || errorMessage.includes('Circuit breaker');
      
      if (isSystemError) {
        console.warn(`[JAF:GUARDRAILS] ${guardrailName} system error, allowing output: ${errorMessage}`);
        continue; // Allow and continue to next guardrail
      } else {
        // Actual guardrail violation
        config.onEvent?.({ 
          type: 'guardrail_violation', 
          data: { stage: 'output', reason: errorMessage } 
        });
        return { isValid: false, errorMessage };
      }
    }
  }
  
  console.log(`✅ All output guardrails passed`);
  return { isValid: true };
}

/**
 * Cleanup function to remove unused circuit breakers
 */
export function cleanupCircuitBreakers(): void {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  
  for (const [key, breaker] of circuitBreakers.entries()) {
    // Remove circuit breakers that haven't been used recently and are in good state
    if (breaker['lastFailureTime'] && (now - breaker['lastFailureTime']) > maxAge && !breaker.isOpen()) {
      circuitBreakers.delete(key);
    }
  }
}

/**
 * Export cache management functions for external monitoring and control
 */
export const guardrailCacheManager = {
  getStats: () => guardrailCache.getStats(),
  clear: () => guardrailCache.clear(),
  
  /**
   * Get cache performance metrics
   */
  getMetrics: () => {
    const stats = guardrailCache.getStats();
    return {
      ...stats,
      utilizationPercent: (stats.size / stats.maxSize) * 100,
      circuitBreakersCount: circuitBreakers.size
    };
  },
  
  /**
   * Log cache statistics for monitoring
   */
  logStats: () => {
    const metrics = guardrailCacheManager.getMetrics();
    console.log('[JAF:GUARDRAILS] Cache stats:', metrics);
  },
  
  /**
   * Cleanup unused resources
   */
  cleanup: () => {
    cleanupCircuitBreakers();
  }
};