import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { XaiImageError } from "../xai-image.mjs";
import {
  PORTRAIT_FAMILY_DASHSCOPE,
  PORTRAIT_FAMILY_JELLYTOKEN,
  PORTRAIT_FAMILY_OPENAI,
  classifyPortraitImageFamily,
  generatePortraitBytes,
  resolvePortraitImageRoute,
} from "../portrait-image-route.mjs";
import {
  dashScopeApiRoot,
  dashScopeImageMode,
  dashScopeSubmitBody,
  dashScopeSubmitUrl,
  dashScopeTaskUrl,
  requestDashScopeImageGeneration,
} from "../portrait-dashscope-image.mjs";
import {
  jellyTokenApiRoot,
  jellyTokenPollUrl,
  jellyTokenSubmitUrl,
  requestJellyTokenImageGeneration,
} from "../portrait-jellytoken-image.mjs";
import { redactResultUrl } from "../portrait-async-image.mjs";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const SECRET_JT = "uas_test_secret_value_do_not_leak";
const SECRET_DS = "sk-dashscope-secret-value-xxxx";
const SIGNED = "https://cdn.example/out.png?OSSAccessKeyId=AKIATEST&Expires=9&Signature=secret-sig";

function jsonOk(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    async text() {
      return JSON.stringify(body);
    },
    async arrayBuffer() {
      return Buffer.alloc(0);
    },
  };
}

function bytesOk(bytes = PNG_BYTES) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "image/png" },
    async arrayBuffer() {
      return bytes;
    },
    async text() {
      return "";
    },
  };
}

test("jellytoken wins over openai-completions classification", () => {
  assert.equal(
    classifyPortraitImageFamily({
      providerId: "jellytoken",
      api: "openai-completions",
      baseUrl: "https://aiservice.jellytoken.com/v1",
    }),
    PORTRAIT_FAMILY_JELLYTOKEN,
  );
  assert.equal(
    classifyPortraitImageFamily({
      providerId: "custom-jt",
      api: "openai-completions",
      baseUrl: "https://aiservice.jellytoken.com",
    }),
    PORTRAIT_FAMILY_JELLYTOKEN,
  );
  assert.equal(
    classifyPortraitImageFamily({
      providerId: "openai",
      api: "openai-completions",
    }),
    PORTRAIT_FAMILY_OPENAI,
  );
});

test("dashscope/bailian/maas classification", () => {
  assert.equal(classifyPortraitImageFamily({ providerId: "bailian" }), PORTRAIT_FAMILY_DASHSCOPE);
  assert.equal(classifyPortraitImageFamily({ providerId: "aliyun" }), PORTRAIT_FAMILY_DASHSCOPE);
  assert.equal(classifyPortraitImageFamily({ providerId: "dashscope" }), PORTRAIT_FAMILY_DASHSCOPE);
  assert.equal(
    classifyPortraitImageFamily({
      providerId: "workspace-qwen",
      baseUrl: "https://dashscope-intl.aliyuncs.com/api/v1",
    }),
    PORTRAIT_FAMILY_DASHSCOPE,
  );
  assert.equal(
    classifyPortraitImageFamily({
      providerId: "maas",
      baseUrl: "https://ws-123.maas.aliyuncs.com",
    }),
    PORTRAIT_FAMILY_DASHSCOPE,
  );
});

test("jellytoken and dashscope baseUrl normalization", () => {
  assert.equal(jellyTokenApiRoot("https://aiservice.jellytoken.com/v1"), "https://aiservice.jellytoken.com");
  assert.equal(jellyTokenSubmitUrl("https://aiservice.jellytoken.com/v1"), "https://aiservice.jellytoken.com/api/ai/tasks");
  assert.equal(
    jellyTokenPollUrl("https://aiservice.jellytoken.com", "t1"),
    "https://aiservice.jellytoken.com/api/ai/tasks/t1",
  );
  assert.equal(dashScopeApiRoot("https://dashscope.aliyuncs.com"), "https://dashscope.aliyuncs.com/api/v1");
  assert.equal(dashScopeApiRoot("https://dashscope.aliyuncs.com/api/v1"), "https://dashscope.aliyuncs.com/api/v1");
  assert.equal(dashScopeApiRoot("https://dashscope.aliyuncs.com/api/v1/"), "https://dashscope.aliyuncs.com/api/v1");
  assert.equal(
    dashScopeApiRoot("https://abc.maas.aliyuncs.com"),
    "https://abc.maas.aliyuncs.com/api/v1",
  );
  assert.equal(
    dashScopeSubmitUrl("https://dashscope.aliyuncs.com/api/v1", "qwen-image-3.0"),
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation",
  );
  assert.equal(
    dashScopeSubmitUrl("https://dashscope.aliyuncs.com", "qwen-image-plus"),
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
  );
  assert.equal(
    dashScopeTaskUrl("https://dashscope.aliyuncs.com/api/v1", "tid"),
    "https://dashscope.aliyuncs.com/api/v1/tasks/tid",
  );
});

