/**
 * The model catalog: OfficeAce rows → pi-ai model descriptors.
 *
 * DSH rejects an ENTIRE provider when one model lacks a positive-integer
 * context window (`INVALID_MODEL_CONTEXT`), so normalization is conservative
 * and explicit about its one assumption:
 *
 * - the model id always comes from the wire (`id`);
 * - the context window comes from the wire when the endpoint publishes it
 *   (`context_length` / `context_window` / `contextWindow`) and otherwise from
 *   the configurable default. That default is an ASSUMPTION about OfficeAce,
 *   not a measured number — see docs/protocol.md §4.
 *
 * The two model ids below are the only ones this repository could verify: they
 * appear as `defaultModel` in OfficeAce's own `office-claw-config.json`
 * (`deepseek-v4.1-flash` for office/assistant/agentteams,
 * `deepseek-v4.1-flash-1017` for agentteam). They are used for diagnostics,
 * NOT invented as a selectable offline catalog.
 */

import type { ModelDefaults, OfficeAceModelRow } from "./types.js";

/** Provider id every registration in this plugin keys on. */
export const OFFICEACE_PROVIDER = "officeace";

/** Provider display name in DSH's picker. */
export const OFFICEACE_PROVIDER_DISPLAY_NAME = "OfficeAce（华为云）";

/** Fallback context window when the endpoint does not publish one. ASSUMED. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Fallback output budget. ASSUMED. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 32_000;

/** Model ids verified in OfficeAce's own agent config (not a full catalog). */
export const KNOWN_MODEL_IDS: readonly string[] = ["deepseek-v4.1-flash", "deepseek-v4.1-flash-1017"];

export const DEFAULT_MODEL_DEFAULTS: ModelDefaults = {
	contextWindow: DEFAULT_CONTEXT_WINDOW,
	maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
};

function positiveInteger(value: unknown): number | undefined {
	const number = Number(value);
	return Number.isInteger(number) && number > 0 ? number : undefined;
}

function stringOf(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
}

/**
 * Normalize one wire row.
 *
 * Accepts the OpenAI `/models` shape (`{id, object, created, owned_by}`) and the
 * richer shape OfficeAce's own MaaS endpoint is reported to use
 * (`context_length`, `capabilities`, …). Unknown fields are ignored.
 *
 * @returns the row, or `undefined` when it cannot be offered honestly
 */
export function normalizeModelRow(
	raw: unknown,
	defaults: ModelDefaults = DEFAULT_MODEL_DEFAULTS,
): OfficeAceModelRow | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const row = raw as Record<string, unknown>;
	const id = stringOf(row.id);
	if (id === undefined) return undefined;

	const contextWindow =
		positiveInteger(row.context_length) ??
		positiveInteger(row.context_window) ??
		positiveInteger(row.contextWindow) ??
		(defaults.contextWindow > 0 ? Math.trunc(defaults.contextWindow) : undefined);
	if (contextWindow === undefined) return undefined;

	const maxTokens =
		positiveInteger(row.max_output_tokens) ??
		positiveInteger(row.maxTokens) ??
		(defaults.maxTokens > 0 ? Math.trunc(defaults.maxTokens) : undefined);

	const capabilities =
		typeof row.capabilities === "object" && row.capabilities !== null
			? (row.capabilities as Record<string, unknown>)
			: {};
	const modalities = Array.isArray(capabilities.input_modalities)
		? capabilities.input_modalities
		: Array.isArray(row.input_modalities)
			? row.input_modalities
			: [];
	const input: ("text" | "image")[] = modalities.some(
		(entry) => entry === "image" || entry === "video",
	)
		? ["text", "image"]
		: ["text"];

	return {
		id,
		name: stringOf(row.name) ?? stringOf(row.display_name) ?? id,
		contextWindow,
		maxTokens,
		inputModalities: input,
		created: Number(row.created) || 0,
		ownedBy: stringOf(row.owned_by) ?? "officeace",
		reasoning: capabilities.reasoning === true || row.reasoning === true,
	};
}

/** Normalize a list, preserving wire order and dropping duplicate ids. */
export function chatModelsOf(
	rows: unknown,
	defaults: ModelDefaults = DEFAULT_MODEL_DEFAULTS,
): OfficeAceModelRow[] {
	if (!Array.isArray(rows)) return [];
	const seen = new Set<string>();
	const out: OfficeAceModelRow[] = [];
	for (const raw of rows) {
		const row = normalizeModelRow(raw, defaults);
		if (row === undefined || seen.has(row.id)) continue;
		seen.add(row.id);
		out.push(row);
	}
	return out;
}

/**
 * The rows the picker offers, honoring the enabled-ids selection.
 *
 * An ABSENT selection (`undefined`) means "not configured yet" and serves the
 * whole catalog. An empty array means "the user deselected everything" and
 * serves nothing — those are different states and stay different.
 */
export function enabledModelsOf(
	rows: readonly OfficeAceModelRow[],
	enabledIds: readonly string[] | undefined,
): OfficeAceModelRow[] {
	if (enabledIds === undefined) return [...rows];
	const wanted = new Set(enabledIds);
	return rows.filter((row) => wanted.has(row.id));
}

/** The `{id, name}` rows the settings card's checklist renders. */
export function catalogEntriesOf(
	rows: readonly OfficeAceModelRow[],
): Array<{ id: string; name: string }> {
	return rows.map((row) => ({ id: row.id, name: row.name }));
}

/**
 * Build one pi-ai model descriptor.
 *
 * `cost` is all zeros on purpose: OfficeAce bills no published per-token price
 * we could verify, and inventing one would surface a fake number in DSH.
 */
export function toPiModel(
	row: OfficeAceModelRow,
	baseUrl: string,
	providerId: string = OFFICEACE_PROVIDER,
): Record<string, unknown> {
	return {
		id: row.id,
		name: row.name,
		api: "openai-completions",
		provider: providerId,
		baseUrl,
		input: row.inputModalities,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		reasoning: row.reasoning,
		contextWindow: row.contextWindow,
		maxTokens: row.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
		compat: { supportsReasoningEffort: false },
	};
}
