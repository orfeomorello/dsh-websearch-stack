import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, inject, name, Config } from '../lib/index.js'
import YAML from 'yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('package.json main and exports point at files that exist', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  await access(join(root, pkg.main))
  await access(join(root, pkg.types))
  assert.equal(pkg.exports['.'].default, './lib/index.js')
})

test('exported name matches the id in cordis.patch.yml', async () => {
  const patch = YAML.parse(await readFile(join(root, 'cordis.patch.yml'), 'utf8'))
  const id = patch[0].insert[0].id
  assert.equal(id, name)
})

test('exports the plugin contract: name, inject, Config, apply', () => {
  assert.equal(typeof name, 'string')
  assert.ok(Array.isArray(inject) && inject.includes('web'))
  // Schemastery schemas are callable, so the type is 'function'.
  assert.ok(Config !== undefined && Config !== null)
  assert.equal(typeof apply, 'function')
})

test('apply() registers exactly one search provider when backends are enabled', () => {
  const registered = []
  const ctx = { web: { registerSearchProvider: (p) => { registered.push(p); return () => {} } } }
  apply(ctx, {
    enabled_providers: ['tavily', 'searxng'],
    searxng_url: 'http://localhost:8080',
    default_max_results: 5,
    default_timeout_ms: 10000,
    cache_ttl_seconds: 60,
  })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, 'websearch-stack')
})

test('apply() registers nothing when enabled_providers is empty', () => {
  const registered = []
  const ctx = { web: { registerSearchProvider: (p) => { registered.push(p); return () => {} } } }
  apply(ctx, {
    enabled_providers: [],
    searxng_url: undefined,
    default_max_results: 5,
    default_timeout_ms: 10000,
    cache_ttl_seconds: 60,
  })
  assert.equal(registered.length, 0)
})
