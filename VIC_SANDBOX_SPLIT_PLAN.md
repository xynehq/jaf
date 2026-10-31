# VIC / JAF Sandbox Split: Implementation Plan

```
plan_version: 12
plan_updated: 2026-10-30
copies (must be byte-identical at every commit):
  jaf:              VIC_SANDBOX_SPLIT_PLAN.md   branch feat/vic-sandbox-split   base main          (55edcf5)
  agentic-commerce: VIC_SANDBOX_SPLIT_PLAN.md   branch feat/vic-sandbox-split   base agentic-beta  (ea45e322)
sibling layout: both repos are siblings under the same parent directory (../jaf and ../agentic-commerce)
loop command:  /split-next   (defined identically in .claude/commands/split-next.md in both repos)
implementer:   Opus or Sonnet, one task per loop iteration
reviewer:      Fable 5.1, spawned as a subagent with model "fable" (see section 3.5)
```

Path prefixes used below: `jaf:` is the JAF library repo, `vic:` is the agentic-commerce repo.
Today `vic:JAF/` is the package `jaf-agent-standalone`; after this plan it is the trusted VIC process and
`vic:jaf-runner/` is the sandbox process.

---

## 0. Goal

Split the VIC agent runtime into exactly two services with an HTTP-only boundary:

- **VIC** (trusted zone, `vic:JAF/`): receives `/chat` from the app, authenticates with Ardra, owns the
  conversation transcript, owns every tool implementation, Playwright browsers, merchant MCP clients,
  merchant secrets and the user's card and login data.
- **JAF sandbox** (untrusted zone, `vic:jaf-runner/`): runs the JAF engine, agent prompts and the LLM calls.
  Holds only tool *stubs* discovered from VIC, plus one locally executed Bash tool. Sees only a
  prompt-safe context. Holds no merchant secret, no card data, no Ardra credential.

Surfaces between the two, and nothing else:

| Direction | Surface | Purpose |
|---|---|---|
| VIC → sandbox | `POST /chat`, `GET /health` | run an agent on a full transcript; liveness |
| sandbox → VIC | `GET /tools`, `POST /tools/:id/call` | tool catalog discovery; tool execution |

Non-goals: per-run sandboxes; moving `vic:agentic/` (deterministic automation) anywhere; changing agent
prompts beyond what the tool lookup requires; changing the app-facing `/chat` request or response shape.

### Definition of done

All ledger rows in section 4 are `done`, and the end-to-end smoke in task I5 passes:

1. A non-streaming `/chat` to VIC returns the same JSON shape the app receives today.
2. A streaming `/chat` returns the same SSE events, and VIC stores the transcript from the `run_end` event.
3. A tool-calling turn executes the tool in VIC via `/tools/:id/call` and the model sees the tool result.
4. Adding a tool to VIC and restarting VIC only (not the sandbox) makes the tool available on the next run.
5. The sandbox process has none of the VIC-only secrets in its environment (I4 guard) and the context it
   receives contains none of the omitted fields (V7 test).

---

## 1. Target architecture

```
 app ──/chat──▶ nginx ──▶ VIC gateway (vic:JAF, port 3001)
                            │  auth (Ardra), sanitize, guardrail, discovery merchants
                            │  transcript store (load/append/store)         ──▶ Redis (VIC-owned)
                            │  run-token store                               ──▶ Redis / memory
                            │  POST /chat ─────────────────────────────────▶ sandbox (vic:jaf-runner, port 3001 in its own pod)
                            │  ◀──── JSON or SSE (run_end carries finalState.messages)   │ JAF engine + agents + Bash tool
                            │                                                            │ stubs: POST /tools/:id/call ──┐
                            │  VIC tool server (same process, port 3002, not behind nginx) ◀───────────────────────────┘
                            │     GET /tools (catalog + version)   POST /tools/:id/call (run-token → full context → execute)
                            │     Playwright, MCP clients, Ardra webhooks, dashboard APIs, LiteLLMExtractor, KMS
 vic:agentic (port 3000, /api) unchanged
```

Key properties:

- The sandbox is **stateless**: no memory provider. VIC sends the full transcript (including assistant
  `tool_calls` and `tool` messages) on every `/chat`, and stores what comes back.
- The **per-run token** is minted by VIC per `/chat`, travels to the sandbox in a header, and comes back on every
  tool call. VIC resolves the full (sensitive) context from it. It never enters the LLM-visible `context`.
- The **catalog version** travels on every `/chat` as a header. The sandbox re-fetches `/tools` only when it
  differs, then rebinds a new agent registry. No restart on either side for a tool change; VIC restarts only
  because its code changed (rolling deploy).
- Each run captures **one registry snapshot** for its whole duration (library change J2).

---

## 2. Wire contracts

All headers and schemas below are defined once in `vic:shared/src/contracts.ts` (task V2) and used by both
sides. The JAF library helper (J3) is contract-agnostic apart from the catalog and call shapes.

### 2.1 Headers

| Header | Set by | Read by | Value |
|---|---|---|---|
| `authorization` | VIC gateway → sandbox | sandbox preHandler | `Bearer ${SANDBOX_SERVICE_TOKEN}` |
| `authorization` | sandbox stubs → VIC tools | VIC tool server | `Bearer ${VIC_SERVICE_TOKEN}` |
| `x-run-token` | VIC gateway → sandbox; sandbox stubs → VIC tools | both | opaque, 32 random bytes base64url |
| `x-tool-catalog-version` | VIC gateway → sandbox | sandbox preHandler | `getCatalog().version` |
| `x-request-id`, `external-request-id`, `flow-id`, `business-id`, `user-id` | VIC gateway → sandbox; stubs → VIC tools | logging/context | as today |

### 2.2 VIC gateway → sandbox `POST /chat`

Body is the existing JAF `ChatRequest` with two differences enforced by this plan:

```jsonc
{
  "agentName": "BrowserAgentKorio",
  "stream": true,
  "maxTurns": 100,
  "messages": [ /* FULL transcript: user | assistant(+tool_calls) | tool(tool_call_id) | new user message */ ],
  "context": { /* SandboxContext, see 2.5 */ }
}
```

`conversationId` is always set, both top-level and as `context.conversationId`, each from its pre-split source (the
V15 table) and minted (`conv-<uuid>`) when the app sent none (D6). The runner's `getCallMeta` copies
`context.conversationId` into `call.conversationId`, which the tool server compares with the run record (V4).

Response: unchanged JAF `ChatResponse` (non-stream) or the unchanged JAF SSE event stream (stream). VIC stores
`data.messages` (non-stream) or `run_end.data.finalState.messages` (stream) as the new transcript.

### 2.3 Sandbox → VIC `GET /tools`

```jsonc
// 200, header ETag: "<version>"; 304 on If-None-Match
{
  "version": "3f9c2e1a7b4d5e60",          // sha256 of canonical JSON of tools[], first 16 hex
  "tools": [
    {
      "id": "korioShoppingTools.add_to_cart_korio",   // unique; "<source module basename>.<schema.name>"
      "name": "add_to_cart_korio",                    // LLM-facing name, unchanged from today
      "description": "...",
      "parameters": { "type": "object", "properties": { /* JSON Schema from zodSchemaToJsonSchema */ } },
      "needsApproval": false
    }
  ]
}
```

### 2.4 Sandbox → VIC `POST /tools/:id/call`

```jsonc
// request
{ "args": { /* validated by the stub against parameters, re-validated by VIC */ },
  "call": { "conversationId": "conv-123" } }

// 200 response: a JAF ToolResult, returned to the engine unchanged
{ "status": "success" | "error" | "validation_error" | "permission_denied" | "not_found",
  "data": /* any */, "error": { "code": "...", "message": "...", "details": {} }, "metadata": {} }
```

Status codes: `200` for every tool-level outcome including tool errors (the model must see them as normal tool
results); `401` missing/invalid service token or unknown/expired run token; `403` conversationId mismatch;
`404` unknown tool id; `400` body does not match the request schema.

`metadata.contextPatch` (V16): the run-scoped tool-state keys the tool changed (2.6 `toolState`); the runner applies them
to its request context so the agent's next turn in the same run sees them.

### 2.5 SandboxContext

`SandboxContextSchema = AgentContextSchema.omit({ password, davv, token, cardBin, cardLastFour, expiry,
paymentReference, paymentCurrency, paymentInstrument }).partial({ sessionId: true, conversationId: true, referenceId: true })
.extend({ availableMerchants: z.array(AvailableMerchantSchema).optional(), toolState: ToolStateSchema.optional() })`

`toolState` (V17) is the per-request seed of the run-scoped tool state (2.6): prompt-safe values VIC computes for the agent
before the run, such as Tortli's cart summary. The runner copies it into its request context; V16's `contextPatch` updates
it after tool calls.

Everything a tool needs but a prompt does not stays in VIC and is resolved from the run token.

`sessionId`, `conversationId` and `referenceId` are optional (D6): `AgentContextSchema` declares them required, but the
pre-split server parses `AgentContextSchema.partial()` in `sanitizeAgentContext`, so a request lacking one has always run.
A `/chat` request is never rejected for a missing id (V14). On the wire the gateway still always sends a
`conversationId` (2.2).

### 2.6 Run record (VIC-internal, keyed by run token)

```ts
type RunRecord = {
  conversationId: string; agentName: string; requestId: string;
  context: AgentContext;                 // full, as sanitized by sanitizeAgentContext
  requestContext: RequestContext;        // turing: x-request-id, external-request-id, flow-id, flow-type, path, method, host, business-id, user-id, message-number
  contextValues: { sessionId?: string; authToken?: string; businessId?: string; userId?: string; geniusEnabled?: boolean;
                   availableMerchants?: AvailableMerchant[]; xModule: string; xFeature?: string; isStreaming: boolean };
  toolState?: { merchantId?: string; catalogUrl?: string; merchantName?: string; addressRequired?: boolean; addressSelected?: boolean; // V16: set by tools, persisted per run
               tortliCartSummary?: string };  // V17: seeded by the gateway per request, refreshed by Tortli tools
  createdAt: number; expiresAt: number;  // TTL = RUN_TOKEN_TTL_MS, default 900000
};
```

---

## 3. Working agreements

### 3.1 Branches and commits

- `jaf`: branch `feat/vic-sandbox-split` from `main`. `agentic-commerce`: branch `feat/vic-sandbox-split` from `agentic-beta`.
- One task per commit, message `<TASK-ID>: <summary>`; the ledger update for that task is in the same commit.
- Never push, rebase or force anything from the loop. Never modify untracked files you did not create.
- Do not touch `vic:JAF/*.md` plan files that pre-exist and are untracked (they belong to other work).

### 3.2 Plan sync protocol (the coordination mechanism)

1. The ledger in section 4 is the **only** state. Both copies of this file must be byte-identical at every commit.
2. Every status change is written in the repo where the task lives, then **mirrored** to the sibling repo
   (`cp` then commit `plan: <TASK-ID> <status> (mirror)`), in the same loop iteration.
3. Every iteration starts by asserting `diff VIC_SANDBOX_SPLIT_PLAN.md ../<sibling>/VIC_SANDBOX_SPLIT_PLAN.md`
   is empty. On drift: stop, show the diff, ask a human. Never auto-merge the two copies.
4. Amending a task spec is allowed only before that task is `in_progress`, and must be recorded in section 7
   with `plan_version` bumped.

### 3.3 Task lifecycle

`todo → in_progress → review → done`, or `→ blocked` (with a note saying why and what a human must decide).
A task is **ready** when its repo matches the current repo and every `Depends on` ID is `done`.
Cross-repo dependencies are normal; the loop in one repo waits for the other repo's loop.

### 3.4 Dependency on the library during development

VIC tasks consume library changes before they are published. Task V1 links the library locally
(`"@juspay-jaf/jaf": "link:../../jaf"` from `vic:JAF/package.json`, same from `vic:jaf-runner/package.json`).
Whenever a `J*` task lands, run `pnpm build` in `jaf` before verifying a `V*` task. Task V13 replaces the link
with a git-hosted dependency on a pushed commit of `feat/vic-sandbox-split` (decision D5): pnpm fetches the commit
tarball from codeload.github.com, runs the library's `prepare` build at install time, and pins commit and integrity in
the lockfile. An npm publish (J8) is optional and not on the critical path.

### 3.5 Review protocol (Fable 5.1)

After the task's Verify commands pass, the implementer spawns one reviewer:

```
Agent({
  subagent_type: "general-purpose",
  model: "fable",
  description: "Review <TASK-ID>",
  prompt: <the template below, filled in>
})
```

Template:

```
You are reviewing one task of the VIC/JAF sandbox split. Read the plan file VIC_SANDBOX_SPLIT_PLAN.md,
sections 0, 1, 2 and the spec of task <TASK-ID> in section 5. The repo is <absolute path>, branch
feat/vic-sandbox-split. Review ONLY the diff of the task commit(s): `git diff <base-sha>..HEAD`.

Check, in this order: (1) the acceptance criteria of <TASK-ID> are met, with evidence from the diff and the
tests; (2) nothing outside the task's scope changed; (3) security of the boundary: no VIC-only secret, card
field or Ardra credential can reach the sandbox or a prompt; run tokens never enter `state.context`;
(4) correctness bugs with a concrete failure scenario; (5) JAF conventions: readonly data, pure functions,
effects only in providers/servers.

Report findings as a list: severity (blocking | non-blocking), file:line, what breaks and how to trigger it.
End with exactly one line: VERDICT: APPROVE  or  VERDICT: REQUEST_CHANGES. Do not edit files.
```

Rules: fix every blocking finding and re-run Verify, then re-review. Maximum 3 rounds. After 3 rounds with
`REQUEST_CHANGES`, set the task to `blocked` with the open findings in Notes and stop the loop for a human.
Record `review: <rounds> rounds, <verdict>` and the commit sha in the ledger Notes.

### 3.6 Running the loop

Open a session in the repo whose tasks you want to run (`jaf` for `J*`, `agentic-commerce` for `V*` and `I*`),
pick the implementer model, then start the loop:

```
/model opus            # or sonnet; the reviewer is always spawned as Fable by the command itself
/loop /split-next      # self-paced; one task per iteration; stops itself when nothing is ready
```

The loop touches the sibling repo only through shell commands (`diff`, `cp`, `git -C`, `pnpm build`), never
through file-edit tools, so no extra working directory is required. In the VS Code extension, approve the
permission prompt the first time a command reaches `../<sibling>`. In the CLI you may pass
`claude --add-dir ../<sibling-repo>` to avoid the prompt; `/add-dir` does not exist in the extension.

Start with the `jaf` loop (J1, J2, J4 are independent and unblock everything else), then run the
`agentic-commerce` loop. The loop reports when the next ready task lives in the other repo.

---

## 4. Ledger

Status values: `todo`, `in_progress`, `review`, `done`, `blocked`. Edit only the Status and Notes columns.

