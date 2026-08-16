import fs from "node:fs";
import path from "node:path";

// Provider configuration writer for the desktop app's own pi agent dir.
// Writes the same artifacts pi itself uses (models.json providers entry +
// auth.json api_key entry, file 0600 / dir 0700), so the model dropdown
// (projections.mjs) and the keeper runner (ModelRuntime) both read them
// unchanged. Pure Node — no Electron imports — so it is directly testable.

export const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const PROVIDER_PRESETS = [
  {
    id: "deepseek",
    label: "DeepSeek",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com",
    models: [
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        input: ["text"],
        // Mirror pi's built-in catalog metadata: without reasoning +
        // thinkingFormat pi sends no thinking parameter and DeepSeek's
        // server-side default (thinking on) makes every model call slow and
        // verbose. With it, the keeper's thinkingLevel "off" becomes a real
        // `thinking: {type: "disabled"}` request.
        reasoning: true,
        compat: { thinkingFormat: "deepseek" },
        thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" },
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        input: ["text"],
        reasoning: true,
        compat: { thinkingFormat: "deepseek" },
        thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" },
      },
    ],
    note: "需要 DeepSeek API Key（platform.deepseek.com）。填入 Key 后自动拉取模型列表；思考已默认关闭。",
  },
  {
    id: "xai",
    label: "xAI Grok",
    api: "openai-completions",
    baseUrl: "https://api.x.ai/v1",
    // Grok 4.5 deliberately absent: pi's catalog routes it through
    // openai-responses, and this preset can only bless one api per provider,
    // so blessing it under openai-completions would diverge from pi's tested
    // path. Users can still add it manually.
    models: [
      {
        id: "grok-4.6",
        name: "Grok 4.6",
        input: ["text", "image"],
        reasoning: true,
      },
      {
        id: "grok-4.3",
        name: "Grok 4.3",
        input: ["text", "image"],
        reasoning: true,
      },
    ],
    note: "需要 xAI API Key（console.x.ai）。Grok 4.6 支持图像输入。",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    api: "openai-completions",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      {
        id: "glm-5.3",
        name: "GLM-5.3",
        input: ["text"],
        // Same thinking switch as zai (Zhipu's international API family):
        // thinking {type:"enabled"/"disabled"} on the OpenAI-compatible端点.
        reasoning: true,
        compat: { thinkingFormat: "zai" },
      },
      {
        id: "glm-5.2",
        name: "GLM-5.2",
        input: ["text"],
        reasoning: true,
        // supportsReasoningEffort mirrors pi's zai catalog: without it the
        // bigmodel.cn endpoint is detected as zai and every non-off level
        // collapses to a bare thinking:{type:"enabled"} with no effort value.
        compat: { thinkingFormat: "zai", supportsReasoningEffort: true },
        thinkingLevelMap: { minimal: null, low: "high", medium: "high", high: "high", max: "max" },
      },
      {
        id: "glm-5-turbo",
        name: "GLM-5 Turbo",
        input: ["text"],
        reasoning: true,
        compat: { thinkingFormat: "zai" },
      },
    ],
    note: "需要智谱 API Key（bigmodel.cn）；填入 Key 后自动拉取模型列表，模型 ID 以控制台为准。思考已默认关闭。",
  },
  {
    id: "",
    label: "自定义 OpenAI 兼容",
    api: "openai-completions",
    baseUrl: "",
    models: [{ id: "", name: "" }],
    note: "任何 OpenAI 兼容端点：填名称、Base URL、模型 ID 与密钥。",
  },
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value, mode) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode });
  fs.chmodSync(file, mode);
}

function parseModelList(models) {
  if (!Array.isArray(models)) return [];
  return models
    .map((m) => (typeof m === "string" ? { id: m.trim() } : { ...m, id: String(m.id || "").trim() }))
    .filter((m) => m.id);
}

// Display/fetch cap for remote model lists; saving stays capped at 24 by
// upsertProvider's own validation.
const REMOTE_MODELS_LIMIT = 200;

/**
 * Fetch the model catalog of an OpenAI-compatible endpoint
 * (GET {baseUrl}/models) so the wizard can offer a picker instead of asking
 * the user to hand-type model ids. Pure Node (global fetch), no Electron
 * imports — directly testable via fetchImpl injection. The API key is only
 * used for the request and never echoed back in errors.
 */
export async function fetchRemoteModels({
  baseUrl,
  apiKey,
  timeoutMs = 15000,
  fetchImpl,
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch?.bind(globalThis);
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  const key = String(apiKey || "").trim();
  if (!/^https?:\/\//.test(base)) return { ok: false, error: "Base URL 必须以 http(s):// 开头" };
  if (!key) return { ok: false, error: "API Key 不能为空" };
  if (typeof doFetch !== "function") return { ok: false, error: "当前环境不支持网络请求" };

  let res;
  try {
    res = await doFetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err?.name === "TimeoutError" ? "请求超时" : "无法连接到服务";
    return { ok: false, error: `${reason}：${base}/models` };
  }

  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? "，请检查 API Key 是否正确"
        : res.status === 404
          ? "，该端点可能不提供模型列表"
          : "";
    return { ok: false, error: `获取模型列表失败：HTTP ${res.status}${hint}` };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "服务返回了无法解析的响应（非 JSON）" };
  }
  const raw = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  const seen = new Set();
  const models = [];
  for (const entry of raw) {
    const id = (typeof entry === "string" ? entry : String(entry?.id || "")).trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      models.push(id);
    }
    if (models.length >= REMOTE_MODELS_LIMIT) break;
  }
  if (!models.length) return { ok: false, error: "服务未返回任何模型" };
  return { ok: true, models };
}

