import { WebError } from '@deepseek-ai/dsh-web';
/** Error codes that move the chain to the next backend. Anything else is terminal. */
const RECOVERABLE = new Set([
    'WEB_PROVIDER_ERROR',
    'WEB_RATE_LIMITED',
    'WEB_SEARCH_TIMEOUT',
    'WEB_PROVIDER_UNAVAILABLE',
    'WEB_RESPONSE_TOO_LARGE',
]);
/**
 * The single `WebSearchProvider` the plugin registers on `ctx.web`. It runs the
 * configured backends in order and returns the first success. The seam allows only
 * one usable provider per capability, so the fallback chain lives here rather than
 * in several registrations.
 */
export class StackSearchProvider {
    chain;
    id = 'websearch-stack';
    constructor(chain) {
        this.chain = chain;
    }
    available() {
        return this.chain.some((entry) => entry.provider.available());
    }
    async search(request, signal) {
        const attempts = [];
        for (const entry of this.chain) {
            if (signal?.aborted)
                throw new WebError('search aborted by caller', 'WEB_ABORTED');
            if (!entry.provider.available())
                continue;
            try {
                return await entry.provider.search(request, signal);
            }
            catch (error) {
                if (signal?.aborted)
                    throw new WebError('search aborted by caller', 'WEB_ABORTED');
                const code = error instanceof WebError ? error.code : 'WEB_PROVIDER_ERROR';
                const message = error instanceof Error ? error.message : String(error);
                attempts.push({ provider: entry.id, code, message });
                if (!RECOVERABLE.has(code))
                    throw error;
            }
        }
        if (attempts.length === 0) {
            throw new WebError('no search backend is enabled and available', 'WEB_PROVIDER_UNAVAILABLE');
        }
        const summary = attempts.map((a) => `${a.provider}: ${a.code}`).join('; ');
        throw new WebError(`all search backends failed (${summary})`, 'WEB_PROVIDER_ERROR');
    }
    /** Expose the chain's ids for diagnostics. */
    backendIds() {
        return this.chain.map((entry) => entry.id);
    }
}
