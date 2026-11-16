import assert from "node:assert/strict";
import test from "node:test";
import { OfficeAceError } from "./errors.js";
import { DEFAULT_BASE_URL, OfficeAceUpstream, classifyFailure } from "./upstream.js";

type Handler = (url: string, init: RequestInit | undefined) => Promise<Response> | Response;

function fakeFetch(handler: Handler): typeof fetch {
	return (async (input: unknown, init?: RequestInit) =>
		handler(String(input), init)) as unknown as typeof fetch;
}

test("listModels calls <base>/models with the bearer credential", async () => {
	let seenUrl = "";
	let seenAuth = "";
	const upstream = new OfficeAceUpstream({
		getApiKey: () => "sk-test",
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
	assert.equal(seenUrl, `${DEFAULT_BASE_URL}/models`);
	assert.equal(seenAuth, "Bearer sk-test");
	assert.deepEqual(rows, [{ id: "m1" }]);
});

test("a baseUrl override is trimmed of trailing slashes", () => {
	const upstream = new OfficeAceUpstream({ getBaseUrl: () => "https://x.test/v1///" });
	assert.equal(upstream.baseUrl(), "https://x.test/v1");
});

test("chatCompletion posts the OpenAI body and replaces only the credential", async () => {
	let seenBody = "";
	const upstream = new OfficeAceUpstream({
		getApiKey: () => "sk-test",
		fetchImpl: fakeFetch((_url, init) => {
			seenBody = String(init?.body ?? "");
			return new Response("{}", { status: 200 });
		}),
	});
	await upstream.chatCompletion({ model: "m", messages: [] });
	assert.equal(seenBody, JSON.stringify({ model: "m", messages: [] }));
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
		getApiKey: () => "bad",
		fetchImpl: fakeFetch(() => new Response("nope", { status: 401 })),
	});
	await assert.rejects(upstream.listModels(), (error: unknown) => {
		return error instanceof OfficeAceError && error.kind === "session_dead";
	});
});

test("a transport failure surfaces as OfficeAceError(network)", async () => {
	const upstream = new OfficeAceUpstream({
		getApiKey: () => "sk-test",
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
		getApiKey: () => "sk-super-secret",
		fetchImpl: fakeFetch(() => new Response("upstream said no", { status: 500 })),
	});
	await assert.rejects(upstream.listModels(), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.ok(!error.message.includes("sk-super-secret"));
		return true;
	});
});
