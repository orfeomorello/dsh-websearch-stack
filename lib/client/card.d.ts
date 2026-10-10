import type { Context as ClientContext } from '@deepseek-ai/cordis';
/** Dictionary namespace owned by this card. */
export declare const NS = "websearchStack";
/** Credential references the card manages, in display order. */
declare const CREDENTIAL_REFS: readonly ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "TINYFISH_API_KEY", "EXA_API_KEY"];
type CredentialRef = (typeof CREDENTIAL_REFS)[number];
/** Credential facts one control renders; never a value. */
interface KeyState {
    configured: boolean;
    writable: boolean;
}
/** Whole-card state the component reads and re-renders on. */
interface StackCardState {
    ready: boolean;
    dirty: boolean;
    failed: boolean;
    saving: boolean;
    keys: Partial<Record<CredentialRef, KeyState>>;
}
/** Minimal face of the `credentials` Remote namespace the card depends on. */
interface CredentialsRemote {
    describe(refs: readonly CredentialRef[]): Promise<Record<string, {
        configured: boolean;
        writable: boolean;
    }> | undefined>;
    set(ref: string, value: string): Promise<void>;
}
/**
 * Snapshot store behind the card: `getSnapshot`/`subscribe` is the shape the
 * slot machinery binds as a selector hook, so the framework re-renders the
 * card whenever the controller publishes.
 */
declare class StackCardStore {
    private snapshot;
    private readonly staged;
    private saving;
    private readonly listeners;
    private readonly credentials;
    constructor(credentials: CredentialsRemote);
    getSnapshot(): StackCardState;
    subscribe(listener: () => void): () => void;
    /** Fetch facts for every reference in one batched `describe`. */
    load(): Promise<void>;
    /** Re-read one reference after the Host reports it changed. */
    refresh(ref: CredentialRef): Promise<void>;
    /** Stage draft text; a blank draft means "no write on save". */
    edit(ref: CredentialRef, text: string): void;
    stagedOf(ref: CredentialRef): string;
    /** Write every staged key in order; a failed write keeps its draft. */
    save(): Promise<void>;
    /** Drop every staged edit. */
    discard(): void;
    /** Merge a partial state into the snapshot. */
    private patch;
    private publish;
}
/** Dictionary namespace owned by this card. */
export { NS as CARD_NS };
/**
 * Service keys the card consumes. Cordis strict-injection guards every context
 * property: accessing `ctx.locale` without declaring it here throws
 * "cannot get property ... without inject" before `apply` runs. The remote is
 * declared twice — the service and its `credentials` namespace — per the
 * `remote` + `remote.<namespace>` client convention.
 */
export declare const inject: readonly ["locale", "slots", "remote", "remote.credentials"];
/**
 * Mount the card while the Host serves its Remote. Registrations are
 * effect-scoped, so disposing the plugin's fiber removes the card.
 * @param ctx - the browser plugin context.
 */
export declare function apply(ctx: ClientContext): void;
/** Test-only re-export: reference order the card presents the controls in. */
export declare const CARD_CREDENTIAL_REFS: readonly ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "TINYFISH_API_KEY", "EXA_API_KEY"];
/** Mount-lifecycle helper for tests and hosts that render outside a slot. */
export declare function useCardLifecycle(store: StackCardStore): StackCardState;
