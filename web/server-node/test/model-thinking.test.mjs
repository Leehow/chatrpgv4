import test from "node:test";
import assert from "node:assert/strict";

import { resolveRequestedModelSettings } from "../model-thinking.mjs";

const MODELS = {
  default: { provider: "reasoner", model: "model-low" },
  providers: {
    reasoner: {
      models: [{ id: "model-low", thinkingLevels: ["off", "low", "high"] }],
    },
    jellytoken: {
      models: [{ id: "deepseek-v4-flash", thinkingLevels: ["off"] }],
    },
  },
};

test("persisted stale low is normalized to the selected off-only model", () => {
  assert.deepEqual(
    resolveRequestedModelSettings(MODELS, {
      provider: "jellytoken",
      model: "deepseek-v4-flash",
      thinking: "low",
    }),
    { provider: "jellytoken", model: "deepseek-v4-flash", thinking: "off" },
  );
});

test("model switches retain a supported level and clamp only the off-only target", () => {
  assert.equal(
    resolveRequestedModelSettings(MODELS, {
      provider: "reasoner",
      model: "model-low",
      thinking: "low",
    }).thinking,
    "low",
  );
  assert.equal(
    resolveRequestedModelSettings(MODELS, {
      provider: "jellytoken",
      model: "deepseek-v4-flash",
      thinking: "low",
    }).thinking,
    "off",
  );
});

test("duplicate model ids retain the explicitly selected provider independently", () => {
  const duplicateCatalog = {
    default: { provider: "qwen-token-plan-cn", model: "glm-5.2" },
    providers: {
      "qwen-token-plan-cn": {
        models: [{ id: "glm-5.2", thinkingLevels: ["off"] }],
      },
      "zai-coding-cn": {
        models: [{ id: "glm-5.2", thinkingLevels: ["off", "high"] }],
      },
    },
  };

  assert.deepEqual(
    resolveRequestedModelSettings(duplicateCatalog, {
      provider: "qwen-token-plan-cn",
      model: "glm-5.2",
      thinking: "high",
    }),
    { provider: "qwen-token-plan-cn", model: "glm-5.2", thinking: "off" },
  );
  assert.deepEqual(
    resolveRequestedModelSettings(duplicateCatalog, {
      provider: "zai-coding-cn",
      model: "glm-5.2",
      thinking: "high",
    }),
    { provider: "zai-coding-cn", model: "glm-5.2", thinking: "high" },
  );
});
