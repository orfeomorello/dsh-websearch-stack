import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
export interface ExaOptions {
    /** Read the Exa API key sent as `x-api-key`. An empty read makes the
     * backend unavailable. */
    readonly apiKey: () => string | undefined;
    /** Read the request timeout, in milliseconds. */
    readonly timeoutMs: () => number;
    /** Read the source cap to apply when the request names none. */
    readonly limit: () => number;
}
/**
 * Exa search backend, from the OpenAPI spec at https://exa.ai/docs/exa-spec.json:
 * `POST /search` with the `x-api-key` header. Verified request fields: `query` (required),
 * `numResults` (1–100), `type` (default `auto`). Verified result fields: `title`, `url`
 * (both required), `publishedDate`, `highlights`, `text`. Requires an API key.
 */
export declare class ExaBackend implements WebSearchProvider {
    private readonly options;
    readonly id = "exa";
    constructor(options: ExaOptions);
    available(): boolean;
    /** The key for this request, read from the credential store per operation. */
    private key;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
