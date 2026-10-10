import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { SearxngBackend } from '../lib/backends/searxng.js'
import { TavilyBackend } from '../lib/backends/tavily.js'
import { ParallelMcpBackend } from '../lib/backends/parallel-mcp.js'
import { BraveBackend } from '../lib/backends/brave.js'
import { TinyfishBackend } from '../lib/backends/tinyfish.js'
import { WebError } from '@deepseek-ai/dsh-web'

/** Start a local HTTP server that answers every request with `handler`. */
function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) })
    })
  })
}

test('SearXNG: unavailable when no URL or a non-http URL is configured', () => {
  assert.equal(new SearxngBackend({ baseUrl: undefined, timeoutMs: 1000, language: 'en' }).available(), false)
  assert.equal(new SearxngBackend({ baseUrl: 'ftp://x', timeoutMs: 1000, language: 'en' }).available(), false)
  assert.equal(new SearxngBackend({ baseUrl: 'http://localhost:8080', timeoutMs: 1000, language: 'en' }).available(), true)
})

test('SearXNG: maps results to sources and applies maxResults', async () => {
  const srv = await serve((req, res) => {
    const u = new URL(req.url, 'http://x')
    assert.equal(u.pathname, '/search')
    assert.equal(u.searchParams.get('format'), 'json')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      results: [
        { title: 'A', url: 'https://a.test', content: 'sa' },
        { title: 'B', url: 'https://b.test' },
        { title: 'C', url: 'https://c.test' },
      ],
    }))
  })
  try {
    const b = new SearxngBackend({ baseUrl: srv.url, timeoutMs: 2000, language: 'en' })
    const out = await b.search({ query: 'q', maxResults: 2 })
    assert.equal(out.sources.length, 2)
    assert.equal(out.sources[0].snippet, 'sa')
    assert.equal(out.truncated, true)
  } finally {
    await srv.close()
  }
})

test('SearXNG: HTTP 429 maps to WEB_RATE_LIMITED', async () => {
  const srv = await serve((_req, res) => { res.writeHead(429); res.end('{}') })
  try {
    const b = new SearxngBackend({ baseUrl: srv.url, timeoutMs: 2000, language: 'en' })
    await assert.rejects(b.search({ query: 'q' }), (e) => e instanceof WebError && e.code === 'WEB_RATE_LIMITED')
  } finally {
    await srv.close()
  }
})

test('request exceeding the timeout maps to WEB_SEARCH_TIMEOUT', async () => {
  const srv = await serve(() => { /* never answer */ })
  try {
    const b = new SearxngBackend({ baseUrl: srv.url, timeoutMs: 200, language: 'en' })
    await assert.rejects(b.search({ query: 'q' }), (e) => e instanceof WebError && e.code === 'WEB_SEARCH_TIMEOUT')
  } finally {
    await srv.close()
  }
})

test('invalid JSON maps to WEB_PROVIDER_ERROR', async () => {
  const srv = await serve((_req, res) => { res.writeHead(200); res.end('<html>') })
  try {
    const b = new SearxngBackend({ baseUrl: srv.url, timeoutMs: 2000, language: 'en' })
    await assert.rejects(b.search({ query: 'q' }), (e) => e instanceof WebError && e.code === 'WEB_PROVIDER_ERROR')
  } finally {
    await srv.close()
  }
})

test('response larger than the cap maps to WEB_RESPONSE_TOO_LARGE', async () => {
  const srv = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"results":[],"pad":"' + 'x'.repeat(3 * 1024 * 1024) + '"}')
  })
  try {
    const b = new SearxngBackend({ baseUrl: srv.url, timeoutMs: 5000, language: 'en' })
    await assert.rejects(b.search({ query: 'q' }), (e) => e instanceof WebError && e.code === 'WEB_RESPONSE_TOO_LARGE')
  } finally {
    await srv.close()
  }
})

