/**
 * The one error type every OfficeAce failure in this plugin carries.
 *
 * `kind` is what the loopback shim maps to an HTTP status and what the settings
 * card renders as a state; the message is always safe to display (it never
 * contains a token or a full account id).
 */

export type OfficeAceErrorKind =
	/** No upstream credential is configured, and none could be read. */
	| "not_signed_in"
	/** The upstream rejected the credential. */
	| "session_dead"
	| "network"
	| "upstream"
	| "client"
	| "rate_limited"
	/**
	 * A capability OfficeAce has but this plugin does not implement. Telling the
	 * user this is honest; pretending it works is not.
	 */
	| "unsupported";

export interface OfficeAceErrorMeta {
	httpStatus?: number;
	cause?: unknown;
}

export class OfficeAceError extends Error {
	readonly kind: OfficeAceErrorKind;
	readonly httpStatus: number | undefined;
	readonly cause: unknown;

	constructor(message: string, kind: OfficeAceErrorKind, meta: OfficeAceErrorMeta = {}) {
		super(message);
		this.name = "OfficeAceError";
		this.kind = kind;
		this.httpStatus = meta.httpStatus;
		this.cause = meta.cause;
	}
}

/** Truncate any error into a route/log-safe string. */
export function safeMessage(error: unknown): string {
	if (error instanceof Error) return error.message.slice(0, 200);
	return String(error ?? "unknown error").slice(0, 200);
}

/** True when the error is a deliberate abort (client closed, idle watchdog). */
export function isAbortError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { name?: unknown }).name === "AbortError"
	);
}
