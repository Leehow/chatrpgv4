/**
 * Resolve which image-generation backend to use for investigator portraits.
 *
 * Keeper provider xai → official Grok Imagine (fixed model). Otherwise the
 * settings portraitImageProvider/Model. Client-supplied provider/model is
 * ignored. Never silently falls back to xAI for an unsupported vendor.
 */
import fs from "node:fs";
import path from "node:path";

import { resolveProductAgentDir } from "./agent-dir.mjs";
import { requestDashScopeImageGeneration, isDashScopeImageProvider } from "./portrait-dashscope-image.mjs";
import { requestJellyTokenImageGeneration, isJellyTokenImageProvider } from "./portrait-jellytoken-image.mjs";
import {
  DEFAULT_XAI_IMAGE_MODEL,
  XaiImageError,
  requestXaiImageGeneration,
  resolveXaiImageTransport,
  tokenFromXaiEntry,
} from "./xai-image.mjs";

export const PORTRAIT_FAMILY_XAI = "xai-imagine";
export const PORTRAIT_FAMILY_OPENAI = "openai-images";
export const PORTRAIT_FAMILY_GOOGLE = "google-generate-content";
export const PORTRAIT_FAMILY_JELLYTOKEN = "jellytoken-tasks";
export const PORTRAIT_FAMILY_DASHSCOPE = "dashscope-async";
export const PORTRAIT_FAMILY_UNSUPPORTED = "unsupported";

export const GOOGLE_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const MAX_B64_CHARS = 20 * 1024 * 1024;
const AUTH_NAME = "auth.json";
const MODELS_NAME = "models.json";

