import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { requestJson } from '../http.ts'

const MCP_ENDPOINT = 'https://search.parallel.ai/mcp'

export interface ParallelMcpOptions {
  /** Read the request timeout, in milliseconds. */
  readonly timeoutMs: () => number
  /** Read the source cap to apply when the request names none. */
  readonly limit: () => number
}

/** One result as returned by Parallel's `web_search` tool (verified via `tools/list`). */
interface ParallelResult {
  readonly url?: string
  readonly title?: string | null
  readonly publish_date?: string | null
  readonly excerpts?: ReadonlyArray<string>
}

/** The tool result: `structuredContent` holds the typed response, `content` a text fallback. */
interface JsonRpcResponse {
  readonly result?: {
    readonly structuredContent?: { readonly results?: ReadonlyArray<ParallelResult> }
    readonly isError?: boolean
    readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>
  }
  readonly error?: { readonly message?: string }
}

/**
 * Parallel search through its remote MCP server over Streamable HTTP, via JSON-RPC
 * `tools/call` on `web_search`. Input is `objective` (natural language) plus
 * `search_queries` (array of short keyword queries). Verified against the live
 * endpoint with `tools/list`. Keyless: no credentials are sent.
 */
export class ParallelMcpBackend implements WebSearchProvider {
  readonly id = 'parallel-mcp'

  constructor(private readonly options: ParallelMcpOptions) {}

  available(): boolean {
    return true
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search',
        arguments: {
          objective: request.query,
          search_queries: [request.query],
        },
      },
    }

    const json = (await requestJson(
      MCP_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
      },
      this.options.timeoutMs(),
      signal,
    )) as JsonRpcResponse

    if (json.error !== undefined) {
      throw new WebError(`MCP error: ${json.error.message ?? 'unknown'}`, 'WEB_PROVIDER_ERROR')
    }
    if (json.result?.isError === true) {
      const text = json.result.content?.find((c) => c.type === 'text')?.text ?? 'tool error'
      throw new WebError(`Parallel MCP tool error: ${text.slice(0, 200)}`, 'WEB_PROVIDER_ERROR')
    }

    const items = json.result?.structuredContent?.results
    if (!Array.isArray(items)) {
      throw new WebError('Parallel MCP response has no structured results', 'WEB_PROVIDER_ERROR')
    }

    const limit = request.maxResults ?? this.options.limit()
    const all = items
      .filter((item) => typeof item.url === 'string' && item.url.length > 0)
      .map((item) => {
        const excerpt = item.excerpts?.find((e: string) => typeof e === 'string' && e.length > 0)
        return {
          url: item.url as string,
          ...(typeof item.title === 'string' ? { title: item.title } : {}),
          ...(excerpt !== undefined ? { snippet: excerpt } : {}),
          ...(typeof item.publish_date === 'string' ? { publishedAt: item.publish_date } : {}),
        }
      })

    return { sources: all.slice(0, limit), truncated: all.length > limit }
  }
}
