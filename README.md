# dsh-websearch-stack

[![CI](https://github.com/orfeomorello/dsh-websearch-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/orfeomorello/dsh-websearch-stack/actions/workflows/ci.yml)

Multi-provider web search for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). The plugin registers one search provider on the `ctx.web` seam; that provider runs an ordered fallback chain over the backends you enable.

> **Status**: v0.1.0, MVP. Six backends implemented and unit-tested. Verified live: **Tavily keyless** and **Parallel MCP**. The others need an API key or a local instance and are not yet verified — see [Known limitations](#known-limitations).

## Features

- **Six search backends**: Tavily (keyless-capable), Parallel MCP (no credentials), SearXNG (self-hosted), Brave, TinyFish, Exa.
- **Ordered fallback chain**: a recoverable error (network, timeout, rate limit, bad response) moves to the next backend; a terminal one aborts; if all fail the error lists every attempt.
- **Keys without a restart**: the four key-backed backends are configured from the web client's Plugins page, written through the Host's credential store and resolved per request — never into a settings file, with environment variables as the fallback.
- **Boot-time chain**: the chain order, the SearXNG URL, the result cap, the timeout and the cache TTL are volatile fields set from your profile's patch layer (see [Configuration](#configuration)).

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

## Quick start

The default chain `['tavily', 'parallel-mcp']` works with **no key and no configuration**: Tavily runs keyless, Parallel needs no credentials. Install the plugin, restart the profile, and ask anything that needs current information — `web_search` answers through the chain.

From there:

- **want more or different sources?** reorder the chain or add a backend in the profile patch (see [Configuration](#configuration)) — SearXNG, Brave, TinyFish and Exa each need their own setup;
- **want your own instance?** follow [SearXNG](#searxng): no external API, no key, your infra;
- **want higher-quality Tavily results or Brave/Exa?** paste a key on the plugin's page in the web client; it takes effect on the next request.

## Configuration

Two surfaces, because the web client's Plugins page can only write credentials:

| What | Where | When it takes effect |
|---|---|---|
| API keys (`TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `TINYFISH_API_KEY`, `EXA_API_KEY`) | the **Plugins page** → this bundle's page, through the settings card | the next request, no restart |
| `enabled_providers`, `searxng_url`, `default_max_results`, `default_timeout_ms`, `cache_ttl_seconds` | your profile's `cordis.patch.yml` (or a `--patch` overlay) | at the next profile boot |

The second list is a host limitation, not a plugin one: in `@deepseek-ai/dsh-client-ui-plugin-manager` 0.2.0-rc.2 the page renders `plugins.bundle.config` **without** a config form, so a bundle's own fields never get a widget. The fields are declared volatile (each one a reference the Host can rewrite in place), so a form written against `plugins.row.config` — or any CLI tooling that writes the namespace — would apply them live; today the profile patch is the way.

### Boot-time values

The values live in the profile's own patch layer, `$DSH_HOME/profiles/<profile>/cordis.patch.yml`, keyed by this plugin's row id. This shape is verified with `dsh --profile <profile> --dump-config`:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: websearch-stack
  name: dsh-websearch-stack
  config:
    enabled_providers: [tavily, parallel-mcp]
    default_max_results: 5
```

For a one-off try without touching the file, an overlay applied after every other layer:

```bash
dsh --profile web --patch ./searxng.yml
```

```yaml
# searxng.yml
- id: websearch-stack
  name: dsh-websearch-stack
  config:
    enabled_providers: [searxng, tavily]
    searxng_url: http://localhost:8080
```

An absent field keeps its default. An unknown value is refused by the schema, so a typo fails the boot instead of silently disabling a backend.

A Compose-style setup can keep the URL in the environment instead: the entry-list YAML dialect evaluates `!!js` scalars at entry activation, with Node globals in scope.

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: websearch-stack
  name: dsh-websearch-stack
  config:
    enabled_providers: [searxng, tavily]
    searxng_url: !!js process.env.SEARXNG_URL ?? ''
```

`--dump-config` prints the expression node unevaluated — the dump is the stored patch, not the resolved value.

| Option | Default | Meaning |
|---|---|---|
| `enabled_providers` | `['tavily', 'parallel-mcp']` | Fallback chain, in order. Values: `tavily`, `parallel-mcp`, `searxng`, `brave`, `tinyfish`, `exa`. An empty list disables the plugin (see [How the fallback works](#how-the-fallback-works)). |
| `searxng_url` | — | Base URL of a self-hosted SearXNG instance, e.g. `http://localhost:8080`. Required for `searxng`. |
| `default_max_results` | `5` | Maximum sources per query when the request names none (1–20). |
| `default_timeout_ms` | `10000` | Per-backend request timeout in milliseconds (1 000–60 000). |
| `cache_ttl_seconds` | `60` | Cache TTL for identical queries. `0` disables the cache. |

### SearXNG

The self-hosted option: your instance, no external API, no key. It needs two things — an instance with the JSON format enabled, and `searxng_url` pointing at it.

1. Run an instance (Docker Compose, the project's recommended layout):

```bash
mkdir -p ./searxng/core-config/
cd ./searxng/
curl -fsSLO https://raw.githubusercontent.com/searxng/searxng/master/container/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/searxng/searxng/master/container/.env.example
cp -i .env.example .env
docker compose up -d
```

2. Enable the JSON format in `core-config/settings.yml` — `json` is **not** in the default `search.formats` (`html` only):

```yaml
search:
  formats:
    - html
    - json
```

3. Point the plugin at it (profile patch, then restart the profile):

```yaml
- id: websearch-stack
  name: dsh-websearch-stack
  config:
    enabled_providers: [searxng, tavily, parallel-mcp]
    searxng_url: http://localhost:8080
```

The backend calls `GET <searxng_url>/search?q=…&format=json&language=en` and reads `results[].{url,title,content}`. Without `searxng_url` the backend reports itself unavailable and the chain moves on. SearXNG's own installation details are in its [container](https://docs.searxng.org/admin/installation-docker.html) and [`search:` settings](https://docs.searxng.org/admin/settings/settings_search.html) pages.

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

> **UI status**: the page and the card were exercised in a live web client (the bundle page, its title, the key controls and the providers section render). What the host does **not** render is a form for this bundle's own config fields — see [Configuration](#configuration) and [Known limitations](#known-limitations).

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

The chain order is read on every request, so an edit to `enabled_providers` in the profile patch takes effect from the next boot, and every backend in the chain is re-resolved per request. When the chain is empty — or every backend in it is unavailable — `available()` is false and the seam answers `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`, because the bundle patch pins `searchProvider` to this provider. Re-add a backend in the profile patch to make `web_search` work again.

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
- **The chain is not editable from the web client.** The Plugins page renders a bundle's configuration card (the API keys here) but not a form for the bundle's own config fields: in `@deepseek-ai/dsh-client-ui-plugin-manager` 0.2.0-rc.2, `plugins.bundle.config` is rendered without the `form` prop, while `plugins.row.config` receives it. A `plugins.row.config` entry for the plugin's row could close this gap; until then, edit `$DSH_HOME/profiles/<profile>/cordis.patch.yml` and restart the profile (see [Configuration](#configuration)).
- **Pinned seam, by design.** The bundle patch pins `web.searchProvider` to `websearch-stack`, because the base profile pins it to the DeepSeek provider, which is `available()` without a key. Consequence: with an empty chain `web_search` fails with `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` instead of falling back to the native provider (see [Coexisting with the native DeepSeek provider](#coexisting-with-the-native-deepseek-provider)).
- **No fetch.** Page fetching is handled by DSH's `dsh-web-fetch-http` provider, not this plugin.
- **Not a sandbox.** The code runs inside the host process with its privileges, like every dsh plugin.

## License

MIT — see [LICENSE](LICENSE).
