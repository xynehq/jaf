"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileTraceCollector = exports.ConsoleTraceCollector = exports.InMemoryTraceCollector = void 0;
exports.createCompositeTraceCollector = createCompositeTraceCollector;
class InMemoryTraceCollector {
    traces = new Map();
    collect(event) {
        let traceId = null;
        if ('traceId' in event.data) {
            traceId = event.data.traceId;
        }
        else if ('runId' in event.data) {
            traceId = event.data.runId;
        }
        if (!traceId)
            return;
        if (!this.traces.has(traceId)) {
            this.traces.set(traceId, []);
        }
        const events = this.traces.get(traceId);
        events.push(event);
    }
    getTrace(traceId) {
        return this.traces.get(traceId) || [];
    }
    getAllTraces() {
        return new Map(this.traces);
    }
    clear(traceId) {
        if (traceId) {
            this.traces.delete(traceId);
        }
        else {
            this.traces.clear();
        }
    }
}
exports.InMemoryTraceCollector = InMemoryTraceCollector;
class ConsoleTraceCollector {
    inMemory = new InMemoryTraceCollector();
    collect(event) {
        this.inMemory.collect(event);
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] FAF:${event.type}`;
        switch (event.type) {
            case 'run_start':
                console.log(`${prefix} Starting run ${event.data.runId} (trace: ${event.data.traceId})`);
                break;
            case 'llm_call_start':
                console.log(`${prefix} Calling ${event.data.model} for agent ${event.data.agentName}`);
                break;
            case 'llm_call_end':
                const choice = event.data.choice;
                const hasTools = choice.message?.tool_calls?.length > 0;
                const hasContent = !!choice.message?.content;
                console.log(`${prefix} LLM responded with ${hasTools ? 'tool calls' : hasContent ? 'content' : 'empty response'}`);
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
            case 'run_end':
                const outcome = event.data.outcome;
                if (outcome.status === 'completed') {
                    console.log(`${prefix} Run completed successfully`);
                }
                else {
                    console.error(`${prefix} Run failed:`, outcome.error._tag, outcome.error);
                }
                break;
        }
    }
    getTrace(traceId) {
        return this.inMemory.getTrace(traceId);
    }
    getAllTraces() {
        return this.inMemory.getAllTraces();
    }
    clear(traceId) {
        this.inMemory.clear(traceId);
    }
}
exports.ConsoleTraceCollector = ConsoleTraceCollector;
class FileTraceCollector {
    filePath;
    inMemory = new InMemoryTraceCollector();
    constructor(filePath) {
        this.filePath = filePath;
    }
    collect(event) {
        this.inMemory.collect(event);
        const logEntry = {
            timestamp: new Date().toISOString(),
            ...event
        };
        try {
            const fs = require('fs');
            fs.appendFileSync(this.filePath, JSON.stringify(logEntry) + '\n');
        }
        catch (error) {
            console.error('Failed to write trace to file:', error);
        }
    }
    getTrace(traceId) {
        return this.inMemory.getTrace(traceId);
    }
    getAllTraces() {
        return this.inMemory.getAllTraces();
    }
    clear(traceId) {
        this.inMemory.clear(traceId);
    }
}
exports.FileTraceCollector = FileTraceCollector;
function createCompositeTraceCollector(...collectors) {
    return {
        collect(event) {
            collectors.forEach(c => c.collect(event));
        },
        getTrace(traceId) {
            return collectors[0]?.getTrace(traceId) || [];
        },
        getAllTraces() {
            return collectors[0]?.getAllTraces() || new Map();
        },
        clear(traceId) {
            collectors.forEach(c => c.clear(traceId));
        }
    };
}
