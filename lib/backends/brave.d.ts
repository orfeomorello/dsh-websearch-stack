import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
export interface BraveOptions {
    /** Read the Brave Search API subscription token. An empty read makes the
     * backend unavailable. */
    readonly apiKey: () => string | undefined;
    /** Read the request timeout, in milliseconds. */
    readonly timeoutMs: () => number;
    /** Read the source cap to apply when the request names none. */
    readonly limit: () => number;
}
/**
 * Brave Search web backend. Documented at
 * https://api-dashboard.search.brave.com/app/documentation/web-search/get-started:
 * `GET /res/v1/web/search?q=...&count=...` with the `X-Subscription-Token` header.
 * Requires an API key, so it is unavailable until one is configured.
 */
export declare class BraveBackend implements WebSearchProvider {
    private readonly options;
    readonly id = "brave";
    constructor(options: BraveOptions);
    available(): boolean;
    /** The token for this request, read from the credential store per operation. */
    private key;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
