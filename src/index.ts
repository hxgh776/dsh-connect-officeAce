/**
 * DSH Connect OfficeAce — plugin entrypoint.
 *
 * Connects the locally installed, signed-in OfficeAce (Huawei Cloud) desktop app
 * to DeepSeek Harness as an OpenAI-compatible model provider:
 *
 *   createShim()        loopback HTTP surface (random port + per-process secret)
 *   createAdapter()     pi-ai provider registered into ctx.llm
 *   readLocalState()    read-only account/diagnostics view
 *   registerRoutes()    read-mostly web routes (status / catalog / save)
 *
 * What this plugin does NOT do, on purpose: read OfficeAce's oauth tokens (they
 * live in Windows Credential Manager — see src/credentials.ts) and show a usage
 * or points board (no OfficeAce usage endpoint could be verified). Both gaps are
 * documented in docs/protocol.md rather than papered over.
 *
 * Isolation follows the reference plugins: only this plugin's settings
 * namespace and `~/.dsh/dsh-connect-officeace.*.json` are touched, and no state
 * is shared with any other plugin.
 *
 * @module dsh-connect-officeace
 */

import z from "@deepseek-ai/schemastery";
import { createAdapter } from "./adapter.js";
import {
	DEFAULT_CONTEXT_WINDOW,
	DEFAULT_MAX_OUTPUT_TOKENS,
	KNOWN_MODEL_IDS,
	OFFICEACE_PROVIDER,
	OFFICEACE_PROVIDER_DISPLAY_NAME,
	VERIFIED_WORKING_MODEL_IDS,
	catalogEntriesOf,
	enabledModelsOf,
} from "./catalog.js";
import { AccessResolver, tokenLocationOf } from "./credentials.js";
import { createDiscovery } from "./discovery.js";
import { readLocalState } from "./local-store.js";
import { CATALOG_PATH, SAVE_PATH, STATUS_PATH, WRITE_HEADER, registerRoutes } from "./routes.js";
import { sessionViewOf } from "./session.js";
import { createShim } from "./shim.js";
import {
	DEFAULT_SETTINGS,
	WRITABLE_FIELDS,
	readStoredSettings,
	type ResolvedSettings,
	withStoredSettings,
	writeStoredSetting,
} from "./store.js";
import { OfficeAceUpstream } from "./upstream.js";

export { OFFICEACE_PROVIDER, OFFICEACE_PROVIDER_DISPLAY_NAME, KNOWN_MODEL_IDS, VERIFIED_WORKING_MODEL_IDS } from "./catalog.js";
export { createAdapter } from "./adapter.js";
export { AccessResolver, MISSING_CREDENTIAL_MESSAGE, tokenLocationOf } from "./credentials.js";
export { createDiscovery } from "./discovery.js";
export { readLocalState, resolveDatabasePath } from "./local-store.js";
export { CATALOG_PATH, SAVE_PATH, STATUS_PATH, WRITE_HEADER, registerRoutes } from "./routes.js";
export { createShim } from "./shim.js";
export { sessionViewOf, isSessionExpired, parseSessionRecord } from "./session.js";
export {
	createLocalSessionReader,
	decodeProviderStateText,
	modelGatewayOf,
	parseManifest,
	parseProviderState,
	wincredTargetOf,
} from "./wincred.js";
export { authorizationOf, classifyFailure } from "./upstream.js";
export {
	DEFAULT_SETTINGS,
	WRITABLE_FIELDS,
	readStoredSettings,
	withStoredSettings,
	writeStoredSetting,
} from "./store.js";
export { OfficeAceUpstream } from "./upstream.js";

const PLUGIN_ID = "dsh-connect-officeace";
const PLUGIN_NAME = "DSH Connect OfficeAce";
export const VERSION = "0.2.0";

/**
 * The plugin's Cordis name — the Loader and the Settings service key on it.
 * It must be the ENTRY ID, not a display title.
 */
const name = PLUGIN_ID;

/**
 * Services required before the provider may register.
 *
 * `inject: ["llm"]` is REQUIRED — touching `ctx.llm` without the declaration
 * throws and silently takes the plugin down. `webServer` and `settings` mount
 * later (or never), so they are NESTED injects inside `apply`.
 */
