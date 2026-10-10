import type { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/dsh-web';
import { type StackConfig } from './config.js';
export declare const name = "websearch-stack";
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<StackConfig>;
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
export declare function apply(ctx: Context, config: StackConfig): void;
