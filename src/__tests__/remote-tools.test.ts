import http from 'http';
import type { AddressInfo } from 'net';
import {
  RemoteToolsError,
  RemoteToolsOptions,
  discoverRemoteTools,
  fetchRemoteToolCatalog,
  makeRemoteTool,
} from '../providers/remote-tools';
import { discoverRemoteTools as fromRoot } from '../index';

// The run token never enters the tool context; it is read from outside it, e.g. request-scoped storage.
type Ctx = { conversationId: string };

// A loopback URL whose port was just released, so connecting fails with ECONNREFUSED.
const closedPortUrl = async (): Promise<string> => {
  const probe = http.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', () => resolve()));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
};

type RecordedCall = { url: string; headers: http.IncomingHttpHeaders; body: any };

const SERVICE_TOKEN = 'svc-secret-token';
const RUN_TOKEN = 'run-secret-token';

const objectParams = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'search text' },
    limit: { type: 'number' },
  },
  required: ['query'],
};

const catalog = {
  version: 'v1',
  tools: [
    { id: 'shop.search', name: 'search', description: 'Search', parameters: objectParams },
    { id: 'other.search', name: 'search', description: 'Search elsewhere', parameters: objectParams },
    { id: 'shop.buy', name: 'buy', description: 'Buy', parameters: { type: 'object', properties: {} }, needsApproval: true },
  ],
};

