import type { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/dsh-web';
import { type StackConfig } from './config.js';
export declare const name = "websearch-stack";
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<StackConfig>;
/**
 * Register the stack on `ctx.web`. The provider is registered only when at least one
 * backend is enabled: an empty `enabled_providers` leaves `web_search` to the host.
 * Registration is effect-scoped, so disposing the fiber removes the provider.
 */
export declare function apply(ctx: Context, config: StackConfig): void;
