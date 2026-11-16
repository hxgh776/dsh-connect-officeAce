/**
 * The upstream: an OpenAI-compatible chat-completions endpoint.
 *
 * What is VERIFIED (see docs/protocol.md §3):
 *
 * - OfficeAce's own API server talks OpenAI-compatible chat completions:
 *   `POST {base}/chat/completions` with `Authorization` set, as seen in the
 *   shipped `@openjiuwen/relay-api-server` bundle; its `relayclaw` client is
 *   only allowed to use `authType: "api_key"` + `protocol: "openai"` profiles.
 * - `https://api.office-claw.com` is the production API host in the shipped
 *   `.env` (`OFFICE_CLAW_API_HOST`), and `https://officeace.chat.huaweicloud-agentarts.com`
 *   is the user-profile endpoint.
 * - The local API server exposes `GET /api/maas-models` for the model list.
 *
 * What is INFERRED:
 *
 * - That the public API base for model calls is `https://api.office-claw.com/v1`
 *   and that a public `GET /models` exists there too. Both are configurable
 *   (`baseUrl` setting) precisely because this was not exercised end to end.
 *
 * This module is transport only: no retries, no token caching, no logging of
 * the credential.
 */

import { OfficeAceError, isAbortError, safeMessage } from "./errors.js";
import { resolveCredential } from "./credentials.js";

/** Production API base — inferred `/v1` suffix; override via settings. */
export const DEFAULT_BASE_URL = "https://api.office-claw.com/v1";

export interface UpstreamOptions {
	/** Live settings getters. */
	getBaseUrl?: () => string;
	getApiKey?: () => string;
	/** Per-request timeout for non-stream calls. */
	timeoutMs?: number;
	/** Injectable for tests; defaults to the global fetch. */
	fetchImpl?: typeof fetch;
}

function trimSlashes(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

/** Map an HTTP failure onto the plugin's error kinds. */
export function classifyFailure(
	httpStatus: number,
	message: string,
): OfficeAceError {
	if (httpStatus === 401 || httpStatus === 403) {
		return new OfficeAceError(
			"OfficeAce 上游拒绝了当前 API Key（401/403），请检查 Key 或 baseUrl。",
			"session_dead",
			{ httpStatus },
		);
	}
	if (httpStatus === 429) {
		return new OfficeAceError("OfficeAce 上游限流，请稍后重试", "rate_limited", { httpStatus });
	}
	if (httpStatus >= 500) {
		return new OfficeAceError(`OfficeAce 上游服务错误：HTTP ${httpStatus}`, "upstream", {
			httpStatus,
		});
	}
	if (httpStatus >= 400) {
		const detail = message.trim();
		return new OfficeAceError(
			`OfficeAce 上游拒绝请求：HTTP ${httpStatus}${detail === "" ? "" : ` ${detail}`}`.slice(0, 240),
			"client",
			{ httpStatus },
		);
	}
	return new OfficeAceError(`OfficeAce 上游调用失败：HTTP ${httpStatus}`, "upstream", { httpStatus });
}

export class OfficeAceUpstream {
	private readonly getBaseUrl: () => string;
	private readonly getApiKey: () => string;
	private readonly timeoutMs: number;
	private readonly fetchImpl: typeof fetch;

	constructor(options: UpstreamOptions = {}) {
		this.getBaseUrl = options.getBaseUrl ?? (() => "");
		this.getApiKey = options.getApiKey ?? (() => "");
		this.timeoutMs = options.timeoutMs ?? 30_000;
		this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
	}

	/** The effective base for the current settings, without a trailing slash. */
	baseUrl(): string {
		const override = trimSlashes(String(this.getBaseUrl() ?? ""));
		return override !== "" ? override : DEFAULT_BASE_URL;
	}

	/** The credential, resolved per call so a card edit takes effect at once. */
	apiKey(): string {
		const direct = String(this.getApiKey() ?? "").trim();
		if (direct !== "") return direct;
		return resolveCredential({}).apiKey;
	}

	/** Request headers. NEVER logged. */
	headers(stream = false): Record<string, string> {
		return {
			Accept: stream ? "text/event-stream" : "application/json",
			Authorization: `Bearer ${this.apiKey()}`,
		};
	}

	/** The model catalog, as `data[]` of whatever shape the endpoint returns. */
	async listModels(signal?: AbortSignal): Promise<unknown[]> {
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.baseUrl()}/models`, {
				headers: this.headers(),
				signal: signal ?? AbortSignal.timeout(this.timeoutMs),
			});
		} catch (error) {
			if (isAbortError(error)) throw error;
			throw new OfficeAceError(`无法连接 OfficeAce 上游：${safeMessage(error)}`, "network", {
				cause: error,
			});
		}
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw classifyFailure(response.status, text.slice(0, 200));
		}
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new OfficeAceError("OfficeAce 模型目录返回了无法解析的响应", "upstream");
		}
		const rows = (body as { data?: unknown })?.data ?? body;
		if (!Array.isArray(rows)) {
			throw new OfficeAceError("OfficeAce 模型目录返回了意外的结构", "upstream");
		}
		return rows;
	}

	/**
	 * POST one chat completion and hand back the raw response.
	 *
	 * The body is the OpenAI chat-completions shape DSH/pi-ai already builds, so
	 * the shim forwards it after replacing only the credential.
	 */
	async chatCompletion(body: unknown, options: { signal?: AbortSignal } = {}): Promise<Response> {
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.baseUrl()}/chat/completions`, {
				method: "POST",
				headers: {
					...this.headers((body as { stream?: unknown })?.stream === true),
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body ?? {}),
				signal: options.signal,
			});
		} catch (error) {
			if (isAbortError(error)) throw error;
			throw new OfficeAceError(`无法连接 OfficeAce 上游：${safeMessage(error)}`, "network", {
				cause: error,
			});
		}
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw classifyFailure(response.status, text.slice(0, 200));
		}
		return response;
	}
}
