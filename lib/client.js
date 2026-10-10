window.__ModuleLoader__.load({
	id: "dsh-websearch-stack",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/client/card.ts
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARD_CREDENTIAL_REFS = exports.CARD_NS = exports.NS = void 0;
exports.apply = apply;
exports.useCardLifecycle = useCardLifecycle;
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
const react_1 = require("react");
const dsh_client_ui_primitives_1 = require("@deepseek-ai/dsh-client-ui-primitives");
/** Package name; also the `plugins.bundle.config` key the card registers under. */
const BUNDLE_NAME = 'dsh-websearch-stack';
/** Slot the plugin-manager declares for a bundle's own configuration. */
const CONFIG_SLOT = 'plugins.bundle.config';
/** Dictionary namespace owned by this card. */
exports.NS = 'websearchStack';
exports.CARD_NS = exports.NS;
/** Emit event the Host forwards when one credential reference changes. */
const REFERENCE_UPDATED_EVENT = 'credentials/reference-updated';
/** Credential references the card manages, in display order. */
const CREDENTIAL_REFS = ['TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY', 'TINYFISH_API_KEY', 'EXA_API_KEY'];
const BACKEND_LABEL = {
    TAVILY_API_KEY: 'tavily',
    BRAVE_SEARCH_API_KEY: 'brave',
    TINYFISH_API_KEY: 'tinyfish',
    EXA_API_KEY: 'exa',
};
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
};
/**
 * Snapshot store behind the card: `getSnapshot`/`subscribe` is the shape the
 * slot machinery binds as a selector hook, so the framework re-renders the
 * card whenever the controller publishes.
 */
class StackCardStore {
    snapshot = { ready: false, dirty: false, failed: false, saving: false, keys: {} };
    staged = new Map();
    saving = false;
    listeners = new Set();
    credentials;
    constructor(credentials) {
        this.credentials = credentials;
    }
    getSnapshot() {
        return this.snapshot;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    /** Fetch facts for every reference in one batched `describe`. */
    async load() {
        const answer = await this.credentials.describe(CREDENTIAL_REFS).catch(() => undefined);
        if (!answer)
            return;
        const keys = {};
        for (const ref of CREDENTIAL_REFS) {
            const view = answer[ref];
            keys[ref] = { configured: view?.configured ?? false, writable: view?.writable ?? false };
        }
        this.patch({ ready: true, keys });
        this.publish();
    }
    /** Re-read one reference after the Host reports it changed. */
    async refresh(ref) {
        const answer = await this.credentials.describe([ref]).catch(() => undefined);
        if (!answer)
            return;
        const view = answer[ref];
        const next = { configured: view?.configured ?? false, writable: view?.writable ?? false };
        const previous = this.snapshot.keys[ref];
        if (previous && previous.configured === next.configured && previous.writable === next.writable)
            return;
        this.patch({ keys: { ...this.snapshot.keys, [ref]: next } });
        this.publish();
    }
    /** Stage draft text; a blank draft means "no write on save". */
    edit(ref, text) {
        if (text.length === 0)
            this.staged.delete(ref);
        else
            this.staged.set(ref, text);
        this.patch({ dirty: this.staged.size > 0, failed: false });
        this.publish();
    }
    stagedOf(ref) {
        return this.staged.get(ref) ?? '';
    }
    /** Write every staged key in order; a failed write keeps its draft. */
    async save() {
        if (this.saving || this.staged.size === 0)
            return;
        this.saving = true;
        this.patch({ saving: true, failed: false });
        this.publish();
        let failed = false;
        for (const ref of CREDENTIAL_REFS) {
            const value = this.staged.get(ref);
            if (value === undefined)
                continue;
            try {
                await this.credentials.set(ref, value);
                this.staged.delete(ref);
            }
            catch {
                failed = true;
            }
        }
        this.saving = false;
        this.patch({ saving: false, failed, dirty: this.staged.size > 0 });
        await this.load();
        this.publish();
    }
    /** Drop every staged edit. */
    discard() {
        this.staged.clear();
        this.patch({ dirty: false, failed: false });
        this.publish();
    }
    /** Merge a partial state into the snapshot. */
    patch(part) {
        this.snapshot = { ...this.snapshot, ...part };
    }
    publish() {
        for (const listener of [...this.listeners])
            listener();
    }
}
/** One credential control per key-backed backend, in display order. */
function CardBody(props) {
    const { state, t } = props;
    return (0, react_1.createElement)('div', null, CREDENTIAL_REFS.map((ref) => {
        const key = state.keys[ref] ?? { configured: false, writable: true };
        const backend = BACKEND_LABEL[ref];
        return (0, react_1.createElement)(dsh_client_ui_primitives_1.SettingsSecretField, {
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
            onEdit: (text) => {
                props.onEdit(ref, text);
            },
        });
    }), (0, react_1.createElement)('p', { role: 'status' }, state.failed ? t('saveFailed') : null), (0, react_1.createElement)('button', {
        type: 'button',
        disabled: state.saving || !state.ready || !state.dirty,
        onClick: props.onSave,
    }, state.saving ? t('saving') : t('save')), (0, react_1.createElement)('button', {
        type: 'button',
        disabled: state.saving || !state.dirty,
        onClick: props.onDiscard,
    }, t('discard')));
}
/**
 * Render the card's one-liner or its four key controls as the Plugins page asks.
 * `useCard` is the selector hook the slot machinery binds from the inject face.
 */
function StackCard(props) {
    if (props.view === 'summary')
        return props.t('description');
    const state = props.useCard((current) => current);
    return (0, react_1.createElement)(CardBody, {
        state,
        staged: props.staged(),
        t: props.t,
        onEdit: props.edit,
        onSave: props.save,
        onDiscard: props.discard,
    });
}
/**
 * Mount the card while the Host serves its Remote. Registrations are
 * effect-scoped, so disposing the plugin's fiber removes the card.
 * @param ctx - the browser plugin context.
 */
function apply(ctx) {
    const card = ctx;
    const t = card.locale.bind(exports.NS);
    card.effect(() => card.locale.register(exports.NS, 'en', en), 'websearch-stack: dictionaries');
    const store = new StackCardStore(card.remote.credentials);
    card.effect(() => card.remote.$on(REFERENCE_UPDATED_EVENT, (ref) => {
        if (typeof ref === 'string' && CREDENTIAL_REFS.includes(ref)) {
            void store.refresh(ref);
        }
    }), 'websearch-stack: credential invalidations');
    // Load first, then register: the inject face is read the moment the slot
    // injects, so the snapshot it hands out must already be materialized.
    card.effect(() => {
        void store.load();
    }, 'websearch-stack: initial describe');
    card.effect(() => card.slots.inject(CONFIG_SLOT, () => card.slots.register({
        name: CONFIG_SLOT,
        key: BUNDLE_NAME,
        locale: exports.NS,
        registrant: 'websearch-stack',
        inject: () => ({
            hooks: { card: store },
            t,
            edit: (ref, text) => store.edit(ref, text),
            save: () => void store.save(),
            discard: () => store.discard(),
            staged: () => Object.fromEntries(CREDENTIAL_REFS.map((ref) => [ref, store.stagedOf(ref)])),
        }),
    }, StackCard)), 'websearch-stack: card');
}
/** Test-only re-export: reference order the card presents the controls in. */
exports.CARD_CREDENTIAL_REFS = CREDENTIAL_REFS;
/** Mount-lifecycle helper for tests and hosts that render outside a slot. */
function useCardLifecycle(store) {
    const [state, setState] = (0, react_1.useState)(() => store.getSnapshot());
    (0, react_1.useEffect)(() => store.subscribe(() => setState(store.getSnapshot())), [store]);
    (0, react_1.useEffect)(() => {
        void store.load();
    }, [store]);
    return state;
}
//#endregion
		return module.exports;
	}
});
