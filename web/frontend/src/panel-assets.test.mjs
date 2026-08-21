import test from "node:test";
import assert from "node:assert/strict";

import {
  assetsHeadline,
  hasSheetAssets,
  showsAssetsSection,
} from "./panel-assets.ts";

test("assets belong on the items tab, not time or character-only", () => {
  assert.equal(showsAssetsSection("items"), true);
  assert.equal(showsAssetsSection("all"), true);
  assert.equal(showsAssetsSection("character"), false);
  assert.equal(showsAssetsSection("time"), false);
  assert.equal(showsAssetsSection("items", true), false);
});

test("empty or missing assets hide the section", () => {
  assert.equal(hasSheetAssets(null), false);
  assert.equal(hasSheetAssets({}), false);
  assert.equal(hasSheetAssets({ display: "  " }), false);
  assert.equal(hasSheetAssets({ display: "$29,500" }), true);
});

test("headline joins display and chargen source without repeating cash", () => {
  assert.equal(
    assetsHeadline({ display: "$29,500", source: "信用评级换算" }),
    "$29,500 · 信用评级换算",
  );
  assert.equal(assetsHeadline({ display: "$29,500" }), "$29,500");
});
