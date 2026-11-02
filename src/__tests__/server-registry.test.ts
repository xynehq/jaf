import net from 'net';
import { createJAFServer } from '../server/server';
import { AgentRegistry } from '../server/types';
import { Agent, ModelProvider, RunConfig } from '../core/types';

const getFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });

const makeAgent = (name: string): Agent<any, any> => ({
  name,
  instructions: () => `You are ${name}`,
  modelConfig: { name: 'mock-model' },
});

describe('Server agent registry source', () => {
  const agentA = makeAgent('AgentA');
  const agentB = makeAgent('AgentB');

  let current: AgentRegistry<any> = new Map([[agentA.name, agentA]]);
  let sourceCalls = 0;
  const registryFn = async (): Promise<AgentRegistry<any>> => {
    sourceCalls++;
    return current;
  };

  const seenRegistries: Array<RunConfig<any>['agentRegistry']> = [];
  const modelProvider: ModelProvider<any> = {
    async getCompletion(_state, agent, config) {
      seenRegistries.push(config.agentRegistry);
      return { message: { content: `hi from ${agent.name}` } };
    },
  };

  let server: ReturnType<typeof createJAFServer<any>>;

  const chat = (agentName: string, stream = false) =>
    server.app.inject({
      method: 'POST',
      url: '/chat',
      payload: { agentName, stream, messages: [{ role: 'user', content: 'hello' }] },
    });

  beforeAll(async () => {
    server = createJAFServer<any>({
      port: await getFreePort(),
      host: '127.0.0.1',
      cors: false,
      runConfig: {
        agentRegistry: registryFn,
        modelProvider,
        maxTurns: 3,
      },
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    current = new Map([[agentA.name, agentA]]);
    sourceCalls = 0;
    seenRegistries.length = 0;
  });

  it('/agents reflects the registry returned by the latest call, one call per request', async () => {
    const first = await server.app.inject({ method: 'GET', url: '/agents' });
    expect(first.json().data.agents.map((a: any) => a.name)).toEqual(['AgentA']);
    expect(sourceCalls).toBe(1);

    current = new Map([[agentA.name, agentA], [agentB.name, agentB]]);
    const second = await server.app.inject({ method: 'GET', url: '/agents' });
    expect(second.json().data.agents.map((a: any) => a.name)).toEqual(['AgentA', 'AgentB']);
    expect(sourceCalls).toBe(2);
  });

  it('/chat resolves the registry once per request and picks up a new agent without restart', async () => {
    const missing = await chat('AgentB');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe("Agent 'AgentB' not found. Available agents: AgentA");
    expect(sourceCalls).toBe(1);

    current = new Map([[agentA.name, agentA], [agentB.name, agentB]]);
    const found = await chat('AgentB');
    expect(found.statusCode).toBe(200);
    expect(found.json().data.outcome.output).toBe('hi from AgentB');
    expect(sourceCalls).toBe(2);
  });

  it('passes the resolved ReadonlyMap, never the function, to the engine (non-stream and stream)', async () => {
    const snapshot = current;

    await chat('AgentA');
    await chat('AgentA', true);

    expect(sourceCalls).toBe(2);
    expect(seenRegistries).toHaveLength(2);
    for (const reg of seenRegistries) {
      expect(typeof reg).not.toBe('function');
      expect(reg).toBe(snapshot);
      expect(reg.get('AgentA')).toBe(agentA);
    }
  });

  it('keeps a run on its snapshot even if the source changes mid-run', async () => {
    let swapped = false;
    const swappingProvider: ModelProvider<any> = {
      async getCompletion(_state, agent, config) {
        if (!swapped) {
          swapped = true;
          current = new Map([[agentB.name, agentB]]);
        }
        seenRegistries.push(config.agentRegistry);
        return { message: { content: `hi from ${agent.name}` } };
      },
    };
    const swapServer = createJAFServer<any>({
      port: await getFreePort(),
      host: '127.0.0.1',
      cors: false,
      runConfig: { agentRegistry: registryFn, modelProvider: swappingProvider, maxTurns: 3 },
    });
    await swapServer.start();
    try {
      const snapshot = current;
      const res = await swapServer.app.inject({
        method: 'POST',
        url: '/chat',
        payload: { agentName: 'AgentA', messages: [{ role: 'user', content: 'hello' }] },
      });
      expect(res.statusCode).toBe(200);
      expect(seenRegistries[seenRegistries.length - 1]).toBe(snapshot);
    } finally {
      await swapServer.stop();
    }
  });

  it('still accepts a plain Map', async () => {
    const mapServer = createJAFServer<any>({
      port: await getFreePort(),
      host: '127.0.0.1',
      cors: false,
      runConfig: { agentRegistry: new Map([[agentA.name, agentA]]), modelProvider, maxTurns: 3 },
    });
    await mapServer.start();
    try {
      const agents = await mapServer.app.inject({ method: 'GET', url: '/agents' });
      expect(agents.json().data.agents.map((a: any) => a.name)).toEqual(['AgentA']);
      const res = await mapServer.app.inject({
        method: 'POST',
        url: '/chat',
        payload: { agentName: 'AgentA', messages: [{ role: 'user', content: 'hello' }] },
      });
      expect(res.statusCode).toBe(200);
      expect(seenRegistries[0]).toBeInstanceOf(Map);
    } finally {
      await mapServer.stop();
    }
  });
});
