import fs from "node:fs";
import path from "node:path";

import { resolveProductAgentDir } from "./agent-dir.mjs";

/**
 * Product web-search secrets live in `{PI_AGENT_DIR}/web-search.json`.
 * Never write keys into coc-desktop-settings.json or UI prefs / localStorage.
 *
 * HTTP contract for later UI (do not echo secrets):
 *
 * GET  /api/web-search-keys → {@link WebSearchKeysView}
 * PUT  /api/web-search-keys ← {@link WebSearchKeysPatch}
 * PUT  /api/web-search-keys → {@link WebSearchKeysView}
 *
 * @typedef {object} WebSearchKeyProvider
 * @property {string} id
 * @property {string} name
 * @property {string} keyField  // always ends with ApiKey
 *
 * @typedef {object} WebSearchKeysView
 * @property {Record<string, boolean>} keys  // *ApiKey → configured; values never returned
 * @property {readonly WebSearchKeyProvider[]} providers
 *
 * @typedef {object} WebSearchKeysPatch
 * @property {Record<string, string>} [keys]  // empty string deletes; only *ApiKey
 */

export const WEB_SEARCH_CONFIG_NAME = "web-search.json";
export const WEB_SEARCH_DEFAULTS_MARKER = ".coc-web-search-defaults-v1.json";
export const DEFAULT_WEB_SEARCH_WORKFLOW = "none";

/** v1 catalog: Exa required; openai/searxng optional. Explicit-only providers stay off this list. */
export const WEB_SEARCH_KEY_PROVIDERS = Object.freeze([
  Object.freeze({ id: "exa", name: "Exa", keyField: "exaApiKey" }),
  Object.freeze({ id: "openai", name: "OpenAI", keyField: "openaiApiKey" }),
  Object.freeze({ id: "searxng", name: "SearXNG", keyField: "searxngApiKey" }),
]);

export const DEFAULT_SEARCH_ROUTING = Object.freeze({
  providers: Object.freeze(["exa", "searxng", "openai"]),
  fallbackOn: Object.freeze(["quota", "transient", "network", "invalid-response"]),
});

const API_KEY_SUFFIX = "ApiKey";
const MAX_KEY_LEN = 8192;
const EXPLICIT_ONLY_PROVIDERS = Object.freeze(["anysearch", "xai", "brightdata", "serpbase"]);

function keysError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isApiKeyField(key) {
  return typeof key === "string" && key.endsWith(API_KEY_SUFFIX) && key.length > API_KEY_SUFFIX.length;
}

export function webSearchConfigPath(agentDir) {
  return path.join(agentDir, WEB_SEARCH_CONFIG_NAME);
}

export function webSearchDefaultsMarkerPath(agentDir) {
  return path.join(agentDir, WEB_SEARCH_DEFAULTS_MARKER);
}

export function resolveWebSearchConfigPath(opts) {
  return webSearchConfigPath(resolveProductAgentDir(opts));
}

function readJsonObject(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return asObject(parsed) ?? {};
  } catch (err) {
    if (err && err.code === "ENOENT") return {};
    throw err;
  }
}

function atomicWriteJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Windows and some FS ignore mode; secrets still never leave this file.
    }
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // tmp may not exist if write failed before create
    }
    throw err;
  }
}

function cloneRouting() {
  return {
    providers: [...DEFAULT_SEARCH_ROUTING.providers],
    fallbackOn: [...DEFAULT_SEARCH_ROUTING.fallbackOn],
  };
}

export function hasPinnedProvider(config) {
  const obj = asObject(config);
  if (!obj) return false;
  return Object.prototype.hasOwnProperty.call(obj, "provider")
    || Object.prototype.hasOwnProperty.call(obj, "searchProvider");
}

function providerFromKeyField(field) {
  return field.slice(0, -API_KEY_SUFFIX.length);
}

function configuredKeyFlags(config) {
  const result = {};
  for (const [key, value] of Object.entries(asObject(config) ?? {})) {
    if (isApiKeyField(key) && typeof value === "string" && value.trim() !== "") {
      result[key] = true;
    }
  }
  return result;
}

export function publicWebSearchKeysView(config) {
  return {
    keys: configuredKeyFlags(config),
    providers: WEB_SEARCH_KEY_PROVIDERS,
  };
}

/**
 * Reorder default providers so those with non-empty *ApiKey come first.
 * Explicit-only providers (anysearch / xai / brightdata / serpbase) are never inserted.
 * @returns {string[] | null} new list, or null when there is nothing to reorder
 */
