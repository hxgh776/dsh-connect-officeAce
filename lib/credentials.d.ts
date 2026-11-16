/**
 * Where upstream access comes from.
 *
 * Three sources, in order:
 *
 * 1. **settings** — an explicit API key (bearer) entered in the DSH settings card;
 * 2. **env** — `DSH_OFFICEACE_API_KEY` (bearer);
 * 3. **local-session** — the OfficeAce account's own provider state, read from
 *    Windows Credential Manager (see `wincred.ts`). It yields the model gateway
 *    base URL plus the app-key pair the gateway accepts as HTTP Basic.
 *
 * The local-session path is the reason a user with the desktop app signed in
 * needs to type nothing. Resolution is cached briefly (60 s) so a settings page
 * poll does not spawn a PowerShell process per request; `invalidate()` drops the
 * cache after a settings change.
 *
 * Nothing here logs, stores, or returns a raw credential. `ResolvedAccess` is
 * process memory only, and the web routes never receive it.
 */
import type { LocalState } from "./types.js";
import { type LocalSessionReader } from "./wincred.js";
/** Environment variable a CI/headless setup can provide an explicit key through. */
export declare const API_KEY_ENV = "DSH_OFFICEACE_API_KEY";
/**
 * Debug/diagnostic override: point at an already-decoded provider-state JSON
 * file instead of reading Credential Manager. Used by the offline test harness
 * and by `probe` on machines where spawning a child process is not allowed.
 * It is NOT a production credential source — the file would contain tokens.
 */
export declare const PROVIDER_STATE_FILE_ENV = "DSH_OFFICEACE_PROVIDER_STATE_FILE";
export type CredentialSource = "settings" | "env" | "local-session";
export type UpstreamAuth = {
    kind: "bearer";
    token: string;
    source: "settings" | "env";
} | {
    kind: "basic";
    appKey: string;
    appSecret: string;
    source: "local-session";
};
/** What the upstream needs: an auth header value and a `/v1` base. */
export interface ResolvedAccess {
    auth: UpstreamAuth;
    /** Base URL WITHOUT a trailing slash; includes the gateway's `/v1`. */
    baseUrl: string;
    gatewayHost?: string;
    expiresAt?: string;
}
export interface CredentialState {
    configured: boolean;
    source: CredentialSource | null;
    message: string | null;
    baseUrl?: string;
}
/** The explanation shown when nothing could be resolved. */
export declare const MISSING_CREDENTIAL_MESSAGE = "\u6CA1\u6709\u53EF\u7528\u7684\u4E0A\u6E38\u51ED\u636E\uFF1A\u8BBE\u7F6E\u91CC\u6CA1\u6709 API Key\u3001\u73AF\u5883\u53D8\u91CF DSH_OFFICEACE_API_KEY \u672A\u8BBE\u7F6E\uFF0C\u4E14\u65E0\u6CD5\u4ECE\u672C\u673A OfficeAce \u767B\u5F55\u6001\u89E3\u6790\u6A21\u578B\u7F51\u5173\u3002\u8BF7\u786E\u8BA4 OfficeAce \u5DF2\u767B\u5F55\uFF0C\u6216\u5728 DSH \u8BBE\u7F6E \u2192 OfficeAce \u4E2D\u586B\u5199 API Key\u3002";
/** Where the token actually is, spelled out for the doctor/status view. */
export declare function tokenLocationOf(providerStateRef: string | undefined): string;
export interface AccessResolverOptions {
    /** Live persisted settings. */
    settings: () => {
        apiKey?: string;
        baseUrl?: string;
    };
    env?: NodeJS.ProcessEnv;
    /** Read OfficeAce's local store to find the account's `providerStateRef`. */
    readLocalState?: () => LocalState;
    /** Injectable provider-state reader (tests). */
    localReader?: LocalSessionReader;
    ttlMs?: number;
    now?: () => number;
}
export declare class AccessResolver {
    private readonly options;
    private readonly env;
    private readonly ttlMs;
    private readonly now;
    private readonly reader;
    private cached;
    constructor(options: AccessResolverOptions);
    /** Drop the cache so the next resolve re-reads everything. */
    invalidate(): void;
    /** The last resolved access, when still fresh — never triggers I/O. */
    peek(): ResolvedAccess | undefined;
    resolve(): Promise<ResolvedAccess>;
    /** Allow-listed status for the settings card / doctor. */
    status(): Promise<CredentialState>;
    private gateway;
    private gatewayFromFile;
    private resolveUncached;
}
/** Convenience for one-off callers (doctor / probe). */
export declare function createAccessResolver(options: AccessResolverOptions): AccessResolver;
