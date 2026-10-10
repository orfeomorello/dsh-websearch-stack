import { WebError } from '@deepseek-ai/dsh-web';
/** Hard cap on any backend response body, checked before parsing. */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Error code used when a backend's own timeout fires. */
export const TIMEOUT_CODE = 'WEB_SEARCH_TIMEOUT';
/**
 * Perform one HTTP request under a deadline fused with the caller's cancellation.
 * The timeout produces a `WebError` with code `WEB_SEARCH_TIMEOUT`; caller
 * cancellation produces `WEB_ABORTED`. Both are routed by `code`, never by message.
 */
export async function requestJson(url, init, timeoutMs, callerSignal) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal === undefined ? timeout : AbortSignal.any([callerSignal, timeout]);
    let response;
    try {
        response = await fetch(url, { ...init, signal });
    }
    catch (error) {
        throw classifyFetchError(error, timeout, callerSignal);
    }
    const text = await readBounded(response, signal, timeout, callerSignal);
    if (!response.ok) {
        throw new WebError(`backend responded with HTTP ${response.status}`, response.status === 429 ? 'WEB_RATE_LIMITED' : 'WEB_PROVIDER_ERROR');
    }
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new WebError('backend returned a body that is not valid JSON', 'WEB_PROVIDER_ERROR', {
            cause: error,
        });
    }
}
/** Read a response body while enforcing the byte cap. Declared length is checked first. */
async function readBounded(response, signal, timeout, callerSignal) {
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_RESPONSE_BYTES) {
        throw new WebError('backend response exceeds the size limit', 'WEB_RESPONSE_TOO_LARGE');
    }
    if (response.body === null)
        return '';
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        for (;;) {
            if (signal.aborted)
                throw classifyAbort(timeout, callerSignal);
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.byteLength;
            if (total > MAX_RESPONSE_BYTES) {
                throw new WebError('backend response exceeds the size limit', 'WEB_RESPONSE_TOO_LARGE');
            }
            chunks.push(value);
        }
    }
    catch (error) {
        if (error instanceof WebError)
            throw error;
        throw classifyFetchError(error, timeout, callerSignal);
    }
    finally {
        await reader.cancel().catch(() => undefined);
    }
    return new TextDecoder().decode(concat(chunks, total));
}
function concat(chunks, total) {
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}
function classifyAbort(timeout, callerSignal) {
    if (timeout.aborted)
        return new WebError('backend request timed out', TIMEOUT_CODE);
    if (callerSignal?.aborted)
        return new WebError('search aborted by caller', 'WEB_ABORTED');
    return new WebError('backend request failed', 'WEB_PROVIDER_ERROR');
}
function classifyFetchError(error, timeout, callerSignal) {
    if (error instanceof WebError)
        return error;
    if (timeout.aborted || callerSignal?.aborted)
        return classifyAbort(timeout, callerSignal);
    return new WebError(`backend request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', {
        cause: error,
    });
}
