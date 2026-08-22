/**
 * xAI / PipiUI-host portrait image client for pi-coc — compat consumer of the
 * canonical `grok-build-oauth` extension package.
 *
 * Routing (canonical spec docs/specs/grok-build-oauth-image-extension.md):
 * 0. Installed grok-build-oauth + Pi auth `grok-build` OAuth credential →
 *    official POST {base}/images/generations via the artifact's credential
 *    broker (early refresh / 401 retry / cross-process lock stay in the
 *    single-source package). This is the canonical path for the portrait
 *    HTTP route until pi ships an `invokeExtension` RPC (pi 0.84.2 lacks it,
 *    so the route cannot hot-call the in-session image_gen tool — no fake
 *    hot calls).
 * 1. compatFallback (deprecated, labeled): explicit XAI_API_KEY → official
 *    POST https://api.x.ai/v1/images/generations
 * 2. compatFallback (deprecated, labeled): PipiUI host with a loopback Grok
 *    Imagine relay → host-native channel (PIPIUI_GROK_RELAY or
 *    http://127.0.0.1:18891/v1), model grok-imagine-image-quality
 * 3. compatFallback: product auth.json xai `key` (not OAuth access) → official
 *
 * New session/model tool paths use the canonical extension's image_gen /
 * image_edit tools instead of this HTTP route. OAuth state never enters COC
 * campaign state; credentials stay in Pi auth.json.
 *
 * OAuth access/token from the xai entry is never used as an official image
 * API key. Relay bases must be loopback. Never log Bearer, keys, or prompts.
 *
 * HTTP contract (image bytes stay on disk, never in JSON):
 *
 * POST /api/portraits/generate ← {@link GeneratePortraitBody}
 * POST /api/portraits/generate → {@link GeneratePortraitResult}
 *
 * Does not write character.json / portrait metadata.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { resolveProductAgentDir } from "./agent-dir.mjs";
import { campaignDir } from "./projections.mjs";
import {
  DEFAULT_REPO_ROOT,
  GROK_BUILD_SETTINGS_ENV as GROK_BUILD_SETTINGS_ENV_NAME,
  grokBuildCompatFallbackEnabled,
  loadGrokBuildHostLibrary,
} from "./grok-build-extension.mjs";

export const XAI_IMAGES_GENERATIONS_URL = "https://api.x.ai/v1/images/generations";
export const DEFAULT_XAI_IMAGE_MODEL = "grok-imagine-image-2.0";
export const DEFAULT_PIPIUI_GROK_RELAY = "http://127.0.0.1:18891/v1";
export const DEFAULT_PIPIUI_RELAY_MODEL = "grok-imagine-image-quality";
/** Canonical grok-build images defaults (informational; the artifact owns them). */
export const GROK_BUILD_DEFAULT_BASE_URL = "https://api.x.ai/v1";
export const GROK_BUILD_DEFAULT_IMAGE_MODEL = "grok-imagine-image-quality";
export const DEFAULT_XAI_IMAGE_TIMEOUT_MS = 60_000;
export const DEFAULT_XAI_CONNECT_TIMEOUT_MS = 10_000;
export const RELAY_PROBE_TIMEOUT_MS = 800;
export const MAX_IMAGE_PROMPT_CHARS = 8000;
export const CAMPAIGN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const PORTRAIT_EXT_RE = /\.(png|jpe?g|webp)$/i;
export const ALLOWED_ASPECT_RATIOS = Object.freeze([
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "5:4",
  "4:5",
  "21:9",
  "auto",
]);

const AUTH_NAME = "auth.json";
const MAX_B64_CHARS = 20 * 1024 * 1024;
const RELAY_BEARER = "local";

export class XaiImageError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = "XaiImageError";
    this.status = Number.isInteger(opts.status) ? opts.status : 500;
    if (opts.code) this.code = opts.code;
  }
}

function trimKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function imageError(status, message, code) {
  return new XaiImageError(message, { status, code });
}

export function redactSecrets(text, secrets = []) {
  let out = String(text ?? "");
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]");
  for (const secret of secrets) {
    const token = trimKey(secret);
    if (token.length < 8) continue;
    out = out.split(token).join("[redacted]");
  }
  return out;
}

