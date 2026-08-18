import test from "node:test";
import assert from "node:assert/strict";

import { effectiveThinkingLevel } from "./model-thinking.ts";

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
