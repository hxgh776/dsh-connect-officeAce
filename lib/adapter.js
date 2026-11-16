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
        async read() {
            return undefined;
        },
        async list() {
            return [];
        },
        async modify() {
            throw new Error("dsh-connect-officeace has no pi-ai credential lifecycle");
        },
        async delete() {
            // nothing is stored here
        },
    },
    authContext: {
        async env() {
            return undefined;
        },
        async fileExists() {
            return false;
        },
    },
};
let cachedRuntimeInfo;
function generationOf(version) {
    if (version === undefined)
        return undefined;
    const match = /^(\d+)\.(\d+)\./u.exec(String(version));
    if (match === null)
        return undefined;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major > 0)
        return "modern";
    return minor >= 86 ? "modern" : "legacy";
}
function piAiRuntimeInfo() {
    if (cachedRuntimeInfo !== undefined)
        return cachedRuntimeInfo;
    cachedRuntimeInfo = (() => {
        try {
            const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-ai"));
            let root = dirname(entry);
            // Walk up to the package root (the file that exports "." resolved).
            for (let i = 0; i < 6 && root !== dirname(root); i += 1) {
                if (existsSync(join(root, "package.json")))
                    break;
                root = dirname(root);
            }
            let version;
            try {
                const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
                version = typeof parsed.version === "string" ? parsed.version : undefined;
            }
            catch {
                version = undefined;
            }
            const transcriptPresent = existsSync(join(root, "dist", "utils", "transcript.js"));
            const byVersion = generationOf(version);
            const generation = byVersion ??
                (transcriptPresent ? "modern" : "legacy");
            return { generation, version, resolvedFrom: root };
        }
        catch {
            return { generation: "modern", version: undefined, resolvedFrom: undefined };
        }
    })();
    return cachedRuntimeInfo;
}
function isSystemMessage(message) {
    return (typeof message === "object" &&
        message !== null &&
        message.role === "system");
}
function contentTextOf(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    const texts = [];
    for (const block of content) {
        if (typeof block !== "object" || block === null)
            continue;
        const typed = block;
        if (typed.type === "text" && typeof typed.text === "string")
            texts.push(typed.text);
    }
    return texts.join("\n\n");
}
function systemTextOf(message) {
    const parts = [contentTextOf(message.content)];
    const sections = message.sections;
    if (typeof sections === "object" && sections !== null && !Array.isArray(sections)) {
        for (const text of Object.values(sections)) {
            if (typeof text === "string")
                parts.push(text);
        }
    }
    return parts.filter((part) => part.length > 0).join("\n\n");
}
function replayToolState(message, state) {
    const removed = message.toolsRemoved;
    if (Array.isArray(removed)) {
        for (const tool of removed) {
            const name = tool?.name;
            if (typeof name === "string")
                state.delete(name);
        }
    }
    const added = message.toolsAdded;
    if (Array.isArray(added)) {
        for (const tool of added) {
            const name = tool?.name;
            if (typeof name === "string")
                state.set(name, tool);
        }
    }
}
/** Fold a normalized transcript into the legacy `{systemPrompt, tools, messages}` shape. */
function adaptLegacyContext(context) {
    const messages = Array.isArray(context.messages) ? context.messages : undefined;
    if (messages === undefined)
        return context;
    if (!messages.some(isSystemMessage))
        return context;
    const systemTexts = [];
    const rest = [];
    const toolState = new Map();
    for (const message of messages) {
        if (!isSystemMessage(message)) {
            rest.push(message);
            continue;
        }
        const text = systemTextOf(message);
        if (text !== "")
            systemTexts.push(text);
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
function adaptModernContext(context) {
    const messages = Array.isArray(context.messages) ? context.messages : undefined;
    if (messages === undefined)
        return context;
    const prompt = context.systemPrompt;
    const tools = Array.isArray(context.tools) && context.tools.length > 0 ? context.tools : undefined;
    if (!(typeof prompt === "string" && prompt.length > 0) && tools === undefined)
        return context;
    const head = {
        role: "system",
        content: typeof prompt === "string" ? prompt : "",
        ...(tools === undefined ? {} : { toolsAdded: tools }),
    };
    const { systemPrompt: _lifted, tools: _liftedTools, ...rest } = context;
    return { ...rest, messages: [head, ...messages] };
}
/** Wrap both stream entry points so the api receives its generation's shape. */
function withContextAdaptation(api, generation) {
    const adapt = generation === "modern" ? adaptModernContext : adaptLegacyContext;
    return {
        ...api,
        stream: (model, context, options) => api.stream(model, adapt(context), options),
        streamSimple: (model, context, options) => api.streamSimple(model, adapt(context), options),
    };
}
export function createAdapter(options) {
    const providerId = options.providerId ?? OFFICEACE_PROVIDER;
    const displayName = options.displayName ?? OFFICEACE_PROVIDER_DISPLAY_NAME;
    const { generation } = piAiRuntimeInfo();
    const buildModels = () => options
        .modelsProvider()
        .map((row) => toPiModel(row, options.baseUrl() ?? "", providerId));
    const provider = {
        ...createProvider({
            id: providerId,
            name: displayName,
            auth: {
                apiKey: {
                    name: "OfficeAce loopback shim secret",
                    async resolve({ credential }) {
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
    const profile = {
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
    const adapter = new PiAiAdapter({
        profiles: () => new Map([[providerId, profile]]),
        auth: INERT_AUTH,
        resolveApiKey: async () => options.resolveToken(),
    });
    return { adapter, provider, profile, generation };
}
