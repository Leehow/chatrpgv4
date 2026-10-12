export const AUTH_PROVIDER_ID = "codex-relay";
export const PROVIDER_NAME = "Codex Relay";
export const DEFAULT_BASE_URL = "http://127.0.0.1:18890/v1";

export function relayModels() {
    return [{
        id: "gpt-6-luna",
        name: "GPT-6 Luna (Codex Relay)",
        api: "openai-responses",
        reasoning: true,
        input: ["text", "image"],
        // API list prices; the relay's Codex subscription billing is separate.
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0 },
        contextWindow: 1050000,
        maxTokens: 128000,
        thinkingLevelMap: {
            off: "none", minimal: "low", low: "low", medium: "medium",
            high: "high", xhigh: "xhigh", max: "max",
        },
        compat: {
            supportsLongCacheRetention: false,
            supportsStrictMode: true,
            supportsMaxOutputTokens: false,
        },
    }];
}
