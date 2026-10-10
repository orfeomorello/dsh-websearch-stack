import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { requestJson } from '../http.ts'

const ENDPOINT = 'https://api.exa.ai/search'

export interface ExaOptions {
  /** Exa API key sent as `x-api-key`. `undefined` makes the backend unavailable. */
  readonly apiKey: string | undefined
  readonly timeoutMs: number
}

/** Wire shape of one Exa search result, reduced to the fields the stack reads. */
interface ExaResult {
  readonly title?: string
  readonly url?: string
  readonly publishedDate?: string
  readonly highlights?: ReadonlyArray<string>
  readonly text?: string
}

interface ExaResponse {
  readonly results?: ReadonlyArray<ExaResult>
}

/**
 * Exa search backend, from the OpenAPI spec at https://exa.ai/docs/exa-spec.json:
 * `POST /search` with the `x-api-key` header. Verified request fields: `query` (required),
 * `numResults` (1–100), `type` (default `auto`). Verified result fields: `title`, `url`
 * (both required), `publishedDate`, `highlights`, `text`. Requires an API key.
 */
export class ExaBackend implements WebSearchProvider {
  readonly id = 'exa'

  constructor(private readonly options: ExaOptions) {}

  available(): boolean {
    return this.options.apiKey !== undefined && this.options.apiKey.length > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (!this.available()) {
      throw new WebError('Exa API key is not configured', 'WEB_PROVIDER_UNAVAILABLE')
    }

    const limit = request.maxResults ?? 5
    const body = {
      query: request.query,
      // Exa accepts 1–100; the seam enforces the final bound regardless.
      numResults: Math.min(Math.max(limit, 1), 100),
      type: 'auto',
      contents: { highlights: true },
    }

    const json = (await requestJson(
      ENDPOINT,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.options.apiKey as string,
        },
        body: JSON.stringify(body),
      },
      this.options.timeoutMs,
      signal,
    )) as ExaResponse

    if (!Array.isArray(json.results)) {
      throw new WebError('Exa response has no results array', 'WEB_PROVIDER_ERROR')
    }

    const sources = json.results
      .filter((item) => typeof item.url === 'string' && item.url.length > 0)
      .map((item) => {
        const snippet = item.highlights?.find((h: string) => typeof h === 'string' && h.length > 0)
        return {
          url: item.url as string,
          ...(item.title !== undefined ? { title: item.title } : {}),
          ...(snippet !== undefined ? { snippet } : {}),
          ...(item.publishedDate !== undefined ? { publishedAt: item.publishedDate } : {}),
        }
      })

    return { sources, truncated: false }
  }
}
