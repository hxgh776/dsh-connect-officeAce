import assert from "node:assert/strict";
import test from "node:test";
import type { ResolvedAccess } from "./credentials.js";
import { OfficeAceError } from "./errors.js";
import { OfficeAceUpstream, authorizationOf, classifyFailure, errorMessageOf } from "./upstream.js";

type Handler = (url: string, init: RequestInit | undefined) => Promise<Response> | Response;

function fakeFetch(handler: Handler): typeof fetch {
	return (async (input: unknown, init?: RequestInit) =>
		handler(String(input), init)) as unknown as typeof fetch;
}

function bearerAccess(overrides: Partial<ResolvedAccess> = {}): ResolvedAccess {
	return {
		auth: { kind: "bearer", token: "sk-test", source: "settings" },
		baseUrl: "https://demo.test/v1",
		...overrides,
	};
}

test("listModels calls <base>/models with the bearer credential", async () => {
	let seenUrl = "";
	let seenAuth = "";
	const upstream = new OfficeAceUpstream({
		access: async () => bearerAccess(),
		fetchImpl: fakeFetch((url, init) => {
			seenUrl = url;
			seenAuth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
			return new Response(JSON.stringify({ data: [{ id: "m1" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}),
	});
	const rows = await upstream.listModels();
	assert.equal(seenUrl, "https://demo.test/v1/models");
	assert.equal(seenAuth, "Bearer sk-test");
	assert.deepEqual(rows, [{ id: "m1" }]);
});

test("local-session access becomes HTTP Basic app-key auth", () => {
	const header = authorizationOf({
		auth: { kind: "basic", appKey: "app-key", appSecret: "app-secret", source: "local-session" },
		baseUrl: "https://gw.test/v1",
	});
	assert.equal(header, `Basic ${Buffer.from("app-key:app-secret").toString("base64")}`);
});

test("a trailing slash in the resolved base is trimmed once", async () => {
	let seenUrl = "";
	const upstream = new OfficeAceUpstream({
		access: async () => bearerAccess({ baseUrl: "https://demo.test/v1///" }),
		fetchImpl: fakeFetch((url) => {
			seenUrl = url;
			return new Response("{}", { status: 200 });
		}),
	});
	await upstream.chatCompletion({ model: "m", messages: [] });
	assert.equal(seenUrl, "https://demo.test/v1/chat/completions");
});

test("chatCompletion posts the OpenAI body unchanged", async () => {
	let seenBody = "";
	const upstream = new OfficeAceUpstream({
		access: async () => bearerAccess(),
		fetchImpl: fakeFetch((_url, init) => {
			seenBody = String(init?.body ?? "");
			return new Response("{}", { status: 200 });
		}),
	});
	await upstream.chatCompletion({ model: "m", messages: [] });
	assert.equal(seenBody, JSON.stringify({ model: "m", messages: [] }));
});

test("an unresolved baseUrl is a not_signed_in error, not a request", async () => {
	const upstream = new OfficeAceUpstream({
		access: async () => bearerAccess({ baseUrl: "" }),
		fetchImpl: fakeFetch(() => new Response("{}", { status: 200 })),
	});
	await assert.rejects(upstream.listModels(), (error: unknown) => {
		return error instanceof OfficeAceError && error.kind === "not_signed_in";
	});
});

test("401/403 become session_dead, 429 rate_limited, 5xx upstream", () => {
	assert.equal(classifyFailure(401, "").kind, "session_dead");
	assert.equal(classifyFailure(403, "").kind, "session_dead");
	assert.equal(classifyFailure(429, "").kind, "rate_limited");
	assert.equal(classifyFailure(500, "").kind, "upstream");
	assert.equal(classifyFailure(400, "bad").kind, "client");
});

test("a rejected credential surfaces as OfficeAceError(session_dead)", async () => {
	const upstream = new OfficeAceUpstream({
		access: async () => bearerAccess(),
		fetchImpl: fakeFetch(() => new Response("nope", { status: 401 })),
	});
	await assert.rejects(upstream.listModels(), (error: unknown) => {
		return error instanceof OfficeAceError && error.kind === "session_dead";
	});
});

test("a transport failure surfaces as OfficeAceError(network)", async () => {
	const upstream = new OfficeAceUpstream({
		access: async () => bearerAccess(),
		fetchImpl: fakeFetch(() => {
			throw new Error("connect ECONNREFUSED");
		}),
	});
	await assert.rejects(upstream.listModels(), (error: unknown) => {
		return error instanceof OfficeAceError && error.kind === "network";
	});
});

test("the credential is never echoed into an error message", async () => {
	const upstream = new OfficeAceUpstream({
		access: async () => bearerAccess({ auth: { kind: "bearer", token: "sk-super-secret", source: "settings" } }),
		fetchImpl: fakeFetch(() => new Response("upstream said no", { status: 500 })),
	});
	await assert.rejects(upstream.listModels(), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.ok(!error.message.includes("sk-super-secret"));
		return true;
	});
});

test("errorMessageOf extracts the gateway's error message", () => {
	assert.equal(
		errorMessageOf(JSON.stringify({ error: { code: "ModelArts.81009", message: "Invalid model." } })),
		"Invalid model.",
	);
	assert.equal(errorMessageOf(JSON.stringify({ error_msg: "APIG says no" })), "APIG says no");
	assert.equal(errorMessageOf("plain text"), "plain text");
});
