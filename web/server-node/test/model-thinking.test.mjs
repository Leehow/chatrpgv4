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