const inject = ["llm"];

/** The namespace the HOST actually serves this plugin's config under. */
function settingsNamespaceOf(ctx: any): string {
	return ctx.fiber?.entry?.options?.id ?? PLUGIN_ID;
}

/**
 * Mark one schema field volatile — this is what makes it writable from a
 * settings form at all. The desktop host's schemastery has been observed to
 * corrupt volatile fields, so the marker is adopted only when a probe proves it
 * round-trips; the unmarked (still fully valid) schema wins otherwise.
 */
function defaultOfSchema(schema: any): unknown {
	try {
		const validate = schema?.["~standard"]?.validate;
		if (typeof validate !== "function") return undefined;
		const probe = validate(undefined);
		if (probe && typeof probe.then === "function") return undefined;
		return probe?.value;
	} catch {
		return undefined;
	}
}

function asVolatile<T>(schema: T): T {
	const candidate = schema as any;
	if (typeof candidate?.volatile !== "function") return schema;
	let marked: any;
	try {
		marked = candidate.volatile();
	} catch {
		return schema;
	}
	if (typeof marked !== "function") return schema;
	const unmarkedDefault = defaultOfSchema(candidate);
	const markedDefault = defaultOfSchema(marked);
	if (unmarkedDefault === undefined || markedDefault === undefined) return schema;
	return JSON.stringify(unmarkedDefault) === JSON.stringify(markedDefault) ? (marked as T) : schema;
}

/** The settings SCHEMA the Loader reads. Must be a real schemastery schema. */
const Config = z.object({
	enabledModelIds: asVolatile(z.array(z.string()).default([])).description(
		"在 DSH 模型选择器中启用的 OfficeAce 模型 id 列表。留空表示未配置，展示全部（已在设置页保存为空数组时除外）。",
	),
	apiKey: asVolatile(z.string().default("")).description(
		"可选。默认不需要：插件会从本机 OfficeAce 登录态读出模型网关地址与 app-key 凭据（只读、不落盘）。填写后改用该 Key 作为 Bearer 凭据，覆盖本机登录态。",
	),
	baseUrl: asVolatile(z.string().default("")).description(
		"可选。留空时使用从本机 OfficeAce 登录态解析出的模型网关地址（实测 https://<modelInfo.model_api_url_base>/v1）。仅在需要指向别的网关时填写。",
	),
	installRoot: asVolatile(z.string().default("")).description(
		"OfficeAce 安装根目录（其 data/storage.sqlite 为本地状态库）。留空自动探测 %LOCALAPPDATA%\\Programs\\OfficeAce。",
	),
	defaultContextWindow: z
		.number()
		.default(DEFAULT_CONTEXT_WINDOW)
		.description(
			"当 /models 未返回上下文长度时使用的默认值（推断值，非实测）。DSH 会因模型缺少上下文长度而整体拒绝 provider。",
		),
});

/**
 * The ticked ids, or `undefined` when the field is ABSENT — the "not yet
 * configured → serve the whole catalog" state. An explicit empty array means
 * the user deselected everything and is preserved as such.
 */
function effectiveIds(config: Partial<ResolvedSettings> | undefined): string[] | undefined {
	const ids = config?.enabledModelIds;
	if (!Array.isArray(ids) || ids.length === 0) return undefined;
	return ids.filter((entry) => typeof entry === "string");
}

