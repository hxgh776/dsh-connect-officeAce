/**
 * Read-only access to OfficeAce's own local store.
 *
 * The store is `data/storage.sqlite` in the OfficeAce installation directory,
 * a tiny Redis-shaped key-value schema the bundled API server maintains. We
 * only ever read two things from it:
 *
 * - the signed-in session row (key prefix `office-claw:oc:session:user:`), and
 * - the local API server lease (`office-claw:runtime:api-instance-lease:v1`),
 *   which is what a "the desktop app is running" diagnostic needs.
 *
 * Nothing is written, migrated or locked: the database is opened read-only and
 * closed immediately. A read failure is reported, never thrown — a missing or
 * locked store must not take the plugin's provider registration down.
 */
import type { LocalState } from "./types.js";
export interface LocalStateOptions {
    /** Settings override; when empty, the verified default is probed. */
    installRoot?: string;
    /** Direct database path (tests / non-standard layouts). */
    databasePath?: string;
}
/** The database path this read would target, or `undefined` when none resolves. */
export declare function resolveDatabasePath(options?: LocalStateOptions): string | undefined;
/**
 * Read the local store once.
 *
 * Never throws. `available: false` plus a stable `error` tag lets the doctor and
 * the settings card explain exactly which step failed.
 */
export declare function readLocalState(options?: LocalStateOptions): LocalState;
