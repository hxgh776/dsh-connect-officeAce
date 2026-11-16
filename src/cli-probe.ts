/**
 * `dsh-connect-officeace probe` — one real streaming chat through the gateway.
 *
 * Separate from `doctor` on purpose: this consumes quota. It exercises the same
 * OpenAI-compatible surface the shim forwards, including tool calls when
 * `--tools` is passed. Credential resolution is the production one (explicit
 * key/env first, otherwise the account's own provider state).
 *
 * Exit codes: 0 success, 2 bad usage, 3 credential missing/rejected, 4 network,
 * 5 upstream error, 1 unexpected.
 */

import { DEFAULT_PROBE_MODEL, VERIFIED_WORKING_MODEL_IDS } from "./catalog.js";
import { AccessResolver } from "./credentials.js";
import { OfficeAceError } from "./errors.js";
import { readLocalState } from "./local-store.js";
import { withStoredSettings } from "./store.js";
import { OfficeAceUpstream } from "./upstream.js";

interface ProbeOptions {
	prompt: string;
	model: string;
	tools: boolean;
	json: boolean;
	stream: boolean;
	timeoutMs: number;
	baseUrl: string;
}

const DEFAULT_PROMPT = "用一句话确认你已连通，并说明你看到的模型名。";

function parseArgs(argv: string[]): ProbeOptions | undefined {
	const options: ProbeOptions = {
		prompt: DEFAULT_PROMPT,
		model: "",
		tools: false,
		json: false,
		stream: true,
		timeoutMs: 60_000,
		baseUrl: "",
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index] ?? "";
		if (arg === "--json") options.json = true;
		else if (arg === "--tools") options.tools = true;
		else if (arg === "--no-stream") options.stream = false;
		else if (arg === "-p" || arg === "--prompt") {
			const value = argv[index + 1];
			if (value === undefined) return undefined;
			options.prompt = value;
			index += 1;
		} else if (arg === "-m" || arg === "--model") {
			const value = argv[index + 1];
			if (value === undefined) return undefined;
			options.model = value;
			index += 1;
		} else if (arg === "--timeout-ms") {
			const value = Number(argv[index + 1]);
			if (!Number.isFinite(value) || value <= 0) return undefined;
			options.timeoutMs = value;
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

const TOOLS = [
	{
		type: "function",
		function: {
			name: "get_time",
			description: "Return the current local time in ISO 8601 form.",
			parameters: { type: "object", properties: {}, additionalProperties: false },
		},
	},
];

interface ProbeOutcome {
	ok: boolean;
	model: string;
	baseUrl: string;
	text: string;
	reasoning: string;
	toolCalls: Array<{ name?: string; arguments?: string }>;
	usage: unknown;
	status: number;
	error?: string;
}

function parseSseBlock(block: string): Record<string, unknown> | undefined {
	const data: string[] = [];
	for (const line of block.split(/\r?\n/u)) {
		if (line.startsWith("data:")) data.push(line.slice(5).trim());
	}
	const payload = data.join("\n").trim();
	if (payload === "" || payload === "[DONE]") return undefined;
	try {
		return JSON.parse(payload) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

async function readStream(response: Response, outcome: ProbeOutcome, print: boolean): Promise<void> {
	const reader = response.body?.getReader();
	if (reader === undefined) return;
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value as Uint8Array, { stream: true });
		const blocks = buffer.split(/\r?\n\r?\n/u);
		buffer = blocks.pop() ?? "";
		for (const block of blocks) {
			const event = parseSseBlock(block);
			if (event === undefined) continue;
			const choices = Array.isArray(event.choices)
				? (event.choices as Array<Record<string, unknown>>)
				: [];
			for (const choice of choices) {
				const delta = (choice.delta ?? {}) as Record<string, unknown>;
				if (typeof delta.content === "string" && delta.content !== "") {
					outcome.text += delta.content;
					if (print) process.stdout.write(delta.content);
				}
				if (typeof delta.reasoning_content === "string" && delta.reasoning_content !== "") {
					outcome.reasoning += delta.reasoning_content;
				}
				if (Array.isArray(delta.tool_calls)) {
					for (const call of delta.tool_calls as Array<Record<string, unknown>>) {
						const fn = (call.function ?? {}) as Record<string, unknown>;
						const index = Number(call.index) || 0;
						outcome.toolCalls[index] ??= {};
						const slot = outcome.toolCalls[index];
						if (typeof fn.name === "string") slot.name = fn.name;
						if (typeof fn.arguments === "string") {
							slot.arguments = `${slot.arguments ?? ""}${fn.arguments}`;
						}
					}
				}
			}
			if (event.usage !== undefined) outcome.usage = event.usage;
		}
	}
}

async function runProbe(options: ProbeOptions): Promise<{ code: number; outcome: ProbeOutcome }> {
	const settings = withStoredSettings({ baseUrl: options.baseUrl });
	const access = new AccessResolver({
		settings: () => settings,
		readLocalState: () => readLocalState({ installRoot: settings.installRoot }),
	});
	const upstream = new OfficeAceUpstream({ access: () => access.resolve() });

	const outcome: ProbeOutcome = {
		ok: false,
		model: options.model,
		baseUrl: "",
		text: "",
		reasoning: "",
		toolCalls: [],
		usage: undefined,
		status: 0,
	};

	try {
		outcome.baseUrl = await upstream.baseUrl();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { code: error instanceof OfficeAceError ? 3 : 1, outcome: { ...outcome, error: message } };
	}

	let model = options.model;
	if (model === "") {
		try {
			const rows = (await upstream.listModels()) as Array<{ id?: unknown }>;
			const ids = rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
			model = ids.find((id) => VERIFIED_WORKING_MODEL_IDS.includes(id)) ?? ids[0] ?? DEFAULT_PROBE_MODEL;
		} catch {
			model = DEFAULT_PROBE_MODEL;
		}
	}
	outcome.model = model;

	const body: Record<string, unknown> = {
		model,
		messages: [{ role: "user", content: options.prompt }],
		stream: options.stream,
		...(options.tools ? { tools: TOOLS } : {}),
		...(options.stream ? { stream_options: { include_usage: true } } : {}),
	};

	try {
		const response = await upstream.chatCompletion(body, {
			signal: AbortSignal.timeout(options.timeoutMs),
		});
		outcome.status = response.status;
		if (options.stream) {
			await readStream(response, outcome, options.json !== true);
			if (options.json !== true) process.stdout.write("\n");
		} else {
			const payload = (await response.json()) as Record<string, unknown>;
			const choices = Array.isArray(payload.choices)
				? (payload.choices as Array<Record<string, unknown>>)
				: [];
			const message = (choices[0]?.message ?? {}) as Record<string, unknown>;
			if (typeof message.content === "string") outcome.text = message.content;
			if (typeof message.reasoning_content === "string") outcome.reasoning = message.reasoning_content;
			if (Array.isArray(message.tool_calls)) {
				outcome.toolCalls = (message.tool_calls as Array<Record<string, unknown>>).map((call) => {
					const fn = (call.function ?? {}) as Record<string, unknown>;
					return {
						name: typeof fn.name === "string" ? fn.name : undefined,
						arguments: typeof fn.arguments === "string" ? fn.arguments : undefined,
					};
				});
			}
			outcome.usage = payload.usage;
			if (options.json !== true) process.stdout.write(`${outcome.text}\n`);
		}
		outcome.ok = true;
		return { code: 0, outcome };
	} catch (error) {
		if (error instanceof OfficeAceError) {
			outcome.error = error.message;
			const code =
				error.kind === "not_signed_in" || error.kind === "session_dead"
					? 3
					: error.kind === "network"
						? 4
						: 5;
			return { code, outcome };
		}
		outcome.error = error instanceof Error ? error.message : String(error);
		return { code: 1, outcome };
	}
}

async function main(): Promise<number> {
	const options = parseArgs(process.argv.slice(2));
	if (options === undefined) {
		console.error(
			"用法: dsh-connect-officeace probe [-p <prompt>] [-m <model>] [--tools] [--json] [--no-stream] [--timeout-ms N] [--base-url <url>]",
		);
		return 2;
	}
	const { code, outcome } = await runProbe(options);
	if (options.json) console.log(JSON.stringify(outcome, null, 2));
	else if (!outcome.ok) console.error(`probe 失败：${outcome.error ?? "unknown"}`);
	else {
		const toolNote = outcome.toolCalls.length > 0 ? `，tool_calls=${outcome.toolCalls.length}` : "";
		const reasoningNote = outcome.reasoning.length > 0 ? "，reasoning 有增量" : "";
		console.error(`probe 成功：model=${outcome.model}${toolNote}${reasoningNote}`);
	}
	return code;
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
