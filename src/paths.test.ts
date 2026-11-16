import assert from "node:assert/strict";
import test from "node:test";
import {
	APP_ROOT_ENV,
	SESSION_USER_KEY_PREFIX,
	installRootCandidates,
	settingsFilePath,
	storageDatabasePath,
} from "./paths.js";

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
	const previous: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(values)) {
		previous[key] = process.env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		run();
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("candidates put the explicit root first, then env, then the verified default", () => {
	withEnv(
		{
			[APP_ROOT_ENV]: undefined,
			LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
			ProgramFiles: "C:\\Program Files",
			"ProgramFiles(x86)": "C:\\Program Files (x86)",
		},
		() => {
			const roots = installRootCandidates("D:\\custom\\OfficeAce");
			assert.equal(roots[0], "D:\\custom\\OfficeAce");
			assert.equal(
				roots[1],
				"C:\\Users\\demo\\AppData\\Local\\Programs\\OfficeAce",
			);
			assert.ok(roots.includes("C:\\Program Files\\OfficeAce"));
		},
	);
});

test("the env root sits between the explicit root and the default", () => {
	withEnv(
		{
			[APP_ROOT_ENV]: "E:\\portable\\OfficeAce",
			LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
			ProgramFiles: undefined,
			"ProgramFiles(x86)": undefined,
		},
		() => {
			assert.deepEqual(installRootCandidates(), [
				"E:\\portable\\OfficeAce",
				"C:\\Users\\demo\\AppData\\Local\\Programs\\OfficeAce",
			]);
		},
	);
});

test("duplicate candidates are collapsed", () => {
	withEnv({ [APP_ROOT_ENV]: "C:\\x", LOCALAPPDATA: undefined, ProgramFiles: undefined, "ProgramFiles(x86)": undefined }, () => {
		assert.deepEqual(installRootCandidates("C:\\x"), ["C:\\x"]);
	});
});

test("storage path is <root>/data/storage.sqlite", () => {
	assert.equal(
		storageDatabasePath("C:\\OfficeAce"),
		"C:\\OfficeAce\\data\\storage.sqlite",
	);
});

test("the session key prefix matches the verified store key", () => {
	assert.equal(SESSION_USER_KEY_PREFIX, "office-claw:oc:session:user:");
});

test("settings file lives in the plugin's own ~/.dsh namespace", () => {
	assert.ok(settingsFilePath().endsWith("dsh-connect-officeace.settings.json"));
});
