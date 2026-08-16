import fs from "node:fs";
import path from "node:path";
import { app, ipcMain, shell } from "electron";
import { upsertProvider, providerSummary, agentDirConfigured, capabilityStatus, PROVIDER_PRESETS, fetchRemoteModels, PROVIDER_ID_RE } from "./agentconfig.mjs";
import { loadSettings, saveSettings } from "./settings.mjs";
import { OAUTH_PROVIDERS, loginProvider } from "./auth.mjs";

/**
 * Typed IPC surface for the wizard/settings window. getPaths() is called per
 * request: paths are only known once the app has started, after handlers are
 * already registered.
 */

// One provider login at a time; prompts and events are pushed to the window
// that started the session, so a closed window aborts the flow.
let authSession = null;

function authEventNames(session) {
  const safe = (channel, payload) => {
    if (!session.sender.isDestroyed()) session.sender.send(channel, payload);
  };
  return { safe };
}

ipcMain.handle("auth:login", async (event, payload) => {
  const paths = getPathsRef();
  if (!paths) return { ok: false, error: "应用尚未完成启动" };
  if (authSession) return { ok: false, error: "已有一次登录正在进行" };
  const providerId = String(payload?.providerId || "");
  const method = String(payload?.method || "");
  if (!OAUTH_PROVIDERS.some((p) => p.id === providerId)) {
    return { ok: false, error: `未知 OAuth 供应商：${providerId}` };
  }
  if (!["oauth", "api_key"].includes(method)) {
    return { ok: false, error: `未知登录方式：${method}` };
  }

  const session = {
    sender: event.sender,
    controller: new AbortController(),
    prompts: new Map(),
    nextPromptId: 1,
  };
  authSession = session;
  event.sender.once("destroyed", () => session.controller.abort());

  const { safe } = authEventNames(session);
  try {
    const result = await loginProvider({
      payloadRoot: paths.payloadRoot,
      agentDir: paths.agentDir,
      providerId,
      method,
      signal: session.controller.signal,
      emit: (authEvent) => safe("auth:event", authEvent),
      onPrompt: (prompt) =>
        new Promise((resolve, reject) => {
          const promptId = session.nextPromptId++;
          session.prompts.set(promptId, { resolve, reject });
          const onPromptAbort = () => {
            if (session.prompts.delete(promptId)) {
              // The library resolved this step out-of-band (e.g. the OAuth
              // callback won the race); drop the input UI without failing.
              safe("auth:promptDismissed", { promptId });
              reject(new Error("prompt superseded"));
            }
          };
          prompt.signal?.addEventListener("abort", onPromptAbort, { once: true });
          safe("auth:prompt", { promptId, prompt: stripSignal(prompt) });
        }),
    });
    // A successful login materializes models into models.json; the main
    // window's dropdown reads /api/models only once at mount, so push a
    // refresh signal instead of leaving it stale until app restart.
    if (result?.ok) notifyModelsChangedRef?.();
    return result;
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    for (const { reject } of session.prompts.values()) {
      reject(new Error("login finished"));
    }
    session.prompts.clear();
    if (authSession === session) authSession = null;
  }
});

function stripSignal(prompt) {
  const { signal: _signal, ...rest } = prompt;
  return rest;
}

ipcMain.handle("auth:respond", (_event, payload) => {
  const session = authSession;
  if (!session) return { ok: false, error: "没有进行中的登录" };
  const promptId = Number(payload?.promptId);
  const pending = session.prompts.get(promptId);
  if (!pending) return { ok: false, error: "提示已失效" };
  session.prompts.delete(promptId);
  if (payload && typeof payload.cancel === "boolean" && payload.cancel) {
    pending.reject(new Error("用户取消了输入"));
  } else {
    pending.resolve(String(payload?.value ?? ""));
  }
  return { ok: true };
});

ipcMain.handle("auth:cancel", () => {
  const session = authSession;
  if (!session) return { ok: false, error: "没有进行中的登录" };
  session.controller.abort();
  return { ok: true };
});

let getPathsRef = () => null;
let openSettingsRef = () => {};
let restartBridgeRef = null;
let notifyProviderListRef = null;
let notifyModelsChangedRef = null;

ipcMain.handle("app:openSettings", (_event, payload) => {
  openSettingsRef(payload);
  return { ok: true };
});

// Hidden-provider list for the main window's model dropdown curation; pushed
// whenever the 编辑模型 modal saves, so unchecking takes effect immediately.
ipcMain.handle("app:getHiddenProviders", () => {
  return { hidden: loadSettings().hiddenProviderIds || [] };
});

