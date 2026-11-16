import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_MODEL_DEFAULTS,
	KNOWN_MODEL_IDS,
	VERIFIED_WORKING_MODEL_IDS,
	catalogEntriesOf,
	chatModelsOf,
	enabledModelsOf,
	isLikelyChatModel,
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

test("KNOWN_MODEL_IDS are the ids verified in OfficeAce's own agent config", () => {
	assert.deepEqual(KNOWN_MODEL_IDS, ["deepseek-v4.1-flash", "deepseek-v4.1-flash-1017-host"]);
});

test("VERIFIED_WORKING_MODEL_IDS records the id a real completion answered for", () => {
	assert.deepEqual(VERIFIED_WORKING_MODEL_IDS, ["deepseek-v4-flash"]);
});

test("the chat heuristic drops the live catalog's non-chat ids", () => {
	const ids = [
		"deepseek-v4-flash",
		"glm-5.3",
		"qwen3-32b",
		"vidu/viduq3-pro_text2video",
		"pixverse/pixverse-v6-t2v",
		"qwen-image-edit-2509",
		"qwen_image_edit",
		"bge-m3",
		"bge-reranker-v2-m3",
	];
	const kept = ids.filter(isLikelyChatModel);
	assert.deepEqual(kept, ["deepseek-v4-flash", "glm-5.3", "qwen3-32b"]);
});

test("chatModelsOf filters non-chat ids by default and can return the raw list", () => {
	const rows = [
		{ id: "deepseek-v4-flash" },
		{ id: "bge-m3" },
		{ id: "pixverse/pixverse-v6-t2v" },
	];
	assert.deepEqual(
		chatModelsOf(rows).map((row) => row.id),
		["deepseek-v4-flash"],
	);
	assert.deepEqual(
		chatModelsOf(rows, DEFAULT_MODEL_DEFAULTS, false).map((row) => row.id),
		["deepseek-v4-flash", "bge-m3", "pixverse/pixverse-v6-t2v"],
	);
});
