import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
	CATALOG_PATH,
	SAVE_PATH,
	STATUS_PATH,
	WRITE_HEADER,
	registerRoutes,
	type RouteDeps,
} from "./routes.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

function captureRoutes(deps: RouteDeps): { ctx: unknown; handlers: Map<string, Handler> } {
	const handlers = new Map<string, Handler>();
	const ctx = {
		webServer: {
			register(spec: { path: string; handler: Handler }) {
				handlers.set(spec.path, spec.handler);
				return () => {};
			},
		},
	};
	registerRoutes(ctx, deps);
	return { ctx, handlers };
}

async function serve(
	handler: Handler,
	run: (base: string) => Promise<void>,
): Promise<void> {
	const server = createServer((req, res) => {
		Promise.resolve(handler(req, res)).catch(() => {
			if (!res.headersSent) {
				res.writeHead(500);
				res.end();
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
	const address = server.address() as AddressInfo;
	try {
		await run(`http://127.0.0.1:${address.port}`);
	} finally {
		server.close();
	}
}

function deps(overrides: Partial<RouteDeps> = {}): RouteDeps {
	return {
		statusView: () => ({ ok: true, credential: { configured: true } }),
		catalogView: async () => ({ ok: true, models: [] }),
		refreshCatalog: async () => {},
		writableFields: () => new Set(["enabledModelIds", "apiKey"]),
		writeField: () => {},
		readSettings: () => ({ apiKey: "sk-secret" }),
		onApplied: () => {},
		...overrides,
	};
}

test("the status route serves an allow-listed JSON view", async () => {
	const { handlers } = captureRoutes(deps());
	const handler = handlers.get(STATUS_PATH);
	assert.ok(handler);
	await serve(handler, async (base) => {
		const response = await fetch(`${base}${STATUS_PATH}`);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "no-store");
		const body = (await response.json()) as { ok?: boolean };
		assert.equal(body.ok, true);
	});
});

test("a non-GET status request is refused", async () => {
	const { handlers } = captureRoutes(deps());
	const handler = handlers.get(STATUS_PATH);
	assert.ok(handler);
	await serve(handler, async (base) => {
		const response = await fetch(`${base}${STATUS_PATH}`, { method: "POST" });
		assert.equal(response.status, 405);
	});
});

test("the save route reads without a CSRF header but refuses to write without one", async () => {
	const writes: Array<{ field: string; value: unknown }> = [];
	const { handlers } = captureRoutes(
		deps({ writeField: (field, value) => writes.push({ field, value }) }),
	);
	const handler = handlers.get(SAVE_PATH);
	assert.ok(handler);
	await serve(handler, async (base) => {
		const read = await fetch(`${base}${SAVE_PATH}`);
		assert.equal(read.status, 200);

		const blocked = await fetch(`${base}${SAVE_PATH}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ field: "apiKey", value: "sk-new" }),
		});
		assert.equal(blocked.status, 403);
		assert.equal(writes.length, 0);

		const allowed = await fetch(`${base}${SAVE_PATH}`, {
			method: "POST",
			headers: { "content-type": "application/json", [WRITE_HEADER]: "1" },
			body: JSON.stringify({ field: "apiKey", value: "sk-new" }),
		});
		assert.equal(allowed.status, 200);
		assert.deepEqual(writes, [{ field: "apiKey", value: "sk-new" }]);
	});
});

test("the save route rejects a field outside the allow-list", async () => {
	const { handlers } = captureRoutes(deps());
	const handler = handlers.get(SAVE_PATH);
	assert.ok(handler);
	await serve(handler, async (base) => {
		const response = await fetch(`${base}${SAVE_PATH}`, {
			method: "POST",
			headers: { "content-type": "application/json", [WRITE_HEADER]: "1" },
			body: JSON.stringify({ field: "nope", value: 1 }),
		});
		assert.equal(response.status, 400);
	});
});

test("POST /catalog forces a refresh before answering", async () => {
	let refreshed = 0;
	const { handlers } = captureRoutes(deps({ refreshCatalog: async () => void (refreshed += 1) }));
	const handler = handlers.get(CATALOG_PATH);
	assert.ok(handler);
	await serve(handler, async (base) => {
		const response = await fetch(`${base}${CATALOG_PATH}`, {
			method: "POST",
			headers: { [WRITE_HEADER]: "1" },
		});
		assert.equal(response.status, 200);
		assert.equal(refreshed, 1);
	});
});
