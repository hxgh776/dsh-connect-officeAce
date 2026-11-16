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
import type { ModelDefaults, OfficeAceModelRow } from "./types.js";
import type { OfficeAceUpstream } from "./upstream.js";

/** How long a successful discovery stays trusted. */
const DISCOVERY_TTL_MS = 10 * 60_000;

interface CachedCatalog {
	fetchedAt: number;
	models: unknown[];
}

function readCache(path: string): CachedCatalog | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CachedCatalog>;
		if (Array.isArray(parsed.models) && typeof parsed.fetchedAt === "number") {
			return { fetchedAt: parsed.fetchedAt, models: parsed.models };
		}
	} catch {
		// no cache / corrupt cache — fall through
	}
	return undefined;
}

function writeCache(rows: OfficeAceModelRow[], path: string): void {
	const payload: CachedCatalog = { fetchedAt: Date.now(), models: rows };
	try {
		mkdirSync(dirname(path), { recursive: true });
		const temp = `${path}.${process.pid.toString()}.tmp`;
		writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
		renameSync(temp, path);
	} catch {
		// A cache write failure must never break discovery — it is an optimization.
		try {
			unlinkSync(`${path}.${process.pid.toString()}.tmp`);
		} catch {
			// best-effort cleanup
		}
	}
}

export interface DiscoveryDescription {
	source: "gateway" | "cache" | "none";
	count: number;
	fetchedAt?: number;
	error?: string;
}

export interface Discovery {
	/** Fetch and replace the served rows; resolves to the source now serving. */
	refresh(options?: { force?: boolean }): Promise<"gateway" | "cache" | "none">;
	/** The rows served right now (seeding from cache on first touch). */
	current(): OfficeAceModelRow[];
	describe(): DiscoveryDescription;
	invalidate(): void;
}

export interface DiscoveryOptions {
	/** Cache file override (tests). */
	cachePath?: string;
	/** Live model defaults, so a settings edit re-normalizes new fetches. */
	modelDefaults?: () => ModelDefaults;
}

export function createDiscovery(
	upstream: OfficeAceUpstream,
	options: DiscoveryOptions = {},
): Discovery {
	const cachePath = options.cachePath ?? catalogCachePath();
	const modelDefaults = options.modelDefaults ?? (() => DEFAULT_MODEL_DEFAULTS);

	let rows: OfficeAceModelRow[] | undefined;
	let source: "gateway" | "cache" | "none" = "none";
	let lastFetchAt = 0;
	let lastError: string | undefined;
	let inflight: Promise<"gateway" | "cache" | "none"> | undefined;

	function seed(): void {
		if (rows !== undefined) return;
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

	async function refresh(request: { force?: boolean } = {}): Promise<"gateway" | "cache" | "none"> {
		const now = Date.now();
		if (
			request.force !== true &&
			rows !== undefined &&
			source === "gateway" &&
			now - lastFetchAt < DISCOVERY_TTL_MS
		) {
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
				} else {
					lastError = "empty_catalog";
				}
			} catch (error) {
				// Keep serving whatever we have — cache or nothing.
				lastError = error instanceof Error ? error.message.slice(0, 200) : "refresh_failed";
			} finally {
				inflight = undefined;
			}
			return source;
		})();
		return inflight;
	}

	function current(): OfficeAceModelRow[] {
		seed();
		return rows ?? [];
	}

	function describe(): DiscoveryDescription {
		seed();
		return {
			source,
			count: rows?.length ?? 0,
			fetchedAt: lastFetchAt > 0 ? lastFetchAt : undefined,
			error: lastError,
		};
	}

	function invalidate(): void {
		rows = undefined;
		source = "none";
		lastFetchAt = 0;
	}

	return { refresh, current, describe, invalidate };
}
