import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
export interface SearxngOptions {
    /** Base URL of the SearXNG instance. `undefined` makes the backend unavailable. */
    readonly baseUrl: string | undefined;
    readonly timeoutMs: number;
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
