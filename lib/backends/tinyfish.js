import { WebError } from '@deepseek-ai/dsh-web';
import { requestJson } from "../http.js";
const ENDPOINT = 'https://api.search.tinyfish.ai';
/**
 * TinyFish Search backend, documented at https://docs.tinyfish.ai/search-api/reference:
 * `GET https://api.search.tinyfish.ai?query=...` with the `X-API-Key` header. Requires a key.
 * Free allowance of 12,000 requests per day, per https://docs.tinyfish.ai/search-api/reference.
 * Without a key the endpoint returns HTTP 401 (verified live).
 */
export class TinyfishBackend {
    options;
    id = 'tinyfish';
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
            throw new WebError('TinyFish API key is not configured', 'WEB_PROVIDER_UNAVAILABLE');
        }
        const limit = request.maxResults ?? this.options.limit();
        const url = new URL(ENDPOINT);
        url.searchParams.set('query', request.query);
        const json = (await requestJson(url.toString(), {
            method: 'GET',
            headers: {
                accept: 'application/json',
                'x-api-key': apiKey,
            },
        }, this.options.timeoutMs(), signal));
        if (!Array.isArray(json.results)) {
            throw new WebError('TinyFish response has no results array', 'WEB_PROVIDER_ERROR');
        }
        const all = json.results
            .filter((item) => typeof item.url === 'string' && item.url.length > 0)
            .map((item) => ({
            url: item.url,
            ...(item.title !== undefined ? { title: item.title } : {}),
            ...(item.snippet !== undefined ? { snippet: item.snippet } : {}),
            ...(item.date !== undefined ? { publishedAt: item.date } : {}),
        }));
        return {
            sources: all.slice(0, limit),
            truncated: all.length > limit,
        };
    }
}
