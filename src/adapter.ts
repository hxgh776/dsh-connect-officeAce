/**
 * The pi-ai provider and its DSH adapter.
 *
 * Peer packages (`@earendil-works/pi-ai`, `@deepseek-ai/dsh-llm`,
 * `@deepseek-ai/dsh-llm-pi-ai`) resolve from the HOST at runtime and are never
 * bundled — same as the sibling plugins.
 *
 * The subtlety worth its own section is the pi-ai GENERATION boundary: the host
 * may resolve a 0.85.x (legacy `{systemPrompt, tools, messages}` context) or a
 * 0.86+/1.x (normalized transcript) copy, and a mismatch silently drops the
 * prompt and tools. Detection and both fold functions are adapted from
 * `dsh-connect-loomy` (which adapted them from `dsh-connect-trae`); on the
 * healthy path both wrappers are identities and cost one `Array.some`.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { OFFICEACE_PROVIDER, OFFICEACE_PROVIDER_DISPLAY_NAME, toPiModel } from "./catalog.js";
import type { OfficeAceModelRow } from "./types.js";

/** Idle watchdog handed to the host profile: 5 min, the sibling convention. */
const STREAM_IDLE_TIMEOUT_MS = 300_000;

/** Conservative request-image bounds, copied from the trae-cn route set. */
const REQUEST_IMAGE_BUDGETS = {
	maxRequestImageBytes: 1_048_576 * 20,
	requestImagePixelBudget: 1_048_576 * 4,
	requestImageMaxBytes: 1_048_576,
	maxRequestImages: 50,
	imageOffloadCountQuantum: 10,
};

/** Inert pi-ai credentials: the shim secret is injected, the key lives elsewhere. */
const INERT_AUTH = {
	credentials: {
		async read(): Promise<undefined> {
			return undefined;
		},
		async list(): Promise<unknown[]> {
			return [];
		},
		async modify(): Promise<never> {
			throw new Error("dsh-connect-officeace has no pi-ai credential lifecycle");
		},
		async delete(): Promise<void> {
			// nothing is stored here
		},
	},
	authContext: {
		async env(): Promise<undefined> {
			return undefined;
		},
		async fileExists(): Promise<boolean> {
			return false;
		},
	},
};

// ---------------------------------------------------------------------------
// pi-ai generation detection
// ---------------------------------------------------------------------------

interface RuntimeInfo {
	generation: "legacy" | "modern";
	version: string | undefined;
	resolvedFrom: string | undefined;
}

let cachedRuntimeInfo: RuntimeInfo | undefined;

function generationOf(version: string | undefined): "legacy" | "modern" | undefined {
	if (version === undefined) return undefined;
	const match = /^(\d+)\.(\d+)\./u.exec(String(version));
	if (match === null) return undefined;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	if (major > 0) return "modern";
	return minor >= 86 ? "modern" : "legacy";
}

function piAiRuntimeInfo(): RuntimeInfo {
	if (cachedRuntimeInfo !== undefined) return cachedRuntimeInfo;
	cachedRuntimeInfo = (() => {
		try {
			const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-ai"));
			let root = dirname(entry);
			// Walk up to the package root (the file that exports "." resolved).
			for (let i = 0; i < 6 && root !== dirname(root); i += 1) {
				if (existsSync(join(root, "package.json"))) break;
				root = dirname(root);
			}
			let version: string | undefined;
			try {
				const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
					version?: unknown;
				};
				version = typeof parsed.version === "string" ? parsed.version : undefined;
			} catch {
				version = undefined;
			}
			const transcriptPresent = existsSync(join(root, "dist", "utils", "transcript.js"));
			const byVersion = generationOf(version);
			const generation =
				byVersion ??
				(transcriptPresent ? "modern" : "legacy");
			return { generation, version, resolvedFrom: root };
		} catch {
			return { generation: "modern", version: undefined, resolvedFrom: undefined };
		}
	})();
	return cachedRuntimeInfo;
}

type PiMessage = {
	role?: unknown;
	content?: unknown;
	sections?: unknown;
	toolsAdded?: unknown;
	toolsRemoved?: unknown;
};

type PiContext = {
	messages?: unknown;
	systemPrompt?: unknown;
	tools?: unknown;
	[key: string]: unknown;
};

function isSystemMessage(message: unknown): message is PiMessage {
	return (
		typeof message === "object" &&
		message !== null &&
		(message as PiMessage).role === "system"
	);
}

function contentTextOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const texts: string[] = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const typed = block as { type?: unknown; text?: unknown };
		if (typed.type === "text" && typeof typed.text === "string") texts.push(typed.text);
	}
	return texts.join("\n\n");
}

function systemTextOf(message: PiMessage): string {
	const parts = [contentTextOf(message.content)];
	const sections = message.sections;
	if (typeof sections === "object" && sections !== null && !Array.isArray(sections)) {
		for (const text of Object.values(sections as Record<string, unknown>)) {
			if (typeof text === "string") parts.push(text);
		}
	}
	return parts.filter((part) => part.length > 0).join("\n\n");
}

