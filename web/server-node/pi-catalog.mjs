import fs from "node:fs";
import path from "node:path";

// Pi's built-in provider catalog for the 编辑模型 editor.
// Featured cards stay curated in desktop/electron/auth.mjs and
// agentconfig.mjs; this module only enumerates the rest so a "更多"
// control can list them without inventing a second provider registry.
// Lives in the web payload so the main-window HTTP editor and the
// desktop settings window share one catalog reader.

const catalogCache = new Map();

export function keeperNodeModules(payloadRoot) {
  const dir = path.join(payloadRoot, "runtime", "adapters", "keeper", "node_modules");
  if (!fs.existsSync(path.join(dir, "@earendil-works", "pi-coding-agent"))) {
    throw new Error(`pi 库未找到：${dir}`);
  }
  return dir;
}

function noteFor(methods) {
  if (methods.includes("oauth") && methods.includes("api_key")) return "Pi 内置 · 订阅登录或 API Key";
  if (methods.includes("oauth")) return "Pi 内置 · 订阅/OAuth 登录";
  if (methods.includes("api_key")) return "Pi 内置 · API Key";
  return "Pi 内置 · 需环境凭据";
}

export function serializePiProvider(provider) {
  const methods = [];
  if (provider?.auth?.oauth) methods.push("oauth");
  if (typeof provider?.auth?.apiKey?.login === "function") methods.push("api_key");
  const id = String(provider?.id || "").trim();
  return {
    id,
    label: String(provider?.name || id),
    baseUrl: String(provider?.baseUrl || ""),
    methods,
    note: noteFor(methods),
  };
}

export function morePiProviders(catalog, featuredIds) {
  return (catalog || []).filter((p) => p?.id && !featuredIds.has(p.id));
}

export function isEditorRowShown(id, { featured, hidden, extra, installed }) {
  if (hidden.has(id)) return false;
  return featured.has(id) || extra.has(id) || installed.has(id);
}

export function extraOauthProviders(more, extraIds) {
  const shown = new Set(extraIds);
  return (more || []).filter((p) => shown.has(p.id) && p.methods.includes("oauth"));
}

export function extraApiKeyProviders(more, extraIds) {
  const shown = new Set(extraIds);
  return (more || []).filter(
    (p) => shown.has(p.id) && p.methods.includes("api_key") && !p.methods.includes("oauth"),
  );
}

export function loginProviderMeta(id, { featuredOauth = [], catalog = [] } = {}) {
  return featuredOauth.find((p) => p.id === id) || catalog.find((p) => p.id === id) || null;
}

/**
 * Built-in pi providers (id/name/methods only). Offline and cached per
 * payloadRoot: opening the editor must not hit the network.
 */
export async function listPiCatalogProviders({ payloadRoot }) {
  const key = String(payloadRoot || "");
  if (catalogCache.has(key)) return catalogCache.get(key);
  const entry = path.join(keeperNodeModules(payloadRoot), "@earendil-works", "pi-coding-agent", "dist", "index.js");
  const mod = await import(entry);
  const runtime = await mod.ModelRuntime.create({
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const catalog = (runtime.getProviders() || [])
    .map((p) => serializePiProvider(p))
    .filter((p) => p.id);
  catalogCache.set(key, catalog);
  return catalog;
}