export function reorderProvidersForKeyPriority(config) {
  const keyedProviders = new Set();
  for (const [key, value] of Object.entries(asObject(config) ?? {})) {
    if (isApiKeyField(key) && typeof value === "string" && value.trim() !== "") {
      keyedProviders.add(providerFromKeyField(key));
    }
  }
  if (keyedProviders.size === 0) return null;

  const withKeys = [];
  const withoutKeys = [];
  for (const provider of DEFAULT_SEARCH_ROUTING.providers) {
    if (EXPLICIT_ONLY_PROVIDERS.includes(provider)) continue;
    if (keyedProviders.has(provider)) withKeys.push(provider);
    else withoutKeys.push(provider);
  }
  return [...withKeys, ...withoutKeys];
}

export function applyWebSearchDefaults(current, previousManaged) {
  const next = { ...(asObject(current) ?? {}) };
  const managed = {};
  const previous = asObject(previousManaged) ?? {};

  const take = (key, value) => {
    if (next[key] === undefined || equalJson(next[key], previous[key])) next[key] = value;
    if (equalJson(next[key], value)) managed[key] = value;
  };

  take("workflow", DEFAULT_WEB_SEARCH_WORKFLOW);
  if (hasPinnedProvider(next)) {
    if (equalJson(next.searchRouting, previous.searchRouting)) delete next.searchRouting;
  } else {
    take("searchRouting", cloneRouting());
  }

  return { next, managed };
}

function readMarkerManaged(agentDir) {
  const marker = readJsonObject(webSearchDefaultsMarkerPath(agentDir));
  if (marker.version === 1 && asObject(marker.managed)) return marker.managed;
  return undefined;
}

export function ensureWebSearchDefaults(agentDir) {
  const configPath = webSearchConfigPath(agentDir);
  const markerPath = webSearchDefaultsMarkerPath(agentDir);
  const existed = fs.existsSync(configPath);
  const current = existed ? readJsonObject(configPath) : undefined;
  const previousManaged = readMarkerManaged(agentDir);
  const { next, managed } = applyWebSearchDefaults(current, previousManaged);
  const nextMarker = { version: 1, managed };
  const marker = fs.existsSync(markerPath) ? readJsonObject(markerPath) : undefined;
  if (current !== undefined && equalJson(current, next) && equalJson(marker, nextMarker)) {
    return "unchanged";
  }
  atomicWriteJson(configPath, next);
  atomicWriteJson(markerPath, nextMarker);
  return existed ? "updated" : "created";
}

export function readWebSearchConfig(agentDir) {
  return readJsonObject(webSearchConfigPath(agentDir));
}

export function loadWebSearchKeysView(agentDir) {
  return publicWebSearchKeysView(readWebSearchConfig(agentDir));
}

/**
 * Canonical PUT body is `{ keys: { exaApiKey: "…" } }`.
 * A flat `{ exaApiKey: "…" }` map is also accepted when `keys` is omitted.
 */
export function parseWebSearchKeysPatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw keysError("request body must be a JSON object");
  }
  const nested = Object.prototype.hasOwnProperty.call(body, "keys");
  const raw = nested ? body.keys : body;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw keysError("keys must be an object");
  }
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isApiKeyField(key)) {
      throw keysError(`unknown web-search key field: ${key}`);
    }
    if (typeof value !== "string") {
      throw keysError(`${key} must be a string`);
    }
    if (value.length > MAX_KEY_LEN) {
      throw keysError(`${key} is too long`);
    }
    out[key] = value;
  }
  return out;
}

function mergeApiKeys(current, patch) {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value.trim() === "") delete next[key];
    else next[key] = value;
  }
  return next;
}

function applyKeyReorder(config) {
  if (hasPinnedProvider(config)) return config;
  const reordered = reorderProvidersForKeyPriority(config);
  if (reordered === null) return config;
  const existingRouting = asObject(config.searchRouting);
  if (existingRouting) {
    return { ...config, searchRouting: { ...existingRouting, providers: reordered } };
  }
  return {
    ...config,
    searchRouting: {
      providers: reordered,
      fallbackOn: [...DEFAULT_SEARCH_ROUTING.fallbackOn],
    },
  };
}

export function saveWebSearchApiKeys(agentDir, body) {
  if (!agentDir) {
    throw keysError("agent dir is not writable");
  }
  const patch = parseWebSearchKeysPatch(body);
  const current = readWebSearchConfig(agentDir);
  const merged = mergeApiKeys(current, patch);
  const previousManaged = readMarkerManaged(agentDir);
  const { next: withDefaults, managed } = applyWebSearchDefaults(merged, previousManaged);
  const next = applyKeyReorder(withDefaults);
  atomicWriteJson(webSearchConfigPath(agentDir), next);
  atomicWriteJson(webSearchDefaultsMarkerPath(agentDir), { version: 1, managed });
  return publicWebSearchKeysView(next);
}
