import fs from "node:fs";
import path from "node:path";

import { listPiCatalogProviders, morePiProviders } from "./pi-catalog.mjs";
import { resolveProductAgentDir, resolveProductSettingsPath } from "./agent-dir.mjs";
import { applyKnownThinking } from "./known-thinking.mjs";
import { normalizeHiddenProviderIds } from "./provider-visibility.mjs";

// Main-window 编辑模型 editor. Reads the same featured cards and
// coc-desktop-settings.json the settings window uses, but over HTTP so the
// overlay does not depend on a second BrowserWindow or a new preload.

export const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const FEATURED_OAUTH = [
  {
    id: "anthropic",
    label: "Anthropic Claude",
    note: "Claude Pro/Max 订阅账户，浏览器授权登录；也可用 API Key。",
    methods: ["oauth", "api_key"],
  },
  {
    id: "openai-codex",
    label: "OpenAI ChatGPT",
    note: "ChatGPT Plus/Pro 订阅账户，浏览器或设备码登录。",
    methods: ["oauth"],
  },
  {
    id: "xai",
    label: "xAI Grok",
    note: "SuperGrok / X Premium 订阅设备码登录；也可用 API Key。",
    methods: ["oauth", "api_key"],
  },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    note: "GitHub Copilot 订阅账户，设备码登录。",
    methods: ["oauth"],
  },
  {
    id: "grok-build",
    label: "Grok Build（Grok 订阅出图）",
    note: "Grok Build 订阅 OAuth 设备码登录；需先安装 grok-build-oauth 扩展（同一构建产物，见 docs/specs/grok-build-oauth-image-extension.md）。仅用于 image_gen/image_edit 出图，不含聊天模型。",
    methods: ["oauth"],
  },
];

export const FEATURED_PRESETS = [
  {
    id: "deepseek",
    label: "DeepSeek",
    note: "需要 DeepSeek API Key（platform.deepseek.com）。填入 Key 后自动拉取模型列表；思考已默认关闭。",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com",
    models: [
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        reasoning: true,
        compat: { thinkingFormat: "deepseek" },
        thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" },
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        reasoning: true,
        compat: { thinkingFormat: "deepseek" },
        thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" },
      },
    ],
  },
  {
    id: "xai",
    label: "xAI Grok",
    note: "需要 xAI API Key（console.x.ai）。Grok 4.6 支持图像输入。",
    api: "openai-completions",
    baseUrl: "https://api.x.ai/v1",
    models: [
      { id: "grok-4.6", name: "Grok 4.6", input: ["text", "image"], reasoning: true },
      { id: "grok-4.3", name: "Grok 4.3", input: ["text", "image"], reasoning: true },
    ],
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    note: "需要智谱 API Key（bigmodel.cn）；填入 Key 后自动拉取模型列表，模型 ID 以控制台为准。思考已默认关闭。",
    api: "openai-completions",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      { id: "glm-5.3", name: "GLM-5.3", reasoning: true, compat: { thinkingFormat: "zai" } },
      {
        id: "glm-5.2",
        name: "GLM-5.2",
        reasoning: true,
        compat: { thinkingFormat: "zai", supportsReasoningEffort: true },
        thinkingLevelMap: { minimal: null, low: "high", medium: "high", high: "high", max: "max" },
      },
      { id: "glm-5-turbo", name: "GLM-5 Turbo", reasoning: true, compat: { thinkingFormat: "zai" } },
    ],
  },
];

const SETTINGS_DEFAULTS = {
  hiddenProviderIds: [],
  extraProviderIds: [],
  customProviders: [],
};

