import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
export interface TavilyOptions {
    /** Read the optional API key. When the read is empty the keyless header is
     * sent. */
    readonly apiKey: () => string | undefined;
    /** Read the request timeout, in milliseconds. */
    readonly timeoutMs: () => number;
    /** Read the source cap to apply when the request names none. */
    readonly limit: () => number;
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
