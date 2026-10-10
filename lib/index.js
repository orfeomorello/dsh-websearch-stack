import '@deepseek-ai/dsh-web';
import { Config as ConfigSchema } from "./config.js";
import { TavilyBackend } from "./backends/tavily.js";
import { ParallelMcpBackend } from "./backends/parallel-mcp.js";
import { SearxngBackend } from "./backends/searxng.js";
import { BraveBackend } from "./backends/brave.js";
import { TinyfishBackend } from "./backends/tinyfish.js";
import { StackSearchProvider } from "./stack.js";
export const name = 'websearch-stack';
export const inject = ['web'];
export const Config = ConfigSchema;
/** Build the backend object for one identifier, with the plugin's shared options. */
function makeBackend(id, config) {
    switch (id) {
        case 'tavily':
            return new TavilyBackend({ apiKey: undefined, timeoutMs: config.default_timeout_ms });
        case 'parallel-mcp':
            return new ParallelMcpBackend({ timeoutMs: config.default_timeout_ms });
        case 'searxng':
            return new SearxngBackend({
                baseUrl: config.searxng_url,
                timeoutMs: config.default_timeout_ms,
                language: 'en',
            });
        case 'brave':
            return new BraveBackend({
                apiKey: process.env.BRAVE_SEARCH_API_KEY,
                timeoutMs: config.default_timeout_ms,
            });
        case 'tinyfish':
            return new TinyfishBackend({
                apiKey: process.env.TINYFISH_API_KEY,
                timeoutMs: config.default_timeout_ms,
            });
    }
}
/**
 * Register the stack on `ctx.web`. The provider is registered only when at least one
 * backend is enabled: an empty `enabled_providers` leaves `web_search` to the host.
 * Registration is effect-scoped, so disposing the fiber removes the provider.
 */
export function apply(ctx, config) {
    if (config.enabled_providers.length === 0)
        return;
    const chain = config.enabled_providers.map((id) => ({
        id,
        provider: makeBackend(id, config),
    }));
    ctx.web.registerSearchProvider(new StackSearchProvider(chain));
}