describe('remote tools', () => {
  let server: http.Server;
  let baseUrl: string;
  let catalogBody: unknown;
  let catalogStatus: number;
  const calls: RecordedCall[] = [];
  let currentRunToken = RUN_TOKEN;
  const catalogRequests: http.IncomingHttpHeaders[] = [];

  // Response per tool id for POST /tools/:id/call
  const responders: Record<string, (res: http.ServerResponse) => void> = {
    'shop.search': res => json(res, 200, { status: 'success', data: { items: [1, 2] }, metadata: { source: 'vic', executionTimeMs: 7 } }),
    'shop.err': res => json(res, 200, { status: 'error', error: { code: 'OUT_OF_STOCK', message: 'none left', details: { sku: 'x' } } }),
    'shop.plain': res => json(res, 200, { items: [3] }),
    'shop.okstatus': res => json(res, 200, { status: 'ok', data: 1 }),
    'shop.text': res => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('plain text'); },
    'shop.500': res => { res.writeHead(500, { 'content-type': 'text/plain', 'x-echo': RUN_TOKEN }); res.end('internal boom'); },
    'shop.slow': () => { /* never responds */ },
  };

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        if (req.method === 'GET' && req.url === '/tools') {
          catalogRequests.push(req.headers);
          return json(res, catalogStatus, catalogBody);
        }
        const match = /^\/tools\/([^/]+)\/call$/.exec(req.url ?? '');
        if (req.method === 'POST' && match) {
          const id = decodeURIComponent(match[1]);
          calls.push({ url: req.url!, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          const responder = responders[id];
          if (responder) return responder(res);
          return json(res, 404, { error: 'unknown tool' });
        }
        json(res, 404, {});
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tools`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  beforeEach(() => {
    catalogBody = catalog;
    catalogStatus = 200;
    calls.length = 0;
    catalogRequests.length = 0;
    currentRunToken = RUN_TOKEN;
  });

  const opts = (extra: Partial<RemoteToolsOptions<Ctx>> = {}): RemoteToolsOptions<Ctx> => ({
    baseUrl,
    headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    getCallHeaders: () => ({ 'x-run-token': currentRunToken }),
    getCallMeta: ctx => ({ conversationId: ctx.conversationId }),
    ...extra,
  });

  const ctx: Ctx = { conversationId: 'conv-1' };

  const entry = (id: string) => ({ id, name: id.split('.')[1], description: id, parameters: objectParams });

  describe('catalog', () => {
    it('parses the catalog and builds stubs indexed by id and name', async () => {
      const set = await discoverRemoteTools<Ctx>(opts());

      expect(fromRoot).toBe(discoverRemoteTools);
      expect(set.version).toBe('v1');
      expect(set.tools).toHaveLength(3);
      expect([...set.byId.keys()]).toEqual(['shop.search', 'other.search', 'shop.buy']);
      // duplicate names: last entry wins in byName, byId keeps both
      expect(set.byName.get('search')).toBe(set.byId.get('other.search'));
      expect(set.byId.get('shop.search')).not.toBe(set.byId.get('other.search'));
      expect(set.byId.get('shop.buy')!.needsApproval).toBe(true);
      expect(set.byId.get('shop.search')!.needsApproval).toBe(false);
      expect(catalogRequests[0].authorization).toBe(`Bearer ${SERVICE_TOKEN}`);
    });

    it('throws VERSION_MISMATCH when the served version differs', async () => {
      await expect(fetchRemoteToolCatalog(opts({ expectedVersion: 'v2' }))).rejects.toMatchObject({
        name: 'RemoteToolsError',
        code: 'VERSION_MISMATCH',
      });
      await expect(fetchRemoteToolCatalog(opts({ expectedVersion: 'v1' }))).resolves.toMatchObject({ version: 'v1' });
      await expect(fetchRemoteToolCatalog(opts({ baseUrl: `${baseUrl}/` }))).resolves.toMatchObject({ version: 'v1' });
    });

    it('throws HTTP on a non-2xx response, with status and without headers in the message', async () => {
      catalogStatus = 401;
      catalogBody = { error: 'unauthorized' };
      const err: RemoteToolsError = await fetchRemoteToolCatalog(opts()).catch(e => e);
      expect(err).toBeInstanceOf(RemoteToolsError);
      expect(err.code).toBe('HTTP');
      expect(err.httpStatus).toBe(401);
      expect(err.message).not.toContain(SERVICE_TOKEN);
    });

    it('throws HTTP when the service is unreachable', async () => {
      const err: RemoteToolsError = await fetchRemoteToolCatalog(opts({ baseUrl: `${await closedPortUrl()}/tools` })).catch(e => e);
      expect(err.code).toBe('HTTP');
      expect(err.message).toContain('ECONNREFUSED');
    });

    it('does not leak an invalid header value into the error message', async () => {
      const secret = 'Bearer SECRET-SVC\u0000';
      const err: RemoteToolsError = await fetchRemoteToolCatalog(opts({ headers: { authorization: secret } })).catch(e => e);
      expect(err.code).toBe('HTTP');
      expect(err.message).not.toContain('SECRET-SVC');
    });

    it.each([
      ['wrong shape', { version: 'v1', tools: [{ id: 'a' }] }],
      ['duplicate ids', { version: 'v1', tools: [entry('shop.search'), entry('shop.search')] }],
      ['missing version', { tools: [] }],
    ])('throws INVALID_CATALOG for %s', async (_label, body) => {
      catalogBody = body;
      await expect(fetchRemoteToolCatalog(opts())).rejects.toMatchObject({ code: 'INVALID_CATALOG' });
    });

    it('throws INVALID_CATALOG naming the entry when parameters cannot be converted', async () => {
      catalogBody = {
        version: 'v1',
        tools: [{ id: 'bad.tool', name: 'bad', description: 'd', parameters: { type: 'object', properties: { a: { type: 'string' } }, required: true } }],
      };
      const err: RemoteToolsError = await discoverRemoteTools(opts()).catch(e => e);
      expect(err.code).toBe('INVALID_CATALOG');
      expect(err.message).toContain('bad.tool');
    });
  });

  describe('stub schema', () => {
    it('validates arguments with the converted JSON Schema', () => {
      const tool = makeRemoteTool<Ctx>(entry('shop.search'), opts());
      expect(tool.schema.name).toBe('search');
      expect(tool.schema.description).toBe('shop.search');
      expect(tool.schema.parameters.safeParse({ query: 'shoes', limit: 2 }).success).toBe(true);
      expect(tool.schema.parameters.safeParse({ query: 'shoes' }).success).toBe(true);
      expect(tool.schema.parameters.safeParse({ limit: 2 }).success).toBe(false);
      expect(tool.schema.parameters.safeParse({ query: 5 }).success).toBe(false);
    });

    it('wraps non-object parameters in { value }', () => {
      const tool = makeRemoteTool<Ctx>({ id: 's.x', name: 'x', description: 'd', parameters: { type: 'string' } }, opts());
      expect(tool.schema.parameters.safeParse({ value: 'a' }).success).toBe(true);
      expect(tool.schema.parameters.safeParse('a').success).toBe(false);
    });
  });

  describe('execute', () => {
    it('passes a success ToolResult through unchanged and sends per-call headers and call meta', async () => {
      const tool = makeRemoteTool<Ctx>(entry('shop.search'), opts());
      const result = await tool.execute({ query: 'shoes' }, ctx);

      expect(result).toEqual({ status: 'success', data: { items: [1, 2] }, metadata: { source: 'vic', executionTimeMs: 7 } });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('/tools/shop.search/call');
      expect(calls[0].headers['content-type']).toBe('application/json');
      expect(calls[0].headers.authorization).toBe(`Bearer ${SERVICE_TOKEN}`);
      expect(calls[0].headers['x-run-token']).toBe(RUN_TOKEN);
      expect(calls[0].body).toEqual({ args: { query: 'shoes' }, call: { conversationId: 'conv-1' } });
    });

    it('passes an error ToolResult through unchanged', async () => {
      const tool = makeRemoteTool<Ctx>(entry('shop.err'), opts());
      expect(await tool.execute({ query: 'q' }, ctx)).toEqual({
        status: 'error',
        error: { code: 'OUT_OF_STOCK', message: 'none left', details: { sku: 'x' } },
      });
    });

    it('treats a 2xx body whose status is not a ToolResult status as data', async () => {
      expect(await makeRemoteTool<Ctx>(entry('shop.okstatus'), opts()).execute({ query: 'q' }, ctx)).toEqual({
        status: 'success',
        data: { status: 'ok', data: 1 },
      });
    });

    it('wraps a 2xx body without status as success', async () => {
      expect(await makeRemoteTool<Ctx>(entry('shop.plain'), opts()).execute({ query: 'q' }, ctx)).toEqual({
        status: 'success',
        data: { items: [3] },
      });
      expect(await makeRemoteTool<Ctx>(entry('shop.text'), opts()).execute({ query: 'q' }, ctx)).toEqual({
        status: 'success',
        data: 'plain text',
      });
    });

    it('maps HTTP 500 to EXTERNAL_SERVICE_ERROR without leaking headers or the request body', async () => {
      const result: any = await makeRemoteTool<Ctx>(entry('shop.500'), opts()).execute({ query: 'secret-query' }, ctx);

      expect(result.status).toBe('error');
      expect(result.error.code).toBe('EXTERNAL_SERVICE_ERROR');
      expect(result.error.message).toBe('remote tool shop.500 failed: HTTP 500');
      expect(result.error.details).toEqual({ httpStatus: 500, body: 'internal boom' });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(RUN_TOKEN);
      expect(serialized).not.toContain(SERVICE_TOKEN);
      expect(serialized).not.toContain('secret-query');
    });

    it('maps a timeout to TIMEOUT', async () => {
      const result: any = await makeRemoteTool<Ctx>(entry('shop.slow'), opts({ timeoutMs: 100 })).execute({ query: 'q' }, ctx);
      expect(result.status).toBe('error');
      expect(result.error.code).toBe('TIMEOUT');
    });

    it('maps a network error to EXTERNAL_SERVICE_ERROR and never throws', async () => {
      const tool = makeRemoteTool<Ctx>(entry('shop.search'), opts({ baseUrl: `${await closedPortUrl()}/tools` }));
      const result: any = await tool.execute({ query: 'q' }, ctx);
      expect(result.status).toBe('error');
      expect(result.error.code).toBe('EXTERNAL_SERVICE_ERROR');
      expect(result.error.message).toBe('remote tool shop.search failed: TypeError ECONNREFUSED');
    });

    it('does not leak an invalid per-call header value into the tool result', async () => {
      currentRunToken = 'SECRET-RUN-TOKEN\nX';
      const result: any = await makeRemoteTool<Ctx>(entry('shop.search'), opts()).execute({ query: 'q' }, ctx);
      expect(result.status).toBe('error');
      expect(JSON.stringify(result)).not.toContain('SECRET-RUN-TOKEN');
      expect(calls).toHaveLength(0);
    });

    it('returns an error result when building per-call headers fails', async () => {
      const tool = makeRemoteTool<Ctx>(entry('shop.search'), opts({
        getCallHeaders: () => { throw new Error(`boom ${RUN_TOKEN}`); },
      }));
      const result: any = await tool.execute({ query: 'q' }, ctx);
      expect(result.status).toBe('error');
      expect(result.error.code).toBe('EXECUTION_FAILED');
      expect(JSON.stringify(result)).not.toContain(RUN_TOKEN);
      expect(calls).toHaveLength(0);
    });
  });
});
