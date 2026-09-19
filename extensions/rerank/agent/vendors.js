/**
 * Vendor adapters for rerank, and the closed provider table that routes to them.
 *
 * Every HTTP rerank API in the wild is one of a handful of shapes, so the work is split the
 * way `extensions/image-gen/agent/vendors.js` splits it: an adapter per *family* of wire
 * formats, and a table row per vendor. Adding a vendor that speaks an existing shape is a
 * row; adding a shape is an adapter.
 *
 * The table is the whole configuration surface: picking a provider is what fixes the
 * endpoint, the auth header and the model. The operator never types a model id or a URL,
 * which is why the panel asks for a provider and a key and nothing else — and why a row here
 * is a promise that the endpoint and the model are current. Rows were verified against the
 * vendors' own documentation on 2026-09-18 (`docs/specs/rerank-extension.md` records the
 * sources); a vendor whose rerank needs OAuth, SigV4 or a per-deployment URL is deliberately
 * absent, because a preset that cannot work from a pasted key is a preset that only fails.
 *
 * Routing is a closed mapping on the configured provider id, never a guess about an endpoint
 * or a model name.
 */

/** Where a vendor's key goes in the request. A closed set, because it is wire format, not policy. */
const AUTH_STYLES = Object.freeze({
	bearer: (key) => ({ authorization: `Bearer ${key}` }),
	"api-key": (key) => ({ "api-key": key }),
});

/**
 * The preset table: one row per provider this extension can call from a pasted API key.
 *
 * `family` names the wire shape, `path` the route under `baseUrl`, `model` what the provider's
 * choice defaults to and `models` the closed list that choice may take — the panel renders that
 * list as a dropdown, so nobody types a model id — and `note` the one line that helps someone
 * recognize the vendor.
 */
export const RERANK_PROVIDERS = Object.freeze([
	{
		id: "cohere",
		label: "Cohere",
		family: "cohere",
		baseUrl: "https://api.cohere.com",
		path: "/v2/rerank",
		auth: "bearer",
		model: "rerank-v4.0-fast",
		models: Object.freeze(["rerank-v4.0-fast", "rerank-v4.0-pro", "rerank-v3.5", "rerank-english-v3.0", "rerank-multilingual-v3.0"]),
		note: "Rerank 4 Fast. Multilingual; rerank-v4.0-pro ranks better and costs more.",
	},
	{
		id: "qwen",
		label: "Alibaba Qwen",
		family: "cohere",
		baseUrl: "https://dashscope-intl.aliyuncs.com",
		path: "/compatible-api/v1/reranks",
		auth: "bearer",
		model: "qwen3-rerank",
		models: Object.freeze(["qwen3-rerank"]),
		note: "DashScope's OpenAI-compatible rerank; 100+ languages. A mainland-China workspace answers on its own host instead.",
	},
	{
		id: "jina",
		label: "Jina AI",
		family: "cohere",
		baseUrl: "https://api.jina.ai",
		path: "/v1/rerank",
		auth: "bearer",
		model: "jina-reranker-v3.5",
		models: Object.freeze(["jina-reranker-v3.5", "jina-reranker-v3", "jina-reranker-m0", "jina-reranker-v2-base-multilingual"]),
		note: "Multilingual, very long context; free tokens on new keys.",
	},
	{
		id: "voyage",
		label: "Voyage AI",
		family: "voyage",
		baseUrl: "https://api.voyageai.com",
		path: "/v1/rerank",
		auth: "bearer",
		model: "rerank-2.5",
		models: Object.freeze(["rerank-2.5", "rerank-2.5-lite"]),
		note: "Strong retrieval reranker; rerank-2.5-lite is the cheaper sibling.",
	},
	{
		id: "siliconflow",
		label: "SiliconFlow",
		family: "cohere",
		baseUrl: "https://api.siliconflow.com",
		path: "/v1/rerank",
		auth: "bearer",
		model: "Qwen/Qwen3-Reranker-8B",
		models: Object.freeze(["Qwen/Qwen3-Reranker-8B", "Qwen/Qwen3-Reranker-4B", "Qwen/Qwen3-Reranker-0.6B", "BAAI/bge-reranker-v2-m3"]),
		note: "Hosts the open Qwen3 rerankers; the 4B and 0.6B sizes are cheaper.",
	},
	{
		id: "zeroentropy",
		label: "ZeroEntropy",
		family: "cohere",
		baseUrl: "https://api.zeroentropy.dev",
		path: "/v1/models/rerank",
		auth: "bearer",
		model: "zerank-2",
		models: Object.freeze(["zerank-2", "zerank-1", "zerank-1-small"]),
		note: "Cheap per token, multilingual; an EU endpoint exists.",
	},
	{
		id: "fireworks",
		label: "Fireworks AI",
		family: "fireworks",
		baseUrl: "https://api.fireworks.ai",
		path: "/inference/v1/rerank",
		auth: "bearer",
		model: "fireworks/qwen3-reranker-8b",
		models: Object.freeze(["fireworks/qwen3-reranker-8b"]),
		note: "Serverless Qwen3 reranker.",
	},
	{
		id: "pinecone",
		label: "Pinecone",
		family: "pinecone",
		baseUrl: "https://api.pinecone.io",
		path: "/rerank",
		auth: "api-key",
		model: "bge-reranker-v2-m3",
		models: Object.freeze(["bge-reranker-v2-m3", "pinecone-rerank-v0", "cohere-rerank-4-fast"]),
		note: "Hosted rerank beside your index; several models behind one key.",
	},
	{
		id: "openrouter",
		label: "OpenRouter",
		family: "cohere",
		baseUrl: "https://openrouter.ai",
		path: "/api/v1/rerank",
		auth: "bearer",
		model: "cohere/rerank-v3.5",
		models: Object.freeze(["cohere/rerank-v3.5", "voyage/rerank-2.5"]),
		note: "Routes to other vendors' rerankers behind one key.",
	},
]);

