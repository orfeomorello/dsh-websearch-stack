import Schema from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'

/** Search backends the stack knows how to call, by their canonical identifiers. */
export const BACKEND_IDS = ['tavily', 'parallel-mcp', 'searxng', 'brave', 'tinyfish', 'exa'] as const
export type BackendId = (typeof BACKEND_IDS)[number]

/**
 * Resolved plugin configuration. Every field is a volatile reference: the
 * Plugins page renders a form from this schema and edits it in place, so the
 * stack reads `.get()` per operation instead of freezing values at
 * registration. An ordered chain is what makes the fallback user-tunable.
 */
export interface StackConfig {
  /** Ordered fallback chain. An empty list disables the plugin. */
  enabled_providers: Volatile<BackendId[]>
  /** Base URL of a self-hosted SearXNG instance, for example http://localhost:8080. */
  searxng_url: Volatile<string | undefined>
  /** Upper bound on sources returned per query, when the request names none. */
  default_max_results: Volatile<number>
  /** Per-backend request timeout in milliseconds. */
  default_timeout_ms: Volatile<number>
  /** In-memory TTL for identical queries; 0 disables the cache. */
  cache_ttl_seconds: Volatile<number>
}

export const Config = Schema.object({
  enabled_providers: Schema.array(Schema.union(BACKEND_IDS.map((id) => Schema.const(id))))
    .default(['tavily', 'parallel-mcp'])
    .volatile()
    .description('Ordered fallback chain of search backends. Empty list = plugin disabled.'),
  searxng_url: Schema.string()
    .volatile()
    .description('Base URL of a self-hosted SearXNG instance, for example http://localhost:8080.'),
  default_max_results: Schema.number()
    .min(1)
    .max(20)
    .default(5)
    .volatile()
    .description('Maximum number of sources returned per query, when the request names none.'),
  default_timeout_ms: Schema.number()
    .min(1000)
    .max(60000)
    .default(10000)
    .volatile()
    .description('Per-backend request timeout in milliseconds.'),
  cache_ttl_seconds: Schema.number()
    .min(0)
    .max(3600)
    .default(60)
    .volatile()
    .description('In-memory TTL for identical queries; 0 disables the cache.'),
}).default({}) as Schema<StackConfig>
