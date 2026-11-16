import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AccessResolver, API_KEY_ENV, PROVIDER_STATE_FILE_ENV } from "./credentials.js";
import { authorizationOf } from "./upstream.js";
import type { LocalSessionReader, ModelGateway } from "./wincred.js";
import type { LocalState } from "./types.js";

const GATEWAY: ModelGateway = {
	host: "modelgw-demo.example.test",
	baseUrl: "https://modelgw-demo.example.test/v1",
	appKey: "app-key-test",
	appSecret: "app-secret-test",
	accountId: "0".repeat(32),
	userName: "demo-user",
};

const LOCAL_STATE: LocalState = {
	available: true,
	databasePath: "C:\\fake\\storage.sqlite",
	session: {
		sessionId: "s",
		providerId: "huawei-oauth",
		userId: "org:user",
		needsReauth: false,
		providerStateRef: "wincred://OfficeAce/x/provider-state",
	},
};

function localReader(result: Awaited<ReturnType<LocalSessionReader["read"]>>, calls?: { count: number }): LocalSessionReader {
	return {
		read: async () => {
			if (calls !== undefined) calls.count += 1;
			return result;
		},
	};
}

test("an explicit API key wins and uses the gateway base when baseUrl is empty", async () => {
	const resolver = new AccessResolver({
		settings: () => ({ apiKey: "sk-test" }),
		env: {},
		readLocalState: () => LOCAL_STATE,
		localReader: localReader({ ok: true, gateway: GATEWAY }),
	});
	const access = await resolver.resolve();
	assert.equal(access.auth.kind, "bearer");
	assert.equal(access.auth.source, "settings");
	if (access.auth.kind === "bearer") assert.equal(access.auth.token, "sk-test");
	assert.equal(access.baseUrl, GATEWAY.baseUrl);
});

test("the environment key is the second choice", async () => {
	const resolver = new AccessResolver({
		settings: () => ({}),
		env: { [API_KEY_ENV]: "sk-env" },
		localReader: localReader({ ok: true, gateway: GATEWAY }),
		readLocalState: () => LOCAL_STATE,
	});
	const access = await resolver.resolve();
	assert.equal(access.auth.kind, "bearer");
	assert.equal(access.auth.source, "env");
});

test("with no explicit key, the local session yields Basic auth and the gateway base", async () => {
	const resolver = new AccessResolver({
		settings: () => ({}),
		env: {},
		readLocalState: () => LOCAL_STATE,
		localReader: localReader({ ok: true, gateway: GATEWAY }),
	});
	const access = await resolver.resolve();
	assert.equal(access.auth.kind, "basic");
	assert.equal(access.auth.source, "local-session");
	assert.equal(access.baseUrl, GATEWAY.baseUrl);
	const header = authorizationOf(access);
	assert.equal(header, `Basic ${Buffer.from("app-key-test:app-secret-test").toString("base64")}`);
});

test("a baseUrl setting overrides the local gateway base without changing the auth source", async () => {
	const resolver = new AccessResolver({
		settings: () => ({ baseUrl: "https://override.test/v1/" }),
		env: {},
		readLocalState: () => LOCAL_STATE,
		localReader: localReader({ ok: true, gateway: GATEWAY }),
	});
	const access = await resolver.resolve();
	assert.equal(access.baseUrl, "https://override.test/v1");
	assert.equal(access.auth.source, "local-session");
});

test("nothing resolvable throws a not_signed_in error with an actionable message", async () => {
	const resolver = new AccessResolver({
		settings: () => ({}),
		env: {},
		readLocalState: () => ({ available: false, databasePath: undefined }),
		localReader: localReader({ ok: false, error: "exec_failed" }),
	});
	await assert.rejects(resolver.resolve(), (error: unknown) => {
		return (
			error instanceof Error &&
			(error as { kind?: string }).kind === "not_signed_in" &&
			/winc/iu.test(error.message) === false &&
			error.message.includes("OfficeAce")
		);
	});
	const status = await resolver.status();
	assert.equal(status.configured, false);
	assert.equal(status.source, null);
});

test("resolution is cached until invalidated", async () => {
	const calls = { count: 0 };
	const resolver = new AccessResolver({
		settings: () => ({}),
		env: {},
		readLocalState: () => LOCAL_STATE,
		localReader: localReader({ ok: true, gateway: GATEWAY }, calls),
	});
	await resolver.resolve();
	await resolver.resolve();
	assert.equal(calls.count, 1);
	assert.ok(resolver.peek());
	resolver.invalidate();
	assert.equal(resolver.peek(), undefined);
	await resolver.resolve();
	assert.equal(calls.count, 2);
});

test("a provider-state file override feeds the same gateway path", async () => {
	const dir = mkdtempSync(join(tmpdir(), "officeace-state-"));
	try {
		const file = join(dir, "provider-state.json");
		writeFileSync(
			file,
			JSON.stringify({
				schemaVersion: 1,
				providerState: {
					modelInfo: {
						model_api_url_base: "modelgw-file.example.test",
						model_auth_info: { model_app_key: "file-key", model_app_secret: "file-secret" },
					},
				},
			}),
			"utf8",
		);
		const resolver = new AccessResolver({
			settings: () => ({}),
			env: { [PROVIDER_STATE_FILE_ENV]: file },
			readLocalState: () => ({ available: false, databasePath: undefined }),
		});
		const access = await resolver.resolve();
		assert.equal(access.baseUrl, "https://modelgw-file.example.test/v1");
		assert.equal(access.auth.kind, "basic");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
