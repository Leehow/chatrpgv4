import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import { authEventBrowserUrl, isHttpsUrl } from "./auth-event-url.mjs";
import { PROVIDER_PRESETS } from "./agentconfig.mjs";
import { keeperNodeModules, listPiCatalogProviders, loginProviderMeta } from "./pi-catalog.mjs";

// pi-style provider login for the desktop shell. Instead of reimplementing
// any OAuth dance, this drives the bundled pi library's own login API
// (ModelRuntime.login) against the app-owned agent dir — the exact flow the
// pi TUI's /login command uses — and only adds two things around it:
//   - an AuthInteraction whose prompts/events travel over IPC to the wizard
//     window (browser opens happen via shell.openExternal), and
//   - materialization of the provider's model list into models.json, because
//     the web bridge's model dropdown (projections.mjs modelsPayload) reads
//     models.json only and cannot see built-in provider catalogs.

// Featured OAuth cards on the settings page. `methods` mirrors what the
// provider actually supports (envApiKeyAuth.login exists for all but
// openai-codex). The rest of pi-ai 0.84.2's catalog is listed behind 更多
// via pi-catalog.mjs. Keys/tokens never appear in these descriptors.
export const OAUTH_PROVIDERS = [
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
];

export function oauthProvider(id) {
  return OAUTH_PROVIDERS.find((p) => p.id === id) || null;
}

const runtimeCache = new Map();

/**
 * ModelRuntime bound to the app agent dir. Catalog refresh over the network
 * is allowed here on purpose: login happens exactly when the user is setting
 * up connectivity, unlike keeper children which always run PI_OFFLINE=1.
 */
export async function loadModelRuntime({ payloadRoot, agentDir }) {
  const key = `${payloadRoot}\0${agentDir}`;
  if (runtimeCache.has(key)) return runtimeCache.get(key);
  const entry = path.join(keeperNodeModules(payloadRoot), "@earendil-works", "pi-coding-agent", "dist", "index.js");
  const mod = await import(entry);
  const runtime = await mod.ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
    allowModelNetwork: true,
  });
  runtimeCache.set(key, runtime);
  return runtime;
}

/**
 * Write the provider's live model list (from pi's composed catalog) into
 * models.json so the web model dropdown can see it. Pure additive merge:
 * existing user-written model entries are preserved, never replaced.
 */
export function materializeProviderModels(agentDir, providerId, models, { name }) {
  fs.mkdirSync(agentDir, { recursive: true });
  const modelsPath = path.join(agentDir, "models.json");
  let doc = null;
  try {
    doc = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
  } catch {
    doc = {};
  }
  if (!doc.providers || typeof doc.providers !== "object") doc.providers = {};
  const previous = doc.providers[providerId];
  const entries = models.map((m) => {
    const out = { id: m.id, name: String(m.name || m.id) };
    // Carry the composed catalog fields through: pi's modelFromJson rebuilds
    // models.json entries wholesale (only api/baseUrl fall back to catalog
    // defaults), so a bare {id,name} entry would silently strip reasoning,
    // thinkingLevelMap, compat, and the real context window — e.g. grok-4.5's
    // openai-responses channel and its adjustable thinking levels.
    if (typeof m.api === "string" && m.api.trim()) out.api = m.api.trim();
    if (Array.isArray(m.input) && m.input.length) out.input = [...m.input];
    if (m.reasoning === true) out.reasoning = true;
    if (m.compat && typeof m.compat === "object") out.compat = m.compat;
    if (m.thinkingLevelMap && typeof m.thinkingLevelMap === "object") {
      out.thinkingLevelMap = m.thinkingLevelMap;
    }
    if (Number.isFinite(m.contextWindow) && m.contextWindow > 0) {
      out.contextWindow = m.contextWindow;
    }
    if (Number.isFinite(m.maxTokens) && m.maxTokens > 0) {
      out.maxTokens = m.maxTokens;
    }
    return out;
  });
  if (previous && Array.isArray(previous.models)) {
    const seen = new Set(entries.map((m) => m.id));
    for (const old of previous.models) {
      if (old && old.id && !seen.has(old.id)) entries.push(old);
    }
  }
  doc.providers[providerId] = { name, models: entries };
  fs.writeFileSync(modelsPath, JSON.stringify(doc, null, 2) + "\n");
  return entries.map((m) => m.id);
}

