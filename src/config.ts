import Schema from '@deepseek-ai/schemastery'

/** Search backends the stack knows how to call, by their canonical identifiers. */
export const BACKEND_IDS = ['tavily', 'parallel-mcp', 'searxng', 'brave', 'tinyfish'] as const
export type BackendId = (typeof BACKEND_IDS)[number]

export interface StackConfig {
  /** Ordered fallback chain. An empty list disables the plugin. */
  enabled_providers: BackendId[]
  /** Base URL of a self-hosted SearXNG instance, for example http://localhost:8080. */
  searxng_url: string | undefined
  /** Upper bound on sources returned per query. */
  default_max_results: number
  /** Per-backend request timeout in milliseconds. */
  default_timeout_ms: number
  /** In-memory TTL for identical queries; 0 disables the cache. */
  cache_ttl_seconds: number
}

export const Config = Schema.object({
  enabled_providers: Schema.array(Schema.union(BACKEND_IDS.map((id) => Schema.const(id))))
    .default(['tavily', 'parallel-mcp'])
    .description('Ordered fallback chain of search backends. Empty list = plugin disabled.'),
  searxng_url: Schema.string()
    .description('Base URL of a self-hosted SearXNG instance, for example http://localhost:8080.'),
  default_max_results: Schema.number()
    .min(1)
    .max(20)
    .default(5)
    .description('Maximum number of sources returned per query.'),
  default_timeout_ms: Schema.number()
    .min(1000)
    .max(60000)
    .default(10000)
    .description('Per-backend request timeout in milliseconds.'),
  cache_ttl_seconds: Schema.number()
    .min(0)
    .max(3600)
    .default(60)
    .description('In-memory TTL for identical queries; 0 disables the cache.'),
}).default({}) as Schema<StackConfig>
