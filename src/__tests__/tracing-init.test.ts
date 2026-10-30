import http from 'http';
import type { AddressInfo } from 'net';
import type { TraceEvent } from '../core/types';

type TracingModule = typeof import('../core/tracing');

// Load a fresh copy of the tracing module. Its OpenTelemetry imports start loading on require and
// cannot settle before the current synchronous turn ends, so anything constructed in the same turn
// sees the modules as still loading.
const loadTracing = (): TracingModule => {
  let mod: TracingModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('../core/tracing');
  });
  return mod!;
};

const TRACING_ENV = [
  'TRACE_COLLECTOR_URL',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_BASE_URL',
  'JAF_OTEL_PENDING_MAX',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
];

const runStart = (traceId: string): TraceEvent => ({
  type: 'run_start',
  data: { runId: traceId as any, traceId: traceId as any, context: {} },
});

const llmCallEnd = (traceId: string): TraceEvent => ({
  type: 'llm_call_end',
  data: { choice: { message: { content: 'hi' } }, traceId: traceId as any, runId: traceId as any, model: 'mock' },
});

const runEnd = (traceId: string): TraceEvent => ({
  type: 'run_end',
  data: {
    outcome: { status: 'completed', output: 'done' } as any,
    finalState: {} as any,
    traceId: traceId as any,
    runId: traceId as any,
  },
});

describe('OpenTelemetry collector initialization order', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const loaded: TracingModule[] = [];

  const load = (): TracingModule => {
    const mod = loadTracing();
    loaded.push(mod);
    return mod;
  };

  beforeEach(() => {
    for (const key of TRACING_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const mod of loaded.splice(0)) {
      await mod.ensureOtelReady();
      await mod.shutdownOpenTelemetry();
    }
    // Clear any global tracer provider an SDK registered, so later tests can register their own.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@opentelemetry/api').trace.disable();
    for (const key of TRACING_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    jest.restoreAllMocks();
  });

  it('buffers events collected before the modules load and replays them once ready', async () => {
    const tracing = load();
    const collector = new tracing.OpenTelemetryTraceCollector('init-test');

    collector.collect(runStart('trace-1'));
    collector.collect(llmCallEnd('trace-1'));
    expect((collector as any).tracer).toBeUndefined();
    expect((collector as any).pending).toHaveLength(2);

    expect(await tracing.ensureOtelReady()).toBe(true);

    expect((collector as any).traceSpans.size).toBe(1);
    expect((collector as any).pending.length).toBe(0);
    expect(collector.getTrace('trace-1' as any)).toHaveLength(2);
  });

  it('createCompositeTraceCollector includes the OTEL collector while modules are still loading', async () => {
    process.env.TRACE_COLLECTOR_URL = 'http://127.0.0.1:9/v1/traces';
    const tracing = load();
    const collectSpy = jest.spyOn(tracing.OpenTelemetryTraceCollector.prototype, 'collect');

    const composite = tracing.createCompositeTraceCollector();
    composite.collect(runStart('trace-2'));

    expect(collectSpy).toHaveBeenCalledTimes(1);
    expect(collectSpy.mock.instances[0]).toBeInstanceOf(tracing.OpenTelemetryTraceCollector);

    await tracing.ensureOtelReady();
  });

  it('does not drop an event collected between module readiness and the deferred tracer binding', async () => {
    const tracing = load();
    const ref: { collector?: InstanceType<TracingModule['OpenTelemetryTraceCollector']> } = {};
    // Registered before the collector's own readiness callback, so it runs first.
    const inGap = tracing.ensureOtelReady().then(() => ref.collector!.collect(runStart('trace-gap')));
    const collector = new tracing.OpenTelemetryTraceCollector('gap-test');
    ref.collector = collector;
    collector.collect(runStart('trace-buffered'));

    await inGap;
    await tracing.ensureOtelReady();

    expect([...(collector as any).traceSpans.keys()]).toEqual(['trace-buffered', 'trace-gap']);
    expect((collector as any).pending).toHaveLength(0);
  });

  it('keeps only the newest JAF_OTEL_PENDING_MAX events and warns once', async () => {
    process.env.JAF_OTEL_PENDING_MAX = '3';
    const tracing = load();
    const warn = jest.spyOn(console, 'warn');
    const collector = new tracing.OpenTelemetryTraceCollector('overflow-test');

    const events = [1, 2, 3, 4, 5].map(i => runStart(`trace-o${i}`));
    events.forEach(e => collector.collect(e));

    expect((collector as any).pending).toEqual(events.slice(2));
    const overflowWarnings = warn.mock.calls.filter(args => String(args[0]).includes('Pending trace buffer full'));
    expect(overflowWarnings).toHaveLength(1);

    await tracing.ensureOtelReady();
    expect((collector as any).traceSpans.size).toBe(3);
    expect([...(collector as any).traceSpans.keys()]).toEqual(['trace-o3', 'trace-o4', 'trace-o5']);
  });

  it('shutdownOpenTelemetry resolves when nothing was started', async () => {
    const tracing = load();
    await expect(tracing.shutdownOpenTelemetry()).resolves.toBeUndefined();
    await tracing.ensureOtelReady();
    await expect(tracing.shutdownOpenTelemetry()).resolves.toBeUndefined();
  });

  it('shutdownOpenTelemetry flushes spans of a collector constructed before readiness', async () => {
    const posts: string[] = [];
    const server = http.createServer((req, res) => {
      if (req.method === 'POST') posts.push(req.url ?? '');
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;

    try {
      process.env.TRACE_COLLECTOR_URL = `http://127.0.0.1:${port}/v1/traces`;
      const tracing = load();
      const collector = new tracing.OpenTelemetryTraceCollector('flush-test');

      collector.collect(runStart('trace-3'));
      collector.collect(runEnd('trace-3'));

      expect(await tracing.ensureOtelReady()).toBe(true);
      await expect(tracing.shutdownOpenTelemetry()).resolves.toBeUndefined();
      expect(posts.length).toBeGreaterThanOrEqual(1);
      expect(posts[0]).toBe('/v1/traces');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('a collector constructed after readiness binds the tracer immediately', async () => {
    const tracing = load();
    await tracing.ensureOtelReady();

    const collector = await tracing.createOpenTelemetryTraceCollector('ready-test');
    expect((collector as any).tracer).toBeDefined();

    collector.collect(runStart('trace-4'));
    expect((collector as any).pending).toHaveLength(0);
    expect((collector as any).traceSpans.size).toBe(1);
  });
});
