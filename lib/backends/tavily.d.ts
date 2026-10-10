import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
export interface TavilyOptions {
    /** Optional API key. When absent the keyless header is sent. */
    readonly apiKey: string | undefined;
    readonly timeoutMs: number;
}
/**
 * Tavily search backend. Uses the keyless access mode when no key is configured.
 * The keyless header and endpoint are taken from the project brief and must be
 * confirmed against the live service before a release.
 */
export declare class TavilyBackend implements WebSearchProvider {
    private readonly options;
    readonly id = "tavily";
    constructor(options: TavilyOptions);
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
