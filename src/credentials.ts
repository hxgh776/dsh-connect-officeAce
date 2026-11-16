/**
 * Where the upstream credential comes from — and where it does not.
 *
 * Verified fact about OfficeAce 1.8.1: the account's oauth tokens are NOT in a
 * readable file. The local store's session row carries
 * `providerStateRef: "wincred://OfficeAce/auth-sessions/<provider>/<org>:<user>/provider-state"`,
 * i.e. the tokens live in Windows Credential Manager, reachable only through
 * DPAPI/native credential APIs. There is a DPAPI-wrapped encrypt key next to an
 * AES-256-GCM `oauth-*.json` profile in `packages/api/.config`, but it protects
 * a different record and the key itself needs DPAPI to unwrap.
 *
 * This plugin therefore does NOT pretend to "reuse the local login". It reads
 * the session record to tell the user who is signed in and when it expires, and
 * it takes the model credential from the plugin's own settings or an
 * environment variable. Anything else would be a fabricated capability.
 */

import { OfficeAceError } from "./errors.js";
import type { OfficeAceCredential, OfficeAceSessionRecord } from "./types.js";

/** Environment variable a CI/headless setup can provide the key through. */
export const API_KEY_ENV = "DSH_OFFICEACE_API_KEY";

export interface CredentialState {
	configured: boolean;
	source: "settings" | "env" | null;
	/** Human-readable explanation when `configured` is false. */
	message: string | null;
}

/** The explanation shown everywhere the key is missing. */
export const MISSING_CREDENTIAL_MESSAGE =
	"未配置上游 API Key。OfficeAce 的登录 token 存放在 Windows 凭据管理器（wincred://）中，本插件尚未实现读取；请在 DSH 设置 → OfficeAce 中填写 API Key，或设置环境变量 DSH_OFFICEACE_API_KEY。";

/** Where the token actually is, spelled out for the doctor/status view. */
export function tokenLocationOf(record: OfficeAceSessionRecord | undefined): string {
	if (record?.providerStateRef !== undefined) return record.providerStateRef;
	return "wincred://OfficeAce/auth-sessions/…";
}

export function credentialState(
	settings: { apiKey?: string } | undefined,
	env: NodeJS.ProcessEnv = process.env,
): CredentialState {
	const fromSettings = String(settings?.apiKey ?? "").trim();
	if (fromSettings !== "") return { configured: true, source: "settings", message: null };
	const fromEnv = String(env[API_KEY_ENV] ?? "").trim();
	if (fromEnv !== "") return { configured: true, source: "env", message: null };
	return { configured: false, source: null, message: MISSING_CREDENTIAL_MESSAGE };
}

/**
 * Resolve the upstream credential, or throw with an actionable message.
 *
 * Settings win over the environment so a card-entered key can override a stale
 * shell export.
 */
export function resolveCredential(
	settings: { apiKey?: string } | undefined,
	env: NodeJS.ProcessEnv = process.env,
): OfficeAceCredential {
	const fromSettings = String(settings?.apiKey ?? "").trim();
	if (fromSettings !== "") return { apiKey: fromSettings, source: "settings" };
	const fromEnv = String(env[API_KEY_ENV] ?? "").trim();
	if (fromEnv !== "") return { apiKey: fromEnv, source: "env" };
	throw new OfficeAceError(MISSING_CREDENTIAL_MESSAGE, "not_signed_in");
}