/**
 * Merge one provider into <agentDir>/models.json + auth.json.
 * Existing providers and keys are preserved (upsert, not replace).
 */
export function upsertProvider(agentDir, input) {
  const errors = [];
  const id = String(input.id || "").trim();
  const apiKey = String(input.apiKey || "");
  const baseUrl = String(input.baseUrl || "").trim().replace(/\/+$/, "");
  const api = String(input.api || "openai-completions").trim();
  const label = String(input.label || input.name || id).trim();
  const models = parseModelList(input.models);

  if (!PROVIDER_ID_RE.test(id)) errors.push("提供方 ID 只能是小写字母、数字与连字符");
  if (!apiKey) errors.push("API Key 不能为空");
  if (!/^https?:\/\//.test(baseUrl)) errors.push("Base URL 必须以 http(s):// 开头");
  if (!models.length) errors.push("至少需要一个模型 ID");
  if (models.length > 24) errors.push("模型列表过长（最多 24 个）");
  if (errors.length) return { ok: false, errors };

  fs.mkdirSync(agentDir, { recursive: true });
  fs.chmodSync(agentDir, 0o700);

  const modelsPath = path.join(agentDir, "models.json");
  const doc = readJson(modelsPath) || {};
  if (!doc.providers || typeof doc.providers !== "object") doc.providers = {};
  const entry = {
    name: label,
    api,
    baseUrl,
    models: models.map((m) => {
      const out = { id: m.id, name: String(m.name || m.id) };
      if (Array.isArray(m.input) && m.input.length) out.input = m.input;
      // Thinking metadata must survive the write: pi composes models.json
      // entries over its built-in catalog per model id, so dropping these
      // would silently re-enable provider-default thinking.
      if (m.reasoning === true) out.reasoning = true;
      if (m.compat && typeof m.compat === "object") out.compat = m.compat;
      if (m.thinkingLevelMap && typeof m.thinkingLevelMap === "object") {
        out.thinkingLevelMap = m.thinkingLevelMap;
      }
      return out;
    }),
  };
  const previous = doc.providers[id];
  if (previous && typeof previous === "object" && previous.models) {
    // Keep any richer per-model fields (contextWindow etc.) the user or pi
    // itself wrote earlier; new ids are appended.
    const keep = new Map(entry.models.map((m, i) => [m.id, { m, i }]));
    for (const old of previous.models || []) {
      if (old && old.id && !keep.has(old.id)) entry.models.push(old);
    }
  }
  doc.providers[id] = entry;
  writeJson(modelsPath, doc, 0o644);

  const authPath = path.join(agentDir, "auth.json");
  const auth = readJson(authPath) || {};
  auth[id] = { type: "api_key", key: apiKey };
  writeJson(authPath, auth, 0o600);

  return { ok: true, provider: id, models: entry.models.map((m) => m.id) };
}

/** Does the agent dir already carry a playable provider (models + auth)? */
export function agentDirConfigured(agentDir) {
  const doc = readJson(path.join(agentDir, "models.json"));
  const auth = readJson(path.join(agentDir, "auth.json")) || {};
  const authed = new Set(Object.keys(auth));
  for (const [id, cfg] of Object.entries(doc?.providers || {})) {
    if (!cfg || typeof cfg !== "object") continue;
    const hasModels = Array.isArray(cfg.models) && cfg.models.some((m) => m && m.id);
    if (hasModels && (authed.has(id) || cfg.apiKey)) return true;
  }
  return false;
}

function oauthLabel(id) {
  const labels = {
    anthropic: "Anthropic Claude",
    "openai-codex": "OpenAI ChatGPT",
    xai: "xAI Grok",
    "github-copilot": "GitHub Copilot",
  };
  return labels[id] || id;
}

/** Provider summary for the settings view (never returns key material). */
export function providerSummary(agentDir) {
  const doc = readJson(path.join(agentDir, "models.json"));
  const auth = readJson(path.join(agentDir, "auth.json")) || {};
  const authed = new Set(
    Object.keys(auth).filter((k) => k && typeof auth[k] === "object" && auth[k] !== null),
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

/**
 * Capability status for the settings view. PDF text-layer parsing is bundled;
 * OCR needs an external skill + token and stays explicitly gated.
 */
export function capabilityStatus({ pdfInspectorCommand, ocrPython, ocrSkillPath, ocrTokenFile }) {
  const pdf = Boolean(pdfInspectorCommand && fs.existsSync(pdfInspectorCommand));
  let ocr = { enabled: false, reason: "未配置" };
  if (!ocrPython) {
    ocr = { enabled: false, reason: "未找到可用的 Python（requests）" };
  } else if (!fs.existsSync(ocrSkillPath)) {
    ocr = { enabled: false, reason: `缺少外部技能：${ocrSkillPath}` };
  } else if (!fs.existsSync(ocrTokenFile)) {
    ocr = { enabled: false, reason: `缺少令牌文件：${ocrTokenFile}` };
  } else {
    ocr = { enabled: true, reason: "已配置" };
  }
  return { pdf, ocr };
}
