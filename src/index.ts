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
import { KEY_REFERENCES, KeyStore, REFERENCE_UPDATED_EVENT, type CredentialsLike, type KeyReference } from './keys.ts'
import type { WebSearchProvider } from '@deepseek-ai/dsh-web'

export const name = 'websearch-stack'
export const inject = ['web']
export const Config = ConfigSchema

/** The credential reference each key-backed backend resolves. */
const KEY_OF: Record<'tavily' | 'brave' | 'tinyfish' | 'exa', KeyReference> = {
  tavily: 'TAVILY_API_KEY',
  brave: 'BRAVE_SEARCH_API_KEY',
  tinyfish: 'TINYFISH_API_KEY',
  exa: 'EXA_API_KEY',
}

/**
 * Build the backend object for one identifier. Every option is a resolver, so
 * a config edit on the Plugins page or a key rotated in the credential store
 * lands on the next request rather than at the next boot.
 */
function makeBackend(id: BackendId, config: StackConfig, keys: KeyStore): WebSearchProvider | undefined {
  const timeoutMs = () => config.default_timeout_ms.get()
  const limit = () => config.default_max_results.get()
  switch (id) {
    case 'tavily':
      return new TavilyBackend({ apiKey: () => keys.of(KEY_OF.tavily), timeoutMs, limit })
    case 'parallel-mcp':
      return new ParallelMcpBackend({ timeoutMs, limit })
    case 'searxng':
      return new SearxngBackend({ baseUrl: () => config.searxng_url.get(), timeoutMs, limit, language: 'en' })
    case 'brave':
      return new BraveBackend({ apiKey: () => keys.of(KEY_OF.brave), timeoutMs, limit })
    case 'tinyfish':
      return new TinyfishBackend({ apiKey: () => keys.of(KEY_OF.tinyfish), timeoutMs, limit })
    case 'exa':
      return new ExaBackend({ apiKey: () => keys.of(KEY_OF.exa), timeoutMs, limit })
  }
}

/**
 * Subscribe to a Host event whose name the installed cordis typings do not
 * carry: `credentials/reference-updated` and `loader/volatile-update` are
 * documented Host events, not core cordis ones.
 */
function onHostEvent(ctx: Context, event: string, listener: (payload: unknown) => void): () => void {
  const on = ctx.on as unknown as (name: string, listener: (payload: unknown) => void) => () => void
  return on(event, listener)
}

/**
 * Register the stack on `ctx.web`.
 *
 * The provider is registered once and always: `available()` answers for the
 * chain currently in force, so an empty list — or a chain whose keys are all
 * missing — makes the seam answer `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` (the
 * bundle patch pins `web.searchProvider` here), which is a louder and clearer
 * signal than silently handing `web_search` to another provider.
 *
 * Keys come from the Host credentials service when it is served, and from the
 * environment otherwise; the service is read through `ctx.get` so a deployment
 * without it still boots with environment keys alone.
 */
export function apply(ctx: Context, config: StackConfig): void {
  const credentials = ctx.get('credentials') as CredentialsLike | undefined
  const keys = new KeyStore(credentials)

  ctx.effect(() => {
    void keys.sync()
    return () => {}
  }, 'websearch-stack: initial credentials')

  // A key can be written from the settings card while this provider runs, so
  // re-resolve the reference the Host reports instead of waiting for a boot.
  ctx.effect(() => onHostEvent(ctx, REFERENCE_UPDATED_EVENT, (ref) => {
    if (typeof ref === 'string' && (KEY_REFERENCES as readonly string[]).includes(ref)) {
      void keys.refresh(ref as KeyReference)
    }
  }), 'websearch-stack: credential refresh')

  // Volatile config edits keep the plugin instance, so log the new chain: the
  // fallback order is the one thing a user cannot see from the outside.
  ctx.effect(() => onHostEvent(ctx, 'loader/volatile-update', () => {
    const chain = config.enabled_providers.get().join(' → ')
    ctx.logger('websearch-stack').info('fallback chain updated: %s', chain.length > 0 ? chain : '(none)')
  }), 'websearch-stack: volatile updates')

  ctx.web.registerSearchProvider(new StackSearchProvider(
    () => config.enabled_providers.get(),
    (id) => makeBackend(id, config, keys),
    () => config.cache_ttl_seconds.get(),
  ))
}
