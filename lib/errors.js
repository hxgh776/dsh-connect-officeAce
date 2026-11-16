/**
 * The one error type every OfficeAce failure in this plugin carries.
 *
 * `kind` is what the loopback shim maps to an HTTP status and what the settings
 * card renders as a state; the message is always safe to display (it never
 * contains a token or a full account id).
 */
export class OfficeAceError extends Error {
    kind;
    httpStatus;
    cause;
    constructor(message, kind, meta = {}) {
        super(message);
        this.name = "OfficeAceError";
        this.kind = kind;
        this.httpStatus = meta.httpStatus;
        this.cause = meta.cause;
    }
}
/** Truncate any error into a route/log-safe string. */
export function safeMessage(error) {
    if (error instanceof Error)
        return error.message.slice(0, 200);
    return String(error ?? "unknown error").slice(0, 200);
}
/** True when the error is a deliberate abort (client closed, idle watchdog). */
export function isAbortError(error) {
    return (typeof error === "object" &&
        error !== null &&
        error.name === "AbortError");
}
