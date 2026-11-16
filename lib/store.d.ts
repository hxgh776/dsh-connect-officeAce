/**
 * The plugin's own settings file.
 *
 * Same reason the siblings keep one: on this host line the plugin fiber can sit
 * below ACTIVE, which closes the host's settings-mutate path — a write would
 * look saved and silently revert. Fields a settings card may change therefore
 * live in a file this plugin owns: synchronous, atomic (temp + rename), and
 * independent of any host service.
 *
 * Precedence: the file WINS over the config the Loader hands in, because the
 * file is the only place a save can land.
 *
 * The file may contain the upstream API key when the user chooses to store it
 * there. It is written with owner-only expectations of the user profile and is
 * never returned through a web route — `readStoredSettings` is a local call;
 * the route layer serves an allow-listed view instead.
 */
import type { OfficeAceSettings } from "./types.js";
/** Fields the settings card may write, and only these. */
export declare const WRITABLE_FIELDS: ReadonlySet<keyof OfficeAceSettings>;
/** Settings with every default applied — the shape the plugin runs on. */
export interface ResolvedSettings {
    enabledModelIds: string[];
    apiKey: string;
    baseUrl: string;
    installRoot: string;
    defaultContextWindow: number;
}
export declare const DEFAULT_SETTINGS: ResolvedSettings;
/** Read persisted settings, or `{}` when the file is missing/unusable. */
export declare function readStoredSettings(path?: string): OfficeAceSettings;
/** Merge persisted settings over the Loader-supplied config. */
export declare function withStoredSettings(config: Partial<OfficeAceSettings> | undefined, path?: string): ResolvedSettings;
/**
 * Persist one field atomically.
 *
 * @throws when the field is not writable or the value has the wrong type
 */
export declare function writeStoredSetting(field: string, value: unknown, path?: string): void;
