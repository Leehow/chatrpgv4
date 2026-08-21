import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_XAI_IMAGE_MODEL,
  XaiImageError,
} from "../xai-image.mjs";
import {
  GOOGLE_DEFAULT_BASE_URL,
  PORTRAIT_FAMILY_GOOGLE,
  PORTRAIT_FAMILY_OPENAI,
  PORTRAIT_FAMILY_UNSUPPORTED,
  PORTRAIT_FAMILY_XAI,
  classifyPortraitImageFamily,
  generatePortraitBytes,
  googleGenerateContentUrl,
  openaiImagesGenerationsUrl,
  requestGoogleImageGeneration,
  requestOpenAIImageGeneration,
  resolvePortraitImageRoute,
} from "../portrait-image-route.mjs";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

test("classify: xai / openai-compatible / google / unsupported", () => {
  assert.equal(classifyPortraitImageFamily({ providerId: "xai" }), PORTRAIT_FAMILY_XAI);
  assert.equal(
    classifyPortraitImageFamily({ providerId: "openai", api: "openai-completions" }),
    PORTRAIT_FAMILY_OPENAI,
  );
  assert.equal(
    classifyPortraitImageFamily({
      providerId: "acme",
      api: "openai-completions",
      baseUrl: "https://api.acme.test/v1",
    }),
    PORTRAIT_FAMILY_OPENAI,
  );
  assert.equal(classifyPortraitImageFamily({ providerId: "google" }), PORTRAIT_FAMILY_GOOGLE);
  assert.equal(
    classifyPortraitImageFamily({ providerId: "anthropic" }),
    PORTRAIT_FAMILY_UNSUPPORTED,
  );
  assert.equal(
    classifyPortraitImageFamily({ providerId: "openai-codex", api: "openai-codex-responses" }),
    PORTRAIT_FAMILY_UNSUPPORTED,
  );
});

test("xAI keeper bypasses settings and ignores client provider/model", () => {
  const route = resolvePortraitImageRoute({
    prefs: {
      provider: "xai",
      model: "grok-4.6",
      portraitImageProvider: "openai",
      portraitImageModel: "gpt-image-1",
    },
    clientBody: { provider: "google", model: "gemini-2.5-flash" },
  });
  assert.deepEqual(route, {
    family: PORTRAIT_FAMILY_XAI,
    provider: "xai",
    model: DEFAULT_XAI_IMAGE_MODEL,
    bypass: true,
  });
});

test("non-xAI keeper requires a selected image model", () => {
  assert.throws(
    () => resolvePortraitImageRoute({ prefs: { provider: "openai", model: "gpt-4.1" } }),
    (err) => err instanceof XaiImageError && /请在设置中选择图像生成模型/.test(err.message),
  );
});

test("non-xAI keeper uses selected OpenAI-compatible provider/model", () => {
  const agentDir = tempDir("coc-portrait-route-oai-");
  try {
    fs.writeFileSync(
      path.join(agentDir, "auth.json"),
      JSON.stringify({ openai: { type: "api_key", key: "sk-test-openai-key-xxxx" } }),
    );
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          openai: {
            name: "OpenAI",
            api: "openai-completions",
            baseUrl: "https://api.openai.com/v1",
            models: [{ id: "gpt-image-1" }],
          },
        },
      }),
    );
    const route = resolvePortraitImageRoute({
      prefs: {
        provider: "openai",
        model: "gpt-4.1",
        portraitImageProvider: "openai",
        portraitImageModel: "gpt-image-1",
      },
      clientBody: { provider: "xai", model: "grok-imagine-image-2.0" },
      agentDir,
    });
    assert.equal(route.family, PORTRAIT_FAMILY_OPENAI);
    assert.equal(route.provider, "openai");
    assert.equal(route.model, "gpt-image-1");
    assert.equal(route.baseUrl, "https://api.openai.com/v1");
    assert.equal(route.token, "sk-test-openai-key-xxxx");
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("unsupported provider is Chinese and does not become xAI", () => {
  try {
    resolvePortraitImageRoute({
      prefs: {
        provider: "anthropic",
        portraitImageProvider: "anthropic",
        portraitImageModel: "claude-opus",
      },
    });
    assert.fail("expected throw");
  } catch (err) {
    assert.equal(err instanceof XaiImageError, true);
    assert.match(err.message, /暂不支持图像生成/);
    assert.equal(err.message.includes("xAI"), false);
    assert.equal(err.message.includes("grok-imagine"), false);
  }
});

