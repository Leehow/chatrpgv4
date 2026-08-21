import test from "node:test";
import assert from "node:assert/strict";

import { applyKnownThinking, knownThinkingMeta } from "../known-thinking.mjs";

const JT = {
  providerId: "jellytoken",
  baseUrl: "https://aiservice.jellytoken.com/v1",
};

test("jellytoken overlay exposes probed effort values on every model id", () => {
  for (const modelId of ["deepseek-v4-flash", "deepseek-v4-pro", "glm-5.2", "qwen-plus"]) {
    const meta = knownThinkingMeta({ ...JT, modelId });
    assert.equal(meta.reasoning, true, modelId);
    assert.equal(meta.compat.thinkingFormat, "deepseek", modelId);
    assert.equal(meta.thinkingLevelMap.minimal, null, modelId);
    assert.equal(meta.thinkingLevelMap.low, "low", modelId);
    assert.equal(meta.thinkingLevelMap.medium, "medium", modelId);
    assert.equal(meta.thinkingLevelMap.high, "high", modelId);
    assert.equal(meta.thinkingLevelMap.xhigh, "xhigh", modelId);
    assert.equal(meta.thinkingLevelMap.max, "max", modelId);
  }
});

test("DeepSeek ids keep assistant reasoning-content; others do not force it", () => {
  assert.equal(
    knownThinkingMeta({ ...JT, modelId: "deepseek-v4-flash" }).compat
      .requiresReasoningContentOnAssistantMessages,
    true,
  );
  assert.equal(
    knownThinkingMeta({ ...JT, modelId: "glm-5.2" }).compat
      .requiresReasoningContentOnAssistantMessages,
    undefined,
  );
});

test("overlay matches JellyToken by base URL even when the provider id differs", () => {
  const meta = knownThinkingMeta({
    providerId: "jt",
    baseUrl: "https://aiservice.jellytoken.com/v1",
    modelId: "glm-5",
  });
  assert.equal(meta.reasoning, true);
  assert.equal(
    knownThinkingMeta({
      providerId: "acme",
      baseUrl: "https://api.acme.test/v1",
      modelId: "deepseek-v4-flash",
    }),
    null,
  );
});

test("applyKnownThinking stamps unmapped jellytoken models and leaves a user-tuned map alone", () => {
  const stamped = applyKnownThinking(JT, { id: "glm-5.2", name: "GLM 5.2" });
  assert.equal(stamped.reasoning, true);
  assert.equal(stamped.thinkingLevelMap.xhigh, "xhigh");
  const tuned = applyKnownThinking(JT, {
    id: "glm-5.2",
    thinkingLevelMap: { high: "high" },
  });
  assert.deepEqual(tuned.thinkingLevelMap, { high: "high" });
});