function oauthLabel(id) {
  return FEATURED_OAUTH.find((p) => p.id === id)?.label || id;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function sanitizeIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen.has(id) || !PROVIDER_ID_RE.test(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function sanitizeCustom(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const id = String(raw.id || "").trim();
    const label = String(raw.label || id).trim();
    const baseUrl = String(raw.baseUrl || "").trim().replace(/\/+$/, "");
    const note = String(raw.note || "").trim();
    if (!id || seen.has(id) || !PROVIDER_ID_RE.test(id)) continue;
    seen.add(id);
    const entry = { id, label: label || id, baseUrl };
    if (note) entry.note = note;
    out.push(entry);
  }
  return out;
}

export function resolveSettingsPath(opts) {
  return resolveProductSettingsPath(opts);
}

export function resolveAgentDir(opts) {
  return resolveProductAgentDir(opts);
}

export function loadEditorSettings(settingsPath) {
  if (!settingsPath) {
    return { ...SETTINGS_DEFAULTS, hiddenProviderIds: [], extraProviderIds: [], customProviders: [] };
  }
  const raw = readJson(settingsPath);
  if (!raw || typeof raw !== "object") {
    return { ...SETTINGS_DEFAULTS, hiddenProviderIds: [], extraProviderIds: [], customProviders: [] };
  }
  return {
    hiddenProviderIds: sanitizeIds(raw.hiddenProviderIds),
    extraProviderIds: sanitizeIds(raw.extraProviderIds),
    customProviders: sanitizeCustom(raw.customProviders),
  };
}

export function saveEditorSettings(settingsPath, patch) {
  const current = loadEditorSettings(settingsPath);
  const next = {
    ...current,
    hiddenProviderIds: Object.prototype.hasOwnProperty.call(patch, "hiddenProviderIds")
      ? sanitizeIds(patch.hiddenProviderIds)
      : current.hiddenProviderIds,
    extraProviderIds: Object.prototype.hasOwnProperty.call(patch, "extraProviderIds")
      ? sanitizeIds(patch.extraProviderIds)
      : current.extraProviderIds,
    customProviders: Object.prototype.hasOwnProperty.call(patch, "customProviders")
      ? sanitizeCustom(patch.customProviders)
      : current.customProviders,
  };
  const existing = readJson(settingsPath);
  const merged = existing && typeof existing === "object" ? { ...existing, ...next } : next;
  delete merged.pdfOpeningModel;
  delete merged.pdfVisionModel;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  return next;
}

export function providerSummary(agentDir) {
  if (!agentDir) return [];
  const doc = readJson(path.join(agentDir, "models.json"));
  const auth = readJson(path.join(agentDir, "auth.json")) || {};
  const inner = auth.providers;
  const source = inner && typeof inner === "object" ? inner : auth;
  const authed = new Set(
    Object.keys(source).filter((k) => k && typeof source[k] === "object" && source[k] !== null),
  );
  const providers = [];
  const seen = new Set();
  for (const [id, cfg] of Object.entries(doc?.providers || {})) {
    if (!cfg || typeof cfg !== "object") continue;
    const models = (Array.isArray(cfg.models) ? cfg.models : [])
      .filter((m) => m && m.id)
      .map((m) => ({ id: m.id, name: String(m.name || m.id) }));
    seen.add(id);
    providers.push({
      id,
      name: String(cfg.name || id),
      baseUrl: String(cfg.baseUrl || ""),
      hasAuth: authed.has(id) || Boolean(cfg.apiKey),
      models,
    });
  }
  for (const id of authed) {
    if (seen.has(id)) continue;
    providers.push({
      id,
      name: oauthLabel(id),
      baseUrl: "",
      hasAuth: true,
      models: [],
    });
  }
  return providers;
}

function writeJson(file, data, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode });
}

const REMOTE_MODELS_LIMIT = 200;
const NON_CHAT_MODEL_RE = /embedding|image|audio|video|translation|moderation/i;

function isChatModelId(id) {
  return Boolean(id) && !NON_CHAT_MODEL_RE.test(id);
}

function modelListUrls(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  const urls = [`${base}/models`];
  if (!/\/v1$/i.test(base)) urls.push(`${base}/v1/models`);
  return urls;
}

/**
 * GET OpenAI-style {base}/models (Bearer key). Never echoes the key.
 * If baseUrl does not already end with /v1, retry once at {base}/v1/models
 * on 404 or a non-JSON / empty list shape.
 */