// Fatal-modal actions for the main window.
ipcMain.handle("app:quit", () => {
  app.quit();
  return { ok: true };
});

ipcMain.handle("app:restartBridge", async () => {
  if (!restartBridgeRef) return { ok: false, error: "not started" };
  return restartBridgeRef();
});

export function register({ getPaths, restartBridge, openSettings, notifyProviderList, notifyModelsChanged }) {
  getPathsRef = getPaths;
  openSettingsRef = openSettings || openSettingsRef;
  restartBridgeRef = restartBridge || restartBridgeRef;
  notifyProviderListRef = notifyProviderList || notifyProviderListRef;
  notifyModelsChangedRef = notifyModelsChanged || notifyModelsChangedRef;
  ipcMain.handle("wizard:getState", () => {
    const paths = getPaths();
    if (!paths) return { unavailable: true };
    const settings = loadSettings();
    return {
      mode: settings.onboarded ? "settings" : "onboard",
      agentDir: paths.agentDir,
      providers: providerSummary(paths.agentDir),
      configured: agentDirConfigured(paths.agentDir),
      presets: PROVIDER_PRESETS,
      oauthProviders: OAUTH_PROVIDERS,
      hiddenProviderIds: settings.hiddenProviderIds || [],
      customProviders: settings.customProviders || [],
      capabilities: capabilityStatus({
        pdfInspectorCommand:
          paths.bundledPdfInspector
            ? path.join(paths.bundledPdfInspector, "coc-pi-pdf-inspector-router")
            : process.env.COC_PI_PDF_INSPECTOR_COMMAND || "",
        ocrPython: process.env.COC_PROGRESSIVE_OCR_PYTHON || null,
        ocrSkillPath: path.join(process.env.HOME || "", ".codex", "skills", "baiduocr", "scripts", "baiduocr.py"),
        ocrTokenFile: path.join(process.env.HOME || "", ".config", "coc-keeper", "secrets.env"),
      }),
      logsDir: paths.logsDir,
    };
  });

  ipcMain.handle("wizard:saveProvider", (_event, payload) => {
    const paths = getPaths();
    if (!paths) return { ok: false, errors: ["应用尚未完成启动"] };
    const result = upsertProvider(paths.agentDir, payload || {});
    if (result?.ok) notifyModelsChangedRef?.();
    return result;
  });

  // Live model-list fetch for the provider form (GET {baseUrl}/models); the
  // renderer cannot call providers directly (sandbox + CORS), and the key
  // must not leave the main process in logs or errors.
  ipcMain.handle("wizard:fetchModels", (_event, payload) => {
    return fetchRemoteModels({
      baseUrl: String(payload?.baseUrl || ""),
      apiKey: String(payload?.apiKey || ""),
    });
  });

  ipcMain.handle("wizard:finishOnboarding", () => {
    saveSettings({ onboarded: true });
    return { ok: true };
  });

  // Curated provider list for the settings page, saved atomically by the
  // 编辑模型 modal: which catalog entries appear in the two lists
  // (hiddenProviderIds) plus user-added custom API-key provider cards.
  // Credentials are untouched here — hiding a card never deletes auth.
  ipcMain.handle("wizard:saveProviderList", (_event, payload) => {
    const builtinIds = new Set([
      ...OAUTH_PROVIDERS.map((p) => p.id),
      ...PROVIDER_PRESETS.map((p) => p.id).filter(Boolean),
    ]);
    const rawHidden = Array.isArray(payload?.hidden) ? payload.hidden : [];
    const hidden = [];
    const seenHidden = new Set();
    for (const item of rawHidden) {
      if (typeof item !== "string") continue;
      const id = item.trim();
      if (!id || seenHidden.has(id) || !PROVIDER_ID_RE.test(id)) continue;
      seenHidden.add(id);
      hidden.push(id);
    }
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
    saveSettings({ hiddenProviderIds: hidden, customProviders: custom });
    notifyProviderListRef?.(hidden);
    return { ok: true };
  });

  ipcMain.handle("wizard:openItem", (_event, target) => {
    if (typeof target !== "string" || !fs.existsSync(target)) return { ok: false };
    shell.openPath(target);
    return { ok: true };
  });

  ipcMain.handle("wizard:openUrl", (_event, target) => {
    // Device-code verification pages and similar login helper links only.
    if (typeof target !== "string" || !/^https:\/\//i.test(target)) return { ok: false };
    shell.openExternal(target);
    return { ok: true };
  });
}
