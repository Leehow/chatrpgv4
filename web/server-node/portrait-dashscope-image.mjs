/**
 * Alibaba Bailian / DashScope async image generation.
 * Modern: /api/v1/services/aigc/image-generation/generation (messages)
 * Legacy: /api/v1/services/aigc/text2image/image-synthesis (prompt)
 * Then GET /api/v1/tasks/{task_id}. No SDK.
 */
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

export const DASHSCOPE_DEFAULT_BASE = "https://dashscope.aliyuncs.com";
export const DASHSCOPE_MODERN_SIZE = "800*1200";
export const DASHSCOPE_LEGACY_SIZE = "768*1280";

function trimStr(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

export function isDashScopeImageProvider({ providerId, baseUrl } = {}) {
  const id = trimStr(providerId).toLowerCase();
  const host = trimStr(baseUrl).toLowerCase();
  if (id === "bailian" || id === "aliyun" || id === "dashscope") return true;
  return /dashscope(?:-intl)?\.aliyuncs\.com/i.test(host) || host.includes(".maas.aliyuncs.com");
}

export function dashScopeApiRoot(baseUrl) {
  const raw = trimStr(baseUrl) || DASHSCOPE_DEFAULT_BASE;
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    url = new URL(DASHSCOPE_DEFAULT_BASE);
  }
  let path = url.pathname.replace(/\/+$/, "") || "";
  if (path === "/" || path === "") path = "";
  if (/\/api\/v1$/i.test(path)) {
    return `${url.origin}${path}`;
  }
  if (/\/api$/i.test(path)) {
    return `${url.origin}${path}/v1`;
  }
  return `${url.origin}${path}/api/v1`;
}

export function dashScopeImageMode(model) {
  const m = trimStr(model).toLowerCase();
  if (/qwen-image-3/.test(m) || /wan2[.-]?6/.test(m) || /wan2[.-]?7/.test(m)) {
    return "generation";
  }
  if (
    /qwen-image-plus/.test(m)
    || /(^|[^a-z0-9])qwen-image($|[^a-z0-9])/.test(` ${m} `)
    || /wan2[.-]?5/.test(m)
    || /wanx/.test(m)
  ) {
    return "synthesis";
  }
  return "generation";
}

export function dashScopeSubmitUrl(baseUrl, model) {
  const root = dashScopeApiRoot(baseUrl);
  const mode = dashScopeImageMode(model);
  if (mode === "synthesis") {
    return `${root}/services/aigc/text2image/image-synthesis`;
  }
  return `${root}/services/aigc/image-generation/generation`;
}

export function dashScopeTaskUrl(baseUrl, taskId) {
  return `${dashScopeApiRoot(baseUrl)}/tasks/${encodeURIComponent(taskId)}`;
}

export function dashScopeSubmitBody(model, prompt) {
  const mode = dashScopeImageMode(model);
  if (mode === "synthesis") {
    return {
      model: trimStr(model),
      input: { prompt: String(prompt ?? "") },
      parameters: {
        n: 1,
        watermark: false,
        size: DASHSCOPE_LEGACY_SIZE,
      },
    };
  }
  return {
    model: trimStr(model),
    input: {
      messages: [
        {
          role: "user",
          content: [{ text: String(prompt ?? "") }],
        },
      ],
    },
    parameters: {
      n: 1,
      watermark: false,
      size: DASHSCOPE_MODERN_SIZE,
    },
  };
}

function taskIdFrom(body) {
  const root = asObject(body) || {};
  const output = asObject(root.output) || {};
  return trimStr(output.task_id || output.taskId || root.task_id || root.taskId);
}

function taskStatusFrom(body) {
  const root = asObject(body) || {};
  const output = asObject(root.output) || {};
  return trimStr(output.task_status || output.taskStatus || root.task_status).toUpperCase();
}

export function dashScopeResultUrl(body) {
  const root = asObject(body) || {};
  const output = asObject(root.output) || {};
  const choices = Array.isArray(output.choices) ? output.choices : [];
  for (const choice of choices) {
    const message = asObject(choice?.message) || {};
    const content = Array.isArray(message.content) ? message.content : [];
    for (const part of content) {
      const image = trimStr(part?.image || part?.image_url || part?.url);
      if (image) return image;
    }
  }
  const results = Array.isArray(output.results) ? output.results : [];
  for (const row of results) {
    const image = trimStr(row?.url || row?.image);
    if (image) return image;
  }
  return "";
}

export async function requestDashScopeImageGeneration({
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
} = {}) {
  const secret = trimStr(token);
  if (!secret) throw imageError(401, "阿里云百炼图像生成密钥未配置");
  const secrets = [secret];
  const headers = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-DashScope-Async": "enable",
  };
  const submitted = await fetchJson({
    fetchImpl,
    url: dashScopeSubmitUrl(baseUrl, model),
    method: "POST",
    headers,
    body: JSON.stringify(dashScopeSubmitBody(model, prompt)),
    signal,
    secrets,
    label: "百炼创建任务",
  });
  const taskId = taskIdFrom(submitted);
  if (!taskId) throw imageError(502, "百炼未返回 task_id");

  const polled = await pollUntil({
    signal,
    timeoutMs,
    intervalMs,
    sleepFn,
    now,
    label: "百炼",
    tick: async () => {
      const row = await fetchJson({
        fetchImpl,
        url: dashScopeTaskUrl(baseUrl, taskId),
        method: "GET",
        headers: {
          Authorization: `Bearer ${secret}`,
          Accept: "application/json",
        },
        signal,
        secrets,
        label: "百炼查询任务",
      });
      const status = taskStatusFrom(row);
      if (status === "SUCCEEDED") return row;
      if (status === "FAILED" || status === "UNKNOWN" || status === "CANCELED" || status === "CANCELLED") {
        const detail = safeErrorText(row?.output?.message || row?.message || status, secrets);
        throw imageError(502, `百炼图像生成失败（${status}）${detail ? `：${detail}` : ""}`);
      }
      return null;
    },
  });

  const resultUrl = dashScopeResultUrl(polled);
  if (!resultUrl) throw imageError(502, "百炼完成但缺少图片 URL");
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
