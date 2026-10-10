import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { requestJson } from '../http.ts'
import { WebError } from '@deepseek-ai/dsh-web'

const ENDPOINT = 'https://api.tavily.com/search'

export interface TavilyOptions {
  /** Optional API key. When absent the keyless header is sent. */
  readonly apiKey: string | undefined
  readonly timeoutMs: number
}

/** Wire shape of a Tavily search response, reduced to the fields the stack reads. */
interface TavilyResponse {
  readonly answer?: string | null
  readonly results?: ReadonlyArray<{
    readonly title?: string
    readonly url?: string
    readonly content?: string
    readonly published_date?: string
  }>
}

/**
 * Tavily search backend. Uses the keyless access mode when no key is configured.
 * The keyless header and endpoint are taken from the project brief and must be
 * confirmed against the live service before a release.
 */
export class TavilyBackend implements WebSearchProvider {
  readonly id = 'tavily'

  constructor(private readonly options: TavilyOptions) {}

  available(): boolean {
    return true
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.options.apiKey !== undefined) {
      headers.authorization = `Bearer ${this.options.apiKey}`
    } else {
      headers['x-tavily-access-mode'] = 'keyless'
    }

    const body = {
      query: request.query,
      max_results: request.maxResults ?? 5,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      topic: 'general',
    }

    const json = (await requestJson(
      ENDPOINT,
      { method: 'POST', headers, body: JSON.stringify(body) },
      this.options.timeoutMs,
      signal,
    )) as TavilyResponse

    if (!Array.isArray(json.results)) {
      throw new WebError('Tavily response has no results array', 'WEB_PROVIDER_ERROR')
    }

    const sources = json.results
      .filter((item) => typeof item.url === 'string' && item.url.length > 0)
      .map((item) => ({
        url: item.url as string,
        ...(item.title !== undefined ? { title: item.title } : {}),
        ...(item.content !== undefined ? { snippet: item.content } : {}),
        ...(item.published_date !== undefined ? { publishedAt: item.published_date } : {}),
      }))

    return {
      ...(typeof json.answer === 'string' && json.answer.length > 0 ? { content: json.answer } : {}),
      sources,
      truncated: false,
    }
  }
}
