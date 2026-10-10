import { WebError } from '@deepseek-ai/dsh-web';
import { requestJson } from "../http.js";
const MCP_ENDPOINT = 'https://search.parallel.ai/mcp';
/**
 * Parallel search through its remote MCP server, over the Streamable HTTP transport.
 * The stack speaks JSON-RPC directly: `tools/call` on `web_search`. Keyless use only;
 * no credentials are sent.
 */
export class ParallelMcpBackend {
    options;
    id = 'parallel-mcp';
    constructor(options) {
        this.options = options;
    }
    available() {
        return true;
    }
    async search(request, signal) {
        const body = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'web_search',
                arguments: {
                    query: request.query,
                    max_results: request.maxResults ?? 5,
                },
            },
        };
        const json = (await requestJson(MCP_ENDPOINT, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify(body),
        }, this.options.timeoutMs, signal));
        if (json.error !== undefined) {
            throw new WebError(`MCP error: ${json.error.message ?? 'unknown'}`, 'WEB_PROVIDER_ERROR');
        }
        if (json.result?.isError === true) {
            throw new WebError('Parallel MCP reported a tool error', 'WEB_PROVIDER_ERROR');
        }
        const items = json.result?.structuredContent?.results;
        if (!Array.isArray(items)) {
            throw new WebError('Parallel MCP response has no results', 'WEB_PROVIDER_ERROR');
        }
        const sources = items
            .filter((item) => typeof item.url === 'string' && item.url.length > 0)
            .map((item) => ({
            url: item.url,
            ...(item.title !== undefined ? { title: item.title } : {}),
            ...(item.excerpt !== undefined ? { snippet: item.excerpt } : {}),
        }));
        return { sources, truncated: false };
    }
}
