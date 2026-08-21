import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canGeneratePortrait,
  hasPersistedPortrait,
  mapPortraitError,
  portraitButtonLabel,
  portraitImageSrc,
} from "./panel-portrait.ts";

const PANEL_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "components/Panel.tsx"),
  "utf8",
);

test("generate is only enabled for a confirmed investigator", () => {
  assert.equal(
    canGeneratePortrait({
      setupPending: true,
      investigatorId: "ada",
      campaignId: "camp-1",
    }),
    false,
  );
  assert.equal(
    canGeneratePortrait({
      setupPending: false,
      investigatorId: null,
      campaignId: "camp-1",
    }),
    false,
  );
  assert.equal(
    canGeneratePortrait({
      setupPending: false,
      investigatorId: "ada",
      campaignId: "camp-1",
    }),
    true,
  );
});

test("button label switches after a persisted portrait", () => {
  assert.equal(portraitButtonLabel(null), "生成头像");
  assert.equal(
    portraitButtonLabel({ image_url: "/api/investigators/ada/portraits/ada.png" }),
    "重新生成",
  );
  assert.equal(hasPersistedPortrait({ portrait_path: "x.png" }), true);
  assert.equal(
    portraitImageSrc({ image_url: "/api/investigators/ada/portraits/ada.png" }),
    "/api/investigators/ada/portraits/ada.png",
  );
});

test("portrait errors and cancel are Chinese", () => {
  assert.equal(mapPortraitError(new Error("xAI API key is not configured"), false), "未配置 xAI 密钥，无法生成头像。");
  assert.equal(mapPortraitError(new Error("timed out"), false), "头像生成超时，请稍后重试。");
  assert.equal(mapPortraitError(new Error("nope"), true), "已取消");
  assert.equal(
    mapPortraitError(new Error("anthropic 暂不支持图像生成，请改选支持出图的供应商或模型。"), false),
    "anthropic 暂不支持图像生成，请改选支持出图的供应商或模型。",
  );
});

test("character tab mounts a vertical portrait frame without showing the prompt", () => {
  assert.match(PANEL_SRC, /PortraitFrame/);
  assert.match(PANEL_SRC, /portraitButtonLabel/);
  assert.match(PANEL_SRC, /aspect-\[2\/3\]/);
  assert.match(PANEL_SRC, /正在生成头像/);
  assert.match(PANEL_SRC, /已取消/);
  assert.match(PANEL_SRC, /generatePortrait/);
  assert.equal(/\bprompt\b/.test(PANEL_SRC), false);
});
