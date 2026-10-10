/** Hard cap on any backend response body, checked before parsing. */
export declare const MAX_RESPONSE_BYTES: number;
/** Error code used when a backend's own timeout fires. */
export declare const TIMEOUT_CODE = "WEB_SEARCH_TIMEOUT";
/**
 * Perform one HTTP request under a deadline fused with the caller's cancellation.
 * The timeout produces a `WebError` with code `WEB_SEARCH_TIMEOUT`; caller
 * cancellation produces `WEB_ABORTED`. Both are routed by `code`, never by message.
 */
export declare function requestJson(url: string, init: RequestInit, timeoutMs: number, callerSignal: AbortSignal | undefined): Promise<unknown>;
