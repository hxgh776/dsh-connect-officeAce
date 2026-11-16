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
/** Provider id every registration in this plugin keys on. */
export const OFFICEACE_PROVIDER = "officeace";
/** Provider display name in DSH's picker. The product's Chinese name is 果办. */
export const OFFICEACE_PROVIDER_DISPLAY_NAME = "华为果办";
/** Fallback context window when the endpoint does not publish one. ASSUMED. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;
/** Fallback output budget. ASSUMED. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 32_000;
/**
 * Model ids verified as the agent defaults in OfficeAce's own config. Their
 * availability on the gateway is account-dependent: on the inspected account
 * `deepseek-v4.1-flash` answers 404 ("not available with api url
 * /inference/v1/chat/completions") while `deepseek-v4-flash` works.
 */
export const KNOWN_MODEL_IDS = ["deepseek-v4.1-flash", "deepseek-v4.1-flash-1017-host"];
/** Model ids this repository measured a 200 + SSE completion for. */
export const VERIFIED_WORKING_MODEL_IDS = ["deepseek-v4-flash"];
/**
 * Chat ids that answered 200 on the inspected account (2026-11-16), ordered so
 * the verified default comes first. MEASURED, not assumed: the same run sent a
 * one-word completion to every chat id the gateway lists, and 14 of 20 answered
 * 404 / 403. A listed model is therefore NOT necessarily an entitled model, so
 * the picker defaults to this set instead of the raw catalog.
 *
 * The set is account-specific. A different login may entitle different ids;
 * that is what `enabledModelIds` is for.
 */
export const MEASURED_USABLE_MODEL_IDS = [
    "deepseek-v4-flash",
    "glm-5.3",
    "glm-5.2",
    "glm-5.1",
    "deepseek-v4.1-flash-0930",
    "deepseek-v4-flash-0731",
];
/** Default model for `probe`: the one verified to answer on a real account. */
export const DEFAULT_PROBE_MODEL = VERIFIED_WORKING_MODEL_IDS[0] ?? "deepseek-v4-flash";
/**
 * Heuristic: obvious non-chat ids seen in the live catalog (`vidu/…`,
 * `pixverse/…`, `qwen-image…`, `bge-…`). There are no capability flags to key
 * on, so this is a name filter and is documented as such.
 */
const NON_CHAT_ID = /(^|\/)(vidu|pixverse)\/|(^|[-_/])(image|images|video|embed|embedding|rerank|reranker|ocr|asr|tts|whisper|speech|audio)([-_/]|$)|^(bge-|qwen-image|qwen_image)/iu;
/** Whether a model id looks like a chat model this plugin should offer. */
export function isLikelyChatModel(id) {
    return !NON_CHAT_ID.test(id);
}
export const DEFAULT_MODEL_DEFAULTS = {
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
};
function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : undefined;
}
function stringOf(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
}
/**
 * Normalize one wire row.
 *
 * Accepts the OpenAI `/models` shape and a richer shape (should a deployment
 * publish `context_length` / `capabilities`). Unknown fields are ignored.
 */
export function normalizeModelRow(raw, defaults = DEFAULT_MODEL_DEFAULTS) {
    if (typeof raw !== "object" || raw === null)
        return undefined;
    const row = raw;
    const id = stringOf(row.id);
    if (id === undefined)
        return undefined;
    const contextWindow = positiveInteger(row.context_length) ??
        positiveInteger(row.context_window) ??
        positiveInteger(row.contextWindow) ??
        (defaults.contextWindow > 0 ? Math.trunc(defaults.contextWindow) : undefined);
    if (contextWindow === undefined)
        return undefined;
    const maxTokens = positiveInteger(row.max_output_tokens) ??
        positiveInteger(row.maxTokens) ??
        (defaults.maxTokens > 0 ? Math.trunc(defaults.maxTokens) : undefined);
    const capabilities = typeof row.capabilities === "object" && row.capabilities !== null
        ? row.capabilities
        : {};
    const modalities = Array.isArray(capabilities.input_modalities)
        ? capabilities.input_modalities
        : Array.isArray(row.input_modalities)
            ? row.input_modalities
            : [];
    const input = modalities.some((entry) => entry === "image" || entry === "video")
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
/**
 * Normalize a list, preserving wire order and dropping duplicate ids.
 *
 * @param filterNonChat drop ids the heuristic identifies as non-chat (default
 *   `true`; diagnostics can pass `false` to see the whole gateway list)
 */
export function chatModelsOf(rows, defaults = DEFAULT_MODEL_DEFAULTS, filterNonChat = true) {
    if (!Array.isArray(rows))
        return [];
    const seen = new Set();
    const out = [];
    for (const raw of rows) {
        const row = normalizeModelRow(raw, defaults);
        if (row === undefined || seen.has(row.id))
            continue;
        if (filterNonChat && !isLikelyChatModel(row.id))
            continue;
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
export function enabledModelsOf(rows, enabledIds) {
    if (enabledIds === undefined)
        return [...rows];
    const wanted = new Set(enabledIds);
    return rows.filter((row) => wanted.has(row.id));
}
/**
 * The rows the picker shows when the user has not picked anything: only the ids
 * measured usable on this machine, in `MEASURED_USABLE_MODEL_IDS` order so the
 * verified default leads. Falls back to the whole catalog when the account
 * entitles none of them (a disjoint entitlement set must not leave the picker
 * empty).
 */
export function usableModelsOf(rows) {
    const order = new Map(MEASURED_USABLE_MODEL_IDS.map((id, index) => [id, index]));
    const picked = rows.filter((row) => order.has(row.id));
    if (picked.length === 0)
        return [...rows];
    return picked.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
}
/** The `{id, name}` rows the settings card's checklist renders. */
export function catalogEntriesOf(rows) {
    return rows.map((row) => ({ id: row.id, name: row.name }));
}
/**
 * Build one pi-ai model descriptor.
 *
 * `cost` is all zeros on purpose: the gateway publishes no per-token price we
 * could verify, and inventing one would surface a fake number in DSH.
 */
export function toPiModel(row, baseUrl, providerId = OFFICEACE_PROVIDER) {
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
