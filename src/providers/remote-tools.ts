import { z } from 'zod';
import { Tool } from '../core/types.js';
import { ToolErrorCodes, ToolResponse, ToolResult, ToolResultStatus } from '../core/tool-results.js';
import { jsonSchemaToZod } from './schema.js';

/**
 * Remote tools: tool stubs whose execution happens in another service.
 *
 * A remote service publishes a catalog (`GET baseUrl`) and executes calls
 * (`POST baseUrl/:id/call`). The stubs built here validate arguments locally and return the
 * remote `ToolResult` unchanged, so the model sees remote tools exactly like local ones.
 *
 * Error messages and details never include request/response headers or the request body:
 * per-call headers may carry credentials, and these messages can surface in API error bodies.
 */

export type RemoteToolCatalogEntry = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>; // JSON Schema
  readonly needsApproval?: boolean;
};

export type RemoteToolCatalog = { readonly version: string; readonly tools: readonly RemoteToolCatalogEntry[] };

export type RemoteToolsOptions<Ctx> = {
  readonly baseUrl: string; // e.g. http://vic:3002/tools
  readonly headers?: Readonly<Record<string, string>>; // static, e.g. service token
  readonly getCallHeaders?: (context: Readonly<Ctx>) => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;
  readonly getCallMeta?: (context: Readonly<Ctx>) => Readonly<Record<string, unknown>>; // becomes body.call
  readonly timeoutMs?: number; // default 120_000
  readonly fetchImpl?: typeof fetch; // default globalThis.fetch
  readonly expectedVersion?: string; // if set and the served version differs → RemoteToolsError('VERSION_MISMATCH')
};

export type RemoteToolsErrorCode = 'HTTP' | 'VERSION_MISMATCH' | 'INVALID_CATALOG';

export class RemoteToolsError extends Error {
  readonly code: RemoteToolsErrorCode;
  readonly httpStatus?: number;

  constructor(code: RemoteToolsErrorCode, message: string, httpStatus?: number) {
    super(message);
    this.name = 'RemoteToolsError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type RemoteToolSet<Ctx> = {
  readonly version: string;
  readonly tools: readonly Tool<any, Ctx>[];
  readonly byId: ReadonlyMap<string, Tool<any, Ctx>>;
  readonly byName: ReadonlyMap<string, Tool<any, Ctx>>; // last entry wins on duplicate names; byId is authoritative
};

const DEFAULT_TIMEOUT_MS = 120_000;

const catalogEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  parameters: z.record(z.unknown()),
  needsApproval: z.boolean().optional(),
});

const catalogSchema = z
  .object({
    version: z.string().min(1),
    tools: z.array(catalogEntrySchema),
  })
  .superRefine((catalog, ctx) => {
    const seen = new Set<string>();
    catalog.tools.forEach((tool, index) => {
      if (seen.has(tool.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tools', index, 'id'], message: `duplicate tool id '${tool.id}'` });
      }
      seen.add(tool.id);
    });
  });

const trimTrailingSlashes = (url: string): string => url.replace(/\/+$/, '');

// Checked structurally: abort errors are DOMExceptions, which may come from another realm.
const errorName = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;

const errorMessage = (error: unknown): string => {
  const message = typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined;
  return typeof message === 'string' ? message : String(error);
};

const isAbortError = (error: unknown): boolean => {
  const name = errorName(error);
  return name === 'AbortError' || name === 'TimeoutError';
};

// Never the transport error's message: fetch quotes invalid header values verbatim in it.
// The error name and the system error code (e.g. ECONNREFUSED) keep the diagnostic value.
const transportFailure = (error: unknown): string => {
  const name = errorName(error);
  const cause = typeof error === 'object' && error !== null ? (error as { cause?: unknown }).cause : undefined;
  const code = typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return [typeof name === 'string' ? name : 'Error', typeof code === 'string' ? code : undefined]
    .filter(Boolean)
    .join(' ');
};

const TOOL_RESULT_STATUSES: ReadonlySet<string> = new Set<ToolResultStatus>([
  'success',
  'error',
  'validation_error',
  'permission_denied',
  'not_found',
]);

const withTimeout = async <T>(timeoutMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Fetch and validate the remote tool catalog.
 * Throws {@link RemoteToolsError}: `HTTP` (transport failure or non-2xx), `INVALID_CATALOG`
 * (body does not match the catalog shape, or duplicate ids), `VERSION_MISMATCH`.
 */
export async function fetchRemoteToolCatalog(opts: RemoteToolsOptions<any>): Promise<RemoteToolCatalog> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const { status, ok, text } = await withTimeout(timeoutMs, async (signal) => {
    const response = await fetchImpl(trimTrailingSlashes(opts.baseUrl), { method: 'GET', headers: { ...opts.headers }, signal });
    return { status: response.status, ok: response.ok, text: await response.text() };
  }).catch((error: unknown) => {
    const reason = isAbortError(error) ? `timed out after ${timeoutMs}ms` : transportFailure(error);
    throw new RemoteToolsError('HTTP', `remote tool catalog request failed: ${reason}`);
  });

  if (!ok) {
    throw new RemoteToolsError('HTTP', `remote tool catalog request failed: HTTP ${status}`, status);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new RemoteToolsError('INVALID_CATALOG', 'remote tool catalog is not valid JSON');
  }

  const parsed = catalogSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
    throw new RemoteToolsError('INVALID_CATALOG', `invalid remote tool catalog: ${issues}`);
  }

  if (opts.expectedVersion !== undefined && parsed.data.version !== opts.expectedVersion) {
    throw new RemoteToolsError(
      'VERSION_MISMATCH',
      `remote tool catalog version mismatch: expected ${opts.expectedVersion}, got ${parsed.data.version}`
    );
  }

  return parsed.data;
}

