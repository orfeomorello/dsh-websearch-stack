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
 * missing — leaves `web_search` to the host's own provider until the user
 * enables one on the Plugins page, with no reload in between.
 *
 * Keys come from the Host credentials service when it is served, and from the
 * environment otherwise; the service is read through `ctx.get` so a deployment
 * without it still boots with environment keys alone.
 */
export declare function apply(ctx: Context, config: StackConfig): void;
