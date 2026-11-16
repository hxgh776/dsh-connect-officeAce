import assert from "node:assert/strict";
import test from "node:test";
import { chatModelsOf } from "./catalog.js";
import { createShim } from "./shim.js";
import type { OfficeAceUpstream } from "./upstream.js";

function fakeUpstream(
	handler: (body: unknown, options: { signal?: AbortSignal }) => Promise<Response>,
): OfficeAceUpstream {
	return { chatCompletion: handler } as unknown as OfficeAceUpstream;
}

async function withShim(
	run: (shim: ReturnType<typeof createShim>, upstream: OfficeAceUpstream) => Promise<void>,
	upstream = fakeUpstream(async () => new Response("{}", { status: 200 })),
): Promise<void> {
	const shim = createShim({
		upstream,
		modelsProvider: () => chatModelsOf([{ id: "deepseek-v4.1-flash", context_length: 64000 }]),
	});
	await shim.ready;
	try {
		await run(shim, upstream);
	} finally {
		shim.close();
	}
}

test("a request without the shim secret is rejected", async () => {
	await withShim(async (shim) => {
		const response = await fetch(`${shim.baseUrl()}/v1/models`);
		assert.equal(response.status, 401);
		const body = (await response.json()) as { error?: { type?: string } };
		assert.equal(body.error?.type, "invalid_api_key");
	});
});

test("a request with the shim secret sees the catalog", async () => {
	await withShim(async (shim) => {
		const response = await fetch(`${shim.baseUrl()}/v1/models`, {
			headers: { authorization: `Bearer ${shim.token()}` },
		});
		assert.equal(response.status, 200);
		const body = (await response.json()) as { data?: Array<{ id?: string }> };
		assert.equal(body.data?.[0]?.id, "deepseek-v4.1-flash");
	});
});

test("chat completions pass a non-streaming JSON body straight through", async () => {
	const upstream = fakeUpstream(
		async () =>
			new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
	);
	await withShim(async (shim) => {
		const response = await fetch(`${shim.baseUrl()}/v1/chat/completions`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${shim.token()}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ model: "m", messages: [], stream: false }),
		});
		assert.equal(response.status, 200);
		const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
		assert.equal(body.choices?.[0]?.message?.content, "ok");
	}, upstream);
});

test("streaming responses keep their SSE framing and DONE sentinel", async () => {
	const encoder = new TextEncoder();
	const upstream = fakeUpstream(async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'),
				);
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
				controller.close();
			},
		});
		return new Response(stream, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	});
	await withShim(async (shim) => {
		const response = await fetch(`${shim.baseUrl()}/v1/chat/completions`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${shim.token()}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ model: "m", messages: [], stream: true }),
		});
		assert.equal(response.status, 200);
		const text = await response.text();
		assert.match(text, /"content":"hi"/u);
		assert.match(text, /data: \[DONE\]/u);
	}, upstream);
});

test("an upstream failure is mapped to a retryable OpenAI error envelope", async () => {
	const upstream = fakeUpstream(async () => {
		throw Object.assign(new Error("boom"), { kind: "upstream" });
	});
	await withShim(async (shim) => {
		const response = await fetch(`${shim.baseUrl()}/v1/chat/completions`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${shim.token()}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ model: "m", messages: [] }),
		});
		assert.equal(response.status, 502);
	}, upstream);
});