function replayToolState(message: PiMessage, state: Map<string, unknown>): void {
	const removed = message.toolsRemoved;
	if (Array.isArray(removed)) {
		for (const tool of removed) {
			const name = (tool as { name?: unknown })?.name;
			if (typeof name === "string") state.delete(name);
		}
	}
	const added = message.toolsAdded;
	if (Array.isArray(added)) {
		for (const tool of added) {
			const name = (tool as { name?: unknown })?.name;
			if (typeof name === "string") state.set(name, tool);
		}
	}
}

/** Fold a normalized transcript into the legacy `{systemPrompt, tools, messages}` shape. */
function adaptLegacyContext(context: PiContext): PiContext {
	const messages = Array.isArray(context.messages) ? context.messages : undefined;
	if (messages === undefined) return context;
	if (!messages.some(isSystemMessage)) return context;
	const systemTexts: string[] = [];
	const rest: unknown[] = [];
	const toolState = new Map<string, unknown>();
	for (const message of messages) {
		if (!isSystemMessage(message)) {
			rest.push(message);
			continue;
		}
		const text = systemTextOf(message);
		if (text !== "") systemTexts.push(text);
		replayToolState(message, toolState);
	}
	const texts = [
		...(typeof context.systemPrompt === "string" && context.systemPrompt !== ""
			? [context.systemPrompt]
			: []),
		...systemTexts,
	];
	const promoted = Array.isArray(context.tools) ? undefined : [...toolState.values()];
	return {
		...context,
		...(texts.length > 0 ? { systemPrompt: texts.join("\n\n") } : {}),
		...(promoted === undefined || promoted.length === 0 ? {} : { tools: promoted }),
		messages: rest,
	};
}

/** Lift the legacy shape into the normalized transcript a modern api consumes. */
function adaptModernContext(context: PiContext): PiContext {
	const messages = Array.isArray(context.messages) ? context.messages : undefined;
	if (messages === undefined) return context;
	const prompt = context.systemPrompt;
	const tools =
		Array.isArray(context.tools) && context.tools.length > 0 ? context.tools : undefined;
	if (!(typeof prompt === "string" && prompt.length > 0) && tools === undefined) return context;
	const head = {
		role: "system",
		content: typeof prompt === "string" ? prompt : "",
		...(tools === undefined ? {} : { toolsAdded: tools }),
	};
	const { systemPrompt: _lifted, tools: _liftedTools, ...rest } = context;
	return { ...rest, messages: [head, ...messages] };
}

/** Wrap both stream entry points so the api receives its generation's shape. */
function withContextAdaptation<T extends { stream: Function; streamSimple: Function }>(
	api: T,
	generation: "legacy" | "modern",
): T {
	const adapt = generation === "modern" ? adaptModernContext : adaptLegacyContext;
	return {
		...api,
		stream: (model: unknown, context: PiContext, options: unknown) =>
			api.stream(model, adapt(context), options),
		streamSimple: (model: unknown, context: PiContext, options: unknown) =>
			api.streamSimple(model, adapt(context), options),
	};
}

// ---------------------------------------------------------------------------
// provider + adapter assembly
// ---------------------------------------------------------------------------

export interface AdapterOptions {
	/** Live shim origin getter (the `.../v1` base). */
	baseUrl: () => string | undefined;
	/** Live normalized catalog rows. */
	modelsProvider: () => OfficeAceModelRow[];
	/** Shim bearer secret. */
	resolveToken: () => string;
	providerId?: string;
	displayName?: string;
}

export interface BuiltAdapter {
	// `any` is intentional at this boundary: the host's pi-ai types vary by line.
	adapter: any;
	provider: any;
	profile: any;
	generation: "legacy" | "modern";
}

export function createAdapter(options: AdapterOptions): BuiltAdapter {
	const providerId = options.providerId ?? OFFICEACE_PROVIDER;
	const displayName = options.displayName ?? OFFICEACE_PROVIDER_DISPLAY_NAME;
	const { generation } = piAiRuntimeInfo();

	const buildModels = (): any[] =>
		options
			.modelsProvider()
			.map((row) => toPiModel(row, options.baseUrl() ?? "", providerId));

	const provider: any = {
		...createProvider({
			id: providerId,
			name: displayName,
			auth: {
				apiKey: {
					name: "OfficeAce loopback shim secret",
					async resolve({ credential }: { credential?: { key?: string } }) {
						const apiKey = credential?.key;
						return apiKey === undefined || apiKey.length === 0
							? undefined
							: { auth: { apiKey }, source: "OfficeAce loopback shim" };
					},
				},
			},
			models: buildModels(),
			api: withContextAdaptation(openAICompletionsApi(), generation),
		}),
		getModels: () => buildModels(),
	};

	const profile: any = {
		provider: providerId,
		displayName,
		streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
		retryPolicy: resolveRetryPolicy(undefined, "dsh-connect-officeace retryPolicy"),
		configuredMaxTokens: new Map(),
		modelErrors: new Map(),
		defaultContextWindow: 200_000,
		...REQUEST_IMAGE_BUDGETS,
		piProvider: provider,
	};

	const adapter: any = new PiAiAdapter({
		profiles: () => new Map([[providerId, profile]]),
		auth: INERT_AUTH,
		resolveApiKey: async () => options.resolveToken(),
	});

	return { adapter, provider, profile, generation };
}
