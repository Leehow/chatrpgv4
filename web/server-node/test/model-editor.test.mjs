import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defaultDesktopUserData } from "../agent-dir.mjs";
import {
  FEATURED_OAUTH,
  FEATURED_PRESETS,
  getModelEditorState,
  resolveSettingsPath,
  saveApiKeyProvider,
  saveModelEditorList,
} from "../model-editor.mjs";
import {
  duplicatedFeaturedIds,
  isFeaturedRowShown,
  toggleFeaturedRow,
} from "../provider-visibility.mjs";

const fakeCatalog = [
  { id: "google", label: "Google", note: "Pi 内置 · API Key", methods: ["api_key"], baseUrl: "" },
  { id: "openrouter", label: "OpenRouter", note: "Pi 内置 · 订阅登录或 API Key", methods: ["oauth", "api_key"], baseUrl: "" },
];

async function listCatalog() {
  return fakeCatalog;
}

test("settings path stays on the desktop userData layout, never ~/.pi/agent", () => {
  assert.equal(resolveSettingsPath({ agentDir: path.join(os.homedir(), ".pi", "agent") }), null);
  assert.equal(
    resolveSettingsPath({}),
    path.join(defaultDesktopUserData(), "coc-desktop-settings.json"),
  );
  const userData = "/tmp/coc-user-data";
  assert.equal(
    resolveSettingsPath({ userData }),
    path.join(userData, "coc-desktop-settings.json"),
  );
  const agentDir = path.join(userData, "pi-agent");
  assert.equal(
    resolveSettingsPath({ agentDir }),
    path.join(userData, "coc-desktop-settings.json"),
  );
  assert.equal(
    resolveSettingsPath({ settingsPath: "/tmp/explicit.json", userData, agentDir }),
    "/tmp/explicit.json",
  );
});

test("get/save editor state writes hidden extras next to the app pi-agent dir", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coc-model-editor-"));
  const agentDir = path.join(root, "pi-agent");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        deepseek: { name: "DeepSeek", models: [{ id: "deepseek-v4-flash", name: "Flash" }] },
        relay: { name: "Relay", baseUrl: "https://relay.example/v1", models: [{ id: "gpt" }] },
      },
    }) + "\n",
  );
  fs.writeFileSync(
    path.join(agentDir, "auth.json"),
    JSON.stringify({ deepseek: { type: "api_key" } }) + "\n",
  );

  const first = await getModelEditorState({
    payloadRoot: root,
    agentDir,
    settingsPath: resolveSettingsPath({ agentDir }),
    listCatalog,
  });
  assert.equal(first.writable, true);
  assert.deepEqual(
    first.oauthProviders.map((p) => p.id),
    FEATURED_OAUTH.map((p) => p.id),
  );
  assert.deepEqual(
    first.presets.map((p) => p.id),
    FEATURED_PRESETS.map((p) => p.id),
  );
  assert.deepEqual(first.catalogProviders.map((p) => p.id), ["google", "openrouter"]);
  assert.equal(first.providers.find((p) => p.id === "deepseek")?.hasAuth, true);
  assert.equal(first.providers.find((p) => p.id === "relay")?.name, "Relay");
  assert.deepEqual(first.hiddenProviderIds, []);

  const saved = await saveModelEditorList(
    {
      hidden: ["zhipu"],
      extra: ["google"],
      custom: [{ id: "siliconflow", label: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1" }],
    },
    { payloadRoot: root, settingsPath: resolveSettingsPath({ agentDir }), listCatalog },
  );
  assert.equal(saved.ok, true);

  const again = await getModelEditorState({
    payloadRoot: root,
    agentDir,
    settingsPath: resolveSettingsPath({ agentDir }),
    listCatalog,
  });
  assert.deepEqual(again.hiddenProviderIds, ["zhipu"]);
  assert.deepEqual(again.extraProviderIds, ["google"]);
  assert.equal(again.customProviders[0].id, "siliconflow");

  const blocked = await saveModelEditorList(
    { hidden: [], extra: [], custom: [] },
    { payloadRoot: root, settingsPath: null, listCatalog },
  );
  assert.equal(blocked.ok, false);
  assert.match(blocked.errors[0], /桌面应用/);

  fs.rmSync(root, { recursive: true, force: true });
});

test("custom provider validation rejects builtin ids and bad URLs", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coc-model-editor-"));
  const settingsPath = path.join(root, "coc-desktop-settings.json");
  const clash = await saveModelEditorList(
    { hidden: [], extra: [], custom: [{ id: "anthropic", label: "X", baseUrl: "https://x.example" }] },
    { payloadRoot: root, settingsPath, listCatalog },
  );
  assert.equal(clash.ok, false);
  assert.match(clash.errors[0], /重复/);

  const badUrl = await saveModelEditorList(
    { hidden: [], extra: [], custom: [{ id: "mine", label: "Mine", baseUrl: "not-a-url" }] },
    { payloadRoot: root, settingsPath, listCatalog },
  );
  assert.equal(badUrl.ok, false);
  assert.match(badUrl.errors[0], /http/);

  fs.rmSync(root, { recursive: true, force: true });
});

function featuredDuplicated() {
  return duplicatedFeaturedIds(
    FEATURED_OAUTH.map((p) => p.id),
    FEATURED_PRESETS.map((p) => p.id).filter(Boolean),
  );
}

