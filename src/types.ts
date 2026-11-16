/**
 * Shared shapes.
 *
 * Everything here mirrors data this plugin actually reads or writes:
 *
 * - `OfficeAceSessionRecord` — one row of OfficeAce's own local key-value store
 *   (`data/storage.sqlite`, table `oc_kv_string`, key
 *   `office-claw:oc:session:user:<org>:<user>`). Field names and value shapes
 *   were read from a real 1.8.1 install; see docs/protocol.md.
 * - `OfficeAceApiLease` — the same store's
 *   `office-claw:runtime:api-instance-lease:v1` row, which describes the local
 *   API server the desktop app runs.
 * - The rest is this plugin's own contract.
 */

/** One signed-in OfficeAce account, as OfficeAce itself persists it. */
export interface OfficeAceSessionRecord {
	/** Server-side session id (`office-claw:oc:session:id:<id>` names the same record). */
	sessionId: string;
	/** Identity provider id — `huawei-oauth` on the verified install. */
	providerId: string;
	/** `<orgId>:<userId>` (both 32-hex). Never log this in full. */
	userId: string;
	displayName?: string;
	createdAt?: string;
	lastSeenAt?: string;
	/** ISO timestamp. */
	expiresAt?: string;
	accountMode?: string;
	needsReauth: boolean;
	/**
	 * Where the oauth tokens live. Verified value on 1.8.1:
	 * `wincred://OfficeAce/auth-sessions/<provider>/<org>:<user>/provider-state`
	 * — i.e. Windows Credential Manager, not a plaintext file.
	 */
	providerStateRef?: string;
}

/** The local API server instance lease the desktop app writes. */
export interface OfficeAceApiLease {
	token: string;
	instanceId?: string;
	apiPort?: number;
	pid?: number;
	appVersion?: string;
	startedAt?: number;
}

/** A model row normalized to what a completed picker needs. */
export interface OfficeAceModelRow {
	id: string;
	name: string;
	/** Positive integer; DSH rejects a provider if any row lacks one. */
	contextWindow: number;
	maxTokens?: number;
	inputModalities: ("text" | "image")[];
	created: number;
	ownedBy: string;
	reasoning: boolean;
}

/** Fallbacks applied when the discovery endpoint omits a field. */
export interface ModelDefaults {
	/** NOT verified for OfficeAce — see docs/protocol.md. Configurable on purpose. */
	contextWindow: number;
	maxTokens: number;
}

/** A usable upstream credential. */
export interface OfficeAceCredential {
	apiKey: string;
	source: "settings" | "env";
}

/** The plugin's own persisted settings subset. */
export interface OfficeAceSettings {
	enabledModelIds?: string[];
	apiKey?: string;
	baseUrl?: string;
	installRoot?: string;
	defaultContextWindow?: number;
}

/** Result of reading OfficeAce's local store. */
export interface LocalState {
	/** Absolute path the read targeted, when one could be resolved. */
	databasePath: string | undefined;
	/** Whether the database could be opened and queried. */
	available: boolean;
	/** Stable machine-readable failure tag (`not_found`, `open_failed`, ...). */
	error?: string;
	errorDetail?: string;
	session?: OfficeAceSessionRecord;
	lease?: OfficeAceApiLease;
}
