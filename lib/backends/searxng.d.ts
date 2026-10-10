import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
export interface SearxngOptions {
    /** Read the base URL of the SearXNG instance. An empty read makes the
     * backend unavailable. */
    readonly baseUrl: () => string | undefined;
    /** Read the request timeout, in milliseconds. */
    readonly timeoutMs: () => number;
    /** Read the source cap to apply when the request names none. */
    readonly limit: () => number;
    readonly language: string;
}
/**
 * Self-hosted SearXNG backend. Calls `GET <baseUrl>/search?format=json`. Requires the
 * instance to have the JSON format enabled in its `search.formats` setting.
 */
export declare class SearxngBackend implements WebSearchProvider {
    private readonly options;
    readonly id = "searxng";
    constructor(options: SearxngOptions);
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
    private parsedBase;
}
