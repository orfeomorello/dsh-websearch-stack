import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-web'
import { Config as ConfigSchema, type BackendId, type StackConfig } from './config.ts'
import { TavilyBackend } from './backends/tavily.ts'
import { ParallelMcpBackend } from './backends/parallel-mcp.ts'
import { SearxngBackend } from './backends/searxng.ts'
import { BraveBackend } from './backends/brave.ts'
import { TinyfishBackend } from './backends/tinyfish.ts'
import { ExaBackend } from './backends/exa.ts'
import { StackSearchProvider } from './stack.ts'
import type { WebSearchProvider } from '@deepseek-ai/dsh-web'

export const name = 'websearch-stack'
export const inject = ['web']
export const Config = ConfigSchema

/** Build the backend object for one identifier, with the plugin's shared options. */
function makeBackend(id: BackendId, config: StackConfig): WebSearchProvider {
  switch (id) {
    case 'tavily':
      // Optional: without a key Tavily runs keyless (x-tavily-access-mode: keyless).
      return new TavilyBackend({
        apiKey: process.env.TAVILY_API_KEY,
        timeoutMs: config.default_timeout_ms,
      })
    case 'parallel-mcp':
      return new ParallelMcpBackend({ timeoutMs: config.default_timeout_ms })
    case 'searxng':
      return new SearxngBackend({
        baseUrl: config.searxng_url,
        timeoutMs: config.default_timeout_ms,
        language: 'en',
      })
    case 'brave':
      return new BraveBackend({
        apiKey: process.env.BRAVE_SEARCH_API_KEY,
        timeoutMs: config.default_timeout_ms,
      })
    case 'tinyfish':
      return new TinyfishBackend({
        apiKey: process.env.TINYFISH_API_KEY,
        timeoutMs: config.default_timeout_ms,
      })
    case 'exa':
      return new ExaBackend({
        apiKey: process.env.EXA_API_KEY,
        timeoutMs: config.default_timeout_ms,
      })
  }
}

/**
 * Register the stack on `ctx.web`. The provider is registered only when at least one
 * backend is enabled: an empty `enabled_providers` leaves `web_search` to the host.
 * Registration is effect-scoped, so disposing the fiber removes the provider.
 */
export function apply(ctx: Context, config: StackConfig): void {
  if (config.enabled_providers.length === 0) return

  const chain = config.enabled_providers.map((id) => ({
    id,
    provider: makeBackend(id, config),
  }))

  ctx.web.registerSearchProvider(new StackSearchProvider(chain))
}
