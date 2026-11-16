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
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { safeMessage } from "./errors.js";
import { API_LEASE_KEY, SESSION_USER_KEY_PREFIX, defaultInstallRoot, storageDatabasePath, } from "./paths.js";
import { parseSessionRecord } from "./session.js";
/** The database path this read would target, or `undefined` when none resolves. */
export function resolveDatabasePath(options = {}) {
    const explicit = String(options.databasePath ?? "").trim();
    if (explicit !== "")
        return explicit;
    const root = defaultInstallRoot(options.installRoot ?? "");
    return root === undefined ? undefined : storageDatabasePath(root);
}
function rowsOf(db, sql, ...params) {
    const statement = db.prepare(sql);
    return statement.all(...params);
}
function textOf(row, field) {
    const value = row[field];
    return typeof value === "string" ? value : undefined;
}
/** The newest of possibly several session rows (older builds left copies behind). */
function readSession(db) {
    let rows;
    try {
        rows = rowsOf(db, "select key, value from oc_kv_string where key like ? order by key", `${SESSION_USER_KEY_PREFIX}%`);
    }
    catch {
        return undefined;
    }
    const records = [];
    for (const row of rows) {
        const value = textOf(row, "value");
        if (value === undefined)
            continue;
        const record = parseSessionRecord(value);
        if (record !== undefined)
            records.push(record);
    }
    if (records.length === 0)
        return undefined;
    records.sort((left, right) => timestampOf(right) - timestampOf(left));
    return records[0];
}
function timestampOf(record) {
    for (const value of [record.lastSeenAt, record.createdAt]) {
        if (value === undefined)
            continue;
        const ms = Date.parse(value);
        if (Number.isFinite(ms))
            return ms;
    }
    return 0;
}
function readLease(db) {
    let rows;
    try {
        rows = rowsOf(db, "select value from oc_kv_string where key = ?", API_LEASE_KEY);
    }
    catch {
        return undefined;
    }
    const value = rows.length > 0 ? textOf(rows[0], "value") : undefined;
    if (value === undefined)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        return undefined;
    }
    if (typeof parsed !== "object" || parsed === null)
        return undefined;
    const row = parsed;
    const token = typeof row.token === "string" ? row.token : undefined;
    if (token === undefined)
        return undefined;
    return {
        token,
        instanceId: typeof row.instanceId === "string" ? row.instanceId : undefined,
        apiPort: typeof row.apiPort === "number" ? row.apiPort : undefined,
        pid: typeof row.pid === "number" ? row.pid : undefined,
        appVersion: typeof row.appVersion === "string" ? row.appVersion : undefined,
        startedAt: typeof row.startedAt === "number" ? row.startedAt : undefined,
    };
}
/**
 * Read the local store once.
 *
 * Never throws. `available: false` plus a stable `error` tag lets the doctor and
 * the settings card explain exactly which step failed.
 */
export function readLocalState(options = {}) {
    const databasePath = resolveDatabasePath(options);
    if (databasePath === undefined) {
        return { available: false, databasePath: undefined, error: "not_found" };
    }
    if (!existsSync(databasePath)) {
        return { available: false, databasePath, error: "not_found" };
    }
    let db;
    try {
        db = new DatabaseSync(databasePath, { readOnly: true });
    }
    catch (error) {
        return { available: false, databasePath, error: "open_failed", errorDetail: safeMessage(error) };
    }
    try {
        const session = readSession(db);
        const lease = readLease(db);
        return { available: true, databasePath, session, lease };
    }
    catch (error) {
        return { available: false, databasePath, error: "query_failed", errorDetail: safeMessage(error) };
    }
    finally {
        try {
            db.close();
        }
        catch {
            // closing a read-only handle has nothing useful to report
        }
    }
}
