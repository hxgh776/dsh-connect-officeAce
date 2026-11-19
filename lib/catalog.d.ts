/**
 * The model catalog: OfficeAce gateway rows → pi-ai model descriptors.
 *
 * Verified shape of `GET {base}/v1/models` (OfficeAce 1.8.1):
 *
 * ```json
 * {"object":"list","data":[{"id":"deepseek-v4-flash","object":"list","created":0,"owned_by":"system"}]}
 * ```
 *
 * There is NO context length and NO capability flag in the wire rows. That has
 * two consequences this module makes explicit:
 *
 * - every descriptor needs a `contextWindow`, but the endpoint does not publish
 *   one; the configurable `defaultContextWindow` fills the gap and is labelled
 *   an ASSUMPTION in docs/protocol.md §4;
 * - the catalog mixes chat models with image/video/embedding/rerank models, so a
 *   heuristic filter keeps obvious non-chat ids out of the picker (documented
 *   as a heuristic, not a contract).
 */
import type { ModelDefaults, OfficeAceModelRow } from "./types.js";
/** Provider id every registration in this plugin keys on. */
export declare const OFFICEACE_PROVIDER = "officeace";
/** Provider display name in DSH's picker. The product's Chinese name is 果办. */
export declare const OFFICEACE_PROVIDER_DISPLAY_NAME = "\u534E\u4E3A\u679C\u529E";
/** Fallback context window when the endpoint does not publish one. ASSUMED. */
export declare const DEFAULT_CONTEXT_WINDOW = 200000;
/** Fallback output budget. ASSUMED. */
export declare const DEFAULT_MAX_OUTPUT_TOKENS = 32000;
/**
 * Model ids verified as the agent defaults in OfficeAce's own config. Their
 * availability on the gateway is account-dependent: on the inspected account
 * `deepseek-v4.1-flash` answers 404 ("not available with api url
 * /inference/v1/chat/completions") while `deepseek-v4-flash` works.
 */
export declare const KNOWN_MODEL_IDS: readonly string[];
/** Model id this repository measured a 200 + SSE completion for. */
export declare const VERIFIED_WORKING_MODEL_IDS: readonly string[];
/**
 * Chat ids that answered 200 on the inspected account (**re-measured
 * 2026-11-19**), ordered so the verified default comes first. MEASURED, not
 * assumed: the same run sent a one-word completion to every chat id the gateway
 * lists, and 15 of 19 answered 404 / 403. A listed model is therefore NOT
 * necessarily an entitled model, so the picker defaults to this set instead of
 * the raw catalog.
 *
 * This set goes stale — entitlements move. On 2026-11-16 the usable set was
 * six ids including `deepseek-v4-flash` and `glm-5.1`; by 2026-11-19 both of
 * those answered 404 `ModelArts.81009` while `glm-5.3` / `glm-5.2` /
 * `deepseek-v4.1-flash-0930` / `deepseek-v4-flash-0731` answered 200. Re-measure
 * with `npm run e2e` (it probes the selected model for real) before assuming a
 * newer list holds.
 *
 * The set is account-specific. A different login may entitle different ids;
 * that is what `enabledModelIds` is for.
 */
export declare const MEASURED_USABLE_MODEL_IDS: readonly string[];
/** Default model for `probe` / `e2e`: the one verified to answer on a real account. */
export declare const DEFAULT_PROBE_MODEL: string;
/** Whether a model id looks like a chat model this plugin should offer. */
export declare function isLikelyChatModel(id: string): boolean;
export declare const DEFAULT_MODEL_DEFAULTS: ModelDefaults;
/**
 * Normalize one wire row.
 *
 * Accepts the OpenAI `/models` shape and a richer shape (should a deployment
 * publish `context_length` / `capabilities`). Unknown fields are ignored.
 */
export declare function normalizeModelRow(raw: unknown, defaults?: ModelDefaults): OfficeAceModelRow | undefined;
/**
 * Normalize a list, preserving wire order and dropping duplicate ids.
 *
 * @param filterNonChat drop ids the heuristic identifies as non-chat (default
 *   `true`; diagnostics can pass `false` to see the whole gateway list)
 */
export declare function chatModelsOf(rows: unknown, defaults?: ModelDefaults, filterNonChat?: boolean): OfficeAceModelRow[];
/**
 * The rows the picker offers, honoring the enabled-ids selection.
 *
 * An ABSENT selection (`undefined`) means "not configured yet" and serves the
 * whole catalog. An empty array means "the user deselected everything" and
 * serves nothing — those are different states and stay different.
 */
export declare function enabledModelsOf(rows: readonly OfficeAceModelRow[], enabledIds: readonly string[] | undefined): OfficeAceModelRow[];
/**
 * The rows the picker shows when the user has not picked anything: only the ids
 * measured usable on this machine, in `MEASURED_USABLE_MODEL_IDS` order so the
 * verified default leads. Falls back to the whole catalog when the account
 * entitles none of them (a disjoint entitlement set must not leave the picker
 * empty).
 */
export declare function usableModelsOf(rows: readonly OfficeAceModelRow[]): OfficeAceModelRow[];
/** The `{id, name}` rows the settings card's checklist renders. */
export declare function catalogEntriesOf(rows: readonly OfficeAceModelRow[]): Array<{
    id: string;
    name: string;
}>;
/**
 * Build one pi-ai model descriptor.
 *
 * `cost` is all zeros on purpose: the gateway publishes no per-token price we
 * could verify, and inventing one would surface a fake number in DSH.
 */
export declare function toPiModel(row: OfficeAceModelRow, baseUrl: string, providerId?: string): Record<string, unknown>;
