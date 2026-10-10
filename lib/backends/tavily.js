import { requestJson } from "../http.js";
import { WebError } from '@deepseek-ai/dsh-web';
const ENDPOINT = 'https://api.tavily.com/search';
/**
 * Tavily search backend. Uses the keyless access mode when no key is configured.
 * The keyless header and endpoint are taken from the project brief and must be
 * confirmed against the live service before a release.
 */
export class TavilyBackend {
    options;
    id = 'tavily';
    constructor(options) {
        this.options = options;
    }
    available() {
        return true;
    }
    async search(request, signal) {
        const headers = { 'content-type': 'application/json' };
        const apiKey = this.options.apiKey();
        if (typeof apiKey === 'string' && apiKey.length > 0) {
            headers.authorization = `Bearer ${apiKey}`;
        }
        else {
            headers['x-tavily-access-mode'] = 'keyless';
        }
        const body = {
            query: request.query,
            max_results: request.maxResults ?? this.options.limit(),
            search_depth: 'basic',
            include_answer: false,
            include_raw_content: false,
            topic: 'general',
        };
        const json = (await requestJson(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) }, this.options.timeoutMs(), signal));
        if (!Array.isArray(json.results)) {
            throw new WebError('Tavily response has no results array', 'WEB_PROVIDER_ERROR');
        }
        const sources = json.results
            .filter((item) => typeof item.url === 'string' && item.url.length > 0)
            .map((item) => ({
            url: item.url,
            ...(item.title !== undefined ? { title: item.title } : {}),
            ...(item.content !== undefined ? { snippet: item.content } : {}),
            ...(item.published_date !== undefined ? { publishedAt: item.published_date } : {}),
        }));
        return {
            ...(typeof json.answer === 'string' && json.answer.length > 0 ? { content: json.answer } : {}),
            sources,
            truncated: false,
        };
    }
}
