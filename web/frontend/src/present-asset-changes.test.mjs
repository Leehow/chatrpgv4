import test from "node:test";
import assert from "node:assert/strict";

import { contentBlockFallbackText, isStructuredContentBlock } from "./safe-display.ts";
import { presentAssetChanges } from "./present-asset-changes.ts";

const assetBlock = {
  type: "asset_changes",
  source_ids: ["cash-1", "item-1"],
  count: 2,
  cash_changes: [{
    effect_id: "cash-1",
    amount: "20",
    currency: "美元",
    direction: "gain",
    after: "35",
    localized_reason: "预付调查费",
  }],
  item_changes: [{
    effect_id: "item-1",
    item_id: "revolver_38",
    label: ".38 左轮手枪",
    action: "acquired",
    weapon: { damage: "1D10", skill: "Firearms (Handgun)", range: 15, ammo: 6 },
  }],
};

test("asset_changes is structured and never falls back to raw JSON or 【变化】", () => {
  assert.equal(isStructuredContentBlock(assetBlock), true);
  const fallback = contentBlockFallbackText(assetBlock);
  assert.equal(fallback, "");
  assert.equal(fallback.includes("{"), false);
  assert.equal(fallback.includes("asset_changes"), false);
  assert.equal(JSON.stringify(assetBlock).includes("【变化】"), false);
});

test("presentAssetChanges shows cash and item fields without machine labels", () => {
  const view = presentAssetChanges(assetBlock);
  assert.deepEqual(view.cashTitles, ["获得 20 美元"]);
  assert.deepEqual(view.itemTitles, ["获得「.38 左轮手枪」"]);
  assert.equal(view.itemWeaponLines[0], "1D10 · Firearms (Handgun) · 射程 15 · 弹药 6");
  assert.equal(view.count, 2);
  const dumped = JSON.stringify(view);
  assert.equal(dumped.includes("【变化】"), false);
  assert.equal(dumped.includes("\"type\":\"asset_changes\""), false);
});
