import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { campaignDisplayTitle } from "../projections.mjs";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-display-title-"));
  const campaignId = "pdf-coc-an-amaranthine-desire-1";
  const root = path.join(workspace, ".coc", "campaigns", campaignId);
  writeJson(path.join(root, "campaign.json"), {
    campaign_id: campaignId,
    title: "b0b3b1772fadddf1__COC_-An_Amaranthine_Desire.pdf",
    status: "setup",
    play_language: "zh-Hans",
  });
  writeJson(path.join(root, "save", "module-init.json"), {
    secrecy: "keeper_only",
    l0: {
      module_meta: {
        title_zh: "不息的渴望",
        title_en: "An Amaranthine Desire",
        mythos_entities: ["绝不能投影的秘密"],
      },
      keeper_secret: "绝不能投影的秘密",
    },
  });
  return { workspace, campaignId, root };
}

test("uses only the existing extractor agent's safe title fields", () => {
  const { workspace, campaignId } = fixture();
  assert.equal(campaignDisplayTitle(workspace, campaignId), "不息的渴望-建卡");
  assert.doesNotMatch(campaignDisplayTitle(workspace, campaignId), /秘密/);
});

test("combines authored scene label and protagonist short name", () => {
  const { workspace, campaignId, root } = fixture();
  writeJson(path.join(root, "campaign.json"), {
    campaign_id: campaignId,
    title: "b0b3b1772fadddf1__COC_-An_Amaranthine_Desire.pdf",
    status: "active",
    play_language: "zh-Hans",
  });
  assert.equal(campaignDisplayTitle(workspace, campaignId, {
    activeSceneLabel: "大教堂",
    investigatorName: "伊芙琳·哈特",
  }), "不息的渴望-大教堂-伊芙琳");
});

test("falls back to a neutral parsing label and preserves manual override", () => {
  const { workspace, campaignId, root } = fixture();
  fs.unlinkSync(path.join(root, "save", "module-init.json"));
  assert.equal(campaignDisplayTitle(workspace, campaignId), "模组解析中-建卡");
  writeJson(path.join(root, "campaign.json"), {
    campaign_id: campaignId,
    title: "星期五夜团",
    status: "active",
  });
  assert.equal(campaignDisplayTitle(workspace, campaignId, {
    activeSceneLabel: "大教堂",
    investigatorName: "伊芙琳·哈特",
  }), "星期五夜团");
});