export const PROVIDER_IDS = Object.freeze(RERANK_PROVIDERS.map((entry) => entry.id));

/** The row for a provider id, or undefined: the table is the only authority on what is known. */
export function providerPreset(id) {
	const wanted = String(id ?? "").trim().toLowerCase();
	return RERANK_PROVIDERS.find((entry) => entry.id === wanted);
}

const DEFAULT_TIMEOUT_MS = 60_000;

function ensureHttps(raw, label) {
	const trimmed = String(raw ?? "").trim();
	let url;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error(`invalid ${label}: ${trimmed}`);
	}
	if (url.protocol !== "https:") throw new Error(`refusing a non-HTTPS ${label}: ${trimmed} (API keys are sent over HTTPS only)`);
	return trimmed.replace(/\/+$/, "");
}

/** The slice to return, clamped to what the vendor actually sent back. */
function slice(results, topN, documentCount) {
	const wanted = Number.isInteger(topN) && topN > 0 ? Math.min(topN, documentCount) : documentCount;
	return results.slice(0, wanted);
}

function scored(rows, readIndex, readScore, documentCount) {
	return rows
		.map((row) => {
			const index = Number(readIndex(row));
			const score = Number(readScore(row));
			const document = row?.document === undefined ? undefined : (typeof row.document === "string" ? row.document : row.document?.text);
			return { index, score, ...(document === undefined ? {} : { document }) };
		})
		.filter((row) => Number.isInteger(row.index) && Number.isFinite(row.score) && row.index >= 0 && row.index < documentCount);
}

/** `{results: [{index, relevance_score}]}` — Cohere, Jina, SiliconFlow, ZeroEntropy, OpenRouter, Qwen's compat route. */
const parseResults = (json, documentCount) => scored(
	Array.isArray(json?.results) ? json.results : [],
	(row) => row?.index, (row) => row?.relevance_score, documentCount,
);

/** `{data: [{index, relevance_score}]}` — Voyage, and Fireworks' Voyage-shaped reply. */
const parseData = (json, documentCount) => scored(
	Array.isArray(json?.data) ? json.data : [],
	(row) => row?.index, (row) => row?.relevance_score, documentCount,
);

/** `{data: [{index, score}]}` — Pinecone names the score differently from everyone else. */
const parseScoredData = (json, documentCount) => scored(
	Array.isArray(json?.data) ? json.data : [],
	(row) => row?.index, (row) => row?.score, documentCount,
);

/** Each family: how to build the request body, and how to read the answer back. */
const FAMILIES = Object.freeze({
	cohere: {
		body: ({ model, query, documents, topN }) => ({
			model,
			query,
			documents,
			top_n: Number.isInteger(topN) && topN > 0 ? topN : documents.length,
		}),
		parse: parseResults,
	},
	voyage: {
		body: ({ model, query, documents, topN }) => ({
			model,
			query,
			documents,
			...(Number.isInteger(topN) && topN > 0 ? { top_k: topN } : {}),
		}),
		parse: parseData,
	},
	// Fireworks takes the Cohere request and answers in Voyage's shape.
	fireworks: { body: null, parse: parseData },
	pinecone: {
		body: ({ model, query, documents, topN }) => ({
			model,
			query,
			documents: documents.map((text, index) => ({ id: `doc-${index}`, text })),
			top_n: Number.isInteger(topN) && topN > 0 ? topN : documents.length,
		}),
		parse: parseScoredData,
	},
});
FAMILIES.fireworks.body = FAMILIES.cohere.body;

async function readErrorText(response) {
	const raw = await response.text().catch(() => "");
	return [...String(raw)].slice(0, 300).join("");
}

/**
 * One rerank call: build the family's body, send it, read the family's answer.
 *
 * `fetchImpl` and `signal` are injected so a test can run the whole path with no network,
 * which is how every vendor row is covered in `tests/extension/rerank.test.mjs`.
 */
export async function rerankDocuments({ config, query, documents, topN, signal, fetchImpl } = {}) {
	if (!config || typeof config !== "object") throw new Error("rerank needs a resolved configuration");
	const preset = providerPreset(config.provider);
	const family = preset ? FAMILIES[preset.family] : undefined;
	if (!family) throw new Error(`no rerank adapter knows the provider ${JSON.stringify(config.provider)}`);
	const model = String(config.model ?? preset.model);
	const url = `${ensureHttps(config.baseUrl ?? preset.baseUrl, "base URL")}${String(preset.path).replace("{model}", encodeURIComponent(model))}`;
	const key = String(config.apiKey ?? "");
	const auth = AUTH_STYLES[preset.auth];
	if (!auth) throw new Error(`unknown rerank auth style ${JSON.stringify(preset.auth)}`);
	const body = family.body({ model, query, documents, topN });
	const send = fetchImpl ?? fetch;
	const response = await send(url, {
		method: "POST",
		headers: { "content-type": "application/json", ...auth(key), ...(preset.headers ?? {}) },
		body: JSON.stringify(body),
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)]) : AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`rerank request failed HTTP ${response.status}: ${await readErrorText(response)}`);
	const json = await response.json().catch(() => {
		throw new Error("could not parse the rerank response as JSON");
	});
	const parsed = family.parse(json, documents.length);
	if (!parsed.length) throw new Error(`the ${preset.label} rerank response contained no usable results`);
	return { model, results: slice(parsed, topN, documents.length) };
}