export function safeImageLogFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("token")
      || lower.includes("authorization")
      || lower.includes("secret")
      || lower.includes("prompt")
      || lower.includes("bearer")
      || lower === "key"
      || lower === "b64"
      || lower === "b64_json"
      || lower === "data"
      || lower === "bytes"
    ) {
      continue;
    }
    if (typeof value === "string" && value.length > 500) {
      out[key] = `${value.slice(0, 80)}…`;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function defaultLog(event, fields) {
  const line = JSON.stringify({ event, ...safeImageLogFields(fields) });
  process.stderr.write(`${line}\n`);
}

function isExpired(entry, now) {
  const raw = entry.expires ?? entry.expires_at ?? entry.expiry;
  if (raw == null || raw === "") return false;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return false;
  const ms = n < 1e12 ? n * 1000 : n;
  return ms <= now;
}

export function tokenFromXaiEntry(entry, now = Date.now()) {
  const obj = asObject(entry);
  if (!obj) return "";
  const access = trimKey(obj.access) || trimKey(obj.access_token);
  if (access && !isExpired(obj, now)) return access;
  return trimKey(obj.key) || trimKey(obj.apiKey) || trimKey(obj.api_key);
}

/** Official Imagine accepts API keys only — never OAuth access/token. */
export function officialXaiApiKeyFromEntry(entry) {
  const obj = asObject(entry);
  if (!obj) return "";
  return trimKey(obj.key) || trimKey(obj.apiKey) || trimKey(obj.api_key);
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function xaiAuthEntry(authRaw) {
  const root = asObject(authRaw);
  if (!root) return undefined;
  const nested = asObject(root.providers);
  return asObject(nested?.xai) || asObject(root.xai);
}

function productAgentDir({ env, agentDir } = {}) {
  return trimKey(agentDir)
    || resolveProductAgentDir({
      agentDir: env?.PI_AGENT_DIR,
      userData: env?.COC_DESKTOP_USER_DATA,
    });
}

/**
 * XAI_API_KEY wins, else product agent auth.json xai access (unexpired) or key.
 * OAuth access is not an official image key; use {@link resolveOfficialXaiApiKey}.
 * @returns {{ token: string, source: "env" | "auth.json" | "none" }}
 */
export function resolveXaiToken({
  env = process.env,
  agentDir,
  now = Date.now(),
} = {}) {
  const fromEnv = trimKey(env?.XAI_API_KEY);
  if (fromEnv) return { token: fromEnv, source: "env" };
  const dir = productAgentDir({ env, agentDir });
  const entry = xaiAuthEntry(readJsonFile(path.join(dir, AUTH_NAME)));
  const token = tokenFromXaiEntry(entry, now);
  if (token) return { token, source: "auth.json" };
  return { token: "", source: "none" };
}

/**
 * Explicit env key or auth.json `key` only. Ignores OAuth access/token.
 * @returns {{ token: string, source: "env" | "auth.json" | "none" }}
 */
export function resolveOfficialXaiApiKey({
  env = process.env,
  agentDir,
} = {}) {
  const fromEnv = trimKey(env?.XAI_API_KEY);
  if (fromEnv) return { token: fromEnv, source: "env" };
  const dir = productAgentDir({ env, agentDir });
  const key = officialXaiApiKeyFromEntry(xaiAuthEntry(readJsonFile(path.join(dir, AUTH_NAME))));
  if (key) return { token: key, source: "auth.json" };
  return { token: "", source: "none" };
}

export function isPipiUiHost(env = process.env) {
  const e = env || {};
  return Boolean(
    trimKey(e.PIPIUI_GROK_RELAY)
    || trimKey(e.PIPIUI_HOST_PROTOCOL)
    || trimKey(e.PIPIUI_BRIDGE_PORT)
    || trimKey(e.PIPIUI_PI_PATH)
    || trimKey(e.PIPIUI_SESSION_CAPABILITY),
  );
}

export function isLoopbackHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function pipiUiGrokRelayBase(env = process.env) {
  const explicit = trimKey(env?.PIPIUI_GROK_RELAY);
  if (explicit) {
    if (!isLoopbackHttpUrl(explicit)) {
      throw imageError(400, "图像中继必须是本机地址。", "RELAY_NOT_LOOPBACK");
    }
    return explicit.replace(/\/+$/, "");
  }
  if (isPipiUiHost(env)) return DEFAULT_PIPIUI_GROK_RELAY;
  return "";
}

export function grokRelayGenerationsUrl(base) {
  const b = String(base || "").replace(/\/+$/, "");
  if (/\/images\/generations$/i.test(b)) return b;
  return `${b}/images/generations`;
}

function safeUrlForLog(value) {
  try {
    const parsed = new URL(String(value || ""));
    parsed.search = "";
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function probePipiUiGrokRelay(base, {
  timeoutMs = RELAY_PROBE_TIMEOUT_MS,
  probeImpl,
} = {}) {
  if (typeof probeImpl === "function") {
    return Promise.resolve(probeImpl(base)).then(Boolean);
  }
  if (!isLoopbackHttpUrl(base)) return Promise.resolve(false);
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    return Promise.resolve(false);
  }
  const port = parsed.port
    ? Number(parsed.port)
    : (parsed.protocol === "https:" ? 443 : 80);
  if (!Number.isInteger(port) || port <= 0) return Promise.resolve(false);
  const host = parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname;
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : RELAY_PROBE_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

function hostErrorStatus(err) {
  const code = String(err?.code || err?.name || "");
  if (code === "auth_expired" || code === "invalid_grant") return 401;
  if (code === "tier_restricted") return 403;
  if (code === "rate_limited") return 429;
  if (code === "invalid_params") return 400;
  if (code === "not_logged_in") return 401;
  return 502;
}

/**
 * Canonical-host error codes that MAY fall through to the deprecated compat
 * transports — and only when the user explicitly enabled
 * `ext.grok-build-oauth.compatFallback` (spec D6/D8: "未登录/被 gate/受限时按
 * compat 回退").
 *
 * - `tier_restricted` — advisory client-side gate (Free/empty/X Basic tier);
 *   the legacy XAI_API_KEY path is never tier-gated (US-22/US-30).
 * - `auth_expired` / `not_logged_in` — OAuth credential unusable/unconfigured
 *   on the canonical path.
 * - `NoAgentHomeError` — the canonical host cannot resolve a Pi home
 *   (host unconfigured), so there is nothing canonical to protect.
 *
 * Everything else — invalid_params, invalid_response, path containment /
 * security violations, aborts, timeouts, upstream 4xx/5xx, network errors —
 * surfaces as-is: caller mistakes, transport faults, and cancellations must
 * not silently re-run against a deprecated backend.
 */
const HOST_ERRORS_COMPAT_FALLBACK = Object.freeze(new Set([
  "tier_restricted",
  "auth_expired",
  "not_logged_in",
  "NoAgentHomeError",
]));

/** True only for the explicitly allow-listed canonical host errors above. */
export function hostErrorAllowsCompatFallback(err) {
  if (!err) return false;
  const code = String(err?.code || err?.name || "");
  return HOST_ERRORS_COMPAT_FALLBACK.has(code);
}

/**
 * Canonical portrait path: dynamically import the installed artifact's
 * manifest-declared `host.entry` (`agent/dist/host.js`) and call its stable
 * host API (`createGrokBuildHostLibrary`). The library owns the credential
 * broker (early refresh / 401 single retry / cross-process lock), the tier
 * gate, `resolution=1k`, `x-grok-session-id`, and typed bytes+metadata
 * results — this file never re-implements that request logic.
 *
 * The artifact resolves its settings snapshot from the ambient process env
 * (`PIPIUI_EXT_SETTINGS_GROK_BUILD_OAUTH`) at call time; the caller's `env`
 * value (already sanitized upstream) is exported around the call so tier /
 * compat decisions match the requesting session. Restored afterwards.
 *
 * Returns one of:
 * - { status: "ready", result: HostImageResult } — typed canonical result;
 * - { status: "absent" } — ONLY genuine module/installation absence: no
 *   verified install, no host library export, no resolvable agent home;
 * - { status: "auth-missing", loggedIn, expired } — installed, library
 *   constructed, status() answered, but no usable grok-build credential
 *   (caller decides via the compatFallback gate);
 * - { status: "error", error } — the canonical path itself failed (host
 *   library construction, status(), or generateImage). The error's code is
 *   preserved and passes through the same precise compat allow-list;
 *   non-allow-listed codes surface as-is and compat can never bypass them.
 */
export async function generatePortraitViaGrokBuildHostLibrary({
  env = process.env,
  agentDir,
  repoRoot = DEFAULT_REPO_ROOT,
  prompt,
  aspectRatio,
  signal,
  fetchImpl,
  log,
} = {}) {
  const host = await loadGrokBuildHostLibrary({ repoRoot, env });
  // Only genuine absence classifies as `absent`; a verified-but-unloadable
  // artifact is an `error` that goes through the compat allow-list.
  if (host.status === "absent") return { status: "absent" };
  if (host.status === "error") return { status: "error", error: host.error };
  const dir = trimKey(agentDir)
    || resolveProductAgentDir({
      agentDir: env?.PI_AGENT_DIR,
      userData: env?.COC_DESKTOP_USER_DATA,
    });
  if (!dir) return { status: "absent" };
  const previousSnapshot = process.env[GROK_BUILD_SETTINGS_ENV_NAME];
  const hadPrevious = Object.prototype.hasOwnProperty.call(process.env, GROK_BUILD_SETTINGS_ENV_NAME);
  const snapshot = trimKey(env?.[GROK_BUILD_SETTINGS_ENV_NAME]);
  if (snapshot) process.env[GROK_BUILD_SETTINGS_ENV_NAME] = snapshot;
  else delete process.env[GROK_BUILD_SETTINGS_ENV_NAME];
  try {
    return await callGrokBuildHostLibrary({ host, dir, prompt, aspectRatio, signal, fetchImpl, log });
  } catch (err) {
    // Only genuine module/installation absence may classify as `absent`.
    // Any failure to CONSTRUCT the host library or to READ its status —
    // credential-store symlink/permission/corruption, security violations,
    // upstream faults — is preserved as `error` with its code so it passes
    // through the same precise compat allow-list instead of silently
    // downgrading to a legacy transport when compatFallback is on.
    return { status: "error", error: err };
  } finally {
    if (hadPrevious) process.env[GROK_BUILD_SETTINGS_ENV_NAME] = previousSnapshot;
    else delete process.env[GROK_BUILD_SETTINGS_ENV_NAME];
  }
}

async function callGrokBuildHostLibrary({ host, dir, prompt, aspectRatio, signal, fetchImpl, log }) {
  const lib = host.createHostLibrary({
    authPath: path.join(dir, AUTH_NAME),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  const status = await lib.status();
  if (!status || status.usable !== true) {
    return {
      status: "auth-missing",
      loggedIn: Boolean(status?.loggedIn),
      expired: Boolean(status?.expired),
    };
  }
  try {
    const result = await lib.generateImage({ prompt, aspectRatio, signal });
    log?.("xai_image_route", {
      backend: result?.backend || "grok-build",
      model: result?.model,
      canonical: true,
      host_entry_sha256: host.hostEntrySha256,
    });
    return { status: "ready", result };
  } catch (err) {
    return { status: "error", error: err };
  }
}

/** Surface a canonical-path host-library error as an HTTP-facing error. */
export function hostLibraryImageError(err) {
  if (err instanceof XaiImageError) return err;
  const message = redactSecrets(String(err?.message || err), []);
  return new XaiImageError(message, { status: hostErrorStatus(err), code: err?.code });
}

function noBackendError({ tierGated = false } = {}) {
  const hint = tierGated
    ? "当前 Grok Build tier 受限（图像需 SuperGrok 订阅），且旧 xAI 兼容通道未开启（compatFallback 默认关闭）。"
    : "未登录 Grok Build（/login grok-build），且旧 xAI 兼容通道未开启（compatFallback 默认关闭）。";
  return imageError(401, hint, "NO_IMAGE_BACKEND");
}

/**
 * DEPRECATED compat-only transport resolver. Called only after the canonical
 * grok-build host path is unavailable AND the user explicitly enabled
 * `ext.grok-build-oauth.compatFallback` (default off — spec D6 / US-27). With
 * the gate closed this NEVER hands out the legacy XAI_API_KEY / relay /
 * auth.json-key transports. Legacy ordering: explicit official key → PipiUI
 * loopback relay → auth.json xai `key`.
 */
export async function resolveXaiImageTransport({
  env = process.env,
  agentDir,
  probeImpl,
  repoRoot = DEFAULT_REPO_ROOT,
  tierGated = false,
} = {}) {
  if (!grokBuildCompatFallbackEnabled({ repoRoot, env })) {
    throw noBackendError({ tierGated });
  }
  const official = resolveOfficialXaiApiKey({ env, agentDir });
  if (official.source === "env") {
    return {
      backend: "official",
      url: XAI_IMAGES_GENERATIONS_URL,
      token: official.token,
      model: DEFAULT_XAI_IMAGE_MODEL,
      tokenSource: official.source,
      compatFallback: true,
      deprecated: true,
    };
  }
  const relayBase = pipiUiGrokRelayBase(env);
  if (relayBase) {
    const reachable = await probePipiUiGrokRelay(relayBase, { probeImpl });
    if (!reachable) {
      throw imageError(503, "当前宿主图像通道不可用，无法生成头像。", "RELAY_UNAVAILABLE");
    }
    return {
      backend: "pipiui-relay",
      url: grokRelayGenerationsUrl(relayBase),
      token: RELAY_BEARER,
      model: DEFAULT_PIPIUI_RELAY_MODEL,
      tokenSource: "relay",
      compatFallback: true,
      deprecated: true,
    };
  }
  if (official.token) {
    return {
      backend: "official",
      url: XAI_IMAGES_GENERATIONS_URL,
      token: official.token,
      model: DEFAULT_XAI_IMAGE_MODEL,
      tokenSource: official.source,
      compatFallback: true,
      deprecated: true,
    };
  }
  throw noBackendError({ tierGated });
}

export function parseGeneratePortraitBody(body) {
  const obj = asObject(body);
  if (!obj) throw imageError(400, "request body must be a JSON object");
  const campaignId = trimKey(obj.campaign_id);
  if (!campaignId) throw imageError(400, "campaign_id is required");
  if (!CAMPAIGN_ID_RE.test(campaignId)) throw imageError(400, "campaign_id is invalid");
  const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : "";
  if (!prompt) throw imageError(400, "prompt is required");
  if (prompt.length > MAX_IMAGE_PROMPT_CHARS) throw imageError(400, "prompt is too long");
  const outputPath = trimKey(obj.output_path);
  if (!outputPath) throw imageError(400, "output_path is required");
  let aspectRatio;
  if (Object.prototype.hasOwnProperty.call(obj, "aspect_ratio") && obj.aspect_ratio != null && obj.aspect_ratio !== "") {
    const ratio = trimKey(obj.aspect_ratio);
    if (!ALLOWED_ASPECT_RATIOS.includes(ratio)) {
      throw imageError(400, "aspect_ratio is invalid");
    }
    aspectRatio = ratio;
  }
  return { campaignId, prompt, outputPath, aspectRatio };
}

function isInsideDir(root, candidate) {
  const base = path.resolve(root);
  const full = path.resolve(candidate);
  return full === base || full.startsWith(base + path.sep);
}

export function portraitOutputRoots(workspace, campaignId) {
  const dir = campaignDir(workspace, campaignId);
  return [
    path.join(dir, "assets", "portraits"),
    path.join(dir, "tmp", "portraits"),
  ];
}

/**
 * Resolve a caller-specified campaign portrait temp or target path.
 * Rejects traversal outside assets/portraits or tmp/portraits.
 */
export function resolvePortraitOutputPath({ workspace, campaignId, outputPath }) {
  const ws = path.resolve(workspace);
  const id = trimKey(campaignId);
  if (!id || !CAMPAIGN_ID_RE.test(id)) throw imageError(400, "campaign_id is invalid");
  const campaignRoot = campaignDir(ws, id);
  if (!fs.existsSync(campaignRoot)) {
    throw imageError(404, `campaign ${id} not found`);
  }
  const raw = trimKey(outputPath);
  if (!raw) throw imageError(400, "output_path is required");
  if (raw.includes("\0")) throw imageError(400, "output_path is invalid");
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(campaignRoot, raw);
  if (!PORTRAIT_EXT_RE.test(resolved)) {
    throw imageError(400, "output_path must be a .png, .jpg, .jpeg, or .webp file");
  }
  const roots = portraitOutputRoots(ws, id);
  if (!roots.some((root) => isInsideDir(root, resolved))) {
    throw imageError(
      400,
      "output_path must be under campaign assets/portraits or tmp/portraits",
    );
  }
  if (path.basename(resolved).startsWith(".")) {
    throw imageError(400, "output_path is invalid");
  }
  return resolved;
}

export function buildImagineRequest({
  prompt,
  model = DEFAULT_XAI_IMAGE_MODEL,
  aspectRatio,
} = {}) {
  const body = {
    model: trimKey(model) || DEFAULT_XAI_IMAGE_MODEL,
    prompt: String(prompt ?? ""),
    n: 1,
    response_format: "b64_json",
  };
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  return body;
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function mimeFromResponse(entry, fallbackPath) {
  const raw = trimKey(entry?.mime_type) || trimKey(entry?.mimeType);
  if (raw === "image/jpeg" || raw === "image/jpg") return "image/jpeg";
  if (raw === "image/webp") return "image/webp";
  if (raw === "image/png") return "image/png";
  return mimeFromPath(fallbackPath);
}

function statusForHttp(status) {
  if (status === 401 || status === 403 || status === 429) return status;
  if (status >= 500 && status <= 599) return status;
  if (status === 400) return 400;
  if (status >= 400 && status <= 499) return status;
  return 502;
}

function messageForHttp(status, redacted) {
  if (status === 401) return "xAI image generation unauthorized";
  if (status === 403) return "xAI image generation forbidden";
  if (status === 429) return "xAI image generation rate limited";
  if (status >= 500 && status <= 599) return "xAI image generation failed (upstream)";
  if (redacted) return `xAI image generation failed: ${redacted}`.slice(0, 300);
  return "xAI image generation failed";
}

function abortError(signal) {
  const reason = signal?.reason;
  const timedOut =
    (reason && (reason.name === "TimeoutError" || reason.code === "ETIMEDOUT"))
    || (reason instanceof Error && /timed out/i.test(reason.message));
  if (timedOut) {
    return imageError(504, "xAI image generation timed out", "ETIMEDOUT");
  }
  return imageError(499, "xAI image generation cancelled", "ABORTED");
}

function combineSignals(userSignal, timeoutMs) {
  const ac = new AbortController();
  const onUserAbort = () => ac.abort(userSignal.reason);
  if (userSignal) {
    if (userSignal.aborted) ac.abort(userSignal.reason);
    else userSignal.addEventListener("abort", onUserAbort, { once: true });
  }
  let timer;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      const err = new Error("xAI image generation timed out");
      err.name = "TimeoutError";
      err.code = "ETIMEDOUT";
      ac.abort(err);
    }, timeoutMs);
  }
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (userSignal) userSignal.removeEventListener("abort", onUserAbort);
  };
  return { signal: ac.signal, cleanup };
}



function firstImageRow(parsed) {
  const obj = asObject(parsed);
  if (!obj) return {};
  if (Array.isArray(obj.data)) return asObject(obj.data[0]) || {};
  if (asObject(obj.data)) return obj.data;
  return obj;
}

function decodeB64Image(b64) {
  const raw = trimKey(b64).replace(/\s+/g, "");
  if (!raw) throw imageError(502, "xAI image generation returned no b64 image");
  if (raw.length > MAX_B64_CHARS) throw imageError(502, "xAI image generation payload is too large");
  let bytes;
  try {
    bytes = Buffer.from(raw, "base64");
  } catch {
    throw imageError(502, "xAI image generation returned invalid b64");
  }
  if (!bytes.length) throw imageError(502, "xAI image generation returned empty image");
  return { bytes, b64: raw };
}

async function bytesFromImageUrl(imageUrl, {
  fetchImpl,
  signal,
  timeoutMs,
  secrets,
} = {}) {
  const raw = trimKey(imageUrl);
  if (!raw) return null;
  if (/^data:image\//i.test(raw)) {
    const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) throw imageError(502, "xAI image generation returned invalid data URI");
    const decoded = decodeB64Image(match[2]);
    return { ...decoded, mimeType: match[1] };
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw imageError(502, "xAI image generation returned invalid image URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw imageError(502, "xAI image generation returned unsupported image URL");
  }
  const combined = combineSignals(signal, timeoutMs);
  let response;
  try {
    response = await fetchImpl(raw, { method: "GET", signal: combined.signal });
  } catch (err) {
    if (combined.signal.aborted || err?.name === "AbortError" || err?.code === "ABORT_ERR") {
      throw abortError(combined.signal);
    }
    throw imageError(502, redactSecrets(err?.message || "xAI image download network error", secrets));
  } finally {
    combined.cleanup();
  }
  if (!response.ok) {
    throw imageError(statusForHttp(response.status), "xAI image download failed");
  }
  const headerMime = trimKey(
    typeof response.headers?.get === "function"
      ? response.headers.get("content-type")
      : response.headers?.["content-type"],
  ).split(";")[0];
  let bytes;
  if (typeof response.arrayBuffer === "function") {
    bytes = Buffer.from(await response.arrayBuffer());
  } else if (typeof response.bytes === "function") {
    bytes = Buffer.from(await response.bytes());
  } else {
    const text = await response.text();
    bytes = Buffer.from(text, "binary");
  }
  if (!bytes.length) throw imageError(502, "xAI image generation returned empty image");
  return {
    bytes,
    b64: bytes.toString("base64"),
    mimeType: headerMime || mimeFromPath(parsed.pathname),
  };
}

/**
 * Call Imagine (official or host relay) and return decoded bytes. Does not write files.
 * @returns {Promise<{ bytes: Buffer, b64: string, mimeType: string, model: string }>}
 */
export async function requestXaiImageGeneration({
  prompt,
  token,
  model = DEFAULT_XAI_IMAGE_MODEL,
  aspectRatio,
  signal,
  timeoutMs = DEFAULT_XAI_IMAGE_TIMEOUT_MS,
  connectTimeoutMs = DEFAULT_XAI_CONNECT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  log = defaultLog,
  url = XAI_IMAGES_GENERATIONS_URL,
} = {}) {
  const secret = trimKey(token);
  if (!secret) throw imageError(401, "xAI API key is not configured");
  const payload = buildImagineRequest({ prompt, model, aspectRatio });
  const totalMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_XAI_IMAGE_TIMEOUT_MS;
  const combined = combineSignals(signal, totalMs);
  log("xai_image_request", {
    url: safeUrlForLog(url) || XAI_IMAGES_GENERATIONS_URL,
    model: payload.model,
    n: payload.n,
  });
  let response;
  let rawText = "";
  try {
    void connectTimeoutMs;
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: combined.signal,
    });
    rawText = await response.text();
  } catch (err) {
    if (combined.signal.aborted || err?.name === "AbortError" || err?.code === "ABORT_ERR") {
      throw abortError(combined.signal);
    }
    throw imageError(502, redactSecrets(err?.message || "xAI image generation network error", [secret]));
  } finally {
    combined.cleanup();
  }
  const redacted = redactSecrets(rawText, [secret]);
  if (!response.ok) {
    const status = statusForHttp(response.status);
    log("xai_image_http_error", { status: response.status, mapped: status });
    throw imageError(status, messageForHttp(response.status, redacted));
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw imageError(502, "xAI image generation returned invalid JSON");
  }
  const row = firstImageRow(parsed);
  const b64 = trimKey(row?.b64_json) || trimKey(row?.b64);
  if (b64) {
    const decoded = decodeB64Image(b64);
    return {
      bytes: decoded.bytes,
      b64: decoded.b64,
      mimeType: mimeFromResponse(row, ""),
      model: payload.model,
    };
  }
  const imageUrl = trimKey(row?.url) || trimKey(asObject(parsed)?.url);
  if (!imageUrl) throw imageError(502, "xAI image generation returned no b64 image");
  const downloaded = await bytesFromImageUrl(imageUrl, {
    fetchImpl,
    signal,
    timeoutMs: totalMs,
    secrets: [secret],
  });
  return {
    bytes: downloaded.bytes,
    b64: downloaded.b64,
    mimeType: downloaded.mimeType || mimeFromResponse(row, ""),
    model: payload.model,
  };
}

export function writePortraitFile(outputPath, bytes) {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, outputPath);
  return outputPath;
}

