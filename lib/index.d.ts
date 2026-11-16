/**
 * DSH Connect OfficeAce — plugin entrypoint.
 *
 * Connects the locally installed, signed-in OfficeAce (Huawei Cloud) desktop app
 * to DeepSeek Harness as an OpenAI-compatible model provider:
 *
 *   createShim()        loopback HTTP surface (random port + per-process secret)
 *   createAdapter()     pi-ai provider registered into ctx.llm
 *   readLocalState()    read-only account/diagnostics view
 *   registerRoutes()    read-mostly web routes (status / catalog / save)
 *
 * What this plugin does NOT do, on purpose: read OfficeAce's oauth tokens (they
 * live in Windows Credential Manager — see src/credentials.ts) and show a usage
 * or points board (no OfficeAce usage endpoint could be verified). Both gaps are
 * documented in docs/protocol.md rather than papered over.
 *
 * Isolation follows the reference plugins: only this plugin's settings
 * namespace and `~/.dsh/dsh-connect-officeace.*.json` are touched, and no state
 * is shared with any other plugin.
 *
 * @module dsh-connect-officeace
 */
import { AccessResolver } from "./credentials.js";
import { readLocalState } from "./local-store.js";
import { type ResolvedSettings } from "./store.js";
import { OfficeAceUpstream } from "./upstream.js";
export { OFFICEACE_PROVIDER, OFFICEACE_PROVIDER_DISPLAY_NAME, KNOWN_MODEL_IDS, VERIFIED_WORKING_MODEL_IDS } from "./catalog.js";
export { createAdapter } from "./adapter.js";
export { AccessResolver, MISSING_CREDENTIAL_MESSAGE, tokenLocationOf } from "./credentials.js";
export { createDiscovery } from "./discovery.js";
export { readLocalState, resolveDatabasePath } from "./local-store.js";
export { CATALOG_PATH, SAVE_PATH, STATUS_PATH, WRITE_HEADER, registerRoutes } from "./routes.js";
export { createShim } from "./shim.js";
export { sessionViewOf, isSessionExpired, parseSessionRecord } from "./session.js";
export { createLocalSessionReader, decodeProviderStateText, modelGatewayOf, parseManifest, parseProviderState, wincredTargetOf, } from "./wincred.js";
export { authorizationOf, classifyFailure } from "./upstream.js";
export { DEFAULT_SETTINGS, WRITABLE_FIELDS, readStoredSettings, withStoredSettings, writeStoredSetting, } from "./store.js";
export { OfficeAceUpstream } from "./upstream.js";
declare const PLUGIN_ID = "dsh-connect-officeace";
declare const PLUGIN_NAME = "DSH Connect OfficeAce";
export declare const VERSION = "0.2.0";
/**
 * The plugin's Cordis name — the Loader and the Settings service key on it.
 * It must be the ENTRY ID, not a display title.
 */
declare const name = "dsh-connect-officeace";
/**
 * Services required before the provider may register.
 *
 * `inject: ["llm"]` is REQUIRED — touching `ctx.llm` without the declaration
 * throws and silently takes the plugin down. `webServer` and `settings` mount
 * later (or never), so they are NESTED injects inside `apply`.
 */
declare const inject: string[];
/** The namespace the HOST actually serves this plugin's config under. */
declare function settingsNamespaceOf(ctx: any): string;
/** The settings SCHEMA the Loader reads. Must be a real schemastery schema. */
declare const Config: any;
/**
 * The ticked ids, or `undefined` when the field is ABSENT — the "not yet
 * configured → serve the whole catalog" state. An explicit empty array means
 * the user deselected everything and is preserved as such.
 */
declare function effectiveIds(config: Partial<ResolvedSettings> | undefined): string[] | undefined;
/** The status snapshot shared by the route and the doctor. */
declare function statusViewOf(current: ResolvedSettings, discovery: {
    describe: () => unknown;
}, upstream: OfficeAceUpstream, local: ReturnType<typeof readLocalState>, access: AccessResolver): Promise<Record<string, unknown>>;
/**
 * Wire the provider and the routes.
 *
 * Every disposer hangs off one `ctx.effect`, so unloading the plugin releases
 * the shim's port, the adapter, the directory entry, the discovery callback and
 * the HTTP routes — nothing outlives the plugin.
 */
declare function apply(ctx: any, config?: Partial<ResolvedSettings>): void;
declare const src_default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export { Config, PLUGIN_ID, PLUGIN_NAME, apply, effectiveIds, inject, name, settingsNamespaceOf, statusViewOf, src_default as default, };
