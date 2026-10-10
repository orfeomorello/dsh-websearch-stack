# dsh Plugin Development Guide

> **Audience**: LLMs and developers writing plugins for DeepSeek Harness (dsh).
> **Sources, in order of authority**: (1) the installed type definitions in this repository's `node_modules` — `@deepseek-ai/cordis` 4.0.2 and `@deepseek-ai/dsh-llm` 0.1.5-rc.3; (2) the official repository's own `docs/` tree and package READMEs (`deepseek-ai/deepseek-harness`, `master`); (3) analysis of production plugins ([dsh-localforge](https://github.com/orfeomorello/dsh-localforge), [dsh-vision-router](https://github.com/ysr666/dsh-vision-router)).
>
> **Not authoritative**: community sites and generated documentation sites (`deepseek-harness.github.io`, `dsh.so`, `dsh-plugin.org`) could not be checked against the repository while this revision was written, and they drift. See [the closing note](#note-on-unpinned-community-sources).

## Using this guide with an LLM

This document is written to be **handed to a coding agent**. Paste it (or its URL) into the context and ask for the plugin you want. It is long on purpose: the failure modes it prevents are not guessable, and an LLM working from the type definitions alone will produce code that compiles, loads, and then misbehaves in one of the ways §24 catalogues.

A prompt that works well:

> Read this guide. Then write a dsh plugin that `<what you want>`. Follow the `[invariant]` rules exactly. Use only `[verified]` APIs as written; for anything `[unverified]`, open the installed `.d.ts` and confirm the signature before using it. Tell me which sections you relied on, and flag anything in my request that the guide says not to do.

Three habits make the difference between a useful answer and a plausible-looking one:

1. **Tell the model to read the `.d.ts` files, not just this guide.** They are on disk at `node_modules/@deepseek-ai/*/lib/**/*.d.ts` and they win every disagreement (see [How to read this guide](#how-to-read-this-guide)).
2. **Ask it to cite section numbers.** A claim with no section behind it is a guess, and this guide exists precisely so you do not have to accept guesses.
3. **Ask for the `[invariant]` checklist at the end.** §25 is a copyable review list; a model that self-checks against it catches its own disposal, cancellation and packaging mistakes before you do.

If you are the LLM reading this: the markers are not decoration. `[verified]` means you may write it as-is. `[unverified]` means **open the type definition before emitting that call** — if you cannot, say so instead of inventing a signature. `[invariant]` means never, regardless of what the user asks for.

---

## How to read this guide

Every API claim carries one of three markers. **Respect them when you generate code**, because they have different failure modes:

| Marker | Meaning | What to do |
|--------|---------|------------|
| **[verified]** | Taken from a shipped `.d.ts` in this repository's `node_modules`, or from the official docs/source at a pinned revision. | Safe to use as written. |
| **[unverified]** | Plausible and widely reported, but not confirmed against a type definition or official page during the writing of this guide. | Confirm against the installed package before shipping. Search `node_modules/@deepseek-ai/*/lib/**/*.d.ts`. |
| **[invariant]** | A rule the harness depends on. Breaking it produces confusing failures far from the bug. | Never violate. |

Cite the installed types as the last word. When this guide and `node_modules/@deepseek-ai/dsh-llm/lib/types/*.d.ts` disagree, the `.d.ts` wins.

**The single most valuable habit**: before writing a plugin, open the `.d.ts` of every `@deepseek-ai/*` package you plan to touch and read the doc comments. They are unusually complete (they encode the invariants), and they are the only source that is guaranteed to match the version the user is running.

---

## Table of Contents

- [Using this guide with an LLM](#using-this-guide-with-an-llm)
- [How to read this guide](#how-to-read-this-guide)

1. [What is dsh and the plugin architecture](#1-what-is-dsh-and-the-plugin-architecture)
2. [The three plugin forms](#2-the-three-plugin-forms)
3. [Project structure](#3-project-structure)
4. [The request pipeline: where a plugin attaches](#4-the-request-pipeline-where-a-plugin-attaches)
5. [Plugin contract: `name`, `inject`, `Config`, `apply`](#5-plugin-contract-name-inject-config-apply)
6. [Configuration with Schemastery](#6-configuration-with-schemastery)
7. [Lifecycle, effects and disposal](#7-lifecycle-effects-and-disposal)
8. [The event bus](#8-the-event-bus)
9. [Registering services](#9-registering-services)
10. [The `llm` service API](#10-the-llm-service-api)
11. [LLM adapters](#11-llm-adapters)
12. [Messages, content blocks and usage](#12-messages-content-blocks-and-usage)
13. [Streaming and SSE translation](#13-streaming-and-sse-translation)
14. [Tools](#14-tools)
15. [Model discovery](#15-model-discovery)
16. [Timeouts, cancellation and concurrency](#16-timeouts-cancellation-and-concurrency)
17. [Resilience patterns](#17-resilience-patterns)
18. [Settings, live configuration and credentials](#18-settings-live-configuration-and-credentials)
19. [Observability, logging and security](#19-observability-logging-and-security)
20. [Client-side web plugins](#20-client-side-web-plugins)
21. [Testing](#21-testing)
22. [Packaging and distribution](#22-packaging-and-distribution)
23. [Build, typecheck and CI](#23-build-typecheck-and-ci)
24. [Review: invariants and anti-patterns](#24-review-invariants-and-anti-patterns)
25. [Final checklist](#25-final-checklist)
26. [References](#26-references)

---

## 1. What is dsh and the plugin architecture

**DeepSeek Harness (dsh)** is an open-source agent harness built on an **"everything is a plugin"** architecture, powered by the [Cordis](https://github.com/cordiverse/cordis) framework. Every capability — tools, LLM adapters, file access, the agent loop, UI — is a plugin mounted into a shared context.

dsh describes itself as a **microkernel**: every product feature maps to a listener on a documented extension point, and no feature modifies the agent loop itself. That is the design constraint worth internalizing: you extend the harness by *intercepting* and *registering*, never by patching core behavior.

### Key concepts

| Concept | Description |
|---------|-------------|
| **Plugin** | TypeScript module exporting `name`, optional `inject`, optional `Config`, and an `apply(ctx, config)` body. Cordis calls it at load time. |
| **Context (`ctx`)** | Shared object through which the plugin registers capabilities (tools, adapters, events, services) and reads them. |
| **Fiber** | The plugin *instance*: owns the context, the validated config, the dependency state, and every effect. One plugin can have many fibers. |
| **Effect** | Everything registered through `ctx` — listeners, services, tools, timers you wrap yourself — and it is automatically undone when its fiber unloads. |
| **Service** | A named capability on `ctx` (e.g. `ctx.llm`, `ctx.tools`). A plugin may consume services through `inject` or provide one by extending `Service`. |
| **Bundle** | An npm package that ships a *configuration layer* (`dsh.bundle` → `cordis.patch.yml`). |
| **Profile** | A directory (`$DSH_HOME/profiles/<name>`) describing one runnable composition: an ordered list of bundles plus the user's own patch layer. |
| **Overlay/Patch** | A YAML patch that inserts or overrides plugin rows. Later layers win. |

### The two manifests, and why the distinction matters

**[verified]** From the official packaging tutorial:

- A **bundle** is what you author and distribute. Its `package.json` declares `dsh.bundle.patch`, answering *"what does this package contribute?"*.
- A **profile** is what a user boots. Its `package.json` declares `dsh.profile.bundles`, answering *"which bundles compose this setup, in order?"*.

A bundle is never a profile. A package with no `dsh.bundle` declaration still installs, but as a **plain dependency only**: `dsh plugin` prints a warning and activates no layer. That is the correct shape for a *library* that other plugin packages import.

### The layer order **[verified]**

The effective configuration composes over an empty root by applying, in order:

1. Each bundle patch named in the profile's `dsh.profile.bundles`, in list order (`@deepseek-ai/dsh-base` first).
2. The profile's own `cordis.patch.yml`.
3. The home-level `$DSH_HOME/cordis.patch.yml`.
4. Each `--patch <path>` overlay, in argv order.

Later layers win **per row**, and a patch replaces a row's entire `config` value rather than deep-merging keys. Two consequences:

- To override an earlier layer's row by `id`, you must restate **every key the row needs**, not just the changed one.
- Users can override your rows in their profile patch without touching your package, so prefer defaults users are likely to keep and let the schema carry the rest.

---

## 2. The three plugin forms

**[verified]** Cordis accepts three plugin entry shapes: a function, a class, or an object with `apply`. All three may carry `name`, `inject`, `Config`, `provide` and `intercept` metadata.

```typescript
// 1. Function form — the most common. Metadata is attached by assignment
//    (or by exporting `name`/`inject`/`Config` as module exports, which dsh
//    reads when the package is loaded as a plugin row).
export function apply(ctx: Context, config: Config): void {
  /* ... */
}
export const name = 'my-plugin'
export const inject = ['tools']
export const Config: Schema<Config> = Schema.object({ /* ... */ })

// 2. Object form — same metadata as plain fields, useful for a default export.
export default {
  name: 'my-plugin',
  inject: ['tools'],
  Config: ConfigSchema,
  apply(ctx: Context, config: Config) { /* ... */ },
}

// 3. Class form — a Service provider. `static inject` participates in the
//    same dependency resolution as the function form.
export default class MyService extends Service {
  static inject = ['llm']
  constructor(ctx: Context) {
    super(ctx, 'myService')
  }
}
```

`apply` may return a value; **the idiomatic cleanup is to return a disposer** (or to use `ctx.effect()`, see §7). Returning a disposer from `apply` is the mechanism behind "disposers run in reverse registration order" — see §7 for the exact semantics.

---

## 3. Project structure

### Essential files

```
my-dsh-plugin/
├── package.json          # npm metadata + "dsh" section
├── cordis.patch.yml      # Bundle layer (profile registration)
├── tsconfig.json         # TypeScript config (dev)
├── tsconfig.build.json   # Build config (emit only, no type check)
├── src/
│   ├── index.ts          # Entry point: apply(), name, inject, Config
│   ├── config/
│   │   └── schema.ts     # Schemastery schema
│   ├── adapter/          # LLM adapters (if applicable)
│   ├── discovery/        # Model listing, cache
│   ├── streaming/        # Serialization + SSE translation
│   ├── lifecycle/        # Semaphore, fallback, retry
│   ├── observability/    # Metrics, health check, logging
│   └── types/            # Wire types (request/response)
├── lib/                  # BUILT output — commit it (see §22)
├── test/                 # Unit and integration tests
└── README.md
```

### Minimal package.json

```json
{
  "name": "dsh-my-plugin",
  "version": "0.1.0",
  "description": "dsh plugin: <what it does>",
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./package.json": "./package.json"
  },
  "license": "MIT",
  "keywords": ["dsh", "dsh-plugin"],
  "engines": { "node": ">=22.19.0" },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "files": ["lib", "src", "cordis.patch.yml", "README.md", "LICENSE"],
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "lint": "eslint src test",
    "build": "node scripts/build.mjs",
    "prepublishOnly": "npm run typecheck && npm run test && npm run lint"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": ">=4.0.2 <5.0.0",
    "@deepseek-ai/dsh-llm": ">=0.1.5-rc.3 <1.0.0"
  },
  "peerDependenciesMeta": {
    "@deepseek-ai/cordis": { "optional": true },
    "@deepseek-ai/dsh-llm": { "optional": true }
  }
}
```

### Peer dependencies: the `@deepseek-ai` packages are the host's, not yours

**[verified]** A linked checkout keeps its own `node_modules`, and the plugin must share *instances* with the host — otherwise `ctx.llm` registered by your copy is not the `ctx.llm` the host reads. This is not a theoretical concern; §22 documents the exact `Symbol()`-identity failure it causes (every tool call breaks while chat keeps working).

The rule the harness itself follows:

- Every dsh package whose **instances** your plugin must share with the host goes in **both `peerDependencies` and `devDependencies`**. The peer range is what the running host satisfies; the dev copy serves your type checker, your editor, and your standalone tests.
- Independently versioned third-party libraries and stateless dsh utilities (pure functions, no service identity) go in `dependencies`.
- Marking the peer optional (`peerDependenciesMeta`) is appropriate when your plugin genuinely works without it — for example an adapter that degrades to text-only when `@deepseek-ai/dsh-attachment` is absent. Live plugins do exactly this.

**[verified]** What the host actually enforces at load time: dsh checks **`peerDependencies` whose names are `@deepseek-ai/dsh` or `@deepseek-ai/dsh-*`** against the running dsh version, and every declared range must match. Prereleases participate in range matching. A missing dsh peer imposes **no** constraint, and an invalid range is treated as incompatible. A denied row is turned into a `disabled: true` row and its module is **never imported**; a denied bundle is skipped.

Two consequences:

- **`engines.dsh` is not the mechanism** and is not enforced — do not rely on it for compatibility.
- **`@deepseek-ai/cordis` is not covered by that check.** Declare it as a peer with an explicit range anyway (`~4.0.4` for the 0.2.x line, or a range matching the host generation you target) so a duplicate instance is at least visible in the dependency graph.

Resolution order for a linked package follows Node's ancestor rules; a nearer physical package wins before a higher peer declaration. Overlapping external links do not change lookup order, because each request starts from its importer's directory. And remember: **your `devDependencies` are not available at runtime** — a package you import at runtime must be in `dependencies` or satisfied as a peer.

### cordis.patch.yml

**[verified]** The patch is a YAML array. Rows reference the installed package **by name** (not by relative source path), so Node resolution finds the code:

```yaml
- insert:
    - id: my-plugin
      name: dsh-my-plugin
```

Notes:

- `patch` also accepts an **ordered list of files**: `["./base.patch.yml", "./web.patch.yml"]`. The launcher applies them in that order as one layer, and each file's relative plugin paths resolve beside that file.
- A row may carry `config:` to supply the plugin's configuration, and `inject:` for loader-level injection.
- The `id` is the row identity used by later layers to override it. The `name` is the module specifier. Your exported `name` (or your class's registered service name) must be consistent with the `id` you use — a mismatch is the classic reason a plugin loads but "does nothing".

Verify the layer **without booting**:

```sh
dsh --profile demo --dump-config   # shows a "# == dsh-my-plugin" layer
dsh --profile demo
```

---

## 4. The request pipeline: where a plugin attaches

Most confusion for new plugin authors comes from not knowing *where* in the pipeline a plugin belongs. This section is the conceptual map; the later sections are the mechanics.

```
 user input
     │
     ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ agent (ctx.agents)                                           │
 │  · session log (durable events)                              │
 │  · system-prompt assembly  ← system-prompt/assemble waterfall │
 │  · tool schema projection  ← ctx.tools.restrict()            │
 └──────────────────────────────────────────────────────────────┘
     │  GenerateOptions { provider, model, messages, tools, … }
     ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ ctx.llm  (LlmRuntime)                                        │
 │  · route → adapter selection (by options.provider)           │
 │  · llm/stream waterfall  ← retry, replay, routing, gateways   │
 │  · adapter.resolveModel / prepareCall                        │
 └──────────────────────────────────────────────────────────────┘
     │  HTTP + StreamingChunks
     ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ YOUR LlmAdapter: stream(options) → AsyncIterable<StreamChunk>│
 │  serialize messages → provider wire                          │
 │  parse SSE → emit block-start / *-delta / block-end          │
 └──────────────────────────────────────────────────────────────┘
     │  StreamChunk[]
     ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ BlockAssembler → assistant message                           │
 │  · tool calls dispatched through ctx.tools                   │
 │    tools/pre-execute → guards → tools/execute →              │
 │    tools/post-execute → finalizeContent → tools/result       │
 └──────────────────────────────────────────────────────────────┘
     │
     ▼
 persisted session events (turn/*, step/*, tool/call, tool/result)
```

**[verified]** The three integration surfaces this implies:

| You want to… | Attach at |
|---|---|
| add a model provider | `ctx.llm.registerAdapter(routes, adapter)` — §11 |
| give the model a new capability | `ctx.tools.register(defineTool({…}))` — §14 |
| intercept, gate, log or transform model calls | `ctx.on('llm/stream', …)` — §10 |
| intercept, gate, log or transform tool calls | `tools/pre-execute`, `tools/execute`, `tools/post-execute`, `tools/result`, `ctx.tools.guard()` — §14 |
| add durable state, jobs, approvals | the corresponding core service (`ctx.jobs`, `ctx.approval`, …) — §9 |
| add a browser UI | `dsh.client` + `./client` export — §20 |
| change what the model is told | a section provider through `ctx.systemPrompt.section()`, or the `system-prompt/assemble` waterfall — §9 |

**Session events are not Cordis events.** **[verified]** `turn/*`, `step/*`, `tool/call`, `tool/result` and `compaction/*` are **durable session-event types**. To observe them, listen to `session/event` and inspect `event.type`:

```typescript
ctx.on('session/event', (_session, event) => {
  if (event.type === 'tool/result') { /* ... */ }
})
```

Cordis events use `namespace/action` names (`agent/pre-step`, `agent/request`, `agent/request-error`, `tools/result`, `session/event`). Conflating the two vocabularies is a common early mistake.

---

## 5. Plugin contract: `name`, `inject`, `Config`, `apply`

### `name`

Unique plugin identifier, used for fiber diagnostics and logger names. Keep it consistent with the row `id` in `cordis.patch.yml`.

```typescript
export const name = 'my-plugin'
```

### `inject`

**[verified]** Services the plugin requires. Cordis waits for all injected services to be ready before calling `apply`.

```typescript
export const inject = ['llm', 'settings', 'credentials'] as const
```

Dependency behaviour worth knowing before you rely on it:

- **Required vs optional.** A name in `inject` is *required*: the plugin does not load while that service is absent. A service you only sometimes need should be omitted from `inject` and fetched at the use site with `ctx.get('name')`, which returns `undefined` when absent:

  ```typescript
  export function apply(ctx: Context) {
    const metrics = ctx.get('metrics')
    metrics?.record('plugin_loaded', 1)   // optional dependency
    ctx.inject(['http'], (hc) => {         // load-time optional dependency
      hc.http.use('/metrics', handler)
    })
  }
  ```

- **When a required service disappears**, for example because its provider unloads, dependent plugins **dispose automatically** and are **loaded again when the service returns**. Your `apply` body must therefore be able to run more than once over a process lifetime, and every registration must be effect-scoped (§7).

- `ctx.inject(deps, callback)` is shorthand for `ctx.plugin({ inject: deps, apply: callback })`: the callback is unloaded and re-run whenever a required service changes. It returns a `Fiber` that is also awaitable, so `await ctx.inject(...)` waits for that sub-plugin to finish loading.

- `ctx.plugin(childPlugin, config?)` mounts a **nested fiber** that inherits the parent context but has an independent lifecycle, and unloads with its parent.

- The object form of `inject` maps each service name to **intercept config** merged into that service's per-plugin config. This is how you pass service-specific configuration without writing it into the service's global config.

- **Service isolation** **[verified]**: a `cordis-plugin-group` row with `isolate: { shell: true }` gives plugins in that group their own instance of the isolated service. Two groups can then run the same service with different config (e.g. two `bash` timeouts) with no cross-group effect. Relevant when you write a service that others should be able to scope.

### `apply(ctx, config)`

Called once per fiber activation. Receives the context and the validated config.

```typescript
export function apply(ctx: Context, config: Config): void {
  // register effects; services in `inject` are ready here
}
```

Do the cheap, synchronous wiring here (registration, listeners, resolvers). Do **not** perform network I/O in `apply`: it delays activation, and a slow `apply` makes the plugin look broken. Defer I/O to the first request or to a background job with its own effect.

### `Config`

Declare the config as a **Schemastery schema** and let Cordis validate it before `apply` runs. The convention is to export both a `Config` *type* and a `Config` *value* (the schema):

```typescript
export interface Config {
  greeting: string
  maxRetries: number
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
})
```

**[invariant]** Never export a plain object as `Config`. It does not implement the Standard Schema interface Cordis requires, and validation silently stops happening.

The schema runs while the plugin loads; invalid configuration **fails the load with an actionable error** rather than producing a half-working plugin.

---

## 6. Configuration with Schemastery

[Schemastery](https://github.com/shigma/schemastery) is the validation library used by dsh. Every field has a default; Cordis validates user config and fills defaults at load time.

```typescript
import z from '@deepseek-ai/schemastery'
import { RetryPolicySchema } from '@deepseek-ai/dsh-llm'

export const ConfigSchema = z.object({
  endpoint: z.string().default('http://localhost:8080'),
  apiKeyEnv: z.string().role('credential-ref'),
  timeoutMs: z.number().min(1).max(600_000).default(120_000),
  mode: z.union([z.const('fast'), z.const('accurate')]).default('fast'),
  models: z.array(z.object({
    id: z.string().required(),
    contextWindow: z.number().min(1),
  })).default([]),
})

export type Config = z.infer<typeof ConfigSchema>
```

### Rules

- **Always provide defaults** so that an empty section works. This is not politeness: a plugin whose empty config throws is unusable from the Plugins page.
- **Bound ranges** with `.min()` / `.max()` for early validation. Reject values you cannot honor at load time, not on the first request.
- **Reuse the shipped sub-schemas** where they exist. `RetryPolicySchema` from `@deepseek-ai/dsh-llm` is the canonical example: it gives you the host's retry semantics for free instead of inventing your own `retryCount`.
- **Export the inferred type** with `z.infer<typeof Schema>` (or hand-write the interface and annotate the schema as `Schema<Config>`); keep them in sync.
- **Nested objects need `.default({})`**, not just leaf defaults, or an omitted section leaves the whole object undefined. Locally: `defaultConnection: Connection.default({})`.

### Field roles **[verified]**

Schemastery fields can carry a *role*, which the UI and the host interpret:

| Role | Effect |
|------|--------|
| `.role('secret')` | The value is kept **out of form responses**. The user can set it; the page never reads it back. |
| `.role('credential-ref')` | The field names something managed by the **credentials domain**, not a raw secret. Resolve it at runtime through the `credentials` service (§18). |

Use `credential-ref` for anything a user should be able to swap in a credential store without editing the plugin config, and `secret` for a raw value the plugin itself needs. **Never** log either.

### Live (volatile) configuration **[verified]**

A config field declared `.volatile()` becomes a `Volatile<T>` reference with `.get()` and `.check()`, updated in place through the loader instead of by replacing the plugin instance:

```typescript
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export interface Config {
  endpoint: Volatile<string | undefined>
  retries: Volatile<number>
}

export const Config = z.object({
  endpoint: z.string().volatile(),
  retries: z.number().step(1).min(0).default(3).volatile(),
})

export function apply(ctx: Context, config: Config): void {
  ctx.on('loader/volatile-update', () => {
    ctx.logger.info('Retry limit: %d', config.retries.get())
  })
}
```

Semantics to respect:

- Read `.get()` **when starting an operation**, not once at wiring time. A request that needs a consistent snapshot reads each field once and keeps the values for that request.
- `.check()` expresses cross-field validation; those checks run on the host before persistence and are omitted from the serialized form schema.
- Volatile editing preserves **plugin instance identity**. That is the point: no re-registration, no `replace()` dance, no window where the provider is invisible.

Compare the two hot-reload mechanisms before choosing:

| Mechanism | Cost | Use when |
|---|---|---|
| Plugin config edit (non-volatile) | Full fiber unload + reload; all registrations are torn down and rebuilt | The change is structural (new routes, new tools) |
| `.volatile()` field | In-place update, identity preserved | The change is a value the plugin re-reads per operation (endpoint, timeout, limits) |
| Settings section + `setSource` thunk (§18) | Neither: the plugin owns a swap function | The plugin is already registered and you need per-request freshness without a restart |

### The tunable-value rule **[verified]**


> Anything that two deployments may want to set differently must be a configuration field.

The test is whether `cordis.yml` can change the value without a code edit.

```typescript
// Wrong: hardcoded timeout.
const TIMEOUT = 30_000

// Correct: configurable.
export interface Config {
  timeoutMs: number  // schema default: 30_000
}
```

---

## 7. Lifecycle, effects and disposal

### The fiber state machine **[verified]**

```
PENDING → LOADING → ACTIVE
                 ↘ FAILED
ACTIVE → UNLOADING → DISPOSED
```

| State | Meaning |
|------|---------|
| `PENDING` | Declared, but required dependencies are not ready |
| `LOADING` | Dependencies are ready and `apply` is running |
| `ACTIVE` | The plugin is running |
| `FAILED` | `apply` (or config validation) threw |
| `UNLOADING` | Disposing resources |
| `DISPOSED` | Fully unloaded; cannot restart |

The `internal/status` Cordis event fires on every transition with `(fiber, oldValue)`, which is the supported way to observe plugin health **[verified]**.

### Everything registered through `ctx` is an effect **[verified]**

The framework tracks and disposes, on unload:

- `ctx.on(event, handler)` / `ctx.once(...)` — event listeners
- `ctx.tools.register(tool)` — tool registrations
- `ctx.llm.registerAdapter(routes, adapter)` — adapter registrations
- `ctx.effect(() => cleanup)` — custom resources
- services registered by a `Service` subclass constructor
- child plugins mounted with `ctx.plugin()`

```typescript
export function apply(ctx: Context): void {
  ctx.on('some-event', handler)                       // auto-removed

  ctx.effect(() => {                                  // custom resource
    const connection = createConnection()
    return () => connection.close()
  })
}
```

`ctx.effect(body, label?)` runs `body` immediately, collects the disposers it returns, and runs them when the returned disposer is called **or** when the fiber unloads, whichever comes first. Accepted shapes:

```typescript
ctx.effect(() => () => close())                        // single disposer
ctx.effect(() => [() => a(), () => b()])               // iterable of disposers
ctx.effect(async () => { ...; return () => close() })  // async, disposer is awaitable
ctx.effect(async function* () {                         // generator: each yield registers
  const a = await openA(); yield () => a.close()
  const b = await openB(); yield () => b.close()
})
```

### Disposal order — the trap **[invariant]**

**[verified]** Disposer invocation *starts* in reverse registration order, but **multiple async disposers run concurrently and have no serial completion guarantee**. If a teardown has ordered steps (stop the timer, then close the socket), do not register two effects and hope. Put the ordered cleanup inside **one** `ctx.effect()` and await the steps serially there.

`ctx.fiber.dispose()` returns a promise that resolves **after all asynchronous cleanup finishes** and guarantees that child plugins are recursively unloaded. To restart the plugin with its current config, `ctx.fiber.restart()`; to apply new config, `ctx.fiber.update(config)` runs the `internal/update` waterfall first, so update hooks and HMR can veto or replace the restart.

### HMR **[verified]**

With `@deepseek-ai/dsh-hmr` loaded, editing a plugin source file unloads the old fiber (running all disposers) and loads the new code. Because registrations clean themselves up, hot replacement does **not** retain the old instance's registrations — provided you registered everything through `ctx`. A module-level `setInterval` at import scope is the classic leak here.

### Lifecycle checklist for plugin authors

- Register everything through `ctx`, or wrap it in `ctx.effect()`.
- Never do I/O in `apply`.
- Assume `apply` can run again in the same process (service provider restart).
- Put ordered teardown in one effect.
- If you own a timer, an interval, a socket, a child process, or a global cache, ask "what disposes this?" before writing it.

### Context members worth knowing **[verified]**

Beyond the service properties and the mixed-in event/registry methods, a context exposes:

| Member | Purpose |
|--------|---------|
| `ctx.get(name, strict?)` | read a service, `undefined` when absent (the optional-dependency idiom) |
| `ctx.set(name, value)` | write a service value; **only the providing fiber may set it**, and setting an unprovided name throws |
| `ctx.provide(name, value)` | register a service, returning its disposer; throws if already provided in this scope or declared as an accessor |
| `ctx.extend(meta?)` | child context with extra own properties (the parent is not mutated) |
| `ctx.isolate(name, label?)` | child context with an independent scope for one service; passing the same `label` joins two scopes |
| `ctx.intercept(name, config)` | merge service-specific config for plugins started below this context |
| `ctx.accessor(name, options)` | define a computed context property |
| `ctx.mixin(name, mixins)` | forward members of one context object onto another (this is how `ctx.on` forwards to `ctx.events.on`) |
| `ctx.root`, `ctx.baseUrl` | the root context; the base URL for relative module resolution |
| `ctx.fiber` | the owning fiber: `dispose()`, `await()`, `restart()`, `update(config, noSave?)`, `state`, `uid`, `config`, `getEffects()` |

`fiber.getEffects()` returns an `EffectMeta` tree (`{ label, children }`) for the effects currently registered — the first thing to inspect when you suspect a leak.

There is **no `ctx.router`** and **no `ctx.on('dispose')`**. Scoping is `extend`/`isolate`/`intercept` (plus `cordis-plugin-group` with `isolate:` in YAML), and disposal is effects plus `fiber.dispose()`. If you see either in an example, the example predates Cordis 4.

---

## 8. The event bus

**[verified]** Cordis exposes five dispatch modes. Choosing the wrong mode is the most common source of "my plugin doesn't get called" or "my plugin unexpectedly blocks everything".

| Mode | Dispatch | Listener contract | Use for |
|------|----------|-------------------|---------|
| `emit` | Synchronous broadcast, return values ignored | just handle it | notifications, logging, metrics |
| `parallel` | All listeners run concurrently, `await`ed together | return a promise if async | independent side effects that must all complete |
| `serial` | Listeners awaited **in order** until one bails | return a value to stop the chain | ordered pipelines with a winner |
| `bail` | Synchronous, first non-`null`/`false`/`undefined` wins | return a value to stop | checks and vetoes |
| `waterfall` | Each listener wraps the rest via `next()` | **must call `next()` to delegate** | interception, transformation, gating |

```typescript
// Emit and listen.
ctx.emit('my-plugin/ready', { id: 'worker-1' })
ctx.on('my-plugin/ready', ({ id }) => ctx.logger.info('%s ready', id))

// Bail: first non-falsy result stops the chain.
const verdict = ctx.bail('my-check', input)
ctx.on('my-check', (input) => shouldBlock(input) ? 'blocked' : undefined)

// Serial: ordered, awaited, first bail wins.
await ctx.serial('setup-phase', context)

// Waterfall: MUST call next() to reach the built-in behaviour.
ctx.on('my-plugin/transform', async (input, next) => {
  const downstream = await next()
  return downstream.trim()
})
```

### Rules

- **A waterfall listener that omits `next()` short-circuits the pipeline.** That is a feature (it enables interception and gateway behavior) and a footgun (an early `return` silently disables the real implementation). If you only want to observe, use `emit`, not `waterfall`.
- **Listeners registered with `ctx.on()` are effects** and are removed when the plugin unloads. The one exception is `ctx.on(name, listener, true)` (`prepend`), which only changes ordering.
- **`ctx.on(name, listener, { global: true })`** receives the event regardless of the context filter. Use it only when you genuinely need cross-scope visibility; it defeats the scoping that makes plugins composable.
- **Type your events with declaration merging** so `emit`/`on`/`waterfall` are checked:

```typescript
declare module '@deepseek-ai/cordis' {
  interface Events {
    'my-plugin/ready': (payload: { id: string }) => void
    'my-plugin/check': (input: string) => boolean | undefined
    'my-plugin/transform': (input: string, next: () => Promise<string>) => Promise<string>
  }
}
```

### Event names you can attach to **[verified]**

| Event | Mode | Purpose |
|-------|------|---------|
| `llm/stream` | waterfall | Around every streaming model call: `(options, next)`. Call `next()` for the resolved adapter's stream, or yield your own chunks to short-circuit. **Retry, replay, routing and gateways live here.** |
| `llm/adapters-updated` | emit | Provider topology changed (an adapter registered/unregistered routes, or the directory changed). Payload-free: re-read `listProviders()` / `listConfigurableProviders()`. |
| `tools/pre-execute` | waterfall | Reorderable allow/deny/ask policy for a tool call. Returns a typed decision. |
| `tools/execute` | waterfall | Wraps normalized canonical dispatch — the place for deadlines, retries and metrics. Only this view may replace `exec.signal`. |
| `tools/post-execute` | waterfall | Inspect or replace the result, block with feedback, attach ordered context. |
| `tools/result` | emit | Observe the immutable final outcome. |
| `tools/change` | emit | The tool registry changed. |
| `tools/ptc-dispatch-log` | waterfall | Per-sub-call logging inside a PTC (`run_code`) program. |
| `agent/pre-step` | waterfall | Before a step is claimed. Returns reject / enter. |
| `agent/request` | waterfall | After `prepareCall`, before dispatch. |
| `agent/request-error` | waterfall | A request failed — **this is where retry policy is executed**. |
| `agent/turn-stopping` | serial | Late in the turn; may steer another step. |
| `agent/created`, `agent/disposed`, `agent/status`, `agent/error` | emit/serial | Agent lifecycle. |
| `agent/assistant-stream` | emit | Process-local live frames (start / transient chunks / end) for token-by-token presentation. |
| `session/event` | emit | Every durable session event; inspect `event.type`. |
| `session/flush` | parallel | Durable log flushed. |
| `system-prompt/assemble` | waterfall | **Expert** cooperative whole-assembly transform — your returned assembly is authoritative, so you own preserving active PTC mode and structured-output contributions. Prefer `ctx.tools.restrict()` for tool filtering. |
| `system-prompt/change` | emit | Prompt assembly changed. |
| `fs/write-intent`, `fs/edit-intent` | waterfall | Intercept a filesystem mutation before it happens. |
| `fs/observed` | emit | A filesystem change was observed. |
| `approval/request` | waterfall | An approval is being requested. |
| `loader/volatile-update` | emit | A volatile config field changed (§6). |
| `settings/document-updated` | emit | Settings persisted at a new revision. |
| `credentials/reference-updated`, `credentials/record-updated` | emit | Credential state changed. |
| `hmr/change`, `hmr/reload` | emit | Hot-reload activity. |
| `subagent/start`, `subagent/end`, `subagent/provider-*` | emit | Sub-agent lifecycle. |
| `internal/status`, `internal/plugin`, `internal/get`, `internal/set`, `internal/dispatch` | framework | Diagnostics and framework interception. Rarely needed by a normal plugin. |

The complete generated matrix of producers and listeners lives in `docs/event-producer-consumer.md` in the harness repository. **Do not hand-maintain a copy of it** — read it (or the generated subsystem pages) when you need an exact signature.

### Reading `llm/stream` safely **[invariant]**

A request built by the agent loop is marked with a process-local identity and arrives **deep-frozen — mutating it throws**. Its content is a pure function of the session log (the harness calls this the *reconstructability* property), so:

- **Read** the request; never rewrite it. To change what the model sees, change the section/system-prompt or tool registrations, not the frozen object.
- Clone before transforming. Hand-built one-shot calls are not marked and are not frozen, which means a bug that mutates them will not show up until a loop-built request arrives.

---

## 9. Registering services

A service is a capability one plugin exposes to other plugins. `ctx.llm`, `ctx.tools` and `ctx.agents` are services.

### Consume a service

```typescript
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(/* ... */)   // ctx.tools is ready here
}
```

### Provide a service **[verified]**

```typescript
import { Service, type Context } from '@deepseek-ai/cordis'

// 1. Declare the service on the Context interface (declaration merging).
declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}

// 2. Extend Service. `super(ctx, name)` registers immediately and the
//    registration is removed automatically with the owning fiber.
export class MetricsService extends Service {
  static inject = ['llm']        // a service may itself depend on services

  constructor(ctx: Context) {
    super(ctx, 'metrics')
  }

  record(event: string, value: number): void {
    /* ... */
  }
}

// 3. Export the class as the plugin entry (class form), or mount it from a
//    function plugin with `ctx.plugin(MetricsService)`.
export default MetricsService
```

Consumers then read it as a normal property:

```typescript
export const inject = ['metrics']

export function apply(ctx: Context) {
  ctx.metrics.record('tool_call', 1)
}
```

`Service` also exposes symbol-keyed extension hooks on the class: `Service.init` (an instance method run after construction for class plugins), `Service.check` (an availability predicate), `Service.invoke` (make the service callable, e.g. `ctx.logger()`), `Service.extend`, and `Service.config` (phantom intercept-config type). Most plugins need only `constructor(ctx, name)` and `static inject`.

### The three-role capability pattern **[verified]**

When a capability is general enough to need replaceable providers, split it into three roles and put them in separate packages **only when they need to evolve independently**:

| Role | Example | Responsibility |
|------|---------|----------------|
| **Service Definition** | `dsh-shell` | The Cordis service, plus request/result types |
| **Service Provider** | `dsh-bash-local` | One implementation (local machine, container, remote) |
| **Consumer** | `dsh-tool-bash` | Exposes the capability as a model-callable tool |

The provider and consumer **do not depend on each other**; both depend only on the definition. Design points:

- The **definition owns the request/result types**; nobody else re-declares them.
- **Do not split preemptively.** A simple tool plugin does not need three packages.
- **Explicit over implicit**: resolve defaults in an explicit `resolve(request): Spec` step rather than hiding `?? default` expressions inside `run()`.

### Services a plugin can inject

The service list is generated, not hand-maintained. The names below are the ones this guide verified or that production plugins use; treat the generated subsystem pages and the packages' `.d.ts` as authoritative.

| Service | Status | What it gives you |
|---------|--------|-------------------|
| `ctx.llm` | [verified] | Adapter registry, configurable-provider directory, model discovery, streaming call API |
| `ctx.tools` | [verified] | Tool registry and execution pipeline |
| `ctx.agents` | [verified] | Agent handles: `get(id)`, `followup()`, `steer()`, `inject()`, `dispose()` |
| `ctx.settings` | [verified, via `ctx.inject(['settings'], …)`] | `installSection(...)` — the plugin's settings section |
| `ctx.credentials` | [verified] | `resolve(ref)` → `{ value }` |
| `ctx.attachments` | [verified] | Durable image/file attachment store: `readImage(ref)`, file streams. Images must be read through it — never by path |
| `ctx.http` | [verified] | `http.use(path, handler)` — mount an HTTP route (e.g. `/metrics`) |
| `ctx.logger` | [verified] | `ctx.logger(name)` → a named Cordis logger |
| `ctx.jobs` | [verified] | Background job runtime: `ctx.jobs.start({ kind, label, owner, run })` |
| `ctx.approval` | [verified] | The approval/ask channel used by `tools/pre-execute`'s `ask` decision |
| `ctx.sessions`, `ctx.sessionPersistence` | [verified, names only] | Session lookup and durable storage |
| `ctx.systemPrompt` | [verified] | `ctx.systemPrompt.section(...)` — contribute system-prompt text with ordering and scope-local shadowing |
| `ctx.compaction` | [verified] | Context-compaction seam |
| `ctx.subagents` | [verified] | Sub-agent provider registry |
| `ctx.ptcRuntime` | [verified] | PTC (`run_code`) runtime; required by `tools` in `ptc`/`both` mode |
| `ctx.commands`, `ctx.configForms`, `ctx.slots`, `ctx.remote` | [verified, names only] | Command registration, settings forms, client slot injection, remote API |
| `ctx.sandbox` | [verified] | Sandbox backend seam |

**Do not maintain your own list of built-in services in code.** Inject what you need and read the type; a hand-copied name list goes stale silently.

### Mounting an HTTP route **[verified pattern]**

```typescript
ctx.inject(['http'], (hc) => {
  hc.http.use('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', registry.contentType)
    res.end(await registry.metrics())
  })
})
```

Note the shape: the optional dependency is requested with `ctx.inject` so that the route exists exactly while the `http` service does, and it disappears with it. That is the pattern for any capability that depends on an optional service.

---

## 10. The `llm` service API

**[verified]** `ctx.llm` is a `LlmRuntime` (a `TypertRemoteService`, so its methods can also cross to the browser). The methods a plugin author actually touches:

```typescript
// --- registry -------------------------------------------------------------
registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle
registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle
registerModelDiscovery(
  settingsNs: string,
  discover: (request: LlmModelDiscoveryRequest, signal?: AbortSignal)
    => Promise<readonly LlmDiscoveredModel[]>,
): () => void

// --- reads ---------------------------------------------------------------
listProviders(): LlmProviderInfo[]
listConfigurableProviders(): LlmConfigurableProvider[]
listModels(provider: string): Promise<LlmModelInfo[]>
resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
providerRetryPolicy(provider: string): ResolvedRetryPolicy
discoverModels(settingsNs, request, signal?): Promise<LlmDiscoveredModel[]>

// --- call resolution and dispatch ---------------------------------------
resolveCallConfig(config: LlmCallConfig, signal?): Promise<LlmCallConfig>
prepareCall(config: LlmCallConfig, signal?): Promise<PreparedLlmCall>
stream(options: GenerateOptions): AsyncIterable<StreamChunk>
```

### Registration is all-or-nothing and disposable **[invariant]**

`registerAdapter` throws `LlmError` with code `DUPLICATE_ADAPTER` if **any** provider route already has an adapter, and it registers **none** of the routes in that case. Every provider route has exactly one owning adapter — you cannot "layer" two adapters on one route. Route-based interception is what `llm/stream` is for.

The return value is a **disposer that also carries `.replace()`**:

```typescript
const handle = ctx.llm.registerAdapter(['my-provider'], adapter)
handle.replace(['my-provider', 'my-provider-alt'])  // atomic; validated in full first
// handle()  → releases every route
```

`.replace()` validates the whole candidate set first — a conflict with another adapter, an invalid name, or bad provider metadata throws and leaves the current routes untouched — and the swap itself is one synchronous section, so **no request can observe a gap**. An empty array is legal in `replace` (a settings section that emptied holds zero routes while staying registered), but **not** in the initial registration. After the registration is disposed, `replace` throws `REGISTRATION_DISPOSED`.

`registerConfigurableProviders` follows the same pattern via `DirectoryRegistrationHandle`.

Use `handle.replace()` when a **retry policy or other adapter-owned capture** must change: the policy is captured with the registration, so changing it means re-registering the routes.

### The configurable-provider directory **[verified]**

A provider can be *declared* before it is *live*. That is what makes the "add a provider" UI work: the settings page needs to offer a provider that has no route yet.

```typescript
ctx.llm.registerConfigurableProviders([
  {
    provider: 'localforge',
    displayName: 'LocalForge',
    settingsNs: 'llm-localforge',
    settingsPath: [],
    // declared: true   → the adapter knows this route only because
    //                    configuration declared it (a user-added gateway)
    // declared: false  → this is one of the adapter's own shipped routes
    // declared: absent → the adapter draws no such distinction
    // error: '...'     → configuration diagnostic for repair
  },
])
```

`settingsPath` is the path from that namespace's section root to this provider's profile object; **empty when the whole section is the profile**. Configuration surfaces merge this directory with `listProviders()` to offer every configurable provider alongside its live/dormant state. If your plugin shows a raw list of providers and ignores the directory, the user's newly added provider will be invisible.

### `llm/stream`: intercepting every model call **[verified]**

```typescript
declare module '@deepseek-ai/cordis' {
  interface Events {
    'llm/stream'(
      this: LlmRuntime,
      options: GenerateOptions,
      next: () => AsyncIterable<StreamChunk>,
    ): AsyncIterable<StreamChunk>
  }
}
```

```typescript
// Observe without changing behaviour: call next() and filter the stream.
ctx.on('llm/stream', async function (options, next) {
  const started = performance.now()
  let chunks = 0
  for await (const chunk of next()) {
    chunks++
    if (chunk.type === 'usage') recordUsage(options.model, chunk.usage)
    yield chunk
  }
  recordLatency(options.model, performance.now() - started)
})

// Route to a different model without touching the caller.
ctx.on('llm/stream', async function (options, next) {
  if (!shouldRedirect(options)) return next()
  return ctx.llm.stream({ ...options, model: fallbackModel(options.model) })
})
```

Notes that matter:

- The listener receives the request as `options` and the **resolved downstream stream** as `next()`. Yield your own chunks instead of calling `next()` to short-circuit.
- `this` is bound to the `LlmRuntime`, so `ctx.llm.stream(...)` inside the listener starts a **nested** call that re-enters the waterfall. Guard against infinite recursion.
- The waterfall is where the harness's own retry/replay/routing plugins live. If a behaviour (retries, fallbacks) already exists there, prefer configuring it over reimplementing it in your adapter.
- `options` is deep-frozen for loop-built requests (§8). Clone before altering.

### `prepareCall`: why per-request resolvers matter **[verified]**

`prepareCall(config)` binds **exact model metadata and the eventual request dispatch to one adapter generation** and returns a one-shot handle. Its doc comment states the reason precisely: dynamic adapters override it so that *settings changes between preparation and dispatch cannot combine one generation's capabilities with another's endpoint*. `LlmRuntime.stream()` keeps the registration fixed through asynchronous exact-model resolution and dispatch.

Consequence for adapter authors: read your connection facts through a **thunk at call time** rather than capturing them in the constructor, so the generation that answered capability questions is the generation that dispatches. See §17.

### `imageRequestPricing` **[verified]**

An adapter whose provider charges visual tokens may implement `imageRequestPricing(provider, model)` to return an `LlmImageRequestPricing` with `priceImages(images)`. It must be **synchronous and I/O-free** — the token meter resolves it per measurement. If you do not implement it, consumers fall back to their own neutral estimate.

---

## 11. LLM adapters

### The base class **[verified]**

```typescript
import { LlmAdapter, LlmError, attributionHeaders } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo,
  PreparedAdapterCall, ResolvedRetryPolicy, StreamChunk,
} from '@deepseek-ai/dsh-llm'

export class MyAdapter extends LlmAdapter {
  /** Required. The only abstract method. */
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // honor options.signal; emit the chunk protocol; throw LlmError on failure
  }

  /** Display metadata. `id` must equal the provider route. */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'My Provider' }
  }

  /** The provider-owned retry policy captured with this route. */
  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined {
    return this.opts.resolveConn().retryPolicy as ResolvedRetryPolicy
  }

  /** Advisory catalog. Absence of a model here must NOT reject a request. */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> { /* ... */ }

  /** Exact-model metadata: the provider-neutral capability seam. */
  override async resolveModel(
    provider: string, model: string, signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> { /* ... */ }

  /** Optional: bind model metadata and dispatch to one adapter generation. */
  override async prepareCall(
    provider: string, model: string, signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> { /* ... */ }

  /** Optional: synchronous, I/O-free provider-side image pricing. */
  override imageRequestPricing(provider: string, model: string) { return undefined }
}
```

### What each override is for

`LlmAdapter` is a **plain abstract class, not a Cordis `Service` subclass** — it is registered *on* the `llm` service rather than being one. Do not try to `super(ctx, name)` it.

| Member | Default | Override when |
|--------|---------|---------------|
| `stream(options)` | **abstract** | always |
| `providerInfo(provider)` | returns a stub | you want a proper display name in selectors |
| `providerRetryPolicy(provider)` | no policy (host defaults) | the provider has its own transient-failure semantics |
| `listModels(provider)` | empty | you can advertise a catalog to the picker |
| `resolveModel(provider, model, signal)` | minimal identity | you know context window, max output, or reasoning efforts |
| `prepareCall(provider, model, signal)` | default binding | your adapter is **dynamic** (settings can change between prepare and dispatch) |
| `imageRequestPricing(provider, model)` | none | your provider bills visual tokens and you can price them synchronously |

### Two invocation patterns, one adapter instance

**[verified]** `addTools`-style adapters in the wild are either *static* (constructor gets the endpoint) or *dynamic* (every call reads current settings). The harness supports both, but only the dynamic shape survives a settings edit in a running host. The official minimal example uses the static shape for clarity:

```typescript
class MyAdapter extends LlmAdapter {
  constructor(private readonly apiKey: string) { super() }
  async * stream(options: GenerateOptions) { /* ... */ }
}

export const name = 'my-llm-adapter'
export const inject = ['llm']
export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(config.providers, new MyAdapter(config.apiKey))
}
```

For anything a user can edit at runtime, use the dynamic shape (§17, per-request resolver). The static shape's failure mode is silent: the provider works, the settings page accepts edits, and the edits never take effect.

### Provider routes and models

- `options.provider` selects the adapter; `options.model` is the provider's own model id. A dynamic-catalog adapter can serve **new models without lifecycle reconfiguration** — that is why `listModels` is advisory and its absence must never reject a request.
- Multi-route registration is convenient (`registerAdapter(['a', 'b'], adapter)`) but re-registering on a config change must use `.replace()`, not a second `registerAdapter`.

### `GenerateOptions`

**[verified]** The assembled request:

| Field | Notes |
|-------|-------|
| `provider`, `model` | route + provider model id |
| `reasoningEffort?` | adapter-owned opaque effort id; the service validates it **before** `stream()` and rejects unsupported explicit values |
| `messages` | ordered history exactly as the provider should see it. A loop-built request's leading `system`-role message carries the system prompt |
| `system?` | system prompt text for **one-shot** callers; loop-built requests leave it `undefined`. Map it to the provider's system slot *ahead of* `messages` |
| `tools?` | `ToolSchema[]` (`{ name, description, parameters }`) — map to the provider's `tools` field |
| `temperature?`, `maxTokens?`, `stop?` | sampling controls. The stop string itself is not included in output |
| `signal?` | cancellation. **Honor it** |
| `sessionId?` | session identity for request routing/replay; may map to model-hidden transport metadata |
| `purpose?` | `'compaction' \| 'session-title'` for auxiliary calls; ordinary conversation leaves it unset |

**[invariant]** If the provider cannot honor a field, **throw `LlmError(..., 'UNSUPPORTED_OPTION')`** rather than silently dropping it. A silently dropped `stop` list or `maxTokens` produces behavior the user cannot explain.

### `resolveModel`: the capability seam **[verified]**

`resolveModel` returns `LlmResolvedModelInfo extends LlmModelInfo` and may add:

| Field | Meaning |
|-------|---------|
| `context?` | `{ contextWindow: number }` — provider-owned capacity for this exact route |
| `defaultMaxTokens?` | per-request output cap materialized when the caller omits one |
| `reasoning?` | `{ efforts: [{ id, name, description? }], defaultEffort? }` — ordered opaque ids plus an optional configured default |
| `systemPromptUpdate?` | `'in-history'` when the model reads the latest `system` message at any position (so a changed prompt can follow cached history instead of rewriting message 0) |
| `inputModalities?` | `('text' \| 'image')[]`; **absent means unknown, while an explicit omission is negative capability** |

Rules:

- Preserve the adapter's **authoritative** selectable list, including an adapter-defined `off` when upstream supports it. Do not promote provider values into a core enum and do not clamp unsupported values — the service rejects unsupported explicit efforts **before** I/O.
- An effort `id` need not equal its wire representation; the adapter maps it.
- Honor the optional `signal` and settle promptly after it aborts — this is what makes disposal and cancellation reach quiescence.
- Omitting `reasoning` means *this model has no selectable reasoning-effort capability*, which is different from "unknown".

### Retry policy: declare it, don't implement it **[verified]**

`providerRetryPolicy(provider)` returns a `ResolvedRetryPolicy`, which is either:

```typescript
{ mode: 'normal', maxRetries, retryableCodes: readonly string[],
  initialDelayMs, maxDelayMs, jitterRatio }
{ mode: 'always', initialDelayMs, maxDelayMs, jitterRatio }
```

The policy is **captured when the route is registered**, and the optional `dsh-llm-retry` plugin executes it **on the agent's failed-step extension point** (driven from `agent/request-error`). So:

- The adapter's job is to classify failures into stable codes and declare which are transient.
- The adapter's job is *not* to sleep-and-retry inside `stream()`. Doing both multiplies attempts (your inner retries × the host's policy retries) and makes the delay profile impossible to reason about.
- Changing the policy requires re-registering the routes (`handle.replace(...)`), because the policy is part of the registration.
- `RetryPolicySchema` from `@deepseek-ai/dsh-llm` is the Schemastery schema to embed in your connection config, so users edit it with the host's vocabulary. `resolveRetryPolicy(config, path)` validates, defaults and detaches one policy.
- **The default retryable set** is `EMPTY_RESPONSE`, `RATE_LIMIT`, `SERVER`, `TIMEOUT`, `TRANSPORT`; the default backoff is 5 retries starting at 500 ms, capped at 10 000 ms, with a 0.1 jitter ratio. If your adapter invents a new transient code, it is **not** retried unless you add it to `retryableCodes`.
- Distinguish **retryable** from **terminal**. `AUTH` and `INVALID_REQUEST` fail identically on every attempt; `QUOTA`/exhausted balance is terminal while `RATE_LIMIT` is transient. `EMPTY_RESPONSE` is explicitly treated as safe to repeat.

### Error handling: two sanctioned paths **[verified]**

> Errors have exactly two sanctioned paths: **throw** from `stream()` (transport and protocol failures — use `LlmError` with a stable code), or **end the stream** with `finish {kind: 'error' | 'aborted'}` (provider in-band failures). Consumers handle both; pick per failure class and document it.

`LlmRuntime.stream()` normalizes a *thrown* adapter failure into a terminal `error`/`aborted` finish before exposing it to consumers. But **middleware, nested-call, cleanup, and consumer failures remain thrown** — do not rely on the normalization to swallow your bugs.

**[verified]** What the user actually experiences when a failure is not recovered from the `agent/request-error` extension point: the failure becomes the turn error and **no assistant message and no tool side effect is committed**. That is a good reason to classify failures carefully — a spurious terminal error discards a step's work, while a benign `finish { kind: 'stop' }` over an unparsed response silently loses it.

```typescript
throw new LlmError('upstream refused the request', 'INVALID_REQUEST', {
  cause: err,
  status: 400,
  providerRetryAfterMs: 1500,
  requestId,
})
```

`LlmErrorOptions` accepts `{ status, providerRetryAfterMs, requestId, cause }` **[verified]**. Populating `status` and `providerRetryAfterMs` is what lets the host's retry policy honor a provider's `Retry-After` instead of guessing.

`LlmError extends HarnessError`, which carries a stable machine-routable `code` **distinct from the human-readable message**:

> Route on this, never by parsing `message`.

`HarnessError` (and therefore `LlmError`) supports `cause` chaining. Use `errorChain(value)` when you need to *render* a thrown value with its full cause chain (undici's `TypeError: fetch failed` is the motivating case) — and never parse the result.

Useful helpers from `@deepseek-ai/dsh-llm` **[verified]**:

| Export | Purpose |
|--------|---------|
| `HarnessError` | base class with `code` |
| `LlmError` | LLM failures |
| `isHarnessError(value)` | runtime narrowing (**`instanceof` only** — duck-typed or cross-realm errors do not narrow) |
| `errorChain(value)` | render a thrown value with its cause chain and `AggregateError` members (diagnostics only) |
| `EMPTY_RESPONSE_CODE` | `'EMPTY_RESPONSE'` — a normal completion carrying zero content blocks |
| `CONTEXT_WINDOW_EXCEEDED_CODE` | `'CONTEXT_WINDOW_EXCEEDED'` |
| `QUOTA_EXCEEDED_CODE` | `'QUOTA'` — exhausted account quota/balance |
| `INVALID_CREDENTIAL_CODE` | `'INVALID_CREDENTIAL'` — supplied but malformed; deliberately **outside** the default retryable set |
| `isContextWindowExceededError(detail)` | classify provider overflow wording (pass code + type + message joined) |
| `isQuotaExceededError(detail)` | classify provider quota wording |
| `normalizeApiKey(raw)` | trim and judge a supplied key → `{ ok: true, value }` or `{ ok: false, reason: 'empty' \| 'illegalCharacters' }` |
| `assertUsableApiKey(raw, pkg, ref)` | trim or throw a diagnostic naming the **reference**, never the secret |

### Error code taxonomy **[mixed]**

There is no single frozen public enum of every code; codes are stable strings, and adapters/packages own their own. What is verified:

- **Canonical provider-neutral constants** shipped by the library: `EMPTY_RESPONSE`, `CONTEXT_WINDOW_EXCEEDED`, `QUOTA`, `INVALID_CREDENTIAL` (above).
- **Registry lifecycle codes**: `DUPLICATE_ADAPTER`, `REGISTRATION_DISPOSED`, `INVALID_PREPARED_CALL`, `NO_ADAPTER`.
- **Documented adapter codes**: `PROVIDER_HTTP_ERROR` (official example), `UNSUPPORTED_OPTION` (cookbook), `UNSUPPORTED_CONTENT` (used by production adapters for content the route cannot carry).
- **Widely used transport/HTTP classifications** in production adapters: `TRANSPORT`, `TIMEOUT`, `ABORTED`, `AUTH` (401/403), `RATE_LIMIT` (429), `INVALID_REQUEST` (400), `SERVER` (5xx), `MALFORMED_RESPONSE`, `STREAM_CLOSED`, `OVERFLOW`, `MISSING_CREDENTIAL`.

Practical guidance:

1. Reuse the canonical constants (`EMPTY_RESPONSE_CODE`, …) where they apply — they are what retry policy and the compaction/overflow recovery path key on.
2. Use the documented adapter codes for the documented situations.
3. For your own classifications, pick a stable `SCREAMING_SNAKE` code and put it in `providerRetryPolicy.retryableCodes` if it is transient. Document it in your README.
4. **Never** route on a message string.

### Attribution headers **[invariant]**

> Every provider HTTP request must include `attributionHeaders()`.

**[verified]** The function returns the headers to merge into the request (currently just a lowercase `user-agent` of the form `product/version (+url)`). The vocabulary is deliberately restricted:

> Every field is a public product fact, safe on every request: **no secrets, local paths, session ids, prompt text, or per-user identifiers** belong here, and nothing per-request may influence the values.

A white-label deployment may pass its own `AppIdentity`; **nothing can suppress attribution entirely** (omission falls back to the harness default).

```typescript
const response = await fetch(url, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    accept: 'text/event-stream',
    ...attributionHeaders(),          // do not forget this
  },
  body: JSON.stringify(body),
  signal,
})
```

The requirement is on the **wire request**, so if you delegate to an SDK, prove the header is set in the SDK's header hook.

---

## 12. Messages, content blocks and usage

**[verified]** The provider-neutral vocabulary in `@deepseek-ai/dsh-llm`. Switch on the discriminant and **fall through unknown values** — the maps are merge-extensible, so a plugin can add a block type your adapter has never seen.

### `ContentBlock`

| `type` | Shape | Notes |
|--------|-------|-------|
| `text` | `{ text }` | user-visible text |
| `reasoning` | `{ text }` | thinking content, distinct from visible text |
| `image` | `{ attachment: ImageAttachmentRef }` | durable raster reference; role-neutral, but only user messages may carry images in current production adapters |
| `file` | `{ attachment: FileAttachmentRef }` | durable verbatim file; **never reaches a provider natively** |
| `tool-call` | `{ id, name, arguments }` | `arguments` is the **raw JSON string** the model produced |
| `tool-result` | `{ toolCallId, content: ContentBlock[], isError? }` | nested content; tool results can carry images inside them |

`ContentBlockMap`, `FinishReasonMap` and `ModelModalityMap` are the merge-extensible maps behind these unions; `ContentBlock` is derived from the map, not hand-written.

> **Version note — read your installed types.** These unions have already widened on the harness's development branch. Newer revisions add `tool-addition` and `tool-removal` blocks (legal only in `developer`-role messages) and an `offloaded?: true` marker on `ImageBlock`, and they move tool results out of the content union into first-class `ToolResultMessage` values. If you switch on `block.type`, always include a default branch, and **check the `.d.ts` you actually build against** rather than assuming the shape above. That is exactly what the merge-extensible map design is for.

### Files never reach the provider **[invariant]**

> Files never reach a provider natively: request assembly projects every occurrence to deterministic handle text (name, byte size, and the read-only saved path), so adapters and providers see text in its place while the durable log keeps the structured reference for presentation and authorization.

Tooling that helps **[verified]**: `contentHasFile(content)`, `fileHandleText(ref, readonlyPath)`, `projectFilesToText(messages, resolvePath)`. Adapters do not have to implement the projection, but they must not try to serialize a `file` block as provider-native content.

### Images **[verified]**

Images go through the `attachments` **service**, never through a path. Helpers:

| Helper | Purpose |
|--------|---------|
| `contentHasImage(content)` | the one recursive image walk shared by every image policy (capability gating, text-only serialization, compaction survey) |
| `projectImagesForTextModel(messages)` | deterministic text placeholders for an exact text-only model |
| `offloadRequestImagesWithPolicy(messages, policy)` | deterministic oldest-first removal in whole count/byte quanta once a route budget is exceeded |
| `offloadedImagePrefixCount(lengths, policy)` | the count of leading occurrences the projection removes — lets pricing reproduce the decision without building the messages |
| `requestImageHandleText(ref, version, access?)` | stable model-facing handle for one exact request image |
| `textOnlyImageText(ref)`, `offloadedImageText(ref, access?)` | stable placeholders for an omitted image |
| `resolveImageAttachmentAccess(attachments, mapHostPath, ref)` | bridge a durable reference into the tool execution world |

If you support vision, declare `inputModalities: ['text', 'image']` in `resolveModel` and serialize `image` blocks to the provider's image part. If you do not, **project images to text** with the helpers rather than dropping them: a dropped image is an invisible loss of information, while a placeholder tells the model what it is missing.

### `TokenUsage` **[invariant]**

```typescript
interface TokenUsage {
  inputTokens: number          // UNCACHED input only
  outputTokens: number
  totalTokens?: number         // full-call total including aggregate prompt and output
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}
```

> Counts are **DISJOINT**: `inputTokens` is uncached input only; cached input is reported separately as `cacheReadTokens`/`cacheWriteTokens` (billed input = sum of the three). Adapters whose providers fold cache hits into a total prompt count (DeepSeek's `prompt_tokens`) **subtract them out**.

Getting this wrong inflates every cost report. Concrete example from a production adapter:

```typescript
export function mapUsage(usage: WireUsage): TokenUsage {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: usage.prompt_tokens - (cacheRead ?? 0),   // subtract the cache hit
    outputTokens: usage.completion_tokens,
    ...cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== undefined ? { reasoningTokens: reasoning } : {},
  }
}
```

`totalTokens` should be a provider total or derived from authoritative aggregate counters; **omit it when unavailable or inconsistent** rather than fabricating it.

### `FinishReason` **[verified]**

| `kind` | Meaning |
|--------|---------|
| `stop` | normal completion |
| `tool-calls` | the model wants tools executed |
| `max-tokens` | truncated by the output cap |
| `aborted` | carries `failure: LlmFailure` |
| `error` | carries `failure: LlmFailure` |

Map unknown provider stop reasons to `{ kind: 'error', failure: { message, code } }` rather than to `stop` — reporting an unrecognized termination as success hides provider problems.

### `LlmFailure` and `ReplayEnvelope` **[verified]**

`LlmFailure` is the serializable failure record: `{ message, code, status?, providerRetryAfterMs?, requestId? }` — the same facts `LlmError` retains beside the live `Error`.

`ReplayEnvelope` is **adapter-private lossless-JSON state for replaying a successful response**, carried by the terminal `finish` chunk:

```typescript
{ response: unknown, blocks?: readonly unknown[] }
```

Use it when the provider requires native metadata on follow-up calls (response ids, thinking signatures, cache markers):

- `response` — response-level metadata (ids, native stop reason).
- `blocks` — per-block metadata, **one entry per emitted block in first-seen stream order**. If assembly drops a block it drops the entry at the same position; if the envelope's entry count does not match the emitted block count, the whole envelope is discarded.
- An adapter whose metadata is independent of block structure **omits `blocks`** and the envelope passes through assembly unchanged.

`LlmRuntime` passes the envelope back only when the historical provider route and the target provider route are currently owned by the **exact same adapter instance**. Your adapter decides whether same-model, cross-model or cross-provider restoration is legal — and it must validate the state when rebuilding history. **Never infer native replay from provider/model names alone when state is absent.**

### `BlockAssembler` **[verified]**

The agent loop's canonical assembly algorithm, exported for plugin authors who need to interpret a chunk stream themselves:

| Member | Meaning |
|--------|---------|
| `push(chunk)` | feed one chunk |
| `blocks()` | one block per seen index; max-token truncation drops tool calls that cannot be executed safely |
| `interruptedBlocks()` | the prefix an interrupted stream can safely finalize: closed and open **text/reasoning** blocks with non-whitespace content — tool calls are omitted because interruption precedes dispatch |
| `usage`, `finish`, `replayState` | accessors, valid once the stream ends |
| `message(source?)` | the assembled frozen assistant message |

Two facts worth designing against:

- The assembler is **tolerant of delta-only protocols** (no `block-start`/`block-end`), which is why emitters that skip block boundaries still work.
- Deltas arriving for an index already closed by `block-end` are **ignored** (treated as malformed) so a misbehaving adapter cannot grow memory or corrupt a completed block.

---

## 13. Streaming and SSE translation

### Typical pipeline

```
HTTP response body (ReadableStream<Uint8Array>)
  → SSE parser (eventsource-parser)
  → AsyncIterable<string> (JSON payloads, ending with the DONE sentinel)
  → translator (state machine → StreamChunk)
  → AsyncIterable<StreamChunk>
```

### `StreamChunk`: the output contract **[verified]**

```typescript
type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: ToolCallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: ReplayEnvelope }
```

The protocol obligations the two shipped adapters were verified against **[verified]**:

- Emit `usage` **before** `finish`; emit **nothing** after `finish`.
- Allocate block `index`es in **first-seen stream order** and reuse the index for every delta of the same block.
- Tool-call `arguments` are **raw JSON strings end-to-end**. Stream fragments as `argumentsDelta`; if your provider hands back parsed objects, **re-stringify at `block-end`**.
- Every `block-start` has a matching `block-end` — in the documented protocol. In practice the assembler is delta-tolerant (§12), so a missing boundary degrades rather than breaks; do not rely on that tolerance.
- Adapters **may throw**; `LlmRuntime.stream()` normalizes that to a terminal `error`/`aborted` finish before consumers see it.

**The robust flush pattern**: buffer `finish` and `usage` until the provider's end-of-stream marker, then flush. This handles both shapes — usage attached to the finish chunk, and a trailing usage-only chunk — and guarantees the ordering rule above.

### Emitting a block

```typescript
yield { type: 'block-start', index: 0, blockType: 'text' }
yield { type: 'text-delta', index: 0, text: 'Hello' }
yield { type: 'text-delta', index: 0, text: ' world' }
yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello world' } }

yield { type: 'block-start', index: 1, blockType: 'tool-call' }
yield { type: 'tool-call-delta', index: 1, id: callId, name: 'bash', argumentsDelta: '{"command":"ls"}' }
yield { type: 'block-end', index: 1, block: { type: 'tool-call', id: callId, name: 'bash', arguments: '{"command":"ls"}' } }

yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } }
yield { type: 'finish', reason: { kind: 'stop' } }
// or { kind: 'tool-calls' } to request tool execution
```

### Streaming state machine

The translator keeps one open block per index, keyed by block kind:

```typescript
interface OpenBlock { index: number; kind: 'text' | 'reasoning' | 'tool-call'; text: string; callId?: string; name?: string }

export async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textBlock: OpenBlock | undefined
  let reasoningBlock: OpenBlock | undefined
  const toolBlocks = new Map<number, OpenBlock>()   // keyed by the WIRE tool index
  const order: OpenBlock[] = []                     // emission order for flush
  let pendingFinish: FinishReason | undefined
  let pendingUsage: TokenUsage | undefined

  for await (const payload of payloads) {
    if (payload === DONE) {
      for (const block of order) yield { type: 'block-end', index: block.index, block: closeBlock(block) }
      if (pendingUsage !== undefined) yield { type: 'usage', usage: pendingUsage }
      yield { type: 'finish', reason: pendingFinish ?? { kind: 'stop' } }
      return
    }
    // parse, then handle delta.reasoning_content / delta.content / delta.tool_calls
  }
  throw new LlmError('SSE payload stream ended without the done sentinel', 'STREAM_CLOSED')
}
```

### SSE rules that bite

| Situation | Correct behaviour |
|---|---|
| EOF without the done sentinel | throw `LlmError(..., 'STREAM_CLOSED')` |
| Malformed JSON payload | throw `LlmError(..., 'MALFORMED_RESPONSE')`, truncating the payload in the message |
| Chunk with missing or non-array `choices` | **provider keepalive ping** — skip silently, do not throw |
| Empty first reasoning delta | do **not** open a block; wait for non-empty text |
| Finish with zero open blocks and kind `stop` | degenerate completion → `EMPTY_RESPONSE`, not a successful empty message |
| Usage attached to finish **or** trailing | keep the latest, emit once, before `finish` |
| Reasoning interleaved with text | emit all `reasoning` deltas for a block before/independently of the `text` block; thinking models emit reasoning first |

The "keepalive ping" rule and the "empty delta must not open a block" rule are both about the same failure: a phantom empty block in the transcript.

### Abort, timeout and idle detection

**[verified]** Do not hand-roll stream cancellation. `@deepseek-ai/dsh-timeout` provides the shared arithmetic:

```typescript
import { clampTimeout, deadline, idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'

// Validate a caller hint before it reaches the deadline layer.
const timeoutMs = clampTimeout(requested, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, 'myplugin: request.timeoutMs')

// One unit of work under a caller-visible timeout, fused with upstream cancellation.
using d = deadline(upstream, timeoutMs, 'MY_TIMEOUT')
const response = await fetch(url, { signal: d.signal })   // the signal only NOTIFIES
const timedOut = timeoutOf(d.signal, 'MY_TIMEOUT') !== undefined
const aborted = d.signal.aborted && !timedOut

// A streamed transport: the timer runs only while an iterator next() is outstanding.
using watchdog = idleWatchdog(upstream, idleMs, 'LLM_STREAM_IDLE_TIMEOUT')
const next = await watchdog.next(providerIterator)
```

Semantics that matter:

- **The signal only notifies.** The caller must still attach its own termination — hand `d.signal` to `fetch`, or listen for `abort` and kill the child. Racing a promise against a timer resolves the tool call while the socket or process leaks on.
- `timeoutOf(signal, code)` recovers the timeout reason **only when this deadline's timer fired first**, and only when you pass your own `code`. Nesting composes: a foreign timeout reads as an ordinary upstream cancellation. This is how you distinguish "the provider was slow" from "the user cancelled".
- **An idle watchdog is not a total deadline.** It rearms per outstanding read and deliberately excludes consumer think time, and `pulse()` rearms it for transport activity that yields no value. Use it for streaming, and a `deadline` for a whole request.
- `timeoutMs <= 0` arms no timer (internal vocabulary for backend-owned untimed work). Validate public hints with `clampTimeout`, which rejects non-positive and non-finite values.
- Local file `read`/`write`/`edit` deliberately take **no** timeout: a deadline would kill work the OS will still finish.

### The abort-classification pattern

```typescript
try {
  for await (const chunk of translate(parseSse(response.body))) yield chunk
} catch (err) {
  if (timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT') !== undefined) {
    throw new LlmError(`stream idle for ${conn.streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: err })
  }
  if (options.signal?.aborted) throw new LlmError('caller aborted', 'ABORTED', { cause: err })
  if (err instanceof LlmError) throw err
  throw new LlmError(`transport error: ${(err as Error).message}`, 'TRANSPORT', { cause: err })
} finally {
  controller.abort()      // release the socket on every exit path
}
```

Order matters: **check the timeout first, then the caller's abort, then re-throw your own `LlmError`, then wrap.** Checking the caller's signal first mislabels a local idle timeout as a user cancellation, and wrapping a known `LlmError` destroys its code.

### Buffering and bounds

- Parse incrementally; never accumulate the whole body before translating. A long completion must stream.
- Bound any non-streaming read. A production listing probe refuses a body larger than 4 MB, checks a declared `content-length` first, then counts bytes while reading, and cancels the reader in a `finally`. Apply the same discipline to any JSON endpoint you add.
- Prefer `AbortSignal.any([upstream, timer])` over manual listener juggling.

---

## 14. Tools

**[verified]** Tools are registered into `ctx.tools` (the `ToolRuntime` service) and their schemas flow into system-prompt assembly **automatically** — registering a tool is enough to make it visible to the model.

### `defineTool` — the minimal shape

```typescript
import { readFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',          // what the model sees
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path' },
      limit: { type: 'number' },                     // optional by default
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      // args is TYPED from the schema: { path: string; limit?: number }
      // exec carries immutable identity + token; signal is the operational field
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}
```

Corrections to earlier drafts of this guide, because they are easy to get wrong:

- There is **no** `output.render`-less form and **no** `parameters[name].type = 'string'`-only form: `parameters` is a map of *schema nodes*, and `required: true` is a per-property annotation.
- `execute(args, exec)` takes **two** arguments. The second one is not optional decoration — it carries `exec.signal`, and ignoring it means your tool cannot be cancelled.
- Registration is **effect-based**: disposing the plugin fiber unregisters the tool.

### The `execute()` contract **[verified]**

1. **Args are validated for you.** `defineTool` validates the model-generated arguments against the unified parameter DSL (types, required keys, literal constraints, exact-one unions, nested values) before `execute` runs, so inside `execute` the args match `InferArgs`. You still hand-check what the DSL cannot express: non-empty strings, positive numbers, cross-field rules.
2. **The parameter root is an implicit *open* object**; explicit object nodes must declare `additionalProperties: true | false`.
3. **Return one canonical JSON value.** `output.schema` declares it; `execute` returns only that value. The registry snapshots it as lossless JSON, validates it, freezes it, and then calls `output.render(args, value)`. **Do not return content blocks from the body and do not make callers parse prose for ids and fields.**
4. **Throwing means `isError`.** The registry catches throws and also contains schema, renderer, metadata-projector and lossless-JSON failures before observers run. Throw for infrastructure failures. Represent a *successful* domain outcome in the canonical value even when the renderer has to explain a non-ideal state (a non-zero process exit, for instance).
5. **Honor `exec.signal`.** Cancel in-flight work when it fires.
6. **Do not mutate the definition after registration.** Registration borrows your readonly definition — it is a same-process trusted contract, not a serialization boundary. To hot-swap a tool, dispose its owning effect and register the replacement; mutable state inside the callback's closure is ordinary plugin state and may change freely.

### The parameter DSL **[verified]**

- Supported nodes: `string`, `number`, `integer`, `boolean`, `null`, `array`, `object`, `json` (author-only), and exact-one `oneOf`.
- Scalar `enum`/`const` must match the node type.
- `InferArgs<P>` yields required/optional keys; `InferValue<S>` is exact through 16 container levels and then widens to `JsonValue`.
- Runtime failures: a parameter mismatch throws `ToolArgsError` (`INVALID_ARGS`); an invalid body or post-policy value throws `ToolOutputError` (`INVALID_TOOL_OUTPUT`). Both take the normal tool-error path, so the model sees a failed call rather than a crashed turn.
- **Raw JSON Schema is also accepted** by `ctx.tools.register()` directly — that is how MCP-sourced tools arrive. The enforced subset is `type` (object/array/string/number/integer/boolean/null), `oneOf` (≥2 branches, exactly one must match), `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, plus the annotations `description`/`title`/`default`/`examples`. **Unsupported keywords are rejected, not silently accepted**, which is the right default: a keyword you thought was enforced is worse than a load error.
- Use `defineTool` for first-party typed tools; use raw JSON Schema only when the schema comes from outside your process.

### The full definition surface **[verified]**

`ToolDefinition` is `ToolSchema` (`name`, `description`, `parameters`, plus optional `deferLoading?: true`) **plus**:

| Field | Purpose |
|-------|---------|
| `output` | `{ schema, render(args, value), presentationMeta?(args, value) }` |
| `execute(args, exec)` | the body |
| `projectContent?(exec, result)` | execution-prepared content, installed **before** post-execute policies |
| `finalizeContent?(exec, result)` | synchronous last-mile content transform; must be total and must not throw |
| `timeoutMs?` | **declarative only** — never sent to the model and never enforced by the registry; enforcement requires the timeout-policy wrapper |
| `isConcurrencySafe?(args)` | only an exact `true` opts into parallel dispatch; everything else is exclusive |
| `presentCall?(args)` / `presentResult?(args, result)` | Host-side UI card projections (§below) |

`ctx.tools.schemas(scope?)` builds the model-facing `ToolSchema[]` by **explicit allowlist** — `output`, `execute`, `projectContent`, `finalizeContent`, `timeoutMs`, `isConcurrencySafe` and the presenters **never leak onto the wire**. If you add a field to your definition, assume the model cannot see it unless the registry projects it.

### The engine: `ctx.tools` methods **[verified]**

```typescript
ctx.tools.register(definition)                  // → disposer; effect-scoped
ctx.tools.restrict(filter)                      // { allow?: string[]; deny?: string[] } → disposer
ctx.tools.get(name, scope?)                     // → ToolDefinition | undefined
ctx.tools.schemas(scope?)                       // → ToolSchema[] (no execute functions)
ctx.tools.guard(guard)                          // monotonic deny → disposer
ctx.tools.presentAs(mode)                       // per-agent presentation: native | ptc | both
ctx.tools.executionMode(execInput)              // { kind: 'parallel' } | { kind: 'exclusive' }
await ctx.tools.execute(execInput)              // run a call through the pipeline
```

Behaviour worth knowing:

- **`restrict()` masks intersect**, scoped registrations stay visible, and the restriction lifts when disposed. Use it for tool filtering that must stay aligned across presentation, lookup and execution — do not filter schemas by hand.
- **`guard()` is monotonic**: `ToolGuard` has no "allow" result, so no later listener can turn a denial back into permission. A plain-context guard is global; one registered through `agent.ctx` applies only to that agent.
- `deferLoading: true` is preserved by `defineTool`, by schema projection and by assembly: it requests deferred definition loading. It does **not** create a tool-addition record.

### The execution pipeline **[verified]**

```
tools/pre-execute        (waterfall, extensible: allow / deny / ask / cancel)
  → registered monotonic guards
    → tools/execute      (waterfall, around-dispatch: deadlines, retries, metrics)
      → projectContent   (definition-owned, execution-prepared content)
        → tools/post-execute (waterfall: replace content or value, block, attach context)
          → finalizeContent  (definition-owned, synchronous, total)
            → tools/result   (emit, observe-only, immutable final outcome)
```

Choosing where to attach:

| You want to… | Attach at | Why not the neighbours |
|---|---|---|
| allow/deny/ask per call | `tools/pre-execute` | reorderable policy layer; returns a typed decision |
| an invariant denial nobody can undo | `ctx.tools.guard()` | monotonic; no allow result |
| a deadline, retry or metric around dispatch | `tools/execute` | the only view that may replace `exec.signal` |
| transform the result or attach model-facing context | `tools/post-execute` | explicit result transformation |
| observe the final outcome (audit, metrics, capture) | `tools/result` | contained, immutable, cannot veto |

**`tools/pre-execute` deliberately cannot rewrite `exec.arguments`** — logged and rendered arguments would desync from what actually ran. If you need to change the input, you are describing a different tool (or a wrapper tool).

### Deciding allow / deny / ask **[verified]**

```typescript
type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string; info?: ToolErrorInfo }
  | { kind: 'cancel' }
  | { kind: 'ask'; reason?: string; displayReason?: { readonly en: string; readonly [locale: string]: string } }
```

```typescript
ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
  if (!(await isAllowed(exec))) return { kind: 'deny', reason: 'Denied by policy.' }
  return next()
})
```

`ask` runs the call **only after an approval service returns `allowed-once`**; a non-grant, a missing approval channel or service, or an agent-less request all become a denial. That fail-closed default is deliberate.

`deny` may carry `ToolErrorInfo` (`{ name, code, reason? }`) beside its model-facing reason. The structured detail is preserved in durable projections but **is not added to model content** — the model sees exactly `Error: <message>`.

### Tool errors and cancellation **[verified]**

| Situation | Code |
|---|---|
| Call cancelled before the body was invoked | `ABORTED_BEFORE_DISPATCH` |
| Call cancelled after invocation (replaces only a successful outcome) | `ABORTED` |
| Ownership deadline elapsed | `TOOL_TIMEOUT` |
| Unknown tool, or a tool that threw | structured `UNKNOWN_TOOL` |
| Parameter mismatch | `INVALID_ARGS` |
| Invalid returned value | `INVALID_TOOL_OUTPUT` |

A failed or denied call becomes exactly `Error: <message>` for the model, so **a tool failure does not end the turn** — the model can read the error and adjust. Design your messages accordingly: write them for a model that will try again, not for a human reading a stack trace.

### Content beyond the canonical value **[verified]**

- `output.presentationMeta(args, value)` derives **replayable JSON** from the same canonical value. The core persists it on `tool/result` and hands it to `presentResult`, so a card that needs result-time facts (applied hunks, for example) survives replay without persisting the canonical value. It is skipped for nested `run_code` dispatches, which have no cards.
- `exec.agent.inject({ content, source: { kind: 'my-plugin' } })` appends durable context that the **next** model request sees. It is **not a wake-up**: an idle agent stays idle. Declare your `kind` through `MessageSourceMap` in your plugin, and guard against disposed agents with a `try/catch`.
- **Once `ctx.jobs.start()` publishes an id, switch to a task-owned cancellation signal** rather than `exec.signal`: later outer-call cancellation stops waiting for the call but must not kill published work. `job_kill`, owner disposal and service teardown own that lifetime. Foreground work stays coupled to `exec.signal`.

### Long-running work: background jobs **[verified]**

Gate a `run_in_background` parameter behind producer config, then register through the jobs runtime:

```typescript
const job = ctx.jobs.start({ kind: 'my-task', label, owner: exec.agent, run })
```

The registry rejects a pre-aborted invocation before the producer body, and the runtime validates ownership and task-controller availability before `run()` starts, then supplies the id, session fence, generic control tools, notices and owner cleanup. A successful background branch returns a **typed canonical handle** such as `{ kind: 'background', jobId }` — its renderer may keep human prose, but PTC mode must never parse that prose to recover the id.

### Distinguishing tools in the transcript

Give every tool a clearly different `name` and `description`. The model chooses on the schema text alone, so two tools with overlapping descriptions produce unpredictable selection. If two capabilities are variations of one, prefer **one tool with a discriminating parameter** over two near-identical tools: it halves the schema cost and removes a class of wrong-tool errors.

### Presenting a tool in a UI **[verified]**

`presentCall(args)` and `presentResult(args, result)` are **Host-side** presenters returning a `card`-tagged render intent:

- `presentCall` → `ToolCallView`: `{ card: 'generic', title, kind?, rawInput?, content?, locations? }` | `{ card: 'terminal', title, description?, cwd? }` | `{ card: 'diff', title, diffs, locations? }`
- `presentResult` → `ToolResultView`: `generic` | `terminal` | `diff` | `read` | `search` | `web`
- `ToolCallKind`: `read | edit | delete | move | search | execute | fetch | other`.

Hard rules:

- **Purity.** These run on live streaming **and** on session-log replay, so they must be pure functions of `args` (plus the result): no I/O, no reading session state, no clock, no randomness. If you want the file's old content or the working directory inside `presentCall`, stop — that belongs in durable result metadata or the UI adapter.
- **UI-only formatting stays out of the model result.** Fenced ```` ```console ```` blocks, diffs and relativized paths must not enter the canonical value or the rendered content merely to serve a UI.
- `defineTool` **soft-validates** the display path: malformed or older logged arguments make the wrapper return `undefined` (generic fallback) rather than throw, because display must never crash a replay.
- **The built-in Web Client does not consume `presentCall`/`presentResult`.** It selects a renderer through the `tool.call.toolview` keyed slot and derives card props from the raw call arguments, result content, failure state and persisted metadata. Defining Host presentation methods alone does **not** add a specialized Web card; that requires a client plugin (§20).

### PTC mode (`run_code`) **[verified]**

Under `ptc` or `both` presentation, the registry exposes the reserved `run_code` transport plus a generated SDK, and **every visible registered tool is reachable as `await tools.<name>(args)` with no extra integration**. Consequences for tool design:

- `output.schema` is a **programmatic API**: return handles and fields directly, allow scalar/array/null roots when that is the honest value, and keep human explanation in `output.render`.
- A successful call resolves to the final canonical JSON value **after policy**; a failed call rejects with a real `ToolCallError` exposing only `name`, `toolName` and the human-readable `message`.
- `ptc` mode is a per-*agent* presentation, not per-tool: within one agent, no tool can be native-only while another is PTC-only.

### Tool registration checklist

- [ ] `name` is unique, snake_case, and stable (it is in the transcript forever).
- [ ] `description` says what the tool does and when to use it.
- [ ] Every parameter has a `description`; `required: true` only where truly required.
- [ ] `output.schema` is the smallest honest shape; `render` produces the model-facing text.
- [ ] `execute` returns only the canonical value and honors `exec.signal`.
- [ ] Domain failures are values; infrastructure failures are throws.
- [ ] No I/O, clock or randomness in the presenters.
- [ ] Registration is inside `apply`, so it disappears on unload.

---

## 15. Model discovery

Discovery answers "which models does this endpoint offer?" for a configuration page that is **still being edited**. That framing explains every API detail.

### The discovery contract **[verified]**

```typescript
ctx.llm.registerModelDiscovery(
  settingsNs: string,
  discover: (request: LlmModelDiscoveryRequest, signal?: AbortSignal)
    => Promise<readonly LlmDiscoveredModel[]>,
): () => void
```

```typescript
interface LlmModelDiscoveryRequest {
  provider?: string   // route being edited, when it edits an existing one
  baseURL?: string    // endpoint to interrogate; optional when the adapter
                      // already describes the route
  api?: string        // wire protocol the endpoint speaks
  apiKey?: string     // credential for THIS interrogation alone; never stored
}

interface LlmDiscoveredModel {
  id: string
  name?: string
  contextWindow?: number   // max combined request + response context
  maxTokens?: number       // max output tokens
}
```

Rules that follow from "the request describes a draft, not a stored route":

- **Nothing here reads or writes settings or credentials.** The caller owns both. The `apiKey` is a one-shot credential and the harness never stores it — so never log it and never persist it.
- The namespace key is the `settingsNs` your configurable providers declare. It is the key because that is what a configuration surface already holds from the provider directory, and because a provider *being added* has no route to name yet.
- **Honor the optional `signal`.** Implementations must settle promptly after it aborts. A user who closes the "add provider" dialog should not leave a request open.
- If `provider` names a route the adapter already knows, **answer from that knowledge instead of asking the endpoint** — the adapter's own registry is the better answer and it costs no network call.
- Every field but `id` is optional because most listings disclose an id and nothing else. A surface adopting one of your entries still owes the capacities its adapter needs, so `contextWindow`/`maxTokens` are valuable when you can get them.

### TTL cache pattern

```typescript
export class ListingCache {
  private entry: { expiresAt: number; listing: ModelInfo[] } | undefined

  constructor(
    private readonly fetcher: () => Promise<ModelInfo[]>,
    private readonly ttlMs: () => number,
  ) {}

  async get(): Promise<ModelInfo[]> {
    const now = Date.now()
    if (this.entry && this.entry.expiresAt > now) return this.entry.listing
    const fresh = await this.fetcher()
    this.entry = { expiresAt: now + this.ttlMs(), listing: fresh }
    return fresh
  }

  invalidate(): void { this.entry = undefined }
}
```

- Read `ttlMs` through a **thunk**, not a captured number, so a config edit takes effect without rebuilding the cache object.
- **Invalidate after every state-changing operation** (model load/unload, endpoint change, settings write). Forgetting this is the classic "the model I just loaded is unrecognized for the next 30 seconds".
- A single in-flight promise per key is worth adding if the same listing is requested concurrently; otherwise N callers cause N requests after a TTL expiry.

### Best practices

- **Short TTL** (30 s is a reasonable default): balances freshness against server load.
- **Bound the response.** A production probe refuses a listing body larger than 4 MB, checks a declared `content-length` first, counts bytes while streaming, and cancels the reader in a `finally`.
- **Prefer the richer endpoint, fall back to the compatible one.** A native endpoint often discloses load state, per-model context and modality; the OpenAI-compatible `/v1/models` usually discloses only ids. Treat a failure of the richer endpoint as a downgrade, not an abort:

```typescript
try {
  return await probeNative(root, apiKey, fused)
} catch (err) {
  if (fused.aborted) throw err   // real cancellation/timeout: do not fall back
  // native is best-effort; the compatible listing is the documented address
}
return probeCompat(baseURL, apiKey, fused)
```

Note the `if (fused.aborted) throw err` line: falling back after a timeout or a cancellation doubles the wait and hides the real cause.

- **Deduplicate and preserve endpoint order.** The runtime already deduplicates in endpoint order for `discoverModels`; do not randomize or sort by a heuristic the user did not ask for.
- **Never make discovery a prerequisite for a request.** Catalog membership is advisory. A model the user typed that your listing does not mention must still work.

---

## 16. Timeouts, cancellation and concurrency

### Three different clocks

Confusing these is a design bug, not a configuration detail.

| Clock | Question it answers | Mechanism |
|-------|--------------------|-----------|
| Request deadline | "How long may this whole operation take?" | `deadline(signal, ms, code)` |
| Stream idle timeout | "How long may the transport go silent?" | `idleWatchdog(signal, ms, code)` |
| Consumer think time | (deliberately excluded from both) | — |

An `idleWatchdog` arms its timer **only while an iterator read is outstanding** and rearms on `pulse()`, so time the *consumer* spends processing a chunk never counts as idle. A `deadline` covers the whole unit of work. Use both: a deadline for the call, a watchdog for the stream.

### Fuse, don't replace

```typescript
const controller = new AbortController()
const upstream = options.signal === undefined
  ? controller.signal
  : AbortSignal.any([options.signal, controller.signal])

using watchdog = idleWatchdog(upstream, conn.streamIdleTimeoutMs, 'LLM_STREAM_IDLE_TIMEOUT')
```

`AbortSignal.any` adopts the reason of whichever source aborts first, so a race resolves to a single cause — which is exactly what `timeoutOf(signal, code)` later needs in order to tell "the timer won" from "the caller cancelled". Never build this with manual `addEventListener` bookkeeping: it leaks listeners and mislabels causes.

### Classification, in order

```typescript
if (timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT') !== undefined) → TIMEOUT
if (options.signal?.aborted)                                           → ABORTED
if (err instanceof LlmError)                                           → rethrow (keep the code)
otherwise                                                              → TRANSPORT (wrap with cause)
```

### Per-model concurrency

Serializing backends (a single local model, a per-key rate limit, a GPU with one slot) need a limiter *per model*, not per plugin: one global semaphore would make a fast model wait behind a slow one.

```typescript
export class Semaphore {
  private current = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly capacity: number) {}

  async acquire(signal?: AbortSignal): Promise<void> {
    if (this.current < this.capacity) { this.current++; return }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const idx = this.waiters.indexOf(entry)
        if (idx >= 0) this.waiters.splice(idx, 1)
        reject(new DOMException('AbortError', 'AbortError'))
      }
      const entry = () => {
        signal?.removeEventListener('abort', onAbort)
        this.current++
        resolve()
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.push(entry)
    })
  }

  release(): void {
    this.current--
    const next = this.waiters.shift()
    if (next) next()
  }
}
```

Rules:

- **Always acquire inside a `try` whose `finally` releases.** A stream that throws mid-iteration without releasing permanently shrinks your capacity.
- **Propagate the abort into the queue** (as above) so a cancelled request does not hold a slot. A queue that ignores `signal` is a deadlock waiting for a user to cancel.
- **Key the map by model id** and build the semaphore lazily, so new models from discovery work without reconfiguration.
- Pair the limiter with an observable queue depth; a silent queue is indistinguishable from a hang.

### Cancellation is cooperative **[invariant]**

The signal **only notifies**. Every capability must attach its own termination: hand the signal to `fetch`, close the response body, abort the SDK request, kill the child process. A promise raced against a timer resolves the caller's promise while the socket or process keeps running — that is a leak, not a cancellation.

---

## 17. Resilience patterns

### Per-request resolver: the single most important pattern **[invariant]**

**Never capture config at registration time.** Capture a *thunk* and read it per operation.

```typescript
// WRONG: captures config at registration. Settings edits do nothing
// until the provider is re-registered — and the UI shows the new value,
// so the failure is invisible.
const baseURL = config.baseURL
ctx.llm.registerAdapter(['my-provider'], new MyAdapter({ baseURL }))

// CORRECT: resolves per request.
let current: () => Config = () => initialConfig
ctx.llm.registerAdapter(['my-provider'], new MyAdapter({
  resolveConn: () => current(),
  resolveApiKey: async (c) => { /* resolve per request */ },
}))
```

Why this matters twice over:

1. The provider stays registered while its settings change, so it never becomes invisible in the model picker.
2. `prepareCall` semantics require that the capability answers and the dispatch come from the **same adapter generation** — a thunk read at call time is what makes that true.

A refined version keeps a memoized `lastGood` snapshot so a transiently invalid edit does not break a working connection:

```typescript
export function makeResolver(getConfig: () => Config): () => ResolvedConnection {
  let lastRaw: Config | undefined
  let lastGood: ResolvedConnection | undefined

  return () => {
    const raw = getConfig()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      lastGood = project(raw)
      lastRaw = raw
      return lastGood
    } catch (err) {
      if (lastGood === undefined) throw err   // a bad snapshot at boot propagates
      lastRaw = raw
      return lastGood                          // keep serving; log the bad edit
    }
  }
}
```

A resolver that throws on every transient edit turns a typo in a settings field into an outage. Log the rejected snapshot (redacted) and keep the last good one.

### Fallback chain

```typescript
export async function* streamWithFallback(
  runStream: (model: string) => AsyncIterable<StreamChunk>,
  chain: readonly string[],
  signal?: AbortSignal,
): AsyncIterable<StreamChunk> {
  const recoverable = new Set(['TRANSPORT', 'TIMEOUT', 'SERVER', 'RATE_LIMIT'])
  let lastError: Error | undefined

  if (chain.length === 0) throw new LlmError('fallback chain is empty', 'INVALID_REQUEST')
  for (const model of chain) {
    if (signal?.aborted) throw new LlmError('aborted', 'ABORTED')
    try {
      yield* runStream(model)
      return
    } catch (err) {
      if (signal?.aborted) throw new LlmError('aborted', 'ABORTED')
      if (err instanceof LlmError && recoverable.has(err.code)) { lastError = err; continue }
      throw err
    }
  }
  throw lastError ?? new LlmError('all fallbacks exhausted', 'TRANSPORT')
}
```

Design notes:

- The recoverable set must **mirror** `retryableCodes` in your retry policy; two independent lists drift, and the drift is invisible until an incident.
- **Check the abort signal on both paths** (before trying and in the catch). Without the second check, cancel-during-failure keeps walking the chain.
- Re-stringify/rebuild the request body per model if the provider needs the model id inside the body (as Chat Completions does).
- A fallback is user-visible: emit a metric (`from`, `to`, `reason`) so a silently degrading deployment is diagnosable.
- **Do not nest a fallback chain inside a retry policy's scope** without thinking about the multiplicative cost: N models × M retries per model.

### Circuit breaker

```typescript
export function createCircuitBreaker(threshold = 5, resetTimeoutMs = 60_000) {
  let failures = 0
  let lastFailureAt: number | undefined
  let state: 'closed' | 'open' | 'half-open' = 'closed'

  return {
    canExecute(): boolean {
      if (state === 'closed') return true
      if (state === 'open') {
        if (Date.now() - (lastFailureAt ?? 0) > resetTimeoutMs) { state = 'half-open'; return true }
        return false
      }
      return true // half-open: let one request probe
    },
    recordSuccess(): void { failures = 0; state = 'closed' },
    recordFailure(): void {
      failures++
      lastFailureAt = Date.now()
      if (failures >= threshold) state = 'open'
    },
  }
}
```

Use a breaker only where a hard failure is expected to persist (a local server that is down). For a hosted API, the host's retry policy plus backoff is usually enough, and a breaker adds a state machine that can itself get stuck open.

### Health check

A periodic health probe is worth it exactly when the user can fix the problem (a server that is not running, a model that is not loaded). Keep it cheap and make its state transitions visible:

```typescript
const hc = new HealthCheck(baseURL, () => resolveApiKey(resolveConn()), intervalMs,
  (healthy) => logger.info({ healthy }, 'health changed'))
hc.start()
ctx.effect(() => () => { hc.stop(); /* reset gauges */ })
```

The effect is what stops the interval on unload, including during HMR.

### Token pre-flight

Reject an oversized request **before** the HTTP call: it saves the round trip and produces a better error than the provider's.

```typescript
const preflight = fitsContext(options, counter, contextWindow, outputCap)
if (!preflight.fits) {
  throw new LlmError(
    `request exceeds context window: ~${preflight.inputTokens} in + ${outputCap} out > ${contextWindow}`,
    CONTEXT_WINDOW_EXCEEDED_CODE,
  )
}
```

Prefer a **real tokenizer** over a heuristic when the provider's tokenization is known; a heuristic that underestimates produces exactly the overflow you were trying to prevent. Use the canonical `CONTEXT_WINDOW_EXCEEDED` code so the harness's own overflow-recovery path can act on it.

### What NOT to reimplement

| Already provided | Where | Do not |
|---|---|---|
| Retry with backoff and jitter | `providerRetryPolicy` + `dsh-llm-retry` on `agent/request-error` | sleep-and-retry inside `stream()` |
| Timeout arithmetic and cancel classification | `@deepseek-ai/dsh-timeout` | hand-rolled timer races |
| Chunk assembly | `BlockAssembler` | write your own accumulator |
| Overflow detection wording | `isContextWindowExceededError`, `isQuotaExceededError` | regex the provider message yourself |
| Failure-chain rendering | `errorChain` | `String(err)` |
| API-key validation | `normalizeApiKey`, `assertUsableApiKey` | `if (!key) throw` |

---

## 18. Settings, live configuration and credentials

A plugin has up to three configuration surfaces. Know which one you are building.

| Surface | Who renders it | How the plugin reads it |
|---------|----------------|-------------------------|
| Plugin `Config` | The product-owned Plugins page, automatically, when fields are `.volatile()` | `config.field.get()` per operation |
| A richer custom settings section | Your own `installSection` registration | A `setSource` thunk you own |
| Credentials | Shareable credential UI / environment | `ctx.credentials.resolve(ref)` per operation |

### Installing a custom settings section **[verified pattern]**

```typescript
ctx.inject(['settings'], (sc) => {
  sc.settings.installSection(ctx, 'my-plugin', ConfigSchema as never, initialConfig, {
    setSource: (s: () => Config) => { current = s; cache.invalidate() },
    onChange: () => { cache.invalidate() },
  })
})
```

- `setSource` **swaps the active config getter**. This is the mechanism that makes the per-request resolver pattern work: after the swap, the very next operation reads the new values with no re-registration.
- `onChange` is where you **invalidate caches**. Any cached derived value (a listing, a resolved endpoint, a capability map) is now stale.
- The namespace string (`'my-plugin'`) must match the `settingsNs` you declare in `registerConfigurableProviders`, or the configuration surface will not be able to associate the section with the provider.

**[unverified]** The exact `installSection` signature and options beyond `setSource`/`onChange`; the type of `sc` depends on the settings package version. Read the installed `@deepseek-ai/dsh-settings` types before relying on additional options.

### Credentials **[verified]**

Configuration holds a **reference**, never a value. `CredentialRef` is a branded environment-variable-name string, and values are never in configuration.

```typescript
const resolveApiKey = async (conn: ResolvedConnection): Promise<string> => {
  if (conn.apiKeyEnv === undefined) return 'lm-studio'   // dummy bearer for a keyless local server
  const credentials = ctx.get('credentials')
  const hit = await credentials?.resolve(conn.apiKeyEnv as never)
  const value = (hit as { value?: unknown } | undefined)?.value
  if (typeof value === 'string' && value.length > 0) return value
  throw new LlmError(
    `no API key for ${String(conn.apiKeyEnv)}; configure credentials or unset apiKeyEnv`,
    'MISSING_CREDENTIAL',
  )
}
```

The `credentials` service exposes `resolve(ref)`, `describe(ref)`, `set(ref, value)`, `unset(ref)`, plus record-level operations (`readRecord`, `describeRecord`, `listRecords`, `modifyRecord`, `deleteRecord`). Values cross from the credential UI to the host in **one direction only** — this is why `.role('secret')` keeps a value out of form responses (§6).

Rules:

- **Resolve per operation**, never at registration. A rotated credential must take effect on the next request.
- **Never log a credential or any part of one.** Throw a diagnostic that names the **reference** instead: that is what `assertUsableApiKey(raw, pkg, ref)` does, and the reason it lives where it does.
- Use `normalizeApiKey(raw)` to judge a supplied key before it reaches `fetch`. It silently trims surrounding whitespace (because a padded key has one unambiguous reading) and reports every other defect — `empty` or `illegalCharacters`. A key with illegal characters fails inside `fetch` as a `ByteString` error naming a UTF-16 code point, which is useless to the user.
- Distinguish **absent** from **malformed**: `MISSING_CREDENTIAL` tells the user to supply one; `INVALID_CREDENTIAL` tells them to fix it. The second is deliberately outside the default retryable set, because a malformed credential fails identically on every attempt.
- If a route genuinely needs no credential (a local server), make that explicit with a configured sentinel rather than by accepting an empty string.

---

## 19. Observability, logging and security

### Structured logging **[verified pattern]**

Use the Cordis logger (`ctx.logger(name)`) or a structured logger of your own, with **redaction configured at the logger**, not at the call site:

```typescript
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'res.headers["x-api-key"]',
  'apiKey', '*.apiKey',
  'apiKeyEnv', '*.apiKeyEnv',
  'bearer', '*.bearer',
]

export const logger = pino({
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  level: process.env.MY_PLUGIN_LOG_LEVEL ?? 'info',
  name: 'dsh-my-plugin',
})
```

Redacting at serialization time is what makes `logger.info({ req }, ...)` safe by construction. A call-site discipline ("remember not to log the headers") fails the first time someone logs a whole request object.

- Read the level from an **environment variable** so a user can debug without editing config.
- Log **transitions**, not steady state: health changes, cache invalidations, fallback activations, registration and disposal.
- Include the model and provider in every request-scoped line; without them, a multi-model deployment is undebuggable.

### Metrics **[verified pattern]**

```typescript
export const metrics = {
  ttft: new Histogram({ name: `${prefix}_ttft_seconds`, labelNames: ['model'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10] }),
  tokens: new Counter({ name: `${prefix}_tokens_total`, labelNames: ['model', 'kind'] }),
  queueDepth: new Gauge({ name: `${prefix}_queue_depth`, labelNames: ['model'] }),
  errors: new Counter({ name: `${prefix}_errors_total`, labelNames: ['model', 'code'] }),
  fallbacks: new Counter({ name: `${prefix}_fallback_total`, labelNames: ['from', 'to', 'reason'] }),
}
```

- Sanitize the prefix (`p.replace(/[^a-zA-Z0-9_]/g, '_')`) so a user-editable prefix cannot produce an invalid metric name.
- **Bound cardinality with an allowlist.** Labels may come from config, a **closed enum** (`kind`, `code`), or a model id you discovered — never from user input, a prompt, a URL, an error message, or a session id. A `code` label takes `err.code`, not `err.message`.
- Reset process-scoped gauges on disposal (`queueDepth.reset()`), or a restart leaves phantom in-flight counts.
- Expose the registry over the `http` service (§9) rather than starting your own server.

### What to measure

| Metric | Why it earns its label cost |
|--------|-----------------------------|
| Time to first token | the number users actually feel |
| Tokens by kind (input/output/reasoning/cache) | cost attribution and cache effectiveness |
| Queue depth per model | distinguishes "slow" from "queued" |
| Errors by code | the only way to see a classification mistake |
| Fallback activations | a silently degrading provider |
| Listing cache hit/miss | a discovery path hammering the server |

### Security checklist **[invariant]**

- **Never** log, persist, or embed in a prompt: credentials, API keys, bearer headers, or the raw value behind a credential reference.
- **Include `attributionHeaders()` on every provider HTTP request.** It carries only public product facts; never add anything per-request or per-user to it.
- **Bound every read.** Check `content-length`, count bytes while streaming, cancel the reader in a `finally`.
- **Treat provider output as untrusted.** Tool-call arguments are raw JSON: validate them (the tool registry does this for you if you use `defineTool`) and never `eval` them.
- **Treat attachments as opaque references.** Read image/file bytes through `ctx.attachments`; never accept or construct a filesystem path from model output. Attachment refs are deliberately *not* paths for exactly this reason.
- **Do not widen sandbox or permission requirements implicitly.** A tool that needs a wider mode must ask through the approval path and pass a justification; silently requiring escalation is a security regression.
- **Plugins run with the host's privileges.** A git install's `prepare` script executes arbitrary code at install time, outside any agent sandbox (§22). Say so in your README when you ask a user to allow it.
- **Fail closed on policy.** `ask` that cannot reach an approval channel is a denial, not an allow.
- **Redact before you truncate.** Truncating a logged JSON blob at 200 characters can still leak the first 40 characters of a key.

---

## 20. Client-side web plugins

A client plugin ships a **browser half** alongside its host half. The manifest tells the module system to serve it.

### Manifest **[verified]**

```jsonc
{
  "exports": {
    ".":        { "types": "./lib/types/index.d.ts",         "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts",  "default": "./lib/client.js" }
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-settings"]
    },
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
```

- `dsh.client` = `{ platform: 'web', inject?: string[], immediately?: boolean }`. `inject` names **package rows** whose factories must arrive before this row materializes; Cordis separately uses the same package edges to order entries.
- The built **`lib/client.js` must exist before launch**. The host serves built client bundles — it does not compile them for you. A missing bundle fails activation loudly with one build instruction and a package list.
- `platform: 'web'` is the only value this guide verified.

### How the host/browser split works **[verified]**

- The host half **scans enabled Loader entries** (no config of its own), composes a boot graph, and serves bundles under `/plugins`. The graph is injected into the page as `window.__DSH_BOOT__`.
- The browser loads bundles **lazily**. Executing a plugin bundle only *registers a factory*; every module-body side effect — **including CSS injection** — lives in the factory closure and runs at materialization. So nothing runs until the plugin is first used.
- Bundle format: the built `./client` file must be in the client module system's **lazy-CJS factory format** — one script that registers the package name and a `factory(require)` with the page's module loader.
- **The `clientBundle` build preset lives in the harness repository, not in a published package.** A plugin outside the repository must reproduce that build itself. This is the single largest piece of undocumented-by-default work in a client plugin; budget for it.
- Shared modules: the shell seeds a **frozen module table** (React, Cordis, and static UI libraries) and every dynamic bundle resolves its externals against exactly that baseline. Add only exact non-baseline requests under `dsh.client.external`. Type-only imports are erased and create no request.
- **The half attaches to the Loader row whose specifier is the bare package name.** A row mounted from a subpath export never carries a half. A bundle that splits one package into several rows keeps its half on the root row, and every page it registers goes away when that row is switched off. A sub-plugin whose page must outlive the other rows **ships as its own package**.

### The browser is a Cordis application **[verified]**

> Cordis service injection determines activation; module graph order determines only whether synchronous imports can be materialized.

So a client plugin's `apply(ctx)` is a normal Cordis plugin body, and its dependencies are **client services**, not host services. Browser-side members verified: `ctx.modules` (the module table), `ctx.remote.*` (generated Remote APIs), `ctx.slots`, `ctx.configForms`, `ctx.sessions`/`ctx.workspaces` (client models), `ctx.sidebarRight`.

### Host ⇄ client RPC: Typert Remote **[verified]**

Host side — a Cordis service whose key and wire namespace are bound together:

```typescript
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export interface NoteRow { readonly noteId: string; readonly title: string }

declare module '@deepseek-ai/cordis' {
  interface Context { notesController: NotesController }
}

export class NotesController extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'notesController', { namespace: 'notes' })
  }

  @Remote('list')
  async remoteExportList(agent: Agent, signal: AbortSignal): Promise<NoteRow[]> {
    return await this.list(agent, signal)
  }

  /** The in-process API the adapter above delegates to. */
  async list(agent: Agent, signal: AbortSignal): Promise<NoteRow[]> {
    signal.throwIfAborted()
    return await Promise.resolve([{ noteId: `${agent.id}-1`, title: 'draft' }])
  }
}
```

Wire conventions:

- **Lookup objects (`Agent`, `Session`) may occupy only top-level parameter positions.**
- A cancellation-aware method takes `signal: AbortSignal` **as its final parameter**; cancellation never travels in wire `args`.
- `@Remote('name')` renames the endpoint; `@Remote({ mode: 'stream' })` marks a logical stream; `@RemoteScope(key, exportName?)` resolves a method from a scope.
- Mark the business method directly when its signature already satisfies the wire conventions; write a `remoteExport*` adapter only when the shape must change.
- The manifest gains `"./typert"` and `"./remote"` exports plus `@deepseek-ai/dsh-typert-protocol` as **both** peer and dev dependency. Rerun the library build after any signature, code-table, namespace or export-name change.

Failures are **one class**:

```typescript
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'note/not-found': { readonly noteId: string }
    'note/rejected': { readonly noteId: string }
  }
}

throw new RemoteError('note/not-found', `no note "${noteId}"`, { noteId })
```

- Codes read `<domain>/<reason>`. Declaration placement: declare in the **producing** package; when several packages produce it, declare it in the lowest domain package both depend on.
- Carrier codes `gateway/bad-request`, `gateway/cancelled`, `gateway/internal` are declared in the protocol package — **use them, never copy them**.
- A local failure that never crosses the wire stays out of the code table.
- Do not build a family of domain error classes and do not write an exit-mapping function; an unrelated exception folds into `gateway/internal`. Write a `catch` only to classify an arbitrary provider exception as one domain code, and attach the original as `cause`.

Client side:

```typescript
export const inject = ['remote', 'remote.notes']

const result = await ctx.remote.notes.list()
if (!result.ok) {
  if (result.error.code === 'note/not-found') return []
  throw result.error
}
return result.value.map(row => row.title)
```

- `inject` declares both `remote` and `remote.<namespace>`; the call site writes `ctx.remote.<namespace>.<method>(...)` directly — no hand-written method signature, no relay object.
- The result is a `RemoteResult<T>`: branch on `if (!result.ok)` and **discriminate by `code`** (a code branch narrows `details` on its own).
- **A Remote call does not reject.** Do not write a defensive catch; an assembly mistake should crash. Where you want an exception flow, `throw result.error` (it is a real `Error`), and use `isRemoteFailure` to tell a Remote failure from a local defect.
- Client abort of a unary call yields `gateway/cancelled` on the error **branch**, not a throw.
- Fixed host facts come from `ctx.remote.$host` (`home`, `isLoopback`) as plain reads with no subscription; refresh after a reconnect via `ctx.on('connection/reset')`.
- Test doubles: take `RemoteError` and `TestRemote` as **value imports** from `@deepseek-ai/dsh-client-test-runtime` — a value import from the `api-remotes` facade loads the unbuilt assembly chain.

### Settings cards and slots **[verified]**

Two distinct mechanisms, easy to confuse:

1. **Your plugin's own config page** is rendered by the product-owned Plugins page *if you declare volatile fields* (§6). Custom plugin pages receive `form.state` and `form.mutate(operations, expectedRevision)` from the page owner; the host validates the full config and applies edits through the config editor and volatile HMR.
2. **Contributing UI to another plugin's page** uses keyed slots:

```tsx
ctx.slots.inject('plugins.detail.badge', () => ctx.slots.register({
  name: 'plugins.detail.badge',
  id: 'acme-update',
  locale: 'acmeUpdate',
}, ({ t, subject }) =>
  subject.kind === 'bundle' && hasUpdate(subject.pkg) ? <Tag tone="info">{t('update')}</Tag> : null))
```

Known detail slots: `plugins.detail.actions` (control at the page head), `plugins.detail.badge` (tag beside the title), `plugins.detail.section` (section under the page's own content). Every entry is rendered with the page's `subject` — `{ kind: 'bundle', pkg }` | `{ kind: 'row', pkg, row }` | `{ kind: 'item', id }` — and **must return `null` for a subject it has nothing for**.

**[unverified]** The exhaustive slot hierarchy and props derivation; the subsystem reference for slots is authoritative.

### Client plugin checklist

- [ ] `dsh.client` declares `platform: 'web'` and the package rows it depends on.
- [ ] `exports` has a built `./client` entry, and `lib/client.js` is built and shipped.
- [ ] Non-baseline module requests are declared; nothing imports another plugin's implementation.
- [ ] The bundle is in the lazy-CJS factory format (reproduce the harness's preset).
- [ ] Host-side Remote methods take lookups at top level and `signal` last.
- [ ] Remote failures are `RemoteError` with a `<domain>/<reason>` code in the merged map.
- [ ] Client call sites branch on `result.ok` and discriminate by `code`.
- [ ] Slot contributions return `null` for subjects they do not serve.
- [ ] A split package keeps its client half on the **bare-name** row.

---

## 21. Testing

### Four levels, in order of value

| Level | What it covers | Cost |
|-------|----------------|------|
| **Unit (no network)** | pure functions: serializer, translator, usage mapping, semaphore, cache, fallback, resolvers | minutes |
| **Integration (mock HTTP)** | end-to-end: request built, sent, response parsed, chunks emitted, errors classified | an hour |
| **Contract (snapshot)** | stable serializer/translator outputs over time — catches accidental wire changes | low, high payoff |
| **Package smoke** | the *shipped artifact* actually loads and matches its patch row | minutes, catches every packaging mistake |

The fourth one is the one most plugins skip and the one that catches the failures users actually hit.

### Unit: test the pure seams

Structure the plugin so the interesting logic is pure and injectable, then test it directly:

- `serializeRequest(options, attachments)` → wire body
- `translate(payloads)` → `StreamChunk[]`
- `mapUsage(wireUsage)` → `TokenUsage` (assert the cache subtraction!)
- `Semaphore` — including the abort-while-queued path
- `ListingCache` — hit, miss, invalidate
- `streamWithFallback` — recoverable vs terminal, and abort during failure
- `makeResolver` — good snapshot, bad snapshot with `lastGood`, bad snapshot at boot

### Integration: a real HTTP server, not a mock library

A `node:http` server exercises the actual `fetch`, the actual stream, and the actual abort behaviour:

```typescript
import { createServer } from 'node:http'

const server = createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: [{ id: 'model-1' }] }))
    return
  }
  if (req.url === '/v1/chat/completions') {
    res.setHeader('content-type', 'text/event-stream')
    res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n')
    res.write('data: [DONE]\n\n')
    res.end()
  }
})
```

Integration cases worth having, because each one has burned a real plugin:

| Case | Assertion |
|---|---|
| Happy path with tool call | chunk sequence: `block-start` → deltas → `block-end` → `usage` → `finish`; **nothing after `finish`** |
| `usage` attached to the finish chunk | still emitted exactly once, before `finish` |
| Trailing usage-only chunk | same |
| Keepalive ping (no `choices`) | skipped, no error, no phantom block |
| EOF without the done sentinel | `LlmError` with `STREAM_CLOSED` |
| Malformed JSON payload | `LlmError` with `MALFORMED_RESPONSE` |
| HTTP 401 / 429 / 400 / 500 | `AUTH` / `RATE_LIMIT` / `INVALID_REQUEST` / `SERVER`, with `status` set |
| Slow first byte beyond the idle timeout | `TIMEOUT`, and the socket is closed |
| Caller aborts mid-stream | `ABORTED` — **not** `TIMEOUT` |
| Empty completion | `EMPTY_RESPONSE`, not a successful empty message |
| `content-length` above the bound | refused before parsing |
| Model discovery: native endpoint 4xx | falls back to the compatible listing |
| Model discovery: native endpoint times out | **does not** fall back (abort propagates) |
| Settings edit mid-flight | the next request uses the new endpoint (the resolver test) |
| Registration disposal | the provider is gone from `listProviders()` |

### Snapshot the wire

A contract snapshot of the serialized request is cheap and catches the class of bug where a dependency upgrade changes field ordering or null handling. Keep it small: one representative conversation with a system message, a user message with two text blocks, an assistant message with text plus a tool call, and a tool result. Review the snapshot when it changes; do not auto-accept.

### The package smoke test **[verified pattern]**

Assert the *distribution contract*, which no unit test covers:

```javascript
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

test('package entrypoint is built JavaScript and matches the Cordis patch row', async () => {
  assert.equal(packageJson.main, './lib/index.js')
  assert.equal(packageJson.exports['.'], './lib/index.js')
  assert.ok(packageJson.files.includes('lib'))

  const row = patch.match(/- id: ([^\n]+)[\s\S]*?name: ([^\n]+)/)
  assert.ok(row, 'cordis.patch.yml must insert a named plugin row')
  assert.equal(row[2].trim(), packageJson.name)

  const entry = await import(new URL('../lib/index.js', import.meta.url).href)
  assert.equal(entry.name, row[1].trim())
  assert.equal(typeof entry.apply, 'function')
})
```

What this actually proves:

- The built `lib/index.js` exists and is importable (catching "shipped source instead of built output").
- `main`/`exports` point at it.
- The `id` in the patch row matches the plugin's exported `name` — **the single most common packaging bug**, and one that produces a plugin that loads and silently does nothing.
- `lib` is in `files`, so the tarball carries it.

Add a negative assertion for anything you must *not* ship:

```javascript
assert.equal(packageJson.scripts.prepare, undefined,
  'git installs must not need an unapproved prepare build')
```

That assertion is how a project encodes a deliberate packaging decision (commit the build output) so a later contributor cannot reintroduce an install-time build by accident.

### Testing scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:package": "npm run build && node --test test/package-smoke.test.mjs"
  }
}
```

`prepublishOnly` should run **all** of them, plus typecheck and lint. A published plugin that fails its own smoke test is worse than one that was never published.

### The test level the framework itself requires **[verified]**

The harness's own testing policy is stricter than "write unit tests", and it is worth adopting:

> Product-visible plugins require a **non-unit, real-composition** test. Hand-built `ctx.plugin(...)` suites are insufficient: boot a test-only `cordis.yml` through the loader and the app/process.

Why mock-`ctx` tests are not enough: they do not apply Cordis's strict-injection gate, so a plugin that would fail to load in a real profile passes happily against a hand-built context. The failure you are trying to prevent — `apply` throwing at its top and registering nothing — is invisible to a mock.

Three related principles from the same policy, all applicable outside the repository:

- **"A guard only guards if the regression fails it."** For a plugin with no `inject`, assert that the module does *not* accidentally export a default, then prove the guard works by introducing the regression and watching the test go red. An untested guard is decoration.
- **A test of the published artifact means the built entry point**, run under plain `node` — not the TypeScript source. Source-mode execution masks exactly the failures users hit.
- **"Verify the world, not the self-report."** Assert on observable state (a provider in `listProviders()`, a tool in `schemas()`, a file on disk), not on a log line or a returned success flag.

Concretely, the strongest cheap gate for an out-of-tree plugin is a **disposable-profile boot**:

```bash
# in a scratch profile, so nothing real is at risk
dsh --profile smoke --dump-config        # the layer is present and the row is well-formed
dsh --profile smoke                      # it actually boots
dsh plugin --profile smoke remove <pkg>
dsh --profile smoke                      # and it boots again after removal
```

Plus, following the same policy, a **negative control**: install a deliberately broken copy (drop `inject`, or place the package outside the profile tree) and confirm it fails loudly rather than silently. A smoke test that only ever passes cannot tell you whether it is testing anything.

### What not to test

- Do not test the framework (that `ctx.effect` disposes things).
- Do not assert on exact log strings.
- Do not snapshot the full provider request for every test case; the noise hides the signal.
- Do not mock `fetch` when a real local server is a few lines away. A mocked `fetch` cannot tell you that your code forgets `options.signal`.

---

## 22. Packaging and distribution

### How users install the plugin

```bash
# Development: link a local checkout (no build permission needed)
dsh plugin --profile web add link:./plugins/my-dsh-plugin
dsh plugin --profile web add ./hello-plugin

# Production: prebuilt tarball or npm package (no build permission needed)
dsh plugin --profile web add ./hello-plugin-0.1.0.tgz
dsh plugin --profile web add dsh-my-plugin

# Source tracking: git dependency (REQUIRES an install-time build allowance)
dsh plugin --profile web add github:owner/repo#<sha>
```

**[verified]** `dsh plugin --profile <name> <args...>` forwards to pnpm in the profile directory, so every pnpm verb works. `remove` removes both the dependency and the layer.

### The GitHub install "build-script catch" **[verified]**

> A git install fetches **sources, not built artifacts**: nothing runs your `build` script, so a TypeScript package arrives without its `lib/` output and fails to load.

Two things must happen, one on each side:

1. **The author ships a `prepare` script** — pnpm runs it after a git install — that builds the published entry points from source, **self-contained**: it must not assume dev-only context such as a sibling monorepo checkout. A dedicated transpile-only config is the right tool (no project references, no type checking).
2. **The user allowlists the build.** pnpm ≥ 10 refuses to run a git dependency's `prepare` script until it is explicitly allowed, so the **first `add` fails**; `dsh` points at the fix — copy the exact package key pnpm printed into the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  # Keys contain colons, so they MUST be quoted.
  "dsh-my-plugin@git+https://github.com/owner/repo.git": true
```

…and re-run the `add`.

Three traps in that snippet, and they are why the official tutorial's shorter example misleads:

- **`allowBuilds` is pnpm (≥ 10.26), not dsh.** pnpm 11 unified `onlyBuiltDependencies`, `onlyBuiltDependenciesFile`, `neverBuiltDependencies`, `ignoredBuiltDependencies` and `ignoreDepScripts` into it. If you find guidance referencing one of those keys, it is for an older pnpm.
- **A bare package name cannot approve a git or tarball dependency's build.** pnpm matches a name-only entry against registry packages; a git dependency must be approved by its **exact resolved path including the commit**, or — since pnpm 11.11 — by its **repository URL** (`'foo@git+https://github.com/org/foo.git': true`, exact match). So `allowBuilds: { dsh-my-plugin: true }` may never take effect for a `github:` install. **Copy the key pnpm actually printed**; do not retype it, and do not assume the name form works.
- **Keys contain colons and must be quoted in YAML.** An unquoted `dsh-my-plugin@git+https://…:` key is a YAML mapping error or, worse, silently parses into something else.

Also worth knowing when a `prepare` actually runs: **`prepare` runs after a git install**, `prepublishOnly` is publish-only (the right place for a packaged-load gate), and `postinstall` has no documented plugin role. Do **not** put `pnpm run build` inside `prepare` — prefer invoking the build tool directly (`"prepare": "tsdown --config tsdown.config.ts"`), because a package-manager re-entry inside `prepare` can loop on dependency-status checks.

Treat that allowance as **permission to execute the package's code on your machine at install time, outside any sandbox the agent runs under.** Only allow packages whose source you trust, and pin a commit (`github:owner/repo#<sha>`) so a later push cannot silently change what runs.

### A broken plugin takes down the whole profile **[verified]**

This is the most important operational fact in this section:

> A git-installed or out-of-tree plugin whose built entry point is missing fails at **boot**, and the failure is fatal for the **entire profile** — not just for that plugin.

The reported shape is `ERR_MODULE_NOT_FOUND` for `lib/index.js` (or `lib/client.js`, or `dist/dsh.js`), and the user's recovery is to disable the bundle or remove the dependency. One broken community bundle can make the Web surface unavailable. Consequences for you as an author:

- Your build output is not "internal packaging detail"; it is the difference between a working profile and a dead one.
- Test the **installed** artifact, not just the repository (`test:package`, §21).
- If you ship from git, either commit the build output or make `prepare` bulletproof and self-contained.

### Profile mechanics worth knowing **[verified]**

- `$DSH_HOME` resolves to an explicit configured value, else `$DSH_HOME`, else `<OS home>/.dsh`.
- `dsh plugin --profile <name> <args...>` **forwards to pnpm** with the profile directory as the working directory. `add`, `remove`, `why`, `update` and every other pnpm verb work unchanged — `dsh plugin list` is just `pnpm list`. There is no dsh-implemented plugin list, and (as of the versions checked) no `doctor`/`repair`/factory-reset command.
- **`add` reconciles `dsh.profile.bundles` against installed state after every successful run**: dependencies that declare `dsh.bundle.patch` join the layer stack; bundle-less dependencies stay plain *with a warning*; removed dependencies leave the stack.
- **A restart is required after add/remove/update.** A running profile keeps the bundle set from its current start. HMR covers the patch files, not the `dsh.profile.bundles` list.
- Generated profile workspaces use `nodeLinker: hoisted` and `autoInstallPeers: false`. Because the host maintains a flat `@deepseek-ai/*` closure at `$DSH_HOME/profiles/node_modules`, **many "missing peer" warnings are expected and benign**. Do not chase them all: a nearer duplicate can shadow the host-owned singleton (next subsection).
- **Resolution reachability matters for local installs.** Node resolves up from the package's *real* path, so a plugin installed from an absolute path **outside** the profile tree cannot reach the host closure and fails the whole profile. Inside the tree (including a `link:` into it) it can. This is why "works via git" does not imply "works from a local directory".

### Layer semantics: `insert`, override, `disabled` **[verified]**

Row fields in a patch: `id` (stable identity used for resolve/update/remove and override targeting), `name` (module specifier), `config`, `group` (`config` becomes a child entry list), `disabled`, and entry-local `inject`.

| Intent | How |
|---|---|
| Add rows | `- insert: [{ id, name, config }]` |
| Override an earlier layer's row | a top-level row with a matching `id`, **no** `insert` wrapper |
| Disable a row | `- id: some-row` + `disabled: true` |
| Nest a group | `group: true`; nested ids use `:` (`tools:logger`); a group is always "enabled", but disabling it prevents its children; `isolate` gives a group its own service instance |

Notes:

- **There is no `remove:` patch verb.** The shipped web-app patch disables rows rather than deleting them, with the comment "Disabling rather than deleting is deliberate." Treat `insert` + `id`-override + `disabled` as the vocabulary.
- **An entry without an `id` gets a regenerated id on every read**, so it counts as removed-and-added on any config edit. Always give your rows a stable `id`.
- **`config` is replaced whole, never deep-merged.** An override must restate every key the row needs.
- A patch file that is **empty or comments-only fails boot**. Use `[]`.
- An unmatched patch target produces a warning naming the layer; a non-insert patch row without a non-empty `id` is an accepted no-op plus a loader warning; a broken bundle is skipped and listed in `skippedBundles`, while profile and user-patch errors fail startup.

### The "dormant row" idea, and why your plugin can look inert **[verified]**

Installing a bundle registers only its **dormant host provider**. No capability is reachable until a consumer or preset row is enabled: *installation controls host availability, not model permission*. So a bundle appearing in `--dump-config` does **not** mean the feature is live.

Consequences for authors: document which row a user must enable to get your capability, and do not assume that "it is in the config dump" means "it works".

### Duplicate instances: the failure that looks like something else **[verified]**

`@deepseek-ai/dsh-tools` keys its runtime scheduler on a module-level `unique symbol`:

```typescript
export const TOOL_RUNTIME_SCHEDULER: unique symbol = Symbol('@deepseek-ai/dsh-tools.scheduler')
```

The agent loop reaches the scheduler through that symbol. **Two physical copies of the package produce two different `Symbol()` values**, so the lookup misses and the first tool call throws `Cannot read properties of undefined (reading 'prepare')` — **while chat keeps working**. Boot succeeds and the model still answers, which is why this is such a trap.

The trigger is declaring a shared dsh package in `dependencies` instead of `peerDependencies` + `devDependencies` (§3), or installing a plugin with plain npm inside a profile (npm auto-installs peers, unlike the profile's `autoInstallPeers: false`).

Detect it by comparing canonical paths, not names:

```bash
pnpm why --recursive @deepseek-ai/dsh-tools
npm ls --all @deepseek-ai/dsh-tools
```

Fix it by correcting the placement to peer+dev. **Do not** work around it with `Symbol.for()`, optional chaining, or hand-deleting `node_modules` — those hide a broken dependency graph.

### If you would rather not ask for that permission

**Distribute built artifacts instead.** Neither form needs any build permission:

- **Publish to npm** with `lib/` built at `pnpm publish` time; `dsh plugin add your-package` then installs prebuilt code.
- **Ship a tarball** from `pnpm pack`; users run `dsh plugin add ./hello-plugin-0.1.0.tgz`.

A third option, used by [dsh-localforge](https://github.com/orfeomorello/dsh-localforge): **ship prebuilt output from a git dependency**. Commit `lib/`, list it in `files`, and **do not** declare a `prepare` script — then `github:owner/repo` installs work with no build permission and no `allowBuilds` entry. The tradeoff is that `lib/` must be rebuilt and committed on every source change, and a stale `lib/` is a real failure mode. Enforce it in CI (see §23) and assert it in the smoke test.

Choose deliberately, and document the choice:

| Approach | Install permission | Risk |
|---|---|---|
| `link:` local checkout | none | not distributable |
| npm publish / tarball | none | you must publish for every change |
| git + `prepare` + `allowBuilds` | **arbitrary code at install time** | the user must trust you and pin a sha |
| git + committed `lib/` | none | stale build output if CI does not check |

### Layer and manifest requirements

- `package.json` with `type: "module"`, `exports`, `files`, and `dsh.bundle.patch`.
- `cordis.patch.yml` at the path `dsh.bundle.patch` names.
- Built output in `lib/` matching `main`/`exports`.
- The patch row's `id` matching the plugin's exported `name`.
- `dsh-plugin` topic on the repository, for discoverability.

### Versioning and compatibility

- **Declare the shared-package contract as peers, and let the host check it.** dsh validates `peerDependencies` on `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` against the running version and refuses to import a row that does not match (see §3 and §22's duplicate-instance subsection). `engines.dsh` and a manifest version field are declarative only and unenforced, so they are documentation, not a guard.
- **A duplicate instance of a core package is worse than a version mismatch.** A mismatch fails loudly at load; a duplicate instance fails later, in one code path, while everything else looks healthy (§22).
- **State the Node requirement in `engines`** to match the harness generation you target (`^22.19.0 || >=24.0.0` is the shape the repository declares). Note that the published CLI package itself declares no `engines`, so this is guidance for your users, not something the host enforces.
- **Treat core types as a moving target.** The content-block and message unions have already widened (see the version note in §12); build against the version you declare, and use `import type` for type-only identifiers. A renamed runtime export (a value that used to exist and no longer does) is a hard import failure, not a type error.
- **Document your own error codes** and whether each is retryable.

### Debugging a plugin that does not load **[verified]**

There is **no verbose/debug flag** on the `dsh` CLI — the launcher flags are `--profile`, `--from-default-profile`, `--patch`, `--dump-config`, `--dump-default-config`, `--dump-config-schema`, `-V/--version`. Debug with these instead:

| Tool | Use |
|---|---|
| `dsh --profile <p> --dump-default-config` | the bundle layers only |
| `dsh --profile <p> --dump-config` | bundle layers + profile patch + home patch (+ `--patch` overlays). Look for the `# == <package>` markers. |
| `dsh --profile <p> --dump-config-schema` | imports every composed module, so it surfaces resolution errors. Treat as trusted-profiles-only: it executes module code. |
| the startup log | **a required-plugin failure prints failed plugins, their original stacks, pending plugins and missing services, then names a full diagnostics file at `$DSH_HOME/logs/startup-<timestamp>-<uuid>.log`** |

> **Warning about that log:** it warns in its own header that **values are not redacted**. Review before sharing; it can contain declared config defaults, raw plugin errors, message text, tool arguments and results, and workspace paths. The harness has no documented redaction API for plugin authors, which is a further reason to keep secrets out of what you log in the first place (§19).

Diagnosing "my plugin never loads" means checking fiber states: `PENDING → LOADING → ACTIVE`, or `FAILED`, or `ACTIVE → UNLOADING → DISPOSED`. **`PENDING` prints nothing and is a legitimate state** — a plugin waiting on an unmet `inject` looks exactly like a plugin that was never installed.

A useful triage order, from most to least common:

1. `exports["."]`/`main` points at a file that does not exist in the published artifact.
2. **`inject` names a service that is absent, or your `apply` calls `ctx.get(name)` strictly on something missing** — a strict-injection failure throws at the top of `apply`, so the whole effect never registers. On a Web surface this often degrades to the SPA fallback, which looks like "the plugin did nothing".
3. Dependency resolution failure (see the reachability and duplicate-instance notes above).
4. An unquoted `name:` in YAML that starts with `@` (a YAML reserved indicator).
5. A `dsh.client` declaration without a built client bundle (the client half is never served).

Two more operational facts worth knowing: **HMR does not cover the `dsh.profile.bundles` layer stack**, so adding or removing a bundle needs a restart; and because of the ESM module cache, editing a mounted plugin's source needs a web restart — disable/enable and reinstall do not pick up new code for an already-imported module. Finally, an HTTP 200 from the SPA is **not** a mount signal: verify via the `__DSH_BOOT__` graph or a `/plugins/<id>/client.js` request.

### Security: there is no plugin sandbox **[invariant]**

Be explicit about this in your own README, because users consistently assume otherwise:

- **Installed host code executes in-process, with the host's full privileges.** There is no plugin permission manifest, no capability restriction, no allowlist, and no isolation boundary. The dsh compatibility check is not a sandbox against malicious package code, and it is documented as such.
- **The agent's tool sandbox is a different boundary.** It constrains where the agent's bash/filesystem tools may write; it constrains neither plugin code nor the install-time `prepare` script.
- **Most specific danger: a bundle patch can disable or replace core rows.** A bundle patch is applied like any other layer, so a package can `disabled: true` core sandbox/tool rows and substitute its own providers — `dsh plugin add` reconciles that patch into the ordered stack automatically. It is not presented as an approval boundary.

For users of plugins, the mitigation is to **diff the composed configuration before booting**:

```bash
dsh --profile web --dump-config > before.txt
dsh plugin --profile web add <pkg>
dsh --profile web --dump-config > after.txt
# inspect: new rows, and any row that changed to disabled: true
```

Watch the core rows by id (filesystem/tool/shell/sandbox/approval/credentials/attachment/session-persistence). A new row is a feature; a *disabled* core row is a change of governance and deserves a second look.

For plugin authors the obligations are narrower but real: do not disable or shadow core capability rows to make your plugin work, do not require a wider sandbox mode implicitly, and state clearly in your README when installing you means running code at install time.

### README requirements

A plugin README should answer, in this order:

1. What it does, in one sentence.
2. The exact install command.
3. The minimum configuration to make it work (with a copy-pasteable YAML block).
4. Every configuration field that is not self-explanatory, including defaults.
5. Any install-time permission it needs, and why (the `allowBuilds` case above).
6. What it registers: provider routes, tool names, settings namespaces, HTTP routes.
7. Known limitations.

---

## 23. Build, typecheck and CI

### Two TypeScript configs, on purpose **[verified pattern]**

Type checking and emitting are different jobs, with different settings.

```jsonc
// tsconfig.json — everything, strictly checked, no emit
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

```jsonc
// tsconfig.build.json — emit only
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "lib",
    "declaration": false,
    "sourceMap": false,
    "noCheck": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test", "lib"]
}
```

Three settings in the build config are the load-bearing ones:

| Setting | Why |
|---------|-----|
| `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` | lets you write `./config/schema.ts` in source (which is what a bundler/tsx/type-stripper setup wants) and emits `./config/schema.js` in `lib/`. Without the rewrite, the built files import `.ts` paths and **fail at runtime**. |
| `module`/`moduleResolution: NodeNext` for the build | the built output is consumed by Node, so the emit must use Node semantics, not bundler semantics. |
| `noCheck: true` | makes the build a **transpile only**. Type checking already happened in `typecheck`; repeating it in `build` doubles the time and turns a type-only problem into a publish blocker. |

`isolatedModules: true` (and `verbatimModuleSyntax`) force you to use `import type` for type-only imports — which is not pedantry: without it, a transpile-only build emits runtime imports for types and the module fails to load.

### Build script

```javascript
import { rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

await rm(new URL('../lib/', import.meta.url), { recursive: true, force: true })

const child = spawn(process.execPath, [compiler, '-p', 'tsconfig.build.json'], {
  cwd: root,
  stdio: 'inherit',
})
const code = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', status => resolve(status ?? 1))
})
if (code !== 0) process.exit(code)
```

Deleting `lib/` first is what prevents the worst packaging bug: a deleted source file whose stale output stays in `lib/` forever and keeps loading.

### Script set

```json
{
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build": "node scripts/build.mjs",
    "test": "vitest run",
    "test:package": "npm run build && node --test test/package-smoke.test.mjs",
    "lint": "eslint src test",
    "prepublishOnly": "npm run typecheck && npm run test && npm run lint && npm run test:package"
  }
}
```

Note what is deliberately **absent** from the default script set: `prepare`. Add it only if you chose the git-build distribution model, and remember what it costs the user (§22).

### CI checklist

A GitHub Actions workflow should, on every push and PR:

1. `pnpm install --frozen-lockfile`
2. `pnpm run typecheck`
3. `pnpm run lint`
4. `pnpm run test`
5. `pnpm run build`
6. `pnpm run test:package`
7. **If you commit `lib/`: verify the committed output matches a fresh build** — otherwise a stale `lib/` reaches users.

That last step is the one that makes the "commit the build output" strategy safe:

```bash
pnpm run build
git diff --exit-code -- lib   # fails if lib/ is stale relative to src/
```

Publish with provenance (`npm publish --provenance`) where the registry supports it, and keep the version in `package.json` as the single source of truth.

### Publishing: prefer OIDC trusted publishing **[verified pattern]**

The harness's own release workflow is a good template, and the shape matters more than the exact YAML:

- **Publishing is a separate, explicit act.** The official workflow is `workflow_dispatch`-only from a `dsh-v*` tag, on the stated principle that publication "must always be an explicit, reviewed act … and it must never appear as a PR check". Do not publish from a push to `main`.
- **Build once, publish those exact bytes.** A pack job installs with `--frozen-lockfile`, verifies, builds, packs, **verifies the packed install**, and uploads the artifact; the publish job downloads that artifact and publishes it. **"There is no build step"** in the publish job — so what you tested is what you shipped.
- **Use OIDC trusted publishing instead of a long-lived token.** A community plugin doing this successfully shows `_npmUser: GitHub Actions` and a `dist.attestations.provenance` (SLSA v1) record on the published version. The workflow needs `permissions: { id-token: write }` and a modern npm (≥ 11.5 for trusted-publishing support), with no `NPM_TOKEN` secret at all.
- **Publish from a protected environment** (`environment: npm-publish`) and set `concurrency` with cancel disabled, so two releases cannot interleave.
- For scoped packages, set `publishConfig: { access: "public" }`.

A publish job that rebuilds is a publish job that can ship something other than what CI verified. Download the artifact instead.

---

## 24. Review: invariants and anti-patterns

### The invariants, collected **[invariant]**

These are the rules whose violation produces failures far from the bug.

| # | Invariant | Where it bites |
|---|---|---|
| 1 | Every registration goes through `ctx` or `ctx.effect()` | leaked listeners, timers and sockets after HMR |
| 2 | `apply` can run more than once per process | a module-level singleton initialized in `apply` breaks |
| 3 | Read config per operation, never once at registration | settings edits silently do nothing |
| 4 | Emit `usage` before `finish`, and nothing after `finish` | assembler confusion, lost accounting |
| 5 | Tool-call arguments are raw JSON strings end-to-end | the model executes different arguments than the log shows |
| 6 | `TokenUsage` counts are disjoint (cache subtracted from input) | every cost report is inflated |
| 7 | Include `attributionHeaders()` on every provider request | provider-side attribution contract |
| 8 | Route on `code`, never on `message` | classification silently breaks on a wording change |
| 9 | Honor `options.signal` / `exec.signal` | zombie requests and jobs |
| 10 | Never log or persist a credential (or any part of one) | security incident |
| 11 | Bound every non-streaming read | memory blowup from a hostile or broken endpoint |
| 12 | Files and images travel as durable references, never as paths | path traversal and broken replay |
| 13 | A waterfall listener must call `next()` to preserve behaviour | silently disabling the real implementation |
| 14 | Loop-built requests are deep-frozen — read, never rewrite | a throw inside the pipeline |
| 15 | Ordered teardown belongs in one effect, awaited serially | a resource closed before its user |
| 16 | Fail closed when an approval channel is unavailable | a policy bypass |
| 17 | Metrics labels come from a closed set | Prometheus cardinality explosion |
| 18 | The patch row `id` matches the exported `name` | a plugin that loads and does nothing |
| 19 | Shared dsh packages live in `peerDependencies` **and** `devDependencies`, never `dependencies` | duplicate module instance → every tool call breaks while chat works |
| 20 | The published artifact contains the built entry point | a missing `lib/` fails the **whole profile**, not just the plugin |

### Do

| Practice | Why |
|----------|-----|
| **Per-request resolvers, not capture** | Config changes propagate without re-registration |
| **Volatile fields for live values** | Instance identity is preserved; no restart |
| **Semaphore per model** | Limits concurrency on serializing backends |
| **Token pre-flight with a real tokenizer** | Reject overflow before the HTTP call |
| **Fallback chain with the same recoverable set as the retry policy** | Two lists drift; one list cannot |
| **Redact at the logger** | Safe by construction, not by discipline |
| **Bounded metric cardinality** | Labels only from config or closed enums |
| **One effect for ordered cleanup** | Async disposers have no serial guarantee |
| **Defer finish/usage to the end-of-stream marker** | Handles every usage shape and guarantees ordering |
| **Skip keepalive pings** | Do not parse chunks without `choices` |
| **Invalidate caches after a state change** | Model load/unload visibility |
| **Reuse canonical error codes** | Retry policy and overflow recovery key on them |
| **Soft-validate display paths** | Display must never crash a replay |
| **Package smoke test** | Catches the packaging bugs users actually hit |

### Don't

| Mistake | Consequence |
|---------|-------------|
| **Capture config at registration** | Settings edits need a re-register; the provider can look invisible |
| **Sleep-and-retry inside `stream()`** | Multiplies attempts with the host's retry policy |
| **Ignore `AbortSignal`** | Zombie requests, leaked sockets |
| **Log credentials or full request headers unredacted** | Security leak |
| **Retry non-recoverable errors** | Pointless retries on `AUTH`/`INVALID_REQUEST` |
| **Emit a chunk after `finish`** | Harness confusion, corrupted assembly |
| **Open a block on an empty delta** | Phantom blocks in the UI |
| **Map an unknown stop reason to `stop`** | A provider problem reported as success |
| **Treat a `file` block as provider-native content** | The request is rejected or silently lossy |
| **Fall back to another model after a caller abort** | The user's cancel is ignored and the wait doubles |
| **Return content blocks from a tool body** | The canonical value is lost; callers parse prose |
| **Rewrite `exec.arguments` in `tools/pre-execute`** | Logged arguments desync from what ran |
| **Write session state inside a card presenter** | Replay breaks |
| **Host presentation methods expecting a Web card** | The built-in Web Client ignores them |
| **Assume a plugin scaffold exists** | There is no `dsh plugin new`; `dsh plugin` is a pnpm forwarder |
| **Declare a shared dsh package in `dependencies`** | Duplicate module instance: `Symbol()` identity splits, every tool call fails, chat still works |
| **Ship a git plugin without built output** | A missing `lib/` takes down the **entire profile** |
| **Retype the `allowBuilds` key by hand** | A bare package name cannot approve a git dependency's build |
| **Expect `engines.dsh` to enforce anything** | Compatibility is checked from `peerDependencies` on `@deepseek-ai/dsh*` |
| **Disable a core capability row to make your plugin work** | You have silently changed the deployment's governance |
| **Assume HMR picks up a bundle add/remove or new source** | The layer stack needs a restart; the ESM cache needs one too |
| **Ship a plugin with an unstable or missing row `id`** | A config edit reads as removed-and-added |

### The five questions to ask before shipping

1. **Where does this get disposed?** If the answer is not "an effect", fix it.
2. **What happens if the user edits the settings while a request is in flight?** If the answer is "nothing", your resolvers capture.
3. **What happens on cancel?** Trace the signal to the socket, the process, or the job.
4. **What does the log line look like when it fails?** If it contains a key or lacks a model id, fix it.
5. **Does the shipped artifact load?** Run the package smoke test, not just `vitest`.

---

## 25. Final checklist

### Contract

- [ ] `package.json` has `name`, `version`, `type: "module"`, `main`, `exports`, `files`, `dsh.bundle.patch`
- [ ] `cordis.patch.yml` inserts a row whose `id` matches the exported `name`
- [ ] `src/index.ts` exports `name`, optional `inject`, the `Config` **schema**, and `apply`
- [ ] Every `Config` field has a schema default; an empty section works
- [ ] No plain object exported as `Config`
- [ ] `Config`/`apply` types agree (annotate the schema as `Schema<Config>`)
- [ ] dsh peers are in **both** `peerDependencies` and `devDependencies`

### Lifecycle

- [ ] All registrations are effect-scoped; no module-level `setInterval`/cache
- [ ] No I/O in `apply`
- [ ] Ordered teardown in one `ctx.effect()`; process gauges reset on dispose
- [ ] `apply` tolerates being run twice in one process

### Configuration

- [ ] Anything two deployments might set differently is a config field
- [ ] Live values use `.volatile()` (or a `setSource` thunk) and are read per operation
- [ ] Cross-field constraints use `.check()`
- [ ] Secrets use `role('secret')`; credential names use `role('credential-ref')`
- [ ] `settingsNs` matches the namespace used in `registerConfigurableProviders`

### Adapter (if applicable)

- [ ] Extends `LlmAdapter`; implements `providerInfo`, `listModels`, `stream`
- [ ] `resolveModel` preserves the authoritative reasoning list and honors `signal`
- [ ] `providerRetryPolicy` declares the transient codes (and re-registers via `.replace()` when it changes)
- [ ] `prepareCall` semantics respected: one adapter generation answers and dispatches
- [ ] Connection facts read through thunks; a `lastGood` snapshot survives a bad edit
- [ ] `attributionHeaders()` merged into every provider request
- [ ] `stream` yields the correct chunk sequence; `usage` before `finish`; nothing after
- [ ] Tool-call `argumentsDelta` fragments are re-stringified at `block-end`
- [ ] Errors use `LlmError` with a stable code; two sanctioned failure paths, documented
- [ ] `TokenUsage` cache subtraction correct
- [ ] `options.signal` honored end to end, with timeout vs abort classification in the right order

### Streaming

- [ ] SSE parser handles the done sentinel, keepalive pings, and malformed JSON
- [ ] Empty delta does not open a block
- [ ] Degenerate empty completion maps to `EMPTY_RESPONSE`
- [ ] Bounded reads on any non-streaming endpoint
- [ ] Socket released on every exit path

### Tools (if applicable)

- [ ] `parameters` uses the schema DSL; every parameter has a `description`
- [ ] `output.schema` is the canonical value; `render` produces model-facing content
- [ ] `execute` honors `exec.signal` and returns only the canonical value
- [ ] Domain failures are values; infrastructure failures throw
- [ ] Presenters are pure (no I/O, no clock, no session state)
- [ ] Tool failure messages are written for a model that will retry

### Resilience

- [ ] Per-model semaphore with abortable acquire and `finally` release
- [ ] Fallback chain with the recoverable set aligned to `retryableCodes`
- [ ] Abort checked before trying and in the catch
- [ ] No retry logic reimplemented inside `stream()`
- [ ] Health check (if any) is effect-scoped

### Observability and security

- [ ] Redaction configured at the logger, not at call sites
- [ ] Metrics labels from a closed set; prefix sanitized
- [ ] No credential (or fragment) in any log, error message, or prompt
- [ ] `normalizeApiKey`/`assertUsableApiKey` used; diagnostics name the reference
- [ ] `MISSING_CREDENTIAL` vs `INVALID_CREDENTIAL` distinguished
- [ ] No filesystem path constructed from model output

### Client (if applicable)

- [ ] `dsh.client` declares `platform: "web"` and its package rows
- [ ] `exports` has a built `./client`; `lib/client.js` is built and shipped
- [ ] Bundle reproduced in the lazy-CJS factory format
- [ ] Remote methods take lookups at top level and `signal` last
- [ ] Remote failures are `RemoteError` with merged `<domain>/<reason>` codes
- [ ] Client call sites branch on `result.ok` and discriminate by `code`

### Packaging, build and tests

- [ ] Distribution model chosen and documented (link / npm / tarball / git+prepare / git+committed `lib/`)
- [ ] If git: either a self-contained `prepare` **plus the exact `allowBuilds` key pnpm printed** (quoted), **or** committed `lib/` with no `prepare`
- [ ] Do not put `pnpm run build` inside `prepare`; invoke the build tool directly
- [ ] `build` clears `lib/` first
- [ ] Build config rewrites relative import extensions
- [ ] `typecheck`, `lint`, `build`, `test`, `test:package` all pass
- [ ] `prepublishOnly` runs all of them
- [ ] Package smoke test asserts `main`/`exports`/`files` and the patch-row `name`
- [ ] CI fails when committed `lib/` is stale (if committed)
- [ ] Every `exports` target exists in `npm pack --dry-run` output
- [ ] A disposable-profile boot test passes: install → `--dump-config` → boot → remove → boot
- [ ] A negative control proves the boot test can fail
- [ ] Publishing is an explicit, reviewed act from a tag; the publish job ships the verified artifact rather than rebuilding
- [ ] README documents install, minimum config, registered surfaces, install-time permissions, and which row to enable

---

## 26. References

### Official documentation and source

These are the authoritative pages this guide was checked against. They are generated from the repository's `docs/` directory, so pin a commit when you cite them.

**Getting started**
- [Your first plugin](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/basic/index.md) — the minimal function-form plugin
- [Plugin configuration](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/basic/config.md) — `Config` + Schemastery
- [Build a tool](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/basic/tool.md) — the first `defineTool`
- [Package and install a plugin](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/basic/publish.md) — bundles, profiles, layer order, the git build-script catch

**Framework**
- [Plugins and lifecycle](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/framework/index.md) — the fiber state machine
- [Services and dependencies](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/framework/service.md) — providing a service, isolation
- [Event system](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/framework/events.md) — dispatch modes, session vs Cordis events

**Practice**
- [Three-role capability design](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/practice/index.md) — definition / provider / consumer
- [LLM adapters](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/practice/llm-adapter.md) — the adapter tutorial

**Cookbook**
- [Tool authoring reference](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/cookbook/adding-a-tool.md) — the full `execute` contract
- [Adding an LLM adapter](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/cookbook/adding-an-llm-adapter.md) — the verified protocol obligations
- [Extension plugin shapes](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/cookbook/extension-cookbook.md) — the feature → mechanism map
- [Live configuration forms](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/cookbook/adding-a-settings-card.md) — volatile fields and slots
- [Adding a Remote API](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/cookbook/adding-a-remote-api.md) — host ⇄ client RPC

**Package references**
- [`@deepseek-ai/dsh-tools`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/core/tools/README.md) — registry, pipeline, PTC, presentation
- [`@deepseek-ai/dsh-client-modules`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/modules/README.md) — how the browser half is served
- [`@deepseek-ai/dsh-timeout`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/util/timeout/README.md) — `deadline`, `idleWatchdog`, `timeoutOf`

**Operations**
- [CLI behavior reference](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/apps/cli/reference/README.md) — launcher flags, profile boot, layer precedence
- [`apps/cli/src/args.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/apps/cli/src/args.ts) — the exact flag grammar
- [App boot](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/boot/app-boot/README.md) — the dsh peer-compatibility check and profile behavior
- [`vendor/loader`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/vendor/loader/README.md) — patch row fields, `insert`/override/`disabled`/`group`, layer semantics
- [Testing policy](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/testing.md) — real-composition tests, published-artifact tests, "verify the world"

**pnpm**
- [`allowBuilds`](https://pnpm.io/settings/build#allowbuilds) — the setting that gates a git dependency's build, and the name-vs-exact-key rule
- [pnpm 10 → 11 migration](https://pnpm.io/migration) — which build keys were consolidated and where they are now read from

**Tutorials**
- [Cordis tutorial](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/cordis-tutorial/index.md) — seven runnable chapters, no API key needed

### Installed type definitions (the final authority)

```
node_modules/@deepseek-ai/cordis/lib/types/{context,fiber,registry,service,events}.d.ts
node_modules/@deepseek-ai/dsh-llm/lib/types/{index,types,content,message,retry-policy,call-config,error,attribution,api-key,assembler}.d.ts
node_modules/@deepseek-ai/dsh-attachment/lib/types/*.d.ts
node_modules/@deepseek-ai/dsh-typert-protocol/lib/types/*.d.ts
```

Search them before trusting any snippet in this guide:

```bash
grep -rn "registerAdapter\|prepareCall\|StreamChunk" node_modules/@deepseek-ai/dsh-llm/lib/types/
```

### Libraries

- [Schemastery](https://github.com/shigma/schemastery) — config validation
- [eventsource-parser](https://github.com/rexxars/eventsource-parser) — SSE parsing

### Example plugins

- [dsh-localforge](https://github.com/orfeomorello/dsh-localforge) — OpenAI/Anthropic-compatible LLM adapter with discovery, streaming, semaphore, fallback, metrics, health check; the source of most verified patterns in this guide
- [dsh-vision-router](https://github.com/ysr666/dsh-vision-router) — vision routing, tool registration, client-side UI

<a id="note-on-unpinned-community-sources"></a>
### Note on unpinned community sources

> Earlier revisions of this guide cited `deepseek-harness.github.io` and `dsh.so` as primary sources. Neither could be verified against the repository while writing this revision — the generated documentation site did not yield content and the community guide path no longer resolves — and community guides drift faster than the source. **Prefer the repository's `docs/` tree and your installed `.d.ts` files.** When a community page and the repository disagree, the repository is right.
