# VIC / JAF Sandbox Split: Implementation Plan

```
plan_version: 6
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

### 2.5 SandboxContext

`SandboxContextSchema = AgentContextSchema.omit({ password, davv, token, cardBin, cardLastFour, expiry,
paymentReference, paymentCurrency, paymentInstrument }).extend({ availableMerchants: z.array(AvailableMerchantSchema).optional() })`

Everything a tool needs but a prompt does not stays in VIC and is resolved from the run token.

### 2.6 Run record (VIC-internal, keyed by run token)

```ts
type RunRecord = {
  conversationId: string; agentName: string; requestId: string;
  context: AgentContext;                 // full, as sanitized by sanitizeAgentContext
  requestContext: RequestContext;        // turing: x-request-id, external-request-id, flow-id, flow-type, path, method, host, business-id, user-id, message-number
  contextValues: { sessionId?: string; authToken?: string; businessId?: string; userId?: string; geniusEnabled?: boolean;
                   availableMerchants?: AvailableMerchant[]; xModule: string; xFeature?: string; isStreaming: boolean };
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
| J9 | jaf | 5 | Compatibility with VIC's pnpm overrides (fastify 5, cors 11, uuid 11, mathjs 15); exclude test-utils from dist | J5 | in_progress | |
| J8 | jaf | 5 | npm publish 0.2.0 by an npm org owner (optional) | J5 | blocked | human-only, nothing depends on it; procedure in the J5 spec; the human sets `done` with version and dist-tag |
| V1 | agentic-commerce | 2 | Dependency: `@xynehq/jaf@0.1.18` → linked `@juspay-jaf/jaf` | J6 | done | commit 67ae193b (code) + this commit (verification), review: 2 rounds, APPROVE (r1 REQUEST_CHANGES: finalState leak fixed in onEvent; OTEL race fixed upstream by J6). Link kept (pnpm ls: single zod 3.25.76). JAF/tsconfig moved to module preserve / moduleResolution bundler (jaf is type:module with extensionless .d.ts re-exports; tsx-only runtime). Step 4: tracer initialized after buffering, one /chat -> one OTLP POST (4286 B) to a 127.0.0.1 recorder; Bedrock call failed on an invalid local AWS token (spans still exported). Carry forward, non-blocking: link bypasses root fastify/@fastify/cors overrides (jaf ships fastify 4.29.1, cors 9.0.1), jaf bump needed before V13; two physical zod copies (no instanceof in J4/V3); Docker image unbuildable until V13; tsc emit now ESM (unused). See V7 Notes for two gateway requirements found in review. |
| V2 | agentic-commerce | 2 | `shared` package: types, context schemas, prompt helpers, contracts, logger | V1 | done | commit f71bf788, review: 2 rounds, APPROVE (r1 blocking: AvailableMerchantSchema.merchantId was nativeEnum, real Ardra ids are any non-empty string; now z.custom<MerchantId> non-empty string). Deviations: kms moves all 4 functions (decryptKms needs decryptKmsWithRegion); findMerchant and DiscoveryMerchantPromptMeta now exported; logger gets a ReturnType<typeof createLogger> annotation (TS4094); AvailableMerchantSchema is new; RunRecordSchema.context is AgentContextSchema.partial() (V7 stores sanitizeAgentContext output), not 2.6's full AgentContext; ToolCatalogSchema has a unique-id .refine (ZodEffects: no .shape/.extend for V3/V4/V9); needsApproval optional in the entry schema (V3 should always emit it). shared is CJS built to dist like turing; root typecheck builds it (stale shared/dist runs stale code under tsx). JAF/src/types.ts shim now has import side effects (logger, kms client). Sandbox env needs DEFAULT_ADDRESS if prompts use withDefaultAddress (I4/V9). Lockfile: transitive @types/node re-resolved to 24.19.2 (dedupe side effect). V12 should drop the shims. |
| V3 | agentic-commerce | 2 | Tool registry and catalog | V2, J4 | done | commit `V3:` (git log --grep '^V3:'), review: 1 round, APPROVE. 136 entries from 37 modules, version 86521328b53ae93e, 0 needsApproval. tools/tools.ts excluded (barrel re-exporting wildHoney tool objects; including it duplicates them and adds 3 colliding names); a test enforces registered iff a module exports a tool. dump-catalog.ts takes an optional outFile (tool modules log to stdout while loading). Verify glob must be quoted from the repo root under zsh. CARRY-FORWARD, blocks V10/I5 (human/plan decision): jaf zodSchemaToJsonSchema emits 'Unsupported schema type' string placeholders for 61 fields in 39 tools (ZodDefault, ZodEffects, ZodNullable, ZodNativeEnum, ZodUnion, ZodLiteral, ZodAny, ZodPipeline); VIC's bedrock converter today yields 30. Behind J3 stubs: empikShoppingTools.update_cart_empik.items (required, ZodEffects over array) rejects every call; numeric quantity/limit fields with .default() are rejected. Needs a new J task extending zodSchemaToJsonSchema and jsonSchemaToZod symmetrically, plus a zero-placeholder test over the real catalog, before V10. Non-blocking: getCatalog() returns a shared mutable object (consider freezing); unquoted ** in the test script only matches one directory level under sh. Pre-existing, for V4/I4: deliverooShoppingTools.login_user takes password as an LLM argument, so it transits the sandbox and /tools/:id/call args. jaf dist at verification time included J7 work in progress. |
| V5 | agentic-commerce | 2 | Run-token store | V2 | done | commit `V5:` (git log --grep '^V5:'), review: 1 round, APPROVE. ioredis ^5.11.1. Beyond spec: SET ... PX ttl NX with 3 token retries, positive-integer ttl guard, frozen records, Redis reads validated with RunRecordSchema (invalid -> null), lazyConnect, injectable RunStoreRedisClient. Redis path tested only against an in-test fake (no Redis/Docker on the dev machine). Non-blocking: no 'error' listener on the ioredis client (reconnect errors go to console.error; a dead Redis stalls create/get ~10 s before rejecting); RunStore has no close(); freeze is shallow and in-memory get returns the shared object; Redis path also checks expiresAt against the reading pod's clock (fail-closed); no token format pre-check. |
| V6 | agentic-commerce | 2 | Transcript store | V2 | done | commit `V6:` (git log --grep '^V6:'), review: 1 round, APPROVE. LRU over reads and writes via Map order (matches jaf lastActivity eviction); Redis SET EX, TTL refreshed on set only; reads shape-checked (invalid -> [] with an ERROR log naming only the id); env limits fail fast. No per-conversation message cap in the store (provider's cap only applied in appendMessages, which the engine never calls; today's real bound is memory.maxMessages 50 at load). Redis path tested only with a fake. Non-blocking: in-memory freeze is shallow (nested tool_calls/content/attachments mutable; Redis clones per read); read schema looser than jaf fullMessageSchema and set does not validate; undefined keys survive in-memory but not JSON; concurrent turns on one conversation are last-write-wins. Only the snapshot comment was corrected after review. |
| V4 | agentic-commerce | 3 | Tool server routes | V3, V5 | done | commit `V4:` (git log --grep '^V4:'), review: 1 round, APPROVE. fastify ^5.12.7 added as a direct JAF dependency. createToolServer also takes host/serviceToken/toolTimeoutMs/tools (injectable lookup for tests, defaults to the V3 registry); throws without VIC_SERVICE_TOKEN. Per call: copies of requestContext/contextValues into the ALS store, structuredClone(record.context); on timeout the tool keeps running in the background (no AbortSignal in JAF tools). Non-blocking: TOOL_CALL log lines are emitted outside withContext (request ids NULL in logs); setContextValue copy is shallow (availableMerchants array shared, no tool mutates it); If-None-Match is an exact compare (the J3 stub never sends it). |
| V7 | agentic-commerce | 3 | Gateway `/chat` | V3, V5, V6, J1 | in_progress | From V1 review r2: (1) the app-facing SSE run_end now carries data.finalState (full context incl. card/password and the transcript): the gateway must strip finalState before forwarding to the app while storing finalState.messages; (2) after J1, client-supplied assistant tool_calls / tool messages plus approvals make the engine execute tools before any model call: the gateway must accept from the app only the new user message (and approvals checked against VIC-owned pending interruptions), never app-supplied tool or tool_calls messages. (3) from V2: toSandboxContext throws a ZodError when sessionId, conversationId or referenceId is missing (2.5 keeps them required; today such requests run): catch it and answer 400, not 500. (4) from V5: map run-store errors to 503 (not 500); populate only the 2.6 contextValues keys (Redis strips unknown keys, in-memory keeps them). (5) from V6: bound replayed history at a user-message boundary (whole turns, default ~50 messages like today's memory.maxMessages) so tool_calls stay paired; validate data.messages per role against jaf fullMessageSchema before transcriptStore.set (a bad stored transcript would 400 every later turn); consider per-conversation serialization (last write wins); keep conversationId bound to the authenticated session (no tenant scoping in the store). (6) from V4: populate requestContext.host, x-request-id and external-request-id in the run record as createJAFRequestContext does today (isInternalCall and other tools read getContextValue('host')); delete the run token when /chat ends (as specified). |
| V8 | agentic-commerce | 3 | VIC bootstrap: replace `JAF/src/server.ts` | V4, V7 | todo | From V5: add an ioredis 'error' listener that logs only e.message via jafLog, consider tighter maxRetriesPerRequest/connectTimeout for the gateway budget, and close the run store (sweep timer, Redis quit) on shutdown (RunStore has no close() yet). Same for the transcript store (V6): error listener, close/quit on shutdown. From V4: add app.setErrorHandler on the tool server with a generic body (503 for run-store failures, 500 otherwise) and log e.message via jafLog; today Fastify's default 500 echoes e.g. 'connect ECONNREFUSED <redis host:port>' and the J3 stub forwards that body to the model; also covers non-serialisable tool results. Body parsing runs before the token check (unauthenticated 400/413/415/414); add a preParsing auth hook if wanted. |
| V9 | agentic-commerce | 4 | `jaf-runner` package scaffold | V2, J2, J3 | todo | From V4: the J3 stub's default timeoutMs (120 s) is below VIC_TOOL_TIMEOUT_MS (180 s); set the stub timeout above VIC's, or the stub gives up while VIC still runs the tool. |
| V10 | agentic-commerce | 4 | Migrate agents and prompts to the runner | V9, V3 | todo | From V3: do not start until jaf zodSchemaToJsonSchema/jsonSchemaToZod are lossless for the catalog (see V3 Notes); needs a new J task (human/plan decision). |
| V11 | agentic-commerce | 4 | Bash tool in the runner | V9 | todo | attach to agents: human decision, see D3 |
| V12 | agentic-commerce | 5 | Clean `vic:JAF/` of runtime code | V8, V10 | todo | |
| V13 | agentic-commerce | 5 | Switch to the library's GitHub commit (git-hosted dependency) | J5, J9, V10, V11 | todo | |
| I1 | agentic-commerce | 6 | Dockerfile: `vic` and `sandbox` targets | V8, V9 | todo | From V2: the vic image must build shared (pnpm --filter @agentic-commerce/vic-shared run build) and copy shared/dist + shared/node_modules, since JAF resolves it via dist; keep pnpm symlinks so turing stays a single instance (findMerchant reads turing ALS through shared). |
| I2 | agentic-commerce | 6 | nginx and start script | V8 | todo | |
| I4 | agentic-commerce | 6 | Environment split and secret guard | V8, V9 | todo | From V6: Redis holding vic:transcript:* is VIC-only; transcripts keep tool_call arguments for TRANSCRIPT_TTL_S (e.g. deliverooShoppingTools.login_user password), consider redaction. |
| I3 | agentic-commerce | 6 | Build pipeline and deployment manifests | I1 | todo | k8s apply is human |
| I5 | agentic-commerce | 6 | End-to-end smoke | V12, V13, I1, I2, I4 | todo | |

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

**Acceptance.** `jaf-runner` typecheck passes; startup against the real VIC `/tools` (V8 running) succeeds with the same agent
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

**Changes.** `vic:nginx.conf`: `/` keeps proxying to 3001 (now the gateway); add `location /tools { return 404; }` and
`location /conversations { return 404; }` and `location /approvals { return 404; }` as defence in depth; keep the SSE-relevant
timeouts. `start.sh` (generated in the Dockerfile) no longer starts JAF.

**Acceptance.** nginx config test passes (`nginx -t` in the image); `/tools` through nginx is 404 while `:3002/tools` inside the pod works.

### I4. Environment split and secret guard

**Changes.**
- `vic:JAF/.env.example`: every variable VIC needs (merchant, MCP, AXS, Shopify, Obenan, QAPI, LiteLLM, KMS, proxy, `REDIS_URL`,
  `SANDBOX_URL`, `SANDBOX_SERVICE_TOKEN`, `VIC_SERVICE_TOKEN`, `VIC_TOOLS_PORT`, `RUN_TOKEN_TTL_MS`, `VIC_TOOL_TIMEOUT_MS`, `TRANSCRIPT_*`).
- `vic:jaf-runner/.env.example`: `RUNNER_PORT`, `RUNNER_SERVICE_TOKEN`, `VIC_TOOLS_URL`, `VIC_SERVICE_TOKEN`, `BEDROCK_*`, every
  `*_BEDROCK_MODEL` and `*_MAX_TOKENS`, `AWS_REGION`, `LANGFUSE_*`, `KMS_ENCRYPTED_LANGFUSE`, `ADDITIONAL_ALLOWED_FIELDS_JAF`,
  `BASH_*`. No `HTTP_PROXY`/`HTTPS_PROXY`.
- Runner startup guard (`vic:jaf-runner/src/envGuard.ts`): refuse to start if any variable matching
  `/_CLIENT_SECRET$|_BEARER_TOKEN$|_API_KEY$|^SHOPIFY_UCP_|^AXS_|^OBENAN_|^QAPI_|^LITELLM_|^HTTPS?_PROXY$/` is set, except `LITELLM_*` is
  allowed only if decision D4 routes the LLM through LiteLLM. Print the offending names, never the values.

**Acceptance.** Test: guard throws for `OBENAN_BEARER_TOKEN=x`; passes for a clean environment.

### I3. Build pipeline and deployment manifests

**Changes.** `vic:Makefile`: `build` builds `--target vic`; add `build-sandbox`/`push-sandbox` with `IMAGE_NAME=agentic-commerce-sandbox`
and `--target sandbox`; `release` builds and pushes both. `vic:Jenkinsfile`: build and push both images in the existing stages.
Add `vic:deploy/sandbox/` with example `Deployment`, `Service` and `NetworkPolicy` manifests: ingress only from pods labelled
as VIC; egress only to the Bedrock endpoints, the VIC tool-server Service, the Langfuse host and DNS; `readOnlyRootFilesystem: true`;
`emptyDir` at `/workspace`; `runtimeClassName` placeholder for gVisor. The real deploy repo is outside this plan: applying
manifests is a **human** step; set `review` with the note "manifests ready" when done.

### I5. End-to-end smoke

**Changes.** `vic:scripts/smoke-split.sh` running against a local VIC (`pnpm --filter @agentic-commerce/vic dev`) and runner
(`pnpm --filter @agentic-commerce/jaf-runner dev`) with the staging Ardra and Bedrock credentials from the developer's `.env`:
1. `/health` on both.
2. Non-stream `/chat` to `PreDiscoveryAgent` with a greeting → 200, JSON shape identical to today (compare keys).
3. Stream `/chat` → events include `stream_start` … `run_end` … `stream_end`; transcript stored (second turn replays it).
4. A tool-calling turn (e.g. a Korio search) → the VIC log shows `/tools/:id/call` and the model's answer reflects the result.
5. Catalog change: add a dummy tool file, restart VIC only, send `/chat` → runner log shows one re-fetch and `/agents` lists the new tool.
6. I4 guard and V7 context assertions re-run in this environment.
Record the outputs in the ledger Notes.

---

## 6. Decisions

| ID | Decision | Default used by this plan | Who decides |
|---|---|---|---|
| D1 | Where the full transcript lives | VIC-owned Redis (`REDIS_URL`), in-memory for local dev. Ardra keeps receiving USER/SYSTEM text via `sendChatMessageAsync`. | user |
| D2 | In-cluster auth bypass (`isInternalCall`) | Kept at the gateway only, enabled by `GATEWAY_INTERNAL_HOST` (default: the current `agentic-commerce.ardra.svc.cluster.local`). Never on the sandbox. | user |
| D3 | Which agents get the Bash tool | None by default. | user |
| D4 | LLM credentials in the sandbox | Bedrock called directly from the sandbox with AWS credentials (as today). Routing via LiteLLM in VIC is a later change. | user |
| D5 | How VIC obtains the library | pnpm git-hosted dependency on a pushed commit of `feat/vic-sandbox-split` (`github:xynehq/jaf#<sha>` plus the `onlyBuiltDependencies` entry), built at install by `prepare`. npm publish is optional (J8). Verified 2026-10-30 against fc18c84 with pnpm 10.34.9; the repo is public, so no credentials are needed. | user (decided 2026-10-30) |

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
