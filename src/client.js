/**
 * DSH Connect OfficeAce — browser half.
 *
 * Loaded by the desktop shell as a plain script (NOT an ES module). It must stay
 * CommonJS-shaped: `window.__ModuleLoader__.load({ id, factory })` and the
 * factory receives the host's `require`. A top-level `import` here kills the
 * whole web boot ("1 entry did not activate") — the same warning the sibling
 * `dsh-connect-loomy` carries in its `lib/client.js`.
 *
 * Registers one page in the settings left-hand nav ("设置 → OfficeAce") whose
 * card shows:
 *
 * - the local OfficeAce account state (redacted id, expiry) from the status route;
 * - which credential source the server resolved (settings / env / local-session)
 *   and the gateway base URL;
 * - the model checklist, written back through the save route.
 *
 * Every value comes from this plugin's own allow-listed routes. No credential —
 * app-key, STS token, refresh token — is ever sent to the browser; the card can
 * only render what the server chose to expose.
 */
window.__ModuleLoader__.load({
	id: "dsh-connect-officeace",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const react_jsx_runtime = require("react/jsx-runtime");

		//#region contract
		const PLUGIN_ID = "dsh-connect-officeace";
		const NAMESPACE = "settings.officeace";

		const STATUS_PATH = "/plugins/dsh-connect-officeace/status";
		const CATALOG_PATH = "/plugins/dsh-connect-officeace/catalog";
		const SAVE_PATH = "/plugins/dsh-connect-officeace/__save";

		/** CSRF fence the host route requires on writes. */
		const WRITE_HEADERS = { "x-dsh-officeace-write": "1" };
		//#endregion

		//#region helpers
		/** Fetch a JSON route; never throws, returns undefined on failure. */
		async function fetchJson(path, options) {
			try {
				const response = await fetch(path, {
					credentials: "same-origin",
					...(options ?? {}),
				});
				if (!response.ok) return undefined;
				return await response.json();
			} catch {
				return undefined;
			}
		}

		async function fetchStatus(signal) {
			return await fetchJson(STATUS_PATH, {
				method: "GET",
				signal,
				headers: { accept: "application/json" },
			});
		}

		async function fetchCatalog(refresh, signal) {
			return await fetchJson(CATALOG_PATH, {
				method: refresh ? "POST" : "GET",
				signal,
				headers: {
					accept: "application/json",
					...(refresh ? WRITE_HEADERS : {}),
				},
			});
		}

		async function saveField(field, value) {
			return await fetchJson(SAVE_PATH, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					accept: "application/json",
					...WRITE_HEADERS,
				},
				body: JSON.stringify({ field, value }),
			});
		}

		function formatDateTime(iso) {
			if (typeof iso !== "string" || iso === "") return "—";
			const ms = Date.parse(iso);
			if (!Number.isFinite(ms)) return "—";
			try {
				return new Date(ms).toLocaleString();
			} catch {
				return "—";
			}
		}

		/** `local-session` → a human label, everything else passes through. */
		function sourceLabel(source, t) {
			if (source === "local-session") return t("credential.localSession");
			if (source === "settings") return t("credential.settings");
			if (source === "env") return t("credential.env");
			return source || "—";
		}
		//#endregion

		//#region styles
		function ensureStyles() {
			if (document.getElementById("dsh-connect-officeace-styles")) return;
			const el = document.createElement("style");
			el.id = "dsh-connect-officeace-styles";
			el.textContent = `
.oac-card { display: flex; flex-direction: column; gap: 16px; max-width: 760px; }
.oac-header { display: flex; flex-direction: column; gap: 4px; }
.oac-title { font-size: 15px; font-weight: 600; line-height: 1.3; }
.oac-description { font-size: 12px; line-height: 1.5; opacity: 0.65; }
.oac-status { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }
.oac-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: currentColor; opacity: 0.35; }
.oac-dot--ok { background: #16a34a; opacity: 1; box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.15); }
.oac-dot--warn { background: #d97706; opacity: 1; box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.15); }
.oac-status-label { font-weight: 600; }
.oac-status-meta { opacity: 0.55; }
.oac-block { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--dsh-border, rgba(128,128,128,0.25)); border-radius: 10px; padding: 12px 14px; }
.oac-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
.oac-row-label { opacity: 0.6; }
.oac-row-value { text-align: right; word-break: break-all; }
.oac-section-title { font-size: 14px; font-weight: 600; opacity: 0.9; }
.oac-note { font-size: 12px; opacity: 0.6; }
.oac-hint { font-size: 12px; opacity: 0.75; }
.oac-error { font-size: 12px; color: #d97706; word-break: break-word; }
.oac-models { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
.oac-model { display: flex; align-items: center; gap: 8px; border: 1px solid var(--dsh-border, rgba(128,128,128,0.25)); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
.oac-model--verified { border-color: rgba(22, 163, 74, 0.45); }
.oac-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.oac-button { border: 1px solid var(--dsh-border, rgba(128,128,128,0.35)); border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer; background: transparent; color: inherit; }
.oac-button--ghost { margin-left: auto; border-color: transparent; padding: 4px 10px; font-size: 12px; opacity: 0.8; }
.oac-button--ghost:hover { border-color: var(--dsh-border, rgba(128,128,128,0.35)); opacity: 1; }
.oac-button:disabled { opacity: 0.5; cursor: default; }
`;
			document.head.appendChild(el);
		}
		//#endregion

		//#region card
		/**
		 * The OfficeAce settings card.
		 *
		 * Reads status + catalog; writes ONLY `enabledModelIds`. All values are
		 * already allow-listed server-side, so the card has nothing secret to
		 * leak even by accident.
		 */
		function OfficeAceSettingsCard(props) {
			const { t, settingsScope } = props;
			const [status, setStatus] = react.useState(undefined);
			const [catalog, setCatalog] = react.useState(undefined);
			const [selected, setSelected] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [saved, setSaved] = react.useState(false);
			const [saveError, setSaveError] = react.useState(null);

			const load = react.useCallback(async (refresh) => {
				setBusy(refresh === true);
				const [nextStatus, nextCatalog] = await Promise.all([
					fetchStatus(),
					fetchCatalog(refresh === true),
				]);
				setStatus(nextStatus);
				setCatalog(nextCatalog);
				if (nextCatalog?.ok) {
					setSelected((previous) => {
						if (previous !== null) return previous;
						return Array.isArray(nextCatalog.enabled) ? nextCatalog.enabled : null;
					});
				}
				setBusy(false);
			}, []);

			react.useEffect(() => {
				const controller = new AbortController();
				void load(false);
				return () => controller.abort();
			}, [load]);

			// A settings snapshot bump (another writer saved) re-reads the store.
			react.useEffect(() => {
				if (settingsScope === undefined) return;
				setSelected(null);
				void load(false);
			}, [settingsScope?.revision, load]);

			const account = status?.account;
			const credential = status?.credential;
			const signedIn = account?.signedIn === true;
			const expired = account?.expired === true || account?.needsReauth === true;
			const credentialSource = credential?.source ?? null;
			const baseUrl = status?.baseUrl ?? credential?.baseUrl ?? null;

			const models = Array.isArray(catalog?.models) ? catalog.models : [];
			const enabledIds = Array.isArray(catalog?.enabled) ? catalog.enabled : null;
			const checkedIds = selected ?? enabledIds;
			const isChecked = (id) => {
				if (checkedIds === null) return true; // no selection = whole catalog
				return checkedIds.includes(id);
			};

			const toggleModel = (id) => {
				const base = checkedIds === null ? models.map((row) => row.id) : checkedIds;
				const next = new Set(base);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				setSelected([...next]);
				setSaved(false);
				setSaveError(null);
			};

			const saveSelection = async () => {
				setSaveError(null);
				const value = checkedIds === null ? models.map((row) => row.id) : checkedIds;
				const result = await saveField("enabledModelIds", value);
				if (result?.ok === true) {
					setSaved(true);
					void load(false);
				} else {
					setSaveError(result?.error ?? t("save.failed"));
				}
			};

			const refreshCatalog = async () => {
				const next = await fetchCatalog(true);
				if (next?.ok) setCatalog(next);
				else setSaveError(t("models.catalogRefreshFailed"));
			};

			return react_jsx_runtime.jsx("div", {
				className: "oac-card",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "oac-header",
						children: [
							react_jsx_runtime.jsx("div", { className: "oac-title", children: t("card.title") }, "title"),
							react_jsx_runtime.jsx("div", { className: "oac-description", children: t("card.description") }, "description"),
						],
					}, "header"),

					react_jsx_runtime.jsxs("div", {
						className: "oac-status",
						children: [
							react_jsx_runtime.jsx("span", {
								className: signedIn && !expired ? "oac-dot oac-dot--ok" : "oac-dot oac-dot--warn",
							}, "dot"),
							react_jsx_runtime.jsx("span", {
								className: "oac-status-label",
								children: !signedIn
									? t("status.signedOut")
									: expired
										? t("status.expired")
										: t("status.signedIn"),
							}, "label"),
							signedIn && account?.account ? react_jsx_runtime.jsx("span", {
								className: "oac-status-meta",
								children: t("status.account", { id: account.account }),
							}, "account") : null,
							signedIn && account?.expiresAt ? react_jsx_runtime.jsx("span", {
								className: "oac-status-meta",
								children: t("status.expiresAt", { at: formatDateTime(account.expiresAt) }),
							}, "expires") : null,
							react_jsx_runtime.jsx("button", {
								className: "oac-button oac-button--ghost",
								disabled: busy,
								onClick: () => void load(true),
								children: busy ? t("common.loading") : t("common.refresh"),
							}, "refresh"),
						],
					}, "status"),

					!signedIn ? react_jsx_runtime.jsx("div", {
						className: "oac-hint",
						children: t("status.signedOutHint"),
					}, "signed-out") : null,

					react_jsx_runtime.jsxs("div", {
						className: "oac-block",
						children: [
							react_jsx_runtime.jsx("div", { className: "oac-section-title", children: t("credential.title") }, "cred-title"),
							react_jsx_runtime.jsxs("div", { className: "oac-row", children: [
								react_jsx_runtime.jsx("span", { className: "oac-row-label", children: t("credential.source") }, "source-label"),
								react_jsx_runtime.jsx("span", {
									className: "oac-row-value",
									children: credential?.configured === true
										? sourceLabel(credentialSource, t)
										: t("credential.missing"),
								}, "source-value"),
							] }, "source"),
							react_jsx_runtime.jsxs("div", { className: "oac-row", children: [
								react_jsx_runtime.jsx("span", { className: "oac-row-label", children: t("credential.baseUrl") }, "base-label"),
								react_jsx_runtime.jsx("span", { className: "oac-row-value", children: baseUrl ?? "—" }, "base-value"),
							] }, "base"),
							react_jsx_runtime.jsxs("div", { className: "oac-row", children: [
								react_jsx_runtime.jsx("span", { className: "oac-row-label", children: t("credential.token") }, "token-label"),
								react_jsx_runtime.jsx("span", {
									className: "oac-row-value",
									children: account?.providerStateRefScheme === "wincred"
										? t("credential.wincred")
										: (account?.providerStateRefScheme ?? "—"),
								}, "token-value"),
							] }, "token"),
							credential?.configured !== true && credential?.message ? react_jsx_runtime.jsx("div", {
								className: "oac-error",
								children: credential.message,
							}, "cred-error") : null,
						],
					}, "credential-block"),

					react_jsx_runtime.jsxs("div", {
						children: [
							react_jsx_runtime.jsxs("div", { className: "oac-section-title", children: [
								t("models.title"),
								catalog?.source ? react_jsx_runtime.jsx("span", {
									className: "oac-note",
									children: ` (${t("models.source")}: ${catalog.source}${Number.isFinite(catalog?.count) ? `, ${catalog.count}` : ""})`,
								}) : null,
							] }, "models-title"),
							models.length > 0 ? react_jsx_runtime.jsx("div", {
								className: "oac-models",
								children: models.map((model) => {
									const verified = Array.isArray(status?.verifiedModelIds)
										? status.verifiedModelIds.includes(model.id)
										: false;
									return react_jsx_runtime.jsxs("label", {
										className: verified ? "oac-model oac-model--verified" : "oac-model",
										children: [
											react_jsx_runtime.jsx("input", {
												type: "checkbox",
												checked: isChecked(model.id),
												onChange: () => toggleModel(model.id),
											}),
											react_jsx_runtime.jsx("span", { children: model.name || model.id }),
										],
									}, `model-${model.id}`);
								}),
							}, "models") : react_jsx_runtime.jsx("div", {
								className: "oac-note",
								children: t("models.empty"),
							}),
							react_jsx_runtime.jsxs("div", {
								className: "oac-actions",
								children: [
									react_jsx_runtime.jsx("button", {
										className: "oac-button",
										disabled: checkedIds === null,
										onClick: () => void saveSelection(),
										children: t("save.apply"),
									}, "save"),
									react_jsx_runtime.jsx("button", {
										className: "oac-button",
										onClick: () => void refreshCatalog(),
										children: t("models.refresh"),
									}, "refresh-catalog"),
									saved ? react_jsx_runtime.jsx("span", { className: "oac-note", children: t("save.done") }, "saved") : null,
									saveError ? react_jsx_runtime.jsx("span", { className: "oac-error", children: saveError }, "save-error") : null,
								],
							}, "save-row"),
						],
					}, "models-block"),

					react_jsx_runtime.jsxs("div", {
						className: "oac-block",
						children: [
							react_jsx_runtime.jsxs("div", { className: "oac-row", children: [
								react_jsx_runtime.jsx("span", { className: "oac-row-label", children: t("local.app") }, "app-label"),
								react_jsx_runtime.jsx("span", {
									className: "oac-row-value",
									children: status?.local?.appRunning === true
										? (status.local.appVersion ?? t("local.running"))
										: t("local.notRunning"),
								}, "app-value"),
							] }, "app"),
							react_jsx_runtime.jsxs("div", { className: "oac-row", children: [
								react_jsx_runtime.jsx("span", { className: "oac-row-label", children: t("local.store") }, "store-label"),
								react_jsx_runtime.jsx("span", {
									className: "oac-row-value",
									children: status?.local?.databaseFound === true
										? (status.local.available === true ? t("local.readable") : t("local.unreadable"))
										: t("local.notFound"),
								}, "store-value"),
							] }, "store"),
							react_jsx_runtime.jsx("div", { className: "oac-note", children: t("local.usageNote") }, "usage-note"),
						],
					}, "local-block"),

					react_jsx_runtime.jsx("div", {
						className: "oac-note",
						children: t("card.privacy"),
					}, "privacy"),
				],
			}, "root");
		}
		//#endregion

		//#region locale
		const zh = {
			"card.title": "OfficeAce（华为云）",
			"card.description": "复用本机已登录的 OfficeAce 账号：对话模型走 OpenAI 兼容网关，支持流式、思考链与工具调用。",
			"card.navLabel": "OfficeAce",
			"card.privacy": "本插件只读取 OfficeAce 桌面端的登录态（Windows 凭据管理器，只读），凭据不出现在浏览器请求里；本页只展示脱敏后的状态。",
			"common.refresh": "刷新",
			"common.loading": "加载中…",
			"status.signedIn": "已登录",
			"status.signedOut": "未登录",
			"status.expired": "登录已过期",
			"status.account": "账号 {{id}}",
			"status.expiresAt": "凭证到期 {{at}}",
			"status.signedOutHint": "未检测到本机 OfficeAce 登录态。请先打开 OfficeAce 桌面端登录，再回来刷新。",
			"credential.title": "访问凭据",
			"credential.source": "来源",
			"credential.missing": "未解析到",
			"credential.settings": "设置里的 API Key",
			"credential.env": "环境变量 DSH_OFFICEACE_API_KEY",
			"credential.localSession": "本机 OfficeAce 登录态",
			"credential.baseUrl": "模型网关",
			"credential.token": "token 存放位置",
			"credential.wincred": "Windows 凭据管理器（只读）",
			"models.title": "模型清单",
			"models.source": "来源",
			"models.empty": "暂无模型（网关不可达且无缓存）",
			"models.refresh": "刷新目录",
			"models.catalogRefreshFailed": "目录刷新失败",
			"save.apply": "保存模型选择",
			"save.done": "已保存",
			"save.failed": "保存失败",
			"local.app": "OfficeAce 客户端",
			"local.running": "运行中",
			"local.notRunning": "未运行",
			"local.store": "本地状态库",
			"local.readable": "可读",
			"local.unreadable": "不可读",
			"local.notFound": "未找到",
			"local.usageNote": "用量 / 积分看板未实现：OfficeAce 没有可验证的查询接口。",
		};

		const en = {
			"card.title": "OfficeAce (Huawei Cloud)",
			"card.description": "Reuses the locally signed-in OfficeAce account: chat models over an OpenAI-compatible gateway with streaming, reasoning and tool calls.",
			"card.navLabel": "OfficeAce",
			"card.privacy": "This plugin only reads OfficeAce desktop's login state (Windows Credential Manager, read-only). Credentials never reach the browser; this page shows a redacted status view.",
			"common.refresh": "Refresh",
			"common.loading": "Loading…",
			"status.signedIn": "Signed in",
			"status.signedOut": "Not signed in",
			"status.expired": "Sign-in expired",
			"status.account": "account {{id}}",
			"status.expiresAt": "credential expires {{at}}",
			"status.signedOutHint": "No local OfficeAce session found. Sign in from the OfficeAce desktop app, then refresh here.",
			"credential.title": "Upstream access",
			"credential.source": "Source",
			"credential.missing": "unresolved",
			"credential.settings": "API key from settings",
			"credential.env": "DSH_OFFICEACE_API_KEY",
			"credential.localSession": "local OfficeAce session",
			"credential.baseUrl": "Model gateway",
			"credential.token": "Token location",
			"credential.wincred": "Windows Credential Manager (read-only)",
			"models.title": "Models",
			"models.source": "source",
			"models.empty": "No models (gateway unreachable and no cache)",
			"models.refresh": "Refresh catalog",
			"models.catalogRefreshFailed": "Catalog refresh failed",
			"save.apply": "Save model selection",
			"save.done": "Saved",
			"save.failed": "Save failed",
			"local.app": "OfficeAce app",
			"local.running": "running",
			"local.notRunning": "not running",
			"local.store": "Local store",
			"local.readable": "readable",
			"local.unreadable": "unreadable",
			"local.notFound": "not found",
			"local.usageNote": "No usage/credits board: OfficeAce publishes no verifiable query endpoint.",
		};

		const translator = (key, params) => {
			const table = (typeof navigator !== "undefined" && String(navigator.language || "").toLowerCase().startsWith("zh") ? zh : en);
			let text = table[key] ?? zh[key] ?? key;
			if (params !== undefined && typeof text === "string") {
				for (const [name, value] of Object.entries(params)) {
					text = text.replaceAll(`{{${name}}}`, String(value));
				}
			}
			return text;
		};
		//#endregion

		//#region registration
		const name = "dsh-connect-officeace-client";
		const inject = ["slots", "locale"];

		function apply(ctx) {
			try {
				ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), "dsh-connect-officeace: card copy");
				const t = ctx.locale.bind(NAMESPACE);

				// Soft service probe: reading an undeclared property THROWS, so the
				// settings seat must be reached through ctx.get().
				const softGet = (serviceName) => ctx.get(serviceName);
				let settingsScope;
				const forms = softGet("configForms");
				if (forms !== undefined) {
					let ns = PLUGIN_ID;
					try {
						const served = (forms.describe().getSnapshot().view?.namespaces ?? [])
							.find((entry) => entry.ns === ns || /officeace/i.test(entry.ns));
						if (served !== undefined) ns = served.ns;
					} catch {}
					settingsScope = forms.get(ns);
				}

				const registerCard = (slotName, key) => {
					try {
						ctx.slots.inject(slotName, () => ctx.slots.register({
							name: slotName,
							key,
							priority: 30,
							inject: () => (settingsScope === undefined ? { t } : { t, settingsScope }),
						}, OfficeAceSettingsCard));
					} catch (error) {
						console.error(`[dsh-connect-officeace] card slot "${slotName}" failed to register (host provider unaffected):`, error);
					}
				};
				registerCard("plugins.bundle.config", PLUGIN_ID);
				registerCard("plugins.row.config", `${PLUGIN_ID}#${PLUGIN_ID}`);

				// Top-level entry in the SETTINGS LEFT-HAND NAV ("设置 → OfficeAce").
				// Descriptor fields here are id/order/label (NOT key/priority), per
				// the sibling plugin's verified registration.
				try {
					ctx.slots.inject("settings.section", () => ctx.slots.register({
						name: "settings.section",
						id: PLUGIN_ID,
						order: 40,
						label: () => t("card.navLabel"),
						inject: () => (settingsScope === undefined ? { t } : { t, settingsScope }),
					}, OfficeAceSettingsCard));
				} catch (error) {
					console.error("[dsh-connect-officeace] settings.section failed to register (host provider unaffected):", error);
				}

				try {
					ensureStyles();
				} catch {}
			} catch (error) {
				console.error("[dsh-connect-officeace] client card failed to load (host provider unaffected):", error);
			}
		}
		//#endregion

		exports.OfficeAceSettingsCard = OfficeAceSettingsCard;
		exports.apply = apply;
		exports.en = en;
		exports.inject = inject;
		exports.name = name;
		exports.translator = translator;
		exports.zh = zh;
		return module.exports;
	},
});
