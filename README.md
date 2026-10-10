# dsh-websearch-stack

[![CI](https://github.com/orfeomorello/dsh-websearch-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/orfeomorello/dsh-websearch-stack/actions/workflows/ci.yml)

Multi-provider web search for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). The plugin registers one search provider on the `ctx.web` seam; that provider runs an ordered fallback chain over the backends you enable.

> **Status**: v0.1.0, MVP. Six backends implemented and unit-tested. Verified live: **Tavily keyless** and **Parallel MCP**. The others need an API key or a local instance and are not yet verified — see [Known limitations](#known-limitations).

## Features

- **Six search backends**: Tavily (keyless-capable), Parallel MCP (no credentials), SearXNG (self-hosted), Brave, TinyFish, Exa.
- **Ordered fallback chain**: a recoverable error (network, timeout, rate limit, bad response) moves to the next backend; a terminal one aborts; if all fail the error lists every attempt.
- **Live configuration**: the chain order, the SearXNG URL, the result cap, the timeout and the cache TTL are volatile fields, editable from the web client's Plugins page and applied on the next request.
- **Web settings card** (client half): manage the four key-backed API keys from the web client's Plugins page, written through the Host's credentials store — never into a settings file.
- **No secrets in YAML**: keys come from the Host credential store, with environment variables as the fallback.

## Install

`lib/` is committed, so installing from GitHub needs no build step.

```bash
dsh plugin --profile web add github:orfeomorello/dsh-websearch-stack
```

To try on a disposable profile first:

```bash
dsh --profile web --dump-config > before.txt
dsh plugin --profile web add github:orfeomorello/dsh-websearch-stack
dsh --profile web --dump-config > after.txt
```

## Configuration

Every option below is a **volatile** field: the Plugins page in the dsh web client renders a form from this schema, and an edit lands on the next request with no restart — the plugin instance is preserved, including the provider registration. The same fields can also be set in the `websearch-stack` section of the profile config for the initial value.

| Option | Default | Meaning |
|---|---|---|
| `enabled_providers` | `['tavily', 'parallel-mcp']` | Fallback chain, in order. Values: `tavily`, `parallel-mcp`, `searxng`, `brave`, `tinyfish`, `exa`. An empty list disables the plugin (see [How the fallback works](#how-the-fallback-works)). |
| `searxng_url` | — | Base URL of a self-hosted SearXNG instance, e.g. `http://localhost:8080`. Required for `searxng`. |
| `default_max_results` | `5` | Maximum sources per query when the request names none (1–20). |
| `default_timeout_ms` | `10000` | Per-backend request timeout in milliseconds (1 000–60 000). |
| `cache_ttl_seconds` | `60` | Cache TTL for identical queries. `0` disables the cache. |

The profile config is the boot-time value of the same fields, so a chain written there is what the page starts from:

> The exact shape of the `config:` line in a profile patch is not yet verified with `dsh --profile web --dump-config` on a profile with the plugin installed. Check it first. The plugin guide (`docs/PLUGIN-GUIDE.md`, `cordis.patch.yml` section) indicates a row may carry `config:`:

```yaml
- insert:
    - id: websearch-stack
      name: dsh-websearch-stack
      config:
        enabled_providers: [searxng, tavily, parallel-mcp]
        searxng_url: http://localhost:8080
```

### SearXNG

Needs an instance with the JSON format enabled. In SearXNG's `settings.yml`:

```yaml
search:
  formats:
    - html
    - json
```

## Backends

| Id | Key | Notes |
|---|---|---|
| `tavily` | `TAVILY_API_KEY` (optional) | Without a key sends `x-tavily-access-mode: keyless` (verified live). With a key, `Bearer`. |
| `parallel-mcp` | none | JSON-RPC `tools/call` on `web_search` (arguments `objective` and `search_queries`), no credentials. Verified live. |
| `searxng` | none | Self-hosted instance, requires `searxng_url`. Not verified (needs an instance). |
| `brave` | `BRAVE_SEARCH_API_KEY` | `X-Subscription-Token`. Not verified with a real key. |
| `tinyfish` | `TINYFISH_API_KEY` | `X-API-Key`. Not verified with a real key. |
| `exa` | `EXA_API_KEY` | `x-api-key`, `POST /search`. Not verified with a real key. |

Keys are read from the Host credential store, with the environment variables above as the fallback: a key written from the settings card is resolved per request, so it needs no environment export. The config YAML never holds secrets.

### Settings card (web client)

The plugin ships a configuration card for the dsh web client (`dsh.client.platform: "web"`). It appears on the **Plugins** page under the `dsh-websearch-stack` bundle and manages the four key-backed API keys through the Host's `credentials` service:

- the state badge shows only whether a key is configured (`describe`), never the value;
- what you write lands in the Host credential store (e.g. `$DSH_HOME/.credentials.yaml`), not in any settings document;
- the provider re-resolves the reference on the Host's `credentials/reference-updated` event, so a key written from the page takes effect on the next request without a reboot;
- a field left blank does not clear the stored key;
- each field is named after its provider — `Tavily API key`, `Brave Search API key`, `TinyFish API key`, `Exa API key` — and the **Search providers** section below links every backend to its owner's site (see below).

> **UI status**: implemented and covered by bundle smoke tests, but not yet exercised inside a running web client. Not part of the MVP verification.

### What the plugin page shows

The Plugins page's detail for this bundle states the bundle's own identity —
its display title from `locale/en.json`, its version, and the package name
(the one you install elsewhere, in a `<code>` line) — then this plugin's
configuration: the four key controls, named after their provider, and a
**Search providers** section listing every backend the chain vocabulary accepts:

| Provider | What it takes | Where to configure |
|---|---|---|
| Tavily | API key optional (works keyless) | https://app.tavily.com/home |
| Parallel | No key needed | https://docs.parallel.ai/ |
| SearXNG | Self-hosted instance | https://docs.searxng.org/ |
| Brave Search | API key | https://brave.com/search/api/ |
| TinyFish | API key | https://docs.tinyfish.ai/search-api/reference |
| Exa | API key | https://exa.ai/ |

Each row links to its owner's site, where a key is created or the service is
documented. The section is the bundle's contribution to the page's
`plugins.detail.section` slot; the copy lives in `src/client/card.ts`.

### Coexisting with the native DeepSeek provider

The `web` profile already ships `web-search-deepseek` (provider id `deepseek-official`), and `@deepseek-ai/dsh-base` pins the seam to it:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-official
    fetchProvider: http
```

That pin is the whole problem for any third-party search provider: the DeepSeek provider's `available()` is true **even without `DEEPSEEK_API_KEY`** (it resolves the credential per search, not at selection time), so with the pin in force every `web_search` fails with `WEB_PROVIDER_CREDENTIAL_MISSING` and never reaches a provider this bundle registers.

This bundle's `cordis.patch.yml` therefore overrides that row (later bundle layers win; the profile's own patch, the home patch and `--patch` overlays are later still and can pin anything they want):

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: websearch-stack
    fetchProvider: http
```

A patch replaces the matched row's whole `config` — never a deep merge — so `fetchProvider: http` is restated exactly as the base row leaves it. Without `@deepseek-ai/dsh-base` in the profile the `web` row does not exist, the override is skipped with a loader warning, and the seam auto-selects this provider as the only usable one.

To hand `web_search` back to the native provider, re-pin it in your profile's `cordis.patch.yml` (or `--patch`), restating both keys:

```yaml
- id: web
  config:
    searchProvider: deepseek-official
    fetchProvider: http
```

## How the fallback works

The seam accepts a single usable search provider when none is configured. So the plugin registers exactly one provider, `websearch-stack`, that walks the backends in order:

- a backend that is not available (no key, no SearXNG URL) is skipped before any request;
- a recoverable error (network, timeout, rate limit, invalid response, auth or credits) moves to the next backend;
- a terminal error (e.g. cancellation) stops the chain and rethrows;
- if all fail, the error lists every attempt.

The chain order is read on every request, so reordering it on the Plugins page changes the very next search. When the chain is empty — or every backend in it is unavailable — `available()` is false and the seam answers `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`, because the bundle patch pins `searchProvider` to this provider. Re-enable a backend on the Plugins page to make `web_search` work again, with no restart in between.

## Development

```bash
npm install
npm run typecheck     # tsc --noEmit
npm test              # unit/integration tests (node:test)
npm run build         # rebuild lib/ from src/ (also emits the client bundle)
npm run bundle:client # rebuild only lib/client.js (ModuleLoader bundle)
```

`lib/` is committed. After changing `src/`, run `npm run build` and commit `lib/` too — CI fails if they drift apart.

## Known limitations

- **Live services partially verified.** Tavily keyless and Parallel MCP verified live. Brave, TinyFish, Exa and SearXNG are not yet: they need API keys or a local instance.
- **UI never run in a real client.** The settings card exists (keys via `credentials`) and the config fields are declared volatile, but neither has been exercised inside a running web client.
- **Pinned seam, by design.** The bundle patch pins `web.searchProvider` to `websearch-stack`, because the base profile pins it to the DeepSeek provider, which is `available()` without a key. Consequence: with an empty chain `web_search` fails with `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` instead of falling back to the native provider (see [Coexisting with the native DeepSeek provider](#coexisting-with-the-native-deepseek-provider)).
- **No fetch.** Page fetching is handled by DSH's `dsh-web-fetch-http` provider, not this plugin.
- **Not a sandbox.** The code runs inside the host process with its privileges, like every dsh plugin.

## License

MIT — see [LICENSE](LICENSE).
