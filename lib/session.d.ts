/**
 * The OfficeAce session record: parsing, expiry, and the redacted view.
 *
 * OfficeAce persists one JSON object per signed-in account. Verified shape on
 * 1.8.1 (values elided):
 *
 * ```json
 * {"sessionId":"<uuid>","providerId":"huawei-oauth",
 *  "userId":"<orgId>:<userId>","displayName":"<name>",
 *  "createdAt":"<iso>","lastSeenAt":"<iso>","expiresAt":"<iso>",
 *  "persist":true,"accountMode":"personal","needsReauth":false,
 *  "providerStateRef":"wincred://OfficeAce/auth-sessions/..."}
 * ```
 *
 * This module never sees the tokens themselves — OfficeAce keeps those in
 * Windows Credential Manager behind that `providerStateRef`.
 */
import type { OfficeAceSessionRecord } from "./types.js";
/** Parse one raw `oc_kv_string.value`, or `undefined` when it is not a session. */
export declare function parseSessionRecord(raw: string): OfficeAceSessionRecord | undefined;
/** Epoch ms of `expiresAt`, or `undefined` when absent/unparseable. */
export declare function expiryMsOf(record: OfficeAceSessionRecord): number | undefined;
/**
 * Whether the record is unusable at `now`.
 *
 * An absent `expiresAt` is NOT treated as expired: OfficeAce's own UI decides
 * that, and claiming expiry we cannot prove would wrongly disable a valid login.
 */
export declare function isSessionExpired(record: OfficeAceSessionRecord, now?: number): boolean;
/** `<first 6 chars>…` — enough to tell two accounts apart, useless as an id. */
export declare function shortId(value: string): string;
/**
 * Redact `<orgId>:<userId>` into a display label.
 *
 * Both halves are 32-hex account identifiers; logging either in full is a
 * privacy leak, so the view keeps six characters per half at most.
 */
export declare function redactAccountId(userId: string): string;
/** The route/card-safe view. Contains no token, no full id, no raw path. */
export interface SessionView {
    signedIn: boolean;
    expired: boolean;
    needsReauth: boolean;
    account: string | null;
    providerId: string | null;
    providerStateRefScheme: string | null;
    createdAt: string | null;
    lastSeenAt: string | null;
    expiresAt: string | null;
    accountMode: string | null;
}
export declare function sessionViewOf(record: OfficeAceSessionRecord | undefined, now?: number): SessionView;