export async function fetchRemoteModels({
  baseUrl,
  apiKey,
  timeoutMs = 10000,
  fetchImpl,
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch?.bind(globalThis);
  const key = String(apiKey || "").trim();
  const urls = modelListUrls(baseUrl);
  if (!urls.length || !/^https?:\/\//.test(String(baseUrl || "").trim())) {
    return { ok: false, error: "Base URL 必须以 http(s):// 开头" };
  }
  if (!key) return { ok: false, error: "API Key 不能为空" };
  if (typeof doFetch !== "function") return { ok: false, error: "当前环境不支持网络请求" };

  let lastError = "获取模型列表失败";
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    let res;
    try {
      res = await doFetch(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err?.name === "TimeoutError" ? "请求超时" : "无法连接到服务";
      lastError = `${reason}：${url}`;
      if (i + 1 < urls.length) continue;
      return { ok: false, error: lastError };
    }
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? "，请检查 API Key 是否正确"
          : res.status === 404
            ? "，该端点可能不提供模型列表"
            : "";
      lastError = `获取模型列表失败：HTTP ${res.status}${hint}`;
      if (res.status === 404 && i + 1 < urls.length) continue;
      return { ok: false, error: lastError };
    }
    let body;
    try {
      body = await res.json();
    } catch {
      lastError = "服务返回了无法解析的响应（非 JSON）";
      if (i + 1 < urls.length) continue;
      return { ok: false, error: lastError };
    }
    const raw = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
    const seen = new Set();
    const models = [];
    for (const entry of raw) {
      const id = (typeof entry === "string" ? entry : String(entry?.id || "")).trim();
      if (!id || seen.has(id) || !isChatModelId(id)) continue;
      seen.add(id);
      models.push(id);
      if (models.length >= REMOTE_MODELS_LIMIT) break;
    }
    if (!models.length) {
      lastError = "服务未返回任何模型";
      if (i + 1 < urls.length) continue;
      return { ok: false, error: lastError };
    }
    return { ok: true, models };
  }
  return { ok: false, error: lastError };
}

