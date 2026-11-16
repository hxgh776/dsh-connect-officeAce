import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	readStoredSettings,
	withStoredSettings,
	writeStoredSetting,
} from "./store.js";

function tempPath(): { path: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "officeace-settings-"));
	return { path: join(dir, "settings.json"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("persists one field and reads it back", () => {
	const { path, cleanup } = tempPath();
	try {
		writeStoredSetting("enabledModelIds", ["a", "b"], path);
		writeStoredSetting("apiKey", "sk-test", path);
		assert.deepEqual(readStoredSettings(path), {
			enabledModelIds: ["a", "b"],
			apiKey: "sk-test",
		});
	} finally {
		cleanup();
	}
});

test("the file wins over the Loader config, unknown keys are dropped", () => {
	const { path, cleanup } = tempPath();
	try {
		writeStoredSetting("baseUrl", "https://example.test/v1", path);
		const resolved = withStoredSettings({ baseUrl: "https://loader.test/v1", apiKey: "from-loader" }, path);
		assert.equal(resolved.baseUrl, "https://example.test/v1");
		assert.equal(resolved.apiKey, "from-loader");
		assert.deepEqual(resolved.enabledModelIds, []);
		assert.ok(resolved.defaultContextWindow > 0);
	} finally {
		cleanup();
	}
});

test("a service could not be told to persist an unknown field", () => {
	const { path, cleanup } = tempPath();
	try {
		assert.throws(() => writeStoredSetting("nope", "x", path), /not persistable/u);
		assert.throws(() => writeStoredSetting("apiKey", 42, path), /invalid value/u);
		assert.throws(() => writeStoredSetting("enabledModelIds", "not-array", path), /invalid value/u);
	} finally {
		cleanup();
	}
});

test("a corrupt settings file degrades to empty settings", () => {
	const { path, cleanup } = tempPath();
	try {
		writeStoredSetting("apiKey", "sk-test", path);
		writeFileSync(path, "{ not json", "utf8");
		assert.deepEqual(readStoredSettings(path), {});
	} finally {
		cleanup();
	}
});
