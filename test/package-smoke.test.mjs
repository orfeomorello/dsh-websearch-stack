import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { apply, inject, name, Config } from '../lib/index.js'
import YAML from 'yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Let the plugin's async key resolution settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('package.json main and exports point at files that exist', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  await access(join(root, pkg.main))
  await access(join(root, pkg.types))
  assert.equal(pkg.exports['.'].default, './lib/index.js')
  // Browser bundle: the client export points at a file that exists, and the
  // declaration carries the web platform registration the client loader reads.
  await access(join(root, pkg.exports['./client'].default.replace(/^\.\//, '')))
  await access(join(root, pkg.exports['./client'].types.replace(/^\.\//, '')))
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes'))
})

test('exported name matches the id in cordis.patch.yml', async () => {
  const patch = YAML.parse(await readFile(join(root, 'cordis.patch.yml'), 'utf8'))
  const inserted = patch.flatMap((row) => row.insert ?? [])
  assert.equal(inserted.length, 1, 'cordis.patch.yml must insert exactly one plugin row')
  assert.equal(inserted[0].id, name)
  assert.equal(inserted[0].name, 'dsh-websearch-stack')
})

/**
 * The loader's patch algorithm (`@deepseek-ai/cordis-plugin-include`'s
 * `applyEntryPatches`): rows are matched by `id`, `insert` appends, and an
 * override replaces the row's whole `config` — never a deep merge.
 */
function applyPatches(data, patches) {
  const entries = structuredClone(data)
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  for (const { id, insert, name, ...overrides } of patches) {
    if (insert) {
      entries.push(...insert)
      for (const entry of insert) byId.set(entry.id, entry)
      continue
    }
    const target = byId.get(id)
    assert.ok(target !== undefined, `patch target ${id} is not registered`)
    if (name !== undefined) assert.equal(name, target.name, 'patch name must match the row it overrides')
    Object.assign(target, overrides)
  }
  return entries
}

test('the bundle patch pins the web seam to this provider', async () => {
  // `@deepseek-ai/dsh-base` pins `web.searchProvider` to the native DeepSeek
  // provider, which reports available() even without DEEPSEEK_API_KEY, so an
  // unpinned seam fails every web_search with WEB_PROVIDER_CREDENTIAL_MISSING
  // and never reaches the provider this bundle registers. The patch pins the
  // seam to the stack and restates `fetchProvider`, because a patch replaces
  // the row's whole config.
  const patch = YAML.parse(await readFile(join(root, 'cordis.patch.yml'), 'utf8'))
  const base = [{
    id: 'web',
    name: '@deepseek-ai/dsh-web',
    config: { searchProvider: 'deepseek-official', fetchProvider: 'http' },
  }]
  const composed = applyPatches(base, patch)
  const row = composed.find((entry) => entry.id === 'web')
  assert.equal(row.config.searchProvider, 'websearch-stack')
  assert.equal(row.config.fetchProvider, 'http')
  // The insert row survives the override, so the pinned id is registered.
  assert.ok(composed.some((entry) => entry.id === 'websearch-stack'))
})

test('exports the plugin contract: name, inject, Config, apply', () => {
  assert.equal(typeof name, 'string')
  assert.ok(Array.isArray(inject) && inject.includes('web'))
  // Schemastery schemas are callable, so the type is 'function'.
  assert.ok(Config !== undefined && Config !== null)
  assert.equal(typeof apply, 'function')
})

test('the Config schema resolves every field as a volatile reference', () => {
  // This is the shape cordis hands to apply: each field a reference with .get(),
  // which is what makes the Plugins page able to edit them in place.
  const resolved = Config({ enabled_providers: ['exa', 'tavily'] })
  assert.deepEqual(resolved.enabled_providers.get(), ['exa', 'tavily'])
  assert.equal(resolved.searxng_url.get(), undefined)
  assert.equal(resolved.default_max_results.get(), 5)
  assert.equal(resolved.default_timeout_ms.get(), 10000)
  assert.equal(resolved.cache_ttl_seconds.get(), 60)
  // Defaults fill the chain when nothing is configured.
  const defaults = Config({})
  assert.deepEqual(defaults.enabled_providers.get(), ['tavily', 'parallel-mcp'])
  // An unknown backend is rejected by the schema, so the page cannot write one.
  assert.throws(() => Config({ enabled_providers: ['nope'] }))
})

/** A resolved plugin config: every field is a volatile reference, and `edit`
 * mutates one the way the loader does after a volatile edit on the Plugins page. */function configOf(overrides = {}) {
  let value = {
    enabled_providers: ['tavily', 'searxng'],
    searxng_url: 'http://localhost:8080',
    default_max_results: 5,
    default_timeout_ms: 10000,
    cache_ttl_seconds: 60,
    ...overrides,
  }
  return {
    enabled_providers: { get: () => value.enabled_providers },
    searxng_url: { get: () => value.searxng_url },
    default_max_results: { get: () => value.default_max_results },
    default_timeout_ms: { get: () => value.default_timeout_ms },
    cache_ttl_seconds: { get: () => value.cache_ttl_seconds },
    edit: (part) => { value = { ...value, ...part } },
  }
}

/** A stub client context capturing what apply registers. */
function stubContext({ credentials } = {}) {
  const registered = []
  const events = {}
  const logs = []
  return {
    registered,
    events,
    logs,
    ctx: {
      web: { registerSearchProvider: (p) => { registered.push(p); return () => {} } },
      get: (service) => (service === 'credentials' ? credentials : undefined),
      effect: (factory) => factory(),
      on: (name, listener) => { events[name] = listener; return () => { delete events[name] } },
      logger: () => ({ info: (message, ...args) => logs.push([message, ...args]) }),
    },
  }
}

test('apply() registers exactly one search provider when backends are enabled', () => {
  const { ctx, registered } = stubContext()
  apply(ctx, configOf())
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, 'websearch-stack')
  assert.equal(registered[0].available(), true)
})

test('the chain in force is what availability answers for, live', () => {
  // Registration happens once and always: disabling every backend takes effect
  // with no reload, and the seam answers WEB_PROVIDER_CONFIGURED_UNAVAILABLE
  // because the bundle patch pins searchProvider to this provider.
  const { ctx, registered } = stubContext()
  const config = configOf()
  apply(ctx, config)
  const provider = registered[0]
  assert.equal(provider.available(), true)
  config.edit({ enabled_providers: [] })
  assert.equal(provider.available(), false)
  config.edit({ enabled_providers: ['brave'] })
  // Brave is keyed and no key is resolved, so it stays unavailable.
  assert.equal(provider.available(), false)
  config.edit({ enabled_providers: ['tavily'] })
  // Tavily runs keyless, so it is available as soon as it is enabled.
  assert.equal(provider.available(), true)
})

test('a credential change re-resolves the key and lands with no reload', async () => {
  const store = {}
  const { ctx, registered, events } = stubContext({
    credentials: { resolve: async (ref) => ({ value: store[ref] }) },
  })
  apply(ctx, configOf({ enabled_providers: ['exa'] }))
  await settle()
  assert.equal(registered[0].available(), false)
  store.EXA_API_KEY = 'sk-written-by-the-card'
  events['credentials/reference-updated']('EXA_API_KEY')
  await settle()
  assert.equal(registered[0].available(), true, 'the refreshed key landed without a reload')
  // A reference the plugin does not manage changes nothing and crashes nothing.
  events['credentials/reference-updated']('SOME_OTHER_REF')
  await settle()
  assert.equal(registered[0].available(), true)
})

test('apply() falls back to environment keys without a credentials service', async () => {
  const previous = process.env.EXA_API_KEY
  process.env.EXA_API_KEY = 'sk-from-env'
  try {
    const { ctx, registered } = stubContext()
    apply(ctx, configOf({ enabled_providers: ['exa'] }))
    await settle()
    assert.equal(registered[0].available(), true, 'the environment key was resolved at startup')
  } finally {
    if (previous === undefined) delete process.env.EXA_API_KEY
    else process.env.EXA_API_KEY = previous
  }
})

test('the plugin page title and description come from the exported locale', async () => {
  // `readPluginMeta` (@deepseek-ai/dsh-app-boot) reads `<pkg>/locale/en.json`
  // and falls back to package.json name/description otherwise, so without this
  // file the Plugins page shows the bare package name as the title.
  const localeDir = join(root, 'locale')
  const files = (await readdir(localeDir)).filter((entry) => entry.endsWith('.json'))
  assert.deepEqual(files, ['en.json'], 'locale/ holds only the English dictionary')
  const dict = JSON.parse(await readFile(join(localeDir, 'en.json'), 'utf8'))
  assert.equal(typeof dict.meta.title, 'string')
  assert.ok(dict.meta.title.length > 0)
  assert.notEqual(dict.meta.title, 'dsh-websearch-stack', 'title is display copy, not the package name')
  assert.equal(typeof dict.meta.description, 'string')
  assert.ok(dict.meta.description.length > 0)
  // The export map must let the Host resolve `<pkg>/locale/en.json`; the
  // package self-reference resolves through it, like `resolvePluginResource`.
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.ok(pkg.exports['./locale/*'], 'exports maps ./locale/*')
  assert.ok(pkg.files.includes('locale'), 'files ships the locale directory')
  assert.equal(
    import.meta.resolve('dsh-websearch-stack/locale/en.json'),
    pathToFileURL(join(localeDir, 'en.json')).href,
  )
})
