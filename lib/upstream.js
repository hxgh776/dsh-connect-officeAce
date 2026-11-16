/**
 * The upstream: OfficeAce's model gateway, OpenAI-compatible.
 *
 * What is VERIFIED end-to-end against a signed-in OfficeAce 1.8.1 account
 * (docs/protocol.md §2):
 *
 * - base: `https://<modelInfo.model_api_url_base>/v1`
 * - `GET  /v1/models`            200, `{object:"list", data:[{id, object, created, owned_by}]}`
 * - `POST /v1/chat/completions`  200, SSE with `delta.reasoning_content`,
 *   `delta.tool_calls`, a usage chunk and `data: [DONE]`
 * - auth: HTTP Basic `<model_app_key>:<model_app_secret>`
 *
 * `model_app_key` / `model_app_secret` and the host come from the account's
 * provider state, not from a constant. An explicit API key (settings or
 * `DSH_OFFICEACE_API_KEY`) switches the transport to bearer instead.
 *
 * This module is transport only: no retries, no caches beyond the resolver's,
 * and no logging of the credential.
 */
import { OfficeAceError, isAbortError, safeMessage } from "./errors.js";
/** Build the Authorization header value for a resolved access. */
export function authorizationOf(access) {
    if (access.auth.kind === "bearer")
        return `Bearer ${access.auth.token}`;
    return `Basic ${Buffer.from(`${access.auth.appKey}:${access.auth.appSecret}`, "utf8").toString("base64")}`;
}
/** Map an HTTP failure onto the plugin's error kinds. */
export function classifyFailure(httpStatus, message) {
    if (httpStatus === 401 || httpStatus === 403) {
        return new OfficeAceError("OfficeAce 模型网关拒绝了当前凭据（401/403），请重新在 OfficeAce 桌面端登录，或检查设置的 API Key。", "session_dead", { httpStatus });
    }
    if (httpStatus === 429) {
        return new OfficeAceError("OfficeAce 模型网关限流，请稍后重试", "rate_limited", { httpStatus });
    }
    if (httpStatus >= 500) {
        return new OfficeAceError(`OfficeAce 模型网关错误：HTTP ${httpStatus}`, "upstream", { httpStatus });
    }
    if (httpStatus >= 400) {
        const detail = message.trim();
        return new OfficeAceError(`OfficeAce 模型网关拒绝请求：HTTP ${httpStatus}${detail === "" ? "" : ` ${detail}`}`.slice(0, 240), "client", { httpStatus });
    }
    return new OfficeAceError(`OfficeAce 模型网关调用失败：HTTP ${httpStatus}`, "upstream", { httpStatus });
}
/** Pull a human-usable message out of an OpenAI/APIG error body. */
export function errorMessageOf(raw) {
    try {
        const parsed = JSON.parse(raw);
        const candidate = parsed.error?.message ?? parsed.error_msg ?? parsed.message;
        if (typeof candidate === "string")
            return candidate.slice(0, 200);
    }
    catch {
        // not JSON — fall through to the raw slice
    }
    return raw.slice(0, 200);
}
export class OfficeAceUpstream {
    access;
    timeoutMs;
    fetchImpl;
    constructor(options) {
        this.access = options.access;
        this.timeoutMs = options.timeoutMs ?? 30_000;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    }
    /** The effective `/v1` base (no trailing slash). Throws without a credential. */
    async baseUrl() {
        const access = await this.access();
        if (access.baseUrl === "") {
            throw new OfficeAceError("无法确定模型网关地址：本机 OfficeAce 登录态不可读，且没有设置 baseUrl。", "not_signed_in");
        }
        return access.baseUrl.replace(/\/+$/u, "");
    }
    /** Headers for one request. NEVER logged. */
    async headers(stream = false) {
        const access = await this.access();
        return {
            Accept: stream ? "text/event-stream" : "application/json",
            Authorization: authorizationOf(access),
        };
    }
    /** The model catalog: `data[]` (ids only — no context lengths, verified). */
    async listModels(signal) {
        const base = await this.baseUrl();
        let response;
        try {
            response = await this.fetchImpl(`${base}/models`, {
                headers: await this.headers(),
                signal: signal ?? AbortSignal.timeout(this.timeoutMs),
            });
        }
        catch (error) {
            if (isAbortError(error))
                throw error;
            throw new OfficeAceError(`无法连接 OfficeAce 模型网关：${safeMessage(error)}`, "network", {
                cause: error,
            });
        }
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw classifyFailure(response.status, errorMessageOf(text));
        }
        let body;
        try {
            body = await response.json();
        }
        catch {
            throw new OfficeAceError("OfficeAce 模型目录返回了无法解析的响应", "upstream");
        }
        const rows = body?.data ?? body;
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
    async chatCompletion(body, options = {}) {
        const base = await this.baseUrl();
        const headers = await this.headers(body?.stream === true);
        let response;
        try {
            response = await this.fetchImpl(`${base}/chat/completions`, {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify(body ?? {}),
                signal: options.signal,
            });
        }
        catch (error) {
            if (isAbortError(error))
                throw error;
            throw new OfficeAceError(`无法连接 OfficeAce 模型网关：${safeMessage(error)}`, "network", {
                cause: error,
            });
        }
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw classifyFailure(response.status, errorMessageOf(text));
        }
        return response;
    }
}