/**
 * Generate one Imagine image and write it to the caller-specified portrait path.
 * Does not mutate investigator/character state.
 *//**
 * DEPRECATED compat-only transport resolver. Called only after the canonical
 * investigator portrait flow): canonical grok-build host library first, then
 * the deprecated compat transports — which resolveXaiImageTransport hands out
 * ONLY when `ext.grok-build-oauth.compatFallback` is explicitly enabled.
 * Returns `{ bytes, mimeType, model, backend, deprecated? }`.
 */
/**
 * Shared xAI-family portrait dispatch (used by both the HTTP route and the
 * investigator portrait flow): canonical grok-build host library first, then
 * the deprecated compat transports — which resolveXaiImageTransport hands out
 * ONLY when `ext.grok-build-oauth.compatFallback` is explicitly enabled.
 * When the canonical host call itself fails, only the allow-listed codes
 * (`hostErrorAllowsCompatFallback`: tier gate / auth unconfigured / host
 * unavailable) may fall through to compat; everything else surfaces.
 * Returns `{ bytes, mimeType, model, backend, deprecated? }`.
 */
export async function generateXaiFamilyPortraitBytes({
  prompt,
  aspectRatio,
  signal,
  fetchImpl,
  env,
  agentDir,
  repoRoot = DEFAULT_REPO_ROOT,
  model,
  timeoutMs,
  connectTimeoutMs,
  probeImpl,
  log,
} = {}) {
  const canonical = await generatePortraitViaGrokBuildHostLibrary({
    env,
    agentDir,
    repoRoot,
    prompt,
    aspectRatio,
    signal,
    fetchImpl,
    log,
  });
  let tierGated = false;
  if (canonical.status === "ready") {
    const result = canonical.result;
    return {
      bytes: Buffer.from(result.bytes),
      mimeType: trimKey(result.mime) || "image/png",
      model: trimKey(result.model),
      backend: trimKey(result.backend) || "grok-build",
      canonical: true,
      ...(result.deprecated ? { deprecated: true } : {}),
    };
  }
  if (canonical.status === "error") {
    const err = canonical.error;
    // Only the explicitly allow-listed canonical errors (tier gate / auth
    // unconfigured / host-unavailable) may fall through to the deprecated
    // compat transports, and only when compatFallback is explicitly enabled.
    // invalid_params, path/security violations, aborts, timeouts, upstream and
    // network failures surface as-is — never silently rerun on a deprecated
    // backend.
    if (hostErrorAllowsCompatFallback(err)) {
      tierGated = String(err?.code || err?.name || "") === "tier_restricted";
      log?.("xai_image_compat_fallback_eligible", {
        code: String(err?.code || err?.name || ""),
        canonical: true,
      });
      // Falls through to the gated resolver below.
    } else {
      throw hostLibraryImageError(err);
    }
  }
  // absent / auth-missing → deprecated compat paths, gated inside the resolver.
  const transport = await resolveXaiImageTransport({ env, agentDir, probeImpl, repoRoot, tierGated });
  log?.("xai_image_generate", {
    token_source: transport.tokenSource,
    backend: transport.backend,
    compat_fallback: transport.compatFallback === true,
    deprecated: transport.deprecated === true,
  });
  const image = await requestXaiImageGeneration({
    prompt,
    token: transport.token,
    model: model || transport.model,
    url: transport.url,
    aspectRatio,
    signal,
    timeoutMs,
    connectTimeoutMs,
    fetchImpl,
    log,
  });
  return {
    bytes: image.bytes,
    mimeType: image.mimeType || "image/png",
    model: image.model,
    backend: transport.backend,
    ...(transport.deprecated ? { deprecated: true } : {}),
  };
}