test("xai oauth and api key cards hide independently", () => {
  const duplicated = featuredDuplicated();
  assert.equal(duplicated.has("xai"), true);
  assert.equal(isFeaturedRowShown("oauth", "xai", [], duplicated), true);
  assert.equal(isFeaturedRowShown("api_key", "xai", [], duplicated), true);

  const onlyOauth = toggleFeaturedRow("oauth", "xai", [], duplicated);
  assert.equal(isFeaturedRowShown("oauth", "xai", onlyOauth, duplicated), false);
  assert.equal(isFeaturedRowShown("api_key", "xai", onlyOauth, duplicated), true);
  assert.equal(onlyOauth.has("xai"), false);

  const both = toggleFeaturedRow("api_key", "xai", onlyOauth, duplicated);
  assert.equal(isFeaturedRowShown("oauth", "xai", both, duplicated), false);
  assert.equal(isFeaturedRowShown("api_key", "xai", both, duplicated), false);
  assert.equal(both.has("xai"), true);
});

test("legacy hidden xai hides both cards until one is turned back on", () => {
  const duplicated = featuredDuplicated();
  const legacy = new Set(["xai"]);
  assert.equal(isFeaturedRowShown("oauth", "xai", legacy, duplicated), false);
  assert.equal(isFeaturedRowShown("api_key", "xai", legacy, duplicated), false);

  const afterOauthOn = toggleFeaturedRow("oauth", "xai", legacy, duplicated);
  assert.equal(isFeaturedRowShown("oauth", "xai", afterOauthOn, duplicated), true);
  assert.equal(isFeaturedRowShown("api_key", "xai", afterOauthOn, duplicated), false);
  assert.equal(afterOauthOn.has("xai"), false);
});

test("non-duplicated featured cards still hide by provider id", () => {
  const duplicated = featuredDuplicated();
  assert.equal(duplicated.has("anthropic"), false);
  const next = toggleFeaturedRow("oauth", "anthropic", [], duplicated);
  assert.equal(next.has("anthropic"), true);
  assert.equal(isFeaturedRowShown("oauth", "anthropic", next, duplicated), false);
});

test("save keeps xai on the model menu when only one method card is hidden", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coc-model-editor-"));
  const settingsPath = path.join(root, "coc-desktop-settings.json");
  const saved = await saveModelEditorList(
    { hidden: ["oauth-xai"], extra: [], custom: [] },
    { payloadRoot: root, settingsPath, listCatalog },
  );
  assert.equal(saved.ok, true);
  assert.ok(saved.hidden.includes("oauth-xai"));
  assert.equal(saved.hidden.includes("xai"), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("saveApiKeyProvider writes auth and models into the desktop agent dir", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coc-api-key-"));
  const agentDir = path.join(root, "pi-agent");
  const saved = await saveApiKeyProvider(agentDir, { id: "deepseek", apiKey: "sk-test" });
  assert.equal(saved.ok, true);
  const auth = JSON.parse(fs.readFileSync(path.join(agentDir, "auth.json"), "utf8"));
  assert.equal(auth.deepseek.type, "api_key");
  assert.equal(auth.deepseek.key, "sk-test");
  const models = JSON.parse(fs.readFileSync(path.join(agentDir, "models.json"), "utf8"));
  assert.equal(models.providers.deepseek.baseUrl, "https://api.deepseek.com");
  assert.ok(models.providers.deepseek.models.some((m) => m.id === "deepseek-v4-flash"));
  const empty = await saveApiKeyProvider(agentDir, { id: "deepseek", apiKey: "  " });
  assert.equal(empty.ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("saveApiKeyProvider fetches OpenAI-style /models when no model ID is given", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coc-api-key-fetch-"));
  const agentDir = path.join(root, "pi-agent");
  const calls = [];
  const saved = await saveApiKeyProvider(
    agentDir,
    { id: "acme", apiKey: "sk-secret", label: "Acme", baseUrl: "https://api.acme.test" },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, auth: init?.headers?.Authorization });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: "acme-chat" },
              { id: "text-embedding-3-small" },
              { id: "dall-e-3-image" },
            ],
          }),
        };
      },
    },
  );
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.models, ["acme-chat"]);
  assert.equal(calls[0].url, "https://api.acme.test/models");
  assert.equal(calls[0].auth, "Bearer sk-secret");
  const failed = await saveApiKeyProvider(
    agentDir,
    { id: "other", apiKey: "sk-secret", label: "Other", baseUrl: "https://api.other.test" },
    {
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    },
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.errors[0], "至少需要一个模型 ID");
  assert.ok(!JSON.stringify(failed).includes("sk-secret"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("save adds xai to hidden when both method cards are hidden", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coc-model-editor-"));
  const settingsPath = path.join(root, "coc-desktop-settings.json");
  const saved = await saveModelEditorList(
    { hidden: ["oauth-xai", "api-xai"], extra: [], custom: [] },
    { payloadRoot: root, settingsPath, listCatalog },
  );
  assert.equal(saved.ok, true);
  assert.ok(saved.hidden.includes("xai"));
  assert.ok(saved.hidden.includes("oauth-xai"));
  assert.ok(saved.hidden.includes("api-xai"));
  fs.rmSync(root, { recursive: true, force: true });
});
