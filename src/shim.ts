/**
 * The loopback shim: the HTTP surface pi-ai talks to.
 *
 * `http://127.0.0.1:<ephemeral>/v1` with a per-process bearer secret. DSH's
 * pi-ai provider sends OpenAI-shaped requests; the shim forwards them to the
 * OfficeAce upstream with the configured credential and pipes the response
 * straight back — the upstream is OpenAI-compatible, so tools, reasoning deltas
 * and usage chunks pass through untouched.
 *
 * Hardening follows the two reference plugins:
 * - ephemeral port bound to 127.0.0.1 only;
 * - a per-process secret compared with `timingSafeEqual`, length-checked first;
 * - Host must be loopback, browser Origin (when present) must be loopback;
 * - JSON body cap 64 MB (vision requests carry base64 images);
 * - nothing secret ever enters a response body.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { OfficeAceError, isAbortError, safeMessage } from "./errors.js";
import type { OfficeAceErrorKind } from "./errors.js";
import type { OfficeAceModelRow } from "./types.js";
import type { OfficeAceUpstream } from "./upstream.js";

/** Body cap: 64 MB, matching the siblings' vision-friendly bound. */
const BODY_LIMIT = 67_108_864;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Abort the upstream fetch after this much silence on a stream. */
const STREAM_IDLE_TIMEOUT_MS = 300_000;

const STATUS_BY_KIND: Record<OfficeAceErrorKind, number> = {
	not_signed_in: 401,
	session_dead: 401,
	rate_limited: 429,
	network: 502,
	upstream: 502,
	client: 400,
	unsupported: 501,
};

function hostnameOf(host: string | undefined): string {
	let value = String(host ?? "").trim().toLowerCase();
	if (value.startsWith("[")) {
		const end = value.indexOf("]");
		return end === -1 ? value : value.slice(0, end + 1);
	}
	const colon = value.lastIndexOf(":");
	if (colon !== -1 && /^\d+$/.test(value.slice(colon + 1))) value = value.slice(0, colon);
	return value;
}

function hostIsLoopback(host: string | undefined): boolean {
	const value = hostnameOf(host);
	return value !== "" && LOOPBACK_HOSTS.has(value);
}

function originIsLoopback(origin: string | undefined): boolean {
	const raw = String(origin ?? "").trim();
	if (raw === "") return true;
	try {
		return LOOPBACK_HOSTS.has(new URL(raw).hostname);
	} catch {
		return false;
	}
}

/** Constant-time bearer check, length pre-checked (timingSafeEqual throws otherwise). */
function bearerMatches(header: string | undefined, secret: string): boolean {
	const raw = String(header ?? "").trim();
	const prefix = "Bearer ";
	if (!raw.startsWith(prefix)) return false;
	const provided = Buffer.from(raw.slice(prefix.length), "utf8");
	const expected = Buffer.from(secret, "utf8");
	if (provided.length !== expected.length) return false;
	return timingSafeEqual(provided, expected);
}

function writeJson(
	res: ServerResponse,
	status: number,
	body: unknown,
	extraHeaders?: Record<string, string>,
): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(payload),
		"Cache-Control": "no-store",
		...(extraHeaders ?? {}),
	});
	res.end(payload);
}

/** The OpenAI error envelope pi-ai's retry layer reads. */
function writeOpenAIError(res: ServerResponse, status: number, type: string, message: string): void {
	const shouldRetry = status === 429 || status >= 500 ? "true" : "false";
	writeJson(res, status, { error: { message, type, code: type } }, { "x-should-retry": shouldRetry });
}

