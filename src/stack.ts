import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import type { BackendId } from './config.ts'

/** Error codes that move the chain to the next backend. Anything else is terminal. */
const RECOVERABLE = new Set([
  'WEB_PROVIDER_ERROR',
  'WEB_RATE_LIMITED',
  'WEB_SEARCH_TIMEOUT',
  'WEB_PROVIDER_UNAVAILABLE',
  'WEB_RESPONSE_TOO_LARGE',
  // A wrong key or exhausted credits affect one backend, not the query: move on.
  'WEB_AUTH_FAILED',
  'WEB_CREDITS_EXHAUSTED',
])

export interface FallbackAttempt {
  readonly provider: BackendId
  readonly code: string
  readonly message: string
}

/**
 * The single `WebSearchProvider` the plugin registers on `ctx.web`. It runs the
 * configured backends in order and returns the first success. The seam allows only
 * one usable provider per capability, so the fallback chain lives here rather than
 * in several registrations.
 */
export class StackSearchProvider implements WebSearchProvider {
  readonly id = 'websearch-stack'

  constructor(private readonly chain: ReadonlyArray<{ id: BackendId; provider: WebSearchProvider }>) {}

  available(): boolean {
    return this.chain.some((entry) => entry.provider.available())
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const attempts: FallbackAttempt[] = []

    for (const entry of this.chain) {
      if (signal?.aborted) throw new WebError('search aborted by caller', 'WEB_ABORTED')
      if (!entry.provider.available()) continue

      try {
        return await entry.provider.search(request, signal)
      } catch (error) {
        if (signal?.aborted) throw new WebError('search aborted by caller', 'WEB_ABORTED')
        const code = error instanceof WebError ? error.code : 'WEB_PROVIDER_ERROR'
        const message = error instanceof Error ? error.message : String(error)
        attempts.push({ provider: entry.id, code, message })
        if (!RECOVERABLE.has(code)) throw error
      }
    }

    if (attempts.length === 0) {
      throw new WebError('no search backend is enabled and available', 'WEB_PROVIDER_UNAVAILABLE')
    }
    const summary = attempts.map((a) => `${a.provider}: ${a.code}`).join('; ')
    throw new WebError(`all search backends failed (${summary})`, 'WEB_PROVIDER_ERROR')
  }

  /** Expose the chain's ids for diagnostics. */
  backendIds(): readonly BackendId[] {
    return this.chain.map((entry) => entry.id)
  }
}
