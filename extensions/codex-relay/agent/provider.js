import { AUTH_PROVIDER_ID, PROVIDER_NAME, DEFAULT_BASE_URL, relayModels } from "./models.js";
export { AUTH_PROVIDER_ID } from "./models.js";

export function normalizeRelayUrl(raw) {
    const url = new URL(raw);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        || url.username || url.password || url.search || url.hash) {
        throw new Error("Codex Relay requires a local loopback HTTP URL without credentials, query or fragment.");
    }
    return url.href.replace(/\/+$/, "");
}

function configuredUrl(env) {
    if (env.PIPICOC_CODEX_RELAY_URL?.trim()) return env.PIPICOC_CODEX_RELAY_URL.trim();
    let settings;
    try { settings = JSON.parse(env.PIPIUI_EXT_SETTINGS_CODEX_RELAY ?? "{}"); } catch { settings = {}; }
    return settings?.["ext.codex-relay.baseUrl"] || DEFAULT_BASE_URL;
}

/** The relay owns Codex OAuth. This local placeholder is never an OAuth token. */
export function createAuthProvider(options = {}) {
    const env = options.env ?? process.env;
    return {
        name: PROVIDER_NAME,
        api: "openai-responses",
        baseUrl: normalizeRelayUrl(options.baseUrl ?? configuredUrl(env)),
        apiKey: "codex-relay-local",
        authHeader: false,
        models: relayModels(),
    };
}
