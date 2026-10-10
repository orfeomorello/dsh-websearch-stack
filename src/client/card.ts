/**
 * Browser half of the websearch-stack settings card, in one file: this module
 * is bundled to `lib/client.js` in the loader format DSH's web client expects
 * (`window.__ModuleLoader__.load({ id, factory })`), so everything lives here.
 *
 * The card registers into the Plugins page's `plugins.bundle.config` slot,
 * keyed by this package's name, and manages the four credential-backed API
 * keys through the Host's `credentials` Remote: `describe` reports only
 * whether a key is configured (never the literal), `set` writes it. Staged
 * drafts save all at once; a blank draft writes nothing, which keeps the
 * stored key rather than clearing it.
 */
import { createElement, useEffect, useState } from 'react'
import { SettingsSecretField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Package name; also the `plugins.bundle.config` key the card registers under. */
const BUNDLE_NAME = 'dsh-websearch-stack'
/** Slot the plugin-manager declares for a bundle's own configuration. */
const CONFIG_SLOT = 'plugins.bundle.config'
/** Dictionary namespace owned by this card. */
export const NS = 'websearchStack'
/** Emit event the Host forwards when one credential reference changes. */
const REFERENCE_UPDATED_EVENT = 'credentials/reference-updated'

/** Credential references the card manages, in display order. */
const CREDENTIAL_REFS = ['TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY', 'TINYFISH_API_KEY', 'EXA_API_KEY'] as const
type CredentialRef = (typeof CREDENTIAL_REFS)[number]

const BACKEND_LABEL: Record<CredentialRef, string> = {
  TAVILY_API_KEY: 'tavily',
  BRAVE_SEARCH_API_KEY: 'brave',
  TINYFISH_API_KEY: 'tinyfish',
  EXA_API_KEY: 'exa',
}

/** English copy; `{name}`-style templating is not needed here. */
const en = {
  description: 'API keys for the search backends. Keys are stored by the Host, never in a settings file.',
  keyLabel: 'Key',
  keyHint: 'Stored by the Host outside the settings file. Leave blank to keep the current key.',
  keyConfigured: 'A key is configured.',
  keyUnset: 'No key configured; the backend only works keyless or is skipped.',
  keyNotWritable: 'This deployment does not accept writes for this key.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'Some keys could not be saved; their drafts were kept.',
  discard: 'Discard',
} as const
type LocaleKey = keyof typeof en

/** Credential facts one control renders; never a value. */
interface KeyState {
  configured: boolean
  writable: boolean
}

/** Whole-card state the component reads and re-renders on. */
interface StackCardState {
  ready: boolean
  dirty: boolean
  failed: boolean
  saving: boolean
  keys: Partial<Record<CredentialRef, KeyState>>
}

/** Minimal face of the `credentials` Remote namespace the card depends on. */
interface CredentialsRemote {
  describe(refs: readonly CredentialRef[]): Promise<Record<string, { configured: boolean; writable: boolean }> | undefined>
  set(ref: string, value: string): Promise<void>
}

/** Minimal client-context share the card needs at runtime. */
interface CardContext {
  locale: { bind(ns: string): (key: LocaleKey) => string; register(ns: string, locale: string, dict: Record<string, string>): () => void }
  remote: { credentials: CredentialsRemote; $on(event: string, listener: (ref: unknown) => void): () => void }
  slots: {
    inject(name: string, register: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  effect(factory: () => unknown, label: string): unknown
}

/**
 * Snapshot store behind the card: `getSnapshot`/`subscribe` is the shape the
 * slot machinery binds as a selector hook, so the framework re-renders the
 * card whenever the controller publishes.
 */
class StackCardStore {
  private snapshot: StackCardState = { ready: false, dirty: false, failed: false, saving: false, keys: {} }
  private readonly staged = new Map<CredentialRef, string>()
  private saving = false
  private readonly listeners = new Set<() => void>()
  private readonly credentials: CredentialsRemote

  constructor(credentials: CredentialsRemote) {
    this.credentials = credentials
  }

  getSnapshot(): StackCardState {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Fetch facts for every reference in one batched `describe`. */
  async load(): Promise<void> {
    const answer = await this.credentials.describe(CREDENTIAL_REFS).catch(() => undefined)
    if (!answer) return
    const keys: Partial<Record<CredentialRef, KeyState>> = {}
    for (const ref of CREDENTIAL_REFS) {
      const view = answer[ref]
      keys[ref] = { configured: view?.configured ?? false, writable: view?.writable ?? false }
    }
    this.patch({ ready: true, keys })
    this.publish()
  }

  /** Re-read one reference after the Host reports it changed. */
  async refresh(ref: CredentialRef): Promise<void> {
    const answer = await this.credentials.describe([ref]).catch(() => undefined)
    if (!answer) return
    const view = answer[ref]
    const next: KeyState = { configured: view?.configured ?? false, writable: view?.writable ?? false }
    const previous = this.snapshot.keys[ref]
    if (previous && previous.configured === next.configured && previous.writable === next.writable) return
    this.patch({ keys: { ...this.snapshot.keys, [ref]: next } })
    this.publish()
  }

  /** Stage draft text; a blank draft means "no write on save". */
  edit(ref: CredentialRef, text: string): void {
    if (text.length === 0) this.staged.delete(ref)
    else this.staged.set(ref, text)
    this.patch({ dirty: this.staged.size > 0, failed: false })
    this.publish()
  }

  stagedOf(ref: CredentialRef): string {
    return this.staged.get(ref) ?? ''
  }

  /** Write every staged key in order; a failed write keeps its draft. */
  async save(): Promise<void> {
    if (this.saving || this.staged.size === 0) return
    this.saving = true
    this.patch({ saving: true, failed: false })
    this.publish()
    let failed = false
    for (const ref of CREDENTIAL_REFS) {
      const value = this.staged.get(ref)
      if (value === undefined) continue
      try {
        await this.credentials.set(ref, value)
        this.staged.delete(ref)
      } catch {
        failed = true
      }
    }
    this.saving = false
    this.patch({ saving: false, failed, dirty: this.staged.size > 0 })
    await this.load()
    this.publish()
  }

  /** Drop every staged edit. */
  discard(): void {
    this.staged.clear()
    this.patch({ dirty: false, failed: false })
    this.publish()
  }

  /** Merge a partial state into the snapshot. */
  private patch(part: Partial<StackCardState>): void {
    this.snapshot = { ...this.snapshot, ...part }
  }

  private publish(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/** One credential control per key-backed backend, in display order. */
function CardBody(props: {
  state: StackCardState
  staged: Record<CredentialRef, string>
  t: (key: LocaleKey) => string
  onEdit: (ref: CredentialRef, text: string) => void
  onSave: () => void
  onDiscard: () => void
}) {
  const { state, t } = props
  return createElement(
    'div',
    null,
    CREDENTIAL_REFS.map((ref) => {
      const key = state.keys[ref] ?? { configured: false, writable: true }
      const backend = BACKEND_LABEL[ref]
      return createElement(SettingsSecretField, {
        key: ref,
        id: `plugin-config-websearch-stack-${backend}`,
        label: `${t('keyLabel')} (${backend})`,
        hint: t('keyHint'),
        disabled: !state.ready || !key.writable,
        text: props.staged[ref] ?? '',
        configured: key.configured,
        stateLabel: key.configured
          ? t('keyConfigured')
          : key.writable
            ? t('keyUnset')
            : t('keyNotWritable'),
        onEdit: (text: string) => {
          props.onEdit(ref, text)
        },
      })
    }),
    createElement(
      'p',
      { role: 'status' },
      state.failed ? t('saveFailed') : null,
    ),
    createElement('button', {
      type: 'button',
      disabled: state.saving || !state.ready || !state.dirty,
      onClick: props.onSave,
    }, state.saving ? t('saving') : t('save')),
    createElement('button', {
      type: 'button',
      disabled: state.saving || !state.dirty,
      onClick: props.onDiscard,
    }, t('discard')),
  )
}

/**
 * Render the card's one-liner or its four key controls as the Plugins page asks.
 * `useCard` is the selector hook the slot machinery binds from the inject face.
 */
function StackCard(props: {
  view: 'summary' | 'page'
  useCard: (selector: (state: StackCardState) => StackCardState) => StackCardState
  t: (key: LocaleKey) => string
  edit: (ref: CredentialRef, text: string) => void
  save: () => void
  discard: () => void
  staged: () => Record<CredentialRef, string>
}): string | ReturnType<typeof createElement> {
  if (props.view === 'summary') return props.t('description')
  const state = props.useCard((current) => current)
  return createElement(CardBody, {
    state,
    staged: props.staged(),
    t: props.t,
    onEdit: props.edit,
    onSave: props.save,
    onDiscard: props.discard,
  })
}

/** Dictionary namespace owned by this card. */
export { NS as CARD_NS }

/**
 * Mount the card while the Host serves its Remote. Registrations are
 * effect-scoped, so disposing the plugin's fiber removes the card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const card = ctx as unknown as CardContext
  const t = card.locale.bind(NS)

  card.effect(
    () => card.locale.register(NS, 'en', en),
    'websearch-stack: dictionaries',
  )

  const store = new StackCardStore(card.remote.credentials)

  card.effect(
    () => card.remote.$on(REFERENCE_UPDATED_EVENT, (ref) => {
      if (typeof ref === 'string' && (CREDENTIAL_REFS as readonly string[]).includes(ref)) {
        void store.refresh(ref as CredentialRef)
      }
    }),
    'websearch-stack: credential invalidations',
  )

  // Load first, then register: the inject face is read the moment the slot
  // injects, so the snapshot it hands out must already be materialized.
  card.effect(
    () => {
      void store.load()
    },
    'websearch-stack: initial describe',
  )

  card.effect(
    () => card.slots.inject(CONFIG_SLOT, () => card.slots.register({
      name: CONFIG_SLOT,
      key: BUNDLE_NAME,
      locale: NS,
      registrant: 'websearch-stack',
      inject: () => ({
        hooks: { card: store },
        t,
        edit: (ref: CredentialRef, text: string) => store.edit(ref, text),
        save: () => void store.save(),
        discard: () => store.discard(),
        staged: () => Object.fromEntries(CREDENTIAL_REFS.map((ref) => [ref, store.stagedOf(ref)])),
      }),
    }, StackCard)),
    'websearch-stack: card',
  )
}

/** Test-only re-export: reference order the card presents the controls in. */
export const CARD_CREDENTIAL_REFS = CREDENTIAL_REFS

/** Mount-lifecycle helper for tests and hosts that render outside a slot. */
export function useCardLifecycle(store: StackCardStore): StackCardState {
  const [state, setState] = useState<StackCardState>(() => store.getSnapshot())
  useEffect(() => store.subscribe(() => setState(store.getSnapshot())), [store])
  useEffect(() => {
    void store.load()
  }, [store])
  return state
}