| ID | Repo | Phase | Title | Depends on | Status | Notes |
|---|---|---|---|---|---|---|
| J1 | jaf | 1 | `/chat` accepts full transcript with tool traces | – | done | commit `J1:` (git log --grep '^J1:'), review: 1 rounds, APPROVE. Pre-existing failure: adk artifacts PostgreSQL test (ECONNREFUSED, no local DB), fails identically on main. Reviewer notes: /chat callers can replay tool_calls+approvals, so V9 bearer check gates tool execution (document in J5); tool `tool_call_id` still optional, consider requiring it in V2 contracts. |
| J2 | jaf | 1 | Agent registry as a function on `ServerConfig` | – | done | commit `J2:` (git log --grep '^J2:'), review: 1 rounds, APPROVE. Pre-existing failure: adk artifacts PostgreSQL test (ECONNREFUSED), same as J1. Also fixed J1 test to bind a free port (server uses `port || 3000`, so port 0 collided). Startup agents log guarded so a throwing registry fn cannot process.exit. Follow-ups: re-export AgentRegistry/AgentRegistrySource from src/server/index.ts in J5; J3 errors must not embed request headers (registry fn error messages reach /agents and /chat 500 bodies). |
| J4 | jaf | 1 | Export `jsonSchemaToZod` and `zodSchemaToJsonSchema` | – | done | commit `J4:` (git log --grep '^J4:'), review: 1 rounds, APPROVE. Pre-existing failure: adk artifacts PostgreSQL test (ECONNREFUSED). Exports verified from built dist via tsx. For J3: jsonSchemaToZod throws TypeError on malformed schemas (non-array `required` or `enum`), so validate catalog `parameters` or catch per entry. For J5: its Verify `node -e require('./dist/index.js')` fails on main too (type:module + extensionless imports, ERR_MODULE_NOT_FOUND); verify via tsx or fix emit. |
| J6 | jaf | 1 | Tracing: OpenTelemetry collector independent of module load order | – | done | unblocks V1. commit `J6:` (git log --grep '^J6:'), review: 2 rounds, APPROVE. Pre-existing failure: adk artifacts PostgreSQL test (ECONNREFUSED). Beyond spec: collect() binds the tracer lazily (closes a one-microtask drop window at readiness), shutdownOpenTelemetry() logs and resolves on flush errors, JAF_OTEL_PENDING_MAX falls back to 1000 if invalid. Known limits: replayed spans get replay-time start times; call shutdownOpenTelemetry() once at exit (re-setup afterwards is not supported); clear() does not purge the pending buffer. |
| J3 | jaf | 1 | Remote tool helper `discoverRemoteTools` | J4 | done | commit `J3:` (git log --grep '^J3:'), review: 2 rounds, APPROVE (r1 blocking fixed: transport error messages quoted invalid header values, now only error name + cause.code). Pre-existing failure: adk artifacts PostgreSQL test (ECONNREFUSED). Also: only the 5 ToolResultStatus values pass through unchanged; a bad entry schema fails the whole catalog with INVALID_CATALOG naming the id; baseUrl trailing slash trimmed for GET and POST. For V3: tools with z.record / additionalProperties-only params lose all args through jsonSchemaToZod (strips to {}), so give every tool explicit properties or extend the converter; non-object params are sent wrapped as {value}. For V4: every non-success ToolResult must carry `error`; 4xx bodies become model-visible (details.body), so never echo headers or the request body. |
| J7 | jaf | 1 | Build output loadable by plain Node (native ESM) | – | done | decision (b) for J5. commit `J7:` (git log --grep '^J7:'), review: 2 rounds, APPROVE. Pre-existing failure: adk artifacts PostgreSQL test (ECONNREFUSED). check-dist: all 10 exports load via import and require on Node 24; check-pack passes; vic jaf-agent-standalone typecheck passes. Deviations: ts-jest compiles to CommonJS where `import.meta` is TS1343, so `createRequire(import.meta.url)` lives in src/utils/optional-require.ts and the main-module check in src/utils/is-main-script.ts (exact realpath match of argv[1] vs package-relative path; r1 caught a basename-only false positive); jest.config.cjs maps both to jest.esm-shims.cjs. Also converted requires missing from the inventory: adk/sessions (ioredis, pg), safe-math in 3 example files, require.main in adk/examples; ioredis nodenext typing in streaming/providers/redis.ts and test-utils/db-setup.ts. For J5: adk/examples/streaming-example.ts and adk/sessions/examples/session-provider-usage.ts keep a pre-existing `import.meta.url === file://argv[1]` guard (could use isMainScript); dist/test-utils ships as dead code (tsconfig excludes only *.test.ts). |
| J5 | jaf | 5 | Docs, version bump, publish | J1, J2, J3, J4, J6, J7 | done | ready to publish. commit `J5:` (git log --grep '^J5:'), version 0.2.0, review: 1 rounds, APPROVE (doc inaccuracies from the review fixed). Verify passed: build, check-dist (10 exports, import and require), check-pack; tarball = package.json, dist, README.md, LICENSE; tests unchanged (only the local PostgreSQL failure). Human next: `git push -u origin feat/vic-sandbox-split`, then an npm org owner runs the publish procedure in the J5 spec (dist-tag next), then sets `done` with version and dist-tag in both plan copies. Before retagging latest: tsconfig should exclude src/test-utils (dist/test-utils ships as dead code). For V6/V7: replay works because the engine only writes string content today; store only what fullMessageSchema accepts. Plan v6: done criterion changed, the npm publish is now J8 (human-only); V13 consumes the pushed commit from GitHub. The J5 commit 9d3f0d6 must be pushed before V13 starts. |
| J9 | jaf | 5 | Compatibility with VIC's pnpm overrides (fastify 5, cors 11, uuid 11, mathjs 15); exclude test-utils from dist | J5 | done | commit `J9:` (git log --grep '^J9:'), review: 1 rounds, APPROVE. No source change needed. Resolved fastify 5.12.7, @fastify/cors 11.3.1, uuid 11.1.1, mathjs 15.2.0; typecheck, lint, check-dist, check-pack pass; tests unchanged (only the local PostgreSQL failure); dist/test-utils gone. Step 3 ran on the FALLBACK (J9 commit not pushed when verified): pnpm pack tarball installed with pnpm 10.34.9 under vic's exact pnpm.overrides (zod 3.25.76, ai 5.0.222, @opentelemetry/api 1.9.0 too); plain Node createJAFServer: /health 200, /chat 200. Behaviour change (documented in server-api.md): DELETE with Content-Type application/json and empty body now 400 FST_ERR_CTP_EMPTY_JSON_BODY. Follow-ups outside J9: docs/deployment.md still says Fastify 4.x; @types/uuid is redundant; src/test-utils/db-setup.ts has no importers. Push J9 before V13 (V13 step 1 needs the SHA on origin). |
| J10 | jaf | 5 | Lossless schema conversion for the VIC tool catalog (`zodSchemaToJsonSchema` / `jsonSchemaToZod`) | J4 | done | Unblocks V10 (V3 carry-forward, decision D7). DONE: commit `J10:` (git log --grep '^J10:'), review: 2 rounds, APPROVE (r1 blocking: z.coerce.* lost coercion, the stub rejected '2' for 11 catalog fields incl. update_cart_empik.quantity; fixed with a vendor keyword `x-jaf-coerce: true` on coerced string/number/boolean, reversed to z.coerce.*). Pre-existing failure: adk artifacts PostgreSQL test (ECONNREFUSED). Real catalog via the linked dist: 136 tools, version d2b54a6745297fdf, 0 'Unsupported schema type', 11 x-jaf-coerce, 48 default. anyOf (acceptance 4): emitted for ZodUnion/ZodDiscriminatedUnion, ZodTuple items, and ZodNullable over a schema without a single string type; in the catalog 14 anyOf in 12 tools, all from ZodUnion (nullables there become type arrays). Beyond spec: nullable over an enum appends null to enum; exclusive number bounds emit exclusiveMinimum/exclusiveMaximum (reverse gt/lt); ZodNull and type 'null' supported; a recursive z.lazy re-entry converts to {}; UNSUPPORTED_SCHEMA_DESCRIPTION exported from schema.ts (now public API) and used by model.ts. Follow-ups, non-blocking: ZodEffects preprocess converts the output schema (spotlight customizations JSON string is rejected by the stub); OpenAI strict response_format may reject `default`/`x-jaf-coerce`/bounds from output codecs (unverified offline; VIC uses Bedrock), consider stripping in buildResponseFormat; catalog `default` values now cross VIC to sandbox to LLM (none env-derived today), V3 test could assert plain literals; stub z.object strips passthrough keys; heterogeneous nativeEnum keeps only numbers, bigint literal and ZodIntersection unsupported; z.null().nullable() emits type [null,null] (cosmetic). |
| J8 | jaf | 5 | npm publish 0.2.0 by an npm org owner (optional) | J5 | blocked | human-only, nothing depends on it; procedure in the J5 spec; the human sets `done` with version and dist-tag |
| V1 | agentic-commerce | 2 | Dependency: `@xynehq/jaf@0.1.18` → linked `@juspay-jaf/jaf` | J6 | done | commit 67ae193b (code) + this commit (verification), review: 2 rounds, APPROVE (r1 REQUEST_CHANGES: finalState leak fixed in onEvent; OTEL race fixed upstream by J6). Link kept (pnpm ls: single zod 3.25.76). JAF/tsconfig moved to module preserve / moduleResolution bundler (jaf is type:module with extensionless .d.ts re-exports; tsx-only runtime). Step 4: tracer initialized after buffering, one /chat -> one OTLP POST (4286 B) to a 127.0.0.1 recorder; Bedrock call failed on an invalid local AWS token (spans still exported). Carry forward, non-blocking: link bypasses root fastify/@fastify/cors overrides (jaf ships fastify 4.29.1, cors 9.0.1), jaf bump needed before V13; two physical zod copies (no instanceof in J4/V3); Docker image unbuildable until V13; tsc emit now ESM (unused). See V7 Notes for two gateway requirements found in review. |
| V2 | agentic-commerce | 2 | `shared` package: types, context schemas, prompt helpers, contracts, logger | V1 | done | commit f71bf788, review: 2 rounds, APPROVE (r1 blocking: AvailableMerchantSchema.merchantId was nativeEnum, real Ardra ids are any non-empty string; now z.custom<MerchantId> non-empty string). Deviations: kms moves all 4 functions (decryptKms needs decryptKmsWithRegion); findMerchant and DiscoveryMerchantPromptMeta now exported; logger gets a ReturnType<typeof createLogger> annotation (TS4094); AvailableMerchantSchema is new; RunRecordSchema.context is AgentContextSchema.partial() (V7 stores sanitizeAgentContext output), not 2.6's full AgentContext; ToolCatalogSchema has a unique-id .refine (ZodEffects: no .shape/.extend for V3/V4/V9); needsApproval optional in the entry schema (V3 should always emit it). shared is CJS built to dist like turing; root typecheck builds it (stale shared/dist runs stale code under tsx). JAF/src/types.ts shim now has import side effects (logger, kms client). Sandbox env needs DEFAULT_ADDRESS if prompts use withDefaultAddress (I4/V9). Lockfile: transitive @types/node re-resolved to 24.19.2 (dedupe side effect). V12 should drop the shims. |
| V3 | agentic-commerce | 2 | Tool registry and catalog | V2, J4 | done | commit `V3:` (git log --grep '^V3:'), review: 1 round, APPROVE. 136 entries from 37 modules, version 86521328b53ae93e, 0 needsApproval. tools/tools.ts excluded (barrel re-exporting wildHoney tool objects; including it duplicates them and adds 3 colliding names); a test enforces registered iff a module exports a tool. dump-catalog.ts takes an optional outFile (tool modules log to stdout while loading). Verify glob must be quoted from the repo root under zsh. CARRY-FORWARD, blocks V10/I5 (human/plan decision): jaf zodSchemaToJsonSchema emits 'Unsupported schema type' string placeholders for 61 fields in 39 tools (ZodDefault, ZodEffects, ZodNullable, ZodNativeEnum, ZodUnion, ZodLiteral, ZodAny, ZodPipeline); VIC's bedrock converter today yields 30. Behind J3 stubs: empikShoppingTools.update_cart_empik.items (required, ZodEffects over array) rejects every call; numeric quantity/limit fields with .default() are rejected. Needs a new J task extending zodSchemaToJsonSchema and jsonSchemaToZod symmetrically, plus a zero-placeholder test over the real catalog, before V10. Non-blocking: getCatalog() returns a shared mutable object (consider freezing); unquoted ** in the test script only matches one directory level under sh. Pre-existing, for V4/I4: deliverooShoppingTools.login_user takes password as an LLM argument, so it transits the sandbox and /tools/:id/call args. jaf dist at verification time included J7 work in progress. |
| V5 | agentic-commerce | 2 | Run-token store | V2 | done | commit `V5:` (git log --grep '^V5:'), review: 1 round, APPROVE. ioredis ^5.11.1. Beyond spec: SET ... PX ttl NX with 3 token retries, positive-integer ttl guard, frozen records, Redis reads validated with RunRecordSchema (invalid -> null), lazyConnect, injectable RunStoreRedisClient. Redis path tested only against an in-test fake (no Redis/Docker on the dev machine). Non-blocking: no 'error' listener on the ioredis client (reconnect errors go to console.error; a dead Redis stalls create/get ~10 s before rejecting); RunStore has no close(); freeze is shallow and in-memory get returns the shared object; Redis path also checks expiresAt against the reading pod's clock (fail-closed); no token format pre-check. |
| V6 | agentic-commerce | 2 | Transcript store | V2 | done | commit `V6:` (git log --grep '^V6:'), review: 1 round, APPROVE. LRU over reads and writes via Map order (matches jaf lastActivity eviction); Redis SET EX, TTL refreshed on set only; reads shape-checked (invalid -> [] with an ERROR log naming only the id); env limits fail fast. No per-conversation message cap in the store (provider's cap only applied in appendMessages, which the engine never calls; today's real bound is memory.maxMessages 50 at load). Redis path tested only with a fake. Non-blocking: in-memory freeze is shallow (nested tool_calls/content/attachments mutable; Redis clones per read); read schema looser than jaf fullMessageSchema and set does not validate; undefined keys survive in-memory but not JSON; concurrent turns on one conversation are last-write-wins. Only the snapshot comment was corrected after review. |
| V4 | agentic-commerce | 3 | Tool server routes | V3, V5 | done | commit `V4:` (git log --grep '^V4:'), review: 1 round, APPROVE. fastify ^5.12.7 added as a direct JAF dependency. createToolServer also takes host/serviceToken/toolTimeoutMs/tools (injectable lookup for tests, defaults to the V3 registry); throws without VIC_SERVICE_TOKEN. Per call: copies of requestContext/contextValues into the ALS store, structuredClone(record.context); on timeout the tool keeps running in the background (no AbortSignal in JAF tools). Non-blocking: TOOL_CALL log lines are emitted outside withContext (request ids NULL in logs); setContextValue copy is shallow (availableMerchants array shared, no tool mutates it); If-None-Match is an exact compare (the J3 stub never sends it). |
| V7 | agentic-commerce | 3 | Gateway `/chat` | V3, V5, V6, J1 | done | From V1 review r2: (1) the app-facing SSE run_end now carries data.finalState (full context incl. card/password and the transcript): the gateway must strip finalState before forwarding to the app while storing finalState.messages; (2) after J1, client-supplied assistant tool_calls / tool messages plus approvals make the engine execute tools before any model call: the gateway must accept from the app only the new user message (and approvals checked against VIC-owned pending interruptions), never app-supplied tool or tool_calls messages. (3) from V2: toSandboxContext throws a ZodError when sessionId, conversationId or referenceId is missing (2.5 keeps them required; today such requests run): catch it and answer 400, not 500. (4) from V5: map run-store errors to 503 (not 500); populate only the 2.6 contextValues keys (Redis strips unknown keys, in-memory keeps them). (5) from V6: bound replayed history at a user-message boundary (whole turns, default ~50 messages like today's memory.maxMessages) so tool_calls stay paired; validate data.messages per role against jaf fullMessageSchema before transcriptStore.set (a bad stored transcript would 400 every later turn); consider per-conversation serialization (last write wins); keep conversationId bound to the authenticated session (no tenant scoping in the store). (6) from V4: populate requestContext.host, x-request-id and external-request-id in the run record as createJAFRequestContext does today (isInternalCall and other tools read getContextValue('host')); delete the run token when /chat ends (as specified). DONE: commit `V7:` (git log --grep '^V7:'), review: 1 round (resumed once after a reviewer rate limit), APPROVE. Notes (1)-(6) implemented. D2: ardraUtils reads GATEWAY_INTERNAL_HOST per call (default unchanged). Parity kept: onSend headers and SYSTEM message on every JSON /chat reply incl. rejections; streams carry only the four upstream SSE headers. Mirror of jaf fullMessageSchema is local (not exported by jaf). Follow-ups, non-blocking: transcript-store failure after a successful non-stream run returns 503 (the turn's tools already ran; log and return 200 instead); transcript stored for every 200 incl. error/max_turns (today only 'completed'); sandbox 401/403 forwarded verbatim (map to 503); mid-stream failure ends without stream_end; boundHistory returns [] when the tail has no user message; Fastify JSON body-schema validation not reproduced (bad bodies cost an Ardra auth call and get 400 'Invalid request'); SANDBOX_CONTEXT_INVALID log lacks agent/conversation ids. |
| V8 | agentic-commerce | 3 | VIC bootstrap: replace `JAF/src/server.ts` | V4, V7 | done | From V5: add an ioredis 'error' listener that logs only e.message via jafLog, consider tighter maxRetriesPerRequest/connectTimeout for the gateway budget, and close the run store (sweep timer, Redis quit) on shutdown (RunStore has no close() yet). Same for the transcript store (V6): error listener, close/quit on shutdown. From V4: add app.setErrorHandler on the tool server with a generic body (503 for run-store failures, 500 otherwise) and log e.message via jafLog; today Fastify's default 500 echoes e.g. 'connect ECONNREFUSED <redis host:port>' and the J3 stub forwards that body to the model; also covers non-serialisable tool results. Body parsing runs before the token check (unauthenticated 400/413/415/414); add a preParsing auth hook if wanted. DONE: commit `V8:` (git log --grep '^V8:'), review: 1 round, APPROVE. Gateway app keeps the pre-split Fastify settings (logger, 50 MB bodyLimit, @fastify/cors ^11.3.1 with the same options). Notes applied: gateway/redis.ts connectRedis (error listener logs message only, maxRetriesPerRequest 2, connectTimeout 2000), close() on both stores, tool-server setErrorHandler with generic bodies and 503 on run-store failure. Not done: optional tool-server preParsing auth hook. Non-blocking: the withContext listener wrapper is installed after listen (same as before; chat.ts falls back to its own context); Fastify-generated replies and /health lack the old onSend cache headers; uncaughtException/unhandledRejection still exit 0 (parity). |
| V14 | agentic-commerce | 3 | Gateway parity for a context missing sessionId, conversationId or referenceId (D6) | V7 | done | Replaces the 400 that V7 note (3) introduced; today such requests run (D6). From V9 review: jaf-runner/src/app.test.ts asserts a context of only {sessionId} -> 400 (update with D6); the runner's getCallMeta sends conversationId undefined for an id-less context, which VIC's ToolCallRequestSchema (call.conversationId min 1) rejects, so every tool call of such a run would fail. DONE: commit `V14:` (git log --grep '^V14:'), review: 1 round, APPROVE. Parity confirmed against jaf 0.1.18 (it minted conv-<uuid> the same way). The runner test in jaf-runner/src/app.test.ts now asserts a wrongly typed conversationId -> 400 (V9 Note). Non-blocking: a body with only a top-level conversationId (no context.conversationId) now runs under a minted id with no transcript and no SYSTEM (spec step 2/3), while admit's rejections still send SYSTEM under the top-level id (pre-split onSend fallback); confirm the app always sets context.conversationId. No test shows the data.conversationId the app gets back for an id-less run (fake sandbox hard-codes it). |
| V15 | agentic-commerce | 3 | Gateway: conversationId source parity (history keyed by the top-level id as JAF's memory was) | V14 | done | From V14 review (non-blocking): a body with only a top-level conversationId ran under a minted id with no history. DONE: commit `V15:` (git log --grep '^V15:'), review: 1 round, APPROVE. resolveConversationIds in chat.ts implements the table; both ids count only as non-empty strings (spec applies that to the top-level id only; with context.conversationId '' the spec letter would 400 every tool call). The V14 'no conversationId' test's input lost its top-level id (it is now case (d); assertions unchanged). For the human: (1) spec inaccuracy: a STREAMED run with only a top-level id now sends a SYSTEM message under it; pre-split streams sent SYSTEM only from onEvent with the context id (onSend never fired for streams), so either accept the unification or split the SYSTEM source for streams; (2) SECURITY, parity by design (D6/v8): the transcript key is the client-chosen top-level conversationId, never authenticated; any session can replay and overwrite another conversation's history by sending its id; worse than pre-split because the store is shared Redis across pods; cheap fix: scope the key by authData.userId/businessId or require top-level == context when both are set. Nits: mint() also runs in case (a); helper return type not readonly; the fake sandbox hard-codes conv-1 so the echoed data.conversationId is not asserted. |
| V16 | agentic-commerce | 4 | Run-scoped tool state for Shopify MCP (D8) | V4, V5, V9 | done | From the V10 block: the Shopify agent and its VIC tools share per-run state through the request context. DONE: commit `V16:` (git log --grep '^V16:'), review: 2 rounds, APPROVE (round 2 confirmed two fixes made on the reviewer's advice: Redis patchToolState uses SET ... KEEPTTL XX so a key that expired after the GET is never recreated without a TTL; in-memory patchToolState reads and writes synchronously so parallel tool calls of one message do not lose a patch). The V5 FakeRedis fixture gained the KEEPTTL XX overload; V5 test cases unchanged. Timeout path collects no state (the tool may still run). Non-blocking: Redis patch is still read-modify-write (documented); resolveShopifyState looks merchants up by id only (the agent also filtered agentName); the Shopify test file sits under src/tools so the V3 registry test imports it too (runs twice). For the plan owner: after an in-run same-agent switch, the tools follow the switch (toolState first, spec step 4) while the agent's prompt stays ctx.merchantId-first; before the split both reverted to the app's merchant at the next model call. |
| V17 | agentic-commerce | 4 | Prompt dependencies on VIC: Tortli cart summary and IdoSell shop URL (D11) | V16 | done | From the V10 block (second). DONE: commit `V17:` (git log --grep '^V17:'), review: 1 round, APPROVE. Deviations (reviewer agreed): ToolStateSchema/TOOL_STATE_KEYS live in a new leaf shared/src/toolState.ts re-exported by contracts.ts (the spec's layout is a CommonJS circular import; the reviewer reproduced RunRecordSchema failing with AvailableMerchantSchema undefined); updateTortliSession's setContextValue is guarded by hasContext(); the runner parses toolState strictly (acceptance (c)) and removes it from state.context after copying it into the request context (25 agents print state.context, so leaving it would change prompt text). Step 8 (runner .env.example) deferred to I4. Non-blocking: a Tortli tool exceeding VIC_TOOL_TIMEOUT_MS leaves a stale cart summary for the rest of that run (V16 timeout gap); a malformed IDOSELL_MCP_ENDPOINT now fails at vic-shared import in both processes; plan 2.5 still says the runner copies toolState but not that it leaves state.context; the real seedToolState is not unit-tested. One unexplained runner test failure (7.8 s, once in 17 runs): likely a stalled event loop tripping the stub's 5 s test timeout, not a V17 regression. |
| V9 | agentic-commerce | 4 | `jaf-runner` package scaffold | V2, J2, J3 | done | From V4: the J3 stub's default timeoutMs (120 s) is below VIC_TOOL_TIMEOUT_MS (180 s); set the stub timeout above VIC's, or the stub gives up while VIC still runs the tool. DONE: commit `V9:` (git log --grep '^V9:'), review: 2 rounds, APPROVE (r1 blocking: POST /chat?x=1 skipped the SandboxContext check; fixed by matching on the path; r1 non-blocking fixed: engine gets parsed.data so nested unknown keys are dropped, tests use a free port because jaf maps port 0 to 3000, engines.node >=22.12.0). Choices: RUNNER_PORT optional (default 3001); BEDROCK_MODEL default kept from pre-split; bedrock-provider COPIED (tortliAgent still imports the VIC copy) with the tunnel proxy path removed; availableMerchants also put in the turing context so withAddressGuard works; Langfuse creds passed explicitly ('' when missing); withContext wrapper installed before listen; plain `node dist/server.js` verified. Non-blocking, deferred: bearer check runs after body parsing (parity); the catalog GET shares the 190 s stub timeout (a hanging VIC /tools stalls /chat); /agents/:name/chat is dead in the runner (jaf inject forwards no headers). |
| V10 | agentic-commerce | 4 | Migrate agents and prompts to the runner | V9, V3, J10, V16, V17 | done | From V3: do not start until jaf zodSchemaToJsonSchema/jsonSchemaToZod are lossless for the catalog (see V3 Notes); needs a new J task (human/plan decision). D6: the SandboxContext ids are optional; prompts and agents must tolerate an undefined conversationId/referenceId exactly as today's `Partial<AgentContext>` callers do. From V9: build each agent's tools inside buildAgents(set) with pickTools(set, ids), never catalog.pick at run time (keeps the J2 per-run snapshot). From V14 review: consider requiring conversationId at the runner boundary (2.2 says the gateway always sends one); a context without it makes every tool call 400 at VIC. BLOCKED (loop, 2026-10-31, before implementation): needs the human/plan decision from V3: add a jaf task that makes zodSchemaToJsonSchema/jsonSchemaToZod lossless for the VIC catalog (ZodDefault, ZodEffects, ZodNullable, ZodNativeEnum, ZodUnion, ZodLiteral, ZodAny, ZodPipeline; zero 'Unsupported schema type' placeholders over the real catalog), make V10 depend on it, and set V10 back to todo. Alternative: accept the lossy stubs and set V10 todo (update_cart_empik and numeric quantity fields would fail validation in the sandbox). V11 and I2 are ready meanwhile. UNBLOCKED by plan v8 (2026-10-31, D7): option (a) taken, J10 added and V10 depends on it; acceptance gains the zero-placeholder check over the real catalog. Optional, not required: once J10 is built, `jaf-runner/src/providers/bedrock-provider.ts` may build its Bedrock tool specs with jaf's `zodSchemaToJsonSchema` (the model then sees 30 fewer placeholders than today); if done, record it in Notes. BLOCKED (loop, 2026-10-31, before implementation; jaf rebuilt with J10): the spec does not cover a per-run state channel between the Shopify MCP agent and its VIC tools. Survey of everything moving: agents import only pure helpers from VIC (constructSwitchMerchantInfo, buildDiscoveryMerchantPromptMeta, hasDeliveryAddress, getDefaultAddress, all in vic-shared) and read turing context keys availableMerchants (step 2 covers it), addressSelected and merchantId. The channel: (1) agents/shopifyMCPAgent.ts instructions() derives merchantId, catalogUrl (websiteUrl), addressRequired, addressSelected from context.merchantId + availableMerchants + address and setContextValue()s them; tools/shopifyMCPShoppingTools.ts (VIC) reads catalogUrl, merchantId, addressRequired, addressSelected via getContextValue; (2) its switch-merchant tool setContextValue()s merchantId, catalogUrl, merchantName, addressRequired, addressSelected, which the agent's next turn and later tool calls of the same run read. Today one request ALS carries both directions. After the split the agent writes into the sandbox ALS and every VIC tool call gets a fresh copy of the run record's contextValues (V4), so Shopify MCP search gets catalogUrl undefined and an in-run merchant switch is lost. Other agents: addressSelected is only ever set by Shopify code, so their getContextValue('addressSelected') ?? <address check> fallback behaves the same in the sandbox; flowInfoTool sets and restores xModule within one call (unaffected). Human decision needed: (a) VIC-side: shopifyMCPShoppingTools derives the four values itself from the tool context (record.context.merchantId, contextValues.availableMerchants, address), and the tool server persists an allow-list of keys a tool sets (merchantId, catalogUrl, merchantName, addressRequired, addressSelected) back into the run record so later calls of the same run see them; the agent's next-turn view of a switch needs the switch result in the tool output or a context patch (new task, touches V4/V5 files); (b) accept the regression for ShoppifyAgentMCP until a follow-up (it is in today's registry); (c) another design. Set V10 back to todo (with the chosen approach in its spec or a new task it depends on). I1, I2, I4 are ready meanwhile. UNBLOCKED by plan v9 (2026-10-31, D8): option (a) as task V16, V10 depends on it. D9: the GENIUS agents (AnalyticsOrchestratorAgent and its agentAsTool sub-agents) move with the rest but are not expected to work in the sandbox until section 8.1 is done. From V16 review (plan-owner question, not a blocker): shopifyMCPAgent.ts instructions() reads ctx.merchantId before getContextValue('merchantId'), so after an in-run switch the prompt names the app's merchant while VIC's tools use the switched one; keeping the agent unchanged follows step 6; making it read the context first would align prompt and tools. buildAgents must use pickTools (the contextPatch is applied only there). BLOCKED again (loop, 2026-10-31, before implementation; full import survey of everything that moves): two more cross-boundary dependencies the spec does not cover. (1) agents/tortliAgent.ts instructions() calls describeTortliCartForPrompt(state.context.sessionId) from tools/tortliShoppingTools.ts (line ~270), which reads tortliSessionStore, an in-memory store in VIC filled by the Tortli tools (cart lines, totals, phase, order label); every turn's prompt carries the live cart. In the sandbox that store does not exist, so the prompt would always say the cart is empty while VIC's tools hold the real cart. Needs a decision like D8: e.g. VIC computes the cart description (run record or a tool result field the runner puts into its context, as V16's contextPatch), or the gateway adds a prompt-safe cart summary to the sandbox context per request; or accept the regression. (2) agents/idosellAgent.ts imports IDOSELL_SHOP_URL from tools/idosellShoppingTools.ts = new URL(process.env.IDOSELL_ENDPOINT).origin (a VIC env var, not a secret): put IDOSELL_ENDPOINT (or the origin) into the runner env (I4), take it from availableMerchants' websiteUrl, or another source. Handled mechanically once unblocked (no decision needed): prompts/flowInfoPrompt.ts imports the pure RuleType enum from VIC's services/ai/utils/schemaConverter (that module also loads VIC's logger) -> copy the enum verbatim next to the prompt in the runner; data/deliverooData.ts and data/brickdepotCountyCityMappings.json are imported by VIC tools (deliverooShoppingTools, brickdepotCheckoutTool) and by no moving file, so they stay in VIC and only data/jusbizDoc.ts moves. Everything else maps cleanly: 136 tool exports and the tools.ts arrays map to catalog ids by object identity (0 unmapped), agents' other imports are vic-shared helpers. Set V10 back to todo with the chosen approach (or a new task it depends on). I1, I2, I4 are ready meanwhile. UNBLOCKED by plan v11 (2026-10-31, D11): V17 covers both (Tortli: VIC computes the cart summary, seeded per request and refreshed through V16's contextPatch; IdoSell: constants move to vic-shared, `IDOSELL_MCP_ENDPOINT` joins the runner env). The mechanical items are now V10 step 8. From V17 review (prompt parity, recommended): pre-split availableMerchants lived only in the turing context; in the sandbox state.context.availableMerchants is present whenever multiRegionSupportEnabled is true, so agents printing state.context get the merchant list in <session_context>. Strip it from the engine context in jaf-runner/src/app.ts as V17 does for toolState (withAddressGuard and the agents read it via getContextValue). DONE: commit `V10:` (git log --grep '^V10:'), review: 1 round, APPROVE. Catalog dump after the J10 build: 0 'Unsupported schema type' (61 fields changed vs the V3 dump), version d2b54a6745297fdf, 136 tools. Parity evidence: old VIC factories vs new buildAgents over real makeRemoteTool stubs: 23/23 agents, same names/order, identical tool name+description lists (128 tools); prompts byte-identical in all 41 moved files apart from the step-6 line and the Tortli wrapper move; runner booted against real VIC /tools lists the same 23 agents. Codemod: tool imports replaced by same-name bindings from pick(ids) at the top of each factory; factories take pick. Deviations (reviewer agreed): JAF/src/agents.ts -> jaf-runner/src/agentFactories.ts (agents.ts is the registry); step 2 not applied, agents keep getContextValue('availableMerchants') and the runner strips availableMerchants from state.context (pre-split it lived only in the request context; 25 agents print state.context). Follow-ups, non-blocking: (1) PLAN OWNER: axsAgent.ts paymentInstrumentPresent is now always false because paymentInstrument is omitted from SandboxContext (2.5); the prompt already says to call the payment tool on a payment turn regardless; parity would need a VIC-seeded boolean (V17 pattern); (2) allAnalyticsOrchestratorSubAgents factories each bind all 7 module ids (trim per factory with 8.1); (3) agentFactories.ts is unused in the runner (delete in V12); (4) V14's 'require conversationId at the runner boundary' still open. |
| V11 | agentic-commerce | 4 | Bash tool in the runner | V9 | done | attach to agents: human decision, see D3 DONE: commit `V11:` (git log --grep '^V11:'), review: 2 rounds, APPROVE (r1 blocking: a setsid'd process holding the pipes defeated the timeout, demonstrated hang; fixed by destroying the pipes after the group kill; also fixed: group killed on close so background processes do not outlive the call, sweeper re-checks in-use before rm, byte cap backs off to a UTF-8 boundary). createBashTool is a factory, nothing at import, attached to no agent (D3). PRECONDITION FOR ATTACHING THE TOOL (D3, human): commands run as the runner uid in its PID namespace, so they can read /proc/1/environ (RUNNER_/VIC_SERVICE_TOKEN, AWS creds, Langfuse key), the runner's files (writable unless readOnlyRootFilesystem), every other conversation's workspace, possibly run tokens via /proc/<pid>/mem, and setsid-escaped processes outlive the call; needs an executor without secrets (sidecar sharing /workspace) or a per-call uid plus a PID namespace, and tini/shareProcessNamespace for zombies. Non-blocking: a chunk ending exactly at 32 KiB can still end in a broken UTF-8 byte (StringDecoder would fix); the setsid test probes python3 on the test PATH, not the tool's. |
| V12 | agentic-commerce | 5 | Clean `vic:JAF/` of runtime code | V8, V10 | done | From V9: delete JAF/src/providers/bedrock-provider.ts (the runner has its own copy) once tortliAgent has moved. From V10: also delete jaf-runner/src/agentFactories.ts (unused; createShoppingAgent duplicates agents/wildhoneyAgent.ts) and update the stale comment in JAF/src/tools-server/registry.ts:42; VIC's data/deliverooData.ts and data/brickdepotCountyCityMappings.json stay (VIC tools use them). DONE: commit `V12:` (git log --grep '^V12:'), review: 2 rounds, APPROVE (round 2 confirmed two cleanups the reviewer recommended: JAF/src/tools/tools.ts deleted (dead agent tool arrays since V10) and the two deps only the deleted provider used). Deleted: JAF/src/providers/bedrock-provider.ts, JAF/src/tools/tools.ts, jaf-runner/src/agentFactories.ts; agents/prompts/agentsAsTools already moved in V10. Kept: data/deliverooData.ts and data/brickdepotCountyCityMappings.json (VIC tools use them, so the spec's 'delete data/' does not apply), and the shims still imported (types 49, loggerConfig 61, kmsDecryption 3); ardraUtils re-exports trimmed to getDefaultAddress/withDefaultAddress, discoveryMerchantService no longer re-exports buildDiscoveryMerchantPromptMeta. JAF/package.json renamed to @agentic-commerce/vic; @aws-sdk/client-bedrock-runtime, @aws-sdk/credential-providers, @smithy/node-http-handler removed; root scripts renamed (Dockerfile, Makefile, Jenkinsfile never used the old name). VIC imports from jaf exactly ToolResponse, ToolErrorCodes, ToolResult, Tool, Message, zodSchemaToJsonSchema (both quote styles; the spec's single-quote grep misses 29 of 48 statements). Lockfile regenerated byte-identical by the reviewer. Non-blocking: tools/tarteShoppingTools.ts is a pre-existing fully commented-out file; registry.test.ts still names the removed tools.ts barrel (no-op skip). |
| V13 | agentic-commerce | 5 | Switch to the library's GitHub commit (git-hosted dependency) | J5, J9, V10, V11 | done | From V12 (plan owner): the package is now @agentic-commerce/vic, so step 4's `pnpm ls zod fastify --depth 10 --filter jaf-agent-standalone` matches no project and would verify nothing; use --filter @agentic-commerce/vic. DONE: commit `V13:` (git log --grep '^V13:'), review: 1 round, APPROVE. Pinned @juspay-jaf/jaf to github:xynehq/jaf#e0f9ce2ff696cb9b68e6df70928c7ab8cc72d35d (the J10 commit, NOT J9 as the spec says: the spec predates J10 and V10 depends on J10's lossless converters; J10 contains J9 and only the plan changed after it on origin) in JAF, jaf-runner AND shared (shared also had link:, step 5). onlyBuiltDependencies: the exact codeload URL. Effects: one physical zod 3.25.76 everywhere and jaf now gets fastify 5.12.7 / @fastify/cors 11.3.1 via the root overrides (the V1 notes on two zod copies and fastify 4 no longer hold). LOCKFILE HAND EDIT: jaf depends on xlsx ^0.18.5 and VIC's SecOps override maps xlsx to https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz; pnpm 10.34.9 records that tarball without integrity, so --frozen-lockfile failed; added integrity sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA== (reviewer recomputed). It survives SHA bumps; if the lockfile is regenerated from scratch or the URL changes, re-add it: curl the tarball, `openssl dgst -sha512 -binary <tgz> | base64`, prefix sha512-. jaf's document-processor uses XLSX.read and sheet_to_csv, both in 0.20.3. Evidence: fresh index copy + EMPTY store `pnpm install --frozen-lockfile` downloaded 604 packages, exit 0; plain-Node import from JAF and jaf-runner prints 186; typecheck 0; VIC 91/91, runner 28/28; gateway+runner boot: non-stream /chat 200 success, stream run_start..run_end..stream_end; the model call failed only on invalid local AWS credentials. Non-blocking: codeload archive checksums are not guaranteed stable by GitHub (fails closed; re-pin or J8); jaf's prepare installs jaf's whole workspace incl. examples/* (jaf-repo follow-up). |
| I1 | agentic-commerce | 6 | Dockerfile: `vic` and `sandbox` targets | V8, V9 | done | From V2: the vic image must build shared (pnpm --filter @agentic-commerce/vic-shared run build) and copy shared/dist + shared/node_modules, since JAF resolves it via dist; keep pnpm symlinks so turing stays a single instance (findMerchant reads turing ALS through shared). From V9: the sandbox image gets jaf's own deps transitively, including tunnel (jaf core/tracing.ts, providers/model.ts) and @modelcontextprotocol/sdk, although jaf-runner lists neither; tsx is a runtime dependency per spec (prune if wanted). Runner starts with plain `node dist/server.js` (Node >=22.12). From V11: node runs as PID 1 in the sandbox image, so processes started by the Bash tool that are reparented are never reaped; use tini (or docker --init); /workspace must be a writable volume. From V13: the builder needs HTTPS to codeload.github.com, cdn.sheetjs.com (xlsx override, now actually fetched) and the npm registry; never run the install with --ignore-scripts (it skips jaf's prepare, leaving no dist); the frozen install must see shared/ and jaf-runner/ package.json (and pnpm-workspace.yaml with its onlyBuiltDependencies entry). I1 done: commit I1: Dockerfile vic and sandbox targets (git log --grep '^I1:'); review: 1 round, APPROVE. Built and checked with podman 5.6.2 (docker is not installed here): both targets build; sandbox has no playwright/chromium/npm/npx/corepack, uid 1001, tini PID 1, /health 200, /workspace writable; vic gateway /health 200, tool server on 3002. Stage `runtime` renamed `vic` and still the last (default) stage, so `make build` is unchanged. Open, non-blocking: vic installs are unfiltered so the vic store also carries runner-only aws-sdk bedrock packages (could add --filter '!@agentic-commerce/jaf-runner'); typescript stays orphaned in the sandbox .pnpm store (size only); HEALTHCHECK is ignored by OCI/k8s, so I3 needs probes on :3001/health; start.sh still names the VIC pid JAF_PID. Pre-existing, not I1: the runtime image has had no npx, so the Lastminute MCP pre-warm (command npx) fails with spawn ENOENT (non-fatal); the Lastminute tool likely cannot connect in the image. |
| I2 | agentic-commerce | 6 | nginx and start script | V8 | done | From V7 review (pre-existing, medium): nginx `proxy_set_header Host $host` relays the client Host; authenticateRequest skips Ardra when host == GATEWAY_INTERNAL_HOST, so `Host: agentic-commerce.ardra.svc.cluster.local` plus any x-session-id cookie runs non-GENIUS agents unauthenticated; the same host drives getArdraBaseUrl (VIC posts the caller's cookie to https://<client Host>/ardra/). Set a fixed Host in nginx or key the bypass off a dedicated internal listener. From V8: start.sh must treat a VIC exit as fatal (today the backgrounded tsx can die while nginx stays up and HEALTHCHECK probes only /api/health, so the container stays healthy with a dead VIC); consider probing :3001/health. D2 confirmed 2026-10-31: keep `proxy_set_header Host $host` and the bypass exactly as today; the fixed-Host / internal-listener fix is OUT OF SCOPE for this plan (possible follow-up). I2 done: commit I2: nginx 404s for /tools, /conversations, /approvals and a fatal VIC exit (git log --grep '^I2:'); review: 2 rounds, APPROVE (round 1 APPROVE with a non-blocking race fixed in round 2: wait -n missed a VIC killed by a signal during the startup sleep; start.sh now polls kill -0 on VIC and nginx, then waits on the dead one). Host-header directives untouched (D2). start.sh: a VIC or nginx exit stops the container (exit = VIC status, or 1); agentic exit stays non-fatal as before; JAF_PID renamed VIC_PID. HEALTHCHECK also probes :3001/health. Verified with podman: nginx -t ok; via :8080 /tools, /tools/x, /conversations/abc, /approvals -> 404, /health 200; :3002/tools 200 with the token; VIC SIGKILL during or after startup -> 137, VIC exit 1 -> 1, nginx death -> 1, podman stop -> 0. Open, non-blocking: the fatal path's `wait` after kill is unbounded (same shape as the pre-existing trap; an I3 liveness probe covers a hang); nginx `upstream jaf` keeps its old name. |
| I4 | agentic-commerce | 6 | Environment split and secret guard | V8, V9 | done | From V6: Redis holding vic:transcript:* is VIC-only; transcripts keep tool_call arguments for TRANSCRIPT_TTL_S (e.g. deliverooShoppingTools.login_user password), consider redaction. From V7 review: GATEWAY_INTERNAL_HOST must never be set to a publicly reachable host (that disables Ardra auth); see I2 Notes for the pre-existing Host-header bypass. From V8: VIC refuses to start without SANDBOX_URL, SANDBOX_SERVICE_TOKEN and VIC_SERVICE_TOKEN; the deployment env must provide them. From V9: runner env needs VIC_TOOL_TIMEOUT_MS matching VIC's (the stub waits that +10 s); with KMS_ENCRYPTED_LANGFUSE=true the sandbox role needs kms:Decrypt on the Langfuse key only; jaf's tracing exporter honours HTTP(S)_PROXY, so keep proxy vars out of the sandbox env. From V15 review: transcripts in Redis are keyed by an unauthenticated client-chosen id (see V15 Notes); decide on scoping before production. From V11: everything in the sandbox env is readable by Bash commands via /proc/1/environ once the tool is attached (D3). From V17: runner .env.example gains IDOSELL_MCP_ENDPOINT (optional; default https://megadron.pl/mcp.php as in VIC; envGuard pattern does not match it). A malformed value now fails at vic-shared import in VIC and the runner (fail fast). I4 done: commit I4: env split (.env.example for VIC and the runner) and the runner's secret guard (git log --grep '^I4:'); review: 2 rounds, APPROVE (round 1 APPROVE with three non-blocking findings, all applied and re-approved in round 2). Guard: jaf-runner/src/envGuard.ts, called first in startRunner (after dotenv, before loadConfig); prints names only; empty string counts as set. D4 (Bedrock direct): LITELLM_* forbidden. Deviations from the spec pattern: (a) names ending _BEDROCK_MODEL or _MAX_TOKENS are exempt, since ^AXS_/^OBENAN_ otherwise refuse the runner's own AXS_BEDROCK_MODEL, AXS_MAX_TOKENS, OBENAN_BEDROCK_MODEL; (b) also forbidden: ALL_PROXY and lowercase http(s)_proxy/all_proxy (jaf tracing exporter and curl honour them), _PRIVATE_KEY$, _AUTH_KEY$, _PASSWORD$, ^REDIS_URL$ (TAP_PRIVATE_KEY, SPOTLIGHT_AUTH_KEY/BASIC_AUTH_PASSWORD and the Redis URL were not caught by the plan's list). Verified: runner suite 33/33, tsc clean; env -i boot with OBENAN_BEARER_TOKEN + https_proxy exits 1 naming both, value never printed; clean boot /health 200; every name in jaf-runner/.env.example passes (0/69); 22 of 73 VIC names are refused. |
| I3 | agentic-commerce | 6 | Build pipeline and deployment manifests | I1 | review | k8s apply is human From V9: with VIC_TOOLS_URL load-balanced across VIC pods, a rolling VIC deploy that changes the catalog gives intermittent 503 (runner VERSION_MISMATCH) until all pods agree; point it at a stable target or accept the window. From V11: readOnlyRootFilesystem is required (Bash commands could otherwise rewrite /app/jaf-runner/dist); the sandbox NetworkPolicy bounds Bash egress (/dev/tcp and node are available to commands). From V13: CI/build egress must allow codeload.github.com and cdn.sheetjs.com in addition to the npm registry. manifests ready. I3: commit I3: build and push both images, example sandbox manifests (git log --grep '^I3:'); review: 2 rounds, APPROVE (round 1 REQUEST_CHANGES: the VIC_TOOLS_URL comment claimed a stable target; fixed with the real preconditions). Status stays review until a human applies the manifests in the deploy repo and sets done. Makefile: build = --target vic; build-sandbox/push-sandbox via SANDBOX_IMAGE_NAME (default agentic-commerce-sandbox) instead of overriding IMAGE_NAME; release builds and pushes both. Jenkinsfile builds and pushes both in the existing stages. deploy/sandbox: Deployment (runtimeClassName <gvisor>, non-root 1001, readOnlyRootFilesystem, caps dropped, emptyDir /workspace and /tmp, /health probes, terminationGracePeriodSeconds 210, automountServiceAccountToken false since IRSA projects its own token, enableServiceLinks false), Service (jaf-sandbox:3001 and agentic-commerce-tools:3002), NetworkPolicy (ingress from VIC pods only; egress DNS, VIC tools, Bedrock/STS/KMS VPC-endpoint CIDRs and Langfuse on 443; STS and KMS added beyond the spec because IRSA and KMS_ENCRYPTED_LANGFUSE need them). Verified: make -n release; sandbox image runs --read-only with tmpfs /workspace and /tmp and all caps dropped (/health 200, /app EROFS); manifests parse (no cluster or validator available here: pulling kubeconform was not permitted). For the deployer: with more than one VIC replica, VIC needs REDIS_URL (in-memory run tokens otherwise give 401 on other pods); a catalog-changing rolling VIC deploy may give /chat 503 until pods agree; 3002 is reachable cluster-wide (follow-up: VIC-side ingress policy keeping 8080 open); building both images roughly doubles CI build time (a shared base stage would help). |
| V18 | agentic-commerce | 4 | Runner: LiteLLM provider for local development (D4 amendment) and `GET /catalog` | V9, I4 | done | From the I5 block: the smoke machine has LiteLLM, not Bedrock. Production stays Bedrock (D4); the I3 manifests never set `RUNNER_LLM_PROVIDER`. V18 done: commit V18: LiteLLM provider for local development and GET /catalog (git log --grep '^V18:'); review: 1 round, APPROVE. Verify: typecheck clean, runner tests 38/38; (e) env -i boot with RUNNER_LLM_PROVIDER=litellm and a dead LITELLM_URL: /health 200, log 'LLM provider: litellm', key never logged. Deviation: the .env.example LITELLM_* lines are commented out (the review found that empty assignments count as set and the guard refused the example under its own default bedrock). Notes: under litellm with LITELLM_MODEL, jaf traces still show the agent's Bedrock model id (withModelName only changes what the provider sends); jaf's LiteLLM provider logs the first 120 chars of the last message on each call (local dev only). Pre-existing, not V18: an empty LOG_TRANSPORT_TARGET= (as in the example) makes turing's logger fail at startup, so copy the example without the empty LOG_* lines. |
| I5 | agentic-commerce | 6 | End-to-end smoke | V12, V13, I1, I2, I4, V18 | todo | UNBLOCKED by plan v12 (2026-10-31, D12): (1) LLM through the runner's LiteLLM path (V18, `RUNNER_LLM_PROVIDER=litellm`); (2) local mode with the `GATEWAY_INTERNAL_HOST` bypass, no Ardra; (3) step 4 uses `IdoSellAgent` (public MCP endpoint, no credential, no browser); step 7 needs Ardra's merchant list and is staging-only: record it as not run locally and leave it to a human with a staging session; (4) step 5 checks the catalog version (VIC `/tools` before and after, runner `/catalog` after the `/chat`), not `/agents`; (5) the runner has its own `jaf-runner/.env`, never `JAF/.env`. Minimum env in the spec. Previously: BLOCKED on credentials (human). Commit I5: smoke script and VIC_TOOLS_URL example fix (git log --grep '^I5:'); not yet reviewed (review when unblocked). Added scripts/smoke-split.sh (steps 1-7; default 1 2 3 4 6; steps 5 and 7 need the manual setup described in its header). Local run 2026-10-31 (VIC and runner from source, env -i, random tokens, GATEWAY_INTERNAL_HOST bypass instead of a staging Ardra session, ports 39601-39603): step 1 PASS (both /health 200); step 2 status 200 and keys success, data.{conversationId,executionTimeMs,messages,outcome,runId,traceId,turnCount} as before the split, but outcome error ModelBehaviorError; step 3 PASS for events (stream_start, run_start, agent_processing, turn_start, llm_call_start, run_end, stream_end) and transcript replay (second turn has 2 user messages), outcome error; step 4 status 200, outcome error, no TOOL_CALL (the model never ran); step 6 PASS (envGuard 5/5, gateway chat.test 32/32, runner app.test 13/13, tool server without a token 401); steps 5 and 7 not run. Found and fixed: VIC_TOOLS_URL must end in /tools (jaf's remote-tools client GETs the URL as given and POSTs <url>/<id>/call; the runner's app.test uses http://vic:3002/tools); the I4 runner .env.example and the I3 deployment.yaml had it without /tools (catalog GET 404, every /chat 503). Both corrected in the I5 commit. Needed to unblock: (1) valid Bedrock credentials on the machine running the smoke (aws sts get-caller-identity fails with InvalidClientTokenId here; the developer JAF/.env has no AWS keys); (2) either a staging Ardra host plus an x-session-id cookie (SMOKE_HOST/SMOKE_SESSION_ID), or confirm that the local GATEWAY_INTERNAL_HOST bypass is acceptable for the smoke; (3) Korio and Shopify merchant settings for steps 4 and 7 (none in JAF/.env); (4) plan owner: step 5 says /agents lists the new tool, but /agents lists only tools an agent picks, so a dummy tool must also be added to an agent's pick list in jaf-runner (a runner change, not VIC-only); confirm or relax to checking the catalog version change. Note: JAF/.env holds ANTHROPIC/OPENAI/GOOGLE/BROWSERBASE API keys and LITELLM_*, which the I4 guard refuses, so the runner cannot share that file; give it its own env (jaf-runner/.env.example). |

---

## 5. Task specs

Every task: implement exactly what is listed, run Verify, then follow 3.5. "Acceptance" lines are what the
reviewer checks. If something in a spec is impossible or wrong, do not improvise: set `blocked` with the
question in Notes.

### J1. `/chat` accepts full transcript with tool traces

**Why.** VIC owns the transcript and replays it. Today `chatRequestSchema.messages` only allows user, assistant
and system text, and the conversion drops `tool_calls`; approval resume and "continue from previous tool
results" prompts both need the trace.

**Files.** `jaf:src/server/types.ts`, `jaf:src/server/server.ts`, new `jaf:src/__tests__/server-history.test.ts`.

**Changes.**
1. `types.ts`: change `chatRequestSchema.messages` from `z.array(httpMessageSchema)` to `z.array(fullMessageSchema)`.
   Keep `httpMessageSchema` exported (other code may use it). Keep `attachments` optional on the user/assistant
   variants of `fullMessageSchema` (add it there if missing).
2. `server.ts`, the Fastify JSON body schema `chatRequestBodySchema` (near line 97): replace `messages.items` with a
   JSON Schema that permits `role` in `user|assistant|system|tool`, `content: string`, optional `tool_calls`
   (array of `{id, type:'function', function:{name, arguments}}`), optional `tool_call_id`, optional
   `attachments`. ajv is configured with `removeAdditional: false`, so the zod parse is the authority; the JSON
   schema must simply not reject these fields.
3. `server.ts`, the conversion at "Convert HTTP messages to JAF messages" (near line 290):
   ```ts
   const jafMessages: Message[] = validatedRequest.messages.map((msg) => {
     if (msg.role === 'tool') return { role: 'tool', content: msg.content, tool_call_id: msg.tool_call_id };
     if (msg.role === 'assistant') return { role: 'assistant', content: msg.content,
       ...(msg.tool_calls && msg.tool_calls.length > 0 ? { tool_calls: msg.tool_calls } : {}),
       ...((msg as any).attachments ? { attachments: (msg as any).attachments } : {}) };
     return { role: 'user', content: msg.content, ...((msg as any).attachments ? { attachments: (msg as any).attachments } : {}) }; // system → user, as today
   });
   ```
   The `JAF_MESSAGE_LIMIT` loop above it already works on any role; leave it.
4. `/agents/:agentName/chat` delegates with the same body; no code change beyond the schema object it shares.

**Acceptance.**
- A request whose `messages` are `[user, assistant{tool_calls:[A]}, tool{tool_call_id:A}, user]` runs; the model
  provider stub receives all four messages with `tool_calls` and `tool_call_id` intact.
- A request with `approvals: [{sessionId, toolCallId: A, approved: true}]` and no `defaultMemoryProvider`
  applies the approval (engine executes tool A) because the pending assistant message was replayed.
- Existing requests with only user/assistant text behave identically.

**Verify.** `pnpm typecheck && pnpm lint && pnpm test`. New test uses `app.inject()` from the server returned by
`createJAFServer` with an in-memory `modelProvider` stub; no network, no DB.

### J2. Agent registry as a function on `ServerConfig`

**Why.** The sandbox rebinds a new registry when the tool catalog changes. A function source keeps `RunConfig`
immutable, avoids mutating a map the server already holds, and gives each run one snapshot.

**Files.** `jaf:src/server/types.ts`, `jaf:src/server/server.ts`, new `jaf:src/__tests__/server-registry.test.ts`, `jaf:docs/server-api.md` (brief).

**Changes.**
1. `types.ts`:
   ```ts
   export type AgentRegistry<Ctx> = ReadonlyMap<string, Agent<Ctx, any>>;
   export type AgentRegistrySource<Ctx> = AgentRegistry<Ctx> | (() => AgentRegistry<Ctx> | Promise<AgentRegistry<Ctx>>);
   export interface ServerConfig<Ctx> {
     ...
     runConfig: Omit<RunConfig<Ctx>, 'agentRegistry'> & { agentRegistry: AgentRegistrySource<Ctx> };
     agentRegistry?: AgentRegistrySource<Ctx>;   // legacy top-level, still accepted
   }
   ```
2. `server.ts`: after the backwards-compat block (near lines 131–139) define
   `const registrySource = config.runConfig.agentRegistry;` and
   `const resolveRegistry = async (): Promise<AgentRegistry<Ctx>> => typeof registrySource === 'function' ? await registrySource() : registrySource;`
   Replace every read of `config.runConfig.agentRegistry`:
   - `/agents` (near 231): `const registry = await resolveRegistry();`
   - `/chat` (near 268–271): resolve **once** at the top of the handler; use it for the existence check and the
     error message; in the per-request `runConfig` (near 473) set `agentRegistry: registry` explicitly **after**
     the spread of `config.runConfig` so the function never reaches the engine.
   - startup log (near 922): resolve for the log line.
   - `/agents/:agentName/chat` delegates to the `/chat` handler; no extra change.
3. A plain `Map` keeps working unchanged (the function branch is only taken for functions).

**Acceptance.**
- With a function source, `/agents` and `/chat` reflect the registry returned by the latest call; the function is
  invoked once per request (assert call count).
- The `RunConfig` passed to `run`/`runStream` has a `ReadonlyMap` as `agentRegistry`, never a function (assert via the
  `run_start` event or a provider stub that inspects `config.agentRegistry.get`).
- Existing tests pass unchanged.

**Verify.** `pnpm typecheck && pnpm lint && pnpm test`.

### J4. Export `jsonSchemaToZod` and `zodSchemaToJsonSchema`

**Files.** `jaf:src/providers/schema.ts`, `jaf:src/providers/mcp.ts`, `jaf:src/providers/index.ts`, `jaf:src/index.ts`, new `jaf:src/__tests__/schema-roundtrip.test.ts`.

**Changes.**
1. Move the private `jsonSchemaToZod` (currently `mcp.ts` near line 296) into `schema.ts` as a named export,
   unchanged in behaviour. `mcp.ts` imports it from `./schema`.
2. `providers/index.ts`: add `export * from './schema';`. `src/index.ts`: add `export * from './providers/schema';`
   (do **not** export `./providers/mcp` from the root index; it stays commented for test compatibility).
3. Test: for `z.object({ a: z.string().describe('x'), b: z.number().optional(), c: z.enum(['p','q']), d: z.array(z.object({ e: z.boolean() })) })`
   assert `jsonSchemaToZod(zodSchemaToJsonSchema(s))` accepts the same valid inputs and rejects the same invalid ones
   (missing `a`, wrong `c`), and that descriptions survive.

4. Neither function may rely on `instanceof` against zod classes: VIC passes schemas built with its own physical copy
   of zod (see the V1 note). Use `_def.typeName` duck typing throughout both converters.

**Acceptance.** Both functions importable from `@juspay-jaf/jaf` and `@juspay-jaf/jaf/providers`. MCP tests unchanged.

**Verify.** `pnpm typecheck && pnpm lint && pnpm test`.

### J3. Remote tool helper `discoverRemoteTools`

**Why.** The sandbox holds only stubs. This helper turns a catalog (2.3) into `Tool` objects whose `execute` posts
to VIC (2.4) and returns the `ToolResult` unchanged.

**Files.** new `jaf:src/providers/remote-tools.ts`, `jaf:src/providers/index.ts`, `jaf:src/index.ts`, new `jaf:src/__tests__/remote-tools.test.ts`, `jaf:docs/tools.md` (section "Remote tools").

**API (exact).**
```ts
export type RemoteToolCatalogEntry = {
  readonly id: string; readonly name: string; readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;   // JSON Schema
  readonly needsApproval?: boolean;
};
export type RemoteToolCatalog = { readonly version: string; readonly tools: readonly RemoteToolCatalogEntry[] };
export type RemoteToolsOptions<Ctx> = {
  readonly baseUrl: string;                                   // e.g. http://vic:3002/tools
  readonly headers?: Readonly<Record<string, string>>;         // static, e.g. service token
  readonly getCallHeaders?: (context: Readonly<Ctx>) => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;
  readonly getCallMeta?: (context: Readonly<Ctx>) => Readonly<Record<string, unknown>>;  // becomes body.call
  readonly timeoutMs?: number;                                 // default 120_000
  readonly fetchImpl?: typeof fetch;                           // default globalThis.fetch
  readonly expectedVersion?: string;                           // if set and served version differs → throw RemoteToolsError
};
export class RemoteToolsError extends Error { readonly code: 'HTTP' | 'VERSION_MISMATCH' | 'INVALID_CATALOG'; readonly httpStatus?: number; }
export type RemoteToolSet<Ctx> = {
  readonly version: string;
  readonly tools: readonly Tool<any, Ctx>[];
  readonly byId: ReadonlyMap<string, Tool<any, Ctx>>;
  readonly byName: ReadonlyMap<string, Tool<any, Ctx>>;       // last entry wins on duplicate names; byId is authoritative
};
export async function fetchRemoteToolCatalog(opts: RemoteToolsOptions<any>): Promise<RemoteToolCatalog>;
export function makeRemoteTool<Ctx>(entry: RemoteToolCatalogEntry, opts: RemoteToolsOptions<Ctx>): Tool<any, Ctx>;
export async function discoverRemoteTools<Ctx>(opts: RemoteToolsOptions<Ctx>): Promise<RemoteToolSet<Ctx>>;
```

**Behaviour.**
- `fetchRemoteToolCatalog`: `GET baseUrl` with `opts.headers`; non-2xx → `RemoteToolsError('HTTP')`; body must match
  the shape above (validate with zod; ids unique) else `INVALID_CATALOG`; `expectedVersion` mismatch → `VERSION_MISMATCH`.
- `makeRemoteTool`: `schema.name = entry.name`, `schema.description = entry.description`,
  `schema.parameters = jsonSchemaToZod(entry.parameters)` wrapped in `z.object({ value })` when not an object (same
  rule as `mcpToolToJAFTool`); `needsApproval = entry.needsApproval === true`.
  `execute(args, context)`: `POST ${baseUrl}/${encodeURIComponent(entry.id)}/call`, headers
  `content-type: application/json` + `opts.headers` + `await getCallHeaders?.(context)`, body
  `{ args, call: getCallMeta?.(context) ?? {} }`, `AbortController` timeout.
  - 2xx and JSON body with a `status` field → return the body as `ToolResult` unchanged.
  - 2xx without `status` → `ToolResponse.success(body)`.
  - non-2xx → `ToolResponse.error(ToolErrorCodes.EXTERNAL_SERVICE_ERROR, \`remote tool ${entry.id} failed: HTTP ${status}\`, { httpStatus, body: text.slice(0, 2000) })`.
  - abort → `ToolResponse.error(ToolErrorCodes.TIMEOUT, ...)`; network error → `EXTERNAL_SERVICE_ERROR`.
  Never throw from `execute`.
- Error messages, `RemoteToolsError` and `ToolResponse.error` details must never include request or response headers
  or the request body: the run token travels in a header, and these messages can surface in `/chat` error bodies.
- Must not import `./mcp` (keeps `@modelcontextprotocol/sdk` out of the root index).

**Acceptance.** Tests with a local `http.createServer`: catalog parse, version mismatch, stub schema validation,
success pass-through (status/data/metadata identical), error pass-through, HTTP 500 mapping, timeout mapping,
per-call headers and `call` meta present on the request.

**Verify.** `pnpm typecheck && pnpm lint && pnpm test`.

### J6. Tracing: OpenTelemetry collector independent of module load order

**Why.** `jaf:src/core/tracing.ts` loads the OpenTelemetry packages with an async `import()` started at module load
(`initOtelModules()`, near line 17), but the `OpenTelemetryTraceCollector` constructor calls `setupOpenTelemetry()` and
`trace.getTracer()` synchronously (near line 802). A consumer that constructs the collector right after importing the
library, as VIC does in `vic:JAF/src/server.ts` near line 180, gets `tracer === undefined`; `collect()` then returns early
forever and every Langfuse span is dropped without an error. `createCompositeTraceCollector` (near line 1411) has the same
race: `if (collectorUrl && OTLPTraceExporter)` silently omits the OTEL collector when the modules are not loaded yet. The
SDK is also only flushed on `beforeExit`, which does not fire on SIGTERM, so a pod termination loses buffered spans.
Found while doing V1 (`vic` commit 67ae193b).

**Files.** `jaf:src/core/tracing.ts`, new `jaf:src/__tests__/tracing-init.test.ts`, `jaf:docs/tracing.md` (short section).

**Changes.**
1. Make module loading observable. Replace the fire-and-forget `initOtelModules().catch(() => {})` with
   ```ts
   const otelModulesReady: Promise<boolean> = initOtelModules().then(() => otelAvailable, () => false);
   export function ensureOtelReady(): Promise<boolean> { return otelModulesReady; }
   ```
   `initOtelModules` itself is unchanged.
2. `OpenTelemetryTraceCollector`: keep the constructor signature. Store `serviceName`, `langfuseCredentials` and
   `collectorUrl` on the instance. Add a private idempotent `tryInit(): void`: return if `!otelAvailable`; if
   `collectorUrl && !otelSdk` call `setupOpenTelemetry(serviceName, collectorUrl, langfuseCredentials)`; then
   `this.tracer = trace.getTracer(serviceName)`. The constructor calls `tryInit()`; if the tracer is still unset and the
   modules are still loading, it registers `otelModulesReady.then(() => { this.tryInit(); this.flushPending(); })`.
   Keep the existing log lines.
3. Pending buffer. Add `private pending: TraceEvent[] = []` and `private readonly pendingMax = Number(process.env.JAF_OTEL_PENDING_MAX ?? 1000)`.
   Extract the per-event span logic of `collect()` into `private handle(event: TraceEvent): void`. New `collect()`:
   `this.inMemory.collect(event)` as today; if `this.tracer` is set → `handle(event)`; else if the modules are still loading →
   push to `pending` (when full, drop the oldest and log one warning per collector instance) and return; else (loading
   finished without OTEL) return. `flushPending()` runs the buffered events through `handle` in order and clears the buffer.
4. `createCompositeTraceCollector`: when `collectorUrl` is set, always push `new OpenTelemetryTraceCollector('jaf-agent', langfuseCredentials)`.
   Remove the `&& OTLPTraceExporter` condition and the eager `setupOpenTelemetry(...)` call there; the collector's
   `tryInit` performs it.
5. Export two helpers (they reach the root index through the existing `export * from './core/tracing'`):
   ```ts
   export async function createOpenTelemetryTraceCollector(serviceName?: string, langfuseCredentials?: LangfuseCredentials): Promise<OpenTelemetryTraceCollector>; // awaits ensureOtelReady(), then constructs
   export async function shutdownOpenTelemetry(): Promise<void>; // await otelSdk?.shutdown(); otelSdk = null; resolves even if nothing was started
   ```
   Keep the `beforeExit` hook.
6. `setupOpenTelemetry`: when it returns early because the modules are missing, log one line
   `[JAF:OTEL] OpenTelemetry modules not loaded yet; deferring setup` instead of returning silently.

**Acceptance.**
- Constructing the collector synchronously right after loading the module, then `collect(run_start)` and
  `collect(llm_call_end)` **before** `await ensureOtelReady()` settles, yields the root span after readiness:
  `(collector as any).traceSpans.size === 1` and `(collector as any).pending.length === 0`.
- With `TRACE_COLLECTOR_URL` set and the modules not yet loaded, `createCompositeTraceCollector()` includes an
  `OpenTelemetryTraceCollector` (assert with `instanceof` on the collector list, or by observing the in-memory collector it wraps).
- `JAF_OTEL_PENDING_MAX=3` with 5 events before readiness keeps the last 3 and logs exactly one warning.
- `shutdownOpenTelemetry()` resolves when nothing was started; with `TRACE_COLLECTOR_URL` pointing at a local
  `http.createServer` on `127.0.0.1` that records requests, after a `run_start`/`run_end` pair it resolves and at least
  one POST was received.
- Consumers that construct after readiness behave exactly as before; existing tests pass.

**Verify.** `pnpm typecheck && pnpm lint && pnpm test`. Test notes: under ts-jest (CommonJS) load the module with `require`
inside `jest.isolateModules` and construct the collector in the same synchronous turn; the dynamic imports in
`initOtelModules` cannot settle before that turn ends, so the pending path is exercised deterministically. Restore
`process.env` in `afterEach`. No network beyond `127.0.0.1`.

### J7. Build output loadable by plain Node (native ESM)

**Why.** `package.json` is `type: module` (commit e05de49) but `tsconfig.json` uses `module: es2020` and
`moduleResolution: node`, so `dist/` contains extensionless and directory-style relative imports that Node's ESM loader
rejects (`ERR_MODULE_NOT_FOUND` for `dist/core/types` from `dist/index.js`, on `main` too). Published 0.1.46 has the same
defect; consumers only work through tsx or a bundler. The sandbox image (I1) starts the runner with plain `node`, and V13
switches VIC to the published package, so this must be fixed before J5 publishes 0.2.0. Found while starting J5.

Inventory on this branch: 21 directory-style imports in `src/index.ts`, `src/adk/index.ts`, `src/adk/runners/index.ts`,
`src/visualization/index.ts`, `src/visualization/example.ts`; roughly 90 extensionless relative specifiers in about 20 files;
`require()` at runtime in `src/core/tracing.ts` (near 408), `src/adk/index.ts` (near 471), `src/adk/tools/index.ts` (near 599),
`src/adk/artifacts/index.ts` (near 170 and 295); `require.main === module` in `src/visualization/example.ts` (reachable from
`@juspay-jaf/jaf/visualization`) and `src/a2a/examples/*.ts` (reachable from `@juspay-jaf/jaf/a2a`); `exports` keys `./core`,
`./memory`, `./policies` with no `src/<dir>/index.ts` behind them. No JSON imports.

**Files.** `jaf:tsconfig.json`, `jaf:package.json`, the source files above plus every file tsc flags, new `jaf:src/core/index.ts`,
`jaf:src/memory/index.ts`, `jaf:src/policies/index.ts`, new `jaf:scripts/check-dist.mjs`, new `jaf:scripts/check-pack.sh`.

**Changes.**
1. `tsconfig.json`: `"module": "nodenext"`, `"moduleResolution": "nodenext"`; leave every other option. tsc now rejects
   extensionless relative specifiers under `type: module`; use its error list as the worklist.
2. Codemod every relative `import … from`, `export … from` and `import()` specifier under `src/` (tests excluded): a file
   becomes `./x.js`, a directory becomes `./x/index.js`. Do not touch package specifiers. Jest's `moduleNameMapper` already
   strips `.js`, so tests need no change.
3. Remove runtime `require()`: `tracing.ts` → `import { appendFileSync } from 'node:fs'`; the two `safe-math` sites → a static
   `import { evaluateMathExpression } from '<rel>/utils/safe-math.js'` (if that creates an import cycle, use
   `createRequire(import.meta.url)` instead and say so in Notes); `artifacts/index.ts` → `const require = createRequire(import.meta.url)`
   at module top so `ioredis` and `pg` stay optional, lazily loaded drivers.
4. Examples: replace `require.main === module` with `process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href`
   (`pathToFileURL` from `node:url`) in `src/visualization/example.ts` and `src/a2a/examples/*.ts`. No other behaviour change.
5. Add `src/core/index.ts`, `src/memory/index.ts`, `src/policies/index.ts` that re-export the modules of their directory
   (mirror what `src/index.ts` already re-exports from those directories; `typesVersions` in `package.json` already advertises them).
6. `package.json`: add `"engines": { "node": ">=22.12" }` (first line with unflagged `require(esm)`, which the `require`
   condition of `exports` relies on). Keep `exports` as is. Add `"check:dist": "node scripts/check-dist.mjs"`.
7. `scripts/check-dist.mjs`: for every key of `package.json` `exports`, `await import()` the `import` target and
   `createRequire(import.meta.url)()` the `require` target; assert the root exposes `createJAFServer`, `discoverRemoteTools`,
   `jsonSchemaToZod`, `zodSchemaToJsonSchema`, `ensureOtelReady`, `createOpenTelemetryTraceCollector`, `shutdownOpenTelemetry`.
   Exit non-zero on any failure. `scripts/check-pack.sh`: `pnpm pack` into a temp dir, `npm init -y` there, `npm i <tgz>`, then
   `node -e "import('@juspay-jaf/jaf')"` and `node -e "import('@juspay-jaf/jaf/server')"`; clean up.

**Acceptance.**
- `pnpm build && node scripts/check-dist.mjs` passes under plain Node 24 with no tsx on the path.
- `bash scripts/check-pack.sh` passes (the packed tarball loads from an empty project).
- `grep -rnE "\brequire\(" src --include='*.ts' | grep -v __tests__ | grep -v createRequire` prints nothing.
- `pnpm lint` passes; `pnpm test` unchanged except the known local PostgreSQL failure.
- `pnpm typecheck` in `vic` still passes against the linked build (V1 moved it to `moduleResolution: bundler`, which accepts `.js` specifiers in `.d.ts`).

**Verify.** `pnpm typecheck && pnpm lint && pnpm test; pnpm build && node scripts/check-dist.mjs && bash scripts/check-pack.sh`.

### J5. Docs, version bump, publish

**Files.** `jaf:docs/server-api.md`, `jaf:docs/tools.md`, `jaf:README.md`, `jaf:package.json`.

**Changes.** Document J1 (full transcript input, which fields), J2 (registry function, snapshot semantics), J3
(remote tools, with the VIC-style example), J4, and J6 (`ensureOtelReady`, `createOpenTelemetryTraceCollector`,
`shutdownOpenTelemetry`, `JAF_OTEL_PENDING_MAX`) in `docs/tracing.md`. Re-export `AgentRegistry` and
`AgentRegistrySource` from `src/server/index.ts` (J2 follow-up). Bump version `0.1.46 → 0.2.0`. Run `pnpm build` and confirm
`dist/` exports the new symbols. **Done criterion (plan v6).** J5 is `done` when the docs and version bump are reviewed and the J5 commit is on
`origin/feat/vic-sandbox-split`; the human pushes, the loop never does. VIC consumes that commit directly from GitHub
(V13, decision D5), so the npm publish is **not** on the critical path. It is task J8, performed by an npm org owner,
using the procedure below (from `jaf` on `feat/vic-sandbox-split` with a clean tree, or from `main` after merging, in
which case `--no-git-checks` is not needed):
1. `npm login` with an account that is a member of the `juspay-jaf` npm org with publish rights; `npm whoami`.
2. `pnpm install && pnpm build && node scripts/check-dist.mjs && bash scripts/check-pack.sh`.
3. `prepublishOnly` runs lint, tests and build. The tests need the local databases: `pnpm run test:db:start`, then
   `pnpm test`, then `pnpm run test:db:stop`. If Docker is unavailable, run `pnpm lint && pnpm build` by hand and publish
   with `--ignore-scripts`.
4. `pnpm publish --access public --tag next --no-git-checks --dry-run` and check the file list is `dist`, `README.md`, `LICENSE`.
   `--no-git-checks` is required because the branch is not `main`. Never use `pnpm version`: the `postversion` script pushes.
5. `pnpm publish --access public --tag next --no-git-checks` (add `--otp <code>` if the account has 2FA). `0.2.0` lands under
   dist-tag `next`; `latest` stays `0.1.46` for other consumers until I5 passes, then `npm dist-tag add @juspay-jaf/jaf@0.2.0 latest`.
6. Verify from an empty directory: `npm init -y && npm i @juspay-jaf/jaf@next && node -e "import('@juspay-jaf/jaf').then(m=>console.log(Object.keys(m).length))"`.

**Verify.** `pnpm build && node scripts/check-dist.mjs && bash scripts/check-pack.sh` (J7 provides both scripts).

### J9. Compatibility with VIC's pnpm overrides

**Why.** V13 installs the library as a git-hosted dependency inside the VIC workspace, where the root `pnpm.overrides`
rewrite the library's own dependency versions: `fastify ^4.29.1 → ^5.12.7`, `@fastify/cors ^9.0.1 → ^11.0.0`,
`uuid ^9.0.0 → ^11.1.1`, `mathjs ^14.6.0 → ^15.2.0`, `ai → 5.0.222`, `zod → 3.25.76`, `@opentelemetry/api → 1.9.0`.
Through `link:` (V1) these did not apply to the library; through a git dependency they do. The library has to work and be
tested under those versions. Also from the J5 review: `dist/test-utils` ships because `src/test-utils` is in the build.

**Files.** `jaf:package.json`, `jaf:pnpm-lock.yaml`, `jaf:tsconfig.json`, `jaf:src/server/server.ts` and whatever tsc or the
tests flag, `jaf:docs/server-api.md` only if behaviour changes.

**Changes.**
1. Bump in `package.json`: `fastify` `^5.12.7`, `@fastify/cors` `^11.0.0`, `uuid` `^11.1.1`, `mathjs` `^15.2.0`; `pnpm install`.
   Fix what breaks: Fastify 5 renamed and removed request/reply APIs (for example `request.routerPath` → `request.routeOptions.url`),
   changed some hook and plugin signatures, and `@fastify/cors` 11 option names; the `ajv.customOptions` block and `app.inject`
   are unchanged. Keep behaviour identical; no new features.
2. `tsconfig.json`: exclude `src/test-utils/**` from the build so it no longer ships in `dist/`; keep it available to jest.
3. Prove it under VIC's overrides: in a scratch directory create a package.json with the exact `pnpm.overrides` block from
   `vic:package.json` and `"@juspay-jaf/jaf": "github:xynehq/jaf#<J9 commit sha>"`, add the matching `onlyBuiltDependencies`
   entry to a `pnpm-workspace.yaml` there (see V13 step 3), run `pnpm install` with pnpm 10.34.9, then with plain Node
   `import('@juspay-jaf/jaf')`, call `createJAFServer` with a stub model provider and one agent, and `app.inject('/health')`.
   This requires the J9 commit to be pushed first; if it is not, run the scratch check against a local tarball from
   `pnpm pack` with the same overrides and say so in Notes.

**Acceptance.** `pnpm ls fastify @fastify/cors uuid mathjs --depth 0` shows 5.x, 11.x, 11.x, 15.x; `pnpm typecheck && pnpm lint && pnpm test`
pass with the known PostgreSQL exception; `node scripts/check-dist.mjs` and `bash scripts/check-pack.sh` pass; `dist/test-utils`
does not exist after `pnpm build`; the scratch check in step 3 returns 200 from `/health`.

**Verify.** `pnpm typecheck && pnpm lint && pnpm test; pnpm build && node scripts/check-dist.mjs && bash scripts/check-pack.sh && test ! -d dist/test-utils`.

### J10. Lossless schema conversion for the VIC tool catalog

**Files.** `jaf:src/providers/schema.ts`, `jaf:src/providers/model.ts` (one guard), `jaf:src/__tests__/schema-roundtrip.test.ts`
(extend), new `jaf:src/__tests__/schema-catalog-fixture.test.ts`.

**Why.** V3 found that `zodSchemaToJsonSchema` emits `{ type: 'string', description: 'Unsupported schema type' }` for 61
fields in 39 VIC tools (ZodDefault, ZodEffects, ZodNullable, ZodNativeEnum, ZodUnion, ZodLiteral, ZodAny, ZodPipeline). The
J3 stubs validate the model's arguments against `jsonSchemaToZod(parameters)`, so in the sandbox `update_cart_empik`
(required `items`, a ZodEffects over an array) rejects every call and numeric fields with `.default()` reject numbers. VIC
re-validates with the real zod schema on `/tools/:id/call` (V4, `tool.schema.parameters.safeParse`), so the stub must
accept everything the original accepts; it need not reproduce refinements, transforms or defaults.

**Changes, `zodSchemaToJsonSchema`.** Keep `_def.typeName` duck typing (J4 rule 4). Add these branches before the fallback:
1. Wrappers, convert the inner schema: `ZodDefault` (`_def.innerType`, then add `default: _def.defaultValue()`),
   `ZodEffects` (`_def.schema`), `ZodPipeline` (`_def.in`), `ZodBranded` (`_def.type`), `ZodReadonly` (`_def.innerType`),
   `ZodCatch` (`_def.innerType`), `ZodLazy` (`_def.getter()`).
2. `ZodNullable`: convert `_def.innerType`; if the result has a single string `type`, return it with `type: [that, 'null']`;
   otherwise `{ anyOf: [inner, { type: 'null' }] }`.
3. `ZodNativeEnum`: `values = Object.values(_def.values)`; when any value is a number keep only the numbers (TypeScript
   numeric enums also list the member names). All strings: `{ type: 'string', enum }`; all numbers: `{ type: 'number', enum }`.
4. `ZodUnion`, `ZodDiscriminatedUnion`: `{ anyOf: options.map(convert) }` (`_def.options` is an array, or a Map whose values are used).
5. `ZodLiteral`: `{ type: typeof value, enum: [value] }`; `type` omitted when the value is `null`.
6. `ZodAny`, `ZodUnknown`: `{}`.
7. `ZodNumber`: `type: 'integer'` when `_def.checks` contains `{ kind: 'int' }`; `minimum` / `maximum` from `min` / `max` checks.
8. `ZodTuple`: `{ type: 'array', items: { anyOf: items.map(convert) }, minItems: n, maxItems: n }`.
9. Descriptions: every branch (not only `ZodString`) copies `_def.description` to `description` when present.
10. The fallback stays `{ type: 'string', description: 'Unsupported schema type' }` for anything else, so `model.ts` can
    still detect it.

**Changes, `jsonSchemaToZod`.** Symmetric and permissive: `.optional()` for keys not in `required`; never apply `default`,
refinements or transforms.
1. `type` as an array: `z.union` of the converted non-`'null'` members (a single member stands alone), `.nullable()` when
   `'null'` is present.
2. `anyOf` / `oneOf`: `z.union` of the converted members; a member `{ type: 'null' }` becomes `.nullable()` on the rest;
   one remaining member stands alone.
3. `enum` without `type: 'string'`, or with any non-string value: `z.union` of `z.literal(v)`; a one-element `enum` is `z.literal(v)`.
4. `type: 'integer'`: `z.number().int()`; `minimum` / `maximum`: `.min()` / `.max()`.
5. `const`: `z.literal`. `{}` and any schema without `type`, `enum`, `anyOf`, `oneOf` or `const`: `z.any()` (today's fallback).
6. `type: 'object'` with `additionalProperties` as a schema and no `properties`: `z.record(convert(additionalProperties))`.
   Existing `.optional()` and `.describe()` handling unchanged.

**Changes, `model.ts`.** `shouldFallbackToJsonObject` also returns true when the root schema's `type` is not `'object'`
(an `{}` root from a `z.any()` output codec must not be sent as a strict `json_schema`).

**Acceptance.**
1. Round-trip property in `schema-roundtrip.test.ts`: for each construct above, `stub = jsonSchemaToZod(zodSchemaToJsonSchema(s))`
   accepts every listed input that `s` accepts; for `ZodNullable`, `ZodLiteral`, `ZodNativeEnum`, `ZodUnion` and object
   `required`, the listed invalid inputs are rejected by both.
2. Fixture test modelled on the V3 findings (shapes copied from `vic:JAF/src/tools/`, not imported): required
   `items: z.array(z.object({ productId: z.string(), quantity: z.number().int().min(1) })).refine(a => a.length > 0)`;
   `quantity: z.number().int().min(1).default(1)`; `limit: z.number().default(10)`; `z.string().nullable()`; a `z.nativeEnum`;
   `z.union([z.literal('a'), z.literal('b')])`; `z.any()`; `z.string().pipe(z.coerce.number())`; `z.string().transform(s => s.trim())`.
   Assert `JSON.stringify(zodSchemaToJsonSchema(fixture))` does not contain `Unsupported schema type`, and that the stub
   accepts `{ items: [{ productId: 'p', quantity: 2 }] }`, `{ quantity: 3 }`, `{ limit: 5 }`, a `null` for the nullable field
   and `'42'` for the pipeline field, and rejects `{ items: 'x' }`.
3. The J4 round-trip test and the MCP tests pass unchanged; for `z.object({ a: z.string().describe('x'), b: z.number().optional() })`
   the output equals today's byte for byte (already supported shapes do not change).
4. Notes record which constructs needed `anyOf` (OpenAI strict mode and Bedrock both accept it; V10 verifies the real catalog).

**Verify.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build && node scripts/check-dist.mjs`.

### J8. npm publish 0.2.0 by an npm org owner (optional, human-only)

Nothing in this plan depends on J8. It stays `blocked` so the loop never picks it. An npm org owner runs the publish
procedure in the J5 spec from the pushed branch (or `main` after merging), with `--tag next`, then sets this row to `done`
with the version and dist-tag in Notes in both plan copies. Promote to `latest` only after I5 passes.

### V1. Dependency: `@xynehq/jaf@0.1.18` → linked `@juspay-jaf/jaf`

**Files.** `vic:JAF/package.json`, every `vic:JAF/src/**/*.ts` importing `@xynehq/jaf`, `vic:pnpm-lock.yaml`.

**Changes.**
1. In `vic:JAF/package.json` replace `"@xynehq/jaf": "0.1.18"` with `"@juspay-jaf/jaf": "link:../../jaf"`.
   Run `pnpm install` in `jaf` and `pnpm build` there first (the link resolves `main: dist/index.js`).
2. `pnpm install` at the `vic` root. Then `pnpm ls zod --depth 10 --filter jaf-agent-standalone`: there must be a
   **single** zod version resolved for the package. If the link introduces a second zod, switch to a packed tarball:
   `cd ../jaf && pnpm pack` and reference `"file:../../jaf/juspay-jaf-jaf-<ver>.tgz"`; note the choice in the ledger.
3. Rewrite import specifiers `'@xynehq/jaf'` → `'@juspay-jaf/jaf'` (about 30 files). Fix compile errors caused by
   API drift between 0.1.18 and current `main` without changing behaviour (symbols used today: `ToolResponse`,
   `createJAFServer`, `ConsoleTraceCollector`, `OpenTelemetryTraceCollector`, `configureSanitization`,
   `createInMemoryProvider`, `Agent`, `ModelProvider`, `getTextContent`).

4. After J6 is `done`: run `pnpm build` in `../jaf`, then with `TRACE_COLLECTOR_URL` pointing at a local recording
   `http.createServer` on `127.0.0.1` (or the Langfuse variables from your `.env`), start the VIC dev server, send one
   `/chat`, and confirm the `[OTEL] OpenTelemetry tracer initialized` log line and at least one OTLP POST. Keep VIC's
   construction site unchanged (synchronous `new OpenTelemetryTraceCollector(...)`); J6 makes that safe.

**Resume note (plan v3).** Steps 1 to 3 are already committed in `vic` 67ae193b, including a `tsconfig` move to
`module: preserve` / `moduleResolution: bundler` and an `onEvent` change that strips `run_end.data.finalState` before
it reaches the Ardra SYSTEM message. Build on that commit; do not redo it.

**Acceptance.** `pnpm --filter jaf-agent-standalone typecheck` passes; `pnpm --filter jaf-agent-standalone dev` boots and
`GET /health` returns 200; no `@xynehq/jaf` string remains under `vic:JAF/src`; one `/chat` produces at least one OTLP
export with the linked library (step 4).

**Verify.** `pnpm typecheck` at the `vic` root; `grep -rn "@xynehq/jaf" JAF/src | wc -l` is 0.

### V2. `shared` package

**Why.** Both processes need the types, the prompt-safe context schema, the pure prompt helpers, the wire contracts and
the logger. The sandbox must never depend on modules that hold secrets or Ardra clients.

**Files.** new `vic:shared/` (package `@agentic-commerce/vic-shared`, `tsconfig` mirroring `vic:turing/`), `vic:pnpm-workspace.yaml`,
`vic:package.json` typecheck scripts, shims in `vic:JAF/src`.

**Contents of `shared/src`.**
- `types.ts`: the whole current `vic:JAF/src/types.ts` moved verbatim (AgentContextSchema, AgentContext, products, cart,
  JAFResponse, agentInfoList, findMerchant, AvailableMerchant, …). Leave `vic:JAF/src/types.ts` as `export * from '@agentic-commerce/vic-shared';`.
- `context.ts`: `SandboxContextSchema` exactly as in 2.5, `SandboxContext` type, and
  `toSandboxContext(ctx: Partial<AgentContext>, availableMerchants?: AvailableMerchant[]): SandboxContext`
  (parse with `SandboxContextSchema.strip()`; never pass through unknown keys).
- `prompt-helpers.ts`: moved **verbatim** from `vic:JAF/src/utils/ardraUtils.ts`: `constructSwitchMerchantInfo`,
  `hasDeliveryAddress`, `getDefaultAddress`, `withDefaultAddress`, `withAddressGuard`, `UpdateJAFResponseSchema`,
  `buildUpdateJAFResponse`, `buildUpdateJAFResponseFromKorio`, `MainSchema`; and from `services/discoveryMerchantService.ts`:
  `buildDiscoveryMerchantPromptMeta` (pure). `ardraUtils.ts` and `discoveryMerchantService.ts` re-export them so nothing else changes.
- `logger.ts`: `jafLog`, `flushJafLogs` moved from `vic:JAF/src/loggerConfig.ts` (shim re-exports).
- `kms.ts`: `decryptKms`, `base64ToBuffer` moved from `vic:JAF/src/utils/kmsDecryption.ts` (shim re-exports).
- `contracts.ts`: zod schemas `ToolCatalogEntrySchema`, `ToolCatalogSchema`, `ToolCallRequestSchema`, `ToolCallResponseSchema`
  (the `ToolResult` shape), `RunRecordSchema` (2.6), and constants `HDR_RUN_TOKEN='x-run-token'`,
  `HDR_CATALOG_VERSION='x-tool-catalog-version'`, `HDR_REQUEST_ID='x-request-id'`, `catalogIdFor(moduleBasename, toolName)`.

Dependencies of `shared`: `@agentic-commerce/turing`, `@juspay-jaf/jaf` (types and `ModelProvider` for `withAddressGuard`), `zod`,
`@aws-sdk/client-kms`. Nothing else.

**Acceptance.** `pnpm typecheck` passes for all workspaces; no behaviour change (shims); `shared` does not import
`axios`, `playwright` or anything under `vic:JAF/src`.

**Verify.** `pnpm typecheck`; `grep -rln "axios\|playwright" shared/src | wc -l` is 0.

### V3. Tool registry and catalog

**Files.** new `vic:JAF/src/tools-server/registry.ts`, new `vic:JAF/src/tools-server/dump-catalog.ts`, new `vic:JAF/src/tools-server/registry.test.ts`.

**Changes.**
1. `registry.ts` enumerates every tool object exported from `vic:JAF/src/tools/*.ts` (**not** `tools/agentsAsTools/*`, which
   are agents and move to the runner in V10). Use explicit imports (one line per module) rather than dynamic globbing.
2. Each entry: `id = catalogIdFor(<module basename without extension>, tool.schema.name)` e.g.
   `korioShoppingTools.add_to_cart_korio`; `name = tool.schema.name`; `description`; `parameters = zodSchemaToJsonSchema(tool.schema.parameters)`;
   `needsApproval = tool.needsApproval === true`. If any tool has a function-valued `needsApproval`, throw at startup
   (none does today).
3. Duplicate `id` → throw at startup with both module names. Duplicate `name` across modules is expected
   (`add_to_cart`, `remove_from_cart`, `close_browser_session`, `fill_otp`) and allowed.
4. `version = sha256(JSON.stringify(entries sorted by id, with sorted keys)).slice(0, 16)`.
5. Exports: `getCatalog(): ToolCatalog`, `getToolById(id): Tool | undefined`, `listToolIds(): string[]`.
6. `dump-catalog.ts`: prints the catalog JSON to stdout (used by V10 to build the id lists).

**Acceptance.** Test: at least 130 entries; the four colliding names map to distinct ids; `version` is identical across two
process runs; every `parameters` is an object schema.

**Verify.** `pnpm --filter jaf-agent-standalone typecheck && pnpm --filter jaf-agent-standalone exec tsx --test src/tools-server/*.test.ts`.
Add `"test": "tsx --test src/**/*.test.ts"` to `vic:JAF/package.json`.

### V5. Run-token store

**Files.** new `vic:JAF/src/gateway/runStore.ts`, test.

**Changes.** Interface `RunStore { create(record: Omit<RunRecord,'createdAt'|'expiresAt'>, ttlMs: number): Promise<string>; get(token: string): Promise<RunRecord | null>; delete(token: string): Promise<void> }`.
Token: `randomBytes(32).toString('base64url')`. `InMemoryRunStore` with a TTL sweep every 60 s (unref'd timer).
`RedisRunStore` using `ioredis` (add the dependency) with `SET key value PX ttl`, key `vic:run:<token>`.
Factory `createRunStore()` returns Redis when `REDIS_URL` is set, else in-memory, and logs which.

**Acceptance.** get after create returns the record; get after delete or after expiry returns null; tokens are unique.

**Verify.** as V3.

### V6. Transcript store

**Files.** new `vic:JAF/src/gateway/transcriptStore.ts`, test.

**Changes.** Interface `TranscriptStore { get(conversationId): Promise<readonly Message[]>; set(conversationId, messages: readonly Message[]): Promise<void>; delete(conversationId): Promise<void> }`.
`InMemoryTranscriptStore` (LRU, `TRANSCRIPT_MAX_CONVERSATIONS` default 1000, mirrors today's in-memory provider), and
`RedisTranscriptStore` (`vic:transcript:<id>`, JSON, `TRANSCRIPT_TTL_S` default 604800). Factory as in V5.
Decision D1 applies; default is Redis when `REDIS_URL` is set.

**Acceptance.** Round trip preserves `tool_calls` and `tool_call_id`; LRU evicts oldest.

**Verify.** as V3.

### V4. Tool server routes

**Files.** new `vic:JAF/src/tools-server/server.ts`, test with a fake tool and an in-memory run store.

**Changes.** A Fastify app `createToolServer({ runStore, port: VIC_TOOLS_PORT (default 3002) })`:
- `GET /tools`: requires `Authorization: Bearer ${VIC_SERVICE_TOKEN}` (constant-time compare via `crypto.timingSafeEqual`).
  Returns `getCatalog()` with `ETag: "<version>"`; `If-None-Match` match → 304.
- `POST /tools/:id/call`: service token → 401; `x-run-token` → `runStore.get` → 401 if null; parse body with
  `ToolCallRequestSchema` → 400; `body.call.conversationId !== record.conversationId` → 403; unknown id → 404.
  Then `tool.schema.parameters.safeParse(args)`; failure → **200** with `ToolResponse.validationError(...)`.
  Execute inside `withContext(record.requestContext, async () => { setContextValue(record.contextValues); ... })` so that
  `getContextValue('sessionId' | 'authToken' | 'businessId' | 'userId' | 'xFeature' | 'availableMerchants' | 'host')`
  inside tools behaves exactly as today. `await tool.execute(args, record.context)` with a timeout of
  `VIC_TOOL_TIMEOUT_MS` (default 180000) → on timeout **200** `ToolResponse.error(TIMEOUT, ...)`; thrown error →
  **200** `ToolResponse.error(EXECUTION_FAILED, message)`. A string result is returned as `ToolResponse.success(<string>)`.
  Log one line per call: id, conversationId, status, ms. Never log args or results (they may carry PII).

**Acceptance.** Tests cover every status code in 2.4, the ALS rebuild (a fake tool reads `getContextValue('sessionId')`),
the timeout path, and that a tool error is a 200 with `status: 'error'`.

**Verify.** as V3.

### V7. Gateway `/chat`

**Files.** new `vic:JAF/src/gateway/chat.ts`, `vic:JAF/src/gateway/sandboxClient.ts`, `vic:JAF/src/gateway/sse.ts`, test with a fake sandbox.

**Changes.** `createGateway({ runStore, transcriptStore, sandboxUrl, sandboxToken, catalogVersion: () => string })` returns a Fastify
plugin registering `POST /chat` and `GET /health`. The handler reproduces, **in this order and with the same responses**,
the current preHandler in `vic:JAF/src/server.ts`:
1. `/health` bypass. Cookie `x-session-id` and `Authorization: Basic` parsing; 401 when neither is present.
2. `sanitizeAgentContext(body.context)`; `x-jusbiz-module` / `x-jusbiz-feature` headers.
3. Agent name validation against the known agent list (`getKnownAgents()`: fetched from the sandbox `GET /agents` at startup and
   re-fetched when the catalog version changes; fall back to the static list in `shared` `agentInfoList` if the sandbox is down).
4. `authenticateRequest(...)` with the 429 and UNAUTHENTICATED responses; `getDiscoveryMerchantsForPrompt()` when
   `multiRegionSupportEnabled`; `validateAgentAccess`; `validateAuthenticateForAgent`; `checkQueryGuardrail` with the
   off-topic prefix for GENIUS agents; the `isInternalCall` bypass per decision D2.
5. `sendChatMessageAsync(conversationId, 'USER', …)`.

Then the new part:
6. `history = await transcriptStore.get(conversationId)`; `messages = [...history, ...body.messages]`.
7. `context = toSandboxContext(sanitizedContext, availableMerchants)`.
8. `token = await runStore.create({ conversationId, agentName, requestId, context: sanitizedContext, requestContext: getContext(), contextValues: {...} }, RUN_TOKEN_TTL_MS)`.
9. `sandboxClient.chat({ agentName, messages, context, stream, maxTurns })` with headers from 2.1 and
   `x-tool-catalog-version: catalogVersion()`.
10. Non-stream: `transcriptStore.set(conversationId, data.messages)`; SYSTEM `sendChatMessageAsync` with `outcome.output`
    or `'Model error'`; mask `outcome.error.detail` to `'Model error'` as the current onSend hook does; set
    `x-request-id`, `Cache-Control: no-cache, no-store, max-age=0`, `Pragma`, `Expires`; respond with the sandbox JSON unchanged.
11. Stream: pipe the upstream SSE bytes to the client unchanged; in parallel parse events line-by-line; on `run_end`
    store `data.finalState.messages` and send the SYSTEM message; write `: ping\n\n` every 15 s while the upstream is
    silent; on client close abort the upstream request.
12. `finally { await runStore.delete(token) }`. Sandbox unreachable or 5xx → `503 { error: 'Agent service unavailable' }`.

**Acceptance.** Fake-sandbox tests: non-stream path stores the transcript and persists USER then SYSTEM; stream path stores
from `run_end`; the body sent to the sandbox contains none of `password, davv, token, cardBin, cardLastFour, expiry,
paymentReference, paymentCurrency, paymentInstrument` and contains `availableMerchants`; the run token is deleted after
both paths; 401/429/400 responses are byte-identical to today's.

**Verify.** as V3. Requires J1 built in `jaf` (`pnpm build`) for the end-to-end check with the real runner later (I5).

### V8. VIC bootstrap: replace `JAF/src/server.ts`

**Files.** `vic:JAF/src/server.ts` rewritten; `vic:JAF/src/gateway/index.ts`, `vic:JAF/src/tools-server/index.ts`.

**Changes.** `server.ts` no longer imports `createJAFServer`, agents, the Bedrock provider, trace collectors, sanitization or
the memory provider. It: resolves nothing Langfuse-related (tracing moves to the runner); creates `runStore`, `transcriptStore`;
starts the gateway on `JAF_PORT` (default 3001, name kept so nginx and the Dockerfile stay valid) and the tool server on
`VIC_TOOLS_PORT` (default 3002); wraps requests in turing `withContext` exactly as today; keeps the MCP pre-warm block and
the graceful shutdown of `McpClientManager`, `BrowserSessionManager`, `MobileBrowserSessionManager`.
Fail fast at startup if `SANDBOX_URL`, `SANDBOX_SERVICE_TOKEN` or `VIC_SERVICE_TOKEN` is missing.

**Acceptance.** `pnpm --filter jaf-agent-standalone dev` boots both listeners; `/health` 200; `/tools` 401 without token and 200 with.
No import of `createJAFServer` remains under `vic:JAF/src`.

**Verify.** `pnpm typecheck`; `grep -rn "createJAFServer" JAF/src | wc -l` is 0.

### V14. Gateway parity for a context missing sessionId, conversationId or referenceId (D6)

**Files.** `vic:shared/src/context.ts`, `vic:JAF/src/gateway/chat.ts`, `vic:JAF/src/gateway/chat.test.ts`.

**Why.** Today `sanitizeAgentContext` parses `AgentContextSchema.partial()`, so a `/chat` body whose context lacks any of
the three ids still runs: `authenticateRequest` receives `null` for the missing id, tools see `undefined`, and both Ardra
`sendChatMessageAsync` calls are skipped when there is no conversationId (`if (conversationId && userMessage)` in the
preHandler and `if (!conversationId) return payload` in the onSend hook of the pre-split `vic:JAF/src/server.ts`). JAF
then mints `conv-<uuid>` for the run, so the turn has no history and leaves none the app can reach. V7 instead answers
400 (`SANDBOX_CONTEXT_INVALID`). D6 restores today's behaviour.

**Changes.**
1. `shared/src/context.ts`: `SandboxContextSchema` adds `.partial({ sessionId: true, conversationId: true, referenceId: true })`
   between `omit` and `extend` (section 2.5). `toSandboxContext` no longer throws for a missing id; fix its doc comment.
   The three fields of `SandboxContext` become `string | undefined`.
2. `chat.ts`: `` const runConversationId = sanitizedContext.conversationId ?? `conv-${randomUUID()}` ``. The run record
   (`conversationId`) and the sandbox body (`context.conversationId` and top-level `conversationId`) always carry
   `runConversationId`, so the tool server's `call.conversationId` check (V4) keeps passing. The top-level
   `body.conversationId` the app may have sent is no longer forwarded on its own; the one value wins.
3. `chat.ts`: `transcriptStore.get`/`set` and the USER and SYSTEM `sendChatMessageAsync` calls run only when the app
   supplied `conversationId` (`sanitizedContext.conversationId`), in both the non-stream and the stream path. With a minted
   id the run starts with `history = []` and stores nothing.
4. `chat.ts`: remove the 400 branch. A throw from `toSandboxContext` is now a VIC bug (only `availableMerchants` can fail
   the parse): log `SANDBOX_CONTEXT_INVALID` with the zod issue paths only (no values) and respond
   `500 { error: 'Internal server error' }`.
5. Nothing else changes: `authenticateRequest(conversationId ?? null, referenceId ?? null, action ?? null, authenticateFor)`,
   contextValues (the cookie session still fills `contextValues.sessionId`), forwarded headers, run-token lifecycle, and
   every V7 response that is byte-identical to the pre-split server.

**Acceptance.** Fake-sandbox tests:
(a) context without `referenceId`: 200; the sandbox body has no `referenceId`; `authenticateRequest` was called with
`referenceId === null`; the run token is deleted. This replaces the V7 test "a context without referenceId is a 400".
(b) context without `conversationId`, non-stream and stream: 200; the sandbox body has the same non-empty `conversationId`
top-level and in `context`, equal to the run record's; `transcriptStore.get` and `set` are never called; no USER or
SYSTEM `sendChatMessageAsync`; the run token is deleted.
(c) context without `sessionId` but with the `x-session-id` cookie: 200 and the run record's `contextValues.sessionId` is
the cookie value.
(d) a context with all three ids behaves exactly as before: every other V7 test passes unchanged.

**Verify.** as V3.

### V15. Gateway: conversationId source parity

**Files.** `vic:JAF/src/gateway/chat.ts`, `vic:JAF/src/gateway/chat.test.ts`.

**Why.** Before the split three sources were in play and VIC never copied one into another: the JAF server keyed memory by
the top-level `body.conversationId` (minting `conv-<uuid>` when absent, and echoing it back as `data.conversationId`); the
preHandler sent the USER message to Ardra under `context.conversationId` only; the onSend hook sent the SYSTEM message under
`context.conversationId || body.conversationId`. V14 keys everything by `context.conversationId`, so an app that sends only
the top-level id now loses its history (V14 Notes). Nobody has confirmed which field the app sends, so the gateway
reproduces each rule.

**Changes.** With `contextId = sanitizedContext.conversationId`, `topLevelId = body.conversationId` when it is a non-empty
string, and one `` mintedId = `conv-${randomUUID()}` `` per request:

| Use | Pre-split source | Gateway value |
|---|---|---|
| Transcript `get` / `set` key | JAF memory: top-level `body.conversationId` | `topLevelId ?? contextId`; neither: no history, nothing stored |
| Sandbox `context.conversationId` and `RunRecord.conversationId` (tool-call check, V4) | `body.context.conversationId` | `contextId ?? topLevelId ?? mintedId` |
| Sandbox top-level `conversationId` (echoed to the app as `data.conversationId`) | top-level `body.conversationId` or JAF-minted | `topLevelId ?? mintedId` |
| USER `sendChatMessageAsync` | `context.conversationId` | `contextId`; none: skipped (unchanged) |
| SYSTEM `sendChatMessageAsync`, run path and `admit` rejections | `context.conversationId \|\| body.conversationId` | `contextId ?? topLevelId`; none: skipped |
| `authenticateRequest` | `context.conversationId ?? null` | unchanged |

`RunRecord.context` stays `sanitizedContext` untouched, so VIC tools keep seeing the app's `context.conversationId` (or
`undefined`) exactly as today. Nothing else in V7/V14 changes.

**Acceptance.** Fake-sandbox tests, non-stream and stream, asserting the sandbox body, the transcript store calls, the Ardra
calls and the run record:
(a) only top-level `c1`: transcript under `c1`; sandbox `context.conversationId` and top-level both `c1`; no USER; SYSTEM under `c1`.
(b) `context.conversationId = 'c2'` and top-level `c1`: transcript under `c1`; sandbox `context.conversationId` `c2`,
top-level `c1`; USER and SYSTEM under `c2`; `authenticateRequest` called with `'c2'`; `RunRecord.conversationId === 'c2'`.
(c) only `context.conversationId = 'c2'`: transcript under `c2`; sandbox `context.conversationId` `c2`; top-level a fresh
`conv-` id; USER and SYSTEM under `c2`.
(d) neither: no transcript calls; sandbox `context.conversationId` and top-level the same `conv-` id; no USER or SYSTEM.
Every existing V7 and V14 test passes (V14's tests for (d) are unchanged; its test for (c) is updated only for the top-level value).

**Verify.** as V3.

### V16. Run-scoped tool state for Shopify MCP (D8)

**Files.** `vic:shared/src/contracts.ts`, `vic:JAF/src/gateway/runStore.ts` (+ test), `vic:JAF/src/tools-server/server.ts`
(+ test), `vic:JAF/src/tools/shopifyMCPShoppingTools.ts`, `vic:jaf-runner/src/catalog.ts` (+ test).

**Why.** Today one request context carries state both ways between `vic:JAF/src/agents/shopifyMCPAgent.ts` and
`vic:JAF/src/tools/shopifyMCPShoppingTools.ts`. The agent's `instructions()` derives `merchantId`, `catalogUrl`,
`addressRequired` and `addressSelected` from `context.merchantId`, `availableMerchants` and the address, and
`setContextValue`s them (lines 34–70); the tools read them with `getContextValue` (lines 493–496, 637–639, 727–739, 1383);
the switch-merchant tool writes `merchantId`, `catalogUrl`, `merchantName`, `addressRequired`, `addressSelected` back
(line 797), which later tool calls and the agent's next turn of the same run read. After the split the agent writes into
the sandbox's context and every VIC tool call starts from a fresh copy of the run record (V4), so Shopify search runs with
`catalogUrl` undefined and an in-run merchant switch is lost. `ShoppifyAgentMCP` is in today's registry.

**Design (D8).** VIC derives; the sandbox never sends merchant values to VIC (a sandbox-chosen `catalogUrl` would redirect
merchant traffic). Tool-to-tool state persists in the run record (`toolState`, 2.6). Tool-to-agent state travels back in
`ToolResult.metadata.contextPatch` (2.4) and the runner applies it to its request context. Cross-turn behaviour is
unchanged: a new `/chat` request starts from the app's `context.merchantId`, as today.

**Changes.**
1. `shared/src/contracts.ts`: `export const ToolStateSchema = z.object({ merchantId: z.string(), catalogUrl: z.string(),
   merchantName: z.string(), addressRequired: z.boolean(), addressSelected: z.boolean() }).partial()`,
   `export type ToolState`, `export const TOOL_STATE_KEYS = ['merchantId', 'catalogUrl', 'merchantName', 'addressRequired', 'addressSelected'] as const`.
   `RunRecordSchema` gains `toolState: ToolStateSchema.optional()`.
2. `gateway/runStore.ts`: `RunStore.patchToolState(token: string, patch: ToolState): Promise<void>`. In-memory: replace the
   record with a frozen copy whose `toolState` is the shallow merge. Redis: `GET`, merge, `SET … KEEPTTL` (never extends the
   expiry). Unknown or expired token: no-op.
3. `tools-server/server.ts`, per call: `setContextValue({ ...record.contextValues, ...record.toolState })` before argument
   validation. After `tool.execute` returns or throws, read each `TOOL_STATE_KEYS` entry with `getContextValue`; `changed` =
   the keys whose value is defined and differs from `record.toolState?.[key]`, validated with `ToolStateSchema` (keys with
   a wrong type are dropped and logged by name). If `changed` is non-empty: `await runStore.patchToolState(token, changed)`
   (on failure log `TOOL_STATE_PATCH_FAILED` and continue) and return the result with
   `metadata: { ...result.metadata, contextPatch: changed }`. Only these five keys travel; everything else a tool sets stays
   per call as today.
4. `tools/shopifyMCPShoppingTools.ts`: one helper `resolveShopifyState(context)` replaces the raw reads of `catalogUrl`,
   `merchantId`, `addressRequired` and `addressSelected`:
   `merchants = getContextValue<AvailableMerchant[]>('availableMerchants') ?? []`;
   `merchantId = getContextValue<string>('merchantId') || context.merchantId || merchants.find(m => m.agentName === 'ShoppifyAgentMCP')?.merchantId || ''`;
   `merchant = merchants.find(m => m.merchantId === merchantId)`;
   `catalogUrl = getContextValue<string>('catalogUrl') ?? merchant?.websiteUrl ?? ''`;
   `merchantName = getContextValue<string>('merchantName') ?? merchant?.merchantName ?? 'the merchant'`;
   `addressRequired = getContextValue<boolean>('addressRequired') ?? (merchant?.addressRequired !== false)`;
   `addressSelected = getContextValue<boolean>('addressSelected') ?? Boolean((context.address ?? '').trim() || (context.postalCode ?? '').trim())`.
   This is the agent's derivation (`shopifyMCPAgent.ts` lines 34–62) with the persisted `toolState` taking precedence. The
   switch tool's `setContextValue` block (line 797) stays as it is; step 3 picks it up. No prompt or tool-name change.
5. `jaf-runner/src/catalog.ts`: `pickTools` wraps every stub:
   `execute: async (args, ctx) => { const r = await stub.execute(args, ctx); const p = ToolStateSchema.safeParse((r as any)?.metadata?.contextPatch); if (p.success && Object.keys(p.data).length > 0) setContextValue(p.data); return r; }`.
   `shopifyMCPAgent.ts` keeps reading `getContextValue('merchantId' | 'addressSelected')` in `instructions()` (V10 step 6),
   so the next turn of the same run sees the switch as today.

**Acceptance.** Tests:
(a) tool server: a test tool that runs `setContextValue({ merchantId: 'm2', catalogUrl: 'https://b', unrelated: 1 })` →
200 with `metadata.contextPatch` equal to `{ merchantId: 'm2', catalogUrl: 'https://b' }`; the run record's `toolState`
equals it; a second call with the same token observes `getContextValue('merchantId') === 'm2'` before execution; a tool that
sets `addressSelected: 'yes'` yields no patch for that key; a tool that sets nothing yields no `contextPatch`.
(b) run store, in-memory and fake Redis: `patchToolState` merges, an unknown token is a no-op, `expiresAt`/TTL unchanged.
(c) Shopify helper: `toolState` empty, `context.merchantId = 'm1'`, merchants `[m1: websiteUrl 'u1', addressRequired false]`
→ `{ catalogUrl: 'u1', addressRequired: false, addressSelected: true }`; with `merchantId: 'm2'` present in the request
context the result is m2's values.
(d) runner: a fake catalog tool whose result carries `metadata.contextPatch: { merchantId: 'm2', bogus: 1 }` → afterwards
`getContextValue('merchantId') === 'm2'` inside the same request context and no `bogus` key.
(e) Workspace `pnpm typecheck`; V4, V5 and V9 tests unchanged.

**Verify.** as V3; `pnpm --filter @agentic-commerce/jaf-runner test`.

### V17. Prompt dependencies on VIC: Tortli cart summary and IdoSell shop URL (D11)

**Files.** `vic:shared/src/contracts.ts`, `vic:shared/src/context.ts`, new `vic:shared/src/idosell.ts`, `vic:shared/src/index.ts`,
`vic:JAF/src/gateway/chat.ts` (+ test), new `vic:JAF/src/gateway/toolStateSeed.ts`, `vic:JAF/src/tools/tortliShoppingTools.ts`
(+ test), `vic:JAF/src/agents/tortliAgent.ts` (+ test), `vic:JAF/src/tools/idosellShoppingTools.ts`, `vic:JAF/src/agents/idosellAgent.ts`,
`vic:jaf-runner/src/app.ts` (+ test), `vic:JAF/src/server.ts` (wire the default seed).

**Why.** Two agents read VIC-process state in their prompts. (1) `tortliAgent.ts` line 427 puts the live cart into every
model call's prompt through `describeTortliCartForPrompt(state.context.sessionId)`, which reads `tortliSessionStore`, an
in-memory `Map` in `tortliShoppingTools.ts` that only Tortli's VIC tools write (single write point: `updateTortliSession`,
near line 251). In the sandbox the store does not exist, so the prompt would always say "empty" while VIC holds the cart.
(2) `idosellAgent.ts` imports `IDOSELL_SHOP_URL` from `tools/idosellShoppingTools.ts`, which derives it from
`process.env.IDOSELL_MCP_ENDPOINT` (default `https://megadron.pl/mcp.php`): a VIC environment variable, not a secret.

**Changes, Tortli (parity: the live cart in every model call's prompt).**
1. `shared/src/contracts.ts`: `ToolStateSchema` gains `tortliCartSummary: z.string()` (still `.partial()`); `TOOL_STATE_KEYS`
   gains `'tortliCartSummary'`.
2. `shared/src/context.ts`: `SandboxContextSchema` gains `toolState: ToolStateSchema.optional()` (2.5). Import the schema from
   `./contracts`; keep `toSandboxContext` as it is (the gateway adds `toolState` after it).
3. `tools/tortliShoppingTools.ts`: at the end of `updateTortliSession(sessionId, updates)`, after the store write and the log,
   add `setContextValue({ tortliCartSummary: describeTortliCartForPrompt(sessionId) })`. V16's tool server then persists it
   and returns it as `metadata.contextPatch`; the runner's V16 wrapper puts it in the request context.
4. New `gateway/toolStateSeed.ts`: `export const seedToolState = (agentName: string, context: Partial<AgentContext>): ToolState =>
   agentName === 'BrowserAgentTortli' ? { tortliCartSummary: describeTortliCartForPrompt(context.sessionId) } : {}`.
   `createGateway` takes `seedToolState?: typeof seedToolState` (tests inject a fake; `server.ts` passes the default). In
   `chat.ts`, before `runStore.create`: `const seed = options.seedToolState?.(agentName, sanitizedContext) ?? {}`; when it has
   keys, the run record is created with `toolState: seed` and the sandbox body gets `context: { ...sandboxContext, toolState: seed }`.
5. `jaf-runner/src/app.ts` preHandler, after `values.availableMerchants = ...`: `Object.assign(values, parsed.data.toolState ?? {})`.
   (`SandboxContextSchema.strict()` keeps rejecting unknown keys.)
6. `agents/tortliAgent.ts` line 427: `${describeTortliCartForPrompt(state.context.sessionId)}` →
   `${getContextValue<string>('tortliCartSummary') ?? 'empty'}`; drop the `describeTortliCartForPrompt` import
   (`getContextValue` is already imported). No other prompt text changes. The agent is dormant in VIC after V8 and moves in V10.

**Changes, IdoSell (parity: same variable, same default, on both sides).**
7. New `shared/src/idosell.ts` with the three constants moved verbatim from `idosellShoppingTools.ts` lines 13–17
   (`IDOSELL_ENDPOINT = process.env.IDOSELL_MCP_ENDPOINT || 'https://megadron.pl/mcp.php'`, `IDOSELL_SHOP_HOST`,
   `IDOSELL_SHOP_URL`); `shared/src/index.ts` exports it. `idosellShoppingTools.ts` imports them from
   `@agentic-commerce/vic-shared` and re-exports the three names so `idosellCheckoutTool.ts` is unchanged.
   `idosellAgent.ts` imports `IDOSELL_SHOP_URL` from `@agentic-commerce/vic-shared`.
8. I4's runner `.env.example` gains `IDOSELL_MCP_ENDPOINT` (optional; the default matches VIC). The envGuard pattern does not
   match it.

**Acceptance.**
(a) `tortliShoppingTools.ts`: inside `withContext`, a session update (export `updateTortliSession` for tests, or go through an
existing exported tool with the module's fixtures) leaves `getContextValue('tortliCartSummary')` equal to
`describeTortliCartForPrompt(sessionId)`.
(b) gateway tests with an injected seed returning `{ tortliCartSummary: 'S' }` for `BrowserAgentTortli`: the run record is
created with `toolState: { tortliCartSummary: 'S' }` and the sandbox body has `context.toolState` equal to it; for another
agent neither is set; every V7, V14, V15 and V16 test passes unchanged.
(c) runner: a `/chat` body with `context.toolState: { tortliCartSummary: 'S', merchantId: 'm1' }` makes both values readable
with `getContextValue` inside the run; `toolState: { bogus: 1 }` is a 400 (strict).
(d) `tortliAgent.ts`: `instructions(state)` contains the request-context value when set and `empty` when not; the rest of
the prompt is byte-identical to before.
(e) IdoSell: `IDOSELL_SHOP_URL` from vic-shared equals `new URL(IDOSELL_ENDPOINT).origin`; VIC and runner typecheck; with the
variable unset both packages derive `https://megadron.pl`.

**Verify.** as V3; `pnpm --filter @agentic-commerce/jaf-runner test`.

### V9. `jaf-runner` package scaffold

**Files.** new `vic:jaf-runner/` (package `@agentic-commerce/jaf-runner`), `vic:pnpm-workspace.yaml`, root typecheck scripts.

**Dependencies.** `@juspay-jaf/jaf` (same link as V1), `@agentic-commerce/vic-shared`, `@agentic-commerce/turing`,
`@aws-sdk/client-bedrock-runtime`, `@aws-sdk/credential-providers`, `@smithy/node-http-handler`, `dotenv`, `zod`, `tsx`.
**Forbidden**: `playwright`, `@playwright/mcp`, `@modelcontextprotocol/sdk`, `mcp-remote`, `axios`, `tunnel`, `https-proxy-agent`.

**Module format.** `type: module` in `package.json`, `module`/`moduleResolution` `nodenext`, `.js` on every relative
specifier, same rules as J7, so the compiled runner starts with plain `node dist/server.js` as I1 requires.

**`src/server.ts`.**
- Config: `RUNNER_PORT` (3001), `RUNNER_SERVICE_TOKEN`, `VIC_TOOLS_URL`, `VIC_SERVICE_TOKEN`, `BEDROCK_*`, `AWS_REGION`, `LANGFUSE_*`,
  `ADDITIONAL_ALLOWED_FIELDS_JAF`. Fail fast when any of the first four is missing.
- `catalog.ts`: `let current: { version: string; set: RemoteToolSet<SandboxContext> }`;
  `ensureCatalog(expectedVersion?: string)`: single-flight (one in-progress promise); if `current.version !== expectedVersion`
  call `discoverRemoteTools({ baseUrl: VIC_TOOLS_URL, headers: { authorization: \`Bearer ${VIC_SERVICE_TOKEN}\` },
  getCallHeaders: () => ({ 'x-run-token': getContextValue('runToken') ?? '', 'x-request-id': getContextValue('x-request-id') ?? '' }),
  getCallMeta: (ctx) => ({ conversationId: ctx.conversationId }), expectedVersion })`, then `currentRegistry = buildAgents(current.set)`.
  `pick(ids: readonly string[]): Tool[]` throws listing unknown ids.
- `agents.ts`: `buildAgents(set): ReadonlyMap<string, Agent<SandboxContext, JAFResponse>>` (filled by V10; scaffold returns an empty map).
- `createJAFServer({ port, host: '0.0.0.0', cors: false, runConfig: { agentRegistry: () => currentRegistry, modelProvider: withAddressGuard(bedrock),
  maxTurns: 100, modelOverride: process.env.BEDROCK_MODEL, onEvent: (e) => traceCollector.collect(e) } })`. **No** `defaultMemoryProvider`, **no** `memory`.
- preHandler (skip `/health`): `Authorization: Bearer ${RUNNER_SERVICE_TOKEN}` constant-time → 401; copy `x-run-token`,
  `x-request-id`, `external-request-id`, `flow-id`, `business-id`, `user-id` into the turing context (`setContextValue({ runToken, ... })`);
  parse `body.context` with `SandboxContextSchema` → 400 on failure (never strip silently: the gateway is the only caller);
  `await ensureCatalog(request.headers['x-tool-catalog-version'])` → on `RemoteToolsError` respond 503 `{ error: 'tool catalog unavailable' }`.
- Copy from the current `vic:JAF/src/server.ts` verbatim: Langfuse OTLP header setup incl. optional KMS, `configureSanitization`
  whitelist, trace collector choice, the `withContext` request wrapper, graceful shutdown (without browsers/MCP).
  Construct the OTEL collector with `await createOpenTelemetryTraceCollector('jaf-sandbox', creds)` (J6) and call
  `await shutdownOpenTelemetry()` in the SIGTERM/SIGINT handler so buffered spans flush on pod termination.
- `src/providers/bedrock-provider.ts` moved from `vic:JAF/src/providers/`.

**Acceptance.** Boots against a fake `/tools`; `/chat` 401 without the service token; a second `/chat` with a different
`x-tool-catalog-version` triggers exactly one re-fetch and `/agents` reflects the new tool list without restart; a request
whose `context` contains `password` is rejected with 400.

**Verify.** `pnpm --filter @agentic-commerce/jaf-runner typecheck && pnpm --filter @agentic-commerce/jaf-runner test`;
`grep -E "playwright|modelcontextprotocol|axios" jaf-runner/package.json | wc -l` is 0.

### V10. Migrate agents and prompts to the runner

**Files.** move `vic:JAF/src/agents/**`, `vic:JAF/src/agents.ts`, `vic:JAF/src/prompts/**`, `vic:JAF/src/data/**`,
`vic:JAF/src/tools/agentsAsTools/**` → `vic:jaf-runner/src/` (same relative layout). `vic:jaf-runner/src/agents.ts` (registry).

**Changes, per agent file (25 files + `agents.ts`).**
1. Replace every tool import from `src/tools/...` with ids: `tools: catalog.pick(['korioShoppingTools.initialize_korio_session', ...])`.
   Build the id list from `tsx src/tools-server/dump-catalog.ts` (V3) by matching the imported tool variables to their
   `schema.name` and source module. Do not rename any tool.
2. `getContextValue<AvailableMerchant[]>('availableMerchants')` → `state.context.availableMerchants ?? []`.
3. Imports of `constructSwitchMerchantInfo`, `hasDeliveryAddress`, `buildDiscoveryMerchantPromptMeta`, `findMerchant`, types →
   `@agentic-commerce/vic-shared`. No prompt text changes.
4. `agentsAsTools/*`: these run JAF sub-agents (LLM calls) and must stay in the runner; their inner tools (dashboard tools such as
   `listPayments`, `createPayout`, `approvePayout`, …) become catalog ids like the rest.
5. `buildAgents(set)` constructs the registry from all `create*Agent()` factories currently listed in `startJAFServer()`;
   keep the same commented-out set commented out. Startup asserts every id exists in `set.byId`.
6. `agents/shopifyMCPAgent.ts`: keep its `getContextValue` / `setContextValue` calls (`@agentic-commerce/turing` is a runner
   dependency) with one change (D8 amendment): `effectiveMerchantId = getContextValue<string>('merchantId') || ctx.merchantId || ''`,
   the run's saved merchant first, then the app's. After an in-run switch the prompt and VIC's tools then name the same
   merchant (V16 feeds `merchantId` and `addressSelected` back into the runner's request context). A new `/chat` request
   starts from the app's `context.merchantId` as today. Test: with `merchantId: 'm2'` in the request context and
   `state.context.merchantId = 'm1'`, `instructions(state)` names m2's merchant; with an empty request context it names m1's.
7. GENIUS: `analyticsOrchestratorAgent.ts`, `allAnalyticsOrchestratorSubAgents.ts` and `tools/agentsAsTools/*` move exactly like
   the others (sub-agent tools become catalog ids) but are not exercised and not expected to work until section 8.1 (D9).
8. Mechanical (from the V10 survey): `prompts/flowInfoPrompt.ts` imports the pure `RuleType` enum from VIC's
   `services/ai/utils/schemaConverter` (that module also loads VIC's logger): copy the enum verbatim next to the prompt in the
   runner. `data/deliverooData.ts` and `data/brickdepotCountyCityMappings.json` are imported only by VIC tools and stay in VIC;
   only `data/jusbizDoc.ts` moves.
9. Consumers of V17: `tortliAgent.ts` already reads `getContextValue('tortliCartSummary')`; `idosellAgent.ts` already imports
   `IDOSELL_SHOP_URL` from `@agentic-commerce/vic-shared`. Neither needs a further change here.

**Acceptance.** After `pnpm build` in `../jaf` (J10 included), `tsx src/tools-server/dump-catalog.ts <out>` in `vic:JAF`
produces a dump with zero occurrences of `Unsupported schema type` (record the field count that changed in Notes);
`jaf-runner` typecheck passes; startup against the real VIC `/tools` (V8 running) succeeds with the same agent
names as today's `/agents` output; `git diff --stat` shows prompt strings unchanged apart from the lines above
(reviewer samples 5 agents).

**Verify.** `pnpm typecheck`; `pnpm --filter @agentic-commerce/jaf-runner test`.

### V11. Bash tool in the runner

**Files.** new `vic:jaf-runner/src/tools/bash.ts`, test.

**Spec.** `schema.name = 'bash'`; parameters `{ command: string, timeoutMs?: number (≤ 60000, default 30000) }`;
cwd `= path.join(BASH_WORKSPACE_ROOT (default /workspace), conversationId)` created on first use; the conversationId must match
`^[A-Za-z0-9_-]{1,128}$` else `validationError`; `spawn('/bin/sh', ['-c', command], { cwd, env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: cwd, LANG: 'C.UTF-8' }, detached: true })`
(clean environment: nothing from `process.env`); kill the process group on timeout; cap stdout and stderr at 32 KiB each with a
`[truncated]` marker; return `ToolResponse.success({ exitCode, stdout, stderr, truncated, timedOut })`; `needsApproval = process.env.BASH_NEEDS_APPROVAL === 'true'`.
A sweeper deletes workspaces idle longer than `BASH_WORKSPACE_TTL_MS` (default 3600000). Not attached to any agent by default (D3).

**Acceptance.** Tests: per-conversation cwd isolation; timeout kills a `sleep 100`; output cap; child env contains no `AWS_*`,
`LANGFUSE_*` or `RUNNER_*` variables; invalid conversationId rejected.

**Verify.** `pnpm --filter @agentic-commerce/jaf-runner test`.

### V12. Clean `vic:JAF/` of runtime code

**Changes.** Delete from `vic:JAF/src`: `agents/`, `agents.ts`, `prompts/`, `data/`, `tools/agentsAsTools/`, `providers/bedrock-provider.ts`,
and the shims that nothing imports any more. Remove `@aws-sdk/client-bedrock-runtime` from `vic:JAF/package.json` if unused.
Rename the package to `@agentic-commerce/vic` and update the root `typecheck` scripts and the Dockerfile `--filter` names.
Do not delete untracked files.

**Acceptance.** `pnpm typecheck` passes; `vic:JAF/src` imports from `@juspay-jaf/jaf` only `ToolResponse`, `ToolErrorCodes`,
`ToolResult`, `Tool`, `Message`, `zodSchemaToJsonSchema` (grep).

**Verify.** `pnpm typecheck`; `grep -rhoE "from '@juspay-jaf/jaf[^']*'" JAF/src | sort -u`.

### V13. Switch to the library's GitHub commit (git-hosted dependency)

**Why.** Decision D5: no npm publish rights on the team, so VIC installs the library straight from a pushed commit.
pnpm fetches `https://codeload.github.com/xynehq/jaf/tar.gz/<sha>`, installs the library's devDependencies, runs its
`prepare` script (`tsc`), keeps only the `files` of the package (`dist`, `README.md`, `LICENSE`, `package.json`), and pins
the tarball with an integrity hash in `pnpm-lock.yaml`. No `git` binary is needed. Verified 2026-10-30 against fc18c84.

**Changes.**
1. `SHA` = the full 40-character commit of J9 as it exists on `origin/feat/vic-sandbox-split`. Confirm with
   `git -C ../jaf fetch origin && git -C ../jaf merge-base --is-ancestor <SHA> origin/feat/vic-sandbox-split`. If the commit is
   not on origin, set `blocked` with the note "push required" and stop; the human pushes.
2. In `vic:JAF/package.json` and `vic:jaf-runner/package.json`: `"@juspay-jaf/jaf": "github:xynehq/jaf#<SHA>"`. Always a full
   SHA, never a branch name, so builds are reproducible.
3. `vic:pnpm-workspace.yaml`: add
   ```yaml
   onlyBuiltDependencies:
     - "@juspay-jaf/jaf@https://codeload.github.com/xynehq/jaf/tar.gz/<SHA>"
   ```
   pnpm 10 refuses the bare package name for git-hosted packages, so this entry changes with every bump. Keep any entries
   that `pnpm approve-builds` already added.
4. `pnpm install` at the `vic` root; commit `pnpm-lock.yaml`. Then `pnpm ls zod fastify --depth 10 --filter jaf-agent-standalone`:
   one zod, fastify 5.x for the library (the root override now applies; J9 made that safe).
5. Remove every `link:` entry and any `file:` tarball left from V1.

**Bumping later.** Change the SHA in the two `package.json` files and the allowlist entry, run `pnpm install`, commit the lockfile.
If the repository ever becomes private, the builder needs a token: use `git+https://<token>@github.com/xynehq/jaf.git#<SHA>`
from a build secret instead of the `github:` shorthand.

**Acceptance.** In a fresh clone, `pnpm install --frozen-lockfile` succeeds with outbound HTTPS only; from `vic:JAF` and from
`vic:jaf-runner`, `node -e "import('@juspay-jaf/jaf').then(m => console.log(Object.keys(m).length))"` prints a count under plain
Node; `pnpm typecheck` passes; the VIC gateway and the runner boot together and one `/chat` round-trip succeeds; no `link:`
remains anywhere in the workspace.

### I1. Dockerfile: `vic` and `sandbox` targets

**Changes.** Keep the existing stages as target `vic` (builder installs the workspace, builds `turing`, `shared`, `agentic`, `JAF`;
runtime keeps Playwright and nginx; the generated `start.sh` starts `agentic` and the VIC process only, no JAF line).
Add target `sandbox`: builder builds `turing`, `shared`, `jaf-runner`; runtime from the same pinned `node` base with
`bash coreutils` only, no npm/corepack (same removal as today), non-root `appuser`, copies only `jaf-runner`, `shared`, `turing`
and their pruned `node_modules`, `ENV NODE_ENV=production BASH_WORKSPACE_ROOT=/workspace`, `VOLUME /workspace`,
`CMD ["node", "dist/server.js"]`, `HEALTHCHECK` on `/health`.
Both builders install the library from codeload.github.com (V13): CI must allow outbound HTTPS to github.com and
codeload.github.com during `pnpm install`; no `git` binary is required; the library's `prepare` build runs inside the builder.

**Acceptance.** `docker build --target vic .` and `docker build --target sandbox .` succeed; the sandbox image contains no
`playwright` directory and no `chromium`; `docker run sandbox node -e "require('/app/jaf-runner/dist/server.js')"` is not required.

**Verify.** both builds; `docker run --rm --entrypoint sh <sandbox> -c 'ls /app/jaf-runner/node_modules | grep -c playwright'` prints 0.

### I2. nginx and start script

**Changes.** `vic:nginx.conf`: `/` keeps proxying to 3001 (now the gateway); keep `proxy_set_header Host $host` and every
other header directive exactly as today (D2: the Host-header bypass stays as is; do not add a fixed Host or an internal
listener); add `location /tools { return 404; }` and
`location /conversations { return 404; }` and `location /approvals { return 404; }` as defence in depth; keep the SSE-relevant
timeouts. `start.sh` (generated in the Dockerfile) no longer starts JAF.

**Acceptance.** nginx config test passes (`nginx -t` in the image); `/tools` through nginx is 404 while `:3002/tools` inside the pod works.

### I4. Environment split and secret guard

**Changes.**
- `vic:JAF/.env.example`: every variable VIC needs (merchant, MCP, AXS, Shopify, Obenan, QAPI, LiteLLM, KMS, proxy, `REDIS_URL`,
  `SANDBOX_URL`, `SANDBOX_SERVICE_TOKEN`, `VIC_SERVICE_TOKEN`, `VIC_TOOLS_PORT`, `RUN_TOKEN_TTL_MS`, `VIC_TOOL_TIMEOUT_MS`, `TRANSCRIPT_*`).
- `vic:jaf-runner/.env.example`: `RUNNER_PORT`, `RUNNER_SERVICE_TOKEN`, `VIC_TOOLS_URL`, `VIC_SERVICE_TOKEN`, `BEDROCK_*`, every
  `*_BEDROCK_MODEL` and `*_MAX_TOKENS`, `AWS_REGION`, `LANGFUSE_*`, `KMS_ENCRYPTED_LANGFUSE`, `ADDITIONAL_ALLOWED_FIELDS_JAF`,
  `BASH_*`, `IDOSELL_MCP_ENDPOINT` (V17; optional, not a secret), `RUNNER_LLM_PROVIDER` + `LITELLM_URL`/`LITELLM_API_KEY`/`LITELLM_MODEL`
  (V18; local development only). No `HTTP_PROXY`/`HTTPS_PROXY`.
- Runner startup guard (`vic:jaf-runner/src/envGuard.ts`): refuse to start if any variable matching
  `/_CLIENT_SECRET$|_BEARER_TOKEN$|_API_KEY$|^SHOPIFY_UCP_|^AXS_|^OBENAN_|^QAPI_|^LITELLM_|^HTTPS?_PROXY$/` is set, except `LITELLM_*` is
  allowed only if decision D4 routes the LLM through LiteLLM (V18: exactly `LITELLM_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL`, and only
  when `RUNNER_LLM_PROVIDER=litellm`). Print the offending names, never the values.

**Acceptance.** Test: guard throws for `OBENAN_BEARER_TOKEN=x`; passes for a clean environment.

### I3. Build pipeline and deployment manifests

**Changes.** `vic:Makefile`: `build` builds `--target vic`; add `build-sandbox`/`push-sandbox` with `IMAGE_NAME=agentic-commerce-sandbox`
and `--target sandbox`; `release` builds and pushes both. `vic:Jenkinsfile`: build and push both images in the existing stages.
Add `vic:deploy/sandbox/` with example `Deployment`, `Service` and `NetworkPolicy` manifests: ingress only from pods labelled
as VIC; egress only to the Bedrock endpoints, the VIC tool-server Service, the Langfuse host and DNS; `readOnlyRootFilesystem: true`;
`emptyDir` at `/workspace`; `runtimeClassName` placeholder for gVisor. The real deploy repo is outside this plan: applying
manifests is a **human** step; set `review` with the note "manifests ready" when done.

### V18. Runner: LiteLLM provider for local development (D4 amendment) and `GET /catalog`

**Files.** `vic:jaf-runner/src/config.ts`, new `vic:jaf-runner/src/providers/modelProvider.ts` (+ test), `vic:jaf-runner/src/server.ts`,
`vic:jaf-runner/src/envGuard.ts` (+ test), `vic:jaf-runner/src/app.ts` (+ test), `vic:jaf-runner/.env.example`.

**Why.** The I5 smoke runs on a developer machine that has no Bedrock credentials but has a LiteLLM endpoint and key. Production
stays Bedrock, called directly from the sandbox (D4). Step 5 of the smoke must see which catalog version the runner holds; jaf's
`/health` body is fixed, so the runner gets a one-field route of its own.

**Changes.**
1. `config.ts`: `RunnerConfig` gains `llmProvider: 'bedrock' | 'litellm'` (from `RUNNER_LLM_PROVIDER`, default `bedrock`; any other
   value throws), `litellmUrl?: string`, `litellmApiKey?: string`, `litellmModel?: string` (from `LITELLM_URL`, `LITELLM_API_KEY`,
   `LITELLM_MODEL`). With `litellm`, `LITELLM_URL` is required.
2. New `providers/modelProvider.ts`: `createModelProvider(config): { getCompletion }`. `bedrock`: `makeBedrockProvider(config.awsRegion)`
   as today. `litellm`: `makeLiteLLMProvider(config.litellmUrl, config.litellmApiKey ?? 'anything')` from `@juspay-jaf/jaf`; when
   `litellmModel` is set, wrap it with the exported pure `withModelName(provider, name)`, which calls the inner `getCompletion` with
   `{ ...agent, modelConfig: { ...agent.modelConfig, name } }` (the agents' Bedrock model ids mean nothing to LiteLLM). Either way
   only `getCompletion` is exposed, so `withAddressGuard` keeps applying (V9). `server.ts` calls it instead of `makeBedrockProvider`
   and logs the provider name, never the key.
3. `envGuard.ts`: `forbiddenEnvNames(env)` (and so `assertSandboxEnv`) exempts exactly `LITELLM_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL`
   when `env.RUNNER_LLM_PROVIDER === 'litellm'`; everything else is unchanged, so a production sandbox (which never sets the switch)
   still refuses every `LITELLM_*` and every `*_API_KEY`.
4. `app.ts`: `GET /catalog` → `200 { version: catalog.version() ?? null }`, behind the Bearer token like every non-health route; the
   preHandler's `ensureCatalog` runs for it as for the other routes (without the version header it fetches only when nothing is loaded).
5. `.env.example`: a block `# --- LLM provider ---` with `RUNNER_LLM_PROVIDER=bedrock` and the comment that `litellm` is for local
   development and the I5 smoke only (production: Bedrock, D4; the I3 manifests never set it), then `LITELLM_URL=`, `LITELLM_API_KEY=`,
   `LITELLM_MODEL=` (a model that supports tool calls). D3 applies: the key is readable by Bash commands once that tool is attached.

**Acceptance.**
(a) `loadConfig`: default `bedrock`; `RUNNER_LLM_PROVIDER=litellm` without `LITELLM_URL` throws naming it; with it the config carries
url, key and model; `RUNNER_LLM_PROVIDER=foo` throws.
(b) guard: `{ RUNNER_LLM_PROVIDER: 'litellm', LITELLM_URL, LITELLM_API_KEY, LITELLM_MODEL }` passes; the same three names without the
switch are refused (the existing forbidden-family test keeps `LITELLM_URL`); `LITELLM_OTHER` is refused even with the switch.
(c) `withModelName`: the inner provider receives `modelConfig.name === name` with the other `modelConfig` fields and the rest of the
agent unchanged, and its result is returned as is; `createModelProvider` for `bedrock` returns an object with only `getCompletion`.
(d) `GET /catalog` without a token 401; with the token and a fake VIC catalog of version `v1`, `{ version: 'v1' }`; after a `/chat`
carrying `x-tool-catalog-version: v2` while the fake VIC serves `v2`, `{ version: 'v2' }`.
(e) With `RUNNER_LLM_PROVIDER=litellm LITELLM_URL=http://127.0.0.1:9` the runner starts and `/health` is 200 (no model call at startup).

**Verify.** as V9: `pnpm --filter @agentic-commerce/jaf-runner typecheck && pnpm --filter @agentic-commerce/jaf-runner test`.

### I5. End-to-end smoke

**Changes.** `vic:scripts/smoke-split.sh` running against a local VIC (`pnpm --filter @agentic-commerce/vic dev`) and runner
(`pnpm --filter @agentic-commerce/jaf-runner dev`) in **local mode** (D12): no Ardra, `SMOKE_HOST` equal to VIC's
`GATEWAY_INTERNAL_HOST` (a name that resolves nowhere, e.g. `vic.internal.test`), the LLM through the runner's LiteLLM path (V18).
Each process has its own env file: `JAF/.env` for VIC, `jaf-runner/.env` for the runner (never `JAF/.env`: the I4 guard refuses its
keys). Minimum env, nothing else needed (the loop's 2026-10-31 run started both with `env -i` and these):
- VIC: `JAF_PORT=3001`, `VIC_TOOLS_PORT=3002`, `SANDBOX_URL=http://127.0.0.1:3101`, `SANDBOX_SERVICE_TOKEN=<random>`,
  `VIC_SERVICE_TOKEN=<random>`, `GATEWAY_INTERNAL_HOST=vic.internal.test`.
- runner: `RUNNER_PORT=3101`, `RUNNER_SERVICE_TOKEN=<VIC's SANDBOX_SERVICE_TOKEN>`, `VIC_TOOLS_URL=http://127.0.0.1:3002/tools`,
  `VIC_SERVICE_TOKEN=<VIC's>`, `RUNNER_LLM_PROVIDER=litellm`, `LITELLM_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL` (tool-calling model).
  `LANGFUSE_*` optional (the runner only warns).
- script: `VIC_URL`, `RUNNER_URL`, `VIC_TOOLS_URL`, `RUNNER_SERVICE_TOKEN`, `VIC_SERVICE_TOKEN` (step 5 reads VIC's `/tools`),
  `SMOKE_HOST`, `VIC_LOG`, `RUNNER_LOG`.
Steps:
1. `/health` on both.
2. Non-stream `/chat` to `PreDiscoveryAgent` with a greeting → 200, JSON shape identical to today (compare keys).
3. Stream `/chat` → events include `stream_start` … `run_end` … `stream_end`; transcript stored (second turn replays it).
4. A tool-calling turn → the VIC log shows `/tools/:id/call` and the model's answer reflects the result. Default
   `SMOKE_TOOL_AGENT=IdoSellAgent`, `SMOKE_TOOL_PROMPT` a catalog search: the IdoSell MCP endpoint has a public default and the
   search needs no credential, merchant list or browser. Korio stays selectable but needs Playwright's chromium installed for VIC.
5. Catalog change, checked by version (a VIC-only tool is picked by no agent, so `/agents` cannot show it): record VIC's `/tools`
   version (`SMOKE_CATALOG_VERSION_BEFORE`), add a dummy tool module to VIC (one file exporting one tool, listed in
   `TOOL_MODULES`), restart VIC only, then the script asserts: VIC's `/tools` version differs from the recorded one and lists
   `SMOKE_NEW_TOOL`; `/chat` is 200; the runner's `/catalog` (V18) now reports VIC's new version. Remove the dummy tool afterwards.
6. I4 guard and V7 context assertions re-run in this environment.
7. A Shopify MCP turn with a merchant switch (V16): the VIC log shows the patch and the next tool call uses the new merchant.
   Staging only: the merchant list comes from Ardra (`getDiscoveryMerchantsForPrompt` when `context.multiRegionSupportEnabled`),
   and Shopify's tools derive `catalogUrl` from it, so local mode cannot run it. The script prints SKIPPED unless `SMOKE_HOST` is a
   staging Ardra host with `SMOKE_SESSION_ID`; the ledger records it as a human follow-up. V16's unit tests cover the patch path.
GENIUS agents (`AnalyticsOrchestratorAgent` and its sub-agents) are out of scope for the smoke until section 8.1 is done (D9).
Record the outputs in the ledger Notes, step 7 as not run locally. Acceptance: steps 1–6 pass in local mode with `outcome.status`
`completed` in steps 2–4.

---

## 6. Decisions

| ID | Decision | Default used by this plan | Who decides |
|---|---|---|---|
| D1 | Where the full transcript lives | VIC-owned Redis (`REDIS_URL`), in-memory for local dev. Ardra keeps receiving USER/SYSTEM text via `sendChatMessageAsync`. | user |
| D2 | In-cluster auth bypass (`isInternalCall`) | Kept at the gateway only, enabled by `GATEWAY_INTERNAL_HOST` (default: the current `agentic-commerce.ardra.svc.cluster.local`). Never on the sandbox. Confirmed 2026-10-31: the Host-header match stays exactly as today; no hardening in this plan. The header is client-controlled (nginx forwards `Host $host`), so a shared-secret header for in-cluster callers is a possible follow-up outside this plan. | user (decided 2026-10-31) |
| D3 | Which agents get the Bash tool | None by default. | user |
| D4 | LLM credentials in the sandbox | Bedrock called directly from the sandbox with AWS credentials (as today). Routing via LiteLLM in VIC is a later change. Amended 2026-10-31 (V18): for local development and the I5 smoke the runner may call a LiteLLM endpoint instead (`RUNNER_LLM_PROVIDER=litellm` with `LITELLM_URL`/`LITELLM_API_KEY`/`LITELLM_MODEL`, the three then exempt from the I4 guard). Production is unchanged: the switch defaults to `bedrock` and the I3 manifests never set it. | user |
| D5 | How VIC obtains the library | pnpm git-hosted dependency on a pushed commit of `feat/vic-sandbox-split` (`github:xynehq/jaf#<sha>` plus the `onlyBuiltDependencies` entry), built at install by `prepare`. npm publish is optional (J8). Verified 2026-10-30 against fc18c84 with pnpm 10.34.9; the repo is public, so no credentials are needed. | user (decided 2026-10-30) |
| D6 | A `/chat` context missing `sessionId`, `conversationId` or `referenceId` | Run as today, never reject: `SandboxContextSchema` makes the three ids optional (2.5); when the app sent no conversationId the gateway mints `conv-<uuid>` for the run, keeps no transcript and sends no Ardra USER/SYSTEM message (today JAF mints one and the Ardra calls are skipped); `authenticateRequest` gets `null` for a missing id. Implemented by V14. Plan v8: each of the three pre-split uses keeps its own source field (history by the top-level id, Ardra messages by the context id), see the V15 table. | user (decided 2026-10-31) |
| D7 | Lossy tool schemas in the sandbox (V3 carry-forward) | Option (a): make jaf's `zodSchemaToJsonSchema` / `jsonSchemaToZod` lossless for the VIC catalog (J10) and gate V10 on it; the stubs must accept everything the real zod schema accepts, VIC re-validates on `/tools/:id/call`. Option (b), shipping the placeholder stubs, was rejected because `update_cart_empik` and numeric `.default()` fields would fail in the sandbox. | user (decided 2026-10-31) |
| D8 | Shopify MCP per-run state between agent and tools | Option (a), VIC-side: tools derive merchant values from the merchant id and VIC's merchant list; the tool server persists an allow-list of five keys a tool sets into the run record and returns them as `metadata.contextPatch`; the runner applies the patch to its request context. The sandbox never sends merchant values to VIC. Task V16; V10 depends on it. Amended 2026-10-31 after V16: the Shopify agent reads the run's saved merchant before the app's (V10 step 6), so prompt and tools stay in step after an in-run switch. Before the split both silently reverted to the app's merchant at the next model call; reproducing that would need a sandbox-to-VIC merchant channel, which D8 excludes, and the alternative (agent unchanged) leaves prompt and tools on different merchants. | user (decided 2026-10-31) |
| D9 | GENIUS (orchestrator and agents-as-tools) gaps found while reviewing V10 | Deferred to section 8.1, to be picked up with the next GENIUS change after the split is complete. Until then the GENIUS agents move with the rest but are not expected to work in the sandbox; I5 excludes them. | user (decided 2026-10-31) |
| D10 | Transcript key not bound to the session (V15 review) | Deferred to section 8.2: Redis is not in use yet, so the store is per pod as before the split. Revisit when Redis is adopted. | user (decided 2026-10-31) |
| D11 | Prompts that read VIC-process state (Tortli cart, IdoSell URL) | Tortli: VIC computes the cart summary; the gateway seeds it per request in `context.toolState` and Tortli tools refresh it through V16's `contextPatch`, so every model call's prompt shows the live cart as today. IdoSell: the endpoint constants move to vic-shared and `IDOSELL_MCP_ENDPOINT` joins the runner env (same default), rather than reading the merchant list, whose `websiteUrl` need not equal the MCP origin. Task V17; V10 depends on it. | user (decided 2026-10-31) |
| D12 | Smoke (I5) scope on the developer machine | Local mode: the `GATEWAY_INTERNAL_HOST` bypass instead of a staging Ardra session; step 4 through `IdoSellAgent` (public MCP endpoint, no credential or browser) instead of Korio; step 5 proves the no-restart tool discovery by catalog version (VIC `/tools` before and after, runner `/catalog` after the `/chat`) rather than by `/agents`, which lists only tools an agent picks; step 7 (Shopify merchant switch) needs Ardra's merchant list and stays a staging-only human step; the runner keeps its own env file. | user (decided 2026-10-31) |

---

## 7. Plan change log

| plan_version | date | change |
|---|---|---|
| 1 | 2026-10-30 | Initial plan: 5 library tasks, 13 VIC tasks, 5 infra tasks. |
| 2 | 2026-10-30 | Section 3.6: how to run the loop from the VS Code extension; `--add-dir` is optional and CLI-only. |
| 3 | 2026-10-30 | Added J6 (tracing init race found in V1); V1 re-queued as `todo` depending on J6; J5 depends on J6. Folded reviewer follow-ups into J3 (no headers in errors), J4 (no zod `instanceof`), J5 (server re-exports, tracing docs), V9 (use J6 helpers, flush on SIGTERM). J6 is ordered before J3 so V1 can resume while J3 runs. |
| 4 | 2026-10-30 | J5 found `dist/` unloadable by plain Node (pre-existing, also in published 0.1.46). Decision (b): added J7 (native ESM build, missing subpath index files, no runtime `require`), J5 re-queued on J7 with the human publish procedure; V9 states the runner module format. |
| 5 | 2026-10-30 | J5: release is performed by an npm org owner from the pushed branch; plan owner has no publish rights. |
| 6 | 2026-10-30 | D5: VIC consumes the library from GitHub (V13 rewritten), npm publish moved to optional human-only J8, J5 done criterion = reviewed and pushed. Added J9 (compatibility with VIC's pnpm overrides, which `link:` did not apply but a git dependency does; exclude `src/test-utils` from dist). I1 notes the builder needs HTTPS to codeload.github.com. |
| 7 | 2026-10-31 | D2 confirmed as is (no Host-header hardening in this plan). D6: a context missing sessionId/conversationId/referenceId runs as today instead of V7's 400; 2.5 makes the ids optional, 2.2 states the gateway always sends a conversationId; added V14 (ledger after V8, depends on V7) and a V10 note. |
| 8 | 2026-10-31 | D7: added J10 (lossless schema conversion, jaf); V10 back to `todo` depending on J10, acceptance gains the zero-placeholder catalog check. V15 added (conversationId source parity, depends on V14); 2.2 and D6 amended. I2 spec and notes: keep `Host` handling as today (D2). |
| 9 | 2026-10-31 | D8: added V16 (run-scoped tool state for Shopify MCP); V10 back to `todo` depending on V16, steps 6–7 added; 2.4 `metadata.contextPatch` and 2.6 `toolState`. D9/D10: new section 8 (deferred follow-ups, not in the ledger) holds the GENIUS orchestrator items and the transcript-key scoping; I5 excludes GENIUS. |
| 10 | 2026-10-31 | D8 amended from the V16 report: the Shopify agent reads the run's saved merchant first (V10 step 6 rewritten, test added). |
| 11 | 2026-10-31 | D11: added V17 (Tortli cart summary seeded per request and refreshed via contextPatch; IdoSell constants in vic-shared, `IDOSELL_MCP_ENDPOINT` in the runner env); V10 back to `todo` depending on V17, steps 8–9 added; 2.5 `toolState`, 2.6 `tortliCartSummary`; I4 env list. |
| 12 | 2026-10-31 | I5 unblocked: D4 amended (LiteLLM in the runner for local development), D12 (local smoke mode; IdoSell for step 4; catalog version for step 5; step 7 staging-only); added V18 (`RUNNER_LLM_PROVIDER`, `GET /catalog`); I5 spec gains the minimum env and depends on V18; I4 env list and guard note. |

---

## 8. Deferred follow-ups (not in the ledger; the loop never picks from here)

Items the owner has decided to do after the split is complete. Each is written so it can be turned into a ledger task
later by copying it into section 5 and adding a row. Nothing in sections 4–5 depends on them.

### 8.1 GENIUS: orchestrator and agents-as-tools (D9; pick up with the next GENIUS change)

Found while reviewing V10 against `vic:JAF/src/agents/analyticsOrchestratorAgent.ts`, `allAnalyticsOrchestratorSubAgents.ts`,
`tools/agentsAsTools/analyticsOrchestratorAgentSubAgents.ts` and jaf `src/core/agent-as-tool.ts`. What already works: the
sub-agent runs in the runner process through `run()`, inherits the parent context (so the tool server's conversationId
check passes), its catalog stubs read the run token from the request context the child shares, every sub-agent tool
including `qApiCall` has its own catalog module, and events reach the trace collector. Until these items are done the
GENIUS agents are not expected to work in the sandbox.

- **G1 (jaf, server).** `src/server/server.ts` streaming loop (near line 563) breaks on the first `run_end`; `agentAsTool`
  (`propagateEvents: 'summary'`) forwards the child's `run_end`, so a streamed run ends when the first sub-agent finishes.
  Pre-existing. Fix: break only when `event.data.runId === runId`; still forward child `run_end` events. Test: a streaming
  parent with one agentAsTool child yields two `run_end` events and the stream ends after the parent's.
- **G2 (VIC, gateway).** `relayStream` stores the transcript and sends SYSTEM on every `run_end`; with sub-agents the
  child's `finalState.messages` replaces the conversation transcript and, until G1, the parent's never arrives (history
  corruption on the next turn; today the parent's background completion still wrote the right memory). Fix: capture
  `stream_start.data.runId`; store and send SYSTEM only for the `run_end` with that `runId`; keep stripping `finalState` from
  all of them. Decide at the same time the V15 reviewer's note: streams with only a top-level conversationId now send
  SYSTEM under it, where the pre-split onEvent sent it only under the context id.
- **G3 (VIC, runner).** `jaf-runner/src/app.ts` preHandler sets `business-id` / `user-id` only; today's server also set
  `businessId` / `userId`, which `prompts/jusbizAnalyticsPrompt.ts` reads. Set both spellings.
- **G4 (jaf, agent-as-tool).** `AnalyticsAgent` uses `memoryMode: 'inherit'`: today the child loaded the stored conversation
  (previous turns, `memory.maxMessages`) ahead of its input; the runner has no memory provider, so the child sees only the
  orchestrator's input. Option: when `memoryMode === 'inherit'` and `!parentConfig.memory?.provider`, seed
  `childState.messages` with the parent's messages up to and including the last user message, then the input. Or accept.
- **G5 (VIC, env).** Add `GENIUS_MODEL` to the sandbox variables in I4 (15 reads in the agents; it matches none of the
  `*_BEDROCK_MODEL` / `*_MAX_TOKENS` patterns). `LITELLM_MODEL` appears only in a comment.

### 8.2 Other deferred items

- **T1 (VIC, gateway; D10).** The transcript key is the client-chosen conversationId and is never bound to the authenticated
  session, so a session can overwrite another conversation's history by sending its id. Same class as before the split
  while the store is in-memory per pod; wider with shared Redis. When Redis is adopted: prefix the key with the
  authenticated business and user ids, or require the top-level id to equal the context id when both are present.
- **T2 (VIC, nginx; D2).** Host-header bypass hardening (fixed Host or dedicated internal listener), see I2 Notes.
