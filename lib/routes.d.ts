/**
 * The read-mostly web routes the settings card consumes.
 *
 * Mounted on the host web server via a NESTED `ctx.inject(["webServer"], ...)`:
 * the service mounts late and may never appear, and naming it at the top level
 * would hold the whole plugin back.
 *
 * Security posture (same as both reference plugins): the host's Connection
 * fence FIRST — Host/Origin checks plus the browser credential every DSH UI
 * request carries. `webServer.register` routes sit outside that fence, so
 * without it a cross-site `fetch` and a plain top-level navigation (which sends
 * no `Origin` header) both reach these handlers. The local checks below
 * (loopback Host, no cross-site fetches, loopback Origin, `no-store`, and a
 * custom CSRF header on the one write route) stay as defence in depth.
 *
 * There is deliberately NO usage/quota route: no OfficeAce usage endpoint could
 * be verified, and a fabricated one would be worse than an honest gap. See
 * docs/protocol.md §5.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
export declare const STATUS_PATH = "/plugins/dsh-connect-officeace/status";
export declare const CATALOG_PATH = "/plugins/dsh-connect-officeace/catalog";
export declare const SAVE_PATH = "/plugins/dsh-connect-officeace/__save";
/** The CSRF fence header the settings card sends on writes. */
export declare const WRITE_HEADER = "x-dsh-officeace-write";
/** The subset of `ctx.webServer` this module needs. */
export interface WebServerLike {
    register(spec: {
        kind: "exact";
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
export interface RouteDeps {
    /** Allow-listed diagnostics snapshot (may read the local credential cache). */
    statusView: () => unknown | Promise<unknown>;
    /** Async allow-listed catalog view. */
    catalogView: () => Promise<unknown>;
    /** Force a discovery refresh. */
    refreshCatalog: () => Promise<unknown>;
    /** The persistable field allow-list. */
    writableFields: () => ReadonlySet<string>;
    /** Persisted write. */
    writeField: (field: string, value: unknown) => void;
    /** Persisted read. */
    readSettings: () => unknown;
    /** Applied-write hook (update live config, re-arm adapters). */
    onApplied: (field: string, value: unknown) => void;
}
/** One gate for every route: host fence first, then the cheap local checks. */
export declare function guard(ctx: unknown, req: IncomingMessage, res: ServerResponse, options?: {
    write?: boolean;
}): boolean;
/** Register every route. Returns one combined disposer. */
export declare function registerRoutes(ctx: unknown, deps: RouteDeps): () => void;
