import { WebError } from '@deepseek-ai/dsh-web';
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
]);
/**
 * The single `WebSearchProvider` the plugin registers on `ctx.web`. It runs the
 * configured backends in order and returns the first success. The seam allows only
 * one usable provider per capability, so the fallback chain lives here rather than
 * in several registrations.
 *
 * The order, the backends and the cache TTL are all read per operation, so an
 * edit on the Plugins page or a rotated credential lands on the next request
 * instead of at the next boot.
 */
export class StackSearchProvider {
    order;
    backendOf;
    cacheTtl;
    id = 'websearch-stack';
    cache = new Map();
    /**
     * @param order - the enabled backends in fallback order, read per operation.
     * @param backendOf - the backend for one identifier, or undefined when unknown.
     * @param cacheTtl - in-memory TTL for identical queries, in seconds.
     */
    constructor(order, backendOf, cacheTtl) {
        this.order = order;
        this.backendOf = backendOf;
        this.cacheTtl = cacheTtl;
    }
    available() {
        return this.order().some((id) => this.backendOf(id)?.available() === true);
    }
    async search(request, signal) {
        const ttl = this.cacheTtl();
        const cached = ttl > 0 ? this.fresh(this.cacheKey(request), ttl) : undefined;
        if (cached !== undefined)
            return cached.result;
        const attempts = [];
        for (const id of this.order()) {
            if (signal?.aborted)
                throw new WebError('search aborted by caller', 'WEB_ABORTED');
            const provider = this.backendOf(id);
            if (provider === undefined || !provider.available())
                continue;
            try {
                const result = await provider.search(request, signal);
                if (ttl > 0)
                    this.remember(this.cacheKey(request), result, ttl);
                return result;
            }
            catch (error) {
                if (signal?.aborted)
                    throw new WebError('search aborted by caller', 'WEB_ABORTED');
                const code = error instanceof WebError ? error.code : 'WEB_PROVIDER_ERROR';
                const message = error instanceof Error ? error.message : String(error);
                attempts.push({ provider: id, code, message });
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
    /** Identity of one query: the query text and the cap the request names. */
    cacheKey(request) {
        return `${request.query}\u0000${request.maxResults ?? ''}`;
    }
    /** The cached result for one key while it is still inside its TTL. */
    fresh(key, ttl) {
        const entry = this.cache.get(key);
        if (entry === undefined)
            return undefined;
        if (Date.now() - entry.at > ttl * 1000) {
            this.cache.delete(key);
            return undefined;
        }
        return entry;
    }
    /** Store one result and drop every entry its TTL has elapsed. */
    remember(key, result, ttl) {
        this.cache.set(key, { at: Date.now(), result });
        const now = Date.now();
        for (const [stored, entry] of this.cache) {
            if (stored !== key && now - entry.at > ttl * 1000)
                this.cache.delete(stored);
        }
    }
}
