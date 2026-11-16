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
import type { ModelDefaults, OfficeAceModelRow } from "./types.js";
import type { OfficeAceUpstream } from "./upstream.js";
export interface DiscoveryDescription {
    source: "gateway" | "cache" | "none";
    count: number;
    fetchedAt?: number;
    error?: string;
}
export interface Discovery {
    /** Fetch and replace the served rows; resolves to the source now serving. */
    refresh(options?: {
        force?: boolean;
    }): Promise<"gateway" | "cache" | "none">;
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
export declare function createDiscovery(upstream: OfficeAceUpstream, options?: DiscoveryOptions): Discovery;
