/**
 * JellyToken async image generation: POST /api/ai/tasks then poll GET.
 * Official host: aiservice.jellytoken.com. No SDK.
 */
import { isJellyTokenGateway } from "./known-thinking.mjs";
import {
  DEFAULT_ASYNC_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  downloadImageBytes,
  fetchJson,
  imageError,
  pollUntil,
  redactResultUrl,
  safeErrorText,
} from "./portrait-async-image.mjs";

export const JELLYTOKEN_DEFAULT_BASE = "https://aiservice.jellytoken.com";

function trimStr(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isJellyTokenImageProvider({ providerId, baseUrl } = {}) {
  return isJellyTokenGateway({ providerId: trimStr(providerId).toLowerCase(), baseUrl });
}

export function jellyTokenApiRoot(baseUrl) {
  const raw = trimStr(baseUrl) || JELLYTOKEN_DEFAULT_BASE;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    return `${url.protocol}//${url.host}`;
  } catch {
    return JELLYTOKEN_DEFAULT_BASE;
  }
}

export function jellyTokenSubmitUrl(baseUrl) {
  return `${jellyTokenApiRoot(baseUrl)}/api/ai/tasks`;
}

export function jellyTokenPollUrl(baseUrl, taskId) {
  return `${jellyTokenApiRoot(baseUrl)}/api/ai/tasks/${encodeURIComponent(taskId)}`;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function taskIdFrom(body) {
  const root = asObject(body) || {};
  const data = asObject(root.data) || {};
  return trimStr(root.taskId || root.task_id || root.id || data.taskId || data.task_id || data.id);
}

function statusFrom(body) {
  const root = asObject(body) || {};
  const data = asObject(root.data) || {};
  return trimStr(root.status || root.state || data.status || data.state).toLowerCase();
}

function resultUrlFrom(body) {
  const root = asObject(body) || {};
  const data = asObject(root.data) || {};
  return trimStr(root.resultUrlPublic || root.result_url_public || data.resultUrlPublic || data.result_url_public);
}

export async function requestJellyTokenImageGeneration({
  prompt,
  token,
  model,
  baseUrl,
  signal,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_ASYNC_TIMEOUT_MS,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  sleepFn,
  now,
  callbackId,
} = {}) {
  const secret = trimStr(token);
  if (!secret) throw imageError(401, "JellyToken 图像生成密钥未配置");
  const secrets = [secret];
  const headers = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const submitId = trimStr(callbackId) || `portrait-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const submitted = await fetchJson({
    fetchImpl,
    url: jellyTokenSubmitUrl(baseUrl),
    method: "POST",
    headers,
    body: JSON.stringify({
      modelKey: trimStr(model),
      callbackId: submitId,
      imageParams: {
        prompt: String(prompt ?? ""),
        aspectRatio: "2:3",
        resolution: "2k",
      },
    }),
    signal,
    secrets,
    label: "JellyToken 创建任务",
  });
  const taskId = taskIdFrom(submitted);
  if (!taskId) throw imageError(502, "JellyToken 未返回 taskId");

  const polled = await pollUntil({
    signal,
    timeoutMs,
    intervalMs,
    sleepFn,
    now,
    label: "JellyToken",
    tick: async () => {
      const row = await fetchJson({
        fetchImpl,
        url: jellyTokenPollUrl(baseUrl, taskId),
        method: "GET",
        headers,
        signal,
        secrets,
        label: "JellyToken 查询任务",
      });
      const status = statusFrom(row);
      if (status === "completed") return row;
      if (status === "failed" || status === "cancelled") {
        const detail = safeErrorText(row?.error || row?.message || status, secrets);
        throw imageError(
          502,
          `JellyToken 图像生成${status === "cancelled" ? "已取消" : "失败"}${detail ? `：${detail}` : ""}`,
        );
      }
      return null;
    },
  });

  const resultUrl = resultUrlFrom(polled);
  if (!resultUrl) throw imageError(502, "JellyToken 完成但缺少 resultUrlPublic");
  const downloaded = await downloadImageBytes({
    fetchImpl,
    url: resultUrl,
    signal,
    secrets,
  });
  return {
    bytes: downloaded.bytes,
    mimeType: downloaded.mimeType,
    model: trimStr(model),
    sourceUrl: redactResultUrl(resultUrl),
  };
}
