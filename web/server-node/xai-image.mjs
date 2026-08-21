/**
 * Official xAI Grok Imagine client for pi-coc host portrait generation.
 *
 * POST https://api.x.ai/v1/images/generations only. Credentials: XAI_API_KEY
 * then product agent `auth.json` xai access/key. Never PIPIUI_GROK_RELAY,
 * coding relay, or ~/.pi unless that is the product agent dir.
 *
 * HTTP contract for later UI (image bytes stay on disk, never in JSON):
 *
 * POST /api/portraits/generate ← {@link GeneratePortraitBody}
 * POST /api/portraits/generate → {@link GeneratePortraitResult}
 *
 * Does not write character.json / portrait metadata.
 */
import fs from "node:fs";
import path from "node:path";

import { resolveProductAgentDir } from "./agent-dir.mjs";
import { campaignDir } from "./projections.mjs";

export const XAI_IMAGES_GENERATIONS_URL = "https://api.x.ai/v1/images/generations";
export const DEFAULT_XAI_IMAGE_MODEL = "grok-imagine-image-2.0";
export const DEFAULT_XAI_IMAGE_TIMEOUT_MS = 60_000;
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

/**
 * XAI_API_KEY wins, else product agent auth.json xai access (unexpired) or key.
 * @returns {{ token: string, source: "env" | "auth.json" | "none" }}
 */
export function resolveXaiToken({
  env = process.env,
  agentDir,
  now = Date.now(),
} = {}) {
  const fromEnv = trimKey(env?.XAI_API_KEY);
  if (fromEnv) return { token: fromEnv, source: "env" };
  const dir = trimKey(agentDir)
    || resolveProductAgentDir({
      agentDir: env?.PI_AGENT_DIR,
      userData: env?.COC_DESKTOP_USER_DATA,
    });
  const entry = xaiAuthEntry(readJsonFile(path.join(dir, AUTH_NAME)));
  const token = tokenFromXaiEntry(entry, now);
  if (token) return { token, source: "auth.json" };
  return { token: "", source: "none" };
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

/**
 * Call official Imagine and return decoded bytes. Does not write files.
 * @returns {Promise<{ bytes: Buffer, b64: string, mimeType: string, model: string }>}
 */
export async function requestXaiImageGeneration({
  prompt,
  token,
  model = DEFAULT_XAI_IMAGE_MODEL,
  aspectRatio,
  signal,
  timeoutMs = DEFAULT_XAI_IMAGE_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  log = defaultLog,
} = {}) {
  const secret = trimKey(token);
  if (!secret) throw imageError(401, "xAI API key is not configured");
  const payload = buildImagineRequest({ prompt, model, aspectRatio });
  const combined = combineSignals(signal, timeoutMs);
  log("xai_image_request", {
    url: XAI_IMAGES_GENERATIONS_URL,
    model: payload.model,
    n: payload.n,
  });
  let response;
  try {
    response = await fetchImpl(XAI_IMAGES_GENERATIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: combined.signal,
    });
  } catch (err) {
    if (combined.signal.aborted || err?.name === "AbortError" || err?.code === "ABORT_ERR") {
      throw abortError(combined.signal);
    }
    throw imageError(502, redactSecrets(err?.message || "xAI image generation network error", [secret]));
  } finally {
    combined.cleanup();
  }
  const rawText = await response.text();
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
  const row = asObject(parsed)?.data?.[0] || asObject(parsed)?.data || asObject(parsed);
  const b64 = trimKey(row?.b64_json) || trimKey(row?.b64);
  if (!b64) throw imageError(502, "xAI image generation returned no b64 image");
  if (b64.length > MAX_B64_CHARS) throw imageError(502, "xAI image generation payload is too large");
  let bytes;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    throw imageError(502, "xAI image generation returned invalid b64");
  }
  if (!bytes.length) throw imageError(502, "xAI image generation returned empty image");
  return {
    bytes,
    b64,
    mimeType: mimeFromResponse(row, ""),
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
 */
export async function generateCampaignPortrait({
  workspace,
  campaignId,
  prompt,
  outputPath,
  aspectRatio,
  model,
  signal,
  timeoutMs,
  env = process.env,
  agentDir,
  fetchImpl,
  now,
  log = defaultLog,
} = {}) {
  const resolved = resolvePortraitOutputPath({ workspace, campaignId, outputPath });
  const { token, source } = resolveXaiToken({ env, agentDir, now });
  if (!token) throw imageError(401, "xAI API key is not configured");
  log("xai_image_generate", {
    campaign_id: campaignId,
    token_source: source,
    output_dir: path.dirname(resolved),
  });
  const image = await requestXaiImageGeneration({
    prompt,
    token,
    model,
    aspectRatio,
    signal,
    timeoutMs,
    fetchImpl,
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
  };
}

export async function runGeneratePortraitHttp(opts) {
  const parsed = parseGeneratePortraitBody(opts.body);
  return generateCampaignPortrait({ ...opts, ...parsed });
}
