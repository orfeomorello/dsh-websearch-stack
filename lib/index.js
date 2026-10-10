import '@deepseek-ai/dsh-web';
import { Config as ConfigSchema } from "./config.js";
import { TavilyBackend } from "./backends/tavily.js";
import { ParallelMcpBackend } from "./backends/parallel-mcp.js";
import { SearxngBackend } from "./backends/searxng.js";
import { BraveBackend } from "./backends/brave.js";
import { TinyfishBackend } from "./backends/tinyfish.js";
import { ExaBackend } from "./backends/exa.js";
import { StackSearchProvider } from "./stack.js";
import { KEY_REFERENCES, KeyStore, REFERENCE_UPDATED_EVENT } from "./keys.js";
export const name = 'websearch-stack';
export const inject = ['web'];
export const Config = ConfigSchema;
/** The credential reference each key-backed backend resolves. */
const KEY_OF = {
    tavily: 'TAVILY_API_KEY',
    brave: 'BRAVE_SEARCH_API_KEY',
    tinyfish: 'TINYFISH_API_KEY',
    exa: 'EXA_API_KEY',
};
/**
 * Build the backend object for one identifier. Every option is a resolver, so
 * a config edit on the Plugins page or a key rotated in the credential store
 * lands on the next request rather than at the next boot.
 */
function makeBackend(id, config, keys) {
    const timeoutMs = () => config.default_timeout_ms.get();
    const limit = () => config.default_max_results.get();
    switch (id) {
        case 'tavily':
            return new TavilyBackend({ apiKey: () => keys.of(KEY_OF.tavily), timeoutMs, limit });
        case 'parallel-mcp':
            return new ParallelMcpBackend({ timeoutMs, limit });
        case 'searxng':
            return new SearxngBackend({ baseUrl: () => config.searxng_url.get(), timeoutMs, limit, language: 'en' });
        case 'brave':
            return new BraveBackend({ apiKey: () => keys.of(KEY_OF.brave), timeoutMs, limit });
        case 'tinyfish':
            return new TinyfishBackend({ apiKey: () => keys.of(KEY_OF.tinyfish), timeoutMs, limit });
        case 'exa':
            return new ExaBackend({ apiKey: () => keys.of(KEY_OF.exa), timeoutMs, limit });
    }
}
/**
 * Subscribe to a Host event whose name the installed cordis typings do not
 * carry: `credentials/reference-updated` and `loader/volatile-update` are
 * documented Host events, not core cordis ones.
 */
function onHostEvent(ctx, event, listener) {
    const on = ctx.on;
    return on(event, listener);
}
/**
 * Register the stack on `ctx.web`.
 *
 * The provider is registered once and always: `available()` answers for the
 * chain currently in force, so an empty list — or a chain whose keys are all
 * missing — makes the seam answer `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` (the
 * bundle patch pins `web.searchProvider` here), which is a louder and clearer
 * signal than silently handing `web_search` to another provider.
 *
 * Keys come from the Host credentials service when it is served, and from the
 * environment otherwise; the service is read through `ctx.get` so a deployment
 * without it still boots with environment keys alone.
 */
export function apply(ctx, config) {
    const credentials = ctx.get('credentials');
    const keys = new KeyStore(credentials);
    ctx.effect(() => {
        void keys.sync();
        return () => { };
    }, 'websearch-stack: initial credentials');
    // A key can be written from the settings card while this provider runs, so
    // re-resolve the reference the Host reports instead of waiting for a boot.
    ctx.effect(() => onHostEvent(ctx, REFERENCE_UPDATED_EVENT, (ref) => {
        if (typeof ref === 'string' && KEY_REFERENCES.includes(ref)) {
            void keys.refresh(ref);
        }
    }), 'websearch-stack: credential refresh');
    // Volatile config edits keep the plugin instance, so log the new chain: the
    // fallback order is the one thing a user cannot see from the outside.
    ctx.effect(() => onHostEvent(ctx, 'loader/volatile-update', () => {
        const chain = config.enabled_providers.get().join(' → ');
        ctx.logger('websearch-stack').info('fallback chain updated: %s', chain.length > 0 ? chain : '(none)');
    }), 'websearch-stack: volatile updates');
    ctx.web.registerSearchProvider(new StackSearchProvider(() => config.enabled_providers.get(), (id) => makeBackend(id, config, keys), () => config.cache_ttl_seconds.get()));
}