function trimStr(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function imageError(status, message, code) {
  return new XaiImageError(message, { status, code });
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function isOfficialXaiKeeper(provider) {
  return trimStr(provider).toLowerCase() === "xai";
}

export function classifyPortraitImageFamily({ providerId, api, baseUrl } = {}) {
  const id = trimStr(providerId).toLowerCase();
  const apiKind = trimStr(api).toLowerCase();
  if (!id) return PORTRAIT_FAMILY_UNSUPPORTED;
  if (id === "xai") return PORTRAIT_FAMILY_XAI;
  if (isJellyTokenImageProvider({ providerId: id, baseUrl })) return PORTRAIT_FAMILY_JELLYTOKEN;
  if (isDashScopeImageProvider({ providerId: id, baseUrl })) return PORTRAIT_FAMILY_DASHSCOPE;
  if (id === "google" || id === "gemini" || id.startsWith("google-") || id.startsWith("gemini-")) {
    return PORTRAIT_FAMILY_GOOGLE;
  }
  if (
    id === "anthropic"
    || id === "github-copilot"
    || id === "openai-codex"
    || apiKind.includes("codex")
  ) {
    return PORTRAIT_FAMILY_UNSUPPORTED;
  }
  if (
    id === "openai"
    || id === "openai-compatible"
    || apiKind === "openai-completions"
    || apiKind === "openai-responses"
    || apiKind === "openai-completions-strict"
  ) {
    return PORTRAIT_FAMILY_OPENAI;
  }
  if (!apiKind && looksOpenAiBase(baseUrl)) return PORTRAIT_FAMILY_OPENAI;
  return PORTRAIT_FAMILY_UNSUPPORTED;
}

function looksOpenAiBase(baseUrl) {
  const url = trimStr(baseUrl).toLowerCase();
  return url.includes("openai.com") || /\/v1\/?$/.test(url);
}

function authEntry(authRaw, providerId) {
  const root = asObject(authRaw);
  if (!root) return undefined;
  const nested = asObject(root.providers);
  return asObject(nested?.[providerId]) || asObject(root[providerId]);
}

function providerConfig(modelsRaw, providerId) {
  const root = asObject(modelsRaw);
  const providers = asObject(root?.providers);
  return asObject(providers?.[providerId]);
}

export function resolveProviderImageCredentials({
  providerId,
  env = process.env,
  agentDir,
  now = Date.now(),
} = {}) {
  const id = trimStr(providerId);
  const dir = trimStr(agentDir)
    || resolveProductAgentDir({
      agentDir: env?.PI_AGENT_DIR,
      userData: env?.COC_DESKTOP_USER_DATA,
    });
  const envKey = id === "openai"
    ? trimStr(env?.OPENAI_API_KEY)
    : id === "google" || id === "gemini"
      ? trimStr(env?.GOOGLE_API_KEY) || trimStr(env?.GEMINI_API_KEY) || trimStr(env?.GOOGLE_GENERATIVE_AI_API_KEY)
      : id === "jellytoken"
        ? trimStr(env?.JELLYTOKEN_API_KEY)
        : id === "bailian" || id === "aliyun" || id === "dashscope"
          ? trimStr(env?.DASHSCOPE_API_KEY) || trimStr(env?.BAILIAN_API_KEY)
          : "";
  const auth = readJsonFile(path.join(dir, AUTH_NAME));
  const models = readJsonFile(path.join(dir, MODELS_NAME));
  const cfg = providerConfig(models, id) || {};
  const token = envKey || tokenFromXaiEntry(authEntry(auth, id), now) || trimStr(cfg.apiKey);
  const baseUrl = trimStr(cfg.baseUrl);
  const api = trimStr(cfg.api);
  return { token, baseUrl, api, hasAuth: Boolean(token), modelsDoc: models, cfg };
}

export function openaiImagesGenerationsUrl(baseUrl) {
  const base = trimStr(baseUrl).replace(/\/+$/, "") || OPENAI_DEFAULT_BASE_URL;
  if (/\/images\/generations$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/images/generations`;
  return `${base}/v1/images/generations`;
}

export function googleGenerateContentUrl(baseUrl, model) {
  const base = (trimStr(baseUrl) || GOOGLE_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const root = base.replace(/\/v1beta$/i, "");
  return `${root}/v1beta/models/${encodeURIComponent(trimStr(model))}:generateContent`;
}

function unsupportedMessage(providerId) {
  const id = trimStr(providerId) || "该供应商";
  return `${id} 暂不支持图像生成，请改选支持出图的供应商或模型。`;
}

/**
 * Authoritative route. `clientBody` provider/model is ignored.
 */
export function resolvePortraitImageRoute({
  prefs = {},
  clientBody = {},
  env = process.env,
  agentDir,
  now,
} = {}) {
  void clientBody;
  const keeperProvider = trimStr(prefs.provider);
  if (isOfficialXaiKeeper(keeperProvider)) {
    return {
      family: PORTRAIT_FAMILY_XAI,
      provider: "xai",
      model: DEFAULT_XAI_IMAGE_MODEL,
      bypass: true,
    };
  }
  const imageProvider = trimStr(prefs.portraitImageProvider);
  const imageModel = trimStr(prefs.portraitImageModel);
  if (!imageProvider || !imageModel) {
    throw imageError(400, "请在设置中选择图像生成模型");
  }
  const creds = resolveProviderImageCredentials({
    providerId: imageProvider,
    env,
    agentDir,
    now,
  });
  const family = classifyPortraitImageFamily({
    providerId: imageProvider,
    api: creds.api,
    baseUrl: creds.baseUrl,
  });
  if (family === PORTRAIT_FAMILY_XAI) {
    return {
      family,
      provider: "xai",
      model: DEFAULT_XAI_IMAGE_MODEL,
      bypass: false,
    };
  }
  if (family === PORTRAIT_FAMILY_OPENAI) {
    if (!creds.token) {
      throw imageError(401, `${imageProvider} 图像生成密钥未配置`);
    }
    return {
      family,
      provider: imageProvider,
      model: imageModel,
      token: creds.token,
      baseUrl: creds.baseUrl || OPENAI_DEFAULT_BASE_URL,
    };
  }
  if (family === PORTRAIT_FAMILY_GOOGLE) {
    const baseUrl = creds.baseUrl || GOOGLE_DEFAULT_BASE_URL;
    if (!creds.token || !/^https:\/\/generativelanguage\.googleapis\.com/i.test(baseUrl)) {
      throw imageError(
        400,
        "当前 Google 配置无法安全取得官方图像生成密钥或地址，未启用 Gemini 出图。",
      );
    }
    return {
      family,
      provider: imageProvider,
      model: imageModel,
      token: creds.token,
      baseUrl,
    };
  }
  if (family === PORTRAIT_FAMILY_JELLYTOKEN) {
    if (!creds.token) throw imageError(401, `${imageProvider} 图像生成密钥未配置`);
    return {
      family,
      provider: imageProvider,
      model: imageModel,
      token: creds.token,
      baseUrl: creds.baseUrl || "https://aiservice.jellytoken.com",
    };
  }
  if (family === PORTRAIT_FAMILY_DASHSCOPE) {
    if (!creds.token) throw imageError(401, `${imageProvider} 图像生成密钥未配置`);
    return {
      family,
      provider: imageProvider,
      model: imageModel,
      token: creds.token,
      baseUrl: creds.baseUrl || "https://dashscope.aliyuncs.com",
    };
  }
  throw imageError(400, unsupportedMessage(imageProvider));
}

function decodeB64(b64, label) {
  const raw = trimStr(b64);
  if (!raw) throw imageError(502, `${label} returned no b64 image`);
  if (raw.length > MAX_B64_CHARS) throw imageError(502, `${label} payload is too large`);
  let bytes;
  try {
    bytes = Buffer.from(raw, "base64");
  } catch {
    throw imageError(502, `${label} returned invalid b64`);
  }
  if (!bytes.length) throw imageError(502, `${label} returned empty image`);
  return bytes;
}

export async function requestOpenAIImageGeneration({
  prompt,
  token,
  model,
  baseUrl,
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const secret = trimStr(token);
  if (!secret) throw imageError(401, "OpenAI-compatible image key is not configured");
  const url = openaiImagesGenerationsUrl(baseUrl);
  const payload = {
    model: trimStr(model),
    prompt: String(prompt ?? ""),
    n: 1,
    size: "1024x1536",
    response_format: "b64_json",
  };
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") {
      throw imageError(499, "图像生成已取消", "ABORTED");
    }
    throw imageError(502, "OpenAI-compatible image generation network error");
  }
  const rawText = await response.text();
  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 || response.status === 429
      ? response.status
      : response.status >= 500
        ? response.status
        : 502;
    throw imageError(status, `图像生成失败（OpenAI 兼容接口 HTTP ${response.status}）`);
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw imageError(502, "OpenAI-compatible image generation returned invalid JSON");
  }
  const row = asObject(parsed)?.data?.[0] || asObject(parsed)?.data;
  const b64 = trimStr(row?.b64_json) || trimStr(row?.b64);
  const bytes = decodeB64(b64, "OpenAI-compatible image generation");
  return { bytes, mimeType: "image/png", model: payload.model };
}

export async function requestGoogleImageGeneration({
  prompt,
  token,
  model,
  baseUrl,
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const secret = trimStr(token);
  if (!secret) throw imageError(401, "Google image API key is not configured");
  const url = googleGenerateContentUrl(baseUrl, model);
  const payload = {
    contents: [{ role: "user", parts: [{ text: String(prompt ?? "") }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  };
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": secret,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") {
      throw imageError(499, "图像生成已取消", "ABORTED");
    }
    throw imageError(502, "Google image generation network error");
  }
  const rawText = await response.text();
  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 || response.status === 429
      ? response.status
      : response.status >= 500
        ? response.status
        : 502;
    throw imageError(status, `图像生成失败（Google HTTP ${response.status}）`);
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw imageError(502, "Google image generation returned invalid JSON");
  }
  const parts = parsed?.candidates?.[0]?.content?.parts;
  const list = Array.isArray(parts) ? parts : [];
  let b64 = "";
  let mime = "image/png";
  for (const part of list) {
    const inline = asObject(part?.inlineData) || asObject(part?.inline_data);
    if (inline?.data) {
      b64 = inline.data;
      mime = trimStr(inline.mimeType || inline.mime_type) || mime;
      break;
    }
  }
  const bytes = decodeB64(b64, "Google image generation");
  return { bytes, mimeType: mime, model: trimStr(model) };
}

export async function generatePortraitBytes({
  route,
  prompt,
  aspectRatio,
  signal,
  fetchImpl,
  env,
  agentDir,
  now,
  log,
  timeoutMs,
  connectTimeoutMs,
  intervalMs,
  sleepFn,
  probeImpl,
} = {}) {
  void now;
  if (!route || route.family === PORTRAIT_FAMILY_UNSUPPORTED) {
    throw imageError(400, unsupportedMessage(route?.provider));
  }
  if (route.family === PORTRAIT_FAMILY_XAI) {
    const transport = await resolveXaiImageTransport({ env, agentDir, probeImpl });
    log?.("xai_image_route", {
      backend: transport.backend,
      token_source: transport.tokenSource,
      model: transport.model,
    });
    return requestXaiImageGeneration({
      prompt,
      token: transport.token,
      model: transport.model,
      url: transport.url,
      aspectRatio,
      signal,
      timeoutMs,
      connectTimeoutMs,
      fetchImpl,
      log,
    });
  }
  if (route.family === PORTRAIT_FAMILY_OPENAI) {
    return requestOpenAIImageGeneration({
      prompt,
      token: route.token,
      model: route.model,
      baseUrl: route.baseUrl,
      signal,
      fetchImpl,
    });
  }
  if (route.family === PORTRAIT_FAMILY_GOOGLE) {
    return requestGoogleImageGeneration({
      prompt,
      token: route.token,
      model: route.model,
      baseUrl: route.baseUrl,
      signal,
      fetchImpl,
    });
  }
  if (route.family === PORTRAIT_FAMILY_JELLYTOKEN) {
    return requestJellyTokenImageGeneration({
      prompt,
      token: route.token,
      model: route.model,
      baseUrl: route.baseUrl,
      signal,
      fetchImpl,
      timeoutMs,
      intervalMs,
      sleepFn,
    });
  }
  if (route.family === PORTRAIT_FAMILY_DASHSCOPE) {
    return requestDashScopeImageGeneration({
      prompt,
      token: route.token,
      model: route.model,
      baseUrl: route.baseUrl,
      signal,
      fetchImpl,
      timeoutMs,
      intervalMs,
      sleepFn,
    });
  }
  throw imageError(400, unsupportedMessage(route.provider));
}
