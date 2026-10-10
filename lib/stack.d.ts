import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
import type { BackendId } from './config.js';
export interface FallbackAttempt {
    readonly provider: BackendId;
    readonly code: string;
    readonly message: string;
}
/**
 * The single `WebSearchProvider` the plugin registers on `ctx.web`. It runs the
 * configured backends in order and returns the first success. The seam allows only
 * one usable provider per capability, so the fallback chain lives here rather than
 * in several registrations.
 *
 * The order, the backends and the cache TTL are all read per operation, so an
 * edit on the Plugins page or a rotated credential lands on the next request
 * instead of at the next boot.
 */
export declare class StackSearchProvider implements WebSearchProvider {
    private readonly order;
    private readonly backendOf;
    private readonly cacheTtl;
    readonly id = "websearch-stack";
    private readonly cache;
    /**
     * @param order - the enabled backends in fallback order, read per operation.
     * @param backendOf - the backend for one identifier, or undefined when unknown.
     * @param cacheTtl - in-memory TTL for identical queries, in seconds.
     */
    constructor(order: () => readonly BackendId[], backendOf: (id: BackendId) => WebSearchProvider | undefined, cacheTtl: () => number);
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
    /** Identity of one query: the query text and the cap the request names. */
    private cacheKey;
    /** The cached result for one key while it is still inside its TTL. */
    private fresh;
    /** Store one result and drop every entry its TTL has elapsed. */
    private remember;
}
