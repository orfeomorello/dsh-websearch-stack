import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
export interface ParallelMcpOptions {
    readonly timeoutMs: number;
}
/**
 * Parallel search through its remote MCP server, over the Streamable HTTP transport.
 * The stack speaks JSON-RPC directly: `tools/call` on `web_search`. Keyless use only;
 * no credentials are sent.
 */
export declare class ParallelMcpBackend implements WebSearchProvider {
    private readonly options;
    readonly id = "parallel-mcp";
    constructor(options: ParallelMcpOptions);
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