test("dashscope modern vs legacy model routing and 2:3 sizes", () => {
  assert.equal(dashScopeImageMode("qwen-image-3.0"), "generation");
  assert.equal(dashScopeImageMode("wan2.6-t2i"), "generation");
  assert.equal(dashScopeImageMode("wan2.7"), "generation");
  assert.equal(dashScopeImageMode("qwen-image"), "synthesis");
  assert.equal(dashScopeImageMode("qwen-image-plus"), "synthesis");
  assert.equal(dashScopeImageMode("wan2.5-t2i"), "synthesis");
  assert.equal(dashScopeImageMode("wanx-v1"), "synthesis");
  const modern = dashScopeSubmitBody("qwen-image-3.0", "a look");
  assert.equal(modern.parameters.n, 1);
  assert.equal(modern.parameters.watermark, false);
  assert.equal(modern.parameters.size, "800*1200");
  assert.equal(modern.input.messages[0].content[0].text, "a look");
  const legacy = dashScopeSubmitBody("qwen-image-plus", "a look");
  assert.equal(legacy.input.prompt, "a look");
  assert.equal(legacy.parameters.size, "768*1280");
  assert.equal(legacy.parameters.n, 1);
  assert.equal(legacy.parameters.watermark, false);
});

test("JellyToken submit/poll/download", async () => {
  const calls = [];
  const result = await requestJellyTokenImageGeneration({
    prompt: "bust",
    token: SECRET_JT,
    model: "flux-portrait",
    baseUrl: "https://aiservice.jellytoken.com/v1",
    callbackId: "cb-1",
    intervalMs: 0,
    timeoutMs: 5_000,
    sleepFn: async () => {},
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body, headers: init.headers });
      if (init.method === "POST") {
        const body = JSON.parse(init.body);
        assert.equal(body.modelKey, "flux-portrait");
        assert.equal(body.callbackId, "cb-1");
        assert.equal(body.imageParams.aspectRatio, "2:3");
        assert.equal(body.imageParams.resolution, "2k");
        assert.equal(init.headers.Authorization, `Bearer ${SECRET_JT}`);
        return jsonOk({ taskId: "jt-1" });
      }
      if (String(url).endsWith("/api/ai/tasks/jt-1")) {
        return jsonOk({ status: "completed", resultUrlPublic: SIGNED });
      }
      if (String(url).startsWith("https://cdn.example/out.png")) {
        return bytesOk();
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  assert.deepEqual(result.bytes, PNG_BYTES);
  assert.equal(calls[0].url, "https://aiservice.jellytoken.com/api/ai/tasks");
  assert.equal(JSON.stringify(result).includes("OSSAccessKeyId"), false);
  assert.equal(JSON.stringify(result).includes(SECRET_JT), false);
});

test("JellyToken failed/cancelled/timeout/abort/redaction", async () => {
  await assert.rejects(
    () => requestJellyTokenImageGeneration({
      prompt: "x",
      token: SECRET_JT,
      model: "m",
      intervalMs: 0,
      timeoutMs: 5_000,
      sleepFn: async () => {},
      fetchImpl: async (url, init) => {
        if (init.method === "POST") return jsonOk({ taskId: "jt-fail" });
        return jsonOk({ status: "failed", error: `Bearer ${SECRET_JT} ${SIGNED}` });
      },
    }),
    (err) => {
      assert.equal(err instanceof XaiImageError, true);
      assert.equal(err.message.includes(SECRET_JT), false);
      assert.equal(err.message.includes("OSSAccessKeyId"), false);
      assert.match(err.message, /失败/);
      return true;
    },
  );

  await assert.rejects(
    () => requestJellyTokenImageGeneration({
      prompt: "x",
      token: SECRET_JT,
      model: "m",
      intervalMs: 0,
      timeoutMs: 5_000,
      sleepFn: async () => {},
      fetchImpl: async (_url, init) => {
        if (init.method === "POST") return jsonOk({ taskId: "jt-c" });
        return jsonOk({ status: "cancelled" });
      },
    }),
    /已取消/,
  );

  {
    let clock = 0;
    await assert.rejects(
      () => requestJellyTokenImageGeneration({
        prompt: "x",
        token: SECRET_JT,
        model: "m",
        intervalMs: 5,
        timeoutMs: 5,
        now: () => clock,
        sleepFn: async (ms) => {
          clock += ms || 5;
        },
        fetchImpl: async (_url, init) => {
          if (init.method === "POST") return jsonOk({ taskId: "jt-t" });
          return jsonOk({ status: "running" });
        },
      }),
      (err) => err.code === "ETIMEDOUT" || /超时/.test(err.message),
    );
  }

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => requestJellyTokenImageGeneration({
      prompt: "x",
      token: SECRET_JT,
      model: "m",
      signal: ac.signal,
      fetchImpl: async () => jsonOk({}),
    }),
    (err) => err.code === "ABORTED" || /取消/.test(err.message),
  );
});

