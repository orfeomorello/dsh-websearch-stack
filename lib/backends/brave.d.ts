import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
export interface BraveOptions {
    /** Brave Search API subscription token. `undefined` makes the backend unavailable. */
    readonly apiKey: string | undefined;
    readonly timeoutMs: number;
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
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
