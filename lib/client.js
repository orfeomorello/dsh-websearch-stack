window.__ModuleLoader__.load({
	id: "dsh-websearch-stack",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/client/card.ts
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARD_CREDENTIAL_REFS = exports.inject = exports.CARD_NS = exports.NS = void 0;
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
 *
 * A Remote answer is a `RemoteResult`, never a bare value and never a throw:
 * `{ ok: true, value }` on success, `{ ok: false, error }` on failure. Reading
 * the payload out of `value` is what keeps the card usable — taking the
 * resolved answer itself leaves every reference looking absent, which renders
 * the whole form disabled.
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
    unavailable: 'The keys cannot be read right now; the plugin page will retry.',
    readOnly: 'This deployment stores settings read-only.',
    keyLabel: 'Key',
    keyHint: 'Stored by the Host outside the settings file. Leave blank to keep the current key.',
    keyConfigured: 'A key is configured.',
    keyUnset: 'No key configured; the backend only works keyless or is skipped.',
    keyNotWritable: 'This deployment does not accept writes for this key.',
    save: 'Save',
    saving: 'Saving…',
    saveFailed: 'Some keys could not be saved; their drafts were kept.',
};
/** Backoff between describe retries while the Host has not answered yet. */
const DESCRIBE_RETRY_DELAYS_MS = [250, 1000, 4000];
/** A Remote answer's payload: `{ ok, value }` carries it under `value`. */
function remoteValue(answer) {
    if (answer !== null && typeof answer === 'object' && 'ok' in answer) {
        const result = answer;
        return result.ok ? result.value : undefined;
    }
    return (answer ?? undefined);
}
/** Whether a Remote answer reported success. A void or missing answer — a
 * `set` that never crossed the wire — counts as not accepted, so its draft
 * stays for the user instead of vanishing. */
function remoteAccepted(answer) {
    if (answer !== null && typeof answer === 'object' && 'ok' in answer) {
        return answer.ok === true;
    }
    return answer !== undefined && answer !== false;
}
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
    /**
     * One Remote call, answered. A Remote does not reject by contract, so a
     * throw here means the Host does not serve the namespace at all.
     */
    async ask(call) {
        try {
            return await call;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Fetch facts for every reference in one batched `describe`.
     * @returns whether the Host answered; false keeps the form waiting.
     */
    async load() {
        const value = remoteValue(await this.ask(this.credentials.describe(CREDENTIAL_REFS)));
        if (!value) {
            this.publish();
            return false;
        }
        const keys = {};
        for (const ref of CREDENTIAL_REFS) {
            const view = value[ref];
            keys[ref] = { configured: view?.configured ?? false, writable: view?.writable ?? true };
        }
        this.patch({ ready: true, keys });
        this.publish();
        return true;
    }
    /** Re-read one reference after the Host reports it changed. */
    async refresh(ref) {
        const value = remoteValue(await this.ask(this.credentials.describe([ref])));
        if (!value)
            return;
        const view = value[ref];
        const next = { configured: view?.configured ?? false, writable: view?.writable ?? true };
        const previous = this.snapshot.keys[ref];
        if (previous && previous.configured === next.configured && previous.writable === next.writable)
            return;
        this.patch({ ready: true, keys: { ...this.snapshot.keys, [ref]: next } });
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
            const text = this.staged.get(ref);
            if (text === undefined)
                continue;
            const answer = await this.ask(this.credentials.set(ref, text));
            if (remoteAccepted(answer))
                this.staged.delete(ref);
            else
                failed = true;
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
/** One credential control per key-backed backend, in display order.
 * The shared form frame draws the chrome: the unavailable line while the Host
 * has not answered, the failure line, and the save in a spaced footer. */
function CardBody(props) {
    const { state, t } = props;
    const fields = CREDENTIAL_REFS.map((ref) => {
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
    });
    return (0, react_1.createElement)(dsh_client_ui_primitives_1.SettingsForm, {
        labels: {
            unavailable: t('unavailable'),
            readOnly: t('readOnly'),
            saveFailed: t('saveFailed'),
            save: t('save'),
            saving: t('saving'),
        },
        state: {
            available: state.ready,
            writable: true,
            dirty: state.dirty,
            invalid: false,
            saving: state.saving,
            failed: state.failed,
        },
        onSave: props.onSave,
        onDiscard: props.onDiscard,
        children: fields,
    });
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
 * Service keys the card consumes. Cordis strict-injection guards every context
 * property: accessing `ctx.locale` without declaring it here throws
 * "cannot get property ... without inject" before `apply` runs. The remote is
 * declared twice — the service and its `credentials` namespace — per the
 * `remote` + `remote.<namespace>` client convention.
 */
exports.inject = ['locale', 'slots', 'remote', 'remote.credentials'];
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
    // Read first, then register: the inject face is read the moment the slot
    // injects, so the snapshot it hands out must already be materialized. The
    // Host may not serve the Remote yet when the page mounts, so an unanswered
    // describe retries with backoff instead of leaving the form disabled.
    card.effect(() => {
        let disposed = false;
        let timer;
        const attempt = (retries) => {
            void store.load().then((landed) => {
                if (disposed || landed || retries >= DESCRIBE_RETRY_DELAYS_MS.length)
                    return;
                timer = setTimeout(() => attempt(retries + 1), DESCRIBE_RETRY_DELAYS_MS[retries]);
            });
        };
        attempt(0);
        return () => {
            disposed = true;
            if (timer !== undefined)
                clearTimeout(timer);
        };
    }, 'websearch-stack: initial describe');
    // A reconnect re-serves the Host's Remote, so re-read the facts the drop
    // may have outdated; retries alone stop once the first answer lands.
    card.effect(() => card.on?.('connection/reset', () => {
        void store.load();
    }), 'websearch-stack: reload after reconnect');
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