async function materializeFromRuntime(agentDir, runtime, providerId, label) {
  try {
    if (typeof runtime.refresh === "function") {
      await runtime.refresh({ providers: [providerId], allowNetwork: true });
    } else if (typeof runtime.getAvailable === "function") {
      await runtime.getAvailable(providerId);
    }
  } catch {
    // Catalog refresh is best-effort; fall through to getModels / presets.
  }
  let models = [];
  try {
    models = (runtime.getModels(providerId) || []).map((m) => ({
      id: m.id,
      name: m.name,
      api: m.api,
      input: m.input,
      reasoning: m.reasoning,
      compat: m.compat,
      thinkingLevelMap: m.thinkingLevelMap,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    }));
  } catch {
    models = [];
  }
  if (!models.length) {
    const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
    if (preset?.models?.length) {
      models = preset.models.map((m) => ({ ...m, name: m.name || m.id }));
    }
  }
  return models.length
    ? materializeProviderModels(agentDir, providerId, models, { name: label })
    : [];
}

/**
 * Run one provider login. `emit` receives every AuthEvent (also delivered
 * before any browser open: auth_url events open the default browser here).
 * `onPrompt` must resolve with the user's answer to a prompt. Mirrors the
 * pi TUI: one credential per provider, written by the library itself.
 *
 * pi-ai's OAuth flows ignore the interaction's abort signal (the anthropic
 * browser flow only races its localhost callback against a manual paste), so
 * cancel is enforced here by racing the signal. The abandoned login keeps
 * running detached: if the user still completes the browser auth, the
 * credential lands in auth.json and the model list still gets materialized.
 */
function abortError() {
  return new Error("已取消登录");
}

function raceAbort(promise, signal) {
  if (!signal) return promise;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError());
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() => {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
}

const FIRST_AUTH_EVENT_TIMEOUT_MS = 20_000;

export async function loginProvider({ payloadRoot, agentDir, providerId, method, emit, onPrompt, signal }) {
  let catalog = [];
  try {
    catalog = await listPiCatalogProviders({ payloadRoot });
  } catch {
    catalog = [];
  }
  const meta = loginProviderMeta(providerId, { featuredOauth: OAUTH_PROVIDERS, catalog });
  if (!meta) throw new Error(`未知供应商：${providerId}`);
  if (!meta.methods.includes(method)) throw new Error(`${meta.label} 不支持该登录方式`);
  const runtime = await raceAbort(loadModelRuntime({ payloadRoot, agentDir }), signal);
  if (signal?.aborted) throw abortError();
  let sawAuthEvent = false;
  let firstEventTimer;
  const doLogin = runtime.login(providerId, method, {
    signal,
    prompt: (p) => onPrompt(p),
    notify: (event) => {
      const url = authEventBrowserUrl(event);
      if (url && isHttpsUrl(url)) {
        shell.openExternal(url).catch(() => {});
      }
      if (event.type === "auth_url" || event.type === "device_code") {
        sawAuthEvent = true;
        if (firstEventTimer) clearTimeout(firstEventTimer);
      }
      emit(event);
    },
  });
  let credential;
  const firstEventWatch =
    method === "oauth"
      ? new Promise((_, reject) => {
          firstEventTimer = setTimeout(() => {
            if (!sawAuthEvent) reject(new Error("连接登录服务超时"));
          }, FIRST_AUTH_EVENT_TIMEOUT_MS);
        })
      : null;
  try {
    const raced = firstEventWatch ? Promise.race([doLogin, firstEventWatch]) : doLogin;
    credential = await raceAbort(raced, signal);
  } catch (err) {
    if (firstEventTimer) clearTimeout(firstEventTimer);
    doLogin
      .then((late) => {
        if (late?.type) return materializeFromRuntime(agentDir, runtime, providerId, meta.label);
        return [];
      })
      .catch(() => {});
    throw err;
  }
  if (firstEventTimer) clearTimeout(firstEventTimer);
  const modelIds = await materializeFromRuntime(agentDir, runtime, providerId, meta.label);
  return { ok: true, provider: providerId, credentialType: credential.type, models: modelIds };
}
