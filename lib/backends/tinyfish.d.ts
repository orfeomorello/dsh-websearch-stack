import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
export interface TinyfishOptions {
    /** Read the TinyFish API key sent as `X-API-Key`. An empty read makes the
     * backend unavailable. */
    readonly apiKey: () => string | undefined;
    /** Read the request timeout, in milliseconds. */
    readonly timeoutMs: () => number;
    /** Read the source cap to apply when the request names none. */
    readonly limit: () => number;
}
/**
 * TinyFish Search backend, documented at https://docs.tinyfish.ai/search-api/reference:
 * `GET https://api.search.tinyfish.ai?query=...` with the `X-API-Key` header. Requires a key.
 * Free allowance of 12,000 requests per day, per https://docs.tinyfish.ai/search-api/reference.
 * Without a key the endpoint returns HTTP 401 (verified live).
 */
export declare class TinyfishBackend implements WebSearchProvider {
    private readonly options;
    readonly id = "tinyfish";
    constructor(options: TinyfishOptions);
    available(): boolean;
    /** The key for this request, read from the credential store per operation. */
    private key;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
