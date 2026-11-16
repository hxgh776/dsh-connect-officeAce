/**
 * The pi-ai provider and its DSH adapter.
 *
 * Peer packages (`@earendil-works/pi-ai`, `@deepseek-ai/dsh-llm`,
 * `@deepseek-ai/dsh-llm-pi-ai`) resolve from the HOST at runtime and are never
 * bundled — same as the sibling plugins.
 *
 * The subtlety worth its own section is the pi-ai GENERATION boundary: the host
 * may resolve a 0.85.x (legacy `{systemPrompt, tools, messages}` context) or a
 * 0.86+/1.x (normalized transcript) copy, and a mismatch silently drops the
 * prompt and tools. Detection and both fold functions are adapted from
 * `dsh-connect-loomy` (which adapted them from `dsh-connect-trae`); on the
 * healthy path both wrappers are identities and cost one `Array.some`.
 */
import type { OfficeAceModelRow } from "./types.js";
export interface AdapterOptions {
    /** Live shim origin getter (the `.../v1` base). */
    baseUrl: () => string | undefined;
    /** Live normalized catalog rows. */
    modelsProvider: () => OfficeAceModelRow[];
    /** Shim bearer secret. */
    resolveToken: () => string;
    providerId?: string;
    displayName?: string;
}
export interface BuiltAdapter {
    adapter: any;
    provider: any;
    profile: any;
    generation: "legacy" | "modern";
}
export declare function createAdapter(options: AdapterOptions): BuiltAdapter;
