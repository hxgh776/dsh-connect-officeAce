/**
 * `dsh-connect-officeace doctor` — read-only diagnostics.
 *
 * Five checks, none of which consumes inference quota:
 *
 * 1. the OfficeAce installation and its local store are where we expect;
 * 2. the store opens and answers a query;
 * 3. a session record exists and is not expired;
 * 4. a model credential is configured (settings or environment);
 * 5. optionally, the upstream `/models` answers (`--network`).
 *
 * Exit codes: 0 all good, 1 at least one check failed, 2 bad usage.
 */

import { credentialState } from "./credentials.js";
import { readLocalState, resolveDatabasePath } from "./local-store.js";
import { isSessionExpired } from "./session.js";
import type { OfficeAceSessionRecord } from "./types.js";
import { readStoredSettings } from "./store.js";
import { OfficeAceUpstream } from "./upstream.js";

interface CheckResult {
	id: string;
	ok: boolean;
	detail: string;
}

interface DoctorOptions {
	json: boolean;
	installRoot: string;
	baseUrl: string;
	network: boolean;
}

function parseArgs(argv: string[]): DoctorOptions | undefined {
	const options: DoctorOptions = { json: false, installRoot: "", baseUrl: "", network: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index] ?? "";
		if (arg === "--json") options.json = true;
		else if (arg === "--network") options.network = true;
		else if (arg === "--install-root") {
			const value = argv[index + 1];
			if (value === undefined) return undefined;
			options.installRoot = value;
			index += 1;
		} else if (arg === "--base-url") {
			const value = argv[index + 1];
			if (value === undefined) return undefined;
			options.baseUrl = value;
			index += 1;
		} else if (arg === "-h" || arg === "--help") return undefined;
		else return undefined;
	}
	return options;
}

function sessionCheck(record: OfficeAceSessionRecord | undefined, now: number): CheckResult {
	if (record === undefined) {
		return { id: "session", ok: false, detail: "本地状态库里没有登录记录（请先在 OfficeAce 桌面端登录）" };
	}
	if (isSessionExpired(record, now)) {
		return {
			id: "session",
			ok: false,
			detail: `登录记录已过期/需重新登录（expiresAt=${record.expiresAt ?? "未知"}）`,
		};
	}
	return {
		id: "session",
		ok: true,
		detail: `已登录（provider=${record.providerId}，expiresAt=${record.expiresAt ?? "未声明"}）`,
	};
}

async function run(options: DoctorOptions): Promise<{ checks: CheckResult[]; ok: boolean }> {
	const checks: CheckResult[] = [];
	const now = Date.now();

	const databasePath = resolveDatabasePath({ installRoot: options.installRoot });
	checks.push({
		id: "install",
		ok: databasePath !== undefined,
		detail:
			databasePath !== undefined
				? "找到 OfficeAce 本地状态库 data/storage.sqlite"
				: "未找到 OfficeAce 安装（可用 --install-root 指定，或设置 DSH_OFFICEACE_APP_ROOT）",
	});

	const local = readLocalState({ installRoot: options.installRoot });
	checks.push({
		id: "local-store",
		ok: local.available,
		detail: local.available
			? "本地状态库可读（只读打开）"
			: `本地状态库不可读：${local.error ?? "unknown"}${local.errorDetail === undefined ? "" : ` (${local.errorDetail})`}`,
	});

	checks.push(sessionCheck(local.session, now));

	const stored = readStoredSettings();
	const credential = credentialState({ apiKey: stored.apiKey });
	checks.push({
		id: "credential",
		ok: credential.configured,
		detail: credential.configured
			? `模型凭据已配置（来源：${credential.source}）`
			: (credential.message ?? "未配置模型凭据"),
	});

	if (options.network) {
		const upstream = new OfficeAceUpstream({
			getBaseUrl: () => options.baseUrl || stored.baseUrl || "",
			getApiKey: () => stored.apiKey ?? "",
		});
		try {
			const rows = await upstream.listModels();
			checks.push({
				id: "upstream",
				ok: rows.length > 0,
				detail:
					rows.length > 0
						? `上游 /models 可用（${rows.length} 个模型）`
						: "上游 /models 返回空目录",
			});
		} catch (error) {
			checks.push({
				id: "upstream",
				ok: false,
				detail: `上游 /models 失败：${error instanceof Error ? error.message : String(error)}`,
			});
		}
	} else {
		checks.push({ id: "upstream", ok: true, detail: "跳过（加 --network 探测上游 /models）" });
	}

	return { checks, ok: checks.every((check) => check.ok) };
}

function printHuman(checks: CheckResult[]): void {
	for (const check of checks) {
		const mark = check.ok ? "OK  " : "FAIL";
		console.log(`${mark} ${check.id.padEnd(12)} ${check.detail}`);
	}
}

async function main(): Promise<number> {
	const options = parseArgs(process.argv.slice(2));
	if (options === undefined) {
		console.error("用法: dsh-connect-officeace doctor [--json] [--network] [--install-root <dir>] [--base-url <url>]");
		return 2;
	}
	const { checks, ok } = await run(options);
	if (options.json) console.log(JSON.stringify({ ok, checks }, null, 2));
	else printHuman(checks);
	return ok ? 0 : 1;
}

main().then(
	(code) => {
		process.exitCode = code;
	},
	(error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	},
);
