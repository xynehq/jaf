import { mod } from 'mathjs';
import { TraceEvent, TraceId, createTraceId } from './types.js';

// Optional imports for tracing (these might not be available)
let trace: any;
let context: any;
let Resource: any; 
let NodeSDK: any;
let OTLPTraceExporter: any;
let SemanticResourceAttributes: any;
let Langfuse: any;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const otelApi = require('@opentelemetry/api');
  trace = otelApi.trace;
  context = otelApi.context;
  
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const otelResources = require('@opentelemetry/resources');
  Resource = otelResources.Resource;
  
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const otelSdkNode = require('@opentelemetry/sdk-node');
  NodeSDK = otelSdkNode.NodeSDK;
  
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const otelExporter = require('@opentelemetry/exporter-trace-otlp-http');
  OTLPTraceExporter = otelExporter.OTLPTraceExporter;
  
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const otelSemantic = require('@opentelemetry/semantic-conventions');
  SemanticResourceAttributes = otelSemantic.SemanticResourceAttributes;
} catch (e) {
  // OpenTelemetry not available
}


export interface TraceCollector {
  collect(event: TraceEvent): void;
  getTrace(traceId: TraceId): TraceEvent[];
  getAllTraces(): Map<TraceId, TraceEvent[]>;
  clear(traceId?: TraceId): void;
}

export class InMemoryTraceCollector implements TraceCollector {
  private traces = new Map<TraceId, TraceEvent[]>();

  collect(event: TraceEvent): void {
    let traceId: TraceId | null = null;
    
    if ('traceId' in event.data) {
      traceId = event.data.traceId;
    } else if ('runId' in event.data) {
      traceId = event.data.runId as TraceId;
    }
    
    if (!traceId) return;

    if (!this.traces.has(traceId)) {
      this.traces.set(traceId, []);
    }
    
    const events = this.traces.get(traceId)!;
    events.push(event);
  }

  getTrace(traceId: TraceId): TraceEvent[] {
    return this.traces.get(traceId) || [];
  }

  getAllTraces(): Map<TraceId, TraceEvent[]> {
    return new Map(this.traces);
  }

  clear(traceId?: TraceId): void {
    if (traceId) {
      this.traces.delete(traceId);
    } else {
      this.traces.clear();
    }
  }
}

export class ConsoleTraceCollector implements TraceCollector {
  private inMemory = new InMemoryTraceCollector();

