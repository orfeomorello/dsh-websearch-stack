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

const OK = { sources: [{ url: 'https://example.com' }], truncated: false }
const req = { query: 'x', maxResults: 5 }

test('returns the first backend that succeeds and skips the rest', async () => {
  const calls = []
  const stack = new StackSearchProvider([
    { id: 'tavily', provider: fake('tavily', { result: OK, calls }) },
    { id: 'searxng', provider: fake('searxng', { result: OK, calls }) },
  ])
  const out = await stack.search(req)
  assert.deepEqual(out, OK)
  assert.deepEqual(calls, ['tavily'])
})

test('falls back to the next backend on a recoverable error', async () => {
  const calls = []
  const stack = new StackSearchProvider([
    { id: 'tavily', provider: fake('tavily', { error: new WebError('down', 'WEB_PROVIDER_ERROR'), calls }) },
    { id: 'searxng', provider: fake('searxng', { result: OK, calls }) },
  ])
  const out = await stack.search(req)
  assert.deepEqual(out, OK)
  assert.deepEqual(calls, ['tavily', 'searxng'])
})

test('a terminal error stops the chain and is rethrown unchanged', async () => {
  const calls = []
  const terminal = new WebError('bad', 'WEB_INVALID_URL')
  const stack = new StackSearchProvider([
    { id: 'tavily', provider: fake('tavily', { error: terminal, calls }) },
    { id: 'searxng', provider: fake('searxng', { result: OK, calls }) },
  ])
  await assert.rejects(stack.search(req), (e) => e === terminal)
  assert.deepEqual(calls, ['tavily'])
})

test('skips backends that are not available', async () => {
  const calls = []
  const stack = new StackSearchProvider([
    { id: 'tavily', provider: fake('tavily', { available: false, result: OK, calls }) },
    { id: 'searxng', provider: fake('searxng', { result: OK, calls }) },
  ])
  await stack.search(req)
  assert.deepEqual(calls, ['searxng'])
})

test('when every backend fails, reports all attempts in one WebError', async () => {
  const stack = new StackSearchProvider([
    { id: 'tavily', provider: fake('tavily', { error: new WebError('a', 'WEB_RATE_LIMITED') }) },
    { id: 'searxng', provider: fake('searxng', { error: new WebError('b', 'WEB_PROVIDER_ERROR') }) },
  ])
  await assert.rejects(stack.search(req), (e) => {
    assert.ok(e instanceof WebError)
    assert.match(e.message, /tavily: WEB_RATE_LIMITED/)
    assert.match(e.message, /searxng: WEB_PROVIDER_ERROR/)
    return true
  })
})

test('an empty or fully unavailable chain throws WEB_PROVIDER_UNAVAILABLE', async () => {
  const stack = new StackSearchProvider([{ id: 'tavily', provider: fake('tavily', { available: false }) }])
  await assert.rejects(stack.search(req), (e) => e instanceof WebError && e.code === 'WEB_PROVIDER_UNAVAILABLE')
})

test('an already-aborted signal stops before any backend is called', async () => {
  const calls = []
  const stack = new StackSearchProvider([{ id: 'tavily', provider: fake('tavily', { result: OK, calls }) }])
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(stack.search(req, ac.signal), (e) => e instanceof WebError && e.code === 'WEB_ABORTED')
  assert.deepEqual(calls, [])
})

test('available() is true only when some backend is available', () => {
  const none = new StackSearchProvider([{ id: 'tavily', provider: fake('tavily', { available: false }) }])
  const some = new StackSearchProvider([{ id: 'tavily', provider: fake('tavily', { available: true }) }])
  assert.equal(none.available(), false)
  assert.equal(some.available(), true)
})
