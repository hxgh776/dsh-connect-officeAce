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

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_CONTEXT_WINDOW } from "./catalog.js";
import { settingsFilePath } from "./paths.js";
import type { OfficeAceSettings } from "./types.js";

/** Fields the settings card may write, and only these. */
export const WRITABLE_FIELDS: ReadonlySet<keyof OfficeAceSettings> = new Set([
	"enabledModelIds",
	"apiKey",
	"baseUrl",
	"installRoot",
	"defaultContextWindow",
] as const);

/** Settings with every default applied — the shape the plugin runs on. */
export interface ResolvedSettings {
	enabledModelIds: string[];
	apiKey: string;
	baseUrl: string;
	installRoot: string;
	defaultContextWindow: number;
}

export const DEFAULT_SETTINGS: ResolvedSettings = {
	enabledModelIds: [],
	apiKey: "",
	baseUrl: "",
	installRoot: "",
	defaultContextWindow: DEFAULT_CONTEXT_WINDOW,
};

function stringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter((entry): entry is string => typeof entry === "string");
}

function positiveNumber(value: unknown): number | undefined {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? Math.trunc(number) : undefined;
}

/** Keep only recognised fields with valid types; a hand-edited file cannot inject. */
function normalize(raw: unknown): OfficeAceSettings {
	const out: OfficeAceSettings = {};
	if (typeof raw !== "object" || raw === null) return out;
	const row = raw as Record<string, unknown>;

	const ids = stringList(row.enabledModelIds);
	if (ids !== undefined) out.enabledModelIds = ids;
	if (typeof row.apiKey === "string") out.apiKey = row.apiKey;
	if (typeof row.baseUrl === "string") out.baseUrl = row.baseUrl;
	if (typeof row.installRoot === "string") out.installRoot = row.installRoot;
	const window = positiveNumber(row.defaultContextWindow);
	if (window !== undefined) out.defaultContextWindow = window;
	return out;
}

/** Read persisted settings, or `{}` when the file is missing/unusable. */
export function readStoredSettings(path: string = settingsFilePath()): OfficeAceSettings {
	try {
		return normalize(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return {};
	}
}

/** Merge persisted settings over the Loader-supplied config. */
export function withStoredSettings(
	config: Partial<OfficeAceSettings> | undefined,
	path: string = settingsFilePath(),
): ResolvedSettings {
	const stored = readStoredSettings(path);
	return {
		enabledModelIds: stored.enabledModelIds ?? stringList(config?.enabledModelIds) ?? [],
		apiKey: stored.apiKey ?? (typeof config?.apiKey === "string" ? config.apiKey : ""),
		baseUrl: stored.baseUrl ?? (typeof config?.baseUrl === "string" ? config.baseUrl : ""),
		installRoot:
			stored.installRoot ?? (typeof config?.installRoot === "string" ? config.installRoot : ""),
		defaultContextWindow:
			stored.defaultContextWindow ??
			positiveNumber(config?.defaultContextWindow) ??
			DEFAULT_CONTEXT_WINDOW,
	};
}

/**
 * Persist one field atomically.
 *
 * @throws when the field is not writable or the value has the wrong type
 */
export function writeStoredSetting(
	field: string,
	value: unknown,
	path: string = settingsFilePath(),
): void {
	if (!WRITABLE_FIELDS.has(field as keyof OfficeAceSettings)) {
		throw new Error(`field ${field} is not persistable`);
	}
	const next = { ...readStoredSettings(path) };
	switch (field) {
		case "enabledModelIds": {
			const ids = stringList(value);
			if (ids === undefined) throw new Error("invalid value for enabledModelIds");
			next.enabledModelIds = ids;
			break;
		}
		case "defaultContextWindow": {
			const window = positiveNumber(value);
			if (window === undefined) throw new Error("invalid value for defaultContextWindow");
			next.defaultContextWindow = window;
			break;
		}
		default: {
			if (typeof value !== "string") throw new Error(`invalid value for ${field}`);
			next[field as "apiKey" | "baseUrl" | "installRoot"] = value;
			break;
		}
	}
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid.toString()}.tmp`;
	try {
		writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
		renameSync(temp, path);
	} catch (error) {
		try {
			unlinkSync(temp);
		} catch {
			// temp cleanup is best-effort; the original error is what matters
		}
		throw error;
	}
}
