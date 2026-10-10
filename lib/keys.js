/**
 * API keys, resolved from the Host credentials service and read
 * synchronously by the backends.
 *
 * A provider's `available()` must be local and free of I/O, so a key is
 * resolved once at startup and re-resolved when the Host reports its reference
 * changed; the backend then reads it per operation through `of()`, which is
 * what lets a rotated key land on the next request.
 */
/** Credential references the key-backed backends resolve, by environment name. */
export const KEY_REFERENCES = ['TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY', 'TINYFISH_API_KEY', 'EXA_API_KEY'];
/** Emit event the Host publishes when one credential reference changes. */
export const REFERENCE_UPDATED_EVENT = 'credentials/reference-updated';
export class KeyStore {
    credentials;
    values = new Map();
    /**
     * @param credentials - the Host credentials service, or undefined when this
     * deployment does not serve one: keys then come from the environment only.
     */
    constructor(credentials) {
        this.credentials = credentials;
    }
    /** Resolve every reference once: the credentials service first, the
     * environment as the fallback. */
    async sync() {
        for (const ref of KEY_REFERENCES) {
            this.values.set(ref, this.withFallback(await this.fromService(ref), ref));
        }
    }
    /** Re-read one reference after the Host reports it changed. */
    async refresh(ref) {
        this.values.set(ref, this.withFallback(await this.fromService(ref), ref));
    }
    /** The key one backend reads as it builds a request. */
    of(ref) {
        return this.values.get(ref);
    }
    /** The credentials service owns precedence; the environment is the fallback. */
    withFallback(fromService, ref) {
        return fromService ?? process.env[ref];
    }
    async fromService(ref) {
        if (this.credentials === undefined)
            return undefined;
        try {
            const hit = await this.credentials.resolve(ref);
            const value = hit?.value;
            return typeof value === 'string' && value.length > 0 ? value : undefined;
        }
        catch {
            return undefined;
        }
    }
}
