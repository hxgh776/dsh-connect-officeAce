/**
 * End-to-end check against the real machine: local login → credential → gateway
 * → loopback shim → OpenAI-compatible response.
 *
 * This is NOT a unit test. It reads this machine's OfficeAce login state, talks
 * to the real model gateway, and spends real tokens (a few hundred at most).
 * Run it only on a machine that is signed in to OfficeAce:
 *
 *   npm run build && node scripts/e2e.mjs
 *
 * Exit code 0 = every stage passed, 1 = at least one stage failed.
 * Credentials are never printed; only shapes, status codes and token counts are.
 */

import { AccessResolver } from "../lib/credentials.js";
import { readLocalState } from "../lib/local-store.js";
import { OfficeAceUpstream } from "../lib/upstream.js";
import { createShim } from "../lib/shim.js";
import { DEFAULT_PROBE_MODEL } from "../lib/catalog.js";

const MODEL = process.env.DSH_OFFICEACE_E2E_MODEL ?? DEFAULT_PROBE_MODEL;
const results = [];
let failed = 0;

function check(name, ok, detail) {
	results.push({ name, ok, detail });
	if (!ok) failed += 1;
	const mark = ok ? "OK  " : "FAIL";
	console.log(`${mark} ${name.padEnd(18)} ${detail ?? ""}`);
}

function short(value, limit = 90) {
	const text = String(value ?? "").replace(/\s+/gu, " ");
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

// Empty settings and no API-key env: this forces the local-session path, which
// is the one the plugin is actually shipping.
const settings = () => ({});
const resolver = new AccessResolver({ settings, env: {}, readLocalState: () => readLocalState() });
const upstream = new OfficeAceUpstream({ access: () => resolver.resolve() });

// 1 — the local login is readable and yields a gateway + Basic credential.
let access;
try {
	access = await resolver.resolve();
	check(
		"credential",
		access.auth.kind === "basic" && access.baseUrl.endsWith("/v1"),
		`source=local-session auth=${access.auth.kind} base=${access.baseUrl}`,
	);
} catch (error) {
	check("credential", false, short(error?.message ?? error));
	console.log("\nE2E aborted: no usable local credential. Sign in with the OfficeAce desktop app.");
	process.exit(1);
}

// 2 — the gateway answers a catalog request.
let rows = [];
try {
	const models = await upstream.listModels();
	rows = models.map((row) => {
		const r = row ?? {};
		return { id: String(r.id ?? ""), created: Number(r.created) || 0, ownedBy: String(r.owned_by ?? r.ownedBy ?? "") };
	});
	const hasModel = rows.some((row) => row.id === MODEL);
	check("catalog", rows.length > 0 && hasModel, `${rows.length} models, has ${MODEL}=${hasModel}`);
} catch (error) {
	check("catalog", false, short(error?.message ?? error));
}

// 3 — the loopback shim: auth gate, then the real upstream through it.
let shim;
try {
	shim = createShim({ upstream, modelsProvider: () => rows });
	await shim.ready;
} catch (error) {
	check("shim-boot", false, short(error?.message ?? error));
	console.log("\nE2E aborted: the loopback shim did not start.");
	process.exit(1);
}

const base = shim.baseUrl();
const token = shim.token();

try {
	const rejected = await fetch(`${base}/v1/models`, { headers: { authorization: "Bearer not-the-secret" } });
	check("shim-auth", rejected.status === 401, `wrong secret → ${rejected.status}`);

	const listed = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${token}` } });
	const listedBody = await listed.json().catch(() => ({}));
	check(
		"shim-models",
		listed.status === 200 && Array.isArray(listedBody.data),
		`${listed.status}, ${Array.isArray(listedBody.data) ? listedBody.data.length : "?"} rows`,
	);
} catch (error) {
	check("shim-auth", false, short(error?.message ?? error));
}

async function chat(payload) {
	const response = await fetch(`${base}/v1/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
		body: JSON.stringify(payload),
	});
	const text = await response.text();
	return { status: response.status, text };
}

// 4 — non-streaming completion through the shim.
try {
	const { status, text } = await chat({
		model: MODEL,
		messages: [{ role: "user", content: "reply with the single word OK" }],
	});
	let body = {};
	try {
		body = JSON.parse(text);
	} catch {
		/* handled by the assertion below */
	}
	const content = String(body?.choices?.[0]?.message?.content ?? "");
	check("chat", status === 200 && content.trim() !== "", `${status} content=${short(content, 40)}`);
} catch (error) {
	check("chat", false, short(error?.message ?? error));
}

// 5 — streaming: SSE framing, reasoning/content deltas, and the DONE sentinel.
try {
	const { status, text } = await chat({
		model: MODEL,
		stream: true,
		messages: [{ role: "user", content: "count from one to three" }],
	});
	const deltas = text.split("\n").filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"));
	const reasoning = deltas.some((line) => line.includes('"reasoning_content"'));
	const content = deltas.some((line) => line.includes('"content"'));
	check(
		"stream",
		status === 200 && deltas.length > 0 && text.includes("[DONE]") && content,
		`${status} chunks=${deltas.length} reasoning=${reasoning} content=${content} done=${text.includes("[DONE]")}`,
	);
} catch (error) {
	check("stream", false, short(error?.message ?? error));
}

// 6 — tool calls: force one, then assert the OpenAI shape came back intact.
try {
	const { status, text } = await chat({
		model: MODEL,
		messages: [{ role: "user", content: "What is the weather in Beijing? Use the tool." }],
		tools: [
			{
				type: "function",
				function: {
					name: "get_weather",
					description: "Get the weather for a city",
					parameters: {
						type: "object",
						properties: { city: { type: "string" } },
						required: ["city"],
					},
				},
			},
		],
	});
	let body = {};
	try {
		body = JSON.parse(text);
	} catch {
		/* handled below */
	}
	const call = body?.choices?.[0]?.message?.tool_calls?.[0];
	check(
		"tool_calls",
		status === 200 && call?.function?.name === "get_weather",
		`${status} name=${call?.function?.name ?? "-"} args=${short(call?.function?.arguments ?? "", 40)}`,
	);
} catch (error) {
	check("tool_calls", false, short(error?.message ?? error));
}

shim.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\nE2E: ${passed}/${results.length} passed${failed === 0 ? "" : `, ${failed} failed`}`);
process.exit(failed === 0 ? 0 : 1);