function readBody(req: IncomingMessage, limit = BODY_LIMIT): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > limit) {
				reject(Object.assign(new Error("request body too large"), { statusCode: 413 }));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

export interface ShimOptions {
	upstream: OfficeAceUpstream;
	/** Live normalized rows; `undefined` means "not discovered yet". */
	modelsProvider: () => OfficeAceModelRow[] | undefined;
	/** Slowest tolerated stream silence, overridable for tests. */
	streamIdleTimeoutMs?: number;
	/** Body cap, overridable for tests. */
	bodyLimit?: number;
}

export interface Shim {
	/** Resolves once the socket is listening; rejects on bind failure. */
	ready: Promise<void>;
	/** The per-process bearer secret pi-ai sends as its apiKey. */
	token(): string;
	/** `http://127.0.0.1:<port>`; throws before the socket listens. */
	baseUrl(): string;
	/** The same origin, or `undefined` before listening (sync callers). */
	baseUrlSync(): string | undefined;
	close(): void;
}

export function createShim(options: ShimOptions): Shim {
	const { upstream, modelsProvider } = options;
	const streamIdleTimeoutMs = options.streamIdleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;
	const bodyLimit = options.bodyLimit ?? BODY_LIMIT;

	const secret = randomBytes(32).toString("base64url");
	const server: Server = createServer();
	let listening = false;

	const ready = new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	}).then(() => {
		listening = true;
	});

	server.on("request", (req: IncomingMessage, res: ServerResponse) => {
		// Cheap header gates first: a rejected request never reaches the
		// filesystem or the upstream.
		if (!hostIsLoopback(req.headers.host)) {
			writeJson(res, 403, { error: "host-not-loopback" });
			return;
		}
		if (!originIsLoopback(req.headers.origin)) {
			writeJson(res, 403, { error: "origin-not-trusted" });
			return;
		}
		if (!bearerMatches(req.headers.authorization, secret)) {
			writeOpenAIError(res, 401, "invalid_api_key", "invalid loopback shim credential");
			return;
		}

		const url = new URL(req.url ?? "/", "http://127.0.0.1");

		if (req.method === "GET" && url.pathname === "/healthz") {
			writeJson(res, 200, { ok: true, provider: "officeace" });
			return;
		}

		if (req.method === "GET" && url.pathname === "/v1/models") {
			const rows = modelsProvider();
			if (rows === undefined) {
				writeOpenAIError(res, 503, "models_unavailable", "OfficeAce model catalog is not loaded yet");
				return;
			}
			writeJson(res, 200, {
				object: "list",
				data: rows.map((row) => ({
					id: row.id,
					object: "model",
					created: row.created,
					owned_by: row.ownedBy,
				})),
			});
			return;
		}

		if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
			void handleChat(req, res, url).catch(() => {
				if (!res.headersSent) writeOpenAIError(res, 502, "SERVER", "shim failure");
				else res.end();
			});
			return;
		}

		writeOpenAIError(res, 404, "not_found", `no route for ${req.method} ${url.pathname}`);
	});

	async function handleChat(
		req: IncomingMessage,
		res: ServerResponse,
		_url: URL,
	): Promise<void> {
		let body: unknown;
		try {
			const raw = await readBody(req, bodyLimit);
			if (raw.length === 0) throw Object.assign(new Error("empty body"), { statusCode: 400 });
			body = JSON.parse(raw.toString("utf8"));
		} catch (error) {
			const status = (error as { statusCode?: number })?.statusCode ?? 400;
			writeOpenAIError(res, status, "invalid_request_error", "invalid JSON body");
			return;
		}
		if (typeof (body as { model?: unknown })?.model !== "string") {
			writeOpenAIError(res, 400, "invalid_request_error", "model is required");
			return;
		}

		const wantsStream = (body as { stream?: unknown }).stream === true;
		const upstreamController = new AbortController();
		let idleTimer: NodeJS.Timeout = setTimeout(
			() => upstreamController.abort(new Error("stream idle timeout")),
			streamIdleTimeoutMs,
		);
		const bumpIdle = (): void => {
			clearTimeout(idleTimer);
			idleTimer = setTimeout(
				() => upstreamController.abort(new Error("stream idle timeout")),
				streamIdleTimeoutMs,
			);
		};
		const disarmIdle = (): void => clearTimeout(idleTimer);

		req.on("close", () => {
			if (!res.writableEnded) upstreamController.abort(new Error("client closed"));
		});

		let response: Response;
		try {
			response = await upstream.chatCompletion(body, { signal: upstreamController.signal });
		} catch (error) {
			disarmIdle();
			if (error instanceof OfficeAceError) {
				const status = STATUS_BY_KIND[error.kind] ?? 502;
				writeOpenAIError(res, status, error.kind.toUpperCase(), error.message);
				return;
			}
			if (isAbortError(error)) {
				writeOpenAIError(res, 504, "TIMEOUT", "OfficeAce upstream timed out");
				return;
			}
			writeOpenAIError(res, 502, "SERVER", safeMessage(error));
			return;
		}

		const headers = { "Cache-Control": "no-store", "X-Accel-Buffering": "no" };
		if (!wantsStream) {
			disarmIdle();
			const text = await response.text().catch(() => "");
			res.writeHead(response.status, {
				...headers,
				"Content-Type": "application/json; charset=utf-8",
			});
			res.end(text);
			return;
		}

		res.writeHead(response.status, {
			...headers,
			"Content-Type": "text/event-stream; charset=utf-8",
			Connection: "keep-alive",
		});
		res.flushHeaders?.();
		try {
			const reader = response.body?.getReader();
			if (reader === undefined) throw new Error("upstream returned no body");
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				bumpIdle();
				if (value !== undefined) res.write(Buffer.from(value));
			}
			res.end();
		} catch (error) {
			if (!res.writableEnded) {
				// A mid-stream failure can only be signalled in-band; SSE
				// consumers treat an unannounced close as an error.
				try {
					res.write(
						`data: ${JSON.stringify({ error: { message: safeMessage(error), type: "SERVER", code: "SERVER" } })}\n\n`,
					);
					res.write("data: [DONE]\n\n");
				} catch {
					// the socket is already gone — nothing left to signal
				}
				res.end();
			}
		} finally {
			disarmIdle();
		}
	}

	return {
		ready,
		token: () => secret,
		baseUrl() {
			if (!listening) throw new Error("officeace shim is not listening yet");
			return originOf(server) ?? "http://127.0.0.1:0";
		},
		baseUrlSync: () => originOf(server),
		close() {
			server.close();
		},
	};
}

function originOf(server: Server): string | undefined {
	const address = server.address();
	if (typeof address !== "object" || address === null) return undefined;
	const port = (address as AddressInfo).port;
	return `http://127.0.0.1:${port}`;
}
