import { TraceEvent, TraceId, RunId } from './types.js';

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
      case 'llm_call_end': {
        const choice = event.data.choice;
        const hasTools = choice.message?.tool_calls?.length > 0;
        const hasContent = !!choice.message?.content;
        console.log(`${prefix} LLM responded with ${hasTools ? 'tool calls' : hasContent ? 'content' : 'empty response'}`);
        break;
      }
      case 'tool_call_start':
        console.log(`${prefix} Executing tool ${event.data.toolName} with args:`, event.data.args);
        break;
      case 'tool_call_end':
        console.log(`${prefix} Tool ${event.data.toolName} completed`);
        break;
      case 'handoff':
        console.log(`${prefix} Agent handoff: ${event.data.from} → ${event.data.to}`);
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

export function createCompositeTraceCollector(...collectors: TraceCollector[]): TraceCollector {
  return {
    collect(event: TraceEvent): void {
      collectors.forEach(c => c.collect(event));
    },
    
    getTrace(traceId: TraceId): TraceEvent[] {
      return collectors[0]?.getTrace(traceId) || [];
    },
    
    getAllTraces(): Map<TraceId, TraceEvent[]> {
      return collectors[0]?.getAllTraces() || new Map();
    },
    
    clear(traceId?: TraceId): void {
      collectors.forEach(c => c.clear(traceId));
    }
  };
}