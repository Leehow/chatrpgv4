/**
 * Unit tests for extensions/rerank: the provider table, the wire adapters (stubbed fetch —
 * no network), the spawn-environment configuration, and the settings manifest the panel
 * renders from.
 *
 * The manifest is the contract between the two halves — the panel writes `ext.rerank.provider`
 * and the vault secret `ext.rerank.apiKey`, and the host derives the two environment names from
 * exactly those keys. Nothing else pins them together, so this file does: rename a setting key
 * without renaming the reader and these tests fail rather than the reader silently reading
 * nothing.
 *
 * The provider row is the whole configuration, so these tests also pin what the panel must not
 * ask for: a row carries its own endpoint and model, and the manifest exposes no field for
 * either.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { rerank } from "../../extensions/rerank/agent/index.js";
import { readConfig, describeConfig, settingsEnvName, secretEnvName } from "../../extensions/rerank/agent/config.js";
import { PROVIDER_IDS, RERANK_PROVIDERS, providerPreset, rerankDocuments } from "../../extensions/rerank/agent/vendors.js";
import { PROVIDER_PRESETS, createComponent as createRerankSection } from "../../extensions/rerank/app/settings-rerank.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = JSON.parse(readFileSync(join(REPO, "extensions/rerank/pipiui-extension.json"), "utf8"));
const PROVIDER_KEY = "ext.rerank.provider";
const MODEL_KEY = "ext.rerank.model";
const API_KEY_KEY = "ext.rerank.apiKey";

function jsonResponse(body, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body),
	};
}

function recordingFetch(...responses) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url: String(url), init });
		const next = responses.length > 1 ? responses.shift() : responses[0];
		if (!next) throw new Error(`unexpected fetch call: ${url}`);
		return next;
	};
	return { calls, fetchImpl };
}

function envFor({ provider, model, apiKey } = {}) {
	const settings = {};
	if (provider !== undefined) settings[PROVIDER_KEY] = provider;
	if (model !== undefined) settings[MODEL_KEY] = model;
	return {
		[settingsEnvName("rerank")]: JSON.stringify(settings),
		...(!apiKey ? {} : { [secretEnvName(API_KEY_KEY)]: apiKey }),
	};
}

/** The creds `readConfig` would resolve for a provider, for the adapter tests. */
function configFor(provider, apiKey = "k") {
	const preset = providerPreset(provider);
	return { provider, model: preset.model, baseUrl: preset.baseUrl, apiKey };
}

test("provider table: unique ids, an HTTPS endpoint and a model each", () => {
	const seen = new Set();
	for (const row of RERANK_PROVIDERS) {
		assert.match(row.id, /^[a-z][a-z0-9-]*$/, `provider id ${row.id}`);
		assert.equal(seen.has(row.id), false, `duplicate provider id ${row.id}`);
		seen.add(row.id);
		assert.equal(row.baseUrl.startsWith("https://"), true, `${row.id} must be HTTPS`);
		assert.ok(row.path.startsWith("/"), `${row.id}'s path is a route under its base URL`);
		assert.ok(row.model && typeof row.model === "string", `${row.id} carries the model its choice resolves to`);
		assert.ok(row.label && row.note, `${row.id} is recognizable in a picker`);
	}
	assert.deepEqual(PROVIDER_IDS, RERANK_PROVIDERS.map((row) => row.id));
	// A key-only preset list: the vendors whose rerank needs a cloud login are absent on purpose.
	for (const cloudOnly of ["google", "bedrock", "azure", "nvidia", "mixedbread", "together"]) {
		assert.equal(PROVIDER_IDS.includes(cloudOnly), false, `${cloudOnly} cannot be configured from a pasted key`);
	}
});

test("the settings section's table is the agent's table: no drift, no second list to keep", () => {
	// The pane is a data: module and cannot import the agent's table, so the projection is
	// duplicated on purpose. This is what keeps the duplicate honest — a vendor, its models or its
	// default changed in one half and not the other fails here rather than in front of a user who
	// picked a model the agent would not call.
	assert.deepEqual(
		PROVIDER_PRESETS.map((entry) => [entry.id, entry.label, entry.baseUrl, entry.defaultModel, entry.models]),
		RERANK_PROVIDERS.map((entry) => [entry.id, entry.label, entry.baseUrl, entry.model, entry.models]),
	);
	// The section is a controlled component, so the schema is storage and validation only — and it
	// must not carry an enum for the model, because the valid set depends on the chosen vendor.
	assert.equal(MANIFEST.app.settings.schema.properties[MODEL_KEY].enum, undefined);
	assert.equal(MANIFEST.app.ui.settingsSections[0].entry, "app/settings-rerank.js");
	assert.equal(typeof createRerankSection, "function");
});

