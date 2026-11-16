/**
 * Catalog discovery and caching.
 *
 * The gateway's `/models` is fetched on plugin start and on explicit refresh,
 * cached to the plugin's own file, and served from cache when the gateway is
 * unreachable. A failed refresh NEVER empties the picker and never clears the
 * user's enabled-ids selection.
 *
 * There is no embedded fallback catalog on purpose: the only two model ids this
 * repository could verify are the two OfficeAce uses as agent defaults, and
 * shipping them as selectable models would invent context windows nobody
 * measured. `KNOWN_MODEL_IDS` is used by diagnostics only.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_MODEL_DEFAULTS, chatModelsOf } from "./catalog.js";
import { catalogCachePath } from "./paths.js";
/** How long a successful discovery stays trusted. */
const DISCOVERY_TTL_MS = 10 * 60_000;
function readCache(path) {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (Array.isArray(parsed.models) && typeof parsed.fetchedAt === "number") {
            return { fetchedAt: parsed.fetchedAt, models: parsed.models };
        }
    }
    catch {
        // no cache / corrupt cache — fall through
    }
    return undefined;
}
function writeCache(rows, path) {
    const payload = { fetchedAt: Date.now(), models: rows };
    try {
        mkdirSync(dirname(path), { recursive: true });
        const temp = `${path}.${process.pid.toString()}.tmp`;
        writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        renameSync(temp, path);
    }
    catch {
        // A cache write failure must never break discovery — it is an optimization.
        try {
            unlinkSync(`${path}.${process.pid.toString()}.tmp`);
        }
        catch {
            // best-effort cleanup
        }
    }
}
export function createDiscovery(upstream, options = {}) {
    const cachePath = options.cachePath ?? catalogCachePath();
    const modelDefaults = options.modelDefaults ?? (() => DEFAULT_MODEL_DEFAULTS);
    let rows;
    let source = "none";
    let lastFetchAt = 0;
    let lastError;
    let inflight;
    function seed() {
        if (rows !== undefined)
            return;
        const cached = readCache(cachePath);
        if (cached !== undefined) {
            const normalized = chatModelsOf(cached.models, modelDefaults());
            if (normalized.length > 0) {
                rows = normalized;
                source = "cache";
                lastFetchAt = cached.fetchedAt;
            }
        }
    }
    async function refresh(request = {}) {
        const now = Date.now();
        if (request.force !== true &&
            rows !== undefined &&
            source === "gateway" &&
            now - lastFetchAt < DISCOVERY_TTL_MS) {
            return source;
        }
        inflight ??= (async () => {
            try {
                const raw = await upstream.listModels();
                const normalized = chatModelsOf(raw, modelDefaults());
                if (normalized.length > 0) {
                    rows = normalized;
                    source = "gateway";
                    lastFetchAt = Date.now();
                    lastError = undefined;
                    writeCache(normalized, cachePath);
                }
                else {
                    lastError = "empty_catalog";
                }
            }
            catch (error) {
                // Keep serving whatever we have — cache or nothing.
                lastError = error instanceof Error ? error.message.slice(0, 200) : "refresh_failed";
            }
            finally {
                inflight = undefined;
            }
            return source;
        })();
        return inflight;
    }
    function current() {
        seed();
        return rows ?? [];
    }
    function describe() {
        seed();
        return {
            source,
            count: rows?.length ?? 0,
            fetchedAt: lastFetchAt > 0 ? lastFetchAt : undefined,
            error: lastError,
        };
    }
    function invalidate() {
        rows = undefined;
        source = "none";
        lastFetchAt = 0;
    }
    return { refresh, current, describe, invalidate };
}
