/**
 * Flapcode extension config: settings snapshot + base URL / API-key resolution.
 *
 * The API key is a `format: secret` extension setting: the host stores it in
 * the extension secret vault (never settings JSON, never models.json, never
 * auth.json) and injects it into this agent process as `EXT_FLAPCODE_APIKEY`
 * (`secretEnvName("ext.flapcode.apiKey")`). Non-secret settings arrive as the
 * `PIPIUI_EXT_SETTINGS_FLAPCODE` JSON snapshot. This module only reads
 * process env; the provider never writes any store itself.
 */
import { FLAPCODE_BASE_URL } from "./models.js";
export const EXTENSION_ID = "flapcode";
export const SETTINGS_API_KEY = "ext.flapcode.apiKey";
export const SETTINGS_BASE_URL = "ext.flapcode.baseUrl";
/** Host-injected env var holding the vault-stored secret (see extension-settings.ts). */
export const API_KEY_ENV = "EXT_FLAPCODE_APIKEY";
const SETTINGS_ENV = "PIPIUI_EXT_SETTINGS_FLAPCODE";
export function settingsSnapshot() {
    const raw = process.env[SETTINGS_ENV];
    if (!raw)
        return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
function settingString(...keys) {
    const snap = settingsSnapshot();
    if (!snap)
        return undefined;
    for (const key of keys) {
        const value = snap[key];
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return undefined;
}
/**
 * API key resolution: the vault-injected env var wins; the settings snapshot
 * lookup is a fallback for hosts that inline secrets (and for tests). Empty
 * when the user has not configured a key.
 */
export function resolveFlapcodeApiKey() {
    const fromEnv = process.env[API_KEY_ENV]?.trim();
    if (fromEnv)
        return fromEnv;
    return settingString(SETTINGS_API_KEY, "apiKey");
}
export function normalizeBaseUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        throw new Error("Flapcode baseUrl must not be empty");
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new Error(`Invalid Flapcode baseUrl: ${trimmed}`);
    }
    if (url.protocol !== "https:") {
        throw new Error(`Flapcode requests require HTTPS (received ${url.protocol})`);
    }
    return trimmed.replace(/\/+$/, "");
}
/** Default `https://codex.flapcode.com/v1`; `ext.flapcode.baseUrl` overrides. */
export function resolveBaseUrl(override) {
    if (override?.trim())
        return normalizeBaseUrl(override);
    const fromSettings = settingString(SETTINGS_BASE_URL, "baseUrl");
    if (fromSettings)
        return normalizeBaseUrl(fromSettings);
    return FLAPCODE_BASE_URL;
}
export function resolveFlapcodeConfig(options = {}) {
    const apiKey = options.apiKey?.trim() || resolveFlapcodeApiKey();
    return {
        baseUrl: resolveBaseUrl(options.baseUrl),
        ...(apiKey ? { apiKey } : {}),
    };
}
