# dsh-websearch-stack

[![CI](https://github.com/orfeomorello/dsh-websearch-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/orfeomorello/dsh-websearch-stack/actions/workflows/ci.yml)

Multi-provider web search for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). The plugin registers one search provider on the `ctx.web` seam; that provider runs an ordered fallback chain over the backends you enable.

> **Status**: v0.1.0, MVP. Six backends implemented and unit-tested. Verified live: **Tavily keyless** and **Parallel MCP**. The others need an API key or a local instance and are not yet verified — see [Known limitations](#known-limitations).

## Features

- **Six search backends**: Tavily (keyless-capable), Parallel MCP (no credentials), SearXNG (self-hosted), Brave, TinyFish, Exa.
- **Ordered fallback chain**: a recoverable error (network, timeout, rate limit, bad response) moves to the next backend; a terminal one aborts; if all fail the error lists every attempt.
- **Web settings card** (client half): manage the four key-backed API keys from the web client's Plugins page, written through the Host's credentials store — never into a settings file.
- **No secrets in YAML**: keys come from environment variables or the Host credential store.

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

Options live in the `websearch-stack` section of the profile config.

| Option | Default | Meaning |
|---|---|---|
| `enabled_providers` | `['tavily', 'parallel-mcp']` | Fallback chain, in order. Values: `tavily`, `parallel-mcp`, `searxng`, `brave`, `tinyfish`, `exa`. Empty list = plugin disabled. |
| `searxng_url` | — | Base URL of a self-hosted SearXNG instance, e.g. `http://localhost:8080`. Required for `searxng`. |
| `default_max_results` | `5` | Maximum sources per query (1–20). |
| `default_timeout_ms` | `10000` | Per-backend request timeout in milliseconds (1 000–60 000). |
| `cache_ttl_seconds` | `60` | Cache TTL for identical queries. `0` disables the cache. |

Example putting SearXNG at the head of the chain:

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

Keys are read from the environment variables above. The config YAML never holds secrets.

### Settings card (web client)

The plugin ships a configuration card for the dsh web client (`dsh.client.platform: "web"`). It appears on the **Plugins** page under the `dsh-websearch-stack` bundle and manages the four key-backed API keys through the Host's `credentials` service:

- the state badge shows only whether a key is configured (`describe`), never the value;
- what you write lands in the Host credential store (e.g. `$DSH_HOME/.credentials.yaml`), not in any settings document;
- a field left blank does not clear the stored key.

A key stored from the page loses to a differently named environment export: an ambient variable is read-only and wins, so what the page writes takes effect only when the environment does not also export that name.

> **UI status**: implemented and covered by bundle smoke tests, but not yet exercised inside a running web client. Not part of the MVP verification.

### Coexisting with the native DeepSeek provider

The `web` profile already ships `web-search-deepseek`. That provider is usable only with a key (`DEEPSEEK_API_KEY`). The `ctx.web` seam allows exactly one usable provider when none is pinned, so:

- **Without `DEEPSEEK_API_KEY`**: the DeepSeek provider is unusable and the stack is the only candidate. Nothing to configure.
- **With `DEEPSEEK_API_KEY`**: both providers are usable and the seam answers `WEB_PROVIDER_AMBIGUOUS`. Pin one in the `web` service config with `searchProvider: websearch-stack` (a `WebRuntimeConfig` field, not this plugin's). The plugin cannot set it itself — `apply` only receives its own config.

## How the fallback works

The seam accepts a single usable search provider when none is configured. So the plugin registers exactly one provider, `websearch-stack`, that walks the backends in order:

- a recoverable error (network, timeout, rate limit, invalid response) moves to the next backend;
- a terminal error (e.g. cancellation) stops the chain and rethrows;
- if all fail, the error lists every attempt.

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
- **UI never run in a real client.** The settings card exists (keys via `credentials`), but has never been exercised inside a running web client; backend enablement stays YAML-only.
- **Coexistence with DeepSeek.** With `DEEPSEEK_API_KEY` set, `searchProvider` must be pinned in the `web` service config (see above).
- **No fetch.** Page fetching is handled by DSH's `dsh-web-fetch-http` provider, not this plugin.
- **Not a sandbox.** The code runs inside the host process with its privileges, like every dsh plugin.

## License

MIT — see [LICENSE](LICENSE).
