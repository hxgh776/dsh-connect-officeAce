import assert from "node:assert/strict";
import test from "node:test";
import {
	createLocalSessionReader,
	decodeProviderStateText,
	modelGatewayOf,
	parseManifest,
	parseProviderState,
	wincredTargetOf,
} from "./wincred.js";

const MANIFEST = JSON.stringify({
	schemaVersion: 2,
	encoding: "base64",
	storageId: "abc123",
	chunkCount: 2,
});

const STATE = {
	schemaVersion: 1,
	providerState: {
		authType: "huawei-oauth",
		accountId: "0".repeat(32),
		userName: "demo-user",
		modelInfo: {
			model_api_url_base: "modelgw-demo.example.test",
			model_auth_info: { model_app_key: "app-key-test", model_app_secret: "app-secret-test" },
		},
		credentialV3: { expires_at: "2026-11-16T15:12:35.397Z" },
	},
};

/** Split a base64 payload into fixed-size chunk strings, like OfficeAce does. */
function chunk(base64: string, size: number): string[] {
	const out: string[] = [];
	for (let index = 0; index < base64.length; index += size) {
		out.push(base64.slice(index, index + size));
	}
	return out;
}

const PAYLOAD_B64 = Buffer.from(JSON.stringify(STATE), "utf8").toString("base64");
const CHUNKS = chunk(PAYLOAD_B64, 40);
const MANIFEST_FOR_CHUNKS = JSON.stringify({
	schemaVersion: 2,
	encoding: "base64",
	storageId: "abc123",
	chunkCount: CHUNKS.length,
});

function fakeExec(envelope: unknown) {
	const calls: string[] = [];
	const exec = async (encoded: string) => {
		calls.push(encoded);
		return { ok: true, stdout: JSON.stringify(envelope) };
	};
	return { exec, calls };
}

test("wincredTargetOf strips the scheme and refuses junk", () => {
	assert.equal(
		wincredTargetOf("wincred://OfficeAce/auth-sessions/huawei-oauth/org:user/provider-state"),
		"OfficeAce/auth-sessions/huawei-oauth/org:user/provider-state",
	);
	assert.equal(wincredTargetOf("https://nope"), undefined);
	assert.equal(wincredTargetOf("wincred://"), undefined);
	assert.equal(wincredTargetOf(undefined), undefined);
});

test("parseManifest accepts the verified shape and rejects invalid ones", () => {
	assert.deepEqual(parseManifest(MANIFEST), {
		schemaVersion: 2,
		encoding: "base64",
		storageId: "abc123",
		chunkCount: 2,
	});
	assert.equal(parseManifest("not json"), undefined);
	assert.equal(parseManifest(JSON.stringify({ encoding: "base64", storageId: "a", chunkCount: 0 })), undefined);
	assert.equal(parseManifest(JSON.stringify({ encoding: "utf8", storageId: "a", chunkCount: 1 })), undefined);
	assert.equal(parseManifest(JSON.stringify({ encoding: "base64", storageId: "a/b", chunkCount: 1 })), undefined);
});

test("decodeProviderStateText concatenates chunks then base64-decodes", () => {
	const text = decodeProviderStateText(CHUNKS);
	assert.equal(text, JSON.stringify(STATE));
	assert.throws(() => decodeProviderStateText([]));
});

test("modelGatewayOf builds the /v1 base and keeps no raw token in the summary", () => {
	const gateway = modelGatewayOf(parseProviderState(JSON.stringify(STATE)));
	assert.ok(gateway);
	assert.equal(gateway.host, "modelgw-demo.example.test");
	assert.equal(gateway.baseUrl, "https://modelgw-demo.example.test/v1");
	assert.equal(gateway.appKey, "app-key-test");
	assert.equal(gateway.userName, "demo-user");
	assert.equal(gateway.expiresAt, "2026-11-16T15:12:35.397Z");
});

test("modelGatewayOf tolerates a scheme and a trailing slash in the host", () => {
	const doc = structuredClone(STATE);
	doc.providerState.modelInfo.model_api_url_base = "https://modelgw-demo.example.test/";
	const gateway = modelGatewayOf(parseProviderState(JSON.stringify(doc)));
	assert.equal(gateway?.baseUrl, "https://modelgw-demo.example.test/v1");
});

test("modelGatewayOf refuses a state without the model gateway fields", () => {
	const doc = { providerState: { authType: "huawei-oauth" } };
	assert.equal(modelGatewayOf(parseProviderState(JSON.stringify(doc))), undefined);
	assert.equal(modelGatewayOf(undefined), undefined);
});

test("createLocalSessionReader decodes through the injected transport", async () => {
	const { exec, calls } = fakeExec({ manifest: MANIFEST_FOR_CHUNKS, chunks: CHUNKS });
	const reader = createLocalSessionReader({ exec });
	const result = await reader.read("wincred://OfficeAce/auth-sessions/huawei-oauth/org:user/provider-state");
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.gateway.baseUrl, "https://modelgw-demo.example.test/v1");
		assert.equal(result.gateway.appKey, "app-key-test");
	}
	assert.equal(calls.length, 1);
	// The target must be embedded in the encoded PowerShell command.
	const script = Buffer.from(calls[0] ?? "", "base64").toString("utf16le");
	assert.match(script, /OfficeAce\/auth-sessions\/huawei-oauth\/org:user\/provider-state/u);
});

test("createLocalSessionReader reports failures without throwing or leaking", async () => {
	const execFail = async () => ({ ok: false, stdout: "", error: "exec_failed: EPERM" });
	assert.deepEqual(await createLocalSessionReader({ exec: execFail }).read("wincred://x/y"), {
		ok: false,
		error: "exec_failed",
		detail: "exec_failed: EPERM",
	});

	const badEnvelope = async () => ({ ok: true, stdout: "{not json" });
	assert.equal((await createLocalSessionReader({ exec: badEnvelope }).read("wincred://x/y")).ok, false);

	const shortChunks = async () => ({
		ok: true,
		stdout: JSON.stringify({ manifest: MANIFEST_FOR_CHUNKS, chunks: CHUNKS.slice(1) }),
	});
	const mismatch = await createLocalSessionReader({ exec: shortChunks }).read("wincred://x/y");
	assert.equal(mismatch.ok, false);
	if (!mismatch.ok) assert.equal(mismatch.error, "chunk_count_mismatch");
});

test("createLocalSessionReader rejects an unresolved target", async () => {
	const reader = createLocalSessionReader({ exec: async () => ({ ok: true, stdout: "{}" }) });
	const result = await reader.read(undefined);
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error, "target_unresolved");
});
