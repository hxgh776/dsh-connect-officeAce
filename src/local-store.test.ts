import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readLocalState, resolveDatabasePath } from "./local-store.js";

function withTempDir(run: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "officeace-store-"));
	try {
		run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function createStore(path: string, rows: Array<[string, string]>): void {
	const db = new DatabaseSync(path);
	db.exec(
		"create table oc_kv_string (key text primary key, value text not null)",
	);
	const insert = db.prepare("insert into oc_kv_string (key, value) values (?, ?)");
	for (const [key, value] of rows) insert.run(key, value);
	db.close();
}

const OLD_SESSION = JSON.stringify({
	sessionId: "old",
	providerId: "huawei-oauth",
	userId: "aaaa:bbbb",
	lastSeenAt: "2026-11-16T10:00:00.000Z",
});

const NEW_SESSION = JSON.stringify({
	sessionId: "new",
	providerId: "huawei-oauth",
	userId: "cccc:dddd",
	lastSeenAt: "2026-11-16T12:00:00.000Z",
	expiresAt: "2026-11-16T15:00:00.000Z",
});

const LEASE = JSON.stringify({
	version: 1,
	token: "lease-token",
	instanceId: "api-x",
	apiPort: 3004,
	pid: 4242,
	appVersion: "1.8.1",
});

test("reads the newest session row and the API lease", () => {
	withTempDir((dir) => {
		const path = join(dir, "storage.sqlite");
		createStore(path, [
			[`office-claw:oc:session:user:aaaa:bbbb`, OLD_SESSION],
			[`office-claw:oc:session:user:cccc:dddd`, NEW_SESSION],
			["office-claw:runtime:api-instance-lease:v1", LEASE],
		]);
		const state = readLocalState({ databasePath: path });
		assert.equal(state.available, true);
		assert.equal(state.session?.sessionId, "new");
		assert.equal(state.lease?.token, "lease-token");
		assert.equal(state.lease?.apiPort, 3004);
		assert.equal(state.lease?.appVersion, "1.8.1");
	});
});

test("tolerates a database without the expected table", () => {
	withTempDir((dir) => {
		const path = join(dir, "empty.sqlite");
		const db = new DatabaseSync(path);
		db.exec("create table unrelated (x text)");
		db.close();
		const state = readLocalState({ databasePath: path });
		assert.equal(state.available, true);
		assert.equal(state.session, undefined);
		assert.equal(state.lease, undefined);
	});
});

test("a missing database is reported, never thrown", () => {
	withTempDir((dir) => {
		const state = readLocalState({ databasePath: join(dir, "nope.sqlite") });
		assert.equal(state.available, false);
		assert.equal(state.error, "not_found");
	});
});

test("resolveDatabasePath honors the explicit database path", () => {
	assert.equal(
		resolveDatabasePath({ databasePath: "C:\\x\\storage.sqlite" }),
		"C:\\x\\storage.sqlite",
	);
});
