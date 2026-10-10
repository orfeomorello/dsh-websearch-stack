import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
export interface TinyfishOptions {
    /** TinyFish API key sent as `X-API-Key`. `undefined` makes the backend unavailable. */
    readonly apiKey: string | undefined;
    readonly timeoutMs: number;
}
/**
 * TinyFish Search backend, documented at https://docs.tinyfish.ai/search-api/reference:
 * `GET https://api.search.tinyfish.ai?query=...` with the `X-API-Key` header. Requires a key.
 * Free up to 12,000 requests per day; 30 requests per minute per key by default.
 */
export declare class TinyfishBackend implements WebSearchProvider {
    private readonly options;
    readonly id = "tinyfish";
    constructor(options: TinyfishOptions);
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
