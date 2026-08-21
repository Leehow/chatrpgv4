/**
 * Shared abort/timeout/poll/download helpers for async portrait APIs.
 * Never logs tokens or result-URL query strings.
 */
import { redactSecrets, XaiImageError } from "./xai-image.mjs";

export const DEFAULT_POLL_INTERVAL_MS = 3000;
export const DEFAULT_ASYNC_TIMEOUT_MS = 120_000;
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

function trimStr(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function imageError(status, message, code) {
  return new XaiImageError(message, { status, code });
}

export function abortImageError() {
  return imageError(499, "图像生成已取消", "ABORTED");
}

export function timeoutImageError() {
  return imageError(504, "图像生成超时，请稍后重试。", "ETIMEDOUT");
}

export function redactResultUrl(url) {
  const raw = trimStr(url);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.search) parsed.search = "?[redacted]";
    if (parsed.hash) parsed.hash = "";
    return parsed.toString();
  } catch {
    return raw.split("?")[0] || "[url]";
  }
}

export function safeErrorText(text, secrets = []) {
  return redactSecrets(redactResultUrl(String(text ?? "")), secrets).slice(0, 300);
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortImageError();
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortImageError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortImageError());
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchJson({
  fetchImpl = globalThis.fetch,
  url,
  method = "GET",
  headers = {},
  body,
  signal,
  secrets = [],
  label = "image API",
}) {
  throwIfAborted(signal);
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body,
      signal,
    });
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") throw abortImageError();
    throw imageError(502, `${label}网络错误`);
  }
  const rawText = await response.text();
  const redacted = safeErrorText(rawText, secrets);
  if (!response.ok) {
    const status = [401, 403, 429].includes(response.status)
      ? response.status
      : response.status >= 500
        ? response.status
        : 502;
    throw imageError(status, `${label}失败（HTTP ${response.status}）${redacted ? `：${redacted}` : ""}`);
  }
  if (!rawText.trim()) return {};
  try {
    return JSON.parse(rawText);
  } catch {
    throw imageError(502, `${label}返回了无效 JSON`);
  }
}

export async function downloadImageBytes({
  fetchImpl = globalThis.fetch,
  url,
  signal,
  secrets = [],
  extraHeaders = {},
}) {
  throwIfAborted(signal);
  const safe = redactResultUrl(url);
  let response;
  try {
    response = await fetchImpl(url, { method: "GET", headers: extraHeaders, signal });
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") throw abortImageError();
    throw imageError(502, `下载生成图片失败（${safe}）`);
  }
  if (!response.ok) {
    throw imageError(502, `下载生成图片失败（HTTP ${response.status}，${safe}）`);
  }
  const mime = String(response.headers?.get?.("content-type") || "image/png").split(";")[0].trim();
  let buffer;
  if (typeof response.arrayBuffer === "function") {
    buffer = Buffer.from(await response.arrayBuffer());
  } else if (typeof response.buffer === "function") {
    buffer = Buffer.from(await response.buffer());
  } else {
    const text = await response.text();
    buffer = Buffer.from(text);
  }
  if (!buffer.length) throw imageError(502, "下载的图片为空");
  if (buffer.length > MAX_DOWNLOAD_BYTES) throw imageError(502, "下载的图片过大");
  void secrets;
  return { bytes: buffer, mimeType: mime.startsWith("image/") ? mime : "image/png" };
}

export async function pollUntil({
  signal,
  timeoutMs = DEFAULT_ASYNC_TIMEOUT_MS,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  sleepFn = sleep,
  now = Date.now,
  tick,
  label = "图像任务",
}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    throwIfAborted(signal);
    const result = await tick();
    if (result) return result;
    if (now() >= deadline) throw timeoutImageError();
    const wait = Math.min(intervalMs, Math.max(0, deadline - now()));
    await sleepFn(wait, signal);
    void label;
  }
}
