import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { requestJson } from '../http.ts'

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

export interface BraveOptions {
  /** Brave Search API subscription token. `undefined` makes the backend unavailable. */
  readonly apiKey: string | undefined
  readonly timeoutMs: number
}

/** Wire shape of a Brave web search response, reduced to the fields the stack reads. */
interface BraveResponse {
  readonly web?: {
    readonly results?: ReadonlyArray<{
      readonly title?: string
      readonly url?: string
      readonly description?: string
      readonly page_age?: string
    }>
  }
}

/**
 * Brave Search web backend. Documented at
 * https://api-dashboard.search.brave.com/app/documentation/web-search/get-started:
 * `GET /res/v1/web/search?q=...&count=...` with the `X-Subscription-Token` header.
 * Requires an API key, so it is unavailable until one is configured.
 */
export class BraveBackend implements WebSearchProvider {
  readonly id = 'brave'

  constructor(private readonly options: BraveOptions) {}

  available(): boolean {
    return this.options.apiKey !== undefined && this.options.apiKey.length > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (!this.available()) {
      throw new WebError('Brave API key is not configured', 'WEB_PROVIDER_UNAVAILABLE')
    }

    const limit = request.maxResults ?? 5
    const url = new URL(ENDPOINT)
    url.searchParams.set('q', request.query)
    // Brave caps `count` at 20; the seam enforces the final bound regardless.
    url.searchParams.set('count', String(Math.min(limit, 20)))

    const json = (await requestJson(
      url.toString(),
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-subscription-token': this.options.apiKey as string,
        },
      },
      this.options.timeoutMs,
      signal,
    )) as BraveResponse

    if (!Array.isArray(json.web?.results)) {
      throw new WebError('Brave response has no web results', 'WEB_PROVIDER_ERROR')
    }

    const sources = json.web.results
      .filter((item) => typeof item.url === 'string' && item.url.length > 0)
      .map((item) => ({
        url: item.url as string,
        ...(item.title !== undefined ? { title: item.title } : {}),
        ...(item.description !== undefined ? { snippet: item.description } : {}),
        ...(item.page_age !== undefined ? { publishedAt: item.page_age } : {}),
      }))

    return { sources, truncated: false }
  }
}
