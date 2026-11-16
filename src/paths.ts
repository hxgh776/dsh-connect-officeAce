/**
 * On-disk locations, as verified on a real OfficeAce 1.8.1 (Windows x64) install.
 *
 * Evidence (see docs/protocol.md §1–2):
 *
 * - The app installs to `%LOCALAPPDATA%\Programs\OfficeAce`
 *   (registry `HKCU\...\Uninstall\OfficeAce`: DisplayName "OfficeAce",
 *   DisplayVersion 1.8.1, Publisher "Huawei Cloud", InstallLocation as above).
 * - Its local state lives at `<install>\data\storage.sqlite`, a key-value store
 *   (`oc_kv_string`) that the bundled `@openjiuwen/relay-api-server` writes.
 * - The signed-in account is the `oc_kv_string` row whose key starts with
 *   `office-claw:oc:session:user:`.
 *
 * There is deliberately no per-user hash derivation here (unlike Loomy): the
 * OfficeAce store sits in the installation directory, and the account id is a
 * value inside the store, not part of the path.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The directory name under `%LOCALAPPDATA%\Programs` and `%ProgramFiles%`. */
export const APP_DIRNAME = "OfficeAce";

/** State directory name inside the installation root. */
export const DATA_DIRNAME = "data";

/** The local key-value database. */
export const STORAGE_DB_FILENAME = "storage.sqlite";

/** Key prefix of the per-user session row (appends `<orgId>:<userId>`). */
export const SESSION_USER_KEY_PREFIX = "office-claw:oc:session:user:";

/** Key prefix of the by-session-id copy of the same record. */
export const SESSION_ID_KEY_PREFIX = "office-claw:oc:session:id:";

/** Exact key of the local API server lease row. */
export const API_LEASE_KEY = "office-claw:runtime:api-instance-lease:v1";

/** Environment override used by CI / headless probes. */
export const APP_ROOT_ENV = "DSH_OFFICEACE_APP_ROOT";

function envPath(name: string): string | undefined {
	const value = String(process.env[name] ?? "").trim();
	return value === "" ? undefined : value;
}

/** Candidate installation roots, most specific first. May not exist. */
export function installRootCandidates(explicit = ""): string[] {
	const candidates: string[] = [];
	const push = (value: string | undefined): void => {
		if (value === undefined) return;
		const trimmed = value.trim().replace(/[\\/]+$/, "");
		if (trimmed !== "" && !candidates.includes(trimmed)) candidates.push(trimmed);
	};

	push(String(explicit ?? ""));
	push(envPath(APP_ROOT_ENV));
	const localAppData = envPath("LOCALAPPDATA");
	if (localAppData !== undefined) push(join(localAppData, "Programs", APP_DIRNAME));
	const programFiles = envPath("ProgramFiles");
	if (programFiles !== undefined) push(join(programFiles, APP_DIRNAME));
	const programFilesX86 = envPath("ProgramFiles(x86)");
	if (programFilesX86 !== undefined) push(join(programFilesX86, APP_DIRNAME));
	return candidates;
}

/** `<root>/data/storage.sqlite`. */
export function storageDatabasePath(installRoot: string): string {
	return join(installRoot, DATA_DIRNAME, STORAGE_DB_FILENAME);
}

/**
 * The first candidate that actually carries a readable store, or `undefined`.
 *
 * "Carries" means the sqlite file exists; opening it is the caller's job so a
 * locked or corrupt database still yields a diagnosable path.
 */
export function defaultInstallRoot(explicit = ""): string | undefined {
	for (const root of installRootCandidates(explicit)) {
		try {
			if (existsSync(storageDatabasePath(root))) return root;
		} catch {
			// unreadable candidate — try the next one
		}
	}
	return undefined;
}

/** The plugin's own settings file (same convention as the sibling plugins). */
export function settingsFilePath(): string {
	return join(homedir(), ".dsh", "dsh-connect-officeace.settings.json");
}

/** The discovered-model cache file. */
export function catalogCachePath(): string {
	return join(homedir(), ".dsh", "dsh-connect-officeace.catalog.json");
}
