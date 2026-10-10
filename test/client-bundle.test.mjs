import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'lib', 'client.js'), 'utf8')

// Minimal stand-in for the web client's module registry: the two bare imports
// the card makes resolve to stubs, everything else (slots/locale/effect/
// remote) is the plugin context under test.
function compile() {
  const registered = []
  const effects = []
  const localeDicts = []
  const context = {
    locale: {
      bind: (ns) => (key) => `${ns}:${key}`,
      register: (ns, locale, dict) => {
        localeDicts.push({ ns, locale, dict })
        return () => {}
      },
    },
    remote: {
      credentials: {
        describe: async (refs) => Object.fromEntries(refs.map((r) => [r, { configured: false, writable: true }])),
        set: async () => {},
      },
      $on: () => () => {},
    },
    slots: {
      // The real inject(key, callback) re-runs callback per declaration epoch;
      // callback returns the register disposer. One synchronous call here.
      inject: (name, callback) => {
        registered.push(callback())
        return () => {}
      },
      register: (options, component) => {
        registered.push({ options, component })
        return () => {}
      },
    },
    effect: (factory, label) => {
      effects.push({ factory, label })
      return factory()
    },
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => def } },
    require: (spec) => {
      if (spec === 'react') {
        return { createElement: (type, props, ...children) => ({ type, props, children }), useState: (init) => [typeof init === 'function' ? init() : init, () => {}], useEffect: () => {} }
      }
      if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
        return { SettingsSecretField: 'SettingsSecretField' }
      }
      throw new Error(`unexpected require: ${spec}`)
    },
    console,
  }
  vm.createContext(sandbox)
  const def = vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert.equal(typeof def.factory, 'function', 'loader def carries a factory')
  const exports = def.factory(sandbox.require)
  return { exports, context, registered, effects, localeDicts }
}

test('bundle is in the ModuleLoader format with this package id', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(typeof pkg.name, 'string')
  assert.match(source, /^window\.__ModuleLoader__\.load\(/)
  // The registration id must be the bare package name: the boot graph row is
  // keyed by it and the loader asserts it after executing the script.
  assert.ok(source.includes(JSON.stringify(pkg.name)))
  // The two bare requires the client registry must resolve.
  assert.ok(source.includes('require("react")'))
  assert.ok(source.includes('require("@deepseek-ai/dsh-client-ui-primitives")'))
})

test('apply registers the card into plugins.bundle.config keyed by the package name', () => {
  const { exports, context, registered, effects } = compile()
  assert.equal(typeof exports.apply, 'function')
  exports.apply(context)
  const entries = registered.filter((r) => r.options !== undefined)
  assert.equal(entries[0].options.name, 'plugins.bundle.config')
  assert.equal(entries[0].options.key, 'dsh-websearch-stack')
  assert.equal(entries[0].options.locale, 'websearchStack')
  const card = entries[0].component
  assert.notEqual(card, undefined)
  // Effect-scoped registration: dictionaries + invalidations + card + lifetime + load.
  assert.ok(effects.length >= 3)
})

test('the inject face exposes the controller actions and English dictionaries', () => {
  const localeDicts = []
  const seen = []
  const ctx = {
    locale: {
      bind: (ns) => (key) => `${ns}:${key}`,
      register: (ns, locale, dict) => {
        localeDicts.push({ ns, locale, dict })
        return () => {}
      },
    },
    remote: {
      credentials: {
        describe: async (refs) => Object.fromEntries(refs.map((r) => [r, { configured: false, writable: true }])),
        set: async () => {},
      },
      $on: () => () => {},
    },
    slots: {
      // The real inject(key, callback) re-runs callback per declaration epoch;
      // callback returns the register disposer. One synchronous call here.
      inject: (name, callback) => {
        callback()
        return () => {}
      },
      register: (options) => {
        seen.push(options)
        return () => {}
      },
    },
    effect: (factory) => factory(),
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => def } },
    require: (spec) => {
      if (spec === 'react') return { createElement: (t, p, ...c) => ({ t, p, c }), useState: (i) => [typeof i === 'function' ? i() : i, () => {}], useEffect: () => {} }
      if (spec === '@deepseek-ai/dsh-client-ui-primitives') return { SettingsSecretField: 'S' }
      throw new Error(spec)
    },
    console,
  }
  vm.createContext(sandbox)
  const def = vm.runInContext(source, sandbox)
  def.factory(sandbox.require).apply(ctx)
  const entry = seen.find((options) => options.inject)
  assert.ok(entry, 'the card entry carries an inject face')
  const face = entry.inject()
  assert.equal(typeof face.edit, 'function')
  assert.equal(typeof face.save, 'function')
  assert.equal(typeof face.discard, 'function')
  assert.equal(typeof face.staged, 'function')
  assert.ok(face.hooks && typeof face.hooks.card.getSnapshot === 'function', 'face exposes the snapshot store')
  const dict = localeDicts.find((d) => d.ns === 'websearchStack')
  assert.ok(dict, 'card dictionary registered')
  assert.equal(dict.locale, 'en')
  assert.ok(dict.dict.description.includes('API keys'))
})

test('initial describe publishes ready state with all four references', async () => {
  const waits = []
  const ctx = {
    locale: { bind: () => (k) => k, register: () => () => {} },
    remote: {
      credentials: {
        describe: async (refs) => {
          const p = Promise.resolve(Object.fromEntries(refs.map((r) => [r, { configured: r === 'TAVILY_API_KEY', writable: true }])))
          waits.push(p)
          return p
        },
        set: async () => {},
      },
      $on: () => () => {},
    },
    slots: {
      inject: (name, callback) => { callback() },
      register: () => () => {},
    },
    effect: (factory) => factory(),
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => def } },
    require: (spec) => {
      if (spec === 'react') return { createElement: (t, p, ...c) => ({ t, p, c }), useState: (i) => [typeof i === 'function' ? i() : i, () => {}], useEffect: () => {} }
      if (spec === '@deepseek-ai/dsh-client-ui-primitives') return { SettingsSecretField: 'S' }
      throw new Error(spec)
    },
    console,
  }
  vm.createContext(sandbox)
  const def = vm.runInContext(source, sandbox)
  let store
  const originalApply = def.factory(sandbox.require).apply
  // Capture the store through the inject face: register() runs synchronously
  // inside apply, so the closure below sees it.
  const probeCtx = {
    ...ctx,
    slots: {
      inject: ctx.slots.inject,
      register: (options) => {
        store = options.inject().hooks.card
        return () => {}
      },
    },
  }
  originalApply(probeCtx)
  assert.ok(store, 'card store reachable through the inject face')
  await Promise.all(waits)
  await new Promise((resolve) => setImmediate(resolve))
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.ready, true)
  const refs = Object.keys(snapshot.keys).sort()
  assert.deepEqual(refs, ['BRAVE_SEARCH_API_KEY', 'EXA_API_KEY', 'TAVILY_API_KEY', 'TINYFISH_API_KEY'])
  assert.equal(snapshot.keys.TAVILY_API_KEY.configured, true)
})