test('Tavily: sends the keyless header when no key is configured', async () => {
  let seen
  // The live endpoint is fixed; intercept fetch for this one test instead of the network.
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), headers: init.headers }
    return new Response(JSON.stringify({ results: [{ url: 'https://t.test', title: 'T' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const b = new TavilyBackend({ apiKey: undefined, timeoutMs: 2000 })
    const out = await b.search({ query: 'q', maxResults: 3 })
    assert.equal(seen.headers['x-tavily-access-mode'], 'keyless')
    assert.equal(seen.headers.authorization, undefined)
    assert.equal(out.sources[0].url, 'https://t.test')
  } finally {
    globalThis.fetch = original
  }
})

test('Tavily: sends a bearer token when a key is configured', async () => {
  let seen
  const original = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    seen = init.headers
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const b = new TavilyBackend({ apiKey: 'k123', timeoutMs: 2000 })
    await b.search({ query: 'q' })
    assert.equal(seen.authorization, 'Bearer k123')
    assert.equal(seen['x-tavily-access-mode'], undefined)
  } finally {
    globalThis.fetch = original
  }
})

test('Parallel MCP: maps structuredContent results to sources', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    result: { structuredContent: { results: [{ title: 'P', url: 'https://p.test', excerpt: 'e' }] } },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  try {
    const out = await new ParallelMcpBackend({ timeoutMs: 2000 }).search({ query: 'q' })
    assert.equal(out.sources[0].url, 'https://p.test')
    assert.equal(out.sources[0].snippet, 'e')
  } finally {
    globalThis.fetch = original
  }
})

test('Parallel MCP: a JSON-RPC error maps to WEB_PROVIDER_ERROR', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'boom' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  try {
    await assert.rejects(
      new ParallelMcpBackend({ timeoutMs: 2000 }).search({ query: 'q' }),
      (e) => e instanceof WebError && e.code === 'WEB_PROVIDER_ERROR',
    )
  } finally {
    globalThis.fetch = original
  }
})

test('Brave: unavailable without an API key', () => {
  assert.equal(new BraveBackend({ apiKey: undefined, timeoutMs: 1000 }).available(), false)
  assert.equal(new BraveBackend({ apiKey: '', timeoutMs: 1000 }).available(), false)
  assert.equal(new BraveBackend({ apiKey: 'k', timeoutMs: 1000 }).available(), true)
})

test('Brave: sends X-Subscription-Token and maps web.results', async () => {
  let seen
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), headers: init.headers }
    return new Response(JSON.stringify({
      web: { results: [{ title: 'B', url: 'https://b.test', description: 'd' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const out = await new BraveBackend({ apiKey: 'tok', timeoutMs: 2000 }).search({ query: 'q', maxResults: 3 })
    assert.equal(seen.headers['x-subscription-token'], 'tok')
    assert.match(seen.url, /res\/v1\/web\/search\?q=q&count=3/)
    assert.equal(out.sources[0].url, 'https://b.test')
    assert.equal(out.sources[0].snippet, 'd')
  } finally {
    globalThis.fetch = original
  }
})

test('TinyFish: unavailable without a key; sends X-API-Key and maps results', async () => {
  assert.equal(new TinyfishBackend({ apiKey: undefined, timeoutMs: 1000 }).available(), false)
  let seen
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), headers: init.headers }
    return new Response(JSON.stringify({
      results: [{ title: 'T', url: 'https://t.test', snippet: 's' }, { title: 'U', url: 'https://u.test' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const out = await new TinyfishBackend({ apiKey: 'k', timeoutMs: 2000 }).search({ query: 'q', maxResults: 1 })
    assert.equal(seen.headers['x-api-key'], 'k')
    assert.match(seen.url, /api\.search\.tinyfish\.ai\/?\?query=q/)
    assert.equal(out.sources.length, 1)
    assert.equal(out.truncated, true)
  } finally {
    globalThis.fetch = original
  }
})

