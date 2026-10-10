import { WebError } from '@deepseek-ai/dsh-web'

/** Hard cap on any backend response body, checked before parsing. */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

/** Error code used when a backend's own timeout fires. */
export const TIMEOUT_CODE = 'WEB_SEARCH_TIMEOUT'

/**
 * Perform one HTTP request under a deadline fused with the caller's cancellation.
 * The timeout produces a `WebError` with code `WEB_SEARCH_TIMEOUT`; caller
 * cancellation produces `WEB_ABORTED`. Both are routed by `code`, never by message.
 */
export async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = callerSignal === undefined ? timeout : AbortSignal.any([callerSignal, timeout])

  let response: Response
  try {
    response = await fetch(url, { ...init, signal })
  } catch (error) {
    throw classifyFetchError(error, timeout, callerSignal)
  }

  const text = await readBounded(response, signal, timeout, callerSignal)

  if (!response.ok) {
    throw new WebError(`backend responded with HTTP ${response.status}`, codeForStatus(response.status))
  }

  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new WebError('backend returned a body that is not valid JSON', 'WEB_PROVIDER_ERROR', {
      cause: error,
    })
  }
}

/**
 * Map an HTTP status to a stable error code. 401/403 mean the key is wrong or missing,
 * 402 means credits are exhausted: all three are terminal for the key, not the query,
 * but the chain still moves on because another backend may work. 429 is rate limiting.
 */
export function codeForStatus(status: number): string {
  if (status === 401 || status === 403) return 'WEB_AUTH_FAILED'
  if (status === 402) return 'WEB_CREDITS_EXHAUSTED'
  if (status === 429) return 'WEB_RATE_LIMITED'
  return 'WEB_PROVIDER_ERROR'
}

/** Read a response body while enforcing the byte cap. Declared length is checked first. */
async function readBounded(
  response: Response,
  signal: AbortSignal,
  timeout: AbortSignal,
  callerSignal: AbortSignal | undefined,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_RESPONSE_BYTES) {
    throw new WebError('backend response exceeds the size limit', 'WEB_RESPONSE_TOO_LARGE')
  }
  if (response.body === null) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      if (signal.aborted) throw classifyAbort(timeout, callerSignal)
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        throw new WebError('backend response exceeds the size limit', 'WEB_RESPONSE_TOO_LARGE')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof WebError) throw error
    throw classifyFetchError(error, timeout, callerSignal)
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return new TextDecoder().decode(concat(chunks, total))
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function classifyAbort(timeout: AbortSignal, callerSignal: AbortSignal | undefined): WebError {
  if (timeout.aborted) return new WebError('backend request timed out', TIMEOUT_CODE)
  if (callerSignal?.aborted) return new WebError('search aborted by caller', 'WEB_ABORTED')
  return new WebError('backend request failed', 'WEB_PROVIDER_ERROR')
}

function classifyFetchError(
  error: unknown,
  timeout: AbortSignal,
  callerSignal: AbortSignal | undefined,
): WebError {
  if (error instanceof WebError) return error
  if (timeout.aborted || callerSignal?.aborted) return classifyAbort(timeout, callerSignal)
  return new WebError(`backend request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', {
    cause: error,
  })
}
