import test from "node:test";
import assert from "node:assert/strict";

import {
  assetsHeadline,
  hasSheetAssets,
  showsAssetsSection,
} from "./panel-assets.ts";

test("assets belong on the character tab with cash, and on items, not time", () => {
  assert.equal(showsAssetsSection("items"), true);
  assert.equal(showsAssetsSection("all"), true);
  assert.equal(showsAssetsSection("character"), true);
  assert.equal(showsAssetsSection("time"), false);
  assert.equal(showsAssetsSection("items", true), false);
  assert.equal(showsAssetsSection("character", true), false);
});

test("empty or missing assets hide the section", () => {
  assert.equal(hasSheetAssets(null), false);
  assert.equal(hasSheetAssets({}), false);
  assert.equal(hasSheetAssets({ display: "  " }), false);
  assert.equal(hasSheetAssets({ display: "$29,500" }), true);
});

// Mirrors Panel.tsx: showsAssetsSection(view) && hasSheetAssets(assets).
// The default Character tab is view="character"; omitting that gate hid a
// live campaign Assets block even when the read model had current finance.
test("character tab shows current Assets when the live read model has display", () => {
  const live = {
    display: "$2,200",
    current: true,
    baseline: false,
    living_standard: "普通",
    spending_level: "$10",
    labels: {
      assets: "当前资产",
      living_standard: "生活水平",
      spending_level: "每日免记账额度",
    },
  };
  assert.equal(showsAssetsSection("character"), true);
  assert.equal(hasSheetAssets(live), true);
  assert.equal(assetsHeadline(live), "$2,200");
});

test("headline joins display and chargen source without repeating cash", () => {
  assert.equal(
    assetsHeadline({ display: "$29,500", source: "信用评级换算" }),
    "$29,500 · 信用评级换算",
  );
  assert.equal(assetsHeadline({ display: "$29,500" }), "$29,500");
  assert.equal(
    assetsHeadline({
      display: "$2,200",
      source: "信用评级换算",
      current: true,
    }),
    "$2,200",
  );
});
