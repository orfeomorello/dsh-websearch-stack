import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
export interface ParallelMcpOptions {
    /** Read the request timeout, in milliseconds. */
    readonly timeoutMs: () => number;
    /** Read the source cap to apply when the request names none. */
    readonly limit: () => number;
}
/**
 * Parallel search through its remote MCP server over Streamable HTTP, via JSON-RPC
 * `tools/call` on `web_search`. Input is `objective` (natural language) plus
 * `search_queries` (array of short keyword queries). Verified against the live
 * endpoint with `tools/list`. Keyless: no credentials are sent.
 */
export declare class ParallelMcpBackend implements WebSearchProvider {
    private readonly options;
    readonly id = "parallel-mcp";
    constructor(options: ParallelMcpOptions);
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
