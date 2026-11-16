/**
 * The read-mostly web routes the settings card consumes.
 *
 * Mounted on the host web server via a NESTED `ctx.inject(["webServer"], ...)`:
 * the service mounts late and may never appear, and naming it at the top level
 * would hold the whole plugin back.
 *
 * Security posture (same as both reference plugins): the host's Connection
 * fence FIRST — Host/Origin checks plus the browser credential every DSH UI
 * request carries. `webServer.register` routes sit outside that fence, so
 * without it a cross-site `fetch` and a plain top-level navigation (which sends
 * no `Origin` header) both reach these handlers. The local checks below
 * (loopback Host, no cross-site fetches, loopback Origin, `no-store`, and a
 * custom CSRF header on the one write route) stay as defence in depth.
 *
 * There is deliberately NO usage/quota route: no OfficeAce usage endpoint could
 * be verified, and a fabricated one would be worse than an honest gap. See
 * docs/protocol.md §5.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { safeMessage } from "./errors.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export const STATUS_PATH = "/plugins/dsh-connect-officeace/status";
export const CATALOG_PATH = "/plugins/dsh-connect-officeace/catalog";
export const SAVE_PATH = "/plugins/dsh-connect-officeace/__save";

/** The CSRF fence header the settings card sends on writes. */
export const WRITE_HEADER = "x-dsh-officeace-write";

/** The subset of `ctx.webServer` this module needs. */
export interface WebServerLike {
	register(spec: {
		kind: "exact";
		path: string;
		handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
	}): () => void;
}

export interface RouteDeps {
	/** Synchronous, allow-listed diagnostics snapshot. */
	statusView: () => unknown;
	/** Async allow-listed catalog view. */
	catalogView: () => Promise<unknown>;
	/** Force a discovery refresh. */
	refreshCatalog: () => Promise<unknown>;
	/** The persistable field allow-list. */
	writableFields: () => ReadonlySet<string>;
	/** Persisted write. */
	writeField: (field: string, value: unknown) => void;
	/** Persisted read. */
	readSettings: () => unknown;
	/** Applied-write hook (update live config, re-arm adapters). */
	onApplied: (field: string, value: unknown) => void;
}

function loopbackHostHeader(req: IncomingMessage): boolean {
	const host = req.headers.host;
	if (host === undefined || String(host).trim() === "") return false;
	try {
		return LOOPBACK_HOSTS.has(new URL(`http://${host}`).hostname);
	} catch {
		return false;
	}
}

function loopbackOrigin(req: IncomingMessage): boolean {
	const origin = req.headers.origin;
	if (origin === undefined || String(origin).trim() === "") return true;
	try {
		return LOOPBACK_HOSTS.has(new URL(origin).hostname);
	} catch {
		return false;
	}
}

/**
 * The host's Connection trust fence, when this build exposes one.
 *
 * `requestRejection` applies DSH's own Host/Origin checks AND requires the
 * browser credential the desktop UI carries. It returns 401/403 to reject and
 * `undefined` to proceed. A throwing fence fails CLOSED.
 */
function connectionRejection(ctx: unknown, req: IncomingMessage): 401 | 403 | undefined {
	try {
		const anyCtx = ctx as { get?: (name: string) => unknown; connection?: unknown };
		const connection =
			typeof anyCtx.get === "function" ? anyCtx.get("connection") : anyCtx.connection;
		const requestRejection = (connection as { requestRejection?: unknown } | undefined)
			?.requestRejection;
		if (typeof requestRejection !== "function") return undefined;
		const rejection = (requestRejection as (request: IncomingMessage) => unknown).call(
			connection,
			req,
		);
		return rejection === 401 || rejection === 403 ? rejection : undefined;
	} catch {
		return 403;
	}
}