/** The status snapshot shared by the route and the doctor. */
async function statusViewOf(
	current: ResolvedSettings,
	discovery: { describe: () => unknown },
	upstream: OfficeAceUpstream,
	local: ReturnType<typeof readLocalState>,
	access: AccessResolver,
): Promise<Record<string, unknown>> {
	const session = local.session;
	const credential = await access.status();
	return {
		ok: true,
		plugin: PLUGIN_ID,
		version: VERSION,
		provider: OFFICEACE_PROVIDER,
		displayName: OFFICEACE_PROVIDER_DISPLAY_NAME,
		account: sessionViewOf(session),
		local: {
			databaseFound: local.databasePath !== undefined,
			available: local.available,
			error: local.error ?? null,
			appRunning: local.lease !== undefined,
			appVersion: local.lease?.appVersion ?? null,
			apiPort: local.lease?.apiPort ?? null,
		},
		tokenLocation: tokenLocationOf(session?.providerStateRef),
		credential,
		catalog: discovery.describe(),
		baseUrl: credential.baseUrl ?? null,
		knownModelIds: KNOWN_MODEL_IDS,
		verifiedModelIds: VERIFIED_WORKING_MODEL_IDS,
		capabilities: {
			chatCompletions: true,
			toolCallsPassThrough: true,
			streamingReasoning: true,
			usageBoard: false,
			usageBoardReason: "OfficeAce 没有可验证的用量/积分查询接口，本插件不实现（docs/protocol.md §5）",
			reuseLocalLogin: true,
			reuseLocalLoginSource: credential.source,
		},
	};
}

/**
 * Wire the provider and the routes.
 *
 * Every disposer hangs off one `ctx.effect`, so unloading the plugin releases
 * the shim's port, the adapter, the directory entry, the discovery callback and
 * the HTTP routes — nothing outlives the plugin.
 */
