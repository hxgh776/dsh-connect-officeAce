/**
 * The loopback shim: the HTTP surface pi-ai talks to.
 *
 * `http://127.0.0.1:<ephemeral>/v1` with a per-process bearer secret. DSH's
 * pi-ai provider sends OpenAI-shaped requests; the shim forwards them to the
 * OfficeAce upstream with the configured credential and pipes the response
 * straight back — the upstream is OpenAI-compatible, so tools, reasoning deltas
 * and usage chunks pass through untouched.
 *
 * Hardening follows the two reference plugins:
 * - ephemeral port bound to 127.0.0.1 only;
 * - a per-process secret compared with `timingSafeEqual`, length-checked first;
 * - Host must be loopback, browser Origin (when present) must be loopback;
 * - JSON body cap 64 MB (vision requests carry base64 images);
 * - nothing secret ever enters a response body.
 */
import type { OfficeAceModelRow } from "./types.js";
import type { OfficeAceUpstream } from "./upstream.js";
export interface ShimOptions {
    upstream: OfficeAceUpstream;
    /** Live normalized rows; `undefined` means "not discovered yet". */
    modelsProvider: () => OfficeAceModelRow[] | undefined;
    /** Slowest tolerated stream silence, overridable for tests. */
    streamIdleTimeoutMs?: number;
    /** Body cap, overridable for tests. */
    bodyLimit?: number;
}
export interface Shim {
    /** Resolves once the socket is listening; rejects on bind failure. */
    ready: Promise<void>;
    /** The per-process bearer secret pi-ai sends as its apiKey. */
    token(): string;
    /** `http://127.0.0.1:<port>`; throws before the socket listens. */
    baseUrl(): string;
    /** The same origin, or `undefined` before listening (sync callers). */
    baseUrlSync(): string | undefined;
    close(): void;
}
export declare function createShim(options: ShimOptions): Shim;
