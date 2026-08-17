import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PROVIDER_PRESETS, upsertProvider } from "./agentconfig.mjs";

function tmpAgentDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coc-agentconfig-"));
}

test("upsertProvider carries contextWindow/maxTokens and model-level api", async () => {
  const dir = tmpAgentDir();
  const preset = PROVIDER_PRESETS.find((p) => p.id === "xai");
  assert.ok(preset, "xai preset exists");
  const grok45 = preset.models.find((m) => m.id === "grok-4.5");
  assert.equal(grok45.api, "openai-responses");
  const result = await upsertProvider(dir, { ...preset, apiKey: "sk-test" });
  assert.equal(result.ok, true);
  const doc = JSON.parse(fs.readFileSync(path.join(dir, "models.json"), "utf8"));
  const model = doc.providers.xai.models.find((m) => m.id === "grok-4.5");
  assert.equal(model.contextWindow, 500000);
  assert.equal(model.maxTokens, 500000);
  assert.equal(model.reasoning, true);
  assert.equal(model.thinkingLevelMap.low, "low");
  // grok-4.5 rides the shared "xai" provider credential on the
  // openai-responses channel; the provider default stays openai-completions.
  assert.equal(model.api, "openai-responses");
  assert.equal(doc.providers.xai.api, "openai-completions");
  const grok46 = doc.providers.xai.models.find((m) => m.id === "grok-4.6");
  assert.equal(grok46.api, undefined);
  assert.equal(grok46.contextWindow, 1000000);
});

test("upsertProvider preserves richer fields on earlier model entries", async () => {
  const dir = tmpAgentDir();
  const preset = PROVIDER_PRESETS.find((p) => p.id === "xai");
  assert.ok(preset, "xai preset exists");
  assert.equal((await upsertProvider(dir, { ...preset, apiKey: "sk-test" })).ok, true);
  // Simulate a hand-tuned window on an entry the preset does not know.
  const modelsPath = path.join(dir, "models.json");
  const doc = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
  doc.providers.xai.models.push({ id: "grok-custom", name: "Custom", contextWindow: 999999 });
  fs.writeFileSync(modelsPath, JSON.stringify(doc));
  assert.equal((await upsertProvider(dir, { ...preset, apiKey: "sk-test2" })).ok, true);
  const after = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
  const kept = after.providers.xai.models.find((m) => m.id === "grok-custom");
  assert.equal(kept.contextWindow, 999999);
  const grok46 = after.providers.xai.models.find((m) => m.id === "grok-4.6");
  assert.equal(grok46.contextWindow, 1000000);
});