test("manifest and code agree on the provider set and ask for nothing else", () => {
	// The host refuses a manifest whose description runs past this, and it refuses it as a
	// load error rather than trimming: the extension then sits in the list, enabled and inert.
	assert.ok(MANIFEST.description.length <= 200, `manifest description is ${MANIFEST.description.length} characters, the host allows 200`);
	const properties = MANIFEST.app.settings.schema.properties;
	assert.deepEqual(properties[PROVIDER_KEY].enum, PROVIDER_IDS, "the panel's provider list is the adapter table");
	assert.ok(properties[API_KEY_KEY], `the manifest declares ${API_KEY_KEY}`);
	assert.equal(properties[API_KEY_KEY].format, "secret", "the API key is a vault secret, never a settings file value");
	assert.equal(MANIFEST.app.settings.scope, "app");
	assert.equal(MANIFEST.agent.extension, "agent/index.js");
	// The endpoint belongs to the row: a field for it would ask the operator for something the
	// provider choice already decided. The model is a row *and* a dropdown of that row's models.
	assert.deepEqual(Object.keys(properties).sort(), [API_KEY_KEY, MODEL_KEY, PROVIDER_KEY].sort());
});

test("the environment names are derived from the manifest keys", () => {
	// The host computes both names from the property keys (`spawn-assembly.ts`,
	// `extension-settings.ts`); these are the values those keys produce.
	assert.equal(settingsEnvName("rerank"), "PIPIUI_EXT_SETTINGS_RERANK");
	assert.equal(secretEnvName(API_KEY_KEY), "EXT_RERANK_APIKEY");
	assert.equal(settingsEnvName("rerank"), "PIPIUI_EXT_SETTINGS_RERANK");
});

test("readConfig: the provider resolves its own endpoint, and the chosen model wins over the default", () => {
	const resolved = readConfig(envFor({ provider: "cohere", apiKey: "k" }));
	assert.equal(resolved.provider, "cohere");
	assert.equal(resolved.model, providerPreset("cohere").model);
	assert.equal(resolved.baseUrl, providerPreset("cohere").baseUrl);

	const chosen = readConfig(envFor({ provider: "cohere", model: "rerank-v4.0-pro", apiKey: "k" }));
	assert.equal(chosen.model, "rerank-v4.0-pro", "the dropdown's choice is what gets called");
	assert.equal(chosen.baseUrl, providerPreset("cohere").baseUrl, "the model choice never moves the endpoint");

	for (const entry of RERANK_PROVIDERS) {
		assert.ok(entry.models.includes(entry.model), `${entry.id}'s default is one of its own models`);
	}

	assert.throws(() => readConfig(envFor({ apiKey: "k" })), (error) => error.code === "unconfigured");
	assert.throws(() => readConfig(envFor({ provider: "cohere" })), (error) => error.code === "unconfigured");
	assert.throws(() => readConfig(envFor({ provider: "nope", apiKey: "k" })), (error) => error.code === "unconfigured");
	assert.throws(() => readConfig({}), (error) => error.code === "unconfigured");
});

test("describeConfig never carries the key and never throws", () => {
	const status = describeConfig(envFor({ provider: "qwen", apiKey: "super-secret" }));
	assert.equal(status.configured, true);
	assert.equal(status.provider, "qwen");
	assert.equal(status.model, providerPreset("qwen").model);
	assert.equal(status.keyPresent, undefined, "a configured status has no key field at all");
	assert.equal(JSON.stringify(status).includes("super-secret"), false);

	const bare = describeConfig(envFor({ provider: "qwen" }));
	assert.equal(bare.configured, false);
	assert.equal(bare.keyPresent, false);
	assert.equal(bare.model, providerPreset("qwen").model, "a half-configured row can still show what it would call");
});

test("cohere family: POST to the vendor route with the bearer key and the vendor's own body", async () => {
	const { calls, fetchImpl } = recordingFetch(jsonResponse({
		results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 }],
	}));
	const out = await rerankDocuments({ config: configFor("cohere"), query: "the cellar door", documents: ["a", "b"], fetchImpl });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, "https://api.cohere.com/v2/rerank");
	assert.equal(calls[0].init.method, "POST");
	assert.equal(calls[0].init.headers.authorization, "Bearer k");
	assert.deepEqual(JSON.parse(calls[0].init.body), {
		model: providerPreset("cohere").model, query: "the cellar door", documents: ["a", "b"], top_n: 2,
	});
	assert.deepEqual(out.results, [{ index: 1, score: 0.9 }, { index: 0, score: 0.1 }]);
});

test("qwen: the DashScope OpenAI-compatible route, with results[].relevance_score", async () => {
	const { calls, fetchImpl } = recordingFetch(jsonResponse({
		object: "list",
		results: [{ index: 2, relevance_score: 0.7 }, { index: 0, relevance_score: 0.2 }],
	}));
	const out = await rerankDocuments({ config: configFor("qwen"), query: "q", documents: ["a", "b", "c"], topN: 1, fetchImpl });
	assert.equal(calls[0].url, "https://dashscope-intl.aliyuncs.com/compatible-api/v1/reranks");
	assert.deepEqual(JSON.parse(calls[0].init.body), {
		model: providerPreset("qwen").model, query: "q", documents: ["a", "b", "c"], top_n: 1,
	});
	assert.deepEqual(out.results, [{ index: 2, score: 0.7 }], "topN slices the ranked list, it does not reorder it");
});

