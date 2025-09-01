import { TraceEvent, TraceId } from './types.js';

// Optional imports for tracing (these might not be available)
let trace: any;
let Resource: any; 
let NodeSDK: any;
let OTLPTraceExporter: any;
let SemanticResourceAttributes: any;
let Langfuse: any;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const otelApi = require('@opentelemetry/api');
  trace = otelApi.trace;
  
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const otelResources = require('@opentelemetry/resources');
  Resource = otelResources.Resource;
  
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const otelSdkNode = require('@opentelemetry/sdk-node');
  NodeSDK = otelSdkNode.NodeSDK;
  
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const otelExporter = require('@opentelemetry/exporter-otlp-http');
  OTLPTraceExporter = otelExporter.OTLPTraceExporter;
  
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const otelSemantic = require('@opentelemetry/semantic-conventions');
  SemanticResourceAttributes = otelSemantic.SemanticResourceAttributes;
} catch (e) {
  // OpenTelemetry not available
}

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Langfuse = require('langfuse').Langfuse;
} catch (e) {
  // Langfuse not available
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
    otelSdk = new NodeSDK({
      resource: Resource.default({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      }),
      traceExporter: new OTLPTraceExporter({
        url: collectorUrl,
      }),
    });

    otelSdk.start();
  } catch (error) {
    console.error('[JAF:OTEL] Failed to setup OpenTelemetry:', error);
  }
}

export class OpenTelemetryTraceCollector implements TraceCollector {
  private inMemory = new InMemoryTraceCollector();
  private activeRootSpan: any = null;
  private tracer: any;

  constructor(serviceName: string = 'jaf-agent') {
    this.tracer = trace?.getTracer(serviceName);
  }

