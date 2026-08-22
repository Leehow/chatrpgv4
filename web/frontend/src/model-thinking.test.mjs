import test from "node:test";
import assert from "node:assert/strict";

import {
  effectiveThinkingLevel,
  modelRouteIdentity,
} from "./model-thinking.ts";

test("duplicate model ids retain their exact provider and visible channel", () => {
  const qwen = modelRouteIdentity({
    provider: "qwen-token-plan-cn",
    model: "glm-5.2",
    providerLabel: "Qwen Token Plan CN",
    modelLabel: "GLM-5.2",
  });
  const zai = modelRouteIdentity({
    provider: "zai-coding-cn",
    model: "glm-5.2",
    providerLabel: "ZAI Coding Plan CN",
    modelLabel: "GLM-5.2",
  });

  assert.deepEqual(qwen, {
    provider: "qwen-token-plan-cn",
    model: "glm-5.2",
    providerLabel: "Qwen Token Plan CN",
    modelLabel: "GLM-5.2",
    label: "Qwen Token Plan CN · GLM-5.2",
  });
  assert.deepEqual(zai, {
    provider: "zai-coding-cn",
    model: "glm-5.2",
    providerLabel: "ZAI Coding Plan CN",
    modelLabel: "GLM-5.2",
    label: "ZAI Coding Plan CN · GLM-5.2",
  });
  assert.notEqual(qwen.label, zai.label);
});

test("the UI replaces a persisted stale level with the selected model's exact level", () => {
  assert.equal(effectiveThinkingLevel("low", ["off"]), "off");
  assert.equal(effectiveThinkingLevel("low", ["off", "low", "high"]), "low");
});

test("the UI model-switch result prefers off instead of an unsupported nearest level", () => {
  assert.equal(effectiveThinkingLevel("high", ["off", "low"]), "off");
});

test("the UI preserves a saved level until model capability metadata arrives", () => {
  assert.equal(effectiveThinkingLevel("low", undefined), "low");
});
