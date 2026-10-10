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
        return { SettingsSecretField: 'SettingsSecretField', SettingsForm: 'SettingsForm' }
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

test('bundle exports inject covering every context service apply reads', () => {
  // Cordis strict-injection: `apply` touching an undeclared service throws
  // "cannot get property ... without inject" and the entry never mounts.
  const registered = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => registered.push(def) } },
    require: () => ({}),
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  assert.equal(registered.length, 1)
  const { inject, apply: applyFn } = registered[0].factory(sandbox.require)
  assert.ok(Array.isArray(inject), 'bundle exports inject as an array')
  for (const key of ['locale', 'slots', 'remote', 'remote.credentials']) {
    assert.ok(inject.includes(key), `inject declares "${key}"`)
  }
  assert.equal(typeof applyFn, 'function')
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
      if (spec === '@deepseek-ai/dsh-client-ui-primitives') return { SettingsSecretField: 'S', SettingsForm: 'SettingsForm' }
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

/** Mount the bundle against a stub client context. `credentials` is the
 * `remote.credentials` double; it must answer a `RemoteResult`, the shape the
 * Host's Remote actually resolves. The react stub executes function
 * components so the rendered tree can be inspected. */
function mount(credentials) {
  const primitives = {
    SettingsSecretField: 'SettingsSecretField',
    SettingsForm: 'SettingsForm',
  }
  const react = {
    createElement: (type, props, ...children) => {
      if (children.length === 0 && props && props.children !== undefined) children = [props.children]
      const element = { type, props: { ...props }, children }
      return typeof type === 'function' ? type(element.props) : element
    },
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => def } },
    require: (spec) => {
      if (spec === 'react') return react
      if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitives
      throw new Error(spec)
    },
    setTimeout,
    clearTimeout,
    console,
  }
  vm.createContext(sandbox)
  const def = vm.runInContext(source, sandbox)
  const face = {}
  let component
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    remote: { credentials, $on: () => () => {} },
    slots: {
      inject: (name, callback) => {
        callback()
        return () => {}
      },
      register: (options, comp) => {
        component = comp
        Object.assign(face, options.inject())
        return () => {}
      },
    },
    effect: (factory) => factory(),
  }
  def.factory(sandbox.require).apply(ctx)
  return { face, component, store: face.hooks.card }
}

/** A describe double answering the Host's `RemoteResult` shape. */
function remoteDescribe(facts) {
  return {
    describe: async (refs) => ({ ok: true, value: Object.fromEntries(refs.map((ref) => [ref, facts[ref] ?? { configured: false, writable: true }])) }),
    set: async () => ({ ok: true }),
  }
}

/** Let every pending microtask and timer turn run. */
async function settle(ms = 0) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

test('initial describe publishes ready state with all four references', async () => {
  const { store } = mount(remoteDescribe({ TAVILY_API_KEY: { configured: true, writable: true } }))
  await settle()
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.ready, true)
  const refs = Object.keys(snapshot.keys).sort()
  assert.deepEqual(refs, ['BRAVE_SEARCH_API_KEY', 'EXA_API_KEY', 'TAVILY_API_KEY', 'TINYFISH_API_KEY'])
  assert.equal(snapshot.keys.TAVILY_API_KEY.configured, true)
})

test('a RemoteResult-wrapped describe reads its payload, not the envelope', async () => {
  // The regression this pins: reading the resolved answer itself left every
  // reference absent, so every control rendered disabled and untypable.
  const { store } = mount(remoteDescribe({
    TAVILY_API_KEY: { configured: true, writable: true },
    BRAVE_SEARCH_API_KEY: { configured: false, writable: true },
  }))
  await settle()
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.ready, true)
  assert.equal(snapshot.keys.TAVILY_API_KEY.configured, true)
  assert.equal(snapshot.keys.TAVILY_API_KEY.writable, true)
  assert.equal(snapshot.keys.BRAVE_SEARCH_API_KEY.configured, false)
  assert.equal(snapshot.keys.BRAVE_SEARCH_API_KEY.writable, true)
  // A missing entry is not a refusal: the field stays writable until the
  // Host says otherwise.
  assert.equal(snapshot.keys.EXA_API_KEY.writable, true)
})

test('a plain-record describe is still read as its payload', async () => {
  const { store } = mount({
    describe: async (refs) => Object.fromEntries(refs.map((ref) => [ref, { configured: ref === 'EXA_API_KEY', writable: true }])),
    set: async () => ({ ok: true }),
  })
  await settle()
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.ready, true)
  assert.equal(snapshot.keys.EXA_API_KEY.configured, true)
})

test('a refused describe retries instead of leaving the form disabled', async () => {
  let calls = 0
  const { store } = mount({
    describe: async () => {
      calls += 1
      return calls === 1 ? { ok: false, error: new Error('gateway/unavailable') } : { ok: true, value: {} }
    },
    set: async () => ({ ok: true }),
  })
  await settle()
  assert.equal(store.getSnapshot().ready, false, 'first refusal leaves the form waiting')
  await settle(400)
  assert.ok(calls >= 2, 'the card retried the describe')
  assert.equal(store.getSnapshot().ready, true, 'the retry landed')
})

test('a refused write keeps its draft and reports the failure', async () => {
  let accept = false
  const { store } = mount({
    describe: async () => ({ ok: true, value: {} }),
    set: async () => (accept ? { ok: true } : { ok: false, error: new Error('credentials/read-only') }),
  })
  await settle()
  store.edit('TAVILY_API_KEY', 'sk-live')
  await store.save()
  assert.equal(store.getSnapshot().failed, true)
  assert.equal(store.getSnapshot().dirty, true)
  assert.equal(store.stagedOf('TAVILY_API_KEY'), 'sk-live', 'the rejected draft stays for the user')
  accept = true
  await store.save()
  assert.equal(store.getSnapshot().failed, false)
  assert.equal(store.getSnapshot().dirty, false)
  assert.equal(store.stagedOf('TAVILY_API_KEY'), '')
})

test('the page view renders the shared form frame, not bare buttons', async () => {
  const { component } = mount(remoteDescribe({}))
  await settle()
  const idle = { ready: false, dirty: false, failed: false, saving: false, keys: {} }
  const tree = component({
    view: 'page',
    useCard: () => idle,
    t: (key) => key,
    edit: () => {},
    save: () => {},
    discard: () => {},
    staged: () => ({}),
  })
  assert.equal(tree.type, 'SettingsForm', 'controls render inside the shared settings form')
  assert.equal(tree.props.state.available, false, 'frame reports unavailable until the Host answers')
  const fields = tree.children[0]
  assert.ok(Array.isArray(fields) && fields.length === 4, 'one control per credential reference')
  const kinds = []
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node !== null && typeof node === 'object' && 'type' in node) {
      kinds.push(node.type)
      ;(node.children ?? []).forEach(walk)
    }
  }
  walk(tree)
  assert.ok(!kinds.includes('button'), 'no unstyled bare buttons outside the frame')
  // The summary view stays a one-liner.
  const summary = component({
    view: 'summary',
    useCard: () => idle,
    t: (key) => key,
    edit: () => {},
    save: () => {},
    discard: () => {},
    staged: () => ({}),
  })
  assert.equal(summary, 'description')
})

