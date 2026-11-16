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
/** The directory name under `%LOCALAPPDATA%\Programs` and `%ProgramFiles%`. */
export declare const APP_DIRNAME = "OfficeAce";
/** State directory name inside the installation root. */
export declare const DATA_DIRNAME = "data";
/** The local key-value database. */
export declare const STORAGE_DB_FILENAME = "storage.sqlite";
/** Key prefix of the per-user session row (appends `<orgId>:<userId>`). */
export declare const SESSION_USER_KEY_PREFIX = "office-claw:oc:session:user:";
/** Key prefix of the by-session-id copy of the same record. */
export declare const SESSION_ID_KEY_PREFIX = "office-claw:oc:session:id:";
/** Exact key of the local API server lease row. */
export declare const API_LEASE_KEY = "office-claw:runtime:api-instance-lease:v1";
/** Environment override used by CI / headless probes. */
export declare const APP_ROOT_ENV = "DSH_OFFICEACE_APP_ROOT";
/** Candidate installation roots, most specific first. May not exist. */
export declare function installRootCandidates(explicit?: string): string[];
/** `<root>/data/storage.sqlite`. */
export declare function storageDatabasePath(installRoot: string): string;
/**
 * The first candidate that actually carries a readable store, or `undefined`.
 *
 * "Carries" means the sqlite file exists; opening it is the caller's job so a
 * locked or corrupt database still yields a diagnosable path.
 */
export declare function defaultInstallRoot(explicit?: string): string | undefined;
/** The plugin's own settings file (same convention as the sibling plugins). */
export declare function settingsFilePath(): string;
/** The discovered-model cache file. */
export declare function catalogCachePath(): string;
