import Schema from '@deepseek-ai/schemastery';
/** Search backends the stack knows how to call, by their canonical identifiers. */
export declare const BACKEND_IDS: readonly ["tavily", "parallel-mcp", "searxng"];
export type BackendId = (typeof BACKEND_IDS)[number];
export interface StackConfig {
    /** Ordered fallback chain. An empty list disables the plugin. */
    enabled_providers: BackendId[];
    /** Base URL of a self-hosted SearXNG instance, for example http://localhost:8080. */
    searxng_url: string | undefined;
    /** Upper bound on sources returned per query. */
    default_max_results: number;
    /** Per-backend request timeout in milliseconds. */
    default_timeout_ms: number;
    /** In-memory TTL for identical queries; 0 disables the cache. */
    cache_ttl_seconds: number;
}
export declare const Config: Schema<StackConfig>;