export async function generateCampaignPortrait({
  workspace,
  campaignId,
  prompt,
  outputPath,
  aspectRatio,
  model,
  signal,
  timeoutMs,
  connectTimeoutMs,
  env = process.env,
  agentDir,
  fetchImpl,
  now,
  log = defaultLog,
  probeImpl,
  repoRoot = DEFAULT_REPO_ROOT,
} = {}) {
  void now;
  const resolved = resolvePortraitOutputPath({ workspace, campaignId, outputPath });
  log("xai_image_generate", {
    campaign_id: campaignId,
    output_dir: path.dirname(resolved),
  });
  const image = await generateXaiFamilyPortraitBytes({
    prompt,
    aspectRatio,
    signal,
    fetchImpl,
    env,
    agentDir,
    repoRoot,
    model,
    timeoutMs,
    connectTimeoutMs,
    probeImpl,
    log,
  });
  writePortraitFile(resolved, image.bytes);
  const relative = path.relative(path.resolve(workspace), resolved);
  return {
    ok: true,
    output_path: relative,
    model: image.model,
    mime_type: image.mimeType || mimeFromPath(resolved),
    bytes_written: image.bytes.length,
    backend: image.backend,
    ...(image.canonical ? { canonical: true } : {}),
    ...(image.deprecated ? { deprecated: true } : {}),
  };
}

export async function runGeneratePortraitHttp(opts) {
  const parsed = parseGeneratePortraitBody(opts.body);
  return generateCampaignPortrait({ ...opts, ...parsed });
}
