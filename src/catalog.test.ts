import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_MODEL_DEFAULTS,
	KNOWN_MODEL_IDS,
	catalogEntriesOf,
	chatModelsOf,
	enabledModelsOf,
	normalizeModelRow,
	toPiModel,
} from "./catalog.js";

test("normalizeModelRow keeps wire values and fills only missing ones", () => {
	const row = normalizeModelRow({
		id: "deepseek-v4.1-flash",
		name: "DeepSeek V4.1 Flash",
		context_length: 131072,
		max_output_tokens: 8192,
		created: 100,
		owned_by: "huawei-maas",
		capabilities: { reasoning: true, input_modalities: ["text", "image"] },
	});
	assert.ok(row);
	assert.equal(row.id, "deepseek-v4.1-flash");
	assert.equal(row.contextWindow, 131072);
	assert.equal(row.maxTokens, 8192);
	assert.deepEqual(row.inputModalities, ["text", "image"]);
	assert.equal(row.reasoning, true);
	assert.equal(row.ownedBy, "huawei-maas");
});

test("normalizeModelRow accepts the plain OpenAI /models shape", () => {
	const row = normalizeModelRow({ id: "m", object: "model", created: 5, owned_by: "x" });
	assert.ok(row);
	assert.equal(row.contextWindow, DEFAULT_MODEL_DEFAULTS.contextWindow);
	assert.equal(row.maxTokens, DEFAULT_MODEL_DEFAULTS.maxTokens);
	assert.deepEqual(row.inputModalities, ["text"]);
	assert.equal(row.name, "m");
});

test("normalizeModelRow rejects rows without an id", () => {
	assert.equal(normalizeModelRow({ name: "no id" }), undefined);
	assert.equal(normalizeModelRow(null), undefined);
	assert.equal(normalizeModelRow("nope"), undefined);
});

test("chatModelsOf drops duplicates and preserves wire order", () => {
	const rows = chatModelsOf([
		{ id: "b" },
		{ id: "a" },
		{ id: "b", name: "dup" },
		{ context: "no id" },
	]);
	assert.deepEqual(
		rows.map((row) => row.id),
		["b", "a"],
	);
});

test("an absent selection serves everything, an empty selection serves nothing", () => {
	const rows = chatModelsOf([{ id: "a" }, { id: "b" }]);
	assert.equal(enabledModelsOf(rows, undefined).length, 2);
	assert.equal(enabledModelsOf(rows, []).length, 0);
	assert.deepEqual(
		enabledModelsOf(rows, ["b"]).map((row) => row.id),
		["b"],
	);
});

test("catalogEntriesOf exposes id+name only", () => {
	const rows = chatModelsOf([{ id: "a", name: "A" }]);
	assert.deepEqual(catalogEntriesOf(rows), [{ id: "a", name: "A" }]);
});

test("toPiModel builds a descriptor DSH can accept", () => {
	const [row] = chatModelsOf([{ id: "a", context_length: 64000, max_output_tokens: 4096 }]);
	assert.ok(row);
	const model = toPiModel(row, "http://127.0.0.1:1/v1");
	assert.equal(model.id, "a");
	assert.equal(model.api, "openai-completions");
	assert.equal(model.provider, "officeace");
	assert.equal(model.baseUrl, "http://127.0.0.1:1/v1");
	assert.equal(model.contextWindow, 64000);
	assert.equal(model.maxTokens, 4096);
	assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("KNOWN_MODEL_IDS are the two ids verified in OfficeAce's own agent config", () => {
	assert.deepEqual(KNOWN_MODEL_IDS, ["deepseek-v4.1-flash", "deepseek-v4.1-flash-1017"]);
});
