import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { requestJson } from '../http.ts'

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

export interface BraveOptions {
  /** Read the Brave Search API subscription token. An empty read makes the
   * backend unavailable. */
  readonly apiKey: () => string | undefined
  /** Read the request timeout, in milliseconds. */
  readonly timeoutMs: () => number
  /** Read the source cap to apply when the request names none. */
  readonly limit: () => number
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
    return this.key() !== undefined
  }

  /** The token for this request, read from the credential store per operation. */
  private key(): string | undefined {
    const apiKey = this.options.apiKey()
    return typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : undefined
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const apiKey = this.key()
    if (apiKey === undefined) {
      throw new WebError('Brave API key is not configured', 'WEB_PROVIDER_UNAVAILABLE')
    }

    const limit = request.maxResults ?? this.options.limit()
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
          'x-subscription-token': apiKey,
        },
      },
      this.options.timeoutMs(),
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
