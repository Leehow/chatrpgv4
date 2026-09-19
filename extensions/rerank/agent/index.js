/**
 * rerank extension — a cross-encoder re-ranking client for retrieval, configured per install.
 *
 * Who writes the configuration: the PipiUI settings form, generated from this package's
 * `pipiui-extension.json` schema. The provider, model and base URL are ordinary settings;
 * the API key is a `format: "secret"` property, so the host keeps it in the vault and hands
 * it to this process as an environment variable (`agent/config.js` reads both).
 *
 * Who reads it: this module. `rerank()` is the whole public surface — one query, a list of
 * documents, the ranked slice back — and the two commands below make the configuration
 * observable without a caller: `/rerank:status` says what is resolved, `/rerank:test` spends
 * one cheap request to prove the key works.
 *
 * Who acts on it: nobody yet. No Keeper verb, lane or panel calls `rerank()` in this slice;
 * the callers this is built for are the retrieval paths that today return an unranked list
 * (`lookup` candidates, module text search, memory recall), and wiring one of them is a
 * product decision this extension deliberately leaves open — a configurable capability that
 * silently reordered somebody else's results would be a worse first slice than one that
 * waits to be called.
 */

import { readConfig, describeConfig } from "./config.js";
import { rerankDocuments, PROVIDER_IDS } from "./vendors.js";

/**
 * Rank `documents` against `query`, best first, at most `topN` of them.
 *
 * Returns `{ model, provider, results: [{ index, score, document? }] }` with `index` pointing
 * back into the `documents` array the caller passed. A configuration that is absent or a
 * vendor that refuses throws — the caller decides what an unavailable reranker means for its
 * own ordering, because falling back to the unranked list is its decision, not this one's.
 */
export async function rerank(query, documents, options = {}) {
	if (typeof query !== "string" || !query.trim()) throw new Error("rerank needs a non-empty query");
	const list = Array.isArray(documents) ? documents.map((entry) => String(entry)) : [];
	if (!list.length) throw new Error("rerank needs at least one document");
	const config = options.config ?? readConfig();
	const result = await rerankDocuments({
		config,
		query: query.trim(),
		documents: list,
		topN: options.topN,
		signal: options.signal,
		fetchImpl: options.fetchImpl,
	});
	return { provider: config.provider, model: result.model, results: result.results };
}

/** The extension's entry point: two commands over the one function above. */
export default function rerankExtension(pi) {
	pi.registerCommand("rerank:status", {
		description: "Show which rerank provider, model and key this session resolved",
		handler: async (_args, ctx) => {
			const status = describeConfig();
			if (!status.configured) {
				ctx.ui.notify(`rerank: not configured (${status.reason})`, "info");
				return;
			}
			ctx.ui.notify(`rerank: ${status.label} · ${status.model} · ${status.baseUrl} · key set`, "info");
		},
	});

	pi.registerCommand("rerank:test", {
		description: "Spend one cheap rerank request to prove the configured provider and key work",
		handler: async (args, ctx) => {
			const query = typeof args === "string" && args.trim() ? args.trim() : "the cellar door is bolted from the inside";
			try {
				const { provider, model, results } = await rerank(query, [
					"The investigator tries the cellar door; the bolt holds.",
					"A dog barks somewhere down the lane.",
				]);
				const ranked = results.map((row) => `#${row.index} ${row.score.toFixed(3)}`).join(", ");
				ctx.ui.notify(`rerank ok — ${provider}/${model}: ${ranked}`, "info");
			} catch (error) {
				ctx.ui.notify(`rerank failed — ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}

export { PROVIDER_IDS };