test("Bailian modern submit/poll/download uses messages + generation path", async () => {
  const calls = [];
  const result = await requestDashScopeImageGeneration({
    prompt: "bust",
    token: SECRET_DS,
    model: "qwen-image-3.0",
    baseUrl: "https://dashscope.aliyuncs.com/api/v1",
    intervalMs: 0,
    timeoutMs: 5_000,
    sleepFn: async () => {},
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body, headers: init.headers });
      if (init.method === "POST") {
        assert.equal(init.headers["X-DashScope-Async"], "enable");
        assert.equal(init.headers.Authorization, `Bearer ${SECRET_DS}`);
        const body = JSON.parse(init.body);
        assert.equal(body.parameters.n, 1);
        assert.equal(body.parameters.watermark, false);
        assert.ok(body.input.messages);
        return jsonOk({ output: { task_id: "ds-1", task_status: "PENDING" } });
      }
      if (String(url).endsWith("/api/v1/tasks/ds-1")) {
        return jsonOk({
          output: {
            task_status: "SUCCEEDED",
            choices: [{ message: { content: [{ image: SIGNED }] } }],
          },
        });
      }
      return bytesOk();
    },
  });
  assert.equal(calls[0].url, "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation");
  assert.deepEqual(result.bytes, PNG_BYTES);
  assert.equal(JSON.stringify(result).includes("Signature="), false);
});

test("Bailian legacy submit uses prompt synthesis and results[].url", async () => {
  const calls = [];
  await requestDashScopeImageGeneration({
    prompt: "bust",
    token: SECRET_DS,
    model: "wanx-v1",
    baseUrl: "https://dashscope.aliyuncs.com",
    intervalMs: 0,
    timeoutMs: 5_000,
    sleepFn: async () => {},
    fetchImpl: async (url, init) => {
      calls.push(String(url));
      if (init.method === "POST") {
        const body = JSON.parse(init.body);
        assert.equal(body.input.prompt, "bust");
        assert.equal(body.parameters.size, "768*1280");
        return jsonOk({ output: { task_id: "ds-2" } });
      }
      if (String(url).includes("/tasks/ds-2")) {
        return jsonOk({ output: { task_status: "SUCCEEDED", results: [{ url: SIGNED }] } });
      }
      return bytesOk();
    },
  });
  assert.equal(calls[0], "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis");
});