/** One gate for every route: host fence first, then the cheap local checks. */
export function guard(
	ctx: unknown,
	req: IncomingMessage,
	res: ServerResponse,
	options: { write?: boolean } = {},
): boolean {
	const rejection = connectionRejection(ctx, req);
	if (rejection !== undefined) {
		json(res, rejection, { error: rejection === 401 ? "not-authenticated" : "origin-not-trusted" });
		return false;
	}
	if (!loopbackHostHeader(req)) {
		json(res, 403, { error: "host-not-loopback" });
		return false;
	}
	if (String(req.headers["sec-fetch-site"] ?? "") === "cross-site") {
		json(res, 403, { error: "origin-not-trusted" });
		return false;
	}
	if (!loopbackOrigin(req)) {
		json(res, 403, { error: "origin-not-trusted" });
		return false;
	}
	if (options.write === true && req.headers[WRITE_HEADER] === undefined) {
		json(res, 403, { error: "missing-write-header" });
		return false;
	}
	return true;
}

function json(res: ServerResponse, status: number, payload: unknown): void {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		"cache-control": "no-store",
	});
	res.end(body);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > 1_048_576) {
				reject(Object.assign(new Error("body too large"), { statusCode: 413 }));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}

/** Register every route. Returns one combined disposer. */
export function registerRoutes(ctx: unknown, deps: RouteDeps): () => void {
	const webServer = (ctx as { webServer?: WebServerLike }).webServer;
	if (webServer === undefined) throw new Error("webServer is not available on this context");
	const disposers: Array<() => void> = [];

	disposers.push(
		webServer.register({
			kind: "exact",
			path: CATALOG_PATH,
			handler: async (req, res) => {
				if (req.method !== "GET" && req.method !== "POST") {
					json(res, 405, { error: "method not allowed" });
					return;
				}
				if (!guard(ctx, req, res, { write: req.method === "POST" })) return;
				if (req.method === "POST") {
					await deps.refreshCatalog().catch(() => {});
				}
				try {
					json(res, 200, await deps.catalogView());
				} catch (error) {
					json(res, 500, { ok: false, error: safeMessage(error) });
				}
			},
		}),
	);

	disposers.push(
		webServer.register({
			kind: "exact",
			path: STATUS_PATH,
			handler: (req, res) => {
				if (req.method !== "GET") {
					json(res, 405, { error: "method not allowed" });
					return;
				}
				if (!guard(ctx, req, res)) return;
				try {
					json(res, 200, deps.statusView());
				} catch (error) {
					json(res, 500, { ok: false, error: safeMessage(error) });
				}
			},
		}),
	);

	disposers.push(
		webServer.register({
			kind: "exact",
			path: SAVE_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST" && req.method !== "GET") {
					json(res, 405, { error: "method not allowed" });
					return;
				}
				if (!guard(ctx, req, res, { write: req.method === "POST" })) return;
				if (req.method === "GET") {
					try {
						json(res, 200, { ok: true, value: deps.readSettings() });
					} catch (error) {
						json(res, 500, { ok: false, error: safeMessage(error) });
					}
					return;
				}
				try {
					const body = (await readJsonBody(req)) as { field?: unknown; value?: unknown };
					const field = typeof body?.field === "string" ? body.field : undefined;
					if (field === undefined || !deps.writableFields().has(field)) {
						json(res, 400, {
							error: `field must be one of: ${[...deps.writableFields()].join(", ")}`,
						});
						return;
					}
					deps.writeField(field, body?.value);
					deps.onApplied(field, body?.value);
					json(res, 200, { ok: true, value: deps.readSettings() });
				} catch (error) {
					const name = (error as { name?: string })?.name ?? "unknown";
					json(res, 400, { ok: false, errorName: name, error: safeMessage(error) });
				}
			},
		}),
	);

	return () => {
		for (const dispose of disposers) {
			try {
				dispose?.();
			} catch {
				// a host that already tore the routes down must not block unload
			}
		}
		disposers.length = 0;
	};
}
