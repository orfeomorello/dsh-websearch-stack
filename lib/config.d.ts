import Schema from '@deepseek-ai/schemastery';
import type { Volatile } from '@deepseek-ai/cordis';
/** Search backends the stack knows how to call, by their canonical identifiers. */
export declare const BACKEND_IDS: readonly ["tavily", "parallel-mcp", "searxng", "brave", "tinyfish", "exa"];
export type BackendId = (typeof BACKEND_IDS)[number];
/**
 * Resolved plugin configuration. Every field is a volatile reference: the
 * Plugins page renders a form from this schema and edits it in place, so the
 * stack reads `.get()` per operation instead of freezing values at
 * registration. An ordered chain is what makes the fallback user-tunable.
 */
export interface StackConfig {
    /** Ordered fallback chain. An empty list disables the plugin. */
    enabled_providers: Volatile<BackendId[]>;
    /** Base URL of a self-hosted SearXNG instance, for example http://localhost:8080. */
    searxng_url: Volatile<string | undefined>;
    /** Upper bound on sources returned per query, when the request names none. */
    default_max_results: Volatile<number>;
    /** Per-backend request timeout in milliseconds. */
    default_timeout_ms: Volatile<number>;
    /** In-memory TTL for identical queries; 0 disables the cache. */
    cache_ttl_seconds: Volatile<number>;
}
export declare const Config: Schema<StackConfig>;