const toParametersSchema = (parameters: Readonly<Record<string, unknown>>): z.ZodType<any> => {
  const schema = jsonSchemaToZod(parameters);
  // Same rule as mcpToolToJAFTool. Checked by type name, not instanceof, so a zod instance from
  // another copy of the library is still recognised.
  return (schema as any)._def?.typeName === 'ZodObject'
    ? schema
    : z.object({ value: schema }).describe('Wrapped non-object parameters');
};

const toToolResult = (id: string, httpStatus: number, ok: boolean, text: string): ToolResult => {
  if (!ok) {
    return ToolResponse.error(
      ToolErrorCodes.EXTERNAL_SERVICE_ERROR,
      `remote tool ${id} failed: HTTP ${httpStatus}`,
      { httpStatus, body: text.slice(0, 2000) }
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return ToolResponse.success(text);
  }
  const status = body !== null && typeof body === 'object' ? (body as { status?: unknown }).status : undefined;
  if (typeof status === 'string' && TOOL_RESULT_STATUSES.has(status)) {
    return body as ToolResult;
  }
  return ToolResponse.success(body);
};

/**
 * Build a tool stub for one catalog entry. `execute` posts the validated arguments to
 * `${baseUrl}/${id}/call` and returns the remote `ToolResult` unchanged; it never throws.
 * Throws synchronously if the entry's `parameters` cannot be converted to a zod schema.
 */
export function makeRemoteTool<Ctx>(entry: RemoteToolCatalogEntry, opts: RemoteToolsOptions<Ctx>): Tool<any, Ctx> {
  const url = `${trimTrailingSlashes(opts.baseUrl)}/${encodeURIComponent(entry.id)}/call`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    schema: {
      name: entry.name,
      description: entry.description,
      parameters: toParametersSchema(entry.parameters),
    },
    needsApproval: entry.needsApproval === true,
    execute: async (args, context) => {
      let headers: Record<string, string>;
      let body: string;
      try {
        const callHeaders = (await opts.getCallHeaders?.(context)) ?? {};
        headers = { 'content-type': 'application/json', ...opts.headers, ...callHeaders };
        body = JSON.stringify({ args, call: opts.getCallMeta?.(context) ?? {} });
      } catch {
        return ToolResponse.error(ToolErrorCodes.EXECUTION_FAILED, `remote tool ${entry.id} failed: could not build request`);
      }

      const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
      try {
        return await withTimeout(timeoutMs, async (signal) => {
          const response = await fetchImpl(url, { method: 'POST', headers, body, signal });
          const text = await response.text();
          return toToolResult(entry.id, response.status, response.ok, text);
        });
      } catch (error) {
        if (isAbortError(error)) {
          return ToolResponse.error(ToolErrorCodes.TIMEOUT, `remote tool ${entry.id} timed out after ${timeoutMs}ms`);
        }
        return ToolResponse.error(
          ToolErrorCodes.EXTERNAL_SERVICE_ERROR,
          `remote tool ${entry.id} failed: ${transportFailure(error)}`
        );
      }
    },
  };
}

/**
 * Fetch the catalog and build one stub per entry.
 * Throws {@link RemoteToolsError} as {@link fetchRemoteToolCatalog} does; an entry whose
 * `parameters` cannot be converted yields `INVALID_CATALOG` naming the entry id.
 */
export async function discoverRemoteTools<Ctx>(opts: RemoteToolsOptions<Ctx>): Promise<RemoteToolSet<Ctx>> {
  const catalog = await fetchRemoteToolCatalog(opts);

  const entries = catalog.tools.map((entry) => {
    try {
      return { entry, tool: makeRemoteTool(entry, opts) };
    } catch (error) {
      throw new RemoteToolsError('INVALID_CATALOG', `invalid parameters schema for remote tool ${entry.id}: ${errorMessage(error)}`);
    }
  });

  return {
    version: catalog.version,
    tools: entries.map(e => e.tool),
    byId: new Map(entries.map(e => [e.entry.id, e.tool])),
    byName: new Map(entries.map(e => [e.entry.name, e.tool])),
  };
}