  collect(event: TraceEvent): void {
    this.inMemory.collect(event);

    if (!this.tracer) {
      return;
    }

    try {
      const eventType = event.type;
      const data = event.data || {};

      if (eventType === 'run_start') {
        if (this.activeRootSpan) {
          this.activeRootSpan.end();
        }

        const traceId = (data as any).traceId || (data as any).runId;
        this.activeRootSpan = this.tracer.startSpan(`jaf.run.${traceId}`);
        trace.setSpan(trace.active(), this.activeRootSpan);
      } else if (this.activeRootSpan) {
        const ctx = trace.setSpan(trace.active(), this.activeRootSpan);
        const spanName = `jaf.${eventType}`;
        
        const span = this.tracer.startSpan(spanName, {}, ctx);
        
        // Set attributes
        Object.entries(data).forEach(([key, value]) => {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            span.setAttributes({ [key]: value });
          } else if (value !== undefined && value !== null) {
            try {
              span.setAttributes({ [key]: JSON.stringify(value) });
            } catch {
              span.setAttributes({ [key]: String(value) });
            }
          }
        });

        span.end();
      }

      if (eventType === 'run_end') {
        if (this.activeRootSpan) {
          this.activeRootSpan.end();
          this.activeRootSpan = null;
        }
      }
    } catch (error) {
      console.error('[JAF:OTEL] Error collecting trace event:', error);
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

export class LangfuseTraceCollector implements TraceCollector {
  private inMemory = new InMemoryTraceCollector();
  private langfuse: any;
  private activeSpans: Map<string, any> = new Map();
  private traceSpans: Map<TraceId, any> = new Map();

  constructor() {
    if (!Langfuse) {
      console.warn('[JAF:LANGFUSE] Langfuse not available');
      return;
    }

    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    const host = process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com';

    if (!publicKey || !secretKey) {
      console.warn('[JAF:LANGFUSE] Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY environment variables');
      return;
    }

    try {
      this.langfuse = new Langfuse({
        publicKey,
        secretKey,
        baseUrl: host,
        release: 'jaf-ts-v2.1.1',
      });
      console.log(`[JAF:LANGFUSE] Initialized with host: ${host}`);
    } catch (error) {
      console.error('[JAF:LANGFUSE] Failed to initialize:', error);
    }
  }

  collect(event: TraceEvent): void {
    this.inMemory.collect(event);

    if (!this.langfuse) {
      return;
    }

    try {
      const traceId = this.getTraceId(event);
      if (!traceId) {
        return;
      }

      const eventType = event.type;
      const data = event.data || {};

      switch (eventType) {
        case 'run_start': {
          console.log(`[JAF:LANGFUSE] Starting trace for run: ${traceId}`);
          
          // Extract session and user info from context or event data
          const context = (data as any).context || {};
          const userId = (data as any).userId || context.userId || 'anonymous';
          const sessionId = (data as any).sessionId || context.sessionId || context.conversationId || `session-${traceId}`;
          
          console.log(`[JAF:LANGFUSE] Using userId: ${userId}, sessionId: ${sessionId}`);
          
          const trace = this.langfuse.trace({
            name: `jaf-run-${traceId}`,
            userId: userId,
            sessionId: sessionId,
            input: data,
            metadata: { 
              framework: 'jaf', 
              eventType: 'run_start', 
              traceId: String(traceId),
              agentName: (data as any).agentName,
              context: context
            },
          });
          this.traceSpans.set(traceId, trace);
          break;
        }

        case 'run_end':
          if (this.traceSpans.has(traceId)) {
            console.log(`[JAF:LANGFUSE] Ending trace for run: ${traceId}`);
            this.traceSpans.get(traceId)?.update({ output: data });
            this.langfuse.flushAsync();
            this.traceSpans.delete(traceId);
          }
          break;

        case 'llm_call_start': {
          if (this.traceSpans.has(traceId)) {
            const model = (data as any).model || 'unknown';
            console.log(`[JAF:LANGFUSE] Starting generation for LLM call with model: ${model}`);
            const generation = this.traceSpans.get(traceId)?.generation({
              name: `llm-call-${model}`,
              input: (data as any).messages,
              metadata: { agentName: (data as any).agentName, model },
            });
            const spanId = this.getSpanId(event);
            this.activeSpans.set(spanId, generation);
          }
          break;
        }

        case 'llm_call_end': {
          const spanId = this.getSpanId(event);
          if (this.activeSpans.has(spanId)) {
            console.log(`[JAF:LANGFUSE] Ending generation for LLM call`);
            const generation = this.activeSpans.get(spanId);
            const choice = (data as any).choice || {};
            const usage = (data as any).usage;

            let langfuseUsage;
            if (usage) {
              langfuseUsage = {
                input: usage.prompt_tokens || 0,
                output: usage.completion_tokens || 0,
                total: usage.total_tokens || 0,
                unit: 'TOKENS',
              };
            }

            generation?.end({ output: choice, usage: langfuseUsage });
            this.activeSpans.delete(spanId);
          }
          break;
        }

        case 'tool_call_start': {
          if (this.traceSpans.has(traceId)) {
            const toolName = (data as any).toolName || 'unknown';
            console.log(`[JAF:LANGFUSE] Starting span for tool call: ${toolName}`);
            const span = this.traceSpans.get(traceId)?.span({
              name: `tool-${toolName}`,
              input: (data as any).args,
              metadata: { toolName },
            });
            const toolSpanId = this.getSpanId(event);
            this.activeSpans.set(toolSpanId, span);
          }
          break;
        }

        case 'tool_call_end': {
          const toolSpanId = this.getSpanId(event);
          if (this.activeSpans.has(toolSpanId)) {
            console.log(`[JAF:LANGFUSE] Ending span for tool call`);
            const span = this.activeSpans.get(toolSpanId);
            span?.end({ output: (data as any).result });
            this.activeSpans.delete(toolSpanId);
          }
          break;
        }

        case 'handoff':
          if (this.traceSpans.has(traceId)) {
            console.log(`[JAF:LANGFUSE] Creating event for handoff`);
            this.traceSpans.get(traceId)?.event({
              name: 'agent-handoff',
              input: { from: (data as any).from, to: (data as any).to },
              metadata: data,
            });
          }
          break;

        case 'agent_processing':
          if (this.traceSpans.has(traceId)) {
            console.log(`[JAF:LANGFUSE] Creating span for agent processing: ${(data as any).agentName}`);
            const span = this.traceSpans.get(traceId)?.span({
              name: `agent-processing-${(data as any).agentName}`,
              input: {
                agentName: (data as any).agentName,
                turnCount: (data as any).turnCount,
                messageCount: (data as any).messageCount,
                toolsAvailable: (data as any).toolsAvailable,
                handoffsAvailable: (data as any).handoffsAvailable
              },
              metadata: {
                ...data,
                framework: 'jaf',
                eventType: 'agent_processing'
              }
            });
            span?.end(); // Agent processing is instantaneous
          }
          break;

        default:
          if (this.traceSpans.has(traceId)) {
            console.log(`[JAF:LANGFUSE] Creating generic event for: ${eventType}`);
            this.traceSpans.get(traceId)?.event({
              name: eventType,
              input: data,
              metadata: { framework: 'jaf', eventType },
            });
          }
          break;
      }
    } catch (error) {
      console.error('[JAF:LANGFUSE] Error collecting trace event:', error);
    }
  }

  private getTraceId(event: TraceEvent): TraceId | null {
    const data = event.data as any;
    return data?.traceId || data?.runId || null;
  }

  private getSpanId(event: TraceEvent): string {
    const traceId = this.getTraceId(event);
    const data = event.data as any;
    
    if (event.type.startsWith('tool_call')) {
      const toolName = data?.toolName || 'unknown';
      return `tool-${toolName}-${traceId}`;
    } else if (event.type.startsWith('llm_call')) {
      const model = data?.model || 'unknown';
      return `llm-${model}-${traceId}`;
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

  // Automatically add Langfuse collector if keys are configured
  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY && Langfuse) {
    const langfuseCollector = new LangfuseTraceCollector();
    collectorList.push(langfuseCollector);
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
