import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extraApiKeyProviders,
  extraOauthProviders,
  isEditorRowShown,
  listPiCatalogProviders,
  loginProviderMeta,
  morePiProviders,
  serializePiProvider,
} from "./pi-catalog.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function fakeProvider(id, { name = id, oauth = false, apiKeyLogin = false } = {}) {
  return {
    id,
    name,
    baseUrl: `https://example.com/${id}`,
    auth: {
      ...(oauth ? { oauth: { name: `${id} oauth` } } : {}),
      ...(apiKeyLogin ? { apiKey: { name: `${id} key`, login: () => {} } } : {}),
    },
  };
}

describe("serializePiProvider", () => {
  it("keeps oauth and interactive api-key methods, drops ambient-only apiKey", () => {
    const both = serializePiProvider(fakeProvider("openrouter", { name: "OpenRouter", oauth: true, apiKeyLogin: true }));
    assert.equal(both.id, "openrouter");
    assert.equal(both.label, "OpenRouter");
    assert.deepEqual(both.methods, ["oauth", "api_key"]);
    assert.match(both.note, /Pi 内置/);

    const ambient = serializePiProvider({
      id: "amazon-bedrock",
      name: "Amazon Bedrock",
      auth: { apiKey: { name: "AWS", resolve: () => {} } },
    });
    assert.deepEqual(ambient.methods, []);
    assert.match(ambient.note, /环境凭据/);
  });
});

describe("morePiProviders", () => {
  it("drops featured ids and keeps the rest in catalog order", () => {
    const catalog = [
      serializePiProvider(fakeProvider("anthropic", { oauth: true })),
      serializePiProvider(fakeProvider("google", { apiKeyLogin: true })),
      serializePiProvider(fakeProvider("openrouter", { oauth: true })),
    ];
    const more = morePiProviders(catalog, new Set(["anthropic", "xai"]));
    assert.deepEqual(more.map((p) => p.id), ["google", "openrouter"]);
  });
});

describe("isEditorRowShown", () => {
  it("shows featured unless hidden; extras stay hidden until checked or already installed", () => {
    const featured = new Set(["anthropic"]);
    assert.equal(isEditorRowShown("anthropic", { featured, hidden: new Set(), extra: new Set(), installed: new Set() }), true);
    assert.equal(isEditorRowShown("anthropic", { featured, hidden: new Set(["anthropic"]), extra: new Set(), installed: new Set() }), false);
    assert.equal(isEditorRowShown("google", { featured, hidden: new Set(), extra: new Set(), installed: new Set() }), false);
    assert.equal(isEditorRowShown("google", { featured, hidden: new Set(), extra: new Set(["google"]), installed: new Set() }), true);
    assert.equal(isEditorRowShown("google", { featured, hidden: new Set(), extra: new Set(), installed: new Set(["google"]) }), true);
    assert.equal(isEditorRowShown("google", { featured, hidden: new Set(["google"]), extra: new Set(), installed: new Set(["google"]) }), false);
  });
});

describe("extra login lists", () => {
  it("splits checked extras into oauth cards vs api-key-only cards", () => {
    const more = [
      serializePiProvider(fakeProvider("openrouter", { name: "OpenRouter", oauth: true, apiKeyLogin: true })),
      serializePiProvider(fakeProvider("google", { name: "Google", apiKeyLogin: true })),
      serializePiProvider(fakeProvider("groq", { name: "Groq", apiKeyLogin: true })),
    ];
    const extra = ["openrouter", "google"];
    assert.deepEqual(extraOauthProviders(more, extra).map((p) => p.id), ["openrouter"]);
    assert.deepEqual(extraApiKeyProviders(more, extra).map((p) => p.id), ["google"]);
  });
});

describe("loginProviderMeta", () => {
  it("prefers featured oauth cards, then the pi catalog", () => {
    const featured = [{ id: "xai", label: "xAI Grok", note: "featured", methods: ["oauth"] }];
    const catalog = [serializePiProvider(fakeProvider("google", { name: "Google", apiKeyLogin: true }))];
    assert.equal(loginProviderMeta("xai", { featuredOauth: featured, catalog })?.label, "xAI Grok");
    assert.equal(loginProviderMeta("google", { featuredOauth: featured, catalog })?.label, "Google");
    assert.equal(loginProviderMeta("missing", { featuredOauth: featured, catalog }), null);
  });
});

describe("listPiCatalogProviders", () => {
  it("reads the bundled pi catalog and returns providers beyond the featured set", async () => {
    const catalog = await listPiCatalogProviders({ payloadRoot: repoRoot });
    const ids = catalog.map((p) => p.id);
    assert.ok(ids.includes("google"), `missing google in ${ids.join(",")}`);
    assert.ok(ids.includes("openrouter"), `missing openrouter in ${ids.join(",")}`);
    const more = morePiProviders(catalog, new Set(["anthropic", "openai-codex", "xai", "github-copilot", "deepseek", "zhipu"]));
    assert.ok(more.length >= 20, `expected a full pi catalog, got ${more.length}`);
    const google = catalog.find((p) => p.id === "google");
    assert.ok(google.methods.includes("api_key"));
  });
});