test("voyage family: data[].relevance_score, with top_k only when asked", async () => {
	const { calls, fetchImpl } = recordingFetch(jsonResponse({ data: [{ index: 0, relevance_score: 0.5 }] }));
	const out = await rerankDocuments({ config: configFor("voyage"), query: "q", documents: ["a"], fetchImpl });
	assert.equal(calls[0].url, "https://api.voyageai.com/v1/rerank");
	assert.equal("top_k" in JSON.parse(calls[0].init.body), false);
	assert.deepEqual(out.results, [{ index: 0, score: 0.5 }]);
});

test("fireworks: the Cohere request with a Voyage-shaped reply", async () => {
	const { calls, fetchImpl } = recordingFetch(jsonResponse({ data: [{ index: 0, relevance_score: 0.4, document: "a" }] }));
	const out = await rerankDocuments({ config: configFor("fireworks"), query: "q", documents: ["a"], fetchImpl });
	assert.equal(calls[0].url, "https://api.fireworks.ai/inference/v1/rerank");
	assert.deepEqual(JSON.parse(calls[0].init.body), {
		model: providerPreset("fireworks").model, query: "q", documents: ["a"], top_n: 1,
	});
	assert.deepEqual(out.results, [{ index: 0, score: 0.4, document: "a" }]);
});

test("pinecone: Api-Key header, documents as objects, and a score field named score", async () => {
	const { calls, fetchImpl } = recordingFetch(jsonResponse({ data: [{ index: 1, score: 0.8, document: { text: "b" } }] }));
	const out = await rerankDocuments({ config: configFor("pinecone"), query: "q", documents: ["a", "b"], fetchImpl });
	assert.equal(calls[0].url, "https://api.pinecone.io/rerank");
	assert.equal(calls[0].init.headers["api-key"], "k");
	assert.deepEqual(JSON.parse(calls[0].init.body), {
		model: providerPreset("pinecone").model,
		query: "q",
		documents: [{ id: "doc-0", text: "a" }, { id: "doc-1", text: "b" }],
		top_n: 2,
	});
	assert.deepEqual(out.results, [{ index: 1, score: 0.8, document: "b" }]);
});

test("rows the vendor did not rank are dropped, and a response with nothing usable is a refusal", async () => {
	const { fetchImpl } = recordingFetch(jsonResponse({ results: [{ index: 9, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 }] }));
	const out = await rerankDocuments({ config: configFor("cohere"), query: "q", documents: ["a"], fetchImpl });
	assert.deepEqual(out.results, [{ index: 0, score: 0.1 }], "an index outside the caller's documents is not a result");

	const empty = recordingFetch(jsonResponse({ results: [] }));
	await assert.rejects(
		() => rerankDocuments({ config: configFor("cohere"), query: "q", documents: ["a"], fetchImpl: empty.fetchImpl }),
		/contained no usable results/,
	);
});

test("a refused request reports the vendor's status and body, and a plain-HTTP endpoint is refused outright", async () => {
	const { fetchImpl } = recordingFetch(jsonResponse({ message: "invalid api key" }, 401));
	await assert.rejects(
		() => rerankDocuments({ config: configFor("cohere", "bad"), query: "q", documents: ["a"], fetchImpl }),
		/HTTP 401.*invalid api key/s,
	);

	await assert.rejects(
		() => rerankDocuments({ config: { ...configFor("cohere"), baseUrl: "http://plain.example" }, query: "q", documents: ["a"], fetchImpl }),
		/non-HTTPS/,
	);
});

test("rerank(): the public surface reads configuration from the environment and returns ranked results", async () => {
	const previousSettings = process.env[settingsEnvName("rerank")];
	const previousKey = process.env[secretEnvName(API_KEY_KEY)];
	Object.assign(process.env, envFor({ provider: "cohere", apiKey: "k" }));
	const { calls, fetchImpl } = recordingFetch(jsonResponse({ results: [{ index: 0, relevance_score: 1 }] }));
	try {
		const out = await rerank("q", ["a"], { fetchImpl });
		assert.equal(out.provider, "cohere");
		assert.equal(out.model, providerPreset("cohere").model);
		assert.deepEqual(out.results, [{ index: 0, score: 1 }]);
		assert.equal(calls[0].init.headers.authorization, "Bearer k");
	} finally {
		if (previousSettings === undefined) delete process.env[settingsEnvName("rerank")];
		else process.env[settingsEnvName("rerank")] = previousSettings;
		if (previousKey === undefined) delete process.env[secretEnvName(API_KEY_KEY)];
		else process.env[secretEnvName(API_KEY_KEY)] = previousKey;
	}
});

test("rerank(): an empty query or an empty document list is refused before any request", async () => {
	await assert.rejects(() => rerank("", ["a"], { config: {} }), /non-empty query/);
	await assert.rejects(() => rerank("q", [], { config: {} }), /at least one document/);
});