export async function saveApiKeyProvider(agentDir, input, { fetchImpl } = {}) {
  if (!agentDir) return { ok: false, errors: ["未找到本机模型目录"] };
  const errors = [];
  const id = String(input?.id || "").trim();
  const apiKey = String(input?.apiKey || "");
  const preset = FEATURED_PRESETS.find((p) => p.id === id);
  const label = String(input?.label || preset?.label || id).trim();
  const api = String(input?.api || preset?.api || "openai-completions").trim();
  const baseUrl = String(input?.baseUrl || preset?.baseUrl || "").trim().replace(/\/+$/, "");
  const rawModels = Array.isArray(input?.models) && input.models.length ? input.models : preset?.models || [];
  let models = rawModels
    .filter((m) => m && m.id)
    .map((m) => {
      const out = { id: String(m.id), name: String(m.name || m.id) };
      if (Array.isArray(m.input) && m.input.length) out.input = m.input;
      if (m.reasoning === true) out.reasoning = true;
      if (m.compat && typeof m.compat === "object") out.compat = m.compat;
      if (m.thinkingLevelMap && typeof m.thinkingLevelMap === "object") out.thinkingLevelMap = m.thinkingLevelMap;
      return applyKnownThinking({ providerId: id, baseUrl }, out);
    });
  if (!PROVIDER_ID_RE.test(id)) errors.push("提供方 ID 只能是小写字母、数字与连字符");
  if (!apiKey.trim()) errors.push("API Key 不能为空");
  if (!/^https?:\/\//.test(baseUrl)) errors.push("Base URL 必须以 http(s):// 开头");
  if (!models.length) {
    const fetched = await fetchRemoteModels({
      baseUrl,
      apiKey,
      timeoutMs: 10000,
      fetchImpl,
    });
    if (fetched.ok && fetched.models?.length) {
      models = fetched.models.map((mid) =>
        applyKnownThinking({ providerId: id, baseUrl }, { id: mid, name: mid }),
      );
    } else {
      errors.push("至少需要一个模型 ID");
    }
  }
  if (errors.length) return { ok: false, errors };

  fs.mkdirSync(agentDir, { recursive: true });
  try {
    fs.chmodSync(agentDir, 0o700);
  } catch {
    /* ignore on filesystems that reject chmod */
  }
  const modelsPath = path.join(agentDir, "models.json");
  const doc = readJson(modelsPath) || {};
  if (!doc.providers || typeof doc.providers !== "object") doc.providers = {};
  const previous = doc.providers[id];
  const entry = { name: label, api, baseUrl, models };
  if (previous && typeof previous === "object" && Array.isArray(previous.models)) {
    const keep = new Set(entry.models.map((m) => m.id));
    for (const old of previous.models) {
      if (old && old.id && !keep.has(old.id)) entry.models.push(old);
    }
  }
  doc.providers[id] = entry;
  writeJson(modelsPath, doc, 0o644);

  const authPath = path.join(agentDir, "auth.json");
  const auth = readJson(authPath) || {};
  const inner = auth.providers && typeof auth.providers === "object" ? auth.providers : auth;
  inner[id] = { type: "api_key", key: apiKey };
  if (auth.providers && typeof auth.providers === "object") auth.providers = inner;
  writeJson(authPath, auth, 0o600);
  return { ok: true, provider: id, models: entry.models.map((m) => m.id) };
}

function featuredIds() {
  return new Set([
    ...FEATURED_OAUTH.map((p) => p.id),
    ...FEATURED_PRESETS.map((p) => p.id).filter(Boolean),
  ]);
}

export async function getModelEditorState({
  payloadRoot,
  settingsPath = resolveSettingsPath(),
  agentDir = resolveAgentDir(),
  listCatalog = listPiCatalogProviders,
} = {}) {
  let catalogProviders = [];
  try {
    catalogProviders = morePiProviders(await listCatalog({ payloadRoot }), featuredIds());
  } catch {
    catalogProviders = [];
  }
  const settings = loadEditorSettings(settingsPath);
  return {
    oauthProviders: FEATURED_OAUTH,
    presets: FEATURED_PRESETS,
    catalogProviders,
    providers: providerSummary(agentDir),
    hiddenProviderIds: settings.hiddenProviderIds,
    extraProviderIds: settings.extraProviderIds,
    customProviders: settings.customProviders,
    writable: Boolean(settingsPath),
  };
}

export async function saveModelEditorList(
  payload,
  {
    payloadRoot,
    settingsPath = resolveSettingsPath(),
    listCatalog = listPiCatalogProviders,
  } = {},
) {
  if (!settingsPath) {
    return { ok: false, errors: ["仅桌面应用可保存提供方显示列表"] };
  }
  let catalogIds = [];
  try {
    catalogIds = (await listCatalog({ payloadRoot })).map((p) => p.id);
  } catch {
    catalogIds = [];
  }
  const builtinIds = new Set([...featuredIds(), ...catalogIds]);
  const hidden = normalizeHiddenProviderIds(
    sanitizeIds(payload?.hidden),
    FEATURED_OAUTH.map((p) => p.id),
    FEATURED_PRESETS.map((p) => p.id).filter(Boolean),
  );
  const extra = sanitizeIds(payload?.extra);
  const rawCustom = Array.isArray(payload?.custom) ? payload.custom : [];
  const custom = [];
  const errors = [];
  const seenCustom = new Set();
  for (const raw of rawCustom) {
    if (!raw || typeof raw !== "object") continue;
    const id = String(raw.id || "").trim();
    const label = String(raw.label || id).trim();
    const baseUrl = String(raw.baseUrl || "").trim().replace(/\/+$/, "");
    const note = String(raw.note || "").trim();
    if (!PROVIDER_ID_RE.test(id)) {
      errors.push(`自定义提供方 ID 无效：${id || "（空）"}`);
      continue;
    }
    if (builtinIds.has(id) || seenCustom.has(id)) {
      errors.push(`自定义提供方 ID 重复：${id}`);
      continue;
    }
    if (!/^https?:\/\//.test(baseUrl)) {
      errors.push(`自定义提供方「${label || id}」的 Base URL 必须以 http(s):// 开头`);
      continue;
    }
    seenCustom.add(id);
    const entry = { id, label: label || id, baseUrl };
    if (note) entry.note = note;
    custom.push(entry);
  }
  if (errors.length) return { ok: false, errors };
  saveEditorSettings(settingsPath, {
    hiddenProviderIds: hidden,
    extraProviderIds: extra,
    customProviders: custom,
  });
  return { ok: true, hidden, extra, custom };
}
