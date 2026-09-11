/**
 * Image-model configuration for the vendor fallback path.
 *
 * The chosen model lives in `<agentHome>/image-model.json` as
 * `{ "model": "provider/model-id" }`. The agent home resolves with the same
 * precedence as every other module in this package: PI_COC_AGENT_DIR >
 * PI_CODING_AGENT_DIR, failing closed when neither is set (single source in
 * the grok-build-oauth package, which this extension already bundles).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveAgentHome } from "../../grok-build-oauth/agent/oauth/home.js";

const CONFIG_FILE = "image-model.json";

function configPath(home) {
	return join(home ?? resolveAgentHome(), CONFIG_FILE);
}

/** Configured model spec (`"provider/model-id"` or a bare model id), or undefined. */
export function readConfiguredModel(home) {
	let raw;
	try {
		raw = readFileSync(configPath(home), "utf8");
	} catch {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw);
		const model = typeof parsed?.model === "string" ? parsed.model.trim() : "";
		return model ? { model } : undefined;
	} catch {
		return undefined;
	}
}

/** Persist the model spec; returns the path written. */
export function writeConfiguredModel(model, home) {
	const path = configPath(home);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, JSON.stringify({ model }, null, 2) + "\n", { mode: 0o600 });
	return path;
}

/**
 * Split `"provider/model-id"` on the first slash. A bare model id yields
 * `{ provider: undefined, modelId }` — the provider is then looked up in the
 * model registry by model id.
 */
export function parseModelSpec(spec) {
	const trimmed = spec.trim();
	if (!trimmed) throw new Error("the model spec must not be empty");
	const slash = trimmed.indexOf("/");
	if (slash < 0) return { provider: undefined, modelId: trimmed };
	const provider = trimmed.slice(0, slash).trim();
	const modelId = trimmed.slice(slash + 1).trim();
	if (!provider || !modelId) {
		throw new Error(`invalid model spec "${spec}" — use <provider>/<model-id> or a bare model id`);
	}
	return { provider, modelId };
}
