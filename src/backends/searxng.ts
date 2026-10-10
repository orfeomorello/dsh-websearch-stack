import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { requestJson } from '../http.ts'

export interface SearxngOptions {
  /** Read the base URL of the SearXNG instance. An empty read makes the
   * backend unavailable. */
  readonly baseUrl: () => string | undefined
  /** Read the request timeout, in milliseconds. */
  readonly timeoutMs: () => number
  /** Read the source cap to apply when the request names none. */
  readonly limit: () => number
  readonly language: string
}

interface SearxngResponse {
  readonly answers?: ReadonlyArray<string>
  readonly results?: ReadonlyArray<{
    readonly title?: string
    readonly url?: string
    readonly content?: string
    readonly publishedDate?: string
  }>
}

/**
 * Self-hosted SearXNG backend. Calls `GET <baseUrl>/search?format=json`. Requires the
 * instance to have the JSON format enabled in its `search.formats` setting.
 */
export class SearxngBackend implements WebSearchProvider {
  readonly id = 'searxng'

  constructor(private readonly options: SearxngOptions) {}

  available(): boolean {
    return this.parsedBase() !== undefined
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const base = this.parsedBase()
    if (base === undefined) {
      throw new WebError('SearXNG URL is not configured', 'WEB_PROVIDER_UNAVAILABLE')
    }

    const url = new URL('/search', base)
    url.searchParams.set('q', request.query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('language', this.options.language)

    const json = (await requestJson(
      url.toString(),
      { method: 'GET', headers: { accept: 'application/json' } },
      this.options.timeoutMs(),
      signal,
    )) as SearxngResponse

    if (!Array.isArray(json.results)) {
      throw new WebError('SearXNG response has no results array', 'WEB_PROVIDER_ERROR')
    }

    const limit = request.maxResults ?? this.options.limit()
    const sources = json.results
      .filter((item) => typeof item.url === 'string' && item.url.length > 0)
      .slice(0, limit)
      .map((item) => ({
        url: item.url as string,
        ...(item.title !== undefined ? { title: item.title } : {}),
        ...(item.content !== undefined ? { snippet: item.content } : {}),
        ...(item.publishedDate !== undefined ? { publishedAt: item.publishedDate } : {}),
      }))

    const answer = json.answers?.find((text) => typeof text === 'string' && text.length > 0)
    return {
      ...(answer !== undefined ? { content: answer } : {}),
      sources,
      truncated: json.results.length > limit,
    }
  }

  private parsedBase(): URL | undefined {
    const baseUrl = this.options.baseUrl()
    if (typeof baseUrl !== 'string' || baseUrl.length === 0) return undefined
    try {
      const url = new URL(baseUrl)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
    } catch {
      return undefined
    }
  }
}