test("Bailian FAILED/UNKNOWN/timeout/abort/redaction", async () => {
  await assert.rejects(
    () => requestDashScopeImageGeneration({
      prompt: "x",
      token: SECRET_DS,
      model: "qwen-image-3.0",
      intervalMs: 0,
      timeoutMs: 5_000,
      sleepFn: async () => {},
      fetchImpl: async (_url, init) => {
        if (init.method === "POST") return jsonOk({ output: { task_id: "bad" } });
        return jsonOk({
          output: { task_status: "FAILED", message: `key=${SECRET_DS} url=${SIGNED}` },
        });
      },
    }),
    (err) => {
      assert.match(err.message, /FAILED/);
      assert.equal(err.message.includes(SECRET_DS), false);
      assert.equal(err.message.includes("OSSAccessKeyId"), false);
      return true;
    },
  );

  await assert.rejects(
    () => requestDashScopeImageGeneration({
      prompt: "x",
      token: SECRET_DS,
      model: "qwen-image-3.0",
      intervalMs: 0,
      timeoutMs: 5_000,
      sleepFn: async () => {},
      fetchImpl: async (_url, init) => {
        if (init.method === "POST") return jsonOk({ output: { task_id: "u" } });
        return jsonOk({ output: { task_status: "UNKNOWN" } });
      },
    }),
    /UNKNOWN/,
  );

  {
    let clock = 0;
    await assert.rejects(
      () => requestDashScopeImageGeneration({
        prompt: "x",
        token: SECRET_DS,
        model: "qwen-image-3.0",
        intervalMs: 5,
        timeoutMs: 5,
        now: () => clock,
        sleepFn: async (ms) => {
          clock += ms || 5;
        },
        fetchImpl: async (_url, init) => {
          if (init.method === "POST") return jsonOk({ output: { task_id: "p" } });
          return jsonOk({ output: { task_status: "RUNNING" } });
        },
      }),
      (err) => err.code === "ETIMEDOUT" || /超时/.test(err.message),
    );
  }

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => requestDashScopeImageGeneration({
      prompt: "x",
      token: SECRET_DS,
      model: "qwen-image-3.0",
      signal: ac.signal,
      fetchImpl: async () => jsonOk({}),
    }),
    (err) => err.code === "ABORTED" || /取消/.test(err.message),
  );
});

test("redactResultUrl strips query secrets", () => {
  assert.equal(redactResultUrl(SIGNED).includes("OSSAccessKeyId"), false);
  assert.match(redactResultUrl(SIGNED), /cdn\.example\/out\.png/);
});

test("resolvePortraitImageRoute selects jellytoken and dashscope from prefs", () => {
  const jtDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-jt-route-"));
  const dsDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-ds-route-"));
  try {
    fs.writeFileSync(path.join(jtDir, "auth.json"), JSON.stringify({ jellytoken: { key: SECRET_JT } }));
    fs.writeFileSync(
      path.join(jtDir, "models.json"),
      JSON.stringify({
        providers: {
          jellytoken: { api: "openai-completions", baseUrl: "https://aiservice.jellytoken.com/v1" },
        },
      }),
    );
    const jt = resolvePortraitImageRoute({
      prefs: {
        provider: "openai",
        portraitImageProvider: "jellytoken",
        portraitImageModel: "flux-portrait",
      },
      clientBody: { provider: "xai", model: "grok-4.6" },
      agentDir: jtDir,
    });
    assert.equal(jt.family, PORTRAIT_FAMILY_JELLYTOKEN);
    assert.equal(jt.model, "flux-portrait");
    assert.equal(jt.token, SECRET_JT);

    fs.writeFileSync(path.join(dsDir, "auth.json"), JSON.stringify({ bailian: { key: SECRET_DS } }));
    fs.writeFileSync(
      path.join(dsDir, "models.json"),
      JSON.stringify({
        providers: { bailian: { baseUrl: "https://dashscope.aliyuncs.com/api/v1" } },
      }),
    );
    const ds = resolvePortraitImageRoute({
      prefs: {
        provider: "openai",
        portraitImageProvider: "bailian",
        portraitImageModel: "qwen-image-3.0",
      },
      agentDir: dsDir,
    });
    assert.equal(ds.family, PORTRAIT_FAMILY_DASHSCOPE);
    assert.equal(ds.model, "qwen-image-3.0");
  } finally {
    fs.rmSync(jtDir, { recursive: true, force: true });
    fs.rmSync(dsDir, { recursive: true, force: true });
  }
});

test("generatePortraitBytes jellytoken path never hits xAI", async () => {
  const urls = [];
  await generatePortraitBytes({
    route: {
      family: PORTRAIT_FAMILY_JELLYTOKEN,
      provider: "jellytoken",
      model: "flux-portrait",
      token: SECRET_JT,
      baseUrl: "https://aiservice.jellytoken.com",
    },
    prompt: "look",
    intervalMs: 0,
    timeoutMs: 5_000,
    sleepFn: async () => {},
    fetchImpl: async (url, init) => {
      urls.push(String(url));
      if (init.method === "POST") return jsonOk({ taskId: "z" });
      if (String(url).includes("/api/ai/tasks/z")) {
        return jsonOk({ status: "completed", resultUrlPublic: "https://cdn.example/a.png" });
      }
      return bytesOk();
    },
  });
  assert.equal(urls.some((u) => u.includes("api.x.ai")), false);
  assert.equal(urls[0], "https://aiservice.jellytoken.com/api/ai/tasks");
});
