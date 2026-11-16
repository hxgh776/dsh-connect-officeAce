/**
 * Reading OfficeAce's provider state out of Windows Credential Manager.
 *
 * OfficeAce stores the account's oauth/provider state as a "manifest" credential
 * plus N chunk credentials, all in the user's Windows Credential Manager
 * (`wincred://OfficeAce/auth-sessions/<provider>/<org>:<user>/provider-state`):
 *
 *   <target>                  UTF-16LE JSON  {schemaVersion, encoding:"base64",
 *                                              storageId, chunkCount}
 *   <target>/chunks/<id>/<n>  UTF-16LE text   one segment of the base64 payload
 *
 * Concatenating the chunks in index order and base64-decoding yields the
 * plaintext provider-state JSON (verified on OfficeAce 1.8.1 — see
 * docs/protocol.md §1.3). `CredRead` itself does the DPAPI decryption; this
 * module never touches DPAPI or a native addon.
 *
 * Transport is a short-lived PowerShell child process, because Node has no
 * built-in credential API. The constraint the plugin keeps:
 *
 * - READ ONLY: only `CredRead`, never `CredWrite`/`CredDelete`;
 * - nothing is written to disk by this module;
 * - only the decoded JSON is handed back, and it never enters a log line, a
 *   web route response, or an error message.
 */
/** The manifest's decoded shape. */
export interface WincredManifest {
    schemaVersion: number;
    encoding: "base64";
    storageId: string;
    chunkCount: number;
}
/** A model gateway resolved from the provider state. */
export interface ModelGateway {
    /** `https://<host>/v1` — the OpenAI-compatible base the gateway serves. */
    baseUrl: string;
    host: string;
    appKey: string;
    appSecret: string;
    accountId?: string;
    userName?: string;
    /** ISO timestamp of the STS credential, when the record carries one. */
    expiresAt?: string;
}
/** Loose shape of the decoded provider state; unknown fields are ignored. */
export interface ProviderStateDocument {
    schemaVersion?: number;
    providerState?: {
        authType?: string;
        accountId?: string;
        user_id?: string;
        userName?: string;
        modelInfo?: {
            model_api_url_base?: string;
            model_auth_info?: {
                model_app_key?: string;
                model_app_secret?: string;
            };
        };
        credential?: {
            expires_at?: string;
        };
        credentialV3?: {
            expires_at?: string;
        };
        [key: string]: unknown;
    };
}
/** One transport result. `stdout` carries the JSON envelope, nothing else. */
export interface ExecOutput {
    ok: boolean;
    stdout: string;
    error?: string;
}
export type ExecFn = (encodedCommand: string) => Promise<ExecOutput>;
export type LocalSessionResult = {
    ok: true;
    gateway: ModelGateway;
} | {
    ok: false;
    error: string;
    detail?: string;
};
/** `wincred://OfficeAce/...` → `OfficeAce/...` (the Credential Manager target). */
export declare function wincredTargetOf(providerStateRef: string | undefined): string | undefined;
/** Parse the manifest text (a JSON object) or reject it. */
export declare function parseManifest(text: string): WincredManifest | undefined;
/**
 * Concatenate the chunk texts and base64-decode the result.
 *
 * @throws when the payload is not valid base64
 */
export declare function decodeProviderStateText(chunks: readonly string[]): string;
/** Parse the decoded provider state document. */
export declare function parseProviderState(text: string): ProviderStateDocument | undefined;
/**
 * Extract the model gateway from a provider state.
 *
 * Verified fields on OfficeAce 1.8.1:
 * `providerState.modelInfo.model_api_url_base` is a host (no scheme) and
 * `modelInfo.model_auth_info.model_app_key` / `model_app_secret` are the
 * app-key pair the gateway accepts (HTTP Basic). The gateway serves the
 * OpenAI-compatible API under `/v1`.
 */
export declare function modelGatewayOf(doc: ProviderStateDocument | undefined): ModelGateway | undefined;
/** The exact PowerShell program one read runs (exposed for diagnostics/tests). */
export declare function buildReadScript(credentialTarget: string): string;
export interface LocalSessionReaderOptions {
    /** Injectable transport (tests). */
    exec?: ExecFn;
}
/**
 * Create the provider-state reader.
 *
 * The returned `read` takes the `providerStateRef` recorded in OfficeAce's local
 * store and resolves it to the model gateway. It never throws for a missing or
 * unreadable credential — the caller decides what to render.
 */
export declare function createLocalSessionReader(options?: LocalSessionReaderOptions): {
    read: (providerStateRef: string | undefined) => Promise<LocalSessionResult>;
};
export type LocalSessionReader = ReturnType<typeof createLocalSessionReader>;
