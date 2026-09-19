/**
 * Rerank configuration: which provider this process was spawned with, and its key.
 *
 * The host is the only writer. Two things arrive in the child environment at spawn
 * (`Electron/packages/pi-backend/src/spawn-assembly.ts`):
 *
 *   - `PIPIUI_EXT_SETTINGS_RERANK` — the extension's non-secret settings document, JSON:
 *     `{ "ext.rerank.provider": "cohere" }`
 *   - `EXT_RERANK_APIKEY` — the `ext.rerank.apiKey` secret out of the vault, whose
 *     `format: "secret"` means it never lands in a settings file, a snapshot or an IPC payload.
 *
 * The provider is the whole choice: the endpoint, the auth header and the model come from
 * `vendors.js`'s preset table, so nobody has to know a model id or a base URL to configure
 * this. The two env names are derived from the manifest's property keys by the host, so the
 * transform is mirrored here once and pinned by `tests/extension/rerank.test.mjs`.
 *
 * This module reads and never writes a setting: the panel is the only writer, and the host
 * rejects an agent half that tries to be one.
 */

import { RERANK_PROVIDERS, providerPreset } from "./vendors.js";

/** `ext.rerank.provider` → `PIPIUI_EXT_SETTINGS_RERANK`; mirrors `extensionSettingsEnvName` in the host. */
export function settingsEnvName(extensionId = "rerank") {
	const token = String(extensionId).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
	return `PIPIUI_EXT_SETTINGS_${token || "EXT"}`;
}

/** `ext.rerank.apiKey` → `EXT_RERANK_APIKEY`; mirrors `secretEnvName` in the host. */
export function secretEnvName(key) {
	const raw = String(key).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
	const name = raw.length === 0 ? "EXT_SECRET" : raw.slice(0, 64);
	return /^[A-Z]/.test(name) ? name : `E${name.slice(0, 63)}`;
}

export const SETTINGS_ENV = settingsEnvName();
export const API_KEY_ENV = secretEnvName("ext.rerank.apiKey");
export const PROVIDER_KEY = "ext.rerank.provider";
export const MODEL_KEY = "ext.rerank.model";
export const API_KEY_KEY = "ext.rerank.apiKey";

function text(value) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseSettings(raw) {
	if (typeof raw !== "string" || !raw.trim()) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function unconfigured(message) {
	const error = new Error(message);
	error.code = "unconfigured";
	return error;
}

/**
 * The resolved configuration for one call, or a coded refusal.
 *
 * `unconfigured` is a stable code so a caller can tell "go pick a provider and paste a key"
 * from a vendor failure without matching prose. A key is required by every provider this
 * extension knows: there is no anonymous rerank endpoint.
 */
export function readConfig(env = process.env) {
	const settings = parseSettings(env[SETTINGS_ENV]);
	const providerId = text(settings[PROVIDER_KEY]);
	if (!providerId) {
		throw unconfigured(
			"no rerank provider is configured — open Settings → Extensions → Rerank and choose one, then paste its API key",
		);
	}
	const preset = providerPreset(providerId);
	if (!preset) {
		throw unconfigured(
			`unknown rerank provider ${JSON.stringify(providerId)}; known providers: ${RERANK_PROVIDERS.map((entry) => entry.id).join(", ")}`,
		);
	}
	const apiKey = text(env[API_KEY_ENV]);
	if (!apiKey) {
		// Two situations reach this line and the operator has to be able to tell them apart: nothing
		// was ever saved, or a key was saved after this process started. The host hands the secret to
		// the child at spawn (spawn-assembly.ts assigns `pkg.secretEnv` into the child environment),
		// so a key typed into a running table is in the vault and not in here.
		throw unconfigured(
			`the ${preset.label} rerank API key is not in this session — save it in Settings → Extensions → Rerank if you have not, then reopen the table: a key reaches the agent when a session starts`,
		);
	}
	// The panel's dropdown offers exactly `preset.models`, so a model outside that list means the
	// setting was written by hand. It is passed through rather than refused: the vendor is the
	// authority on which model ids exist, and a retired id must fail at the vendor, with the
	// vendor's own words, not with a list this extension happens to carry.
	const model = text(settings[MODEL_KEY]) ?? preset.model;
	return Object.freeze({
		provider: preset.id,
		label: preset.label,
		model,
		baseUrl: preset.baseUrl,
		apiKey,
	});
}

/**
 * What a status line may say: the same resolution, minus the secret and minus a refusal —
 * a caller that is only reporting has no business failing because nobody configured it.
 */
export function describeConfig(env = process.env) {
	try {
		const config = readConfig(env);
		return { configured: true, provider: config.provider, label: config.label, model: config.model, baseUrl: config.baseUrl };
	} catch (error) {
		const settings = parseSettings(env[SETTINGS_ENV]);
		return {
			configured: false,
			provider: text(settings[PROVIDER_KEY]),
			keyPresent: Boolean(text(env[API_KEY_ENV])),
			model: text(settings[MODEL_KEY]) ?? providerPreset(text(settings[PROVIDER_KEY]))?.model,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}
