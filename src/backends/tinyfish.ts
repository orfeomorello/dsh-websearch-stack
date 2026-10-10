import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { requestJson } from '../http.ts'

const ENDPOINT = 'https://api.search.tinyfish.ai'

export interface TinyfishOptions {
  /** TinyFish API key sent as `X-API-Key`. `undefined` makes the backend unavailable. */
  readonly apiKey: string | undefined
  readonly timeoutMs: number
}

/** Wire shape of a TinyFish Search response, reduced to the fields the stack reads. */
interface TinyfishResponse {
  readonly results?: ReadonlyArray<{
    readonly title?: string
    readonly url?: string
    readonly snippet?: string
    readonly date?: string
  }>
}

/**
 * TinyFish Search backend, documented at https://docs.tinyfish.ai/search-api/reference:
 * `GET https://api.search.tinyfish.ai?query=...` with the `X-API-Key` header. Requires a key.
 * Free up to 12,000 requests per day; 30 requests per minute per key by default.
 */
export class TinyfishBackend implements WebSearchProvider {
  readonly id = 'tinyfish'

  constructor(private readonly options: TinyfishOptions) {}

  available(): boolean {
    return this.options.apiKey !== undefined && this.options.apiKey.length > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (!this.available()) {
      throw new WebError('TinyFish API key is not configured', 'WEB_PROVIDER_UNAVAILABLE')
    }

    const limit = request.maxResults ?? 5
    const url = new URL(ENDPOINT)
    url.searchParams.set('query', request.query)

    const json = (await requestJson(
      url.toString(),
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-api-key': this.options.apiKey as string,
        },
      },
      this.options.timeoutMs,
      signal,
    )) as TinyfishResponse

    if (!Array.isArray(json.results)) {
      throw new WebError('TinyFish response has no results array', 'WEB_PROVIDER_ERROR')
    }

    const all = json.results
      .filter((item) => typeof item.url === 'string' && item.url.length > 0)
      .map((item) => ({
        url: item.url as string,
        ...(item.title !== undefined ? { title: item.title } : {}),
        ...(item.snippet !== undefined ? { snippet: item.snippet } : {}),
        ...(item.date !== undefined ? { publishedAt: item.date } : {}),
      }))

    return {
      sources: all.slice(0, limit),
      truncated: all.length > limit,
    }
  }
}
