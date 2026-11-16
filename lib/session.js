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
/** Parse one raw `oc_kv_string.value`, or `undefined` when it is not a session. */
export function parseSessionRecord(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    if (typeof parsed !== "object" || parsed === null)
        return undefined;
    const row = parsed;
    const sessionId = str(row.sessionId);
    const providerId = str(row.providerId);
    const userId = str(row.userId);
    if (sessionId === undefined || providerId === undefined || userId === undefined)
        return undefined;
    return {
        sessionId,
        providerId,
        userId,
        displayName: str(row.displayName),
        createdAt: str(row.createdAt),
        lastSeenAt: str(row.lastSeenAt),
        expiresAt: str(row.expiresAt),
        accountMode: str(row.accountMode),
        needsReauth: row.needsReauth === true,
        providerStateRef: str(row.providerStateRef),
    };
}
function str(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
}
/** Epoch ms of `expiresAt`, or `undefined` when absent/unparseable. */
export function expiryMsOf(record) {
    if (record.expiresAt === undefined)
        return undefined;
    const ms = Date.parse(record.expiresAt);
    return Number.isFinite(ms) ? ms : undefined;
}
/**
 * Whether the record is unusable at `now`.
 *
 * An absent `expiresAt` is NOT treated as expired: OfficeAce's own UI decides
 * that, and claiming expiry we cannot prove would wrongly disable a valid login.
 */
export function isSessionExpired(record, now = Date.now()) {
    if (record.needsReauth)
        return true;
    const expires = expiryMsOf(record);
    return expires !== undefined && expires <= now;
}
/** `<first 6 chars>…` — enough to tell two accounts apart, useless as an id. */
export function shortId(value) {
    const trimmed = value.trim();
    if (trimmed === "")
        return "…";
    return trimmed.length <= 6 ? trimmed : `${trimmed.slice(0, 6)}…`;
}
/**
 * Redact `<orgId>:<userId>` into a display label.
 *
 * Both halves are 32-hex account identifiers; logging either in full is a
 * privacy leak, so the view keeps six characters per half at most.
 */
export function redactAccountId(userId) {
    const [org, user] = userId.split(":");
    if (user === undefined)
        return shortId(userId);
    return `${shortId(org ?? "")}:${shortId(user)}`;
}
export function sessionViewOf(record, now = Date.now()) {
    if (record === undefined) {
        return {
            signedIn: false,
            expired: false,
            needsReauth: false,
            account: null,
            providerId: null,
            providerStateRefScheme: null,
            createdAt: null,
            lastSeenAt: null,
            expiresAt: null,
            accountMode: null,
        };
    }
    return {
        signedIn: true,
        expired: isSessionExpired(record, now),
        needsReauth: record.needsReauth,
        account: redactAccountId(record.userId),
        providerId: record.providerId,
        providerStateRefScheme: schemeOf(record.providerStateRef),
        createdAt: record.createdAt ?? null,
        lastSeenAt: record.lastSeenAt ?? null,
        expiresAt: record.expiresAt ?? null,
        accountMode: record.accountMode ?? null,
    };
}
/** `wincred://...` → `wincred`; used to explain where the token actually is. */
function schemeOf(ref) {
    if (ref === undefined)
        return null;
    const index = ref.indexOf(":");
    return index === -1 ? null : ref.slice(0, index);
}
