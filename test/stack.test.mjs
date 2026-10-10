import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StackSearchProvider } from '../lib/stack.js'
import { WebError } from '@deepseek-ai/dsh-web'

/** Fake backend: resolves with `result`, or rejects with `error`. */
function fake(id, { available = true, result, error, calls } = {}) {
  return {
    id,
    available: () => available,
    search: async () => {
      calls?.push(id)
      if (error !== undefined) throw error
      return result
    },
  }
}

/** A stack over `backends` keyed by id, reading `order` and `ttl` per operation. */
function stackOf(order, backends, ttl = 0) {
  return new StackSearchProvider(() => order, (id) => backends[id], () => ttl)
}

const OK = { sources: [{ url: 'https://example.com' }], truncated: false }
const req = { query: 'x', maxResults: 5 }

test('returns the first backend that succeeds and skips the rest', async () => {
  const calls = []
  const out = await stackOf(['tavily', 'searxng'], {
    tavily: fake('tavily', { result: OK, calls }),
    searxng: fake('searxng', { result: OK, calls }),
  }).search(req)
  assert.deepEqual(out, OK)
  assert.deepEqual(calls, ['tavily'])
})

test('falls back to the next backend on a recoverable error', async () => {
  const calls = []
  const out = await stackOf(['tavily', 'searxng'], {
    tavily: fake('tavily', { error: new WebError('down', 'WEB_PROVIDER_ERROR'), calls }),
    searxng: fake('searxng', { result: OK, calls }),
  }).search(req)
  assert.deepEqual(out, OK)
  assert.deepEqual(calls, ['tavily', 'searxng'])
})

test('a terminal error stops the chain and is rethrown unchanged', async () => {
  const calls = []
  const terminal = new WebError('bad', 'WEB_INVALID_URL')
  const stack = stackOf(['tavily', 'searxng'], {
    tavily: fake('tavily', { error: terminal, calls }),
    searxng: fake('searxng', { result: OK, calls }),
  })
  await assert.rejects(stack.search(req), (e) => e === terminal)
  assert.deepEqual(calls, ['tavily'])
})

test('skips backends that are not available', async () => {
  const calls = []
  await stackOf(['tavily', 'searxng'], {
    tavily: fake('tavily', { available: false, result: OK, calls }),
    searxng: fake('searxng', { result: OK, calls }),
  }).search(req)
  assert.deepEqual(calls, ['searxng'])
})

test('the fallback order is read per operation, not frozen at construction', async () => {
  const calls = []
  const order = ['tavily', 'searxng']
  const stack = stackOf(order, {
    tavily: fake('tavily', { result: OK, calls }),
    searxng: fake('searxng', { result: OK, calls }),
  })
  await stack.search(req)
  // The user reorders the chain on the Plugins page: the next request follows
  // the new order with no re-registration in between.
  order.length = 0
  order.push('searxng', 'tavily')
  await stack.search(req)
  assert.deepEqual(calls, ['tavily', 'searxng'])
})

test('an unconfigured backend id is skipped, not a crash', async () => {
  const calls = []
  const out = await stackOf(['brave', 'searxng'], {
    searxng: fake('searxng', { result: OK, calls }),
  }).search(req)
  assert.deepEqual(out, OK)
  assert.deepEqual(calls, ['searxng'])
})

test('when every backend fails, reports all attempts in one WebError', async () => {
  const stack = stackOf(['tavily', 'searxng'], {
    tavily: fake('tavily', { error: new WebError('a', 'WEB_RATE_LIMITED') }),
    searxng: fake('searxng', { error: new WebError('b', 'WEB_PROVIDER_ERROR') }),
  })
  await assert.rejects(stack.search(req), (e) => {
    assert.ok(e instanceof WebError)
    assert.match(e.message, /tavily: WEB_RATE_LIMITED/)
    assert.match(e.message, /searxng: WEB_PROVIDER_ERROR/)
    return true
  })
})

test('an empty or fully unavailable chain throws WEB_PROVIDER_UNAVAILABLE', async () => {
  await assert.rejects(stackOf([], {}).search(req), (e) => e instanceof WebError && e.code === 'WEB_PROVIDER_UNAVAILABLE')
  await assert.rejects(
    stackOf(['tavily'], { tavily: fake('tavily', { available: false }) }).search(req),
    (e) => e instanceof WebError && e.code === 'WEB_PROVIDER_UNAVAILABLE',
  )
})

test('an already-aborted signal stops before any backend is called', async () => {
  const calls = []
  const stack = stackOf(['tavily'], { tavily: fake('tavily', { result: OK, calls }) })
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(stack.search(req, ac.signal), (e) => e instanceof WebError && e.code === 'WEB_ABORTED')
  assert.deepEqual(calls, [])
})

test('available() is true only when some backend is available', () => {
  const none = stackOf(['tavily'], { tavily: fake('tavily', { available: false }) })
  const some = stackOf(['tavily'], { tavily: fake('tavily', { available: true }) })
  const empty = stackOf([], { tavily: fake('tavily', { available: true }) })
  assert.equal(none.available(), false)
  assert.equal(some.available(), true)
  assert.equal(empty.available(), false)
})

test('auth and credit failures are recoverable: the chain moves on', async () => {
  const calls = []
  const out = await stackOf(['brave', 'exa', 'searxng'], {
    brave: fake('brave', { error: new WebError('x', 'WEB_AUTH_FAILED'), calls }),
    exa: fake('exa', { error: new WebError('y', 'WEB_CREDITS_EXHAUSTED'), calls }),
    searxng: fake('searxng', { result: OK, calls }),
  }).search(req)
  assert.deepEqual(out, OK)
  assert.deepEqual(calls, ['brave', 'exa', 'searxng'])
})

test('a fresh identical query is served from the cache, an expired one is not', async () => {
  const calls = []
  let now = 1_000_000
  const realNow = Date.now
  Date.now = () => now
  try {
    const stack = stackOf(['tavily'], { tavily: fake('tavily', { result: OK, calls }) }, 60)
    await stack.search({ query: 'x' })
    await stack.search({ query: 'x' })
    assert.deepEqual(calls, ['tavily'], 'the second identical query hit the cache')
    now += 61_000
    await stack.search({ query: 'x' })
    assert.deepEqual(calls, ['tavily', 'tavily'], 'the TTL elapsed, so the query was re-run')
  } finally {
    Date.now = realNow
  }
})

test('a cache TTL of 0 disables the cache entirely', async () => {
  const calls = []
  const stack = stackOf(['tavily'], { tavily: fake('tavily', { result: OK, calls }) }, 0)
  await stack.search({ query: 'x' })
  await stack.search({ query: 'x' })
  assert.deepEqual(calls, ['tavily', 'tavily'])
})
