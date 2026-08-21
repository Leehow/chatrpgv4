import fs from "node:fs";
import path from "node:path";

import { FEATURED_OAUTH, FEATURED_PRESETS } from "./model-editor.mjs";
import { keeperNodeModules, listPiCatalogProviders, loginProviderMeta } from "./pi-catalog.mjs";
import { loadGrokBuildProviderFactory } from "./grok-build-extension.mjs";

// Browser-reachable login for the in-app 编辑模型 dialog. Same ModelRuntime
// path the settings window uses; the client opens auth URLs itself.

const runtimeCache = new Map();
let session = null;

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

/**
 * Register the canonical `grok-build` provider (from the repo-local installed
 * grok-build-oauth artifact) on a host ModelRuntime so the 编辑模型 dialog can
 * run `/login grok-build`-equivalent device-code login and the settings
 * projection can show its login state from Pi auth — without a live session
 * and without a second OAuth UI. No-op when the artifact is not installed or
 * the runtime already knows the provider.
 */
export async function registerGrokBuildProviderOnRuntime(
  runtime,
  { agentDir, repoRoot, env = process.env } = {},
) {
  try {
    if (!runtime || typeof runtime.registerProvider !== "function") return false;
    const factory = await loadGrokBuildProviderFactory({ repoRoot, env });
    if (!factory) return false;
    const known = typeof runtime.getProviders === "function" ? runtime.getProviders() : [];
    if (Array.isArray(known) && known.some((p) => p?.id === factory.providerId)) return false;
    runtime.registerProvider(
      factory.providerId,
      factory.createGrokBuildProvider({ authPath: path.join(agentDir, "auth.json") }),
    );
    return true;
  } catch {
    return false;
  }
}

async function loadModelRuntime({ payloadRoot, agentDir }) {
  const key = `${payloadRoot}\0${agentDir}`;
  if (runtimeCache.has(key)) return runtimeCache.get(key);
  const entry = path.join(keeperNodeModules(payloadRoot), "@earendil-works", "pi-coding-agent", "dist", "index.js");
  const mod = await import(entry);
  const runtime = await mod.ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
    allowModelNetwork: true,
  });
  await registerGrokBuildProviderOnRuntime(runtime, { agentDir, repoRoot: payloadRoot });
  runtimeCache.set(key, runtime);
  return runtime;
}

function materializeProviderModels(agentDir, providerId, models, { name }) {
  fs.mkdirSync(agentDir, { recursive: true });
  const modelsPath = path.join(agentDir, "models.json");
  let doc = {};
  try {
    doc = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
  } catch {
    doc = {};
  }
  if (!doc.providers || typeof doc.providers !== "object") doc.providers = {};
  const previous = doc.providers[providerId];
  const entries = models.map((m) => {
    const out = { id: m.id, name: String(m.name || m.id) };
    if (Array.isArray(m.input) && m.input.length) out.input = [...m.input];
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
    }
  } catch {
    /* best-effort */
  }
  let models = [];
  try {
    models = (runtime.getModels(providerId) || []).map((m) => ({
      id: m.id,
      name: m.name,
      input: m.input,
    }));
  } catch {
    models = [];
  }
  if (!models.length) {
    const preset = FEATURED_PRESETS.find((p) => p.id === providerId);
    if (preset?.models?.length) {
      models = preset.models.map((m) => ({ id: m.id, name: m.name || m.id, input: m.input }));
    }
  }
  return models.length ? materializeProviderModels(agentDir, providerId, models, { name: label }) : [];
}

function authEventUrl(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "auth_url") return String(event.url || "");
  if (event.type === "device_code") return String(event.verificationUri || "");
  return "";
}

export function loginSnapshot() {
  if (!session) return { active: false, events: [], prompt: null, done: false, result: null };
  return {
    active: true,
    events: session.events,
    prompt: session.prompt,
    done: session.done,
    result: session.result,
  };
}

export function respondLoginPrompt({ promptId, value, cancel }) {
  if (!session) return { ok: false, error: "没有进行中的登录" };
  const pending = session.prompts.get(Number(promptId));
  if (!pending) return { ok: false, error: "提示已失效" };
  session.prompts.delete(Number(promptId));
  session.prompt = null;
  if (cancel) pending.reject(new Error("用户取消了输入"));
  else pending.resolve(String(value ?? ""));
  return { ok: true };
}

export function cancelLogin() {
  if (!session) return { ok: false, error: "没有进行中的登录" };
  session.controller.abort();
  return { ok: true };
}

export async function startProviderLogin({ payloadRoot, agentDir, providerId, method }) {
  if (!agentDir) return { ok: false, error: "未找到本机模型目录" };
  if (session && !session.done) return { ok: false, error: "已有一次登录正在进行" };
  const id = String(providerId || "").trim();
  const chosen = String(method || "").trim();
  if (!["oauth", "api_key"].includes(chosen)) return { ok: false, error: `未知登录方式：${chosen}` };

  let catalog = [];
  try {
    catalog = await listPiCatalogProviders({ payloadRoot });
  } catch {
    catalog = [];
  }
  const meta = loginProviderMeta(id, { featuredOauth: FEATURED_OAUTH, catalog });
  if (!meta) return { ok: false, error: `未知供应商：${id}` };
  if (!meta.methods.includes(chosen)) return { ok: false, error: `${meta.label} 不支持该登录方式` };

  const current = {
    controller: new AbortController(),
    events: [],
    prompts: new Map(),
    nextPromptId: 1,
    prompt: null,
    done: false,
    result: null,
  };
  session = current;

  const run = async () => {
    try {
      const runtime = await raceAbort(loadModelRuntime({ payloadRoot, agentDir }), current.controller.signal);
      const credential = await raceAbort(
        runtime.login(id, chosen, {
          signal: current.controller.signal,
          prompt: (p) =>
            new Promise((resolve, reject) => {
              const promptId = current.nextPromptId++;
              current.prompts.set(promptId, { resolve, reject });
              const { signal: _signal, ...rest } = p;
              current.prompt = { promptId, prompt: rest };
              p.signal?.addEventListener(
                "abort",
                () => {
                  if (current.prompts.delete(promptId)) {
                    current.prompt = current.prompt?.promptId === promptId ? null : current.prompt;
                    reject(new Error("prompt superseded"));
                  }
                },
                { once: true },
              );
            }),
          notify: (event) => {
            const url = authEventUrl(event);
            current.events.push({ ...event, url: url || undefined });
          },
        }),
        current.controller.signal,
      );
      const models = await materializeFromRuntime(agentDir, runtime, id, meta.label);
      current.result = { ok: true, provider: id, credentialType: credential?.type, models };
    } catch (err) {
      current.result = { ok: false, error: String(err?.message || err) };
    } finally {
      current.done = true;
      current.prompt = null;
      if (session === current) {
        /* keep snapshot until the next start */
      }
    }
  };
  void run();
  return { ok: true, started: true, label: meta.label };
}