function apply(ctx: any, config: Partial<ResolvedSettings> = {}): void {
	let shim: ReturnType<typeof createShim> | undefined;
	let adapterRelease: (() => void) | undefined;
	let directoryRelease: (() => void) | undefined;
	let discoveryRelease: (() => void) | undefined;
	let disposed = false;
	const settingsNs = settingsNamespaceOf(ctx);

	let current: ResolvedSettings = withStoredSettings(config);

	const access = new AccessResolver({
		settings: () => current,
		readLocalState: () => readLocalState({ installRoot: current.installRoot }),
	});
	const upstream = new OfficeAceUpstream({ access: () => access.resolve() });
	const modelDefaults = () => ({
		contextWindow: current.defaultContextWindow,
		maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
	});
	const discovery = createDiscovery(upstream, { modelDefaults });
	const servedRows = () => enabledModelsOf(discovery.current(), effectiveIds(current));

	try {
		shim = createShim({
			upstream,
			modelsProvider: () => {
				const rows = servedRows();
				return rows.length > 0 ? rows : undefined;
			},
		});

		// The adapter is built synchronously: model rows read the shim origin
		// LAZILY (undefined until the socket listens), and the ready callback
		// re-arms it so the host rebuilds descriptors with the real
		// `http://127.0.0.1:<port>/v1`. The `/v1` suffix is REQUIRED because
		// pi-ai appends `/chat/completions` verbatim.
		const shimBaseUrl = (): string | undefined => {
			const origin = shim?.baseUrlSync();
			return origin === undefined ? undefined : `${origin}/v1`;
		};
		const built = createAdapter({
			baseUrl: () => shimBaseUrl() ?? "",
			modelsProvider: servedRows,
			resolveToken: () => shim?.token() ?? "",
		});
		const notifyAdapters = (): void => {
			if (disposed) return;
			try {
				(adapterRelease as unknown as { replace?: (providers: string[]) => void })?.replace?.([
					OFFICEACE_PROVIDER,
				]);
			} catch {
				// a host without `replace` simply keeps the descriptors it has
			}
		};

		adapterRelease = ctx.llm.registerAdapter([OFFICEACE_PROVIDER], built.adapter);
		directoryRelease = ctx.llm.registerConfigurableProviders([
			{
				provider: OFFICEACE_PROVIDER,
				displayName: OFFICEACE_PROVIDER_DISPLAY_NAME,
				settingsNs,
				settingsPath: [],
				declared: false,
			},
		]);

		ctx.effect(() => () => {
			disposed = true;
			adapterRelease?.();
			directoryRelease?.();
			discoveryRelease?.();
			shim?.close();
			shim = undefined;
		});

		try {
			discoveryRelease = ctx.llm.registerModelDiscovery(
				settingsNs,
				async (request: { provider?: string }) => {
					if (request.provider !== undefined && request.provider !== OFFICEACE_PROVIDER) return [];
					await discovery.refresh().catch(() => {});
					return servedRows().map((row) => ({
						id: row.id,
						name: row.name,
						contextWindow: row.contextWindow,
						...(row.maxTokens === undefined ? {} : { maxTokens: row.maxTokens }),
						inputModalities: row.inputModalities,
					}));
				},
			);
		} catch (error) {
			ctx.logger?.error?.("dsh-connect-officeace: model discovery registration failed", error);
		}

		// Warm the catalog and re-arm the adapter once the shim is listening.
		shim.ready
			.then(() => {
				if (disposed) return;
				notifyAdapters();
				discovery
					.refresh({ force: true })
					.then(() => {
						notifyAdapters();
						try {
							ctx.emit?.("llm/models-updated", OFFICEACE_PROVIDER);
						} catch {
							// an older host may not expose the event
						}
					})
					.catch(() => {});
			})
			.catch((error: unknown) => {
				ctx.logger?.error?.("dsh-connect-officeace: shim failed to start", error);
			});

		// Settings presentation, via a NESTED `ctx.inject(["settings"], ...)`.
		const presentationOwner = ctx.fiber;
		try {
			if (typeof ctx.inject === "function") {
				ctx.inject(["settings"], (settingsCtx: any) => {
					const settings = settingsCtx.settings;
					if (settings === undefined || typeof settings.configure !== "function") return;
					const claim = (): unknown => settings.configure({ auto: false }, presentationOwner);
					if (typeof settingsCtx.effect === "function") settingsCtx.effect.call(settingsCtx, claim);
					else claim();
				});
			}
		} catch (error) {
			ctx.logger?.error?.("dsh-connect-officeace: settings presentation registration failed", error);
		}

		const onSettingsChanged = (next: Partial<ResolvedSettings> | undefined): void => {
			if (next !== undefined) current = withStoredSettings(next);
			notifyAdapters();
		};
		try {
			ctx.on("loader/volatile-update", onSettingsChanged);
		} catch {
			// the event exists on this host line; absence is not fatal
		}

		ctx.inject(["webServer"], (webCtx: any) => {
			try {
				const disposeRoutes = registerRoutes(webCtx, {
					statusView: () =>
						statusViewOf(current, discovery, upstream, readLocalState({ installRoot: current.installRoot }), access),
					catalogView: async () => {
						await discovery.refresh().catch(() => {});
						return {
							ok: true,
							source: discovery.describe().source,
							models: catalogEntriesOf(discovery.current()),
							enabled: effectiveIds(current) ?? null,
							knownModelIds: KNOWN_MODEL_IDS,
						};
					},
					refreshCatalog: async () => {
						await discovery.refresh({ force: true });
						notifyAdapters();
					},
					writableFields: () => WRITABLE_FIELDS as ReadonlySet<string>,
					writeField: (field, value) => writeStoredSetting(field, value),
					readSettings: () => readStoredSettings(),
					onApplied: (field, value) => {
						const next: ResolvedSettings = { ...current };
						if (field === "enabledModelIds" && Array.isArray(value)) {
							next.enabledModelIds = value.filter((id): id is string => typeof id === "string");
						} else if (field === "apiKey" && typeof value === "string") {
							next.apiKey = value;
						} else if (field === "baseUrl" && typeof value === "string") {
							next.baseUrl = value;
						} else if (field === "installRoot" && typeof value === "string") {
							next.installRoot = value;
						} else if (field === "defaultContextWindow" && typeof value === "number") {
							next.defaultContextWindow = value;
						} else {
							return;
						}
						current = next;
						access.invalidate();
						notifyAdapters();
					},
				});
				ctx.effect(() => () => disposeRoutes());
			} catch (error) {
				ctx.logger?.error?.("dsh-connect-officeace: web route registration failed", error);
			}
		});
	} catch (error) {
		disposed = true;
		ctx.logger?.error?.("dsh-connect-officeace: provider registration failed", error);
		adapterRelease?.();
		directoryRelease?.();
		discoveryRelease?.();
		shim?.close();
		shim = undefined;
	}
}

const src_default = { name, inject, apply };

export {
	Config,
	PLUGIN_ID,
	PLUGIN_NAME,
	apply,
	effectiveIds,
	inject,
	name,
	settingsNamespaceOf,
	statusViewOf,
	src_default as default,
};
