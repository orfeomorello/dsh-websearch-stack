import { WebError } from '@deepseek-ai/dsh-web';
import { requestJson } from "../http.js";
const ENDPOINT = 'https://api.exa.ai/search';
/**
 * Exa search backend, from the OpenAPI spec at https://exa.ai/docs/exa-spec.json:
 * `POST /search` with the `x-api-key` header. Verified request fields: `query` (required),
 * `numResults` (1–100), `type` (default `auto`). Verified result fields: `title`, `url`
 * (both required), `publishedDate`, `highlights`, `text`. Requires an API key.
 */
export class ExaBackend {
    options;
    id = 'exa';
    constructor(options) {
        this.options = options;
    }
    available() {
        return this.key() !== undefined;
    }
    /** The key for this request, read from the credential store per operation. */
    key() {
        const apiKey = this.options.apiKey();
        return typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : undefined;
    }
    async search(request, signal) {
        const apiKey = this.key();
        if (apiKey === undefined) {
            throw new WebError('Exa API key is not configured', 'WEB_PROVIDER_UNAVAILABLE');
        }
        const limit = request.maxResults ?? this.options.limit();
        const body = {
            query: request.query,
            // Exa accepts 1–100; the seam enforces the final bound regardless.
            numResults: Math.min(Math.max(limit, 1), 100),
            type: 'auto',
            contents: { highlights: true },
        };
        const json = (await requestJson(ENDPOINT, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': apiKey,
            },
            body: JSON.stringify(body),
        }, this.options.timeoutMs(), signal));
        if (!Array.isArray(json.results)) {
            throw new WebError('Exa response has no results array', 'WEB_PROVIDER_ERROR');
        }
        const sources = json.results
            .filter((item) => typeof item.url === 'string' && item.url.length > 0)
            .map((item) => {
            const snippet = item.highlights?.find((h) => typeof h === 'string' && h.length > 0);
            return {
                url: item.url,
                ...(item.title !== undefined ? { title: item.title } : {}),
                ...(snippet !== undefined ? { snippet } : {}),
                ...(item.publishedDate !== undefined ? { publishedAt: item.publishedDate } : {}),
            };
        });
        return { sources, truncated: false };
    }
}