  collect(event: TraceEvent): void {
    this.inMemory.collect(event);
    
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] JAF:${event.type}`;
    
    switch (event.type) {
      case 'run_start':
        console.log(`${prefix} Starting run ${event.data.runId} (trace: ${event.data.traceId})`);
        break;
      case 'llm_call_start':
        console.log(`${prefix} Calling ${event.data.model} for agent ${event.data.agentName}`);
        break;
      case 'turn_start':
        console.log(`${prefix} Turn ${event.data.turn} started for ${event.data.agentName}`);
        break;
      case 'llm_call_end': {
        const choice = event.data.choice;
        const hasTools = choice.message?.tool_calls?.length > 0;
        const hasContent = !!choice.message?.content;
        console.log(`${prefix} LLM responded with ${hasTools ? 'tool calls' : hasContent ? 'content' : 'empty response'}`);
        break;
      }
      case 'token_usage':
        console.log(`${prefix} Token usage: prompt=${event.data.prompt ?? '-'} completion=${event.data.completion ?? '-'} total=${event.data.total ?? '-'}`);
        break;
      case 'tool_call_start':
        console.log(`${prefix} Executing tool ${event.data.toolName} with args:`, event.data.args);
        break;
      case 'tool_call_end':
        console.log(`${prefix} Tool ${event.data.toolName} completed`);
        break;
      case 'handoff':
        console.log(`${prefix} Agent handoff: ${event.data.from} → ${event.data.to}`);
        break;
      case 'handoff_denied':
        console.warn(`${prefix} Handoff denied: ${event.data.from} → ${event.data.to}. Reason: ${event.data.reason}`);
        break;
      case 'guardrail_violation':
        console.warn(`${prefix} Guardrail violation (${event.data.stage}): ${event.data.reason}`);
        break;
      case 'decode_error':
        console.error(`${prefix} Decode error:`, event.data.errors);
        break;
      case 'agent_processing':
        console.log(`${prefix} Agent ${event.data.agentName} processing (turn ${event.data.turnCount}, ${event.data.messageCount} messages, ${event.data.toolsAvailable.length} tools)`);
        break;
      case 'turn_end':
        console.log(`${prefix} Turn ${event.data.turn} ended for ${event.data.agentName}`);
        break;
      case 'run_end': {
        const outcome = event.data.outcome;
        if (outcome.status === 'completed') {
          console.log(`${prefix} Run completed successfully`);
        } else {
          console.error(`${prefix} Run failed:`, outcome.error._tag, outcome.error);
        }
        break;
      }
    }
  }

  getTrace(traceId: TraceId): TraceEvent[] {
    return this.inMemory.getTrace(traceId);
  }

  getAllTraces(): Map<TraceId, TraceEvent[]> {
    return this.inMemory.getAllTraces();
  }

  clear(traceId?: TraceId): void {
    this.inMemory.clear(traceId);
  }
}

export class FileTraceCollector implements TraceCollector {
  private inMemory = new InMemoryTraceCollector();
  
  constructor(private filePath: string) {}

  collect(event: TraceEvent): void {
    this.inMemory.collect(event);
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...event
    };
    
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      fs.appendFileSync(this.filePath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to write trace to file:', error);
    }
  }

  getTrace(traceId: TraceId): TraceEvent[] {
    return this.inMemory.getTrace(traceId);
  }

  getAllTraces(): Map<TraceId, TraceEvent[]> {
    return this.inMemory.getAllTraces();
  }

  clear(traceId?: TraceId): void {
    this.inMemory.clear(traceId);
  }
}

// Global variables for OpenTelemetry setup
let otelSdk: any = null;

function setupOpenTelemetry(serviceName: string = 'jaf-agent', collectorUrl?: string): void {
  if (!NodeSDK || !OTLPTraceExporter || !Resource || !SemanticResourceAttributes || !collectorUrl) {
    return;
  }

  try {
    // Parse headers from environment variable
    const headersEnv = process.env.OTEL_EXPORTER_OTLP_HEADERS;
    const headers: Record<string, string> = {};
    
    if (headersEnv) {
      console.log(`[JAF:OTEL] Parsing headers: ${headersEnv}`);
      // Parse comma-separated key=value pairs
      headersEnv.split(',').forEach(header => {
        const [key, value] = header.trim().split('=');
        if (key && value) {
          headers[key] = value;
        }
      });
      console.log(`[JAF:OTEL] Parsed headers:`, Object.keys(headers));
    }

    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    });

    otelSdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({
        url: collectorUrl,
        headers: headers,
      }),
      resource: resource.merge(new Resource({})),
      // Disable default resource detectors to minimize attributes
      autoDetectResources: false
    });

    console.log(`[JAF:OTEL] Starting OpenTelemetry SDK with URL: ${collectorUrl}`);
    otelSdk.start();
    console.log(`[JAF:OTEL] OpenTelemetry SDK started successfully`);
    
    // Add shutdown hook to flush traces
    process.on('beforeExit', async () => {
      console.log('[JAF:OTEL] Flushing traces before exit...');
      try {
        await otelSdk.shutdown();
        console.log('[JAF:OTEL] Traces flushed successfully.');
      } catch (error) {
        console.error('[JAF:OTEL] Error flushing traces:', JSON.stringify(error, null, 2));
      }
    });
    
  } catch (error) {
    console.error('[JAF:OTEL] Failed to setup OpenTelemetry:', error);
  }
}

export class OpenTelemetryTraceCollector implements TraceCollector {
  private inMemory = new InMemoryTraceCollector();
  private activeSpans: Map<string, any> = new Map();
  private traceSpans: Map<TraceId, any> = new Map();
  private tokenUsage: Map<TraceId, { prompt: number; completion: number; total: number }> = new Map();
  private traceModels: Map<TraceId, string> = new Map();
  private tracer: any;

  constructor(serviceName: string = 'jaf-agent') {
    // Initialize OpenTelemetry SDK if URL is configured and not already initialized
    const collectorUrl = process.env.TRACE_COLLECTOR_URL;
    const headersEnv = process.env.OTEL_EXPORTER_OTLP_HEADERS;
    
    console.log(`[OTEL] Constructor called with serviceName: ${serviceName}`);
    console.log(`[OTEL] TRACE_COLLECTOR_URL: ${collectorUrl}`);
    console.log(`[OTEL] OTEL_EXPORTER_OTLP_HEADERS: ${headersEnv}`);
    console.log(`[OTEL] otelSdk already initialized: ${!!otelSdk}`);
    console.log(`[OTEL] NodeSDK available: ${!!NodeSDK}`);
    console.log(`[OTEL] OTLPTraceExporter available: ${!!OTLPTraceExporter}`);
    
    if (collectorUrl && !otelSdk) {
      console.log(`[OTEL] Initializing OpenTelemetry SDK with collector URL: ${collectorUrl}`);
      setupOpenTelemetry(serviceName, collectorUrl);
    }
    
    this.tracer = trace?.getTracer(serviceName);
    if (!this.tracer) {
      console.warn('[OTEL] OpenTelemetry tracer not available');
      console.warn('[OTEL] trace object:', !!trace);
      if (!collectorUrl) {
        console.warn('[OTEL] TRACE_COLLECTOR_URL not set - traces will not be exported');
      }
    } else {
      console.log(`[OTEL] OpenTelemetry tracer initialized for service: ${serviceName}`);
      if (collectorUrl) {
        console.log(`[OTEL] Configured to export traces to: ${collectorUrl}`);
      }
    }
  }

  collect(event: TraceEvent): void {
    this.inMemory.collect(event);

    if (!this.tracer) {
      return;
    }

    try {
      const traceId = this._getTraceId(event);
      if (!traceId) {
        console.warn('[OTEL] No trace ID found in event:', event.type);
        return;
      }

      const eventType = event.type;
      const data = event.data || {};

      switch (eventType) {
        case 'run_start': {
          if (this.traceSpans.has(traceId)) {
            console.warn(`[OTEL] Trace with ID ${traceId} already exists. Skipping creation of new root span.`);
            return;
          }
          // Start a new trace for the entire run
          console.log(`[OTEL] Starting trace for run: ${traceId}`);
          
          // Initialize token usage tracking for this trace
          this.tokenUsage.set(traceId, { prompt: 0, completion: 0, total: 0 });
          
          // Extract user query from the run_start data
          let userQuery: string | null = null;
          let userId: string | null = null;
          
          // Debug: Print the event data structure to understand what we're working with
          console.log(`[OTEL DEBUG] Event data keys: ${Object.keys(data).join(', ')}`);
          if ((data as any).context) {
            const context = (data as any).context;
            console.log(`[OTEL DEBUG] Context type: ${typeof context}`);
            console.log(`[OTEL DEBUG] Context keys: ${Object.keys(context || {}).join(', ')}`);
          }
          
          // Try to extract from context first
          const context = (data as any).context;
          if (context) {
            // Try direct attribute access
            if (context.query) {
              userQuery = context.query;
              console.log(`[OTEL DEBUG] Found user_query from context.query: ${userQuery}`);
            }
            
            // Try to extract from combined_history
            if (context.combined_history && Array.isArray(context.combined_history)) {
              const history = context.combined_history;
              console.log(`[OTEL DEBUG] Found combined_history with ${history.length} messages`);
              for (let i = history.length - 1; i >= 0; i--) {
                const msg = history[i];
                console.log(`[OTEL DEBUG] History message ${history.length - 1 - i}: ${JSON.stringify(msg).substring(0, 100)}...`);
                if (typeof msg === 'object' && msg?.role === 'user') {
                  userQuery = msg.content || '';
                  console.log(`[OTEL DEBUG] Found user_query from history: ${userQuery}`);
                  break;
                }
              }
            }
            
            // Try to extract user_id from token_response
            if (context.token_response) {
              const tokenResponse = context.token_response;
              console.log(`[OTEL DEBUG] Found token_response: ${typeof tokenResponse}`);
              if (typeof tokenResponse === 'object') {
                userId = tokenResponse.email || tokenResponse.username || null;
                console.log(`[OTEL DEBUG] Extracted user_id: ${userId}`);
              }
            }
            
            // Also try direct userId from context
            if (context.userId) {
              userId = context.userId;
              console.log(`[OTEL DEBUG] Found userId directly in context: ${userId}`);
            }
          }
          
          // Fallback: try to extract from messages if context didn't work
          if (!userQuery && (data as any).messages) {
            console.log(`[OTEL DEBUG] Trying fallback from messages`);
            const messages = (data as any).messages;
            console.log(`[OTEL DEBUG] Found ${messages.length} messages`);
            // Find the last user message which should be the current query
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i];
              console.log(`[OTEL DEBUG] Message ${messages.length - 1 - i}: ${JSON.stringify(msg).substring(0, 100)}...`);
              if (typeof msg === 'object' && msg?.role === 'user') {
                userQuery = msg.content || '';
                console.log(`[OTEL DEBUG] Found user_query from messages: ${userQuery}`);
                break;
              }
            }
          }
          
          console.log(`[OTEL DEBUG] Final extracted - user_query: ${userQuery}, user_id: ${userId}`);
          
          // Create comprehensive input data for the trace
          const traceInput = {
            user_query: userQuery,
            run_id: String(traceId),
            agent_name: (data as any).agentName || 'analytics_agent_jaf',
            session_info: {
              session_id: (data as any).sessionId,
              user_id: userId || (data as any).userId
            }
          };
          
          const rootSpan = this.tracer.startSpan(`jaf-run-${traceId}`, {
            attributes: {
              'framework': 'jaf',
              'event.type': 'run_start',
              'trace.id': String(traceId),
              'user.query': userQuery || 'unknown',
              'user.id': userId || (data as any).userId || 'anonymous',
              'agent.name': (data as any).agentName || 'analytics_agent_jaf',
              'session.id': (data as any).sessionId || 'unknown',
              'input': JSON.stringify(traceInput),
              'gen_ai.request.model': (data as any).model || 'unknown'
            }
          });
          
          this.traceSpans.set(traceId, rootSpan);
          // Store user_id and user_query for later use in generations
          (rootSpan as any)._user_id = userId || (data as any).userId;
          (rootSpan as any)._user_query = userQuery;
          console.log(`[OTEL] Created trace with user query: ${userQuery ? userQuery.substring(0, 100) + '...' : 'None'}`);
          break;
        }

        case 'run_end': {
          if (this.traceSpans.has(traceId)) {
            console.log(`[OTEL] Ending trace for run: ${traceId}`);
            const rootSpan = this.traceSpans.get(traceId);
            
            // Get accumulated token usage for this trace
            const totalUsage = this.tokenUsage.get(traceId) || { prompt: 0, completion: 0, total: 0 };
            
            // Get model for this trace
            const model = this.traceModels.get(traceId) || 'unknown';
            
            // Set final attributes
            const outcome = (data as any).outcome;
            if (outcome) {
              const attributes = {
                'run_status': outcome.status || 'unknown',
                'output': JSON.stringify(outcome.output),
                'model': model,
                'gen_ai.request.model': model,
                'llm.token_count.total': totalUsage.total,
                'gen_ai.usage.prompt_tokens': totalUsage.prompt,
                'langfuse.observation.model.name': model,
                'gen_ai.usage.completion_tokens': totalUsage.completion,
                'gen_ai.usage.total_tokens': totalUsage.total,
                'gen_ai.usage.input_tokens': totalUsage.prompt,
                'gen_ai.usage.output_tokens': totalUsage.completion,
              };
              rootSpan.setAttributes(attributes);
              console.log('[OTEL] Root span attributes:', attributes);
              
              if (outcome.status !== 'completed' && outcome.error) {
                rootSpan.recordException(new Error(outcome.error._tag || 'Unknown error'));
                rootSpan.setStatus({ code: 2, message: outcome.error._tag || 'Run failed' }); // ERROR status
              } else {
                rootSpan.setStatus({ code: 1 }); // OK status
              }
            }
            
            rootSpan.end();
            this.traceSpans.delete(traceId);
            // Clean up token usage and model tracking
            this.tokenUsage.delete(traceId);
            this.traceModels.delete(traceId);
            console.log(`[OTEL] Trace ended for run: ${traceId} with total usage: ${JSON.stringify(totalUsage)}`);
          }
          break;
        }

        case 'llm_call_start': {
          if (this.traceSpans.has(traceId)) {
            // Start a generation for LLM calls
            const model = (data as any).model || 'unknown';
            this.traceModels.set(traceId, model);
            console.log(`[OTEL] Starting generation for LLM call with model: ${model}`);
            
            // Get stored user information from the trace
            const rootSpan = this.traceSpans.get(traceId);
            const userId = (rootSpan as any)._user_id || null;
            const userQuery = (rootSpan as any)._user_query || null;
            
            const ctx = trace.setSpan(context.active(), rootSpan);
            const generationSpan = this.tracer.startSpan(`llm-call-${model}`, {
              attributes: {
                'gen_ai.operation.name': 'chat',
                'gen_ai.provider.name': 'jaf',
                'model': model,
                'langfuse.observation.model.name':model,
                'gen_ai.request.model': model,
                'agent.name': (data as any).agentName || 'unknown',
                'user.id': userId || 'unknown',
                'user.query': userQuery || 'unknown',
                'gen_ai.input.messages': JSON.stringify((data as any).messages || {}),
              }
            }, ctx);
            generationSpan.setAttribute('model', model);
            
            const spanId = this._getSpanId(event);
            this.activeSpans.set(spanId, generationSpan);
            console.log(`[OTEL] Created LLM generation span for model: ${model}`);
          }
          break;
        }

        case 'llm_call_end': {
          const spanId = this._getSpanId(event);
          if (this.activeSpans.has(spanId)) {
            console.log(`[OTEL] Ending generation for LLM call`);
            const generationSpan = this.activeSpans.get(spanId);
            
            const choice = (data as any).choice || {};
            const usage = (data as any).usage || {};
            
            // Extract model information from choice data or event data
            let model = choice.model || 'unknown';
            if (model === 'unknown') {
              // Try to get model from the choice response structure
              if (typeof choice === 'object') {
                model = choice.model || choice.id || 'unknown';
              }
            }
            
            // Set comprehensive attributes for cost calculation and tracking
            const promptTokens = usage.prompt_tokens || 0;
            const completionTokens = usage.completion_tokens || 0;
            const totalTokens = usage.total_tokens || 0;
            
            // Accumulate token usage for this trace
            if (this.tokenUsage.has(traceId)) {
              const currentUsage = this.tokenUsage.get(traceId)!;
              currentUsage.prompt += promptTokens;
              currentUsage.completion += completionTokens;
              currentUsage.total += totalTokens;
              this.tokenUsage.set(traceId, currentUsage);
            }
            
            const attributes = {
              'model': model,
              'langfuse.observation.model.name': model,
              'llm.model_name': model,
              'gen_ai.request.model': model,
              'gen_ai.response.model': model,
              'gen_ai.output.messages': JSON.stringify(choice.message),
              'llm.token_count.prompt': promptTokens,
              'llm.token_count.completion': completionTokens,
              'gen_ai.usage.input_tokens': promptTokens,
              'gen_ai.usage.output_tokens': completionTokens,
              'gen_ai.usage.total_tokens': totalTokens,
              'gen_ai.usage.prompt_tokens': promptTokens,
              'gen_ai.usage.completion_tokens': completionTokens,
              'gen_ai.response.finish_reasons': JSON.stringify(choice.finish_reason ? [choice.finish_reason] : []),
              'gen_ai.response.id': choice.id || 'unknown',
            };
            generationSpan.setAttributes(attributes);
            console.log('[OTEL] Generation span attributes:', attributes);
            
            console.log(`[OTEL] Usage data for cost tracking: prompt=${promptTokens}, completion=${completionTokens}, total=${totalTokens}`);
            
            generationSpan.setStatus({ code: 1 }); // OK status
            generationSpan.end();
            
            // Clean up the span reference
            this.activeSpans.delete(spanId);
            console.log(`[OTEL] Generation ended with cost tracking`);
          } else {
            console.log(`[OTEL] No generation found for llm_call_end: ${spanId}`);
          }
          break;
        }

        case 'tool_call_start': {
          if (this.traceSpans.has(traceId)) {
            // Start a span for tool calls with detailed input information
            const toolName = (data as any).toolName || 'unknown';
            const toolArgs = (data as any).args || {};
            
            console.log(`[OTEL] Starting span for tool call: ${toolName}`);
            
            // Create comprehensive input data for the tool call
            const toolInput = {
              tool_name: toolName,
              arguments: toolArgs,
              call_id: (data as any).callId,
              timestamp: new Date().toISOString()
            };
            
            const rootSpan = this.traceSpans.get(traceId);
            const ctx = trace.setSpan(context.active(), rootSpan);
            const toolSpan = this.tracer.startSpan(`tool-${toolName}`, {
              attributes: {
                'tool.name': toolName,
                'call.id': (data as any).callId || 'unknown',
                'framework': 'jaf',
                'input': JSON.stringify(toolInput),
                'event.type': 'tool_call',
                'args': JSON.stringify(toolArgs)
              }
            }, ctx);
            
            const toolSpanId = this._getSpanId(event);
            this.activeSpans.set(toolSpanId, toolSpan);
            console.log(`[OTEL] Created tool span for ${toolName} with args: ${JSON.stringify(toolArgs).substring(0, 100)}...`);
          }
          break;
        }

        case 'tool_call_end': {
          const toolSpanId = this._getSpanId(event);
          if (this.activeSpans.has(toolSpanId)) {
            const toolName = (data as any).toolName || 'unknown';
            const toolResult = (data as any).result;
            
            console.log(`[OTEL] Ending span for tool call: ${toolName}`);
            
            // Create comprehensive output data for the tool call
            const toolOutput = {
              tool_name: toolName,
              result: toolResult,
              call_id: (data as any).callId,
              timestamp: new Date().toISOString(),
              status: 'completed'
            };
            
            // End the span with detailed output
            const toolSpan = this.activeSpans.get(toolSpanId);
            toolSpan.setAttributes({
              'tool.name': toolName,
              'call.id': (data as any).callId || 'unknown',
              'result.length': toolResult ? String(toolResult).length : 0,
              'framework': 'jaf',
              'event.type': 'tool_call_end',
              'output': JSON.stringify(toolOutput),
              'status': 'completed'
            });
            
            toolSpan.setStatus({ code: 1 }); // OK status
            toolSpan.end();
            
            // Clean up the span reference
            this.activeSpans.delete(toolSpanId);
            console.log(`[OTEL] Tool span ended for ${toolName} with result length: ${toolResult ? String(toolResult).length : 0}`);
          } else {
            console.log(`[OTEL] No tool span found for tool_call_end: ${toolSpanId}`);
          }
          break;
        }

        case 'handoff': {
          if (this.traceSpans.has(traceId)) {
            console.log(`[OTEL] Creating event for handoff`);
            const rootSpan = this.traceSpans.get(traceId);
            const ctx = trace.setSpan(context.active(), rootSpan);
            
            const handoffSpan = this.tracer.startSpan('agent-handoff', {
              attributes: {
                'from_agent': (data as any).from || 'unknown',
                'to_agent': (data as any).to || 'unknown',
                'framework': 'jaf',
                'event_type': 'handoff',
                'input': JSON.stringify(data)
              }
            }, ctx);
            
            handoffSpan.setStatus({ code: 1 }); // OK status
            handoffSpan.end();
            console.log(`[OTEL] Handoff event created: ${(data as any).from} → ${(data as any).to}`);
          }
          break;
        }

        case 'agent_processing': {
          if (this.traceSpans.has(traceId)) {
            console.log(`[OTEL] Creating span for agent processing: ${(data as any).agentName}`);
            const rootSpan = this.traceSpans.get(traceId);
            const ctx = trace.setSpan(context.active(), rootSpan);
            
            const processingSpan = this.tracer.startSpan(`agent-processing-${(data as any).agentName}`, {
              attributes: {
                'agent_name': (data as any).agentName || 'unknown',
                'turn_count': (data as any).turnCount || 0,
                'message_count': (data as any).messageCount || 0,
                'tools_available': JSON.stringify((data as any).toolsAvailable || []),
                'handoffs_available': JSON.stringify((data as any).handoffsAvailable || []),
                'framework': 'jaf',
                'event_type': 'agent_processing',
                'input': JSON.stringify(data)
              }
            }, ctx);
            
            processingSpan.setStatus({ code: 1 }); // OK status
            processingSpan.end(); // Agent processing is instantaneous
            console.log(`[OTEL] Agent processing span completed for: ${(data as any).agentName}`);
          }
          break;
        }

        default: {
          // Handle other event types with generic spans
          if (this.traceSpans.has(traceId)) {
            console.log(`[OTEL] Creating generic span for: ${eventType}`);
            const rootSpan = this.traceSpans.get(traceId);
            const ctx = trace.setSpan(context.active(), rootSpan);
            
            const genericSpan = this.tracer.startSpan(eventType, {
              attributes: {
                'framework': 'jaf',
                'event_type': eventType,
                'input': JSON.stringify(data)
              }
            }, ctx);
            
            genericSpan.setStatus({ code: 1 }); // OK status
            genericSpan.end();
            console.log(`[OTEL] Generic span created for: ${eventType}`);
          }
          break;
        }
      }
    } catch (error) {
      console.error('[OTEL] Error collecting trace event:', error);
      // Try to record the exception in the root span if available
      const errorTraceId = this._getTraceId(event);
      if (errorTraceId && this.traceSpans.has(errorTraceId)) {
        const rootSpan = this.traceSpans.get(errorTraceId);
        if (rootSpan) {
          rootSpan.recordException(error as Error);
        }
      }
    }
  }

  private _getTraceId(event: TraceEvent): TraceId | null {
    const data = event.data as any;
    if (data?.traceId) return data.traceId;
    if (data?.runId) return data.runId as TraceId;
    // if ((event as any).traceId) return (event as any).traceId;
    if (data?.trace_id) return data.trace_id;
    if (data?.run_id) return data.run_id as TraceId;
    return null;
  }

  private _getSpanId(event: TraceEvent): string {
    const traceId = this._getTraceId(event);
    const data = event.data as any;
    
    if (event.type.startsWith('tool_call')) {
      const toolName = data?.toolName || 'unknown';
      return `tool-${toolName}-${traceId}`;
    } else if (event.type.startsWith('llm_call')) {
      // For LLM calls, use a simpler consistent ID that matches between start and end
      // Get run_id for more consistent matching
      const runId = data?.runId || data?.run_id || traceId;
      return `llm-${runId}`;
    } else {
      return `${event.type}-${traceId}`;
    }
  }

  getTrace(traceId: TraceId): TraceEvent[] {
    return this.inMemory.getTrace(traceId);
  }

  getAllTraces(): Map<TraceId, TraceEvent[]> {
    return this.inMemory.getAllTraces();
  }

  clear(traceId?: TraceId): void {
    this.inMemory.clear(traceId);
    // Also clean up any active spans for this trace
    if (traceId) {
      if (this.traceSpans.has(traceId)) {
        const rootSpan = this.traceSpans.get(traceId);
        if (rootSpan) {
          rootSpan.end();
        }
        this.traceSpans.delete(traceId);
      }
      
      // Clean up any active spans that belong to this trace
      const spansToDelete: string[] = [];
      for (const [spanId, span] of this.activeSpans.entries()) {
        if (spanId.includes(String(traceId))) {
          span.end();
          spansToDelete.push(spanId);
        }
      }
      spansToDelete.forEach(spanId => this.activeSpans.delete(spanId));
    } else {
      // Clear all spans
      for (const [, span] of this.traceSpans.entries()) {
        span.end();
      }
      for (const [, span] of this.activeSpans.entries()) {
        span.end();
      }
      this.traceSpans.clear();
      this.activeSpans.clear();
    }
  }
}


export function createCompositeTraceCollector(...collectors: TraceCollector[]): TraceCollector {
  const collectorList = [...collectors];
  
  // Automatically add OpenTelemetry collector if URL is configured
  const collectorUrl = process.env.TRACE_COLLECTOR_URL;
  if (collectorUrl && OTLPTraceExporter) {
    setupOpenTelemetry('jaf-agent', collectorUrl);
    const otelCollector = new OpenTelemetryTraceCollector();
    collectorList.push(otelCollector);
  }


  return {
    collect(event: TraceEvent): void {
      collectorList.forEach(c => {
        try {
          c.collect(event);
        } catch (error) {
          console.error('[JAF:TRACING] Error in trace collector:', error);
        }
      });
    },
    
    getTrace(traceId: TraceId): TraceEvent[] {
      return collectorList[0]?.getTrace(traceId) || [];
    },
    
    getAllTraces(): Map<TraceId, TraceEvent[]> {
      return collectorList[0]?.getAllTraces() || new Map();
    },
    
    clear(traceId?: TraceId): void {
      collectorList.forEach(c => {
        try {
          c.clear(traceId);
        } catch (error) {
          console.error('[JAF:TRACING] Error clearing trace collector:', error);
        }
      });
    }
  };
}
