import test from "node:test";
import assert from "node:assert/strict";

import {
  contentBlockFallbackText,
  isStructuredContentBlock,
  safeDisplayText,
} from "./safe-display.ts";

const eraAdaptiveOccupation = {
  name: "战地记者",
  reason: "时代适配",
  era_adaptive: true,
  skill_point_formula: "EDU×2 + POW×2",
  formula_reason: "记者需教养与意志",
};

test("era-adaptive occupation object is not treated as a React child payload", () => {
  const shown = safeDisplayText(eraAdaptiveOccupation);
  assert.equal(typeof shown, "string");
  assert.match(shown, /战地记者/);
  assert.equal(shown.includes("[object Object]"), false);
});

test("content block whose text is an era-adaptive object stringifies without throwing", () => {
  const block = { type: "prose", text: eraAdaptiveOccupation };
  assert.equal(isStructuredContentBlock(block), false);
  const shown = contentBlockFallbackText(block);
  assert.equal(typeof shown, "string");
  assert.match(shown, /战地记者/);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify({ rendered: shown })));
});

test("content block that is the receipt object itself still yields a string", () => {
  const shown = contentBlockFallbackText(eraAdaptiveOccupation);
  assert.equal(typeof shown, "string");
  assert.match(shown, /战地记者/);
});

test("asset_changes fallback is empty so Chat never stringifies the block", () => {
  const block = {
    type: "asset_changes",
    source_ids: ["item-1"],
    cash_changes: [],
    item_changes: [{ effect_id: "item-1", item_id: "k", label: "钥匙", action: "acquired" }],
    count: 1,
  };
  assert.equal(isStructuredContentBlock(block), true);
  assert.equal(contentBlockFallbackText(block), "");
});
