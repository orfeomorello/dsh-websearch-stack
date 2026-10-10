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
export declare const KEY_REFERENCES: readonly ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "TINYFISH_API_KEY", "EXA_API_KEY"];
export type KeyReference = (typeof KEY_REFERENCES)[number];
/** The face of the Host credentials service the store resolves through. */
export interface CredentialsLike {
    resolve(ref: string): Promise<{
        value?: unknown;
    } | undefined>;
}
/** Emit event the Host publishes when one credential reference changes. */
export declare const REFERENCE_UPDATED_EVENT = "credentials/reference-updated";
export declare class KeyStore {
    private readonly credentials;
    private readonly values;
    /**
     * @param credentials - the Host credentials service, or undefined when this
     * deployment does not serve one: keys then come from the environment only.
     */
    constructor(credentials: CredentialsLike | undefined);
    /** Resolve every reference once: the credentials service first, the
     * environment as the fallback. */
    sync(): Promise<void>;
    /** Re-read one reference after the Host reports it changed. */
    refresh(ref: KeyReference): Promise<void>;
    /** The key one backend reads as it builds a request. */
    of(ref: KeyReference): string | undefined;
    /** The credentials service owns precedence; the environment is the fallback. */
    private withFallback;
    private fromService;
}
