/**
 * The upstream: OfficeAce's model gateway, OpenAI-compatible.
 *
 * What is VERIFIED end-to-end against a signed-in OfficeAce 1.8.1 account
 * (docs/protocol.md §2):
 *
 * - base: `https://<modelInfo.model_api_url_base>/v1`
 * - `GET  /v1/models`            200, `{object:"list", data:[{id, object, created, owned_by}]}`
 * - `POST /v1/chat/completions`  200, SSE with `delta.reasoning_content`,
 *   `delta.tool_calls`, a usage chunk and `data: [DONE]`
 * - auth: HTTP Basic `<model_app_key>:<model_app_secret>`
 *
 * `model_app_key` / `model_app_secret` and the host come from the account's
 * provider state, not from a constant. An explicit API key (settings or
 * `DSH_OFFICEACE_API_KEY`) switches the transport to bearer instead.
 *
 * This module is transport only: no retries, no caches beyond the resolver's,
 * and no logging of the credential.
 */
import { OfficeAceError } from "./errors.js";
import type { ResolvedAccess } from "./credentials.js";
export interface UpstreamOptions {
    /** Resolves auth + base per call (cached by `AccessResolver`). */
    access: () => Promise<ResolvedAccess>;
    /** Per-request timeout for non-stream calls. */
    timeoutMs?: number;
    /** Injectable for tests; defaults to the global fetch. */
    fetchImpl?: typeof fetch;
}
/** Build the Authorization header value for a resolved access. */
export declare function authorizationOf(access: ResolvedAccess): string;
/** Map an HTTP failure onto the plugin's error kinds. */
export declare function classifyFailure(httpStatus: number, message: string): OfficeAceError;
/**
 * Whether a failure means "this account cannot call this model" rather than a
 * stale credential or a broken gateway. The gateway lists chat ids the account
 * is not entitled to, so this is a routine outcome: the user needs an
 * actionable hint, not the raw envelope.
 */
export declare function isModelUnavailable(httpStatus: number, message: string): boolean;
/** Pull a human-usable message out of an OpenAI/APIG error body. */
export declare function errorMessageOf(raw: string): string;
export declare class OfficeAceUpstream {
    private readonly access;
    private readonly timeoutMs;
    private readonly fetchImpl;
    constructor(options: UpstreamOptions);
    /** The effective `/v1` base (no trailing slash). Throws without a credential. */
    baseUrl(): Promise<string>;
    /** Headers for one request. NEVER logged. */
    headers(stream?: boolean): Promise<Record<string, string>>;
    /** The model catalog: `data[]` (ids only — no context lengths, verified). */
    listModels(signal?: AbortSignal): Promise<unknown[]>;
    /**
     * POST one chat completion and hand back the raw response.
     *
     * The body is the OpenAI chat-completions shape DSH/pi-ai already builds, so
     * the shim forwards it after replacing only the credential.
     */
    chatCompletion(body: unknown, options?: {
        signal?: AbortSignal;
    }): Promise<Response>;
}
