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
 */
export declare class StackSearchProvider implements WebSearchProvider {
    private readonly chain;
    readonly id = "websearch-stack";
    constructor(chain: ReadonlyArray<{
        id: BackendId;
        provider: WebSearchProvider;
    }>);
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
    /** Expose the chain's ids for diagnostics. */
    backendIds(): readonly BackendId[];
}
