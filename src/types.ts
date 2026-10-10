import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

/**
 * Local aliases over the `dsh-web` seam types. The seam owns the contract, so the
 * stack re-exports rather than redeclares it; this file only names the shapes the
 * backends produce.
 */
export type SearchSource = WebSearchSource
export type SearchOutcome = WebSearchResult

/** Input every backend receives. `maxResults` is always set by the seam caller. */
export interface BackendQuery {
  readonly query: string
  readonly maxResults: number
}
