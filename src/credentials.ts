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

import { readFileSync } from "node:fs";
import { OfficeAceError } from "./errors.js";
import type { LocalState } from "./types.js";
import {
	createLocalSessionReader,
	modelGatewayOf,
	parseProviderState,
	type LocalSessionReader,
	type ModelGateway,
} from "./wincred.js";

/** Environment variable a CI/headless setup can provide an explicit key through. */
export const API_KEY_ENV = "DSH_OFFICEACE_API_KEY";

/**
 * Debug/diagnostic override: point at an already-decoded provider-state JSON
 * file instead of reading Credential Manager. Used by the offline test harness
 * and by `probe` on machines where spawning a child process is not allowed.
 * It is NOT a production credential source — the file would contain tokens.
 */
export const PROVIDER_STATE_FILE_ENV = "DSH_OFFICEACE_PROVIDER_STATE_FILE";

export type CredentialSource = "settings" | "env" | "local-session";

export type UpstreamAuth =
	| { kind: "bearer"; token: string; source: "settings" | "env" }
	| { kind: "basic"; appKey: string; appSecret: string; source: "local-session" };

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
export const MISSING_CREDENTIAL_MESSAGE =
	"没有可用的上游凭据：设置里没有 API Key、环境变量 DSH_OFFICEACE_API_KEY 未设置，且无法从本机 OfficeAce 登录态解析模型网关。请确认 OfficeAce 已登录，或在 DSH 设置 → OfficeAce 中填写 API Key。";

/** Where the token actually is, spelled out for the doctor/status view. */
export function tokenLocationOf(providerStateRef: string | undefined): string {
	if (providerStateRef !== undefined) return providerStateRef;
	return "wincred://OfficeAce/auth-sessions/…";
}

export interface AccessResolverOptions {
	/** Live persisted settings. */
	settings: () => { apiKey?: string; baseUrl?: string };
	env?: NodeJS.ProcessEnv;
	/** Read OfficeAce's local store to find the account's `providerStateRef`. */
	readLocalState?: () => LocalState;
	/** Injectable provider-state reader (tests). */
	localReader?: LocalSessionReader;
	ttlMs?: number;
	now?: () => number;
}

function trimSlashes(value: string): string {
	return value.trim().replace(/\/+$/u, "");
}

/** One gateway state → the resolver's access shape. */
function accessOfGateway(gateway: ModelGateway, overrideBaseUrl: string): ResolvedAccess {
	return {
		auth: { kind: "basic", appKey: gateway.appKey, appSecret: gateway.appSecret, source: "local-session" },
		baseUrl: overrideBaseUrl !== "" ? overrideBaseUrl : gateway.baseUrl,
		gatewayHost: gateway.host,
		expiresAt: gateway.expiresAt,
	};
}

export class AccessResolver {
	private readonly options: AccessResolverOptions;
	private readonly env: NodeJS.ProcessEnv;
	private readonly ttlMs: number;
	private readonly now: () => number;
	private readonly reader: LocalSessionReader;
	private cached:
		| { at: number; value?: ResolvedAccess; error?: string }
		| undefined;

	constructor(options: AccessResolverOptions) {
		this.options = options;
		this.env = options.env ?? process.env;
		this.ttlMs = options.ttlMs ?? 60_000;
		this.now = options.now ?? Date.now;
		this.reader = options.localReader ?? createLocalSessionReader();
	}

	/** Drop the cache so the next resolve re-reads everything. */
	invalidate(): void {
		this.cached = undefined;
	}

	/** The last resolved access, when still fresh — never triggers I/O. */
	peek(): ResolvedAccess | undefined {
		if (this.cached === undefined) return undefined;
		if (this.now() - this.cached.at >= this.ttlMs) return undefined;
		return this.cached.value;
	}

	async resolve(): Promise<ResolvedAccess> {
		const cached = this.cached;
		if (cached !== undefined && this.now() - cached.at < this.ttlMs) {
			if (cached.value !== undefined) return cached.value;
			throw new OfficeAceError(cached.error ?? MISSING_CREDENTIAL_MESSAGE, "not_signed_in");
		}

		try {
			const value = await this.resolveUncached();
			this.cached = { at: this.now(), value };
			return value;
		} catch (error) {
			const message = error instanceof Error ? error.message : MISSING_CREDENTIAL_MESSAGE;
			this.cached = { at: this.now(), error: message };
			if (error instanceof OfficeAceError) throw error;
			throw new OfficeAceError(message.slice(0, 200), "not_signed_in", { cause: error });
		}
	}

	/** Allow-listed status for the settings card / doctor. */
	async status(): Promise<CredentialState> {
		try {
			const access = await this.resolve();
			return {
				configured: true,
				source: access.auth.source,
				message: null,
				baseUrl: access.baseUrl,
			};
		} catch (error) {
			return {
				configured: false,
				source: null,
				message: error instanceof Error ? error.message : MISSING_CREDENTIAL_MESSAGE,
			};
		}
	}

	private async gateway(): Promise<{ gateway?: ModelGateway; error?: string }> {
		const file = String(this.env[PROVIDER_STATE_FILE_ENV] ?? "").trim();
		if (file !== "") return { gateway: await this.gatewayFromFile(file) };
		const localState = this.options.readLocalState?.();
		const ref = localState?.session?.providerStateRef;
		try {
			const result = await this.reader.read(ref);
			if (result.ok) return { gateway: result.gateway };
			return {
				error: result.detail === undefined ? result.error : `${result.error}: ${result.detail}`,
			};
		} catch (error) {
			return { error: error instanceof Error ? error.message.slice(0, 80) : "read_failed" };
		}
	}

	private async gatewayFromFile(path: string): Promise<ModelGateway | undefined> {
		try {
			const text = readFileSync(path, "utf8");
			return modelGatewayOf(parseProviderState(text));
		} catch {
			return undefined;
		}
	}

	private async resolveUncached(): Promise<ResolvedAccess> {
		const settings = this.options.settings();
		const overrideBaseUrl = trimSlashes(String(settings.baseUrl ?? ""));
		const local = await this.gateway();
		const gateway = local.gateway;

		const settingsKey = String(settings.apiKey ?? "").trim();
		if (settingsKey !== "") {
			return {
				auth: { kind: "bearer", token: settingsKey, source: "settings" },
				baseUrl: overrideBaseUrl !== "" ? overrideBaseUrl : (gateway?.baseUrl ?? ""),
				gatewayHost: gateway?.host,
			};
		}

		const envKey = String(this.env[API_KEY_ENV] ?? "").trim();
		if (envKey !== "") {
			return {
				auth: { kind: "bearer", token: envKey, source: "env" },
				baseUrl: overrideBaseUrl !== "" ? overrideBaseUrl : (gateway?.baseUrl ?? ""),
				gatewayHost: gateway?.host,
			};
		}

		if (gateway !== undefined) return accessOfGateway(gateway, overrideBaseUrl);

		const suffix = local.error === undefined ? "" : `（读取本机登录态失败：${local.error}）`;
		throw new OfficeAceError(MISSING_CREDENTIAL_MESSAGE + suffix, "not_signed_in");
	}
}

/** Convenience for one-off callers (doctor / probe). */
export function createAccessResolver(options: AccessResolverOptions): AccessResolver {
	return new AccessResolver(options);
}