test("OpenAI images mock writes b64 without using xAI URL", async () => {
  const calls = [];
  const result = await requestOpenAIImageGeneration({
    prompt: "a bust portrait",
    token: "sk-test",
    model: "gpt-image-1",
    baseUrl: "https://api.openai.com/v1",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ data: [{ b64_json: PNG_B64 }] });
        },
      };
    },
  });
  assert.equal(calls[0].url, "https://api.openai.com/v1/images/generations");
  assert.equal(JSON.parse(calls[0].init.body).model, "gpt-image-1");
  assert.equal(JSON.parse(calls[0].init.body).n, 1);
  assert.deepEqual(result.bytes, Buffer.from(PNG_B64, "base64"));
  assert.equal(openaiImagesGenerationsUrl("https://api.openai.com/v1"), calls[0].url);
});

test("Google generateContent mock uses official URL and API key header", async () => {
  const calls = [];
  const result = await requestGoogleImageGeneration({
    prompt: "a bust portrait",
    token: "google-key-xxxx",
    model: "gemini-2.5-flash-image",
    baseUrl: GOOGLE_DEFAULT_BASE_URL,
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_B64 } }] } }],
          });
        },
      };
    },
  });
  assert.equal(
    calls[0].url,
    googleGenerateContentUrl(GOOGLE_DEFAULT_BASE_URL, "gemini-2.5-flash-image"),
  );
  assert.equal(calls[0].headers["x-goog-api-key"], "google-key-xxxx");
  assert.deepEqual(result.bytes, Buffer.from(PNG_B64, "base64"));
});

test("Google without a safe official key is unsupported, not a silent xAI hop", () => {
  try {
    resolvePortraitImageRoute({
      prefs: {
        provider: "openai",
        portraitImageProvider: "google",
        portraitImageModel: "gemini-2.5-flash-image",
      },
      agentDir: tempDir("coc-portrait-route-nog-"),
    });
    assert.fail("expected throw");
  } catch (err) {
    assert.match(String(err.message), /无法安全取得官方图像生成/);
    assert.equal(String(err.message).includes("grok-imagine"), false);
  }
});

test("generatePortraitBytes does not call xAI for OpenAI family", async () => {
  const calls = [];
  const bytes = await generatePortraitBytes({
    route: {
      family: PORTRAIT_FAMILY_OPENAI,
      provider: "openai",
      model: "gpt-image-1",
      token: "sk-test",
      baseUrl: "https://api.openai.com/v1",
    },
    prompt: "look",
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ data: [{ b64_json: PNG_B64 }] });
        },
      };
    },
  });
  assert.equal(calls[0].includes("api.x.ai"), false);
  assert.equal(calls[0].includes("openai.com"), true);
  assert.equal(bytes.model, "gpt-image-1");
});

test("generatePortraitBytes xAI uses host relay instead of OAuth official", async () => {
  const calls = [];
  const result = await generatePortraitBytes({
    route: {
      family: PORTRAIT_FAMILY_XAI,
      provider: "xai",
      model: DEFAULT_XAI_IMAGE_MODEL,
    },
    prompt: "look",
    env: { PIPIUI_GROK_RELAY: "http://127.0.0.1:18891/v1" },
    probeImpl: () => true,
    fetchImpl: async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ data: [{ b64_json: PNG_B64 }] });
        },
      };
    },
  });
  assert.equal(calls[0].url, "http://127.0.0.1:18891/v1/images/generations");
  assert.equal(calls[0].auth, "Bearer local");
  assert.equal(result.model, "grok-imagine-image-quality");
});